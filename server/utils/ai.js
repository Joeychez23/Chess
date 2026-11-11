/*
 *  ai.js  --  chess server
 *	AI Moves
 *  The AI's moves are picked here instead of in the browser, so a player can't choose the AI's moves or change its level mid game.
 *  Each level asks the Stockfish engine API (chess-engine-api) for a move, the levels are 100 Elo apart. If it's down, js-chess-engine plays instead (like the client used to).
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { Chess } = require("chess.js");
const { aiMove: jsChessEngineMove } = require("js-chess-engine");
const config = require("../config");

const ENGINE_WAIT = 5000; // EXTRA TIME FOR THE ENGINE'S QUEUE BEFORE GIVING UP ON IT (ms)

// THE LEVELS ARE THEIR ELO, 600 TO 3200 IN STEPS OF 100 (server/README.md -> AI levels). level IS SAVED ON THE GAME (ai_level) | elo: SHOWN ON HOME
// notice (UNDER STOCKFISH'S LOWEST UCI_Elo): THE CHANCE THE LEVEL SEES EACH LEGAL MOVE, IT PLAYS THE BEST ONE IT SAW. SO IT LOSES BY OVERLOOKING MOVES, NOT BY RANDOM ONES. MEASURED WITH GAMES
// uci_elo: STOCKFISH UCI_Elo 1320-3190 (TURNED INTO A SKILL LEVEL BY STOCKFISH), THE ONE THAT PLAYS AT THE LEVEL'S ELO (ENGINE_ELO)
// depth: STOCKFISH PICKS AN ELO MOVE AT DEPTH 1 + ITS SKILL LEVEL (A WHOLE NUMBER), SO LEVELS 100 ELO APART OFTEN SHARE A DEPTH & THEN JUMP ONE. HERE THE DEPTH IS THE SKILL LEVEL + 0.5
// WITH ITS FRACTION KEPT: 2.7 IS DEPTH 3 FOR 70% OF THE MOVES & DEPTH 2 FOR THE REST (A SEARCH STOPPED BEFORE STOCKFISH'S DEPTH PICKS THERE), WHICH EVENS OUT THE STEPS
// time: MOST TIME THE ENGINE CAN THINK (ms)
const STEP = 100;
const LOWEST = 600;
const FULL_STRENGTH = 3200;
const UCI_ELO = { lowest: 1320, highest: 3190 }; // Skill::LowestElo & HighestElo (stockfish/src/search.h)
const NOTICE = { 600: 0.112, 700: 0.13, 800: 0.1485, 900: 0.171, 1000: 0.2, 1100: 0.23, 1200: 0.263 }; // FROM scripts/measureLevels.js calibrate, ON STOCKFISH 19
// THE UCI_Elo THAT PLAYS AT EACH LEVEL. STOCKFISH'S RATINGS AREN'T 100 APART IN GAMES AT THESE DEPTHS: MEASURED ON STOCKFISH 19 (scripts/measureLevels.js), 100 OF UCI_Elo IS
// ABOUT 65 FROM 1600 TO 2600 & ABOUT 130 PAST IT, AND ITS FIRST STEPS ARE UNEVEN (1400 PLAYS LIKE 1320). SO EACH LEVEL TAKES THE UCI_Elo ON THAT MEASURED LINE
const ENGINE_ELO = {
	1300: 1320, 1400: 1430, 1500: 1462, 1600: 1550, 1700: 1654, 1800: 1808, 1900: 1962, 2000: 2115, 2100: 2269, 2200: 2423,
	2300: 2577, 2400: 2666, 2500: 2745, 2600: 2823, 2700: 2901, 2800: 2979, 2900: 3057, 3000: 3135, 3100: 3190,
};
const STANDS_OUT = 3; // A CAPTURE, CHECK OR PROMOTION IS THIS MANY TIMES AS LIKELY TO BE SEEN
const LEVELS = [];
for (let elo = LOWEST; elo <= FULL_STRENGTH; elo += STEP) {
	if (NOTICE[elo]) {
		LEVELS.push({ level: elo, elo: `≈${elo}`, notice: NOTICE[elo], depth: 1, time: 1000 });
	} else if (elo < FULL_STRENGTH) {
		LEVELS.push({ level: elo, elo: `≈${elo}`, ...eloSettings(ENGINE_ELO[elo]) });
	} else {
		LEVELS.push({ level: elo, elo: `${elo}+`, depth: 20, time: 2000 }); // FULL STRENGTH
	}
}
const DEFAULT_LEVEL = 1300;
const OLD_LEVELS = { 1: 800, 2: 1100, 3: 1300, 4: 1600, 5: 1900, 6: 2200, 7: 2600, 8: 3200 }; // GAMES & SETTINGS SAVED WHEN THERE WERE 8 LEVELS -> THE CLOSEST ONE NOW
const DRAW_CHECK = { depth: 12, time: 1000 }; // A DRAW OFFER IS JUDGED AT FULL STRENGTH WHATEVER THE LEVEL (A SKILL LEVEL'S WEAKER PICK COMES WITHOUT A SCORE)
const ANALYSIS = { depth: 12, time: 800 }; // HINTS & THE EVALUATION BAR: LOW, ONLY 2 ENGINES RUN & OTHER PLAYERS' AI MOVES WAIT BEHIND THESE
const MAX_ANALYSES = 5000; // POSITIONS KEPT, THE ONE UNUSED THE LONGEST IS DROPPED FIRST
const analyses = new Map(); // FEN -> THE ANSWER (A PROMISE), THE SAME POSITION NEVER ASKS THE ENGINE TWICE

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
 * @description Turns a requested level into a real one, anything else gets the default. The 8 levels from before (1 - 8) become the closest of today's
 * @param  {[any]} value [level from the request body, the game item or the saved settings]
 * @return {[number]} level
 */
