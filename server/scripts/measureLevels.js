/*
 *  measureLevels.js  --  chess server
 *	Measures the AI levels
 *  Plays the levels in utils/ai.js against each other through a local chess-engine-api & rates them from the results,
 *  with level 1300 (Stockfish's UCI_Elo 1320) as the fixed point. See server/README.md -> AI levels
 *
 *  ENGINE_URL=http://127.0.0.1:3999/v1 node scripts/measureLevels.js verify [lowest] [highest]   the levels as they are (600 to 1500 when left out)
 *  ENGINE_URL=http://127.0.0.1:3999/v1 node scripts/measureLevels.js calibrate                   notice chances for the levels under 1300
 *  ENGINE_URL=http://127.0.0.1:3999/v1 node scripts/measureLevels.js engine 2000,2150,2300       how far apart Stockfish's own UCI_Elo settings really play (the first one is 0)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const engineUrl = process.env.ENGINE_URL;
if (!engineUrl) { console.error("Set ENGINE_URL to a local chess-engine-api, e.g. http://127.0.0.1:3999/v1"); process.exit(1); }
require("../test/helpers/env.js"); // config.js NEEDS THE OTHER SETTINGS, NOTHING HERE USES THEM
process.env.ENGINE_URL = engineUrl;

const { Chess } = require("chess.js");
const { levelList, pickMove, levelSettings, eloSettings } = require("../utils/ai.js");

const GAMES = Number(process.env.GAMES) || 200; // PER PAIR, EVERY OPENING WITH BOTH COLORS
const AT_ONCE = Number(process.env.AT_ONCE) || 8; // GAMES PLAYED AT THE SAME TIME (THE ENGINE API'S ENGINES)
const MAX_PLIES = 300; // LONGER GAMES ARE JUDGED BY THE ENGINE
const JUDGE = { depth: 10, time: 1000, wins: 3 }; // A SIDE AHEAD BY THIS MANY PAWNS WINS A GAME THAT RAN TOO LONG
const ANCHOR = { level: 1300, elo: 1320 };
const OPENINGS = [
	"e4 e5 Nf3 Nc6", "e4 e5 Nf3 Nf6", "e4 c5 Nf3 d6", "e4 c5 Nc3 Nc6", "e4 e6 d4 d5", "e4 c6 d4 d5", "e4 d5 exd5 Qxd5", "e4 d6 d4 Nf6", "e4 e5 Bc4 Nf6", "e4 e5 Nc3 Nf6",
	"d4 d5 c4 e6", "d4 d5 c4 c6", "d4 Nf6 c4 e6", "d4 Nf6 c4 g6", "d4 d5 Nf3 Nf6", "d4 f5 g3 Nf6", "c4 e5 Nc3 Nf6", "c4 c5 Nf3 Nf6", "Nf3 d5 g3 Nf6", "Nf3 Nf6 c4 e6",
];

let fallbacks = 0; // A MOVE FROM js-chess-engine INSTEAD OF STOCKFISH SPOILS THE MEASUREMENT
const log = console.log;
console.log = (...args) => { if (String(args[0]).startsWith("STOCKFISH FAILED")) { if (!fallbacks++) { console.error(args[0]); } } else { log(...args); } }; // THE FIRST ONE SAYS WHY

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
	for (const san of opening.split(" ")) { board.move(san); }
	for (let ply = 0; !board.isGameOver() && ply < MAX_PLIES; ply++) {
		board.move(await pickMove(board.fen(), board.turn() == "w" ? white : black));
	}
	if (board.isCheckmate()) { return board.turn() == "w" ? 0 : 1; }
	if (board.isGameOver()) { return 0.5; }

	const res = await fetch(engineUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fen: board.fen(), depth: JUDGE.depth, maxThinkingTime: JUDGE.time }) });
	const score = (await res.json()).eval; // FROM WHITE'S SIDE, A MATE IS +-100
	return score >= JUDGE.wins ? 1 : score <= -JUDGE.wins ? 0 : 0.5;
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
	const worker = async () => {
		while (next < games) {
			const game = next++;
			const opening = OPENINGS[(game >> 1) % OPENINGS.length];
			const result = game % 2 ? 1 - await playGame(second, first, opening) : await playGame(first, second, opening);
			score += result; // AFTER THE await: score += await ... WOULD ADD TO THE SCORE FROM BEFORE THE GAME, LOSING THE OTHER GAMES' POINTS
		}
	};
	await Promise.all(Array.from({ length: AT_ONCE }, worker));
	return score;
}

/* ---------------------------------------------------------------- */
// Ratings
/* ---------------------------------------------------------------- */
/**
 * @description Rates every side from all the matches at once (Bradley-Terry, a draw is half a win each), so a side is placed by everyone it played
 * @param  {[number]} count [how many sides]
 * @param  {[object]} matches [[{ a, b, score (a's points), games }], a & b are indexes]
 * @param  {[number]} anchor [index of the side whose rating is known]
 * @param  {[number]} anchorElo [its rating]
 * @return {[object]} ratings [Elo per side]
 */
