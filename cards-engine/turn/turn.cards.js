/*
 *  turn.cards.js  --  chess cards engine
 *	The card actions and how they resolve: actives, the passive, the free discard, the drops and card-defined actions.
 *
 */

const { inCheck } = require("../rules.js");
const hand = require("../hand.js");
const { CARDS, baseKey } = require("../cards/index.js");
const { actionKey, trialCtx, sidesInCheck } = require("./turn.shared.js");

// How many placed passives may wait in Board Effects for one player; how many move cards the free discard takes in one turn
const PASSIVES = 3, MOVE_DISCARDS = 2;

/**
 * @description The active actions for color: one per target the card offers ([null] means no target). Each is tried on
 * a copy and dropped when its play leaves color's king in check, so in check only those that end it are offered.
 * only (isLegal): just that action, tried alone.
 * Limit: the copy rolls the real rng, so for an active with a random outcome legalActions would show whether its roll
 * leaves the king in check. So no active playable in check may have a random outcome, and no active's random outcome
 * may expose its own king. Card handlers (on, play, rules) also run inside these trials, so a test that counts handler
 * calls through a closure counts the trials too.
 */
function activeActions(state, color, only) {
	const actions = [];
	for (const card of state.players[color].actives) {
		const def = CARDS[card.key];
		if (!def || !def.targets || (only && card.id !== only.card)) continue;
		for (const target of def.targets(state, color)) {
			const action = target === null ? { type: "active", card: card.id } : { type: "active", card: card.id, target };
			// No trial for another target
			if (only && actionKey(action) !== actionKey(only)) continue;
			const ctx = trialCtx(state);
			playActive(ctx, color, action);
			// An active never leaves its own king in check
			if (!inCheck(ctx.state, color)) actions.push(action);
		}
	}
	return actions;
}

/**
 * @description True when player holds a passive in the hand and its card, if it has a canPlace rule, allows placing it.
 */
function canPlacePassive(state, player) {
	const holder = state.players[player];
	const def = holder.passive && CARDS[holder.passive.key];
	return !!holder.passive && !(def && def.canPlace && !def.canPlace(state, player));
}

/**
 * @description The free discard's actions for player, one card each, { type: "discard", cards: [id] }: each move card
 * in hand order (by id; an entered Mirage shows as a move card), then each active, then the reroll of the passive held
 * in the hand (told apart by the id being the held passive's). The reroll is offered only while another passive is left
 * to draw (hand.drawable): with none it would only lose the card.
 * A turn's free discard is of one kind (state.discarded { player, kind: "move" | "active" | "passive", n }, null until
 * the first): after a move card only move cards, MOVE_DISCARDS a turn; after an active or the reroll nothing. A saved
 * game's old mark (the colour alone) reads as used up. Never the King card, a curse or a passive placed in Board Effects.
 */
function freeDiscards(state, player) {
	const holder = state.players[player], done = state.discarded;
	const moveIds = !done || (done.kind === "move" && done.n < MOVE_DISCARDS) ? hand.moveCards(holder).map((card) => card.id) : [];
	// hand.drawable already leaves the held passive out
	const reroll = holder.passive && hand.drawable(state, player, "passive").length ? [holder.passive.id] : [];
	const otherIds = done ? [] : [...holder.actives.map((card) => card.id), ...reroll];
	return [...moveIds, ...otherIds].map((id) => ({ type: "discard", cards: [id] }));
}

/**
 * @description The drops for player, { type: "drop", card: <card id> }: each of player's own waiting passives (by
 * placedAt), then each of player's actives in effect (inEffect: one with a live enchantment). only (isLegal): just the
 * card with that id. Free, any number a turn, and not the free discard.
 * A drop that, tried on a copy, would put either king in check is left out: ending a Stronghold whose piece faces the
 * enemy king would let the next move take it. blind keeps those in, for view.playerLegal only.
 * Never the other player's card, a curse or a status: a harmful effect on the player is none of their placed cards.
 */
