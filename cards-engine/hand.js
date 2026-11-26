/*
 *  hand.js  --  chess cards engine
 *	Move-card and card draws, refill, hand caps and discards.
 *
 */

const { CARDS, ACTIVE_KEYS, PASSIVE_KEYS, RARITY_WEIGHTS, CLIMB_SHARES, CLIMB_END, baseKey } = require("./cards/index.js");
const { resight, isSight } = require("./cards/sight.js");

const HAND_MOVES = 5; // move cards a new hand is dealt and the end-of-turn refill tops up to
const HAND_ACTIVES = 1; // active cards the end-of-turn refill tops up to
const MOVE_CAP = 9; // the most move cards a hand holds: a draw past it is lost
const ACTIVE_CAP = 3; // the most active cards a hand holds: a draw past it is lost
const DISCARD_SHOWN = 6; // the discard list keeps the last 6 cards, both players' in one list (toPile)

// A piece type's value (Underdog counts material with it) and a move card type's (the old free-discard floor, drawMove).
// "m" is the Knight / Bishop card. This is the one table of values in the engine.
const PIECE_VALUE = { p: 1, n: 3, b: 3, m: 3, r: 5, q: 9 };

// The piece types each move card type moves, the one table of it. One Knight / Bishop card, "m", stands in for the
// knight card and the bishop card.
const CARD_MOVES = { p: "p", m: "nb", r: "r", q: "q" };

const PAWN_WEIGHT = 6; // the most pawns the move-card draw counts: 8 on the board draw as 6

// Divides by every held count + 1 a hand can reach (1 to 10, MOVE_CAP + 1), so the move-card draw's weights are whole
// numbers for rng.int.
const HELD_SCALE = 2520;

/* ---- Card lookups ---- */

/**
 * @description The move card type that moves a piece of this type: "m" for a knight or a bishop, otherwise the piece
 * type itself (CARD_MOVES). Undefined for a king.
 */
function cardOf(pieceType) {
	return Object.keys(CARD_MOVES).find((type) => CARD_MOVES[type].includes(pieceType));
}

/**
 * @description True when a move card of type `piece` moves a piece of this type (CARD_MOVES). An unknown card type
 * (an old Knight or Bishop card) moves nothing.
 */
function fits(piece, pieceType) {
	return (CARD_MOVES[piece] || "").includes(pieceType);
}

function byId(left, right) {
	return Number(left.id.slice(1)) - Number(right.id.slice(1));
}

/**
 * @description A copy of card as its holder saw it. A Mirage becomes the move card it showed, naming no curse, so on the
 * discard pile or remembered it cannot be told apart (by the pile's count or its top).
 */
function asMove(card) {
	if (baseKey(card.key) === "mirage") return { id: card.id, key: "move", piece: card.piece };
	return { ...card };
}

/**
 * @description The Mirages in the player's curses that have entered the hand. The holder sees each one as a move card,
 * so every count, list and order of move cards takes them in. A waiting Mirage, not yet entered, is in none of them.
 */
function mirages(player) {
	return player.curses.filter((curse) => baseKey(curse.key) === "mirage" && !curse.waiting);
}

/**
 * @description The player's move cards as the holder sees them: the real ones and the entered Mirages, sorted by id
 * (the order playerView shows).
 */
function moveCards(player) {
	return [...player.moves, ...mirages(player)].sort(byId);
}

/**
 * @description The player's King card as a takeable card, [{ id: "king", key: "king", faceUp: true }], while a Hollow
 * Crown makes it losable and the player still has it; otherwise []. It is face up because Player.king is public.
 * Random discards and Pickpocket put it in their pools, and take removes it.
 */
function kingCard(player) {
	if (player.king && player.curses.some((curse) => baseKey(curse.key) === "hollow-crown")) {
		return [{ id: "king", key: "king", faceUp: true }];
	}
	return [];
}

/**
 * @description The one test for "may a card move color's own king for color": true while color still has its King card
 * (Player.king; a Hollow Crown can take it).
 * turn.kingMoves, Last Stand, Swap and Retaliation ask it. Escape Artist alone moves the king without it (see the
 * catalog), and cards of the opponent that move it do not ask.
 */
function kingFree(state, color) {
	return !!state.players[color].king;
}

/* ---- Making a card and placing it ---- */

