/*
 *  cardsController.js  --  chess server
 *	Chess Cards Routes
 *  A card game vs Card Guy (the AI). The rules engine (cards-engine/) runs here. The data service stores its state as a
 *  JSON string (cards_state) and saves a new one only on the version it was made from. The state holds the dice and
 *  Card Guy's hand, so a client only ever gets playerView and playerEvents of it, never the state itself.
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const crypto = require("crypto");
const {
	newGame,
	applyAction,
	legalActions,
	playerLegal,
	playerView,
	playerEvents,
	actionKey,
	toFen,
	ENGINE_VERSION,
	IllegalAction,
} = require("../../cards-engine/index.js");
const { CARDS, baseKey } = require("../../cards-engine/cards/index.js");
const { readLevel, bestOf } = require("../utils/ai.js");
// Called through the module, not destructured, so tests can swap cardGuy.cardGuyTurn.
const cardGuy = require("../utils/card-guy/index.js");
const { gameOpen, isColor } = require("../utils/games.js");
const { ifSaved, forfeit, newCardsGame: createCardsGame, saveCardsState } = require("../dataClient.js");
const { retrieveGame, currentGame, playerInGame, notYours, notInGame, reply, aiLevel } = require("./chess/index.js");

// Longest action body accepted, as JSON. The longest legal action is under 100 characters.
const ACTION_CHARS = 2000;
// How many times Card Guy is asked again in one call before any legal action is played for him.
// Each ask is a whole turn of thinking, so this caps how long one request can take.
const MAX_REFUSALS = 8;
// Random bytes in a new game's seed.
const SEED_BYTES = 32;
// The largest test seed the engine takes: it must be a whole number that fits in 32 bits.
const MAX_TEST_SEED = 0xFFFFFFFF;
// Card Guy's own dice roll from this range, so his choices never draw on the game's dice.
const CARD_GUY_SEED_RANGE = 2 ** 32;
// Game id -> Card Guy's action being picked and saved (a promise), so parallel /card-guy requests play it once.
const cardGuyTurns = new Map();

/* ---------------------------------------------------------------- */
// New Game (POST)
/* ---------------------------------------------------------------- */
/**
 * @description Creates a card game vs Card Guy for a signed in player. A guest gets 401: Chess Cards isn't open to
 * guests. A player has one AI or card game open at a time: while one is open this answers 409, unless replace_current
 * forfeits it first. When that forfeit fails and a re-read shows the game still open, this answers 503 and creates
 * nothing (a forfeit refused because the game was already over goes on). The seed is 32 random bytes; it is a fixed
 * integer from CARDS_TEST_SEED only while NODE_ENV isn't "production" (tests, a dev server), and never comes from the
 * request.
 * @param  {[object]} req.body [{ start_color ("alternate" | "random" | "w" | "b", anything else is random),
 * ai_level (Card Guy's level, as /api/chess/game), replace_current (true = forfeit the open AI or card game) }]
 * @return {[object]} response [cardsResponse | { status: 401, message } a guest |
 * { status: 409, game_id (the open one), message } | { status: 503, message } the open game couldn't be closed]
 */
async function newCardsGame(req, res) {
	const { ai_level, start_color, replace_current } = req.body || {};
	// Nothing is made and no cookie is set, so a guest's other game stays as it is.
	if (!req.user) { return res.status(401).json({ status: 401, message: "Sign in to play Chess Cards" }); }

	const current = await currentGame(true);
	if (current && !replace_current) {
		return res.status(409).json({ status: 409, game_id: current.game_id.S, message: "AI game already open" });
	}
	// The new game goes on only once the open one is closed: two open AI games would break the one-game limit.
	if (current && !(await closeOpenGame(current.game_id.S))) {
		return res.status(503).json({ status: 503, message: "Your other game couldn't be closed. Try again." });
	}

	const color = isColor(start_color) ? start_color : "random";
	const level = readLevel(ai_level);
	// The data service picks the sides, so the cardGuy set here is a guess: loadCardsGame sets it from the game on every read.
	const state = newGame({ cardGuy: color == "b" ? "w" : "b", level, seed: newSeed() });
	const response = await createCardsGame({ color, level, state: JSON.stringify(state), fen: toFen(state) });
	if (!response.game_data) { return reply(res, { status: response.status, message: response.message }); }

	state.cardGuy = cardGuyOf(response.game_data);
	return res.json(cardsResponse(response.game_data, state));
}