function dropActions(state, player, blind, only) {
	const waiting = waitingPassives(state, player).map((entry) => entry.id);
	const lasting = inEffect(state, player).filter((pair) => pair[1]).map((pair) => pair[0].id);
	const ids = [...waiting, ...lasting].filter((id) => only === undefined || id === only);
	const checkedBefore = ids.length ? sidesInCheck(state) : [];
	const actions = ids.map((card) => ({ type: "drop", card }));
	// The list told under the other player's fog (view.playerLegal): a check would show where a hidden piece stands,
	// so applyAction refuses such a drop instead
	if (blind) return actions;
	return actions.filter((action) => dropKeepsChecks(state, player, action, checkedBefore));
}

/**
 * @description player's passives waiting in Board Effects, oldest placed first.
 */
function waitingPassives(state, player) {
	return state.effects.filter((entry) => entry.owner === player).sort((a, b) => a.placedAt - b.placedAt);
}

/**
 * @description color's active spot as [card, entry] pairs, oldest card first. entry is the enchantment that keeps the
 * card in effect: color's own, with the card's base key (the newest card takes the newest). It is undefined for a card
 * with none: that card only waits for the end of the turn (sweepActiveSpots).
 */
function inEffect(state, color) {
	const live = state.enchant.filter((entry) => entry.owner === color);
	const pairs = [];
	for (const card of [...(state.players[color].spot || [])].reverse()) {
		const index = live.map((entry) => baseKey(entry.key)).lastIndexOf(baseKey(card.key));
		pairs.push([card, index < 0 ? undefined : live.splice(index, 1)[0]]);
	}
	return pairs.reverse();
}

/**
 * @description True when the drop, tried on a copy, puts no king in check that wasn't in check before it.
 */
function dropKeepsChecks(state, player, action, checkedBefore) {
	const ctx = trialCtx(state);
	resolveDrop(ctx, player, action);
	return sidesInCheck(ctx.state).every((color) => checkedBefore.includes(color));
}

/**
 * @description The card whose act resolves a card-defined action: a card player holds (action.card) or player's own
 * enchantment (action.enchant). Returns { def, src } (src: { owner, card } for a held card, the enchant entry for an
 * enchantment), or null when the source is gone, not player's, or its card has no act.
 */
function sourceOf(state, player, action) {
	const holder = state.players[player];
	const held = [...holder.moves, ...holder.actives, ...holder.curses, holder.passive].filter(Boolean)
		.find((card) => card.id === action.card);
	const src = action.enchant !== undefined
		? state.enchant.find((entry) => entry.id === action.enchant && entry.owner === player)
		: held && { owner: player, card: held };
	const def = src && CARDS[src.card ? src.card.key : src.key];
	return def && def.act ? { def, src } : null;
}

/**
 * @description Resolve a drop: player's waiting passive leaves Board Effects (leaveBoardEffects), or player's active
 * in effect goes from the active spot to the discard pile (a card-dropped event) and its enchantment ends the way it
 * always ends (ctx.endEnchant: its card's own ending runs, so a debuff that comes at the end comes too).
 */
function resolveDrop(ctx, player, action) {
	const state = ctx.state, holder = state.players[player];
	const waiting = state.effects.find((effect) => effect.owner === player && effect.id === action.card);
	if (waiting) return leaveBoardEffects(ctx, waiting);
	const [card, entry] = inEffect(state, player).find((pair) => pair[0].id === action.card);
	holder.spot = holder.spot.filter((held) => held !== card);
	hand.toPile(state, player, card);
	ctx.emit({ type: "card-dropped", player, card });
	ctx.endEnchant(entry);
}

/**
 * @description A waiting passive (its effects entry) leaves Board Effects for its owner's discard pile without firing:
 * dropped by its owner, or replaced by a fourth one (replaced). A card-dropped event. The card is not used up (a
 * once-per-game one can be drawn again), but its owner can't draw it again this turn (Player.gone).
 */
