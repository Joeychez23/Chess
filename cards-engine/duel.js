/*
 *  duel.js  --  chess cards engine
 *	All or Nothing's card duel (core rules): the deal, both players' face-down picks, flips, ties, suit scores, the spades deal, upgrades, the forfeit; what a view may show of it and how fromView fills it back.
 *
 */

const { pieceById } = require("./board.js");
const { LOSES } = require("./movegen.js");
const statuses = require("./statuses.js");

const other = (c) => (c === "w" ? "b" : "w");
const deck52 = () => ["c", "d", "h", "s"].flatMap((s) => Array.from({ length: 13 }, (_, i) => ({ r: i + 2, s }))); // r 14 = ACE
const spades13 = () => deck52().filter((c) => c.s === "s");
const TIER = { p: 0, n: 1, b: 1, r: 2 }; // KNIGHT AND BISHOP SHARE A STEP: ONE IS NO UPGRADE OF THE OTHER
const NEXT = ["nb", "r", "q"]; // THE UPGRADE A WIN GIVES, BY THE PIECE'S TIER

/**
 * @description Shuffle deck (state.rng) and deal 3 face-down cards to each player: { deck: the rest, hands: { w, b }, picked: { w: [], b: [] } } (picks are indexes into hands).
 */
function dealSet(ctx, deck) {
	ctx.rng.shuffle(deck);
	const w = deck.splice(0, 3), b = deck.splice(0, 3);
	return { deck, hands: { w, b }, picked: { w: [], b: [] } };
}

/**
 * @description A new round: a fresh 52-card deck, 3 cards each, step "pick", no spades; a duel-deal event { player, round }.
 */
function deal(ctx) {
	const d = ctx.state.duel;
	Object.assign(d, dealSet(ctx, deck52()), { step: "pick", round: d.round + 1, spades: null });
	ctx.emit({ type: "duel-deal", player: d.player, round: d.round });
}

/**
 * @description Start a duel for player's piece: state.duel = { player, piece, card, step, wins, deck, hands, picked, round, spades }, then the first deal. card is the played key (All or Nothing or a version): it sets a lost hand's stakes and rides in the saved state. The turn waits until the duel is over (turn.js).
 */
function start(ctx, player, piece, card) {
	ctx.state.duel = { player, piece, card, wins: 0, round: 0 };
	deal(ctx);
}

/**
 * @description The duel actions player may take: in step "pick", one { type: "duel", pick: i } per unpicked card of the current set (the spades deal when it is up) unless player is a pick ahead of the other; in step "decide", { stop: true } and { stop: false } for the duel's player only. Either player picks first; Card Guy's pick comes through the same action.
 */
function actions(state, player) {
	const d = state.duel;
	if (d.step === "decide") return player === d.player ? [{ type: "duel", stop: true }, { type: "duel", stop: false }] : [];
	const set = d.spades || d, mine = set.picked[player];
	if (mine.length > set.picked[other(player)].length) return []; // WAITING FOR THE OTHER PICK
	return [0, 1, 2].filter((i) => !mine.includes(i)).map((pick) => ({ type: "duel", pick }));
}

/**
 * @description How many of a hand's cards share one suit.
 */
function suitScore(cards) {
	return Math.max(...cards.map((c) => cards.filter((x) => x.s === c.s).length));
}

/**
 * @description Resolve a legal duel action by player (either side). stop ends the duel; continue deals a new round. A pick waits for the other's pick at the same depth; then both flip (duel-flip { player, card }, the duel's player first) and the higher rank wins (Ace high); a tie picks again from the rest; all three tied → the higher suit score; still tied → a 13-spade deal (duel-deal { spades: true }), one pick each. Returns true when the duel is over (the turn then ends).
 */
function act(ctx, player, a) {
	const s = ctx.state, d = s.duel, opp = other(d.player);
	if (a.stop !== undefined) {
		if (a.stop) s.duel = null;
		else deal(ctx);
		return !!a.stop;
	}
	const set = d.spades || d;
	set.picked[player].push(a.pick);
	const n = set.picked[d.player].length;
	if (n !== set.picked[opp].length) return false; // THE OTHER HASN'T PICKED YET
	const [mine, theirs] = [d.player, opp].map((c) => set.hands[c][set.picked[c][n - 1]]);
	ctx.emit({ type: "duel-flip", player: d.player, card: mine });
	ctx.emit({ type: "duel-flip", player: opp, card: theirs });
	let diff = mine.r - theirs.r;
	if (!diff && n < 3) return false; // TIE: PICK AGAIN FROM THE REST (A SPADES PICK NEVER TIES)
	if (!diff) diff = suitScore(d.hands[d.player]) - suitScore(d.hands[opp]);
	if (!diff) {
		d.spades = dealSet(ctx, spades13());
		ctx.emit({ type: "duel-deal", player: d.player, round: d.round, spades: true });
		return false;
	}
	return result(ctx, diff > 0 ? d.player : opp);
}

