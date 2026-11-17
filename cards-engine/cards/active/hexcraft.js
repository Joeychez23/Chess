/*
 *  hexcraft.js  --  chess cards engine
 *	Active: draw 2 random curses and give one to the opponent (the curse limit holds); debuff: your most advanced piece is Marked.
 *
 */

const { inCheck } = require("../../rules.js");
const { CURSE_KEYS } = require("../index.js");

const KEY = "hexcraft";
const other = (c) => (c === "w" ? "b" : "w");

module.exports = {
	key: KEY, kind: "active", name: "Hexcraft", skulls: 1, rarity: "uncommon",
	text: "Draw 2 random curses and give one to the opponent. Obeys the curse limit. Debuff: your most advanced piece is Marked.",
	/**
	 * @description No target; never in check (a random outcome).
	 */
	targets: (state, player) => (inCheck(state, player) ? [] : [null]),
	/**
	 * @description The player's most advanced non-king piece (nearest the far rank; a tie by state.rng) is Marked for the default 3 turns. Unless the curse limit blocks the giving (the opponent holds 2 curses or player still waits), 2 different curse keys are drawn (state.rng) and player chooses which the opponent gets.
	 */
	play(ctx, player) {
		const s = ctx.state, sq = s.board.sq, rank = (i) => (player === "w" ? -Math.floor(i / 8) : Math.floor(i / 8));
		const mine = sq.map((p, i) => i).filter((i) => sq[i] && sq[i].c === player && sq[i].t !== "k");
		const top = Math.max(...mine.map(rank)), front = mine.filter((i) => rank(i) === top);
		if (front.length) ctx.giveStatus(sq[ctx.rng.pick(front)].id, "marked");
		if (s.players[other(player)].curses.length >= 2 || s.players[player].curseWait > 0) return; // THE SAME TEST AS ctx.js giveCurse (KEEP THEM IN STEP): IT WOULD REFUSE, SO DRAW AND ASK NOTHING
		const drawn = ctx.rng.shuffle([...CURSE_KEYS]).slice(0, 2);
		if (drawn.length) ctx.ask(player, KEY, drawn, { card: KEY });
	},
	choice: {
		/**
		 * @description The chosen curse goes to the opponent through ctx.giveCurse.
		 */
		resolve(ctx, pending, option) { ctx.giveCurse(other(pending.player), option, pending.player); },
	},
};
