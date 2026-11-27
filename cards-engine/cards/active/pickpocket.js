/*
 *  pickpocket.js  --  chess cards engine
 *	Active: take a random move or active card from the opponent; then the opponent chooses one of your cards to take back.
 *	Uncommon version: you pick the card, and the opponent takes one of yours back at random; epic: you pick, nothing is
 *	taken back.
 *
 */

const hand = require("../../hand.js");
const { inCheck } = require("../../rules.js");

const PICK_TEXT = "Take a move or active card of your choice from the opponent (never the King card, passives or curses).";

function other(color) {
	return color === "w" ? "b" : "w";
}

/**
 * @description Sorts card ids in id order, "king" first.
 */
function byId(a, b) {
	return (Number(a.slice(1)) || 0) - (Number(b.slice(1)) || 0);
}

/**
 * @description The cards a player can lose to Pickpocket: never the passive or a curse; the King card only under Hollow Crown.
 */
function takeable(player) {
	return [...player.moves, ...player.actives, ...hand.kingCard(player)];
}

/**
 * @description Move the card with this id from one player's moves or actives to the other's, with a card-taken event
 * { player: taker, from, card }; as in hand.put, a card that doesn't fit under the slot's cap is lost (lost: true on the
 * event). A King card (Hollow Crown) is lost unless the taker has none (Player.king).
 */
function steal(ctx, player, from, id) {
	const state = ctx.state, card = hand.take(state.players[from], id), slot = card.key === "move" ? "moves" : "actives";
	const taker = state.players[player];
	const held = slot === "moves" ? hand.moveCards(taker) : taker[slot]; // an entered Mirage counts
	const cap = slot === "moves" ? hand.MOVE_CAP : hand.ACTIVE_CAP;
	const lost = card.key === "king" ? taker.king : held.length >= cap;
	if (!lost && card.key === "king") taker.king = true;
	else if (!lost) taker[slot].push(card);
	ctx.emit(lost ? { type: "card-taken", player, from, card, lost: true } : { type: "card-taken", player, from, card });
}

/**
 * @description The play of a version where the taker picks: player chooses among the opponent's move and active card
 * ids, in id order (pending.show: view.js shows player those cards while this choice is current, and only then); with
 * back, the opponent then takes one of player's cards at random.
 */
function takerPicks(back) {
	return function play(ctx, player) {
		const opp = other(player);
		const ids = takeable(ctx.state.players[opp]).map((card) => card.id).sort(byId);
		ctx.ask(player, "pick", ids, { card: "pickpocket", from: opp, show: true, back });
	};
}

module.exports = {
	key: "pickpocket", kind: "active", name: "Pickpocket", skulls: 1, rarity: "common",
	text: "Take a random move or active card from the opponent (never the King card, passives or curses). Debuff: the opponent chooses one of your cards to take back.",
	/**
	 * @description No target; needs a takeable card in the opponent's hand (a move or active card, or a King card a
	 * Hollow Crown makes losable); never in check (a random outcome).
	 */
	targets(state, player) {
		const opponent = state.players[other(player)];
		return takeable(opponent).length && !inCheck(state, player) ? [null] : [];
	},
	/**
	 * @description Take a random move or active card (state.rng), then ask the opponent (out of turn) which of player's
	 * cards to take back. Options: the ids the opponent already knows (the stolen card if player still holds it, and
	 * player's move and active cards shown to the opponent), in id order, then blind tokens "?1"…"?k", k = player's hand
	 * count as the opponent's view shows it minus those ids. Real ids would tell kinds (ids are handed out in a public
	 * order) and their number would tell a hidden passive.
	 */
	play(ctx, player) {
		const state = ctx.state, opp = other(player), mine = state.players[player];
		const stolen = ctx.rng.pick(takeable(state.players[opp]));
		steal(ctx, player, opp, stolen.id);
		const { shownTo } = require("../../view.js"); // lazy: view.js requires the registry, which requires this file
		const known = takeable(mine).filter((card) => card.id === stolen.id || shownTo(state, opp, card)).map((card) => card.id).sort(byId);
		// view.js's hand count, plus the King card under Hollow Crown (it is in known too, face up, so the tokens match)
		const count = takeable(mine).length + (mine.passive ? 1 : 0) + mine.curses.length;
		const tokens = Array.from({ length: count - known.length }, (_, i) => "?" + (i + 1));
		// Nothing to take back (the stolen King card was lost and player holds nothing else): no choice, it would have no answer
		if (!known.length && !tokens.length) return;
		ctx.ask(opp, "pickpocket", [...known, ...tokens], { card: "pickpocket", from: player, stolen: stolen.id });
	},
	versions: [
		{
			rarity: "uncommon",
			text: PICK_TEXT + " Debuff: the opponent takes one of your cards back at random.",
			play: takerPicks(true),
		},
		{ rarity: "epic", skulls: 0, text: PICK_TEXT + " The opponent takes nothing back.", play: takerPicks(false) },
	],
	choice: {
		/**
		 * @description A version's pick (kind "pick"): the taker takes the chosen card, then with pending.back the opponent
		 * takes a uniform random one (state.rng) of the taker's move and active cards. Otherwise the opponent takes back the
		 * chosen card. A token takes a uniform random pick (state.rng) among player's move and active cards not named in the
		 * options; with none, the stolen card if player still holds it, else nothing.
		 */
		resolve(ctx, pending, option) {
			if (pending.kind === "pick") {
				steal(ctx, pending.player, pending.from, option);
				const mine = takeable(ctx.state.players[pending.player]);
				if (pending.back && mine.length) steal(ctx, pending.from, pending.player, ctx.rng.pick(mine).id);
				return;
			}
			const held = takeable(ctx.state.players[pending.from]), unknown = held.filter((heldCard) => !pending.options.includes(heldCard.id));
			const chosen = held.find((heldCard) => heldCard.id === option);
			const card = chosen || (unknown.length ? ctx.rng.pick(unknown) : held.find((heldCard) => heldCard.id === pending.stolen));
			if (card) steal(ctx, pending.player, pending.from, card.id);
		},
	},
};
