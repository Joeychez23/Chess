/*
 *  ai.js  --  chess server
 *	AI Moves
 *  The AI's moves are picked here instead of in the browser, so a player can't choose the AI's moves or change its
 *  level mid game. Each level asks the Stockfish engine API (chess-engine-api) for a move, and the levels are 100 Elo
 *  apart. If the engine is down, js-chess-engine plays instead (as the client used to).
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { Chess } = require("chess.js");
const { aiMove: jsChessEngineMove } = require("js-chess-engine");
const config = require("../config");
const { BOTS } = require("./bots.js");

// Extra time (ms) for the engine's queue before we give up on it
const ENGINE_WAIT = 5000;

// A level is its Elo, 600 to 3200 in steps of 100 (server/README.md, "AI levels"). The level is saved on the game
// (ai_level) and the elo text is shown on Home. Each level's settings are one of:
// - notice (the levels under Stockfish's lowest UCI_Elo): the chance the level sees each legal move. It plays the best
//   move it saw, so it loses by overlooking moves rather than by playing random ones. Measured with games.
// - uci_elo: the Stockfish UCI_Elo (1320-3190, which Stockfish turns into a skill level) that plays at the level's Elo
//   (ENGINE_ELO below).
// - depth: Stockfish picks an Elo-limited move at depth 1 + its skill level, a whole number, so levels 100 Elo apart
//   often share a depth and then jump by one. Here the depth is the skill level + 0.5 with its fraction kept: 2.7 is
//   depth 3 for 70% of the moves and depth 2 for the rest (a search stopped before Stockfish's own pick depth), which
//   evens out the steps.
// - time: the most time (ms) the engine may think.
const LEVEL_STEP = 100;
const LOWEST_LEVEL = 600;
const FULL_STRENGTH = 3200;

// Skill::LowestElo and HighestElo in stockfish/src/search.h
const UCI_ELO = { lowest: 1320, highest: 3190 };

// From scripts/measureLevels.js calibrate, on Stockfish 19
const NOTICE = { 600: 0.112, 700: 0.13, 800: 0.1485, 900: 0.171, 1000: 0.2, 1100: 0.23, 1200: 0.263 };

// The UCI_Elo that plays at each level. Stockfish's ratings aren't 100 apart in games at these depths: measured on
// Stockfish 19 (scripts/measureLevels.js), 100 of UCI_Elo is about 65 from 1600 to 2600 and about 130 past it, and its
// first steps are uneven (1400 plays like 1320). So each level takes the UCI_Elo on that measured line.
const ENGINE_ELO = {
	1300: 1320, 1400: 1430, 1500: 1462, 1600: 1550, 1700: 1654, 1800: 1808, 1900: 1962, 2000: 2115, 2100: 2269, 2200: 2423,
	2300: 2577, 2400: 2666, 2500: 2745, 2600: 2823, 2700: 2901, 2800: 2979, 2900: 3057, 3000: 3135, 3100: 3190,
};

// Up to this UCI_Elo the engine thinks for at most a second, above it for two
const QUICK_THINK_MAX_ELO = 2600;

// A capture, check or promotion is this many times as likely to be seen
const STANDS_OUT = 3;

const LEVELS = [];
for (let elo = LOWEST_LEVEL; elo <= FULL_STRENGTH; elo += LEVEL_STEP) {
	if (NOTICE[elo]) {
		LEVELS.push({ level: elo, elo: `≈${elo}`, notice: NOTICE[elo], depth: 1, time: 1000 });
	} else if (elo < FULL_STRENGTH) {
		LEVELS.push({ level: elo, elo: `≈${elo}`, ...eloSettings(ENGINE_ELO[elo]) });
	} else {
		LEVELS.push({ level: elo, elo: `${elo}+`, depth: 20, time: 2000 });
	}
}

// A new level needs its bot
for (const { level } of LEVELS) {
	if (!BOTS[level]) {
		throw new Error(`AI level ${level} has no bot (server/utils/bots.js)`);
	}
}

const DEFAULT_LEVEL = 1300;

// Games and settings saved when there were 8 levels map to the closest level now
const OLD_LEVELS = { 1: 800, 2: 1100, 3: 1300, 4: 1600, 5: 1900, 6: 2200, 7: 2600, 8: 3200 };

// A draw offer is judged at full strength whatever the level: a skill level's weaker pick comes without a score
const DRAW_CHECK = { depth: 12, time: 1000 };

// Hints and the evaluation bar. Kept low: only 2 engines run, and other players' AI moves wait behind these
const ANALYSIS = { depth: 12, time: 800 };

// Positions kept in the cache; the one unused the longest is dropped first
const MAX_ANALYSES = 5000;

// FEN -> the answer (a promise), so the same position never asks the engine twice
const analyses = new Map();

/* ---------------------------------------------------------------- */
// Levels
/* ---------------------------------------------------------------- */
/**
 * @description The levels for the Home dropdown, each one a bot (server/utils/bots.js). old_levels lets the client
 * show the bot of a game saved with an old level (1 - 8)
 * @return {[object]} { levels: [{ level, elo, name, bio, avatar, lines }], default_level, old_levels }
 */