/**
 * @description Forfeits the player's open game so a new one can start. A forfeit that times out may still have landed,
 * and one refused because the game was already over is fine, so when it doesn't answer 200 the stored game decides.
 * When that re-read fails too, the game isn't known to be closed.
 * @param  {[string]} gameId [the open game's id]
 * @return {[boolean]} closed [true when the game is known to be closed]
 */
async function closeOpenGame(gameId) {
	const closed = await forfeit(gameId).catch(nullIfDataServiceDown);
	if (closed?.status == 200) { return true; }

	const stored = await retrieveGame(gameId, true).catch(nullIfDataServiceDown);
	const latest = stored?.game_data;
	return Boolean(latest) && !gameOpen(latest);
}

/**
 * @description Turns a data service 5xx or timeout into null (the answer is unknown); any other error is rethrown
 * @param  {[Error]} err [the data client's error]
 * @return {[null]}
 */
function nullIfDataServiceDown(err) {
	if (err.name != "DataServiceDown") { throw err; }
	return null;
}

/**
 * @description A new game's seed: 32 random bytes as hex. Tests and dev servers may fix it with CARDS_TEST_SEED to get
 * a known deal; production never does, or every game would be the same one.
 * @return {[string|number]} seed
 */
function newSeed() {
	const testSeed = process.env.CARDS_TEST_SEED || "";
	const isFixed = process.env.NODE_ENV !== "production" && /^\d+$/.test(testSeed) && Number(testSeed) <= MAX_TEST_SEED;
	return isFixed ? Number(testSeed) : crypto.randomBytes(SEED_BYTES).toString("hex");
}

/* ---------------------------------------------------------------- */
// Get Game (GET)
/* ---------------------------------------------------------------- */
/**
 * @description The card game as the requester may see it: loading the page, and a reload mid-duel or mid-choice gets
 * it exactly as it was. A finished game from an older engine version opens read-only (see loadCardsGame).
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [cardsResponse | olderResponse]
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
 * @description Plays one of the requester's legal actions (a move, a card, a duel pick, an answer to a choice) on the
 * stored state and saves the new one, only on the version it was read at.
 * @param  {[string]} req.params.gameId [game id]
 * @param  {[object]} req.body [{ action: one of the response's legal }]
 * @return {[object]} response [cardsResponse with the action's events | { status: 400, message } not an action |
 * { status: 409, ...cardsResponse (the fresh game), message } the game is over, the action isn't legal, or another
 * save landed first (stale: true) | { status: 409, game_id, message } a state from an older engine version]
 */
async function playCardsAction(req, res) {
	const action = req.body?.action;
	const isAction = action && typeof action == "object" && !Array.isArray(action);
	if (!isAction || JSON.stringify(action).length > ACTION_CHARS) {
		return res.status(400).json({ status: 400, message: "Invalid action" });
	}

	const game = await loadCardsGame(req, res);
	if (!game) { return; }
	const { gameData, state } = game;
	const you = cardGuy.otherColor(cardGuyOf(gameData));
	if (!gameOpen(gameData)) {
		return res.status(409).json({ ...cardsResponse(gameData, state), status: 409, message: "Game is already over" });
	}

	let next;
	try {
		next = applyAction(state, you, action);
	} catch (err) {
		if (!(err instanceof IllegalAction)) { throw err; }
		return res.status(409).json({ ...cardsResponse(gameData, state), status: 409, message: "That action isn't available" });
	}

	const saved = await saveState(gameData, next.state);
	// Another save of this version landed first (the same action sent twice, a forfeit): answer with the game as it is now.
	if (saved.status == 409) {
		const latest = await loadCardsGame(req, res);
		if (!latest) { return; }
		const body = cardsResponse(latest.gameData, latest.state);
		return res.status(409).json({ ...body, status: 409, stale: true, message: saved.message });
	}
	if (saved.status != 200) { return reply(res, { status: saved.status, message: saved.message }); }
	return res.json(cardsResponse(saved.game_data, next.state, next.events));
}

