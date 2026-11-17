/*
 *  hand.js  --  chess cards engine
 *	Move-card and card draws, refill, hand caps and discards.
 *
 */

const { CARDS, ACTIVE_KEYS, PASSIVE_KEYS, RARITY_WEIGHTS, baseKey } = require("./cards/index.js");

const MOVES = 6, ACTIVES = 1, MOVE_CAP = 9, ACTIVE_CAP = 3;

/**
 * @description The one way the engine makes a card: { id: "c<nextId>", key, ...extra }, bumping state.nextId.
 */
function newCard(state, key, extra) {
	return { id: "c" + state.nextId++, key, ...extra };
}

/**
 * @description Put a drawn card in its slot ("moves", "actives" or "passive"), or lose it when the slot is full, with a draw event either way. Returns the card.
 */
function put(ctx, color, slot, fields) {
	const s = ctx.state, p = s.players[color], card = newCard(s, fields.key, fields);
	const lost = slot === "passive" ? !!p.passive : p[slot].length >= (slot === "moves" ? MOVE_CAP : ACTIVE_CAP);
	if (!lost && slot === "passive") p.passive = card;
	else if (!lost) p[slot].push(card);
	ctx.emit(lost ? { type: "draw", player: color, card, lost: true } : { type: "draw", player: color, card });
	return card;
}

/**
 * @description Draw one move card: a piece type color still has (king aside), weighted by how many of that type are on the board. null when color has only its king.
 */
function drawMove(ctx, color) {
	const left = ctx.state.board.sq.filter((q) => q && q.c === color && q.t !== "k").map((q) => q.t);
	if (!left.length) return null;
	return put(ctx, color, "moves", { key: "move", piece: ctx.rng.pick(left) });
}

/**
 * @description Draw one active or passive card from the registry, weighted by rarity, leaving out every version of a card color holds, has waiting in Board Effects or has used (compared by baseKey). null when nothing is left.
 */
function drawCard(ctx, color, kind) {
	const s = ctx.state, p = s.players[color];
	const held = [...p.moves, ...p.actives, ...p.curses, p.passive].filter(Boolean).map((c) => c.key);
	const out = new Set([...held, ...s.effects.filter((e) => e.owner === color).map((e) => e.card.key), ...p.used].map(baseKey));
	const keys = (kind === "active" ? ACTIVE_KEYS : PASSIVE_KEYS).filter((k) => !out.has(baseKey(k)));
	const weight = (k) => RARITY_WEIGHTS[CARDS[k].rarity];
	const total = keys.reduce((n, k) => n + weight(k), 0);
	if (!total) return null;
	let r = ctx.rng.int(total);
	const key = keys.find((k) => (r -= weight(k)) < 0);
	return put(ctx, color, kind === "active" ? "actives" : "passive", { key });
}

/**
 * @description End-of-turn refill: top up to 6 move cards and 1 active, never trimming extras. While refillLock is set (cards lost to a debuff) this refill is skipped and the lock counts down.
 */
function refill(ctx, color) {
	const p = ctx.state.players[color];
	if (p.refillLock > 0) { p.refillLock--; return; }
	while (p.moves.length < MOVES && drawMove(ctx, color));
	while (p.actives.length < ACTIVES && drawCard(ctx, color, "active"));
}

/**
 * @description Take the move or active card with this id out of color's hand; returns it (undefined when not held).
 */
function take(p, id) {
	for (const slot of ["moves", "actives"]) {
		const i = p[slot].findIndex((c) => c.id === id);
		if (i >= 0) return p[slot].splice(i, 1)[0];
	}
}

/**
 * @description Discard n random cards (move, active or passive; never the King card or a curse) from color's hand, with a discard event each.
 */
function discardRandom(ctx, color, n) {
	const p = ctx.state.players[color];
	for (let k = 0; k < n; k++) {
		const card = ctx.rng.pick([...p.moves, ...p.actives, ...(p.passive ? [p.passive] : [])]);
		if (!card) return;
		if (card === p.passive) p.passive = null;
		else take(p, card.id);
		ctx.emit({ type: "discard", player: color, card });
	}
}

module.exports = { MOVES, MOVE_CAP, ACTIVE_CAP, newCard, drawMove, drawCard, refill, take, discardRandom };