function leaveBoardEffects(ctx, waiting, replaced) {
	const state = ctx.state, player = state.players[waiting.owner];
	state.effects = state.effects.filter((entry) => entry.id !== waiting.id);
	(player.gone = player.gone || []).push(baseKey(waiting.card.key));
	hand.toPile(state, waiting.owner, waiting.card);
	ctx.emit(replaced
		? { type: "card-dropped", player: waiting.owner, card: waiting.card, replaced }
		: { type: "card-dropped", player: waiting.owner, card: waiting.card });
}

/**
 * @description The free discard of one card. state.discarded { player, kind, n } marks the turn's kind and count
 * (freeDiscards).
 * - The held passive: the reroll. It goes, and a different passive is drawn at once. It isn't used up, so a later
 *   turn's draw can bring it back.
 * - A move card: the first one is remembered (Player.kept). The next one discarded, this turn or a later one, draws 1
 *   move card back at once, at random (the dropped card's floor: see hand.drawMove), and both go to the discard pile.
 * - An active: a new one comes with this turn's refill.
 */
function resolveDiscard(ctx, player, action) {
	const state = ctx.state, holder = state.players[player];
	const id = action.cards[0], done = state.discarded;
	if (holder.passive && id === holder.passive.id) {
		const card = holder.passive;
		holder.passive = null;
		hand.toPile(state, player, card, true);
		(holder.gone = holder.gone || []).push(baseKey(card.key));
		ctx.emit({ type: "discard", player, card });
		hand.drawCard(ctx, player, "passive", card.key);
		state.discarded = { player, kind: "passive", n: 1 };
	} else if (hand.moveCards(holder).some((card) => card.id === id)) {
		const kept = holder.kept;
		if (kept) {
			hand.toPile(state, player, kept, true);
			holder.kept = null;
		}
		hand.discard(ctx, player, id, !kept);
		if (kept) hand.drawMove(ctx, player);
		state.discarded = { player, kind: "move", n: (done ? done.n : 0) + 1 };
	} else {
		hand.discard(ctx, player, id);
		state.discarded = { player, kind: "active", n: 1 };
	}
}

/**
 * @description Place the held passive in Board Effects, with a passive-placed event. At most PASSIVES wait: with that
 * many already there, the oldest leaves first, one for one (a game saved with more keeps the rest).
 */
function placePassive(ctx, player) {
	const state = ctx.state, holder = state.players[player];
	const waiting = waitingPassives(state, player);
	if (waiting.length >= PASSIVES) leaveBoardEffects(ctx, waiting[0], true);
	state.effects.push({ id: holder.passive.id, owner: player, card: holder.passive, placedAt: state.ply });
	ctx.emit({ type: "passive-placed", player, card: holder.passive });
	holder.passive = null;
}

/**
 * @description Play an active card: it leaves the hand for color's active spot (Player.spot; sweepActiveSpots takes it
 * to the discard pile), card-played is emitted, then the card's play runs. If a handler of card-played called
 * ctx.cancel(), the card stays spent and a card-cancelled event replaces the play. Every handler of card-played still
 * runs, and later ones can read ctx.cancelled.
 */
function playActive(ctx, color, action) {
	const player = ctx.state.players[color], card = hand.take(player, action.card);
	(player.spot = player.spot || []).push(card);
	ctx.cancelled = false;
	ctx.emit({ type: "card-played", player: color, card });
	if (ctx.cancelled) return ctx.emit({ type: "card-cancelled", player: color, card });
	CARDS[card.key].play(ctx, color, action.target === undefined ? null : action.target);
}

/**
 * @description Resolve a card-defined action through its source card's act(ctx, player, action, src).
 */
function cardAct(ctx, player, action) {
	const { def, src } = sourceOf(ctx.state, player, action);
	def.act(ctx, player, action, src);
}

module.exports = {
	PASSIVES, activeActions, canPlacePassive, freeDiscards, dropActions, inEffect, sourceOf, cardAct, resolveDrop,
	resolveDiscard, placePassive, playActive,
};