/**
 * @description The one way the engine makes a card: { id: "c<nextId>", key, ...extra }, bumping state.nextId.
 */
function newCard(state, key, extra) {
	return { id: "c" + state.nextId++, key, ...extra };
}

/**
 * @description The card joins color's discard pile, Player.pile { n, top }: only how many cards lie there and the top
 * card are kept.
 * down: the other player was never shown this card (a discard from the hand, or a move card played under a Fog of
 * War), so the top carries down: true and view.js shows them its back. A face-up card never carries it.
 * Phalanx's and Peasant Immunity's bookkeeping stays behind, because it names pieces. A Mirage lies there as the move
 * card it showed (asMove). The King card is not a played card, so it never lies there.
 * The card also goes first in state.piled, the last DISCARD_SHOWN cards to join either player's pile, newest first:
 * { player, card } where card is the top as stored, with its down mark. A game saved before that list existed has
 * none, and the list starts here.
 */
function toPile(state, color, card, down) {
	if (card.key === "king") return;
	const player = state.players[color];
	const top = asMove(card);
	for (const key of ["denied", "stopping", "down"]) delete top[key];
	if (down && !card.faceUp) top.down = true;
	player.pile = { n: ((player.pile && player.pile.n) || 0) + 1, top };
	state.piled = [{ player: color, card: { ...top } }, ...(state.piled || [])].slice(0, DISCARD_SHOWN);
}

/**
 * @description Put a drawn card in its slot ("moves", "actives" or "passive"), or lose it when the slot is full, with
 * a draw event either way. Returns the card.
 */
function put(ctx, color, slot, fields) {
	const state = ctx.state;
	const player = state.players[color];
	const card = newCard(state, fields.key, fields);
	const held = slot === "moves" ? moveCards(player) : player[slot];
	const cap = slot === "moves" ? MOVE_CAP : ACTIVE_CAP;
	const lost = slot === "passive" ? !!player.passive : held.length >= cap;
	if (!lost && slot === "passive") player.passive = card;
	else if (!lost) player[slot].push(card);
	ctx.emit(lost ? { type: "draw", player: color, card, lost: true } : { type: "draw", player: color, card });
	return card;
}

/* ---- Move-card draws ---- */

/**
 * @description Draw one move card for color. Returns null when color has only its king.
 * A card type's base weight is the number of color's pieces it moves, the king aside. Through cardOf, a knight and a
 * bishop both count for the Knight / Bishop card. A queen counts as 2, and the pawns as PAWN_WEIGHT (6) at most.
 * Its weight in the draw is that base divided by (the cards of that type color holds now + 1), an entered Mirage
 * counting as the type it shows (moveCards). So a held type comes less often, each held card cutting its own type by
 * the same share. A type with no piece is never drawn; a held type always can be.
 * The free discard's draw-back is this same random draw: a floor was tried and dropped. The floor, kept for reference:
 * draw only the pieces worth floor or more (PIECE_VALUE); when color has none of those, the most valuable type it still has
 * (a knight and a bishop are both 3, so both stay in). No floor draws from every piece, with one rng pick.
 */
function drawMove(ctx, color /* , floor = 0 */) {
	const base = {};
	const held = {};
	for (const square of ctx.state.board.sq) {
		// A queen counts double, or the Queen card comes too rarely
		if (square && square.c === color && square.t !== "k") {
			base[cardOf(square.t)] = (base[cardOf(square.t)] || 0) + (square.t === "q" ? 2 : 1);
		}
	}
	if (base.p > PAWN_WEIGHT) base.p = PAWN_WEIGHT; // fewer pawn cards
	for (const card of moveCards(ctx.state.players[color])) held[card.piece] = (held[card.piece] || 0) + 1;
	const types = Object.keys(CARD_MOVES).filter((type) => base[type]);
	// Rounded, and at least 1, so a hand a test or an old game made larger than the cap still draws
	const weight = {};
	for (const type of types) weight[type] = Math.max(1, Math.round(base[type] * HELD_SCALE / ((held[type] || 0) + 1)));
	if (!types.length) return null;
	// The draw-back floor, dropped after a trial (the draw-back is random again). Kept for reference; it predates the
	// held-card weights, when `all` held one entry per piece:
	// const worth = (t) => PIECE_VALUE[t] || 0, dropped = Math.min(floor, Math.max(...all.map(worth))); // the floor drops to the best type left
	// return put(ctx, color, "moves", { key: "move", piece: cardOf(ctx.rng.pick(all.filter((t) => worth(t) >= dropped))) });
	let roll = ctx.rng.int(total(types, weight));
	return put(ctx, color, "moves", { key: "move", piece: types.find((type) => (roll -= weight[type]) < 0) });
}

