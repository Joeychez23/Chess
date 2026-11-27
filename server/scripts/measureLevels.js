/*
 *  measureLevels.js  --  chess server
 *	Measures the AI levels
 *  Plays the levels in utils/ai.js against each other through a local chess-engine-api and rates them from the
 *  results, with level 1300 (Stockfish's UCI_Elo 1320) as the fixed point. See server/README.md, "AI levels".
 *
 *  ENGINE_URL=http://127.0.0.1:3999/v1 node scripts/measureLevels.js verify [lowest] [highest]
 *      the levels as they are (600 to 1500 when left out)
 *  ENGINE_URL=http://127.0.0.1:3999/v1 node scripts/measureLevels.js calibrate
 *      notice chances for the levels under 1300
 *  ENGINE_URL=http://127.0.0.1:3999/v1 node scripts/measureLevels.js engine 2000,2150,2300
 *      how far apart Stockfish's own UCI_Elo settings really play (the first one is 0)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const engineUrl = process.env.ENGINE_URL;
if (!engineUrl) {
	console.error("Set ENGINE_URL to a local chess-engine-api, e.g. http://127.0.0.1:3999/v1");
	process.exit(1);
}
// config.js needs the other settings, though nothing here uses them. It also sets ENGINE_URL, so ours is put back
require("../test/helpers/env.js");
process.env.ENGINE_URL = engineUrl;

const { Chess } = require("chess.js");
const { levelList, pickMove, levelSettings, eloSettings } = require("../utils/ai.js");

// Games per pair: every opening, with both colors
const GAMES = Number(process.env.GAMES) || 200;

// Games played at the same time (the engine API's engines)
const AT_ONCE = Number(process.env.AT_ONCE) || 8;

// Longer games are judged by the engine
const MAX_PLIES = 300;

// How a game that ran too long is judged: a side ahead by `wins` pawns wins it
const JUDGE = { depth: 10, time: 1000, wins: 3 };

const ANCHOR = { level: 1300, elo: 1320 };

// Rounds of the rating fit, plenty for it to settle
const RATING_ROUNDS = 2000;

const OPENINGS = [
	"e4 e5 Nf3 Nc6", "e4 e5 Nf3 Nf6", "e4 c5 Nf3 d6", "e4 c5 Nc3 Nc6", "e4 e6 d4 d5",
	"e4 c6 d4 d5", "e4 d5 exd5 Qxd5", "e4 d6 d4 Nf6", "e4 e5 Bc4 Nf6", "e4 e5 Nc3 Nf6",
	"d4 d5 c4 e6", "d4 d5 c4 c6", "d4 Nf6 c4 e6", "d4 Nf6 c4 g6", "d4 d5 Nf3 Nf6",
	"d4 f5 g3 Nf6", "c4 e5 Nc3 Nf6", "c4 c5 Nf3 Nf6", "Nf3 d5 g3 Nf6", "Nf3 Nf6 c4 e6",
];

// A move from js-chess-engine instead of Stockfish spoils the measurement, so they are counted
let fallbacks = 0;
const log = console.log;
console.log = countFallbacks;

/**
 * @description Stands in for console.log: counts utils/ai.js's "STOCKFISH FAILED" lines instead of printing them,
 * apart from the first one, which says why
 */
function countFallbacks(...args) {
	if (String(args[0]).startsWith("STOCKFISH FAILED")) {
		if (!fallbacks++) {
			console.error(args[0]);
		}
	} else {
		log(...args);
	}
}

/* ---------------------------------------------------------------- */
// Games
/* ---------------------------------------------------------------- */
/**
 * @description Plays one game
 * @param  {[object]} white [settings, as a level in utils/ai.js]
 * @param  {[object]} black [settings]
 * @param  {[string]} opening [the first moves, SAN]
 * @return {[number]} result [White's score: 1, 0.5 or 0]
 */