/**
 * @description A decided round: duel-result { winner }. A win counts and gives the next upgrade (Knight or Bishop by the player's choice, asked with ctx.ask; Rook; Queen, which ends the duel), then step "decide". A loss ends the duel: 6 random cards forfeit, then the piece leaves the board (the epic version forfeits the piece only, the legendary version the cards only: the piece stays as it is, upgrades already won included). refillLock holds back this turn's whole refill, the played card's active slot too: all of it comes back at the end of the player's next turn. Losing the piece is a removal, not a capture by the winner: Marked is cleared first so it pays no one, and the capture event names the piece's own player (player === c, by null), so no "the opponent captured" trigger fires. Returns true when the duel is over.
 */
function result(ctx, winner) {
	const s = ctx.state, d = s.duel;
	ctx.emit({ type: "duel-result", winner });
	if (winner !== d.player) {
		s.duel = null;
		if (d.card !== "all-or-nothing-epic") { // THE EPIC VERSION LOSES NO CARDS, SO NOTHING HOLDS ITS REFILL BACK EITHER
			ctx.discardRandom(d.player, 6);
			s.players[d.player].refillLock = Math.max(s.players[d.player].refillLock, 1);
		}
		if (d.card !== "all-or-nothing-legendary" && pieceById(s.board, d.piece) >= 0) { statuses.clear(ctx, d.piece, "marked"); ctx.capture(d.player, d.piece); } // A TARGET IS NEVER A KING; A TRIGGER MAY HAVE TAKEN IT ALREADY
		return true;
	}
	d.wins++;
	d.step = "decide";
	const i = pieceById(s.board, d.piece), next = i >= 0 && NEXT[TIER[s.board.sq[i].t]];
	if (next === "nb") return void ctx.ask(d.player, "all-or-nothing", ["n", "b"], { card: "all-or-nothing" });
	return upgrade(ctx, next);
}

/**
 * @description The duel's piece becomes type t on its square, same id (a rook's castling right goes with it), with a promote event (the fifty-move count goes on: an upgrade is not a pawn move); Queen ends the duel, as does a piece no longer on the board. Returns true when the duel is over.
 */
function upgrade(ctx, t) {
	const s = ctx.state, d = s.duel, b = s.board, i = pieceById(b, d.piece);
	if (i < 0) { s.duel = null; return true; } // TAKEN BY A TRIGGER MID-DUEL: NOTHING TO UPGRADE
	if (b.sq[i].t === "r") b.castling = [...(LOSES[i] || "")].reduce((c, ch) => c.replace(ch, ""), b.castling) || "-";
	b.sq[i].t = t;
	ctx.emit({ type: "promote", player: d.player, piece: d.piece, t });
	if (t !== "q") return false;
	s.duel = null;
	return true;
}

/**
 * @description A view's copy of the duel (changed in place): no deck, and every card not yet flipped (a pick both players have made at that depth) is null, for both players: picks are face down to their owner too.
 */
function hide(d) {
	for (const set of [d, d.spades].filter(Boolean)) {
		delete set.deck;
		const n = Math.min(set.picked.w.length, set.picked.b.length);
		for (const c of ["w", "b"]) set.hands[c] = set.hands[c].map((card, i) => (set.picked[c].slice(0, n).includes(i) ? card : null));
	}
}

/**
 * @description fromView: the hidden cards (null) and the deck dealt again from ctx.rng out of the cards not shown.
 */
function fill(ctx, d) {
	for (const [set, all] of [[d, deck52()], [d.spades, spades13()]]) {
		if (!set) continue;
		const known = [...set.hands.w, ...set.hands.b].filter(Boolean);
		const pool = ctx.rng.shuffle(all.filter((c) => !known.some((k) => k.r === c.r && k.s === c.s)));
		for (const c of ["w", "b"]) set.hands[c] = set.hands[c].map((card) => card || pool.pop());
		set.deck = pool;
	}
}

module.exports = { start, actions, act, upgrade, hide, fill };
