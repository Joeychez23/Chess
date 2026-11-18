/*
 *  cardsController.js  --  chess server
 *	Chess Cards Routes
 *  A card game vs Vesper (the AI). The rules engine (cards-engine/) runs here, the data service stores its state as a JSON string (cards_state)
 *  and saves a new one only on the version it was made from. The state holds the rng & Vesper's hand, so a client only ever gets
 *  playerView & playerEvents of it, never the state itself
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const crypto = require("crypto");
const { newGame, applyAction, legalActions, playerView, playerEvents, toFen, ENGINE_VERSION, IllegalAction } = require("../../cards-engine/index.js");
const { baseKey } = require("../../cards-engine/cards/index.js");
const { readLevel } = require("../utils/ai.js");
const { gameOpen, isColor } = require("../utils/games.js");
const { setGuestCookie } = require("../middleware/auth.js");
const { ifSaved, forfeit, newCardsGame: createCardsGame, saveCardsState } = require("../dataClient.js");
const { retrieveGame, currentGame, playerInGame, notYours, notInGame, reply, aiLevel } = require("./chessController.js");

const ACTION_CHARS = 2000; // AN ACTION AS JSON, THE LONGEST LEGAL ONE IS UNDER 100

/* ---------------------------------------------------------------- */
// New Game (POST)
/* ---------------------------------------------------------------- */
/**
 * @description Creates a card game vs Vesper for the requester (signed in or a guest, who gets a guest_game cookie for it). Signed in players have one AI or card game open at a time:
 * while one is open this answers 409, unless replace_current forfeits it first. The seed is 32 random bytes, an integer only from CARDS_TEST_SEED while NODE_ENV is "test", never from the request
 * @param  {[object]} req.body [{ start_color ("alternate" | "random" | "w" | "b", anything else is random), ai_level (Vesper's level, as /api/chess/game), replace_current (true = forfeit the open AI or card game) }]
 * @return {[object]} response [cardsResponse | { status: 409, game_id (the open one), message }]
 */
async function newCardsGame(req, res) {
	const { ai_level, start_color, replace_current } = req.body || {};
	if (req.user) { // A GUEST ONLY EVER HAS ONE GAME: THEIR COOKIE MOVES TO THE NEW ONE
		const current = await currentGame(true);
		if (current && !replace_current) { return res.status(409).json({ status: 409, game_id: current.game_id.S, message: "AI game already open" }); }
		if (current) { await forfeit(current.game_id.S); } // NEW GAME FORFEITS THE OPEN ONE
	}

	const color = isColor(start_color) ? start_color : "random";
	const level = readLevel(ai_level);
	const fixed = process.env.NODE_ENV === "test" && /^\d+$/.test(process.env.CARDS_TEST_SEED || "") && Number(process.env.CARDS_TEST_SEED) <= 0xFFFFFFFF; // TESTS ONLY, A WHOLE NUMBER THE ENGINE TAKES ONLY: ANYWHERE ELSE EVERY GAME WOULD BE THE SAME ONE
	const seed = fixed ? Number(process.env.CARDS_TEST_SEED) : crypto.randomBytes(32).toString("hex");
	const state = newGame({ vesper: color == "b" ? "w" : "b", level, seed }); // THE DATA SERVICE PICKS THE SIDES: loadCardsGame SETS vesper FROM THE GAME ON EVERY READ
	const response = await createCardsGame({ color, level, state: JSON.stringify(state), fen: toFen(state) });
	if (!response.game_data) { return reply(res, { status: response.status, message: response.message }); }
	if (response.guest_token) { setGuestCookie(res, response.guest_token); } // ONLY THIS BROWSER CAN PLAY IT, THE DATA SERVICE SIGNED IT FOR THIS GAME
	state.vesper = vesperOf(response.game_data);
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
	const you = other(vesperOf(gameData));
	if (!gameOpen(gameData)) { return res.status(409).json({ ...cardsResponse(gameData, state), status: 409, message: "Game is already over" }); }

	let next;
	try {
		next = applyAction(state, you, action);
	} catch (err) {
		if (!(err instanceof IllegalAction)) { throw err; }
		return res.status(409).json({ ...cardsResponse(gameData, state), status: 409, message: "That action isn't available" });
	}

	const gameId = gameData.game_id.S;
	const json = JSON.stringify(next.state);
	const result = next.state.result; // A WINNER & REASON CLOSE THE GAME IN THE SAME WRITE. THE ENGINE'S DRAW IS winner null, THE DATA SERVICE'S "draw"
	const ended = result ? { winner: result.winner || "draw", reason: result.reason } : {};
	const saved = await ifSaved(() => saveCardsState(gameId, Number(gameData.cards_version.N), json, { fen: boardFen(gameData, next.state), ...ended }), async () => {
		const latest = await retrieveGame(gameId, true); // TOO SLOW: SAVED IF THE STORED STATE IS THIS ONE
		return latest.game_data?.cards_state?.S == json ? latest : null;
	});
	if (saved.status == 409) { // ANOTHER SAVE OF THIS VERSION LANDED FIRST (THE SAME ACTION SENT TWICE, A FORFEIT): THE GAME AS IT IS NOW
		const latest = await loadCardsGame(req, res);
		if (!latest) { return; }
		return res.status(409).json({ ...cardsResponse(latest.gameData, latest.state), status: 409, stale: true, message: saved.message });
	}
	if (saved.status != 200) { return reply(res, { status: saved.status, message: saved.message }); }
	return res.json(cardsResponse(saved.game_data, next.state, next.events));
}

