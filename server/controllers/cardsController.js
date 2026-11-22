/*
 *  cardsController.js  --  chess server
 *	Chess Cards Routes
 *  A card game vs Card Guy (the AI). The rules engine (cards-engine/) runs here, the data service stores its state as a JSON string (cards_state)
 *  and saves a new one only on the version it was made from. The state holds the rng & Card Guy's hand, so a client only ever gets
 *  playerView & playerEvents of it, never the state itself
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const crypto = require("crypto");
const { newGame, applyAction, legalActions, playerLegal, playerView, playerEvents, actionKey, toFen, ENGINE_VERSION, IllegalAction } = require("../../cards-engine/index.js");
const { CARDS, baseKey } = require("../../cards-engine/cards/index.js");
const { readLevel, bestOf } = require("../utils/ai.js");
const cardGuy = require("../utils/card-guy/index.js");
const { gameOpen, isColor } = require("../utils/games.js");
const { setGuestCookie, readGuestGame } = require("../middleware/auth.js");
const { ifSaved, forfeit, newCardsGame: createCardsGame, saveCardsState } = require("../dataClient.js");
const { retrieveGame, currentGame, playerInGame, notYours, notInGame, reply, aiLevel } = require("./chessController.js");

const ACTION_CHARS = 2000; // AN ACTION AS JSON, THE LONGEST LEGAL ONE IS UNDER 100
const MAX_REFUSALS = 8; // TIMES CARD GUY IS ASKED AGAIN IN ONE CALL (EACH IS A WHOLE TURN OF THINKING), THEN ANY LEGAL ACTION IS PLAYED
const cardGuyTurns = new Map(); // GAME ID -> CARD GUY'S ACTION BEING PICKED & SAVED (A PROMISE), SO PARALLEL /card-guy REQUESTS PLAY IT ONCE

/* ---------------------------------------------------------------- */
// New Game (POST)
/* ---------------------------------------------------------------- */
/**
 * @description Creates a card game vs Card Guy for the requester (signed in or a guest, who gets a guest_game cookie for it). Signed in players have one AI or card game open at a time:
 * while one is open this answers 409, unless replace_current forfeits it first. A guest's earlier game (the one their cookie names, card or normal) is forfeited: the cookie moves to the new game. The seed is 32 random bytes, an integer only from CARDS_TEST_SEED while NODE_ENV is "test", never from the request
 * @param  {[object]} req.body [{ start_color ("alternate" | "random" | "w" | "b", anything else is random), ai_level (Card Guy's level, as /api/chess/game), replace_current (true = forfeit the open AI or card game) }]
 * @return {[object]} response [cardsResponse | { status: 409, game_id (the open one), message }]
 */
async function newCardsGame(req, res) {
	const { ai_level, start_color, replace_current } = req.body || {};
	if (req.user) { // A GUEST ONLY EVER HAS ONE GAME: THEIR COOKIE MOVES TO THE NEW ONE
		const current = await currentGame(true);
		if (current && !replace_current) { return res.status(409).json({ status: 409, game_id: current.game_id.S, message: "AI game already open" }); }
		if (current) { await forfeit(current.game_id.S); } // NEW GAME FORFEITS THE OPEN ONE
	} else if (readGuestGame(req)) { await forfeit(readGuestGame(req)); } // THEIR COOKIE'S GAME CAN'T BE REACHED AGAIN: CLOSED NOW, NOT LEFT OPEN UNTIL ITS TTL (ALREADY OVER: REFUSED, NOTHING CHANGES)

	const color = isColor(start_color) ? start_color : "random";
	const level = readLevel(ai_level);
	const fixed = process.env.NODE_ENV === "test" && /^\d+$/.test(process.env.CARDS_TEST_SEED || "") && Number(process.env.CARDS_TEST_SEED) <= 0xFFFFFFFF; // TESTS ONLY, A WHOLE NUMBER THE ENGINE TAKES ONLY: ANYWHERE ELSE EVERY GAME WOULD BE THE SAME ONE
	const seed = fixed ? Number(process.env.CARDS_TEST_SEED) : crypto.randomBytes(32).toString("hex");
	const state = newGame({ cardGuy: color == "b" ? "w" : "b", level, seed }); // THE DATA SERVICE PICKS THE SIDES: loadCardsGame SETS cardGuy FROM THE GAME ON EVERY READ
	const response = await createCardsGame({ color, level, state: JSON.stringify(state), fen: toFen(state) });
	if (!response.game_data) { return reply(res, { status: response.status, message: response.message }); }
	if (response.guest_token) { setGuestCookie(res, response.guest_token); } // ONLY THIS BROWSER CAN PLAY IT, THE DATA SERVICE SIGNED IT FOR THIS GAME
	state.cardGuy = cardGuyOf(response.game_data);
	return res.json(cardsResponse(response.game_data, state));
}