/**
 * @description The sum of weights[name] over names.
 */
function total(names, weights) {
	return names.reduce((sum, name) => sum + weights[name], 0);
}

/**
 * @description Make `count` move-card draws for color as usual, stopping early when color has only its king.
 * Then each waiting Mirage in `entering` silently takes over a random real move card in color's hand, old or new
 * (state.rng): it gets that card's id and piece type, and the real card is gone with no event. So the holder's count,
 * ids and events are exactly those of the same draws with no Mirage. With no real move card left, a Mirage keeps
 * waiting.
 */
function drawMoves(ctx, color, count, entering = []) {
	const player = ctx.state.players[color];
	for (let i = 0; i < count; i++) {
		if (!drawMove(ctx, color)) break;
	}
	for (const mirage of entering) {
		if (!player.moves.length) return;
		const real = player.moves.splice(ctx.rng.int(player.moves.length), 1)[0];
		Object.assign(mirage, { id: real.id, piece: real.piece });
		delete mirage.waiting;
	}
}

/**
 * @description Throw out color's move cards, the entered Mirages with them. The Mirages wait again, to take over one
 * of the new draws through drawMoves.
 * Returns { out, ms }: out is the cards thrown out, as copies sorted by id, and ms is the Mirages.
 * The cards go to color's discard pile face down, a Mirage as the move card it shows, because the pile's count must
 * not tell it apart.
 */
function throwMoves(state, color) {
	const player = state.players[color];
	const entered = mirages(player);
	const thrown = moveCards(player).map((card) => ({ ...card }));
	for (const card of thrown) toPile(state, color, card, true);
	player.moves = [];
	for (const mirage of entered) mirage.waiting = true;
	return { out: thrown, ms: entered };
}

/**
 * @description color discards the move or active card with this id, with no draw, and a discard event is sent. An
 * entered Mirage then leaves through ctx.clearCurse.
 * The card goes to color's discard pile face down. With keep (the first move card of the free discard's pair) it
 * becomes Player.kept, the remembered card, instead, and the event says kept: true.
 * Returns the card (a copy for a Mirage).
 */
function discard(ctx, color, id, keep) {
	const player = ctx.state.players[color];
	const mirage = mirages(player).find((curse) => curse.id === id);
	const card = mirage ? { ...mirage } : take(player, id);
	if (keep) player.kept = asMove(card);
	else toPile(ctx.state, color, card, true);
	ctx.emit(keep ? { type: "discard", player: color, card, kept: true } : { type: "discard", player: color, card });
	if (mirage) ctx.clearCurse(color, mirage);
	return card;
}

/* ---- Active and passive draws ---- */

/**
 * @description Draw one active or passive card from the registry, weighted by rarity. Returns null when nothing is
 * left to draw.
 * It leaves out every version of a card color holds, has waiting in Board Effects or has used (drawable), and of `not`:
 * the passive a reroll just discarded, left out of this one draw only. `not` never joins used.
 *
 * The rarity climb:
 * - At turn 1 (board.full) each tier's chance is its share, by RARITY_WEIGHTS, of the cards color can draw right now.
 * - At turn CLIMB_END and after, it is the tier's CLIMB_SHARES share.
 * - In between, each tier's share moves in equal steps per turn.
 * A tier with no card to draw has no share. Its table share goes to the tiers that have cards, in proportion to
 * theirs, so no tier with a card is ever at 0. Inside a tier every card is equally likely.
 * The climb never lowers the chance of epic or legendary. A pool whose base epic-plus-legendary share is at or above
 * the table's (with the absent tiers shared out) draws by the base weights. A pool with no epic or legendary card left
 * has nothing to lower, and follows the table shared out.
 * board.full steps back when a move is taken back, and the odds go back with it. Curse draws (ctx.randomCurses) have
 * no climb.
 */