/* ---------------------------------------------------------------- */
// Vesper (Task 17)
/* ---------------------------------------------------------------- */
/**
 * @description Vesper's action in a card game. Not built yet (Task 17)
 * @return {[object]} response [{ status: 501, message }]
 */
function vesperCardsTurn(req, res) {
	return res.status(501).json({ status: 501, message: "Vesper can't play yet" });
}

/**
 * @description Who Vesper is, for the card game page. Not built yet (Task 17)
 * @return {[object]} response [{ status: 501, message }]
 */
function getVesper(req, res) {
	return res.status(501).json({ status: 501, message: "Vesper can't play yet" });
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
	state.vesper = vesperOf(gameData); // newCardsGame MADE THE STATE BEFORE THE SIDES WERE PICKED
	return { gameData, state };
}

/**
 * @description The body every card route answers with, for the requester (the side that isn't Vesper)
 * @param  {[object]} gameData [the stored card game]
 * @param  {[object]} state [its engine state]
 * @param  {[array]} events [the action's events, left out = none]
 * @return {[object]} body [{ status, game_id, mode: "cards", ai_level, you: "w" | "b", view: playerView, legal: the requester's legal actions ([] once it's over), events: playerEvents,
 * vesper_due: Vesper owes an action (its turn, or a duel pick or a choice), result: { winner, reason } | null (a forfeit: from the game, the state doesn't have it) }]
 */
function cardsResponse(gameData, state, events = []) {
	const vesper = vesperOf(gameData), you = other(vesper);
	const open = gameOpen(gameData);
	return {
		status: 200,
		game_id: gameData.game_id.S,
		mode: "cards",
		ai_level: aiLevel(gameData),
		you,
		view: playerView(state, you),
		legal: open ? legalActions(state, you) : [],
		events: playerEvents(state, events, you),
		vesper_due: open && legalActions(state, vesper).length > 0,
		result: state.result || (open ? null : { winner: gameData.winner?.S || null, reason: gameData.reason?.S || null }),
	};
}

/**
 * @description The board a save stores as game_board, what the normal game routes & Home's picture show. While Vesper's Fog of War is up
 * it keeps the stored one: the real board would show the pieces the fog hides from the player. A finished game hides nothing
 * @param  {[object]} gameData [the stored card game]
 * @param  {[object]} state [the state being saved]
 * @return {[string]} fen
 */
function boardFen(gameData, state) {
	const fogged = state.enchant.some((e) => baseKey(e.key) === "fog-of-war" && e.owner === vesperOf(gameData)); // ANY VERSION OF THE CARD
	return fogged && !state.result ? gameData.game_board.S : toFen(state);
}

const vesperOf = (gameData) => (gameData.white_player_id.S == "CHESS_AI" ? "w" : "b"); // VESPER PLAYS AS CHESS_AI
const other = (color) => (color == "w" ? "b" : "w");


module.exports = { newCardsGame, getCardsGame, playCardsAction, vesperCardsTurn, getVesper };