/* ---------------------------------------------------------------- */
// Get Game (GET)
/* ---------------------------------------------------------------- */
/**
 * @description The card game as the requester may see it: loading the page, & a reload mid-duel or mid-choice gets it exactly as it was
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [cardsResponse]
 */
async function getCardsGame(req, res) {
	const game = await loadCardsGame(req, res);
	if (!game) { return; }
	return res.json(cardsResponse(game.gameData, game.state));
}

/* ---------------------------------------------------------------- */
// Action (POST)
/* ---------------------------------------------------------------- */
/**
 * @description Plays one of the requester's legal actions (a move, a card, a duel pick, an answer to a choice) on the stored state & saves the new one, only on the version it was read at
 * @param  {[string]} req.params.gameId [game id]
 * @param  {[object]} req.body [{ action: one of the response's legal }]
 * @return {[object]} response [cardsResponse with the action's events | { status: 400, message } not an action | { status: 409, ...cardsResponse (the fresh game), message } the game is over,
 * the action isn't legal, or another save landed first (stale: true) | { status: 409, game_id, message } a state from an older engine version]
 */
async function playCardsAction(req, res) {
	const action = req.body?.action;
	if (!action || typeof action != "object" || Array.isArray(action) || JSON.stringify(action).length > ACTION_CHARS) { return res.status(400).json({ status: 400, message: "Invalid action" }); }

	const game = await loadCardsGame(req, res);
	if (!game) { return; }
	const { gameData, state } = game;
	const you = other(cardGuyOf(gameData));
	if (!gameOpen(gameData)) { return res.status(409).json({ ...cardsResponse(gameData, state), status: 409, message: "Game is already over" }); }

	let next;
	try {
		next = applyAction(state, you, action);
	} catch (err) {
		if (!(err instanceof IllegalAction)) { throw err; }
		return res.status(409).json({ ...cardsResponse(gameData, state), status: 409, message: "That action isn't available" });
	}

	const saved = await saveState(gameData, next.state);
	if (saved.status == 409) { // ANOTHER SAVE OF THIS VERSION LANDED FIRST (THE SAME ACTION SENT TWICE, A FORFEIT): THE GAME AS IT IS NOW
		const latest = await loadCardsGame(req, res);
		if (!latest) { return; }
		return res.status(409).json({ ...cardsResponse(latest.gameData, latest.state), status: 409, stale: true, message: saved.message });
	}
	if (saved.status != 200) { return reply(res, { status: saved.status, message: saved.message }); }
	return res.json(cardsResponse(saved.game_data, next.state, next.events));
}

/* ---------------------------------------------------------------- */
// Card Guy (POST, GET)
/* ---------------------------------------------------------------- */
/**
 * @description Card Guy plays one action it owes (a turn action, the second move of a two-move turn, a choice, a card duel pick) & it's saved. The client only shows it.
 * When Card Guy owes nothing (the player's turn, the game is over) this answers with the game as it is. Parallel requests play the action once & all get it
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [cardsResponse with the action's events, card_guy_due says whether to call again | cardsResponse (no events) when nothing is owed, or another save landed first]
 */
async function cardGuyCardsTurn(req, res) {
	const game = await loadCardsGame(req, res);
	if (!game) { return; }
	const { gameData, state } = game, gameId = gameData.game_id.S;
	if (!gameOpen(gameData) || !legalActions(state, cardGuyOf(gameData)).length) { return res.json(cardsResponse(gameData, state)); } // NOTHING OWED: CARD GUY ISN'T ASKED (IT THROWS)

	let turn = cardGuyTurns.get(gameId);
	if (!turn) { // NO ACTION IN FLIGHT FOR THIS GAME: THIS REQUEST PICKS IT, LATER ONES WAIT ON IT & GET THE SAME ANSWER (THE GAME HAS ONE PLAYER)
		turn = playCardGuyTurn(gameData, state).finally(() => cardGuyTurns.delete(gameId));
		cardGuyTurns.set(gameId, turn);
	}
	return reply(res, await turn);
}

/**
 * @description Picks Card Guy's action from its own view of the game (never the state), plays it on the state & saves it. Under the player's Fog of War the real game can refuse the action
 * (Card Guy guessed the fogged pieces): it's asked again with the action in refused. When it has none left, throws, or was refused MAX_REFUSALS times, a legal action is played all the same
 * (a move when there is one): the game never waits on Card Guy
 * @param  {[object]} gameData [the stored card game, open]
 * @param  {[object]} state [its engine state, Card Guy owes an action]
 * @return {[object]} body [cardsResponse with the events | cardsResponse of the game as it is now (another save landed first: a forfeit) | { status, message }]
 */