function drawCard(ctx, color, kind, not) {
	const keys = drawable(ctx.state, color, kind, not);
	if (!keys.length) return null;
	const tiers = Object.keys(CLIMB_SHARES).filter((tier) => ofTier(keys, tier).length);
	const start = {};
	for (const tier of tiers) start[tier] = ofTier(keys, tier).length * RARITY_WEIGHTS[tier];
	const startTotal = total(tiers, start);
	const tableTotal = total(tiers, CLIMB_SHARES);
	const topTiers = tiers.filter((tier) => tier === "epic" || tier === "legendary");
	const steps = CLIMB_END - 1;
	const step = Math.min(ctx.state.board.full, CLIMB_END) - 1;
	// With no epic or legendary left there is nothing to lower, and the table is shared out
	const baseKeepsTop = topTiers.length && total(topTiers, start) * tableTotal >= total(topTiers, CLIMB_SHARES) * startTotal;
	let key;
	if (step <= 0 || baseKeepsTop) {
		// The base weights: turn 1, or the climb would lower epic or legendary
		let roll = ctx.rng.int(startTotal);
		key = keys.find((candidate) => (roll -= RARITY_WEIGHTS[CARDS[candidate].rarity]) < 0);
	} else {
		// In whole numbers for rng.int: the tier first, its share out of startTotal * tableTotal * steps (well under 2^32),
		// then one of its cards
		let roll = ctx.rng.int(startTotal * tableTotal * steps);
		const tier = tiers.find((name) => (roll -= start[name] * tableTotal * (steps - step) + CLIMB_SHARES[name] * startTotal * step) < 0);
		key = ctx.rng.pick(ofTier(keys, tier));
	}
	return put(ctx, color, kind === "active" ? "actives" : "passive", { key });
}

/**
 * @description The active or passive keys color can draw now: the registry's, less every version (compared by
 * baseKey) of:
 * - a card color holds, has waiting in Board Effects or has used;
 * - a passive that left this turn (Player.gone: dropped, replaced or rerolled; turn.endTurn empties it);
 * - `not`, an optional key.
 */
function drawable(state, color, kind, not) {
	const player = state.players[color];
	const held = [...player.moves, ...player.actives, ...player.curses, player.passive].filter(Boolean).map((card) => card.key);
	const waiting = state.effects.filter((effect) => effect.owner === color).map((effect) => effect.card.key);
	const out = new Set([...held, ...waiting, ...player.used, ...(player.gone || []), ...(not ? [not] : [])].map(baseKey));
	return (kind === "active" ? ACTIVE_KEYS : PASSIVE_KEYS).filter((key) => !out.has(baseKey(key)));
}

function ofTier(keys, tier) {
	return keys.filter((key) => CARDS[key].rarity === tier);
}

/* ---- Refill ---- */

/**
 * @description The end-of-turn refill, in order:
 * 1. With multi.draw (Four of a Kind), at the end of color's two-move turn, color's move cards are thrown out first,
 *    a discard event each. An entered Mirage among them comes back hidden among the new draws.
 * 2. Top up to HAND_MOVES (5; it was 6) move cards, entered Mirages counting, and to 1 active card; 6 and 2 while big
 *    (Underdog). With multi.draw the move cards top up to multi.draw instead. Extras are never trimmed.
 *    Then each waiting Mirage takes over a random move card in the hand (drawMoves).
 *    While refillLock is set (cards lost to a debuff) these draws are skipped and the lock counts down. Four of a
 *    Kind's throw-out still happens.
 * 3. Last, at every refill, each entered Mirage trades places with a random held move card (shuffleMirages).
 */
function refill(ctx, color) {
	const state = ctx.state;
	const player = state.players[color];
	const only = state.multi && state.multi.player === color && state.multi.draw;
	const plus = big(state, color);
	if (only) {
		for (const card of throwMoves(state, color).out) ctx.emit({ type: "discard", player: color, card });
	}
	if (player.refillLock > 0) player.refillLock--;
	else {
		drawMoves(ctx, color, (only || HAND_MOVES + plus) - moveCards(player).length, player.curses.filter((curse) => curse.waiting));
		while (player.actives.length < HAND_ACTIVES + plus && drawCard(ctx, color, "active"));
	}
	shuffleMirages(ctx, color);
}

/**
 * @description 1 while one of color's placed passives says so through its rules.bigHand(state, color, src) (Underdog:
 * a 6th move card and a second active slot), otherwise 0.
 */
