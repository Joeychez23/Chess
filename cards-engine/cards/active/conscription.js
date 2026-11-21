/*
 *  conscription.js  --  chess cards engine
 *	Active: one of your pawns becomes one of your captured pieces (queen allowed); it is Shaken for 2 turns and Marked.
 *
 */

const { pieceById } = require("../../board.js");

const KEY = "conscription";

module.exports = {
	key: KEY, kind: "active", name: "Conscription", skulls: 3, rarity: "legendary",
	text: "Turn a pawn into one of your captured pieces (queen allowed). Debuff: the revived piece is Shaken for 2 turns and Marked.",
	/**
	 * @description { piece, t } for every own pawn and every non-pawn type in player's captured list (queen, rook, bishop, knight order).
	 */
	targets(state, player) {
		const lost = [..."qrbn"].filter((t) => state.players[player].captured.includes(t));
		return state.board.sq.filter((p) => p && p.c === player && p.t === "p").flatMap((p) => lost.map((t) => ({ piece: p.id, t })));
	},
	/**
	 * @description The pawn becomes a t on its square (same id); one t leaves player's captured list; a promote event; the half-move counter resets (a pawn is gone, as in a promotion); Shaken for 2 turns and Marked with no end.
	 */
	play(ctx, player, target) {
		const s = ctx.state, lost = s.players[player].captured;
		s.board.sq[pieceById(s.board, target.piece)].t = target.t;
		lost.splice(lost.indexOf(target.t), 1);
		ctx.resetHalf = true;
		ctx.emit({ type: "promote", player, piece: target.piece, t: target.t });
		ctx.giveStatus(target.piece, "shaken", 2);
		ctx.giveStatus(target.piece, "marked", null);
	},
};
