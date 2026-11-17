/*
 *  traitors-mark.js  --  chess cards engine
 *	Curse: the next piece you move becomes Marked. Fires once, then discarded.
 *
 */

const { pieceById } = require("../../board.js");

const other = (c) => (c === "w" ? "b" : "w");

module.exports = {
	key: "traitors-mark", kind: "curse", name: "Traitor's Mark", rarity: "common",
	text: "The next piece you move becomes Marked. Fires once, then discarded.",
	on: {
		/**
		 * @description Its holder moves a piece other than the king (any move: a card, cardless; a king is never Marked, so a king move or a castle leaves it waiting): that piece is Marked for the default 3 turns (given by the opponent), then the curse leaves through ctx.clearCurse. Fires.
		 */
		move(ctx, owner, ev, src) {
			const b = ctx.state.board, q = b.sq[pieceById(b, ev.piece)];
			if (ev.player !== owner || !q || q.t === "k") return false; // GONE (AN EARLIER HANDLER TOOK IT): NOTHING TO MARK, IT WAITS
			ctx.giveStatus(ev.piece, "marked", 3, other(owner));
			ctx.clearCurse(owner, src.card);
			return true;
		},
	},
};