/* ---------------------------------------------------------------- */
// Card Guy (POST, GET)
/* ---------------------------------------------------------------- */
/**
 * @description Card Guy plays one action he owes (a turn action, the second move of a two-move turn, a choice, a card
 * duel pick) and it's saved; the client only shows it. When Card Guy owes nothing (the player's turn, the game is
 * over) this answers with the game as it is. Parallel requests play the action once and all get it.
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [cardsResponse with the action's events, card_guy_due says whether to call again |
 * cardsResponse (no events) when nothing is owed, or another save landed first]
 */
async function cardGuyCardsTurn(req, res) {
	const game = await loadCardsGame(req, res);
	if (!game) { return; }
	const { gameData, state } = game;
	const gameId = gameData.game_id.S;
	// Nothing owed: Card Guy isn't asked, since he throws when he has no action.
	if (!gameOpen(gameData) || !legalActions(state, cardGuyOf(gameData)).length) {
		return res.json(cardsResponse(gameData, state));
	}

	// The game has one player, so the first request picks the action and later ones wait on it and get the same answer.
	let turn = cardGuyTurns.get(gameId);
	if (!turn) {
		turn = playCardGuyTurn(gameData, state).finally(() => cardGuyTurns.delete(gameId));
		cardGuyTurns.set(gameId, turn);
	}
	return reply(res, await turn);
}

/**
 * @description Picks Card Guy's action from his own view of the game (never the state), plays it on the state and
 * saves it. Under the player's Fog of War the real game can refuse the action (Card Guy guessed the fogged pieces): he
 * is asked again with the action in refused. When he has none left, throws, or was refused MAX_REFUSALS times, a legal
 * action is played all the same (a move when there is one): the game never waits on Card Guy.
 * @param  {[object]} gameData [the stored card game, open]
 * @param  {[object]} state [its engine state, Card Guy owes an action]
 * @return {[object]} body [cardsResponse with the events | cardsResponse of the game as it is now (another save
 * landed first: a forfeit) | { status, message }]
 */
async function playCardGuyTurn(gameData, state) {
	const cardGuyColor = cardGuyOf(gameData);
	const gameId = gameData.game_id.S;
	const view = playerView(state, cardGuyColor);
	const fogged = view.board.hidden > 0;
	const seed = crypto.randomInt(CARD_GUY_SEED_RANGE);
	const refused = [];
	let next = null;
	while (!next && refused.length <= MAX_REFUSALS) {
		let action;
		try {
			// The legal list a player is told, so Card Guy gets no move for a mirage he holds in check.
			const legal = playerLegal(state, cardGuyColor);
			action = await cardGuy.cardGuyTurn(view, state.level, { evaluate: cardGuy.evaluate, bestOf, seed, refused, legal });
			next = applyAction(state, cardGuyColor, action);
		} catch (err) {
			// No action means Card Guy himself threw: there's nothing to refuse, and asking again gives the same.
			if (!action || !(err instanceof IllegalAction)) {
				console.log(`CARD GUY FOUND NO ACTION IN GAME ${gameId}: ${err.message}`);
				break;
			}
			// Only a guessed board can be wrong, so an illegal pick with no fog up is a bug.
			if (!fogged) {
				console.log(`CARD GUY PICKED AN ILLEGAL ACTION WITH NO FOG UP IN GAME ${gameId}: ${JSON.stringify(action)}`);
			}
			refused.push(actionKey(action));
		}
	}
	if (!next) {
		next = applyAction(state, cardGuyColor, anyLegalAction(state, cardGuyColor));
	}

	const saved = await saveState(gameData, next.state);
	// Another save of this version landed first (a forfeit, or a request that read the game before this turn started):
	// answer with the game as it is now.
	if (saved.status == 409) {
		const latest = await retrieveGame(gameId, true);
		if (!latest.game_data) { return { status: latest.status, message: latest.message }; }
		const latestState = JSON.parse(latest.game_data.cards_state.S);
		return cardsResponse(latest.game_data, { ...latestState, cardGuy: cardGuyColor });
	}
	if (saved.status != 200) { return { status: saved.status, message: saved.message }; }
	return cardsResponse(saved.game_data, next.state, next.events);
}