async function playCardGuyTurn(gameData, state) {
	const me = cardGuyOf(gameData), gameId = gameData.game_id.S;
	const view = playerView(state, me), fogged = view.board.hidden > 0;
	const seed = crypto.randomInt(2 ** 32); // CARD GUY'S OWN DICE, NEVER THE GAME'S
	const refused = [];
	let next = null;
	while (!next && refused.length <= MAX_REFUSALS) {
		let action;
		try {
			action = await cardGuy.cardGuyTurn(view, state.level, { evaluate: cardGuy.evaluate, bestOf, seed, refused, legal: playerLegal(state, me) }); // THE LIST A PLAYER IS TOLD: NO MOVE FOR A MIRAGE IT HOLDS IN CHECK
			next = applyAction(state, me, action);
		} catch (err) {
			if (!action || !(err instanceof IllegalAction)) { console.log(`CARD GUY FOUND NO ACTION IN GAME ${gameId}: ${err.message}`); break; } // NO action: CARD GUY ITSELF THREW, THERE'S NOTHING TO REFUSE & ASKING AGAIN GIVES THE SAME
			if (!fogged) { console.log(`CARD GUY PICKED AN ILLEGAL ACTION WITH NO FOG UP IN GAME ${gameId}: ${JSON.stringify(action)}`); } // A BUG: ONLY A GUESSED BOARD CAN BE WRONG
			refused.push(actionKey(action));
		}
	}
	if (!next) {
		const legal = legalActions(state, me), moves = legal.filter((a) => a.type === "move"), from = moves.length ? moves : legal;
		next = applyAction(state, me, from[crypto.randomInt(from.length)]);
	}

	const saved = await saveState(gameData, next.state);
	if (saved.status == 409) { // ANOTHER SAVE OF THIS VERSION LANDED FIRST (A FORFEIT, A REQUEST THAT READ THE GAME BEFORE THIS TURN STARTED): THE GAME AS IT IS NOW
		const latest = await retrieveGame(gameId, true);
		if (!latest.game_data) { return { status: latest.status, message: latest.message }; }
		return cardsResponse(latest.game_data, { ...JSON.parse(latest.game_data.cards_state.S), cardGuy: me });
	}
	if (saved.status != 200) { return { status: saved.status, message: saved.message }; }
	return cardsResponse(saved.game_data, next.state, next.events);
}

/**
 * @description Who the Chess Cards opponent is, for the card game page: only a name. The bot has no avatar, bio or lines
 * @return {[object]} response [{ name }]
 */
function getCardGuy(req, res) {
	return res.json({ name: "Card Guy" });
}

/* ---------------------------------------------------------------- */
// Helpers
/* ---------------------------------------------------------------- */
/**
 * @description Reads a card game for the requester (consistent, so it sees the latest save) & answers the request itself when it can't go on:
 * not their game (401 / 403), not found (404), not a card game (400), or a state from an older engine version (409, with the game_id so the page can offer to forfeit it)
 * @param  {[object]} req [express request, req.params.gameId]
 * @param  {[object]} res [express response]
 * @return {[object]} game [{ gameData, state }, null when it answered]
 */
async function loadCardsGame(req, res) {
	const response = await retrieveGame(req.params.gameId, true);
	if (notYours(response)) { notInGame(req, res); return null; } // THE DATA SERVICE ONLY SHOWS A GAME TO A PLAYER IN IT
	if (!response.game_data) { reply(res, { status: response.status, message: response.message }); return null; } // GAME NOT FOUND

	const gameData = response.game_data;
	if (!playerInGame(req, gameData)) { notInGame(req, res); return null; }
	if (gameData.mode?.S != "cards") { res.status(400).json({ status: 400, message: "Not a card game" }); return null; }
	const state = JSON.parse(gameData.cards_state.S);
	if (state.v !== ENGINE_VERSION) { res.status(409).json({ status: 409, game_id: gameData.game_id.S, message: "This game is from an older version" }); return null; } // ITS STATE MAY NOT FIT THIS ENGINE
	state.cardGuy = cardGuyOf(gameData); // newCardsGame MADE THE STATE BEFORE THE SIDES WERE PICKED
	return { gameData, state };
}

/**
 * @description Saves a state an action made, only on the version the game was read at. A result closes the game in the same write
 * @param  {[object]} gameData [the stored card game the action was played on]
 * @param  {[object]} state [the state after the action]
 * @return {[object]} response [the data service's { status, game_data, message }, 409 when another save of this version landed first]
 */
