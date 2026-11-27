/*
 *  game.new.js  --  data service
 *	Game Routes: new games vs the AI
 *  A signed in player's AI game, a guest's AI game, and a Chess Cards game. Each checks its body, picks the sides,
 *  and saves the game through initializeGame
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { initializeGame, retrieveGame, saveLastColor } = require("../../db/index.js");
const { validateFen } = require("chess.js");
const {
	playerInGame, playerColor, newStartParams, pickSides, readAiLevel, isId, newGameId, DEFAULT_LEVEL,
} = require("../../utils/games.js");
const { refuse } = require("../../utils/refuse.js");
const { guestToken } = require("../../utils/tokens.js");
const gameShared = require("./game.shared.js");

/* ---------------------------------------------------------------- */
// New AI Game (POST)
/* ---------------------------------------------------------------- */
/**
 * @description A signed in player's new game vs the AI: they're one side & CHESS_AI the other, at a real level, from the standard position
 * or a checked set position. The game id is always made here, the response has it (a signed in player's Restart is a forfeit & a new game).
 * One AI game at a time stays on the chess server, it forfeits the open one first
 * @param  {[object]} req.body [{ color ("w" | "b" | "random" | "alternate"), level (600 - 3200 in steps of 100, left out = 1300),
 * start_fen (optional) }]
 * @return {[object]} response [initializeGame's { status, game_data (game_id is the new id), message }]
 */
async function newAiGame(req, res) {
	if (req.player.guest) { return refuse(req, res, 403, "Guests make games with /games/guest"); }
	const { color, level, start_fen } = req.body || {};
	const aiLevel = readAiLevel(level);
	if (!aiLevel) { return refuse(req, res, 400, "Invalid level"); }
	const position = gameShared.readStartFen(start_fen);
	if (position.message) { return refuse(req, res, 400, position.message); }

	const params = newStartParams(color, position.fen);
	// Random is drawn here
	const sides = pickSides(params, req.player.id, "CHESS_AI", await gameShared.lastColor(params, req.player.id, true));
	const response = await initializeGame(false, sides.white, sides.black, aiLevel, { start_params: params });
	if (response.game_data) { await saveLastColor(req.player.id, true, playerColor(req.player.id, response.game_data)); }
	return gameShared.created(req, res, response);
}

/* ---------------------------------------------------------------- */
// New Guest Game (POST)
/* ---------------------------------------------------------------- */
/**
 * @description A guest's game vs the AI. A guest's player id is their game's id, so the game they name is overwritten only when it's
 * their own (their cookie): New game & Restart. Any other id they can't have (another browser's game, a signed in player's, "CHESS_AI")
 * gets a new id, and that game isn't touched (also when another create of the id saved since the read). The response has the guest's
 * token for that id (guest_token), the chess server sets it as their cookie
 * @param  {[object]} req.body [{ game_id (the guest's saved id, left out = a new one), color (saved for Restart), side ("w" | "b",
 * optional: this game's side, the play page's fallback for a guest's first game is white & random from its restarts on),
 * level (left out = their game's, or 3), start_fen }]
 * @return {[object]} response [initializeGame's { status, game_data (game_id is the id used), message } & guest_token
 * (the guest_game cookie)]
 */
async function newGuestGame(req, res) {
	if (req.player && !req.player.guest) { return refuse(req, res, 403, "Signed in players make games with /games/ai"); }
	const { game_id, color, side, level, start_fen } = req.body || {};
	if (game_id !== undefined && typeof game_id != "string") { return refuse(req, res, 400, "Invalid game id"); }
	if (side !== undefined && side != "w" && side != "b") { return refuse(req, res, 400, "Invalid side"); }
	if (level !== undefined && !readAiLevel(level)) { return refuse(req, res, 400, "Invalid level"); }
	const position = gameShared.readStartFen(start_fen);
	if (position.message) { return refuse(req, res, 400, position.message); }

	let gameId = isId(game_id) ? game_id : newGameId();
	let existing = (await retrieveGame(gameId, true)).game_data;
	// Not their game: a new one with a new id
	if (existing && !playerInGame(req.player, existing)) {
		gameId = newGameId();
		existing = null;
	}

	// A reset keeps the level
	const aiLevel = level === undefined && existing ? readAiLevel(Number(existing.ai_level?.N)) || DEFAULT_LEVEL : readAiLevel(level);
	const params = newStartParams(color, position.fen);
	// A guest's player id is their game id, and their last game is the one this resets
	const lastSide = existing ? playerColor(gameId, existing) : undefined;
	const sides = pickSides(side ? { color: side } : params, gameId, "CHESS_AI", lastSide);
	// A reset only replaces their own game
	const resetPlayer = existing ? gameId : undefined;
	let response = await initializeGame(gameId, sides.white, sides.black, aiLevel, { start_params: params, reset_player: resetPlayer });
	// Another create of this id saved since the read: a new id, like one that isn't theirs
	if (response.status == 409) {
		gameId = newGameId();
		const newSides = pickSides(side ? { color: side } : params, gameId, "CHESS_AI");
		response = await initializeGame(gameId, newSides.white, newSides.black, aiLevel, { start_params: params });
	}
	// Only signed for the game just saved, the chess server sets it as the guest_game cookie
	if (response.game_data) { response.guest_token = guestToken(gameId, req.player?.session); }
	return res.json(response);
}

/* ---------------------------------------------------------------- */
// New Card Game (POST)
/* ---------------------------------------------------------------- */
/**
 * @description A Chess Cards game vs the AI (Card Guy) for a signed in player or a guest. The chess server made the engine's start state,
 * it's stored as sent & never run here. A signed in player's game gets a new id like /games/ai, a guest's a new id & their guest token
 * for it like /games/guest with no game_id
 * @param  {[object]} req.body [{ color ("w" | "b" | "random" | "alternate"), level (like /games/ai, left out = 1300), state (the engine's
 * state, a JSON string), fen (its board) }]
 * @return {[object]} response [initializeGame's { status, game_data (cards_version 1), message }, guest_token for a guest]
 */
async function newCardsGame(req, res) {
	const { color, level, state, fen } = req.body || {};
	const aiLevel = readAiLevel(level);
	if (!aiLevel) { return refuse(req, res, 400, "Invalid level"); }
	if (!gameShared.isCardsState(state)) { return refuse(req, res, 400, "Invalid state"); }
	// A new game's board is a real position
	if (typeof fen != "string" || !validateFen(fen).ok) { return refuse(req, res, 400, "Invalid FEN"); }

	const params = newStartParams(color, false);
	const cards = { state, fen };
	// A guest's player id is their game id
	if (!req.player || req.player.guest) {
		const gameId = newGameId();
		const sides = pickSides(params, gameId, "CHESS_AI");
		const response = await initializeGame(gameId, sides.white, sides.black, aiLevel, { start_params: params, cards });
		// The chess server sets it as the guest_game cookie
		if (response.game_data) { response.guest_token = guestToken(gameId, req.player?.session); }
		return gameShared.created(req, res, response);
	}
	const sides = pickSides(params, req.player.id, "CHESS_AI", await gameShared.lastColor(params, req.player.id, true));
	const response = await initializeGame(false, sides.white, sides.black, aiLevel, { start_params: params, cards });
	if (response.game_data) { await saveLastColor(req.player.id, true, playerColor(req.player.id, response.game_data)); }
	return gameShared.created(req, res, response);
}


module.exports = { newAiGame, newGuestGame, newCardsGame };
