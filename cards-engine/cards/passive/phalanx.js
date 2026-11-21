/*
 *  phalanx.js  --  chess cards engine
 *	Passive: three of your pawns side by side can't be captured by pawns.
 *
 */

const { legalMoves } = require("../../rules.js");
const { pieceById } = require("../../board.js");

const other = (c) => (c === "w" ? "b" : "w");
const pawnOf = (sq, i, owner) => i >= 0 && i < 64 && !!sq[i] && sq[i].c === owner && sq[i].t === "p";

/**
 * @description True when the piece with this id is one of owner's pawns with two more of owner's pawns beside it on its rank, three adjacent files in all.
 */
function inLine(state, id, owner) {
	const sq = state.board.sq, i = pieceById(state.board, id), f = i & 7, at = (d) => f + d >= 0 && f + d < 8 && pawnOf(sq, i + d, owner);
	return pawnOf(sq, i, owner) && ((at(-2) && at(-1)) || (at(-1) && at(1)) || (at(1) && at(2)));
}

/**
 * @description True when the opponent has a legal pawn capture of one of owner's lined-up pawns (en passant and promoting captures included) that only this passive (entry src) stops.
 */
function denied(state, owner, src) {
	const rest = { ...state, effects: state.effects.filter((e) => e.id !== src.id) };
	return legalMoves(rest, other(owner)).some((m) => m.capture && m.t === "p" && inLine(state, m.capture, owner));
}

module.exports = {
	key: "phalanx", kind: "passive", name: "Phalanx", skulls: 0, rarity: "uncommon",
	text: "Three of your pawns side by side can't be captured by pawns.",
	rules: {
		/**
		 * @description While it waits, an enemy pawn can't capture one of owner's pawns that stands in a line of three on its rank (en passant and a promoting capture included).
		 */
		canCapture: (state, attacker, target, src) => !(attacker.t === "p" && attacker.c !== src.owner && target.t === "p" && target.c === src.owner && inLine(state, target.id, src.owner)),
	},
	on: {
		/**
		 * @description The opponent's turn starts: card.denied records whether it now stops a pawn capture they could otherwise make. Owner's next turn starts after such a turn: it fires (the capture was blocked for the opponent's whole turn, both moves of a two-move turn too).
		 */
		"turn-start"(ctx, owner, ev, src) {
			if (ev.player === owner) return !!src.card.denied;
			src.card.denied = denied(ctx.state, owner, src);
			return false;
		},
		/**
		 * @description The opponent's first move of a two-move turn (triggers run before multi.left counts down): a pawn capture it now stops on their second move is recorded too.
		 */
		move(ctx, owner, ev, src) {
			const m = ctx.state.multi;
			if (ev.player !== owner && m && m.player === ev.player && m.left > 1 && !src.card.denied) src.card.denied = denied(ctx.state, owner, src);
			return false;
		},
		/**
		 * @description The opponent's turn is skipped (a lost turn): nothing was blocked, so the record is dropped and it keeps waiting.
		 */
		"turn-skipped"(ctx, owner, ev, src) {
			if (ev.player !== owner) src.card.denied = false;
			return false;
		},
	},
};
