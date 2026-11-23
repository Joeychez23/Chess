/*
 *  duelShow.js  --  chess frontend
 *	Chess Cards Duel Show
 *	What a card route's answer shows of All or Nothing's card duel on the table (three/cardTable.js dealDuel, flipDuel, endDuel), in the order of its events: flow.js shows the steps
 *	one after another with a short wait between them. No DOM, the client tests require it (client/test/cardsDuel.test.js)
 *
 */

/**
 * @description The index a duel-flip event's card has in its player's duel hand. The answer's view shows the flip: the last pick of the set it's in (the spades deal's once a spades pick
 * is in the view, else the round's: the round's last tied pair comes in the same answer as the spades deal). A duel the answer ended is gone from the view: the pick at the depth being flipped
 * in the previous view, else the player's own pick action; Card Guy's pick when he picked second is in no view (null: the table takes the card showing it)
 * @param  {[object|null]} prev [the view before the answer]
 * @param  {[object]} view [the answer's view]
 * @param  {[string]} player ["w" | "b", the event's]
 * @param  {[object|null]} action [the player's own action the answer is for, null for Card Guy's]
 * @return {[number|null]} index [0..2]
 */
function flipIndex(prev, view, player, action) {
	if (view.duel) {
		const d = view.duel, set = d.spades && d.spades.picked.w.length + d.spades.picked.b.length ? d.spades : d, picks = set.picked[player];
		return picks.length ? picks[picks.length - 1] : null;
	}
	const p = prev && prev.duel;
	if (!p) { return null; }
	const set = p.spades || p, depth = Math.min(set.picked.w.length, set.picked.b.length);
	if (set.picked[player].length > depth) { return set.picked[player][depth]; } // PICKED FIRST: THE PREVIOUS VIEW HAS IT
	return player === view.you && action && action.type === "duel" && Number.isInteger(action.pick) ? action.pick : null;
}

/**
 * @description The table's steps for an answer: each duel-deal deals the view's duel, each duel-flip turns its card up, the duel-result outlines the winner's card (a flip with won; a round
 * won on the suit score that ends the duel all 3 of the winner's round cards, a duel that goes on gets them from its deal), then the answer's view on the board & the table (set: after the
 * flips, so the result shows after the cards that decide it) & the view's duel last (dealDuel brings the table to it: a reload, a pick that flips nothing, a take-back), or the duel's end
 * once it's gone from the view or the game is over (a finished game shows no duel, also on a reload). Nothing when no duel is in it
 * @param  {[object|null]} prev [the view before the answer, null on a load]
 * @param  {[object]} view [the answer's view]
 * @param  {[array]} events [the answer's events]
 * @param  {[object|null]} action [the player's own action the answer is for, null for Card Guy's & a load]
 * @return {[array]} steps [{ op: "deal", duel } | { op: "flip", player, index, card, won } | { op: "set" } | { op: "end" }, set always right before the last]
 */
function duelSteps(prev, view, events, action = null) {
	const duelEvents = (events || []).filter((e) => e && typeof e.type === "string" && e.type.startsWith("duel-"));
	if (!view.duel && !(prev && prev.duel) && !duelEvents.length) { return []; }
	const steps = [], flipped = {};
	for (const e of duelEvents) {
		if (e.type === "duel-deal" && view.duel) { steps.push({ op: "deal", duel: view.duel }); }
		else if (e.type === "duel-flip") { flipped[e.player] = { index: flipIndex(prev, view, e.player, action), card: e.card }; steps.push({ op: "flip", player: e.player, ...flipped[e.player], won: false }); }
		else if (e.type === "duel-result" && flipped[e.winner]) {
			steps.push({ op: "flip", player: e.winner, ...flipped[e.winner], won: true });
			const round = !view.duel && flipped.w && flipped.b && flipped.w.card.r === flipped.b.card.r && prev && prev.duel; // THE LAST PICKS TIED: WON ON THE SUIT SCORE, THE DUEL ENDED (A SPADES PICK NEVER TIES)
			for (const i of round ? round.picked[e.winner].slice(0, 2) : []) { steps.push({ op: "flip", player: e.winner, index: i, card: round.hands[e.winner][i], won: true }); }
		}
	}
	const last = !view.duel || view.result ? { op: "end" } : steps.length && steps[steps.length - 1].op === "deal" ? steps.pop() : { op: "deal", duel: view.duel };
	steps.push({ op: "set" }, last);
	return steps;
}

module.exports = { duelSteps };
