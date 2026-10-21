/*
 *  ai.js  --  chess server
 *	AI Moves
 *  The AI's moves are picked here instead of in the browser, so a player can't choose the AI's moves or change its level mid game.
 *  Each level asks the Stockfish engine API (chess-engine-api) for a move. If it's down, js-chess-engine plays instead (like the client used to).
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { Chess } = require("chess.js");
const { aiMove: jsChessEngineMove } = require("js-chess-engine");
const config = require("../config");

const ENGINE_WAIT = 5000; // EXTRA TIME FOR THE ENGINE'S QUEUE BEFORE GIVING UP ON IT (ms)

// elo: SHOWN ON HOME. THE uci_elo LEVELS SHOW STOCKFISH'S OWN RATING, LEVELS 1-2 & 8 WERE MEASURED (README)
// random: CHANCE OF A RANDOM LEGAL MOVE INSTEAD OF STOCKFISH'S
// skill: STOCKFISH Skill Level 0-20 | uci_elo: STOCKFISH UCI_Elo 1320-3190 (TURNED INTO A SKILL LEVEL BY STOCKFISH)
// depth: STOCKFISH PICKS A SKILL / ELO MOVE AT DEPTH 1 + SKILL LEVEL, SO THE SEARCH STOPS THERE INSTEAD OF USING ALL OF time
// time: MOST TIME THE ENGINE CAN THINK (ms)
const LEVELS = [
	{ level: 1, elo: "≈750", random: 0.4, skill: 0, depth: 1, time: 1000 },
	{ level: 2, elo: "≈1100", random: 0.15, skill: 0, depth: 1, time: 1000 },
	{ level: 3, elo: "≈1320", uci_elo: 1320, depth: 1, time: 1000 },
	{ level: 4, elo: "≈1600", uci_elo: 1600, depth: 3, time: 1000 },
	{ level: 5, elo: "≈1900", uci_elo: 1900, depth: 4, time: 1000 },
	{ level: 6, elo: "≈2200", uci_elo: 2200, depth: 6, time: 1000 },
	{ level: 7, elo: "≈2600", uci_elo: 2600, depth: 8, time: 1000 },
	{ level: 8, elo: "≈3300", depth: 20, time: 2000 }, // FULL STRENGTH
];
const DEFAULT_LEVEL = 3;

/* ---------------------------------------------------------------- */
// Levels
/* ---------------------------------------------------------------- */
/**
 * @description The levels for the Home dropdown
 * @return {[object]} { levels: [{ level, elo }], default_level }
 */
function levelList() {
	return { levels: LEVELS.map(({ level, elo }) => ({ level, elo })), default_level: DEFAULT_LEVEL };
}

/**
 * @description Turns a requested level into a real one, anything else gets the default
 * @param  {[any]} value [level from the request body or the game item]
 * @return {[number]} level
 */
function readLevel(value) {
	const level = Number(value);
	return LEVELS.some((settings) => settings.level == level) ? level : DEFAULT_LEVEL;
}

/* ---------------------------------------------------------------- */
// AI Move
/* ---------------------------------------------------------------- */
/**
 * @description Picks the AI's move for a board at a level
 * @param  {[string]} fen [game board, the AI is the side to move]
 * @param  {[number]} level [game's ai_level]
 * @return {[object]} move [{ from, to, promotion }]
 */
async function aiMove(fen, level) {
	const settings = LEVELS.find((levelSettings) => levelSettings.level == readLevel(level));

	if (settings.random && Math.random() < settings.random) { // LOW LEVELS: SOMETIMES A RANDOM MOVE
		const moves = new Chess(fen).moves({ verbose: true });
		const move = moves[Math.floor(Math.random() * moves.length)];
		return { from: move.from, to: move.to, promotion: move.promotion };
	}

	try {
		return await stockfishMove(fen, settings);
	} catch (err) {
		console.log(`STOCKFISH FAILED, js-chess-engine PLAYS INSTEAD: ${err.message}`);
		return backupMove(fen);
	}
}

/**
 * @description Asks the engine API for a move
 * @param  {[string]} fen [game board]
 * @param  {[object]} settings [level from LEVELS]
 * @return {[object]} move [{ from, to, promotion }]
 */
async function stockfishMove(fen, settings) {
	const body = { fen, depth: settings.depth, maxThinkingTime: settings.time };
	if (settings.uci_elo) { body.elo = settings.uci_elo; }
	if (settings.skill != undefined) { body.skillLevel = settings.skill; }

	const res = await fetch(config.engineUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(settings.time + ENGINE_WAIT),
	});
	const data = await res.json();
	if (data.type != "bestmove") { throw new Error(data.text || `Engine answered ${res.status}`); } // ERRORS COME BACK AS { type: "info", text }
	return { from: data.from, to: data.to, promotion: data.promotion };
}

/**
 * @description js-chess-engine level 1, it always promotes to a queen
 * @param  {[string]} fen [game board]
 * @return {[object]} move [{ from, to, promotion }]
 */
function backupMove(fen) {
	const [from, to] = Object.entries(jsChessEngineMove(fen, 1))[0].map((square) => square.toLowerCase()); // { E2: "E4" }
	const piece = new Chess(fen).get(from);
	const promotion = piece.type == "p" && (to[1] == "8" || to[1] == "1") ? "q" : undefined;
	return { from, to, promotion };
}


module.exports = { levelList, readLevel, aiMove }