function big(state, color) {
	for (const effect of state.effects) {
		const rules = effect.owner === color && CARDS[effect.card.key] && CARDS[effect.card.key].rules;
		if (rules && rules.bigHand && rules.bigHand(state, color, effect)) return 1;
	}
	return 0;
}

/**
 * @description Each entered Mirage trades places with one random held move card, itself included (state.rng): the two
 * swap id and piece type, with no event, so the holder's view is unchanged and a card's age says nothing about which one
 * is the Mirage (cards drawn after it entered could not be it otherwise). It runs after every draw, so the holder's draws
 * are those of a hand with no Mirage.
 */
function shuffleMirages(ctx, color) {
	const state = ctx.state;
	const player = state.players[color];
	for (let i = 0; i < player.curses.length; i++) {
		const mirage = player.curses[i];
		if (!mirages(player).includes(mirage)) continue;
		const other = ctx.rng.pick(moveCards(player));
		const slot = player.moves.includes(other) ? player.moves : player.curses;
		const otherIndex = slot.indexOf(other);
		player.curses[i] = { ...mirage, id: other.id, piece: other.piece }; // new objects: this turn's events hold the old ones
		if (other === mirage) continue;
		slot[otherIndex] = { ...other, id: mirage.id, piece: mirage.piece };
		followSight(state, color, other.id, mirage.id);
	}
}

/**
 * @description The opponent's sight of color's hand (real or fake) follows the card, not the id: the two ids trade
 * places in it, then the opponent's sight is rebuilt.
 */
function followSight(state, color, firstId, secondId) {
	for (const entry of state.enchant) {
		if (entry.owner === color || !entry.data || !isSight(entry)) continue;
		if (entry.data.ids) entry.data.ids = entry.data.ids.map((id) => swappedId(id, firstId, secondId));
		if (entry.data.fake) entry.data.fake = entry.data.fake.map((fake) => ({ ...fake, id: swappedId(fake.id, firstId, secondId) }));
	}
	resight(state, color === "w" ? "b" : "w");
}

function swappedId(id, firstId, secondId) {
	if (id === firstId) return secondId;
	if (id === secondId) return firstId;
	return id;
}

/* ---- Taking cards out of the hand ---- */

/**
 * @description Take the move or active card with this id out of the player's hand, or the King card ("king") while
 * kingCard offers it (Player.king becomes false). Returns the card, or undefined when it is not held.
 */
function take(player, id) {
	// The King card can only be taken under a Hollow Crown
	if (id === "king") {
		const king = kingCard(player)[0];
		if (king) player.king = false;
		return king;
	}
	for (const slot of ["moves", "actives"]) {
		const index = player[slot].findIndex((card) => card.id === id);
		if (index >= 0) return player[slot].splice(index, 1)[0];
	}
}

/**
 * @description Discard `count` random cards from color's hand, or the whole hand when count is left out, with a
 * discard event each.
 * Move, active and passive cards can go. A curse never can, nor the King card unless a Hollow Crown makes it losable
 * (kingCard). An entered Mirage, a move card to its holder, can go: through discard, which clears it.
 */
function discardRandom(ctx, color, count) {
	const player = ctx.state.players[color];
	// The whole hand: until the pool is empty (a card a trigger draws meanwhile goes too), capped so a card that won't
	// leave can't loop
	if (count === undefined) count = 40;
	for (let i = 0; i < count; i++) {
		const card = ctx.rng.pick(discardPool(player));
		if (!card) return;
		if (card !== player.passive) discard(ctx, color, card.id);
		else {
			player.passive = null;
			toPile(ctx.state, color, card, true);
			ctx.emit({ type: "discard", player: color, card });
		}
	}
}

/**
 * @description The cards a random discard can take from the player's hand, built fresh before each pick.
 */
function discardPool(player) {
	return [...moveCards(player), ...player.actives, ...(player.passive ? [player.passive] : []), ...kingCard(player)];
}

module.exports = {
	HAND_MOVES, MOVE_CAP, ACTIVE_CAP, PIECE_VALUE, CARD_MOVES,
	cardOf, fits, newCard, drawMove, drawCard, drawable, refill, take, discardRandom,
	mirages, moveCards, drawMoves, throwMoves, discard, toPile, kingCard, kingFree, big,
};
