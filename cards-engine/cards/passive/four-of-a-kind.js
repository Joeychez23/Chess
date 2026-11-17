/*
 *  four-of-a-kind.js  --  chess cards engine
 *	Passive: 4 or more of your move cards name the same piece type; move twice this turn. Debuff: afterwards discard your move cards and draw only 4.
 *
 */

const hand = require("../../hand.js");
const { inCheck } = require("../../rules.js");

module.exports = {
	key: "four-of-a-kind", kind: "passive", name: "Four of a Kind", skulls: 2, rarity: "uncommon",
	text: "4 or more of your move cards name the same piece type → move twice this turn. Debuff: afterwards discard your move cards and draw only 4.",
	on: {
		/**
		 * @description Start of owner's turn (not a lost one): 4+ of owner's move cards as owner sees them (hand.moveCards: an entered Mirage counts as its fake type, so firing or not never tells its holder which card it is) name one piece type and that two-move turn has a move to make (else it keeps waiting: with multi set only moves are offered): a two-move turn (turn.js; the same piece may move twice), whose end-of-turn refill throws out owner's move cards and draws only 4 (multi.draw, hand.refill). Fires.
		 */
		"turn-start"(ctx, owner, ev) {
			const s = ctx.state, p = s.players[owner], n = {};
			if (ev.player !== owner || (p.lostTurns > 0 && !(p.king && p.kingSkulls > 0 && inCheck(s, owner)))) return false; // A LOST TURN (turn.startTurn) WOULD WASTE IT
			if (!hand.moveCards(p).some((c) => (n[c.piece] = (n[c.piece] || 0) + 1) >= 4)) return false;
			const multi = { player: owner, left: 2, moved: [], differ: false, draw: 4 }, { legalActions } = require("../../turn.js"); // LAZY: AS double-time.js
			if (!legalActions({ ...s, pending: null, multi }, owner).some((a) => a.type === "move")) return false; // NO MOVE TO MAKE: FIRING WOULD HIDE THE ACTIVES (noAction COULD END THE GAME)
			s.multi = multi;
			return true;
		},
	},
};
