/*
 *  pgn.js  --  chess server
 *	PGN Export
 *  Writes a saved game as a PGN file, so it can be opened in other chess apps: the saved moves are replayed & chess.js writes them
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { Chess } = require("chess.js");
const { isAiGame, playerName, startParams } = require("./games.js");

const RESULTS = { w: "1-0", b: "0-1", draw: "1/2-1/2" };
const UNKNOWN_DATE = "????.??.??"; // GAMES FROM BEFORE created_at
const UNKNOWN_NAME = "?"; // FRIEND GAMES FROM BEFORE THE NAMES WERE SAVED

/* ---------------------------------------------------------------- */
// Headers
/* ---------------------------------------------------------------- */
/**
 * @description A header value that can't break its line: chess.js writes it between quotes as it is, & some PGN readers (chess.js too) refuse an escaped quote
 * @param  {[string]} value
 * @return {[string]} value [no double quotes, backslashes or line breaks]
 */
function headerValue(value) {
	return String(value).replace(/"/g, "'").replace(/\\/g, "").replace(/\s+/g, " ").trim();
}

/**
 * @description The Date header
 * @param  {[string]} createdAt [the game's created_at, left out on older games]
 * @return {[string]} date ["YYYY.MM.DD" in UTC or "????.??.??"]
 */
function pgnDate(createdAt) {
	const date = new Date(createdAt);
	return isNaN(date) ? UNKNOWN_DATE : date.toISOString().slice(0, 10).replace(/-/g, ".");
}

/**
 * @description The Result header
 * @param  {[object]} gameData [game item]
 * @return {[string]} result ["1-0", "0-1", "1/2-1/2", or "*" while the game isn't finished]
 */
function pgnResult(gameData) {
	return (gameData.state?.S == "CLOSED" && RESULTS[gameData.winner?.S]) || "*";
}

/**
 * @description A side's name: the AI's level, the player of an AI game, or a friend game's saved name
 * @param  {[object]} gameData [game item]
 * @param  {[string]} color ["w" or "b"]
 * @param  {[object]} names [{ aiLevel, player: the name of an AI game's player }]
 * @return {[string]} name
 */
function sideName(gameData, color, { aiLevel, player }) {
	if (!isAiGame(gameData)) { return playerName(gameData, color) || UNKNOWN_NAME; }
	const playerId = color == "w" ? gameData.white_player_id.S : gameData.black_player_id.S;
	return playerId == "CHESS_AI" ? `Stockfish level ${aiLevel}` : player;
}

/* ---------------------------------------------------------------- */
// File
/* ---------------------------------------------------------------- */
/**
 * @description Part of the file's name: letters, numbers, _ & - only
 * @param  {[string]} name [a side's name]
 * @param  {[string]} fallback [when nothing is left of the name]
 * @return {[string]} part
 */
function fileNamePart(name, fallback) {
	return name.replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "") || fallback;
}

/**
 * @description The game as a PGN file. Replays from the game's set position when it has one, chess.js then adds the SetUp & FEN headers
 * @param  {[object]} gameData [game item, moves.S is the parsed array of SAN moves]
 * @param  {[object]} options [{ site: the live url, aiLevel, player: the name of an AI game's player }]
 * @return {[object]} file [{ pgn, filename: "<white>-vs-<black>.pgn" }]
 * @throws when a saved move can't be replayed
 */
function buildPgn(gameData, { site, aiLevel, player }) {
	const fen = startParams(gameData).fen;
	const chess = fen ? new Chess(fen) : new Chess();
	for (const move of gameData.moves.S) { chess.move(move); }

	const white = headerValue(sideName(gameData, "w", { aiLevel, player }));
	const black = headerValue(sideName(gameData, "b", { aiLevel, player }));
	const headers = {
		Event: isAiGame(gameData) ? "AI Game" : "Friend Game",
		Site: site,
		Date: pgnDate(gameData.created_at?.S),
		White: white,
		Black: black,
		Result: pgnResult(gameData),
		Termination: gameData.reason?.S || "unterminated",
	};
	for (const [name, value] of Object.entries(headers)) { chess.setHeader(name, value); }

	return { pgn: chess.pgn(), filename: `${fileNamePart(white, "white")}-vs-${fileNamePart(black, "black")}.pgn` };
}

module.exports = { buildPgn };
