/*
 *  data.js  --  chess frontend
 *	Monitor Data
 *	The pure part of what the game gives the 3D room's monitor (gameplay/monitor/index.js): the actions read from the menu's items, the result line
 *	& the eval scores kept by ply (gameplay/analysis). No DOM & no process.env here, so the tests load it in Node (client/test/monitorData.test.js)
 *
 */

const ACTION_IDS = ["hint", "takeback", "draw", "restart", "pgn"]; // THE MONITOR'S ACTIONS, IN ITS ORDER (THE MENU'S optHint, optTakeback, optDraw, optRestart, optPgn)

/* ---------------------------------------------------------------- */
// Actions
/* ---------------------------------------------------------------- */
/**
 * @description The monitor's actions from the menu's items, so the rules for when each one shows stay in the menu code
 * @param  {[object]} items [{ hint: { hidden, unavailable, text }, takeback, draw, restart, pgn }, hidden: its <li> is hidden, unavailable: aria-disabled or busy]
 * @return {[array]} actions [{ id, label, shown, enabled }, label in capitals (the pixel font has no lower case)]
 */
function actionsFrom(items) {
	return ACTION_IDS.map(function (id) {
		const item = items[id];
		const shown = Boolean(item) && !item.hidden; // A MISSING ITEM IS A HIDDEN ONE
		return { id, label: String(item?.text || "").trim().toUpperCase(), shown, enabled: shown && !item.unavailable };
	});
}

/* ---------------------------------------------------------------- */
// Result
/* ---------------------------------------------------------------- */
/**
 * @description The result line, as the menu's title & the line under it read
 * @param  {[string]} title ["White Wins!", "Draw", ...]
 * @param  {[string]} reason ["by Checkmate", "" ...]
 * @return {[string]} result ["WHITE WINS! BY CHECKMATE"]
 */
function resultText(title, reason) {
	return `${title || ""} ${reason || ""}`.trim().toUpperCase();
}

/* ---------------------------------------------------------------- */
// Eval Scores
/* ---------------------------------------------------------------- */
/**
 * @description How many moves were played to reach a board, counted from the standard start (a set position starts past 0)
 * @param  {[string]} fen [the board]
 * @return {[number]} ply [0 at the start, 1 after White's first move, ...]
 */
function plyOf(fen) {
	const [, turn, , , , fullMove] = String(fen || "").split(" ");
	return Math.max(0, ((Number(fullMove) || 1) - 1) * 2 + (turn === "b" ? 1 : 0));
}

/**
 * @description The game's start position's ply. Only GET /game/:gameId sends start_params, a move's answer has none, so the one known is kept
 * @param  {[number]} previous [the start ply known so far, 0 for a new game]
 * @param  {[object]} response [a game from the server]
 * @return {[number]} ply [plyOf() the start's FEN, 0 for the standard start]
 */
function startPlyFor(previous, response) {
	return response?.start_params ? plyOf(response.start_params.fen) : previous;
}

/**
 * @description The scores up to the board's last ply: a takeback or a new game drops what is past it, a ply without a score is null
 * @param  {[array]} scores [White's win chance by ply (0 - 100), index 0 = the start]
 * @param  {[number]} plies [the moves played on the latest board]
 * @return {[array]} scores [plies + 1 long, (number | null)]
 */
function trimScores(scores, plies) {
	return Array.from({ length: Math.max(0, plies) + 1 }, (_, i) => (typeof scores[i] === "number" ? scores[i] : null));
}

module.exports = { actionsFrom, resultText, plyOf, startPlyFor, trimScores };