/**
 * @description A random legal action for Card Guy when he couldn't pick one, a move when there is one
 * @param  {[object]} state [the engine state]
 * @param  {[string]} color [Card Guy's colour]
 * @return {[object]} action
 */
function anyLegalAction(state, color) {
	const legal = legalActions(state, color);
	const moves = legal.filter((action) => action.type === "move");
	const choices = moves.length ? moves : legal;
	return choices[crypto.randomInt(choices.length)];
}

/**
 * @description Who the Chess Cards opponent is, for the card game page: only a name. The bot has no avatar, bio or
 * lines.
 * @return {[object]} response [{ name }]
 */
function getCardGuy(req, res) {
	return res.json({ name: "Card Guy" });
}

/* ---------------------------------------------------------------- */
// Helpers
/* ---------------------------------------------------------------- */
/**
 * @description Reads a card game for the requester (a consistent read, so it sees the latest save) and answers the
 * request itself when it can't go on: not their game (401 / 403), not found (404), not a card game (400), or a state
 * from an older engine version (409, with the game_id so the page can offer to forfeit it). On GET a finished game
 * from an older version answers 200 olderResponse instead: its result and final board, read-only.
 * @param  {[object]} req [express request, req.params.gameId]
 * @param  {[object]} res [express response]
 * @return {[object]} game [{ gameData, state }, null when it answered]
 */
async function loadCardsGame(req, res) {
	const response = await retrieveGame(req.params.gameId, true);
	// The data service only shows a game to a player in it.
	if (notYours(response)) {
		notInGame(req, res);
		return null;
	}
	// Game not found.
	if (!response.game_data) {
		reply(res, { status: response.status, message: response.message });
		return null;
	}

	const gameData = response.game_data;
	if (!playerInGame(req, gameData)) {
		notInGame(req, res);
		return null;
	}
	if (gameData.mode?.S != "cards") {
		res.status(400).json({ status: 400, message: "Not a card game" });
		return null;
	}

	const state = JSON.parse(gameData.cards_state.S);
	// A state from another engine version may not fit this engine.
	if (state.v !== ENGINE_VERSION) {
		// Only GET /:gameId shows one, read-only; the action and Card Guy routes keep the 409.
		if (req.method == "GET" && !gameOpen(gameData)) {
			res.json(olderResponse(gameData));
			return null;
		}
		res.status(409).json({ status: 409, game_id: gameData.game_id.S, message: "This game is from an older version" });
		return null;
	}
	// newCardsGame made the state before the data service picked the sides.
	state.cardGuy = cardGuyOf(gameData);
	return { gameData, state };
}

/**
 * @description A finished game from an older engine version, read-only: only what the stored game holds. The engine
 * never reads its state, since it may not fit this engine.
 * @param  {[object]} gameData [the stored card game, closed]
 * @return {[object]} body [{ status: 200, game_id, older: true, you: "w" | "b", fen: game_board,
 * result: { winner: "w" | "b" | null (a draw), reason }, message }]
 */
function olderResponse(gameData) {
	const winner = gameData.winner?.S;
	return {
		status: 200,
		game_id: gameData.game_id.S,
		older: true,
		you: cardGuy.otherColor(cardGuyOf(gameData)),
		// With no stored board the result still opens.
		fen: gameData.game_board?.S ?? null,
		// The data service's "draw" is the engine's null.
		result: { winner: winner == "w" || winner == "b" ? winner : null, reason: gameData.reason?.S || null },
		message: "This game is from an older version",
	};
}

/**
 * @description Saves a state an action made, only on the version the game was read at. A result closes the game in
 * the same write.
 * @param  {[object]} gameData [the stored card game the action was played on]
 * @param  {[object]} state [the state after the action]
 * @return {[object]} response [the data service's { status, game_data, message }, 409 when another save of this
 * version landed first]
 */
function saveState(gameData, state) {
	const gameId = gameData.game_id.S;
	const json = JSON.stringify(state);
	// A winner and reason close the game in the same write. The engine's draw is winner null, the data service's "draw".
	const result = state.result;
	const ended = result ? { winner: result.winner || "draw", reason: result.reason } : {};
	const version = Number(gameData.cards_version.N);
	return ifSaved(() => saveCardsState(gameId, version, json, { fen: boardFen(gameData, state), ...ended }), async () => {
		// The save timed out: it landed if the stored state is this one.
		const latest = await retrieveGame(gameId, true);
		return latest.game_data?.cards_state?.S == json ? latest : null;
	});
}

