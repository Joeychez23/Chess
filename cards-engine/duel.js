/*
 *  duel.js  --  chess cards engine
 *	All or Nothing's card duel (core rules): the deal, both players' face-down picks, flips, ties, suit scores,
 *	the spades deal, upgrades, the forfeit; what a view may show of it and how fromView fills it back.
 *
 */

const { pieceById } = require("./board.js");
const { CASTLING_LOST } = require("./movegen.js");
const statuses = require("./statuses.js");

// Knight and bishop share a tier: one is no upgrade of the other
const DUEL_TIER = { p: 0, n: 1, b: 1, r: 2 };
// The upgrade a win gives, by the piece's tier ("nb": the player chooses knight or bishop)
const UPGRADE_BY_TIER = ["nb", "r", "q"];

function other(color) {
	return color === "w" ? "b" : "w";
}

/**
 * @description The 13 cards of one suit, rank 2 to 14 (14 is the ace).
 */
function suitCards(suit) {
	return Array.from({ length: 13 }, (_, i) => ({ r: i + 2, s: suit }));
}

function deck52() {
	return ["c", "d", "h", "s"].flatMap((suit) => suitCards(suit));
}

function spades13() {
	return deck52().filter((card) => card.s === "s");
}

/**
 * @description Shuffle deck (state.rng) and deal 3 face-down cards to each player:
 * { deck: the rest, hands: { w, b }, picked: { w: [], b: [] } } (picks are indexes into hands).
 */
function dealSet(ctx, deck) {
	ctx.rng.shuffle(deck);
	const whiteHand = deck.splice(0, 3);
	const blackHand = deck.splice(0, 3);
	return { deck, hands: { w: whiteHand, b: blackHand }, picked: { w: [], b: [] } };
}

/**
 * @description A new round: a fresh 52-card deck, 3 cards each, step "pick", no spades; a duel-deal event { player, round }.
 */
function deal(ctx) {
	const duel = ctx.state.duel;
	Object.assign(duel, dealSet(ctx, deck52()), { step: "pick", round: duel.round + 1, spades: null });
	ctx.emit({ type: "duel-deal", player: duel.player, round: duel.round });
}

/**
 * @description Start a duel for player's piece: state.duel = { player, piece, card, step, wins, deck, hands, picked, round, spades },
 * then the first deal. card is the played key (All or Nothing or a version): it sets a lost hand's stakes and rides in the
 * saved state. The turn waits until the duel is over (turn.js).
 */
function start(ctx, player, piece, card) {
	ctx.state.duel = { player, piece, card, wins: 0, round: 0 };
	deal(ctx);
}

/**
 * @description The duel actions player may take: in step "pick", one { type: "duel", pick: i } per unpicked card of the
 * current set (the spades deal when it is up) unless player is a pick ahead of the other; in step "decide",
 * { stop: true } and { stop: false } for the duel's player only. Either player picks first; Card Guy's pick comes
 * through the same action.
 */
function actions(state, player) {
	const duel = state.duel;
	if (duel.step === "decide") {
		return player === duel.player ? [{ type: "duel", stop: true }, { type: "duel", stop: false }] : [];
	}
	const set = duel.spades || duel;
	const mine = set.picked[player];
	if (mine.length > set.picked[other(player)].length) return []; // waiting for the other player's pick
	return [0, 1, 2].filter((i) => !mine.includes(i)).map((pick) => ({ type: "duel", pick }));
}

/**
 * @description How many of a hand's cards share one suit.
 */
function suitScore(cards) {
	return Math.max(...cards.map((card) => cards.filter((handCard) => handCard.s === card.s).length));
}

/**
 * @description Resolve a legal duel action by player (either side). stop ends the duel; continue deals a new round.
 * A pick waits for the other's pick at the same depth; then both flip (duel-flip { player, card }, the duel's player
 * first) and the higher rank wins (ace high); a tie picks again from the rest; all three tied: the higher suit score;
 * still tied: a 13-spade deal (duel-deal { spades: true }), one pick each. Returns true when the duel is over (the turn
 * then ends).
 */
function act(ctx, player, action) {
	const state = ctx.state, duel = state.duel, opp = other(duel.player);
	if (action.stop !== undefined) {
		if (action.stop) state.duel = null;
		else deal(ctx);
		return !!action.stop;
	}

	const set = duel.spades || duel;
	set.picked[player].push(action.pick);
	const depth = set.picked[duel.player].length;
	if (depth !== set.picked[opp].length) return false; // the other player hasn't picked yet

	const flip = depth - 1;
	const mine = set.hands[duel.player][set.picked[duel.player][flip]];
	const theirs = set.hands[opp][set.picked[opp][flip]];
	ctx.emit({ type: "duel-flip", player: duel.player, card: mine });
	ctx.emit({ type: "duel-flip", player: opp, card: theirs });

	let diff = mine.r - theirs.r;
	if (!diff && depth < 3) return false; // a tie: pick again from the rest (a spades pick never ties)
	if (!diff) diff = suitScore(duel.hands[duel.player]) - suitScore(duel.hands[opp]);
	if (!diff) {
		duel.spades = dealSet(ctx, spades13());
		ctx.emit({ type: "duel-deal", player: duel.player, round: duel.round, spades: true });
		return false;
	}
	return result(ctx, diff > 0 ? duel.player : opp);
}