async function playGame(white, black, opening) {
	const board = new Chess();
	for (const san of opening.split(" ")) {
		board.move(san);
	}
	for (let ply = 0; !board.isGameOver() && ply < MAX_PLIES; ply++) {
		board.move(await pickMove(board.fen(), board.turn() == "w" ? white : black));
	}
	if (board.isCheckmate()) {
		return board.turn() == "w" ? 0 : 1;
	}
	if (board.isGameOver()) {
		return 0.5;
	}

	const res = await fetch(engineUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ fen: board.fen(), depth: JUDGE.depth, maxThinkingTime: JUDGE.time }),
	});
	// From White's side; a mate is +-100
	const score = (await res.json()).eval;
	if (score >= JUDGE.wins) {
		return 1;
	}
	if (score <= -JUDGE.wins) {
		return 0;
	}
	return 0.5;
}

/**
 * @description Plays a pair of settings against each other, each opening with both colors
 * @param  {[object]} first [settings]
 * @param  {[object]} second [settings]
 * @param  {[number]} games [how many]
 * @return {[number]} score [the first side's points]
 */
async function playMatch(first, second, games = GAMES) {
	let next = 0;
	let score = 0;

	// AT_ONCE of these run together, each taking the next game until none are left
	async function playUntilDone() {
		while (next < games) {
			const game = next++;
			const opening = OPENINGS[(game >> 1) % OPENINGS.length];
			const result = game % 2 ? 1 - await playGame(second, first, opening) : await playGame(first, second, opening);
			// Added after the await: score += await ... would add to the score from before the game, losing the
			// other games' points
			score += result;
		}
	}

	await Promise.all(Array.from({ length: AT_ONCE }, playUntilDone));
	return score;
}

/* ---------------------------------------------------------------- */
// Ratings
/* ---------------------------------------------------------------- */
/**
 * @description Rates every side from all the matches at once (Bradley-Terry, a draw is half a win each), so a side is
 * placed by everyone it played
 * @param  {[number]} count [how many sides]
 * @param  {[object]} matches [[{ a, b, score (a's points), games }], a and b are indexes]
 * @param  {[number]} anchor [index of the side whose rating is known]
 * @param  {[number]} anchorElo [its rating]
 * @return {[object]} ratings [Elo per side]
 */
function rate(count, matches, anchor, anchorElo) {
	let strength = Array(count).fill(1);
	for (let round = 0; round < RATING_ROUNDS; round++) {
		strength = strength.map((own, side) => {
			// A side that lost every game still gets a rating
			let wins = 0.01;
			let weight = 0;
			for (const { a, b, score, games } of matches) {
				if (a != side && b != side) {
					continue;
				}
				wins += a == side ? score : games - score;
				weight += games / (own + strength[a == side ? b : a]);
			}
			return wins / weight;
		});
		strength = strength.map((value) => value / strength[anchor]);
	}
	return strength.map((value) => Math.round(anchorElo + 400 * Math.log10(value)));
}

/**
 * @description Plays the matches and rates the sides
 * @param  {[object]} sides [[{ name, settings }]]
 * @param  {[object]} pairs [[[index, index, games]]]
 * @param  {[number]} anchor [index of the side whose rating is ANCHOR.elo]
 * @return {[object]} ratings [Elo per side]
 */
async function measure(sides, pairs, anchor) {
	const matches = [];
	for (const [a, b, games = GAMES] of pairs) {
		const score = await playMatch(sides[a].settings, sides[b].settings, games);
		matches.push({ a, b, score, games });
		// The Elo gap this one match shows, with the score kept off 0 and full marks so the log stays finite
		const gap = Math.round(-400 * Math.log10(games / Math.min(Math.max(score, 0.5), games - 0.5) - 1));
		log(`${sides[a].name} vs ${sides[b].name}: ${score} / ${games} (${gap > 0 ? "+" : ""}${gap})`);
	}
	if (fallbacks) {
		log(`${fallbacks} MOVES CAME FROM js-chess-engine, THE ENGINE API WASN'T ANSWERING: DON'T USE THESE RESULTS`);
	}
	return rate(sides.length, matches, anchor, ANCHOR.elo);
}

