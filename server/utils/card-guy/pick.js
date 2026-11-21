/*
 *  pick.js  --  chess server
 *	Card Guy: the pick
 *  The level weakens Card Guy here: the low levels overlook plain moves (as noticedMove does, a capture, check or promotion 3 times less often) and the discard (one roll a turn, whatever the cards held), every level under 2400 misjudges scores by some noise.
 *  Then the best total wins, unless a favourite card is close enough to it.
 *
 */

const { noticeFor, STANDS_OUT } = require("../ai.js");

const FLAIR_MARGIN = 60; // A FAVOURITE CARD THIS CLOSE TO THE BEST TOTAL IS PLAYED INSTEAD (cp)
const FULL_SIGHT = 2400; // FROM THIS LEVEL UP THE SCORES AREN'T MISJUDGED

/**
 * @description A normal random number (mean 0, deviation 1) from two uniform ones (Box-Muller)
 */
function normal(rng) {
	return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
}

/**
 * @description Picks Card Guy's action from the scored candidates
 * @param  {[array]} scored [{ action, total, plain, discard, standsOut, favourite }, at least one]
 * @param  {[number]} level [the game's level, 600 - 3200]
 * @param  {[function]} rng [() => a number in 0 - 1, seeded]
 * @return {[object]} action
 */
function pick(scored, level, rng) {
	const notice = noticeFor(level), sigma = Math.max(0, (FULL_SIGHT - level) / 4);
	let pass; // THE DISCARD'S ONE ROLL THIS TURN: A ROLL PER CARD HELD (ABOUT 8) WOULD SHOW ONE NINE TURNS IN TEN AT 1200
	const passing = () => (pass === undefined ? (pass = rng() < notice) : pass);
	const noticed = (c) => (c.discard ? passing() : !c.plain || rng() < notice * (c.standsOut ? STANDS_OUT : 1)); // CARD CANDIDATES ARE ALWAYS SEEN. A DISCARD IS A TURN PASSED: OVERLOOKED AS A MOVE IS, OR THE LOW LEVELS PASS WHENEVER THEY SEE NO MOVE
	let seen = notice === null ? scored : scored.filter(noticed);
	if (!seen.length) { const moves = scored.filter((c) => c.plain), from = moves.length ? moves : scored; seen = [from[Math.floor(rng() * from.length)]]; } // IT ALWAYS SEES ONE: A MOVE, NOT THE DISCARD
	const judged = seen.map((c) => ({ c, total: c.total + (sigma ? normal(rng) * sigma : 0) }));
	const top = (list) => list.reduce((best, x) => (x.total > best.total ? x : best));
	const best = top(judged), flair = judged.filter((x) => x.c.favourite && x.total >= best.total - FLAIR_MARGIN); // NEVER ONE OUTSIDE THE MARGIN
	return (flair.length ? top(flair) : best).c.action;
}

module.exports = { pick, FLAIR_MARGIN };