/**
 * @description A decided round: duel-result { winner }. A win counts and gives the next upgrade (knight or bishop by the
 * player's choice, asked with ctx.ask; rook; queen, which ends the duel), then step "decide".
 * A loss ends the duel: the whole hand is forfeit (every move card, active and passive in hand, as random discards;
 * never a curse, nor the King card unless a Hollow Crown makes it losable), then the piece leaves the board. The epic
 * version forfeits the piece only, the legendary version the cards only (the piece stays as it is, upgrades already won
 * included). refillLock holds back this turn's whole refill, the played card's active slot too: all of it comes back at
 * the end of the player's next turn.
 * Losing the piece is a removal, not a capture by the winner: Marked is cleared first so it pays no one, and the capture
 * event names the piece's own player (player === c, by null), so no "the opponent captured" trigger fires.
 * Returns true when the duel is over.
 */
function result(ctx, winner) {
	const state = ctx.state, duel = state.duel;
	ctx.emit({ type: "duel-result", winner });
	if (winner !== duel.player) {
		state.duel = null;
		// The epic version loses no cards, so nothing holds its refill back either
		if (duel.card !== "all-or-nothing-epic") {
			ctx.discardRandom(duel.player);
			state.players[duel.player].refillLock = Math.max(state.players[duel.player].refillLock, 1);
		}
		// A target is never a king; a trigger may have taken it already
		if (duel.card !== "all-or-nothing-legendary" && pieceById(state.board, duel.piece) >= 0) {
			statuses.clear(ctx, duel.piece, "marked");
			ctx.capture(duel.player, duel.piece);
		}
		return true;
	}

	duel.wins++;
	duel.step = "decide";
	const square = pieceById(state.board, duel.piece);
	const next = square >= 0 && UPGRADE_BY_TIER[DUEL_TIER[state.board.sq[square].t]];
	if (next === "nb") return void ctx.ask(duel.player, "all-or-nothing", ["n", "b"], { card: "all-or-nothing" });
	return upgrade(ctx, next);
}

/**
 * @description The duel's piece becomes pieceType on its square, same id (a rook's castling right goes with it), with a
 * promote event (the fifty-move count goes on: an upgrade is not a pawn move). A queen ends the duel, as does a piece
 * no longer on the board. Returns true when the duel is over.
 */
function upgrade(ctx, pieceType) {
	const state = ctx.state, duel = state.duel, board = state.board, square = pieceById(board, duel.piece);
	if (square < 0) { // taken by a trigger mid-duel: nothing to upgrade
		state.duel = null;
		return true;
	}
	if (board.sq[square].t === "r") {
		for (const right of CASTLING_LOST[square] || "") board.castling = board.castling.replace(right, "");
		board.castling = board.castling || "-";
	}
	board.sq[square].t = pieceType;
	ctx.emit({ type: "promote", player: duel.player, piece: duel.piece, t: pieceType });
	if (pieceType !== "q") return false;
	state.duel = null;
	return true;
}

/**
 * @description A view's copy of the duel (changed in place): no deck, and every card not yet flipped (a pick both
 * players have made at that depth) is null, for both players: picks are face down to their owner too.
 */
function hide(duel) {
	for (const set of [duel, duel.spades].filter(Boolean)) {
		delete set.deck;
		const flipped = Math.min(set.picked.w.length, set.picked.b.length);
		for (const color of ["w", "b"]) {
			const shown = set.picked[color].slice(0, flipped);
			set.hands[color] = set.hands[color].map((card, i) => (shown.includes(i) ? card : null));
		}
	}
}

/**
 * @description fromView: the hidden cards (null) and the deck dealt again from ctx.rng out of the cards not shown.
 */
function fill(ctx, duel) {
	for (const [set, all] of [[duel, deck52()], [duel.spades, spades13()]]) {
		if (!set) continue;
		const known = [...set.hands.w, ...set.hands.b].filter(Boolean);
		const pool = ctx.rng.shuffle(all.filter((card) => !known.some((knownCard) => knownCard.r === card.r && knownCard.s === card.s)));
		for (const color of ["w", "b"]) set.hands[color] = set.hands[color].map((card) => card || pool.pop());
		set.deck = pool;
	}
}

module.exports = { start, actions, act, upgrade, hide, fill };
