/*
 *  escape-artist.js  --  chess cards engine
 *	Passive: while your king is in check, any of your pieces may make a legal move that gets out of check, without a card.
 *
 */

const { legalMoves, inCheck } = require("../../rules.js");

const cardless = (m) => (m.promotion ? { type: "move", card: null, from: m.from, to: m.to, promotion: m.promotion } : { type: "move", card: null, from: m.from, to: m.to });

module.exports = {
	key: "escape-artist", kind: "passive", name: "Escape Artist", skulls: 0, rarity: "rare",
	text: "Your king is in check → any of your pieces may make a legal move that gets out of check, without a card.",
	on: {
		/**
		 * @description Owner's turn starts: card.check records whether owner is in check (the only time owner is in check on its own turn).
		 */
		"turn-start": (ctx, owner, ev, src) => { if (ev.player === owner) src.card.check = inCheck(ctx.state, owner); return false; },
		/**
		 * @description A check on owner raised after turn-start (a check event, or a capture that opened a line during owner's two-move turn, which no check event names): recorded.
		 */
		check: (ctx, owner, ev, src) => { if (ev.player === owner && inCheck(ctx.state, owner)) src.card.check = true; return false; },
		capture: (ctx, owner, ev, src) => { if (inCheck(ctx.state, owner)) src.card.check = true; return false; },
		/**
		 * @description Owner's first action was an active: the check is answered.
		 */
		"card-played": (ctx, owner, ev, src) => { if (ev.player === owner) src.card.check = false; return false; },
		/**
		 * @description Owner's move: a cardless move out of a recorded check fires it. shortcut: a cardless move another card offered (Heretical Subjection, Retaliation) also counts as its use while in check; fine while those overlap rarely.
		 */
		move(ctx, owner, ev, src) {
			if (ev.player !== owner) return false;
			const used = ev.card === null && !!src.card.check;
			src.card.check = false;
			return used;
		},
	},
	rules: {
		/**
		 * @description Owner in check: a cardless move for every legal move (each gets out of check), a Hexed piece's too (Hex stops card moves only), except, in a two-move turn that must use different pieces, a moved piece's.
		 */
		actions(state, player, actions, src) {
			if (player !== src.owner || !inCheck(state, player)) return actions;
			const m = state.multi, moves = legalMoves(state, player, (mv) => !(m && m.differ && m.moved.includes(mv.piece)));
			return [...actions, ...moves.map(cardless)];
		},
	},
};
