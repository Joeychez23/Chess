/*
 *  pickpocket.js  --  chess cards engine
 *	Active: take a random move or active card from the opponent; then the opponent chooses one of your cards to take back. Uncommon version: you pick the card, and the opponent takes one of yours back at random; epic: you pick, nothing is taken back.
 *
 */

const hand = require("../../hand.js");
const { inCheck } = require("../../rules.js");

const other = (c) => (c === "w" ? "b" : "w");
const byId = (a, b) => Number(a.slice(1)) - Number(b.slice(1));
const takeable = (p) => [...p.moves, ...p.actives]; // NEVER THE KING CARD, THE PASSIVE OR A CURSE

/**
 * @description Move the card with this id from one player's moves or actives to the other's, with a card-taken event { player: taker, from, card }; as in hand.put, a card that doesn't fit under the slot's cap is lost (lost: true on the event).
 */
function steal(ctx, player, from, id) {
	const s = ctx.state, card = hand.take(s.players[from], id), slot = card.key === "move" ? "moves" : "actives";
	const lost = s.players[player][slot].length >= (slot === "moves" ? hand.MOVE_CAP : hand.ACTIVE_CAP);
	if (!lost) s.players[player][slot].push(card);
	ctx.emit(lost ? { type: "card-taken", player, from, card, lost: true } : { type: "card-taken", player, from, card });
}

/**
 * @description The play of a version where the taker picks: player chooses among the opponent's move and active card ids, in id order (pending.show: view.js shows player those cards while this choice is current, and only then); with back, the opponent then takes one of player's cards at random.
 */
const pick = (back) => (ctx, player) => {
	const opp = other(player);
	ctx.ask(player, "pick", takeable(ctx.state.players[opp]).map((c) => c.id).sort(byId), { card: "pickpocket", from: opp, show: true, back });
};
const PICK = "Take a move or active card of your choice from the opponent (never the King card, passives or curses).";

module.exports = {
	key: "pickpocket", kind: "active", name: "Pickpocket", skulls: 1, rarity: "common",
	text: "Take a random move or active card from the opponent (never the King card, passives or curses). Debuff: the opponent chooses one of your cards to take back.",
	/**
	 * @description No target; needs a move or active card in the opponent's hand; never in check (a random outcome).
	 */
	targets(state, player) {
		const o = state.players[other(player)];
		return o.moves.length + o.actives.length && !inCheck(state, player) ? [null] : [];
	},
	/**
	 * @description Take a random move or active card (state.rng), then ask the opponent (out of turn) which of player's cards to take back. Options: the ids the opponent already knows (the stolen card if player still holds it, and player's move and active cards shown to the opponent), in id order, then blind tokens "?1"…"?k", k = player's hand count as the opponent's view shows it minus those ids. Real ids would tell kinds (ids are handed out in a public order) and their number would tell a hidden passive.
	 */
	play(ctx, player) {
		const s = ctx.state, opp = other(player), p = s.players[player], stolen = ctx.rng.pick(takeable(s.players[opp]));
		steal(ctx, player, opp, stolen.id);
		const { shownTo } = require("../../view.js"); // LAZY: view.js REQUIRES THE REGISTRY, WHICH WILL REQUIRE THIS FILE
		const known = takeable(p).filter((c) => c.id === stolen.id || shownTo(s, opp, c)).map((c) => c.id).sort(byId);
		const count = takeable(p).length + (p.passive ? 1 : 0) + p.curses.length; // view.js hand.count
		ctx.ask(opp, "pickpocket", [...known, ...Array.from({ length: count - known.length }, (_, i) => "?" + (i + 1))], { card: "pickpocket", from: player, stolen: stolen.id });
	},
	versions: [
		{ rarity: "uncommon", text: PICK + " Debuff: the opponent takes one of your cards back at random.", play: pick(true) },
		{ rarity: "epic", skulls: 0, text: PICK + " The opponent takes nothing back.", play: pick(false) },
	],
	choice: {
		/**
		 * @description A version's pick (kind "pick"): the taker takes the chosen card, then with pending.back the opponent takes a uniform random one (state.rng) of the taker's move and active cards. Otherwise the opponent takes back the chosen card. A token takes a uniform random pick (state.rng) among player's move and active cards not named in the options; with none, the stolen card if player still holds it, else nothing.
		 */
		resolve(ctx, pending, option) {
			if (pending.kind === "pick") {
				steal(ctx, pending.player, pending.from, option);
				const mine = takeable(ctx.state.players[pending.player]);
				if (pending.back && mine.length) steal(ctx, pending.from, pending.player, ctx.rng.pick(mine).id);
				return;
			}
			const held = takeable(ctx.state.players[pending.from]), unknown = held.filter((c) => !pending.options.includes(c.id));
			const card = held.find((c) => c.id === option) || (unknown.length ? ctx.rng.pick(unknown) : held.find((c) => c.id === pending.stolen));
			if (card) steal(ctx, pending.player, pending.from, card.id);
		},
	},
};
