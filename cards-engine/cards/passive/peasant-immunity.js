/*
 *  peasant-immunity.js  --  chess cards engine
 *	Passive: your king can't be put in check by pawns.
 *
 */

const { hooksFor } = require("../../rules.js");
const { attacksSquare } = require("../../movegen.js");

/**
 * @description Ids of the enemy pawns attacking owner's king on this state with every card rule but this passive (entry src): the pawn checks it stops.
 */
function pawnChecks(state, owner, src) {
	const rest = { ...state, effects: state.effects.filter((e) => e.id !== src.id) }, hooks = hooksFor(rest), sq = state.board.sq;
	const k = sq.findIndex((p) => p && p.c === owner && p.t === "k");
	return k < 0 ? [] : sq.filter((p, i) => p && p.c !== owner && p.t === "p" && attacksSquare(rest, i, p, k, hooks)).map((p) => p.id);
}

module.exports = {
	key: "peasant-immunity", kind: "passive", name: "Peasant Immunity", skulls: 0, rarity: "common",
	text: "Your king can't be put in check by pawns.",
	rules: {
		/**
		 * @description While it waits, an enemy pawn gives owner's king no check (it can't take the king, and the squares it attacks are open to the king): every enemy pawn until it first stops a pawn check, then only the pawns recorded then (card.stopping). A promoted pawn is no longer a pawn.
		 */
		givesCheck: (state, piece, src) => piece.t !== "p" || piece.c === src.owner || (!!src.card.stopping && !src.card.stopping.includes(piece.id)),
	},
	on: {
		/**
		 * @description After each real move (either side's): the first time enemy pawns attack owner's king, their ids go into card.stopping (only they stay exempt); the first move after which none of them attacks the king fires it (it leaves Board Effects with no check left behind). Firing at the move that made the pawn check would bring that check back at once.
		 */
		move(ctx, owner, ev, src) {
			const now = pawnChecks(ctx.state, owner, src), rec = src.card.stopping;
			if (!rec) { if (now.length) src.card.stopping = now; return false; }
			return !now.some((id) => rec.includes(id));
		},
	},
};