/* ---------------------------------------------------------------- */
// Verify & Calibrate
/* ---------------------------------------------------------------- */
/**
 * @description Rates the levels as they are: each one plays the level above it and the one two above
 * @param  {[number]} lowest [first level]
 * @param  {[number]} highest [last level]
 */
async function verify(lowest = 600, highest = 1500) {
	const sides = levelList().levels
		.filter(({ level }) => level >= lowest && level <= highest)
		.map(({ level }) => ({ name: `${level}`, settings: levelSettings(level) }));
	const pairs = [];
	for (let i = 0; i + 1 < sides.length; i++) {
		pairs.push([i, i + 1]);
		if (i + 2 < sides.length) {
			pairs.push([i, i + 2, GAMES / 2]);
		}
	}
	const ratings = await measure(sides, pairs, sides.findIndex((side) => side.name == ANCHOR.level));
	sides.forEach((side, i) => log(`level ${side.name}: ${ratings[i]}`));
}

/**
 * @description Rates a spread of notice chances against each other and level 1300, then reads off the chance for each
 * level under it
 */
async function calibrate() {
	const chances = (process.env.CHANCES || "0.02,0.04,0.07,0.11,0.16,0.23,0.32,0.45").split(",").map(Number);
	const sides = chances.map((notice) => ({ name: `notice ${notice}`, settings: { notice, depth: 1, time: 1000 } }));
	sides.push({ name: `${ANCHOR.level}`, settings: levelSettings(ANCHOR.level) });
	const anchor = sides.length - 1;
	const pairs = [];
	for (let i = 0; i < chances.length; i++) {
		if (i + 1 < chances.length) {
			pairs.push([i, i + 1]);
		}
		if (i + 2 < chances.length) {
			pairs.push([i, i + 2, GAMES / 2]);
		}
		if (i >= chances.length - 4) {
			pairs.push([i, anchor]);
		}
	}
	const ratings = await measure(sides, pairs, anchor);
	sides.forEach((side, i) => log(`${side.name}: ${ratings[i]}`));

	// Each level's chance lies between the two chances rated either side of it, on a log scale
	for (let elo = 600; elo < ANCHOR.level; elo += 100) {
		const above = ratings.findIndex((rating, i) => i < chances.length && rating >= elo);
		if (above < 1) {
			log(`${elo}: outside the chances that were played`);
			continue;
		}
		const share = (elo - ratings[above - 1]) / (ratings[above] - ratings[above - 1]);
		const lowChance = Math.log(chances[above - 1]);
		const highChance = Math.log(chances[above]);
		log(`${elo}: notice ${Math.exp(lowChance + share * (highChance - lowChance)).toFixed(3)}`);
	}
}

/**
 * @description Rates Stockfish's UCI_Elo settings against each other, for the levels whose UCI_Elo isn't their own
 * number (ENGINE_ELO in utils/ai.js)
 * @param  {[string]} list ["2000,2150,2300", lowest first. The ratings are from the first one, which is 0]
 */
async function engine(list) {
	const sides = list.split(",").map((elo) => ({ name: `UCI_Elo ${elo}`, settings: eloSettings(Number(elo)) }));
	const pairs = [];
	for (let i = 0; i + 1 < sides.length; i++) {
		pairs.push([i, i + 1]);
		if (i + 2 < sides.length) {
			pairs.push([i, i + 2, GAMES / 2]);
		}
	}
	const ratings = await measure(sides, pairs, 0);
	sides.forEach((side, i) => log(`${side.name}: ${ratings[i] - ANCHOR.elo > 0 ? "+" : ""}${ratings[i] - ANCHOR.elo}`));
}

const [mode, lowest, highest] = process.argv.slice(2);
let run;
if (mode == "calibrate") {
	run = calibrate();
} else if (mode == "engine") {
	run = engine(lowest);
} else {
	run = verify(lowest && Number(lowest), highest && Number(highest));
}
run.catch((err) => {
	console.error(err);
	process.exit(1);
});
