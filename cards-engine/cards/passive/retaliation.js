/*
 *  retaliation.js  --  chess cards engine
 *	Passive: your piece is captured; you may recapture next turn without a card. Debuff: if you don't recapture, discard a card.
 *
 */

const { legalMoves } = require("../../rules.js");
const { pieceById } = require("../../board.js");
const { kingFree } = require("../../hand.js");

const cardless = (m) => (m.promotion ? { type: "move", card: null, from: m.from, to: m.to, promotion: m.promotion } : { type: "move", card: null, from: m.from, to: m.to });

module.exports = {
	key: "retaliation", kind: "passive", name: "Retaliation", skulls: 1, rarity: "uncommon",
	text: "Your piece is captured → you may recapture next turn without a card. Debuff: if you don't recapture, discard a card.",
	on: {
		/**
		 * @description Armed by the first capture of one of owner's pieces by a piece still on the board (one an earlier trigger, e.g. owner's Overwatch, already took can't be recaptured): card.target = that piece's id (it stays in Board Effects). Fires when owner then takes the target, by any means.
		 */
		capture(ctx, owner, ev, src) {
			const c = src.card;
			if (c.target) return ev.piece === c.target && ev.player === owner; // RECAPTURED
			if (ev.c === owner && ev.by && pieceById(ctx.state.board, ev.by) >= 0) c.target = ev.by; // ARMED: OWN DATA ONLY, NO EVENT
			return false;
		},
		/**
		 * @description Armed: owner's next turn-start opens the window (card.open); the opponent's turn-start after it closes it unused: owner discards a random card and it fires.
		 */
		"turn-start"(ctx, owner, ev, src) {
			const c = src.card;
			if (!c.target) return false;
			if (ev.player === owner) { c.open = true; return false; }
			if (!c.open) return false;
			ctx.discardRandom(owner, 1);
			return true;
		},
	},
	rules: {
		/**
		 * @description While the window is open, owner gets a cardless move for each legal capture of the target (a Hexed piece too: Hex stops card moves only), none for a piece already moved in a two-move turn that must use different pieces, none by the king without the King card (hand.kingFree: Hollow Crown).
		 */
		actions(state, player, actions, src) {
			const c = src.card, m = state.multi;
			if (player !== src.owner || !c.open) return actions;
			const free = kingFree(state, player), moves = legalMoves(state, player, (mv) => mv.capture === c.target && !(m && m.differ && m.moved.includes(mv.piece)) && (free || mv.t !== "k"));
			return [...actions, ...moves.map(cardless)];
		},
	},
};
