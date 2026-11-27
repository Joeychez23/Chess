/*
 *  cardsBalance.js  --  chess server
 *	The Chess Cards balance report
 *  Card Guy plays both sides of N games (utils/card-guy/balance.js), then this prints a row per card: how often it was
 *  drawn and played, how often the side that played it won, the move cards drawn by type, and the rarity of the
 *  actives and passives drawn by turn band (1-9, 10-19, 20-29, 30+). It flags the cards that look too strong
 *  (too-strong), never turn up (rare-missing) or are never played (dud). No Stockfish and no network: a material count
 *  and a static score stand in for the engine.
 *  It is a report to tune card rarity and Card Guy's weights from, not a gate: the exit code is 0.
 *
 *  node scripts/cardsBalance.js [games=300] [seed=1]      game n is played with seed + n. LEVEL=1500 sets Card Guy's
 *                                                          level (600 - 3200)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

// config.js needs the other settings, though nothing here uses them
require("../test/helpers/env.js");
const engine = require("../../cards-engine/index.js");
const { staticScore } = require("../utils/card-guy/candidates.js");
const { playGame, summarize, rarityShares, drawTotals, MAX_PLIES } = require("../utils/card-guy/balance.js");

const PIECE_VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const LEVEL = Number(process.env.LEVEL) || 1500;
const games = Number(process.argv[2]) || 300;
const seed = Number(process.argv[3]) || 1;

/* ---------------------------------------------------------------- */
// The stand-ins for the engine
/* ---------------------------------------------------------------- */
/**
 * @description A board's material, from White's side
 * @param  {[string]} fen [board]
 * @return {[number]} centipawns
 */
async function evaluate(fen) {
	let sum = 0;
	for (const symbol of fen.split(" ")[0]) {
		const isPiece = /[a-z]/i.test(symbol);
		const sign = symbol === symbol.toUpperCase() ? 1 : -1;
		sum += isPiece ? sign * PIECE_VALUE[symbol.toLowerCase()] : 0;
	}
	return sum;
}

/**
 * @description The move with the top static score (the first one on a tie)
 * @param  {[string]} fen [board]
 * @param  {[array]} lans [moves, "e2e4"]
 * @return {[object]} move [{ from, to, promotion }]
 */
async function bestOf(fen, lans) {
	// staticScore reads only the board
	const sim = { board: engine.board.fromFen(fen) };
	const moves = lans.map((lan) => ({ from: lan.slice(0, 2), to: lan.slice(2, 4), promotion: lan[4] }));
	const scored = moves.map((move) => [staticScore(sim, move), move]);
	scored.sort((left, right) => right[0] - left[0]);
	return scored[0][1];
}

/* ---------------------------------------------------------------- */
// Report
/* ---------------------------------------------------------------- */
async function main() {
	const { results, failed, stats } = await playGames();
	printReport(results, failed, stats);
}

/**
 * @description Plays every game. One broken game doesn't lose the run: it is left out and its seed named
 * @return {[object]} { results (one per game played), failed (seeds), stats (summed over the games played) }
 */
async function playGames() {
	const results = [];
	const failed = [];
	const stats = {
		capped: 0,
		actionCapped: 0,
		stuck: 0,
		fallbacks: 0,
		turnActions: 0,
		discards: 0,
		singles: 0,
		singleRedraws: 0,
		rerolls: 0,
		plies: 0,
	};
	for (let n = 0; n < games; n++) {
		const gameStats = {};
		try {
			results.push(await playGame(seed + n, { evaluate, bestOf, level: LEVEL, stats: gameStats }));
			for (const key of Object.keys(stats)) {
				stats[key] += Number(gameStats[key]);
			}
		} catch (err) {
			failed.push(seed + n);
			console.error(`game ${n + 1}/${games} (seed ${seed + n}) failed:`, err);
		}
		console.error(`game ${n + 1}/${games}`);
	}
	return { results, failed, stats };
}

/**
 * @description Prints the report: the run, a row per card (flagged cards first, then by win rate), the rarity and
 * draw shares, and how the games ended
 * @param  {[array]} results [from playGames]
 * @param  {[array]} failed [seeds of the games that failed]
 * @param  {[object]} stats [summed game stats]
 */
function printReport(results, failed, stats) {
	const played = results.length;
	const rows = summarize(results).sort((first, second) => {
		return second.flags.length - first.flags.length || (second.winRateWhenPlayed ?? -1) - (first.winRateWhenPlayed ?? -1);
	});

	const failedNote = failed.length ? `, ${failed.length} failed and left out (seeds ${failed.join(", ")})` : "";
	console.log(`${played} games, seed ${seed}, Card Guy level ${LEVEL}` + failedNote);
	console.log([
		"card".padEnd(30),
		"rarity".padEnd(10),
		"drawn".padStart(6),
		"played".padStart(7),
		"win".padStart(7),
		"drawn-unplayed".padStart(15),
		"flags",
	].join(" "));
	for (const row of rows) {
		console.log([
			row.key.padEnd(30),
			row.rarity.padEnd(10),
			String(row.drawnGames).padStart(6),
			String(row.playedGames).padStart(7),
			percent(row.winRateWhenPlayed).padStart(7),
			String(row.drawnNotPlayedGames).padStart(15),
			row.flags.join(","),
		].join(" "));
	}

	const rarityLine = Object.entries(rarityShares(results)).map(([rarity, share]) => `${rarity} ${percent(share)}`).join(", ");
	console.log("share of games each rarity turned up in: " + rarityLine);

	const totals = drawTotals(results);
	console.log("move cards drawn by type: " + drawnShares(totals.moveTypes, ["p", "m", "r", "q"]));
	const rarities = ["common", "uncommon", "rare", "epic", "legendary"];
	for (const [band, counts] of Object.entries(totals.rarityByBand)) {
		console.log(`actives & passives drawn in turns ${band}: ` + drawnShares(counts, rarities));
	}

	const decided = played - stats.capped - stats.actionCapped - stats.stuck;
	const averagePlies = played ? (stats.plies / played).toFixed(1) : "-";
	const discardShare = percent(stats.discards / stats.turnActions);
	console.log(`games decided ${decided}, draws at the ${MAX_PLIES}-ply cap ${stats.capped}, stopped at the action cap ${stats.actionCapped}, stuck ${stats.stuck}, fallback actions ${stats.fallbacks}, average plies ${averagePlies}, free discards ${discardShare} of turn actions, single move-card discards ${stats.singles}, automatic redraws after one ${stats.singleRedraws} (Card Guy only discards dead cards, so 0 is expected), passive rerolls ${stats.rerolls}`);
}

/**
 * @description A share as a percentage with one decimal, or "-" when there is none
 * @param  {[number]} share [0 - 1, or null]
 * @return {[string]} text
 */
function percent(share) {
	return share === null || !Number.isFinite(share) ? "-" : (share * 100).toFixed(1) + "%";
}

/**
 * @description Each key's share of the cards drawn, then the total drawn
 * @param  {[object]} counts [key -> cards drawn]
 * @param  {[array]} keys [the keys to show, in order]
 * @return {[string]} text [e.g. "p 40.0%, m 30.0%, ... (120 drawn)"]
 */
function drawnShares(counts, keys) {
	const all = Object.values(counts).reduce((total, count) => total + count, 0);
	return keys.map((key) => `${key} ${percent((counts[key] || 0) / all)}`).join(", ") + ` (${all} drawn)`;
}

// A report, not a gate: the exit code stays 0
main().catch((err) => {
	console.error(err);
});