/**
 * @description The board a save stores as game_board, which the normal game routes and Home's picture show. While
 * Card Guy's Fog of War is up it keeps the stored one, since the real board would show the pieces the fog hides from
 * the player. A finished game hides nothing.
 * @param  {[object]} gameData [the stored card game]
 * @param  {[object]} state [the state being saved]
 * @return {[string]} fen
 */
function boardFen(gameData, state) {
	const fogged = isCardGuyFogUp(state, cardGuyOf(gameData));
	return fogged && !state.result ? gameData.game_board.S : toFen(state);
}

/**
 * @description The body every card route answers with, for the requester (the side that isn't Card Guy)
 * @param  {[object]} gameData [the stored card game]
 * @param  {[object]} state [its engine state]
 * @param  {[array]} events [the action's events, left out = none]
 * @return {[object]} body [{ status, game_id, mode: "cards", ai_level, you: "w" | "b", view: playerView,
 * legal: the requester's legal actions as playerLegal tells them ([] once it's over),
 * legal_hidden: Card Guy's Fog of War is up, so legal leaves out the moves (any legal action is still taken),
 * events: playerEvents, card_guy_due: Card Guy owes an action (his turn, or a duel pick or a choice),
 * result: { winner, reason } | null (a forfeit's comes from the game, the state doesn't have it),
 * catalog: { [card key]: { name, kind, text, skulls, rarity } } for every card key in view and events, what the
 * table's card faces show (a version: its base card's name) }]
 */
function cardsResponse(gameData, state, events = []) {
	const cardGuyColor = cardGuyOf(gameData);
	const you = cardGuy.otherColor(cardGuyColor);
	const open = gameOpen(gameData);
	const result = state.result || (open ? null : { winner: gameData.winner?.S || null, reason: gameData.reason?.S || null });
	// A forfeit leaves the state without a result: a finished game's view and events hide nothing.
	const shown = result && !state.result ? { ...state, result } : state;
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
		legal_hidden: open && isCardGuyFogUp(state, cardGuyColor),
		events: seen,
		card_guy_due: open && legalActions(state, cardGuyColor).length > 0,
		result,
		catalog: catalogOf([view, seen]),
	};
}

/**
 * @description The face of every card key that appears anywhere in what the response sends (any string equal to a
 * registered key: a card's key, a choice's curse option, a pending choice's card), so the browser loads no engine
 * code. Only keys the response already shows, so it tells the player nothing new.
 * @param  {[object]} shown [what the response sends]
 * @return {[object]} catalog [{ [key]: { name, kind, text, skulls, rarity } }]
 */
function catalogOf(shown) {
	const catalog = {};
	// JSON.stringify visits every nested value, which finds the keys wherever they sit.
	JSON.stringify(shown, (key, value) => {
		if (typeof value === "string" && Object.hasOwn(CARDS, value) && !catalog[value]) {
			const card = CARDS[value];
			catalog[value] = { name: CARDS[baseKey(value)].name, kind: card.kind, text: card.text, skulls: card.skulls, rarity: card.rarity };
		}
		return value;
	});
	return catalog;
}

/**
 * @description Whether Card Guy's Fog of War (any version of the card) is up
 * @param  {[object]} state [the engine state]
 * @param  {[string]} cardGuyColor [Card Guy's colour]
 * @return {[boolean]}
 */
function isCardGuyFogUp(state, cardGuyColor) {
	return state.enchant.some((enchant) => baseKey(enchant.key) === "fog-of-war" && enchant.owner === cardGuyColor);
}

/**
 * @description Card Guy's colour: he plays as CHESS_AI
 * @param  {[object]} gameData [the stored card game]
 * @return {[string]} color ["w" | "b"]
 */
function cardGuyOf(gameData) {
	return gameData.white_player_id.S == "CHESS_AI" ? "w" : "b";
}


module.exports = { newCardsGame, getCardsGame, playCardsAction, cardGuyCardsTurn, getCardGuy };