function readLevel(value) {
	const level = Object.hasOwn(OLD_LEVELS, value) ? OLD_LEVELS[value] : Number(value);
	return LEVELS.some((settings) => settings.level == level) ? level : DEFAULT_LEVEL;
}

/**
 * @description A level's engine settings (the level measuring script plays them)
 * @param  {[any]} level [as readLevel]
 * @return {[object]} settings [from LEVELS]
 */
function levelSettings(level) {
	return LEVELS.find((settings) => settings.level == readLevel(level));
}

/**
 * @description The engine settings that play at a UCI_Elo (the level measuring script plays ones that aren't levels)
 * @param  {[number]} uci_elo [1320 - 3190]
 * @return {[object]} settings [{ uci_elo, depth, time }]
 */
function eloSettings(uci_elo) {
	return { uci_elo, depth: Math.max(1, skillLevel(uci_elo) + 0.5), time: uci_elo <= 2600 ? 1000 : 2000 };
}

/**
 * @description Stockfish's skill level (0 - 19) for a UCI_Elo, the same fit as Skill in stockfish/src/search.h. It picks its move at depth 1 + this
 * @param  {[number]} elo [UCI_Elo, 1320 - 3190]
 * @return {[number]} skill
 */
function skillLevel(elo) {
	const e = (elo - UCI_ELO.lowest) / (UCI_ELO.highest - UCI_ELO.lowest);
	return Math.min(19, Math.max(0, ((37.2473 * e - 40.8525) * e + 22.2943) * e - 0.311438));
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
	return pickMove(fen, levelSettings(level));
}

/**
 * @description Picks a move with a level's settings (the level measuring script plays settings that aren't levels yet)
 * @param  {[string]} fen [game board]
 * @param  {[object]} settings [level from LEVELS]
 * @return {[object]} move [{ from, to, promotion }]
 */
async function pickMove(fen, settings) {
	try {
		return settings.notice ? await noticedMove(fen, settings) : await stockfishMove(fen, settings);
	} catch (err) {
		console.log(`STOCKFISH FAILED, js-chess-engine PLAYS INSTEAD: ${err.message}`); // THE LINE MUST START WITH THIS: AN ALARM MATCHES IT (terraform/modules/monitoring)
		return backupMove(fen);
	}
}

/**
 * @description The low levels: each legal move is seen with the level's notice chance (captures, checks & promotions stand out),
 * and Stockfish plays the best of the moves that were seen. With one move seen there's nothing to ask
 * @param  {[string]} fen [game board]
 * @param  {[object]} settings [level from LEVELS, with notice]
 * @return {[object]} move [{ from, to, promotion }]
 */