function rate(count, matches, anchor, anchorElo) {
	let strength = Array(count).fill(1);
	for (let round = 0; round < 2000; round++) {
		strength = strength.map((own, side) => {
			let wins = 0.01; // A SIDE THAT LOST EVERY GAME STILL GETS A RATING
			let weight = 0;
			for (const { a, b, score, games } of matches) {
				if (a != side && b != side) { continue; }
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
 * @description Plays the matches & rates the sides
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
		const gap = Math.round(-400 * Math.log10(games / Math.min(Math.max(score, 0.5), games - 0.5) - 1));
		log(`${sides[a].name} vs ${sides[b].name}: ${score} / ${games} (${gap > 0 ? "+" : ""}${gap})`);
	}
	if (fallbacks) { log(`${fallbacks} MOVES CAME FROM js-chess-engine, THE ENGINE API WASN'T ANSWERING: DON'T USE THESE RESULTS`); }
	return rate(sides.length, matches, anchor, ANCHOR.elo);
}

/* ---------------------------------------------------------------- */
// Verify & Calibrate
/* ---------------------------------------------------------------- */
/**
 * @description Rates the levels as they are: each one plays the level above it & the one two above
 * @param  {[number]} lowest [first level]
 * @param  {[number]} highest [last level]
 */
async function verify(lowest = 600, highest = 1500) {
	const sides = levelList().levels.filter(({ level }) => level >= lowest && level <= highest).map(({ level }) => ({ name: `${level}`, settings: levelSettings(level) }));
	const pairs = [];
	for (let i = 0; i + 1 < sides.length; i++) {
		pairs.push([i, i + 1]);
		if (i + 2 < sides.length) { pairs.push([i, i + 2, GAMES / 2]); }
	}
	const ratings = await measure(sides, pairs, sides.findIndex((side) => side.name == ANCHOR.level));
	sides.forEach((side, i) => log(`level ${side.name}: ${ratings[i]}`));
}

/**
 * @description Rates a spread of notice chances against each other & level 1300, then reads off the chance for each level under it
 */
async function calibrate() {
	const chances = (process.env.CHANCES || "0.02,0.04,0.07,0.11,0.16,0.23,0.32,0.45").split(",").map(Number);
	const sides = chances.map((notice) => ({ name: `notice ${notice}`, settings: { notice, depth: 1, time: 1000 } }));
	sides.push({ name: `${ANCHOR.level}`, settings: levelSettings(ANCHOR.level) });
	const anchor = sides.length - 1;
	const pairs = [];
	for (let i = 0; i < chances.length; i++) {
		if (i + 1 < chances.length) { pairs.push([i, i + 1]); }
		if (i + 2 < chances.length) { pairs.push([i, i + 2, GAMES / 2]); }
		if (i >= chances.length - 4) { pairs.push([i, anchor]); }
	}
	const ratings = await measure(sides, pairs, anchor);
	sides.forEach((side, i) => log(`${side.name}: ${ratings[i]}`));

	for (let elo = 600; elo < ANCHOR.level; elo += 100) { // BETWEEN THE TWO CHANCES RATED EITHER SIDE OF IT, ON A LOG SCALE
		const above = ratings.findIndex((rating, i) => i < chances.length && rating >= elo);
		if (above < 1) { log(`${elo}: outside the chances that were played`); continue; }
		const share = (elo - ratings[above - 1]) / (ratings[above] - ratings[above - 1]);
		log(`${elo}: notice ${Math.exp(Math.log(chances[above - 1]) + share * (Math.log(chances[above]) - Math.log(chances[above - 1]))).toFixed(3)}`);
	}
}

/**
 * @description Rates Stockfish's UCI_Elo settings against each other, for the levels whose UCI_Elo isn't their own number (ENGINE_ELO in utils/ai.js)
 * @param  {[string]} list ["2000,2150,2300", lowest first. The ratings are from the first one, which is 0]
 */
async function engine(list) {
	const sides = list.split(",").map((elo) => ({ name: `UCI_Elo ${elo}`, settings: eloSettings(Number(elo)) }));
	const pairs = [];
	for (let i = 0; i + 1 < sides.length; i++) {
		pairs.push([i, i + 1]);
		if (i + 2 < sides.length) { pairs.push([i, i + 2, GAMES / 2]); }
	}
	const ratings = await measure(sides, pairs, 0);
	sides.forEach((side, i) => log(`${side.name}: ${ratings[i] - ANCHOR.elo > 0 ? "+" : ""}${ratings[i] - ANCHOR.elo}`));
}

const [mode, lowest, highest] = process.argv.slice(2);
(mode == "calibrate" ? calibrate() : mode == "engine" ? engine(lowest) : verify(lowest && Number(lowest), highest && Number(highest))).catch((err) => { console.error(err); process.exit(1); });
