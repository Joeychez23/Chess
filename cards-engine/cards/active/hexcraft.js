/*
 *  hexcraft.js  --  chess cards engine
 *	Active: draw 2 random curses and give one to the opponent (the curse limit holds); debuff: your most advanced piece is Marked. Legendary version: give both, the opponent may hold up to 4 curses, no wait, no Marked piece.
 *
 */

const { inCheck } = require("../../rules.js");

const KEY = "hexcraft";
const other = (c) => (c === "w" ? "b" : "w");
const LEGENDARY = { max: 4, wait: false }; // THE LEGENDARY VERSION'S CURSE LIMIT: UP TO 4 HELD, NO 5-TURN WAIT (AND NONE STARTED)

module.exports = {
	key: KEY, kind: "active", name: "Hexcraft", skulls: 1, rarity: "uncommon",
	text: "Draw 2 random curses and give one to the opponent. Obeys the curse limit. Debuff: your most advanced piece is Marked.",
	/**
	 * @description No target; never in check (a random outcome).
	 */
	targets: (state, player) => (inCheck(state, player) ? [] : [null]),
	/**
	 * @description The player's most advanced non-king piece (nearest the far rank; a tie by state.rng) is Marked for the default 3 turns. Unless the curse limit blocks the giving (canCurse), 2 different curse keys the opponent does not hold are drawn by rarity (ctx.randomCurses) and player chooses which the opponent gets.
	 */
	play(ctx, player) {
		const s = ctx.state, sq = s.board.sq, rank = (i) => (player === "w" ? -Math.floor(i / 8) : Math.floor(i / 8));
		const mine = sq.map((p, i) => i).filter((i) => sq[i] && sq[i].c === player && sq[i].t !== "k");
		const top = Math.max(...mine.map(rank)), front = mine.filter((i) => rank(i) === top);
		if (front.length) ctx.giveStatus(sq[ctx.rng.pick(front)].id, "marked");
		if (!require("../../ctx.js").canCurse(s, other(player), player)) return; // giveCurse WOULD REFUSE: DRAW AND ASK NOTHING (LAZY: A CARD FILE LOADED FROM cards/index.js WOULD GET ctx.js HALF-LOADED)
		const drawn = ctx.randomCurses(2, other(player));
		if (drawn.length) ctx.ask(player, KEY, drawn, { card: KEY });
	},
	versions: [{
		rarity: "legendary", skulls: 0,
		text: "Give the opponent both curses. Overrides the curse limit: the opponent may hold up to 4 curses (at 3 it gives one). Ignores the 5-turn wait. No Marked piece.",
		/**
		 * @description No target; only while the opponent holds fewer than 4 curses (canCurse with LEGENDARY: the wait is ignored); never in check (a random outcome).
		 */
		targets: (state, player) => (!inCheck(state, player) && require("../../ctx.js").canCurse(state, other(player), player, LEGENDARY) ? [null] : []),
		/**
		 * @description 2 different curse keys the opponent does not hold, drawn by rarity (ctx.randomCurses), both given to the opponent through ctx.giveCurse with LEGENDARY, in drawn order (at 3 held the second is refused). Nothing is Marked; no choice.
		 */
		play(ctx, player) {
			for (const key of ctx.randomCurses(2, other(player))) ctx.giveCurse(other(player), key, player, LEGENDARY);
		},
	}],
	choice: {
		/**
		 * @description The chosen curse goes to the opponent through ctx.giveCurse.
		 */
		resolve(ctx, pending, option) { ctx.giveCurse(other(pending.player), option, pending.player); },
	},
};