function levelList() {
	// The avatars are on S3, under CHESS_ASSETS_URL
	const levels = LEVELS.map(({ level, elo }) => ({ level, elo, ...BOTS[level], avatar: `images/bots/${level}.webp` }));
	return { levels, default_level: DEFAULT_LEVEL, old_levels: OLD_LEVELS };
}

/**
 * @description Turns a requested level into a real one, anything else gets the default. The 8 levels from before
 * (1 - 8) become the closest of today's
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
 * @param  {[number]} uciElo [1320 - 3190]
 * @return {[object]} settings [{ uci_elo, depth, time }]
 */
function eloSettings(uciElo) {
	return {
		uci_elo: uciElo,
		depth: Math.max(1, skillLevel(uciElo) + 0.5),
		time: uciElo <= QUICK_THINK_MAX_ELO ? 1000 : 2000,
	};
}

/**
 * @description Stockfish's skill level (0 - 19) for a UCI_Elo, the same fit as Skill in stockfish/src/search.h.
 * Stockfish picks its move at depth 1 + this
 * @param  {[number]} elo [UCI_Elo, 1320 - 3190]
 * @return {[number]} skill
 */
function skillLevel(elo) {
	const share = (elo - UCI_ELO.lowest) / (UCI_ELO.highest - UCI_ELO.lowest);
	return Math.min(19, Math.max(0, ((37.2473 * share - 40.8525) * share + 22.2943) * share - 0.311438));
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
		// The line must start with this text: an alarm matches it (terraform/modules/monitoring)
		console.log(`STOCKFISH FAILED, js-chess-engine PLAYS INSTEAD: ${err.message}`);
		return backupMove(fen);
	}
}

/**
 * @description The low levels: each legal move is seen with the level's notice chance (captures, checks and promotions
 * stand out), and Stockfish plays the best of the moves that were seen. With one move seen there's nothing to ask
 * @param  {[string]} fen [game board]
 * @param  {[object]} settings [level from LEVELS, with notice]
 * @return {[object]} move [{ from, to, promotion }]
 */
async function noticedMove(fen, settings) {
	const moves = new Chess(fen).moves({ verbose: true });
	let seen = moves.filter((move) => {
		const isStandout = move.captured || move.promotion || /[+#]/.test(move.san);
		return Math.random() < settings.notice * (isStandout ? STANDS_OUT : 1);
	});

	// It always sees at least one move
	if (!seen.length) {
		seen = [moves[Math.floor(Math.random() * moves.length)]];
	}
	if (seen.length == 1) {
		return { from: seen[0].from, to: seen[0].to, promotion: seen[0].promotion };
	}
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
	// A depth's fraction is the chance of searching one ply deeper (see the levels above)
	const depth = Math.floor(settings.depth) + (Math.random() < settings.depth % 1 ? 1 : 0);
	const body = { fen, depth, maxThinkingTime: settings.time };
	if (settings.uci_elo) {
		body.elo = settings.uci_elo;
	}
	// Only these moves are searched
	if (settings.searchmoves) {
		body.searchmoves = settings.searchmoves;
	}

	const res = await fetch(config.engineUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(settings.time + ENGINE_WAIT),
	});
	const data = await res.json();

	// Errors come back as { type: "info", text }
	if (data.type != "bestmove") {
		throw new Error(data.text || `Engine answered ${res.status}`);
	}
	return data;
}

