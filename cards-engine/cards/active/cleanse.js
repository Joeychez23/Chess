/*
 *  cleanse.js  --  chess cards engine
 *	Active: remove one curse or status from your side (Stronghold's Warded included, which ends it); uses your whole turn.
 *
 */

const statuses = require("../../statuses.js");
const { pieceById } = require("../../board.js");

module.exports = {
	key: "cleanse", kind: "active", name: "Cleanse", skulls: 0, rarity: "common",
	text: "Remove one curse or status from your side. Uses your whole turn.",
	/**
	 * @description { curse: id } for each curse player holds except a Mirage (its holder sees it as a move card, as in playerView), then { piece, s } for each status on player's pieces on the board.
	 */
	targets(state, player) {
		const own = Object.keys(state.statuses).filter((id) => { const p = state.board.sq[pieceById(state.board, id)]; return p && p.c === player; });
		const curses = state.players[player].curses.filter((c) => c.key !== "mirage");
		return [...curses.map((c) => ({ curse: c.id })), ...own.flatMap((piece) => state.statuses[piece].map((e) => ({ piece, s: e.s })))];
	},
	/**
	 * @description A curse leaves the hand (curse-cleared { player, card }), or the status ends (status-ended; a Stronghold hears it and ends). The active is the whole turn.
	 */
	play(ctx, player, target) {
		const p = ctx.state.players[player];
		if (!target.curse) return statuses.clear(ctx, target.piece, target.s);
		const card = p.curses.find((c) => c.id === target.curse);
		p.curses = p.curses.filter((c) => c !== card);
		ctx.emit({ type: "curse-cleared", player, card });
	},
};
