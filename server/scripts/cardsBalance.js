/*
 *  cardsBalance.js  --  chess server
 *	The Chess Cards balance report
 *  Card Guy plays both sides of N games (utils/card-guy/balance.js), then this prints a row per card: how often it was drawn and played, how often the side that played it won,
 *  the move cards drawn by type and the rarity of the actives & passives drawn by turn band (1-9, 10-19, 20-29, 30+),
 *  and flags for the cards that look too strong (too-strong), never turn up (rare-missing) or are never played (dud). No Stockfish, no network: a material count & a static score stand in for it.
 *  A report to tune card rarity and Card Guy's weights from, not a gate: the exit code is 0
 *
 *  node scripts/cardsBalance.js [games=300] [seed=1]      game n is played with seed + n. LEVEL=1500 sets Card Guy's level (600 - 3200)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

require("../test/helpers/env.js"); // config.js NEEDS THE OTHER SETTINGS, NOTHING HERE USES THEM
const engine = require("../../cards-engine/index.js");
const { staticScore } = require("../utils/card-guy/candidates.js");
const { playGame, summarize, rarityShares, drawTotals, MAX_PLIES } = require("../utils/card-guy/balance.js");

const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
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
	return [...fen.split(" ")[0]].reduce((sum, ch) => sum + (/[a-z]/i.test(ch) ? (ch === ch.toUpperCase() ? 1 : -1) * VALUE[ch.toLowerCase()] : 0), 0);
}

/**
 * @description The move with the top static score
 * @param  {[string]} fen [board]
 * @param  {[array]} lans [moves, "e2e4"]
 * @return {[object]} move [{ from, to, promotion }]
 */
async function bestOf(fen, lans) {
	const sim = { board: engine.board.fromFen(fen) }; // staticScore READS THE BOARD ONLY
	const moves = lans.map((lan) => ({ from: lan.slice(0, 2), to: lan.slice(2, 4), promotion: lan[4] }));
	return moves.map((m) => [staticScore(sim, m), m]).sort((a, b) => b[0] - a[0])[0][1];
}

/* ---------------------------------------------------------------- */
// Report
/* ---------------------------------------------------------------- */
async function main() {
	const results = [], failed = [], stats = { capped: 0, actionCapped: 0, stuck: 0, fallbacks: 0, turnActions: 0, discards: 0, singles: 0, singleRedraws: 0, rerolls: 0, plies: 0 };
	for (let n = 0; n < games; n++) {
		const one = {};
		try {
			results.push(await playGame(seed + n, { evaluate, bestOf, level: LEVEL, stats: one }));
			for (const k of Object.keys(stats)) { stats[k] += Number(one[k]); }
		} catch (err) {
			failed.push(seed + n); // ONE BROKEN GAME DOESN'T LOSE THE RUN: IT IS LEFT OUT AND NAMED
			console.error(`game ${n + 1}/${games} (seed ${seed + n}) failed:`, err);
		}
		console.error(`game ${n + 1}/${games}`);
	}

	const played = results.length;
	const rows = summarize(results).sort((a, b) => b.flags.length - a.flags.length || (b.winRateWhenPlayed ?? -1) - (a.winRateWhenPlayed ?? -1));
	const pct = (x) => (x === null || !Number.isFinite(x) ? "-" : (x * 100).toFixed(1) + "%");
	console.log(`${played} games, seed ${seed}, Card Guy level ${LEVEL}` + (failed.length ? `, ${failed.length} failed and left out (seeds ${failed.join(", ")})` : ""));
	console.log(["card".padEnd(30), "rarity".padEnd(10), "drawn".padStart(6), "played".padStart(7), "win".padStart(7), "drawn-unplayed".padStart(15), "flags"].join(" "));
	for (const r of rows) { console.log([r.key.padEnd(30), r.rarity.padEnd(10), String(r.drawnGames).padStart(6), String(r.playedGames).padStart(7), pct(r.winRateWhenPlayed).padStart(7), String(r.drawnNotPlayedGames).padStart(15), r.flags.join(",")].join(" ")); }
	console.log("share of games each rarity turned up in: " + Object.entries(rarityShares(results)).map(([rarity, share]) => `${rarity} ${pct(share)}`).join(", "));
	const totals = drawTotals(results), shares = (counts, keys) => { const all = Object.values(counts).reduce((n, x) => n + x, 0); return keys.map((k) => `${k} ${pct((counts[k] || 0) / all)}`).join(", ") + ` (${all} drawn)`; };
	console.log("move cards drawn by type: " + shares(totals.moveTypes, ["p", "m", "r", "q"]));
	for (const [band, counts] of Object.entries(totals.rarityByBand)) { console.log(`actives & passives drawn in turns ${band}: ` + shares(counts, ["common", "uncommon", "rare", "epic", "legendary"])); }
	console.log(`games decided ${played - stats.capped - stats.actionCapped - stats.stuck}, draws at the ${MAX_PLIES}-ply cap ${stats.capped}, stopped at the action cap ${stats.actionCapped}, stuck ${stats.stuck}, fallback actions ${stats.fallbacks}, average plies ${played ? (stats.plies / played).toFixed(1) : "-"}, free discards ${pct(stats.discards / stats.turnActions)} of turn actions, single move-card discards ${stats.singles}, automatic redraws after one ${stats.singleRedraws}, passive rerolls ${stats.rerolls}`);
}

main().catch((err) => { console.error(err); }); // A REPORT, NOT A GATE: EXIT CODE 0