/**
 * @description The chance a level sees each legal move (the levels up to 1200), so Card Guy can overlook moves the way
 * noticedMove does
 * @param  {[number]} level [600 - 3200]
 * @return {[number]} notice [null from 1300 up: every move is seen]
 */
function noticeFor(level) {
	return NOTICE[level] ?? null;
}

/**
 * @description The best of these moves at analysis strength, for Card Guy: its hand allows only some moves. Throws
 * when the engine can't answer, and the caller falls back
 * @param  {[string]} fen [game board]
 * @param  {[[string]]} lans [the moves to choose from, like "e2e4" or "a7a8q"]
 * @return {[object]} move [{ from, to, promotion }]
 */
function bestOf(fen, lans) {
	return stockfishMove(fen, { ...ANALYSIS, searchmoves: lans.join(" ") });
}

/* ---------------------------------------------------------------- */
// Draw Offers
/* ---------------------------------------------------------------- */
/**
 * @description Whether the AI takes a draw: when it isn't ahead, its win chance is 50% or less. With no evaluation
 * (the engine is down) it plays on
 * @param  {[string]} fen [game board]
 * @param  {[string]} aiColor ["w" or "b"]
 * @return {[boolean]} accepts
 */
async function aiAcceptsDraw(fen, aiColor) {
	try {
		const { winChance } = await askEngine(fen, DRAW_CHECK);
		if (typeof winChance != "number") {
			throw new Error("Engine sent no win chance");
		}
		// winChance is from White's side
		return (aiColor == "w" ? winChance : 100 - winChance) <= 50;
	} catch (err) {
		// The line must start with this text: an alarm matches it (terraform/modules/monitoring)
		console.log(`STOCKFISH FAILED, THE AI DECLINES THE DRAW: ${err.message}`);
		return false;
	}
}

/* ---------------------------------------------------------------- */
// Analysis
/* ---------------------------------------------------------------- */
/**
 * @description The best move and the evaluation for a board at full strength, for hints and the evaluation bar.
 * Cached by FEN; failures aren't kept. Throws when the engine can't answer
 * @param  {[string]} fen [game board]
 * @return {[object]} analysis [{ from, to, eval, mate, winChance } from White's side, from and to are null when the
 * game can't go on]
 */
function analyzePosition(fen) {
	let answer = analyses.get(fen);
	if (answer) {
		// Used, so it moves to the end: the Map keeps the order keys were added in
		analyses.delete(fen);
	} else {
		answer = askAnalysis(fen);
		answer.catch(() => analyses.delete(fen));
		if (analyses.size >= MAX_ANALYSES) {
			analyses.delete(analyses.keys().next().value);
		}
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
	if (board.isStalemate()) {
		return { from: null, to: null, eval: 0, mate: null, winChance: 50 };
	}

	const data = await askEngine(fen, ANALYSIS);
	if (typeof data.winChance != "number") {
		throw new Error("Engine sent no win chance");
	}
	const isLegal = board.moves({ verbose: true }).some((move) => move.from == data.from && move.to == data.to);
	if (!isLegal) {
		throw new Error(`Engine sent an illegal move: ${data.from}-${data.to}`);
	}
	return { from: data.from, to: data.to, eval: data.eval ?? null, mate: data.mate ?? null, winChance: data.winChance };
}

/**
 * @description Forgets the cached positions (between tests)
 */
function clearAnalyses() {
	analyses.clear();
}

/**
 * @description The health check (utils/health.js): a real search of the start position, so a running API with a
 * broken Stockfish fails it. Throws when the engine can't answer, on the same answers that make aiMove fall back to
 * js-chess-engine
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
	// js-chess-engine answers { E2: "E4" }
	const [from, to] = Object.entries(jsChessEngineMove(fen, 1))[0].map((square) => square.toLowerCase());
	const piece = new Chess(fen).get(from);
	const promotion = piece.type == "p" && (to[1] == "8" || to[1] == "1") ? "q" : undefined;
	return { from, to, promotion };
}


module.exports = {
	levelList,
	readLevel,
	levelSettings,
	eloSettings,
	aiMove,
	pickMove,
	aiAcceptsDraw,
	analyzePosition,
	clearAnalyses,
	checkEngine,
	noticeFor,
	bestOf,
	STANDS_OUT,
};