async function noticedMove(fen, settings) {
	const moves = new Chess(fen).moves({ verbose: true });
	let seen = moves.filter((move) => Math.random() < settings.notice * (move.captured || move.promotion || /[+#]/.test(move.san) ? STANDS_OUT : 1));
	if (!seen.length) { seen = [moves[Math.floor(Math.random() * moves.length)]]; } // IT ALWAYS SEES ONE
	if (seen.length == 1) { return { from: seen[0].from, to: seen[0].to, promotion: seen[0].promotion }; }
	return stockfishMove(fen, { ...settings, searchmoves: seen.map((move) => move.lan).join(" ") });
}

/**
 * @description Asks the engine API for a move
 * @param  {[string]} fen [game board]
 * @param  {[object]} settings [level from LEVELS]
 * @return {[object]} move [{ from, to, promotion }]
 */
async function stockfishMove(fen, settings) {
	const data = await askEngine(fen, settings);
	return { from: data.from, to: data.to, promotion: data.promotion };
}

/**
 * @description Asks the engine API about a board
 * @param  {[string]} fen [game board]
 * @param  {[object]} settings [level from LEVELS, DRAW_CHECK or ANALYSIS]
 * @return {[object]} data [the engine's bestmove answer: { from, to, promotion, eval, winChance, ... }]
 */
async function askEngine(fen, settings) {
	const body = { fen, depth: Math.floor(settings.depth) + (Math.random() < settings.depth % 1 ? 1 : 0), maxThinkingTime: settings.time }; // A DEPTH'S FRACTION IS THE CHANCE OF ONE MORE (LEVELS)
	if (settings.uci_elo) { body.elo = settings.uci_elo; }
	if (settings.searchmoves) { body.searchmoves = settings.searchmoves; } // ONLY THESE MOVES ARE SEARCHED

	const res = await fetch(config.engineUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(settings.time + ENGINE_WAIT),
	});
	const data = await res.json();
	if (data.type != "bestmove") { throw new Error(data.text || `Engine answered ${res.status}`); } // ERRORS COME BACK AS { type: "info", text }
	return data;
}

/* ---------------------------------------------------------------- */
// Draw Offers
/* ---------------------------------------------------------------- */
/**
 * @description Whether the AI takes a draw: when it isn't ahead, its win chance is 50% or less. With no evaluation (the engine is down) it plays on
 * @param  {[string]} fen [game board]
 * @param  {[string]} aiColor ["w" or "b"]
 * @return {[boolean]} accepts
 */
async function aiAcceptsDraw(fen, aiColor) {
	try {
		const { winChance } = await askEngine(fen, DRAW_CHECK);
		if (typeof winChance != "number") { throw new Error("Engine sent no win chance"); }
		return (aiColor == "w" ? winChance : 100 - winChance) <= 50; // winChance IS FROM WHITE'S SIDE
	} catch (err) {
		console.log(`STOCKFISH FAILED, THE AI DECLINES THE DRAW: ${err.message}`); // THE LINE MUST START WITH THIS: AN ALARM MATCHES IT (terraform/modules/monitoring)
		return false;
	}
}

/* ---------------------------------------------------------------- */
// Analysis
/* ---------------------------------------------------------------- */
/**
 * @description The best move & the evaluation for a board at full strength, for hints & the evaluation bar. Cached by FEN, failures aren't kept. Throws when the engine can't answer
 * @param  {[string]} fen [game board]
 * @return {[object]} analysis [{ from, to, eval, mate, winChance } from White's side, from & to are null when the game can't go on]
 */
function analyzePosition(fen) {
	let answer = analyses.get(fen);
	if (answer) {
		analyses.delete(fen); // USED: IT GOES TO THE END, THE MAP KEEPS THE ORDER KEYS WERE ADDED
	} else {
		answer = askAnalysis(fen);
		answer.catch(() => analyses.delete(fen));
		if (analyses.size >= MAX_ANALYSES) { analyses.delete(analyses.keys().next().value); }
	}
	analyses.set(fen, answer);
	return answer;
}

/**
 * @description Asks the engine about a board. A checkmate or stalemate has nothing to search
 * @param  {[string]} fen [game board]
 * @return {[object]} analysis [see analyzePosition]
 */
async function askAnalysis(fen) {
	const board = new Chess(fen);
	if (board.isCheckmate()) {
		const whiteLost = board.turn() == "w";
		return { from: null, to: null, eval: whiteLost ? -100 : 100, mate: 0, winChance: whiteLost ? 0 : 100 };
	}
	if (board.isStalemate()) { return { from: null, to: null, eval: 0, mate: null, winChance: 50 }; }

	const data = await askEngine(fen, ANALYSIS);
	if (typeof data.winChance != "number") { throw new Error("Engine sent no win chance"); }
	if (!board.moves({ verbose: true }).some((move) => move.from == data.from && move.to == data.to)) { throw new Error(`Engine sent an illegal move: ${data.from}-${data.to}`); }
	return { from: data.from, to: data.to, eval: data.eval ?? null, mate: data.mate ?? null, winChance: data.winChance };
}

/**
 * @description Forgets the cached positions (between tests)
 */
function clearAnalyses() {
	analyses.clear();
}

/**
 * @description The health check (utils/health.js): a real search of the start position, so a running API with a broken Stockfish fails it.
 * Throws when the engine can't answer, the same answers that make aiMove fall back to js-chess-engine
 */
function checkEngine() {
	return stockfishMove(new Chess().fen(), { depth: 1, time: 100 });
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


module.exports = { levelList, readLevel, levelSettings, eloSettings, aiMove, pickMove, aiAcceptsDraw, analyzePosition, clearAnalyses, checkEngine }
