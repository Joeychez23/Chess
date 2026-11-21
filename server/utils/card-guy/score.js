/*
 *  score.js  --  chess server
 *	Card Guy: the card score
 *  What a card did that a chess engine can't see (statuses, curses, cards won and lost, a waiting passive, a lost turn), in centipawns, added to the board's evaluation.
 *
 */

const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900 }; // PIECE VALUES (cp)
const WEIGHTS = { // STARTING VALUES (cp), TUNED WITH THE BALANCE REPORT
	warded: 120, frozenEnemy: 90, shakenEnemy: 60, markedOwn: -40, curseGiven: 150, curseHeld: -150,
	cardLost: -35, cardGained: 35, passiveWaiting: 80, turnSkipped: -200, enemyPassiveCancelled: 80,
};
const COUNTED = ["warded", "frozenEnemy", "shakenEnemy", "markedOwn", "curseGiven", "curseHeld", "passiveWaiting"]; // WEIGHED BY HOW MANY MORE (OR FEWER) THERE ARE AFTER
const DUEL_NEXT = { p: 325, n: VALUE.r, b: VALUE.r, r: VALUE.q }; // WHAT THE PIECE IS WORTH AFTER ITS NEXT WIN (A PAWN: KNIGHT OR BISHOP)
const DUEL_CARDS = 6;

const other = (c) => (c === "w" ? "b" : "w");
const held = (p) => p.moves.length + p.actives.length + (p.passive ? 1 : 0);

/**
 * @description What the card score counts in a state, from me's side
 * @param  {[object]} state [engine state]
 * @param  {[string]} me ["w" or "b"]
 * @return {[object]} counts
 */
function counts(state, me) {
	const p = state.players[me], o = state.players[other(me)];
	const withStatus = (color, s) => state.board.sq.filter((q) => q && q.c === color && (state.statuses[q.id] || []).some((e) => e.s === s)).length;
	return {
		warded: withStatus(me, "warded"), frozenEnemy: withStatus(other(me), "frozen"), shakenEnemy: withStatus(other(me), "shaken"), markedOwn: withStatus(me, "marked"),
		curseGiven: o.curses.length, curseHeld: p.curses.length, passiveWaiting: state.effects.filter((e) => e.owner === me).length,
		cards: held(p), lostTurns: p.lostTurns || 0, skips: p.skips,
	};
}

/**
 * @description The card score of an action for me: WEIGHTS times what changed from before to after. A discard counts as a skipped turn, like a lost one.
 * While the turn is still open the card just played isn't counted as lost (the end of the turn draws it back)
 * @param  {[object]} before [engine state before the action]
 * @param  {[object]} after [engine state after it]
 * @param  {[string]} me ["w" or "b"]
 * @param  {[array]} events [the action's events: the opponent's cancelled passives are counted from them]
 * @return {[number]} centipawns
 */
function cardScore(before, after, me, events = []) {
	const b = counts(before, me), a = counts(after, me);
	const open = after.ply === before.ply && !after.result && a.cards < b.cards ? 1 : 0; // THE TURN GOES ON (A TWO-MOVE TURN, A CHOICE, A DUEL): THE CARD JUST PLAYED COMES BACK AT ITS REFILL, IT ISN'T LOST
	const cards = a.cards - b.cards + open;
	let score = COUNTED.reduce((sum, k) => sum + WEIGHTS[k] * (a[k] - b[k]), 0);
	score += cards < 0 ? WEIGHTS.cardLost * -cards : WEIGHTS.cardGained * cards;
	score += WEIGHTS.turnSkipped * (Math.max(0, a.lostTurns - b.lostTurns) + (a.skips > b.skips ? 1 : 0));
	score += WEIGHTS.enemyPassiveCancelled * events.filter((e) => e.type === "passive-cancelled" && e.player === other(me)).length;
	return score;
}

/**
 * @description All or Nothing's expected value for the next hand of the card duel (a 50/50): half the upgrade's worth minus half of what a loss forfeits
 * (6 cards and the piece; the epic version no cards, the legendary one no piece). Card Guy plays the card, and goes on after a win, by this number
 * @param  {[object]} state [engine state]
 * @param  {[string]} me ["w" or "b"]
 * @param  {[string]} key [the card's key (a version's own)]
 * @param  {[string]} pieceId [the piece in the duel]
 * @return {[number]} centipawns
 */
function duelValue(state, me, key, pieceId) {
	const q = state.board.sq.find((x) => x && x.id === pieceId);
	if (!q || !DUEL_NEXT[q.t]) { return 0; }
	const cards = key === "all-or-nothing-epic" ? 0 : Math.min(DUEL_CARDS, held(state.players[me])); // THE VERSIONS' STAKES, READ BY KEY AS cards-engine/duel.js DOES
	const piece = key === "all-or-nothing-legendary" ? 0 : VALUE[q.t];
	return 0.5 * (DUEL_NEXT[q.t] - VALUE[q.t]) - 0.5 * (cards * -WEIGHTS.cardLost + piece);
}

module.exports = { WEIGHTS, VALUE, cardScore, duelValue };
