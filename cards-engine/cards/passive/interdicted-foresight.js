/*
 *  interdicted-foresight.js  --  chess cards engine
 *	Passive: the opponent plays Foresight (any version); it is cancelled and they see the same number of fake random cards instead. Rare version: you also see a random half of the opponent's hand until the end of your next turn.
 *
 */

const { CARDS, ACTIVE_KEYS, PASSIVE_KEYS, baseKey } = require("../index.js");
const { resight } = require("../sight.js");

const KEY = "interdicted-foresight";
const other = (c) => (c === "w" ? "b" : "w");
const hidden = (p) => [...p.moves, ...p.actives, ...(p.passive ? [p.passive] : [])]; // FORESIGHT'S POOL: CURSES ARE SHOWN ANYWAY
const kindOf = (card) => (card.key === "move" ? "move" : CARDS[card.key] && CARDS[card.key].kind);

/**
 * @description A fake of card's kind wearing card's id, so in the view it sorts among the real cards: a move card of a random piece type color has on the board (king aside, as a draw), or a random active or passive key a hand could hold (state.rng): never Interdicted Foresight itself (it was just used), and no active whose baseKey one of taken (the other fakes shown with it) already has. Known tells, accepted (the firing is public): a later play or move of the card under a fake shows the real card; a passive placed from under a fake shows its real key; Echo's copy gets a fake though its key is the Foresight player's own card; Pickpocket's take-back offers a fake's card as a token, not by id; with only a king left a move-card fake is the real card.
 */
function fake(ctx, color, card, taken) {
	if (card.key === "move") {
		const types = ctx.state.board.sq.filter((q) => q && q.c === color && q.t !== "k").map((q) => q.t);
		return { id: card.id, key: "move", piece: types.length ? ctx.rng.pick(types) : card.piece };
	}
	const all = kindOf(card) === "passive" ? PASSIVE_KEYS : ACTIVE_KEYS, used = taken.filter((f) => f.key !== "move").map((f) => baseKey(f.key));
	const keys = all.filter((k) => baseKey(k) !== KEY && !used.includes(baseKey(k)));
	return { id: card.id, key: ctx.rng.pick(keys.length ? keys : all) }; // shortcut: uniform, not rarity-weighted like a draw; fine while the fakes only need to look possible
}

/**
 * @description A fakes entry (an enchantment of this key with data.fake) hears that a card may have left the opponent's hand: its owner's sight is rebuilt, which drops a fake whose card is gone. A placed passive (src.card) ignores it.
 */
const watch = (ctx, owner, ev, src) => {
	if (!src.card && src.data && src.data.fake) resight(ctx.state, src.owner);
	return false;
};

module.exports = {
	key: KEY, kind: "passive", name: "Interdicted Foresight", skulls: 0, rarity: "common",
	text: "Opponent plays Foresight → it is cancelled and they see the same number of fake random cards instead.",
	versions: [{ rarity: "rare", text: "Opponent plays Foresight → it is cancelled and they see the same number of fake random cards instead. You also see a random half of the opponent's hand until the end of your next turn." }],
	on: {
		/**
		 * @description The opponent plays Foresight in any version (baseKey), not already cancelled: it is cancelled; a fake (state.rng) wears the id of each of as many of owner's hidden cards as it would have shown (half rounded up, the whole hand for a whole-hand version), picked from all not face up (one under a card the opponent sees for real gives way in the view, and shows once that sight ends); they last in a fakes entry (owned by the opponent, data { fake, whole }) as long as that version would have (epic 3 turns, else 1; fresh, as Foresight's own). Rare version: owner also sees a random half (rounded up) of the opponent's hidden cards, in an entry of owner's (data.ids) until the end of owner's next turn.
		 */
		"card-played"(ctx, owner, ev, src) {
			if (!src.card) return watch(ctx, owner, ev, src);
			if (ev.player === owner || ctx.cancelled || baseKey(ev.card.key) !== "foresight") return false;
			ctx.cancel();
			const s = ctx.state, opp = ev.player, pool = hidden(s.players[owner]), whole = ev.card.key !== "foresight"; // EVERY FORESIGHT VERSION (rare, epic) SEES THE WHOLE HAND
			const fakes = [];
			for (const c of ctx.rng.shuffle(pool.filter((x) => !x.faceUp)).slice(0, whole ? pool.length : Math.ceil(pool.length / 2))) fakes.push(fake(ctx, owner, c, fakes));
			ctx.enchant(opp, KEY, [], ev.card.key === "foresight-epic" ? 3 : 1, { fake: fakes, whole }); // FORESIGHT'S OWN DURATIONS (foresight.js)
			resight(s, opp);
			if (src.card.key === KEY + "-rare") {
				const ids = ctx.rng.shuffle(hidden(s.players[opp]).map((c) => c.id));
				ctx.enchant(owner, KEY, [], 1, { ids: ids.slice(0, Math.ceil(ids.length / 2)) });
				resight(s, owner);
			}
			return true;
		},
		/**
		 * @description A whole-hand fakes entry: a card the opponent draws gets a fake too, as a whole-hand Foresight would show it (a lost draw too, so its draw event carries a fake; the view drops it, as the card isn't held). Not in a state rebuilt from a view (fromView: no data.fake).
		 */
		draw(ctx, owner, ev, src) {
			if (src.card || !src.data || !src.data.whole || !src.data.fake || ev.player !== other(src.owner) || ev.card.faceUp) return false;
			if (!["move", "active", "passive"].includes(kindOf(ev.card))) return false;
			const held = new Set(hidden(ctx.state.players[ev.player]).map((c) => c.id));
			src.data.fake.push(fake(ctx, ev.player, ev.card, src.data.fake.filter((f) => held.has(f.id) && f.id !== ev.card.id)));
			resight(ctx.state, src.owner);
			return false;
		},
		move: watch, discard: watch, "card-taken": watch, redraw: watch, "passive-placed": watch, "turn-start": watch, // EVERY WAY A CARD LEAVES A HAND; turn-start CATCHES THE REST
		/**
		 * @description An entry of this key ended: its owner's sight is rebuilt without it (a running Foresight's sight stays).
		 */
		"enchant-ended"(ctx, owner, ev, e) {
			if (!e.card) resight(ctx.state, owner);
			return false;
		},
	},
};
