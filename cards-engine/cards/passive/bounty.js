/*
 *  bounty.js  --  chess cards engine
 *	Passive: you capture the enemy queen; steal a random card from their hand.
 *
 */

const hand = require("../../hand.js");

const other = (c) => (c === "w" ? "b" : "w");

module.exports = {
	key: "bounty", kind: "passive", name: "Bounty", skulls: 0, rarity: "uncommon",
	text: "You capture the enemy queen → steal a random card from their hand.",
	on: {
		/**
		 * @description Owner takes an enemy queen (by a piece or a card): a random move or active card of the opponent's (state.rng; only a move or active card: never the King card, the passive or a curse, as Pickpocket) moves to owner's hand with a card-taken event { player, from, card }; a card over the slot's cap is lost (lost: true). Fires even when the opponent holds none.
		 */
		capture(ctx, owner, ev) {
			if (ev.player !== owner || ev.c === owner || ev.t !== "q") return false;
			const from = other(owner), o = ctx.state.players[from], p = ctx.state.players[owner], pool = [...o.moves, ...o.actives];
			if (!pool.length) return true;
			const card = hand.take(o, ctx.rng.pick(pool).id), slot = card.key === "move" ? "moves" : "actives";
			const lost = p[slot].length >= (slot === "moves" ? hand.MOVE_CAP : hand.ACTIVE_CAP);
			if (!lost) p[slot].push(card);
			ctx.emit(lost ? { type: "card-taken", player: owner, from, card, lost: true } : { type: "card-taken", player: owner, from, card });
			return true;
		},
	},
};