function saveState(gameData, state) {
	const gameId = gameData.game_id.S;
	const json = JSON.stringify(state);
	const result = state.result; // A WINNER & REASON CLOSE THE GAME IN THE SAME WRITE. THE ENGINE'S DRAW IS winner null, THE DATA SERVICE'S "draw"
	const ended = result ? { winner: result.winner || "draw", reason: result.reason } : {};
	return ifSaved(() => saveCardsState(gameId, Number(gameData.cards_version.N), json, { fen: boardFen(gameData, state), ...ended }), async () => {
		const latest = await retrieveGame(gameId, true); // TOO SLOW: SAVED IF THE STORED STATE IS THIS ONE
		return latest.game_data?.cards_state?.S == json ? latest : null;
	});
}

/**
 * @description The body every card route answers with, for the requester (the side that isn't Card Guy)
 * @param  {[object]} gameData [the stored card game]
 * @param  {[object]} state [its engine state]
 * @param  {[array]} events [the action's events, left out = none]
 * @return {[object]} body [{ status, game_id, mode: "cards", ai_level, you: "w" | "b", view: playerView, legal: the requester's legal actions as playerLegal tells them ([] once it's over), legal_hidden: Card Guy's Fog of War is up, so legal leaves out the moves (any legal action is still taken), events: playerEvents,
 * card_guy_due: Card Guy owes an action (its turn, or a duel pick or a choice), result: { winner, reason } | null (a forfeit: from the game, the state doesn't have it),
 * catalog: { [card key]: { name, kind, text, skulls, rarity } } for every card key in view & events, what the table's card faces show (a version: its base card's name) }]
 */
function cardsResponse(gameData, state, events = []) {
	const cardGuy = cardGuyOf(gameData), you = other(cardGuy);
	const open = gameOpen(gameData);
	const result = state.result || (open ? null : { winner: gameData.winner?.S || null, reason: gameData.reason?.S || null });
	const shown = result && !state.result ? { ...state, result } : state; // A FORFEIT LEAVES THE STATE WITHOUT ONE: A FINISHED GAME'S VIEW & EVENTS HIDE NOTHING
	const view = playerView(shown, you);
	const seen = playerEvents(shown, events, you);
	return {
		status: 200,
		game_id: gameData.game_id.S,
		mode: "cards",
		ai_level: aiLevel(gameData),
		you,
		view,
		legal: open ? playerLegal(state, you) : [],
		legal_hidden: open && state.enchant.some((e) => baseKey(e.key) === "fog-of-war" && e.owner === cardGuy), // ANY VERSION OF THE CARD
		events: seen,
		card_guy_due: open && legalActions(state, cardGuy).length > 0,
		result,
		catalog: catalogOf([view, seen]),
	};
}

/**
 * @description The face of every card key that appears anywhere in x (any string equal to a registered key: a card's key, a choice's curse option, a pending choice's card), so the
 * browser loads no engine code. Only keys x already shows, so it tells the player nothing new
 * @param  {[object]} x [what the response sends]
 * @return {[object]} catalog [{ [key]: { name, kind, text, skulls, rarity } }]
 */
function catalogOf(x) {
	const out = {};
	JSON.stringify(x, (k, v) => {
		if (typeof v === "string" && Object.hasOwn(CARDS, v) && !out[v]) { const c = CARDS[v]; out[v] = { name: CARDS[baseKey(v)].name, kind: c.kind, text: c.text, skulls: c.skulls, rarity: c.rarity }; }
		return v;
	});
	return out;
}

/**
 * @description The board a save stores as game_board, what the normal game routes & Home's picture show. While Card Guy's Fog of War is up
 * it keeps the stored one: the real board would show the pieces the fog hides from the player. A finished game hides nothing
 * @param  {[object]} gameData [the stored card game]
 * @param  {[object]} state [the state being saved]
 * @return {[string]} fen
 */
function boardFen(gameData, state) {
	const fogged = state.enchant.some((e) => baseKey(e.key) === "fog-of-war" && e.owner === cardGuyOf(gameData)); // ANY VERSION OF THE CARD
	return fogged && !state.result ? gameData.game_board.S : toFen(state);
}

const cardGuyOf = (gameData) => (gameData.white_player_id.S == "CHESS_AI" ? "w" : "b"); // CARD GUY PLAYS AS CHESS_AI
const other = (color) => (color == "w" ? "b" : "w");


module.exports = { newCardsGame, getCardsGame, playCardsAction, cardGuyCardsTurn, getCardGuy };
