/*
 *  hand.js  --  chess cards engine
 *	Move-card and card draws, refill, hand caps and discards.
 *
 */

const { CARDS, ACTIVE_KEYS, PASSIVE_KEYS, RARITY_WEIGHTS, baseKey } = require("./cards/index.js");
const { resight, isSight } = require("./cards/sight.js");

const MOVES = 6, ACTIVES = 1, MOVE_CAP = 9, ACTIVE_CAP = 3;
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 }; // THE PIECE VALUES, THE ONE PLACE IN THE ENGINE: THE FREE DISCARD'S FLOOR (drawMove) AND UNDERDOG'S MATERIAL
const byId = (a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1));

/**
 * @description The Mirages in p's curses that have entered the hand: its holder sees each as a move card, so every count, list and order of move cards takes them in (a waiting one, not yet entered, is in none).
 */
const mirages = (p) => p.curses.filter((c) => baseKey(c.key) === "mirage" && !c.waiting);

/**
 * @description p's move cards as its holder sees them: the real ones and the entered Mirages, by id (the order playerView shows).
 */
const moveCards = (p) => [...p.moves, ...mirages(p)].sort(byId);

/**
 * @description p's King card as a takeable card, [{ id: "king", key: "king", faceUp: true }] (face up: Player.king is public), while a Hollow Crown makes it losable and p still has it; else []. Random discards and Pickpocket put it in their pools; take removes it.
 */
const kingCard = (p) => (p.king && p.curses.some((c) => baseKey(c.key) === "hollow-crown") ? [{ id: "king", key: "king", faceUp: true }] : []);

/**
 * @description The one test for "may a card move color's own king for color": true while color has its King card (Player.king; Hollow Crown can take it). turn.kingMoves, Last Stand, Swap and Retaliation ask it; Escape Artist alone moves the king without it (catalog), and the opponent's cards moving it are not asked.
 */
const kingFree = (state, color) => !!state.players[color].king;

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
	const lost = slot === "passive" ? !!p.passive : (slot === "moves" ? moveCards(p) : p[slot]).length >= (slot === "moves" ? MOVE_CAP : ACTIVE_CAP);
	if (!lost && slot === "passive") p.passive = card;
	else if (!lost) p[slot].push(card);
	ctx.emit(lost ? { type: "draw", player: color, card, lost: true } : { type: "draw", player: color, card });
	return card;
}

/**
 * @description Draw one move card: a piece type color still has (king aside), weighted by how many of that type are on the board, a queen counting as 2. null when color has only its king.
 * With a floor (the free discard's draw-back, user ruling 2026-11-22) only the types worth floor or more (VALUE); when color has none of those, the most valuable type it still has (a knight and a bishop are both 3, so both stay in). No floor draws from every type, with one rng pick.
 */
function drawMove(ctx, color, floor = 0) {
	const all = ctx.state.board.sq.filter((q) => q && q.c === color && q.t !== "k").flatMap((q) => (q.t === "q" ? ["q", "q"] : [q.t])); // A QUEEN COUNTS DOUBLE (USER RULING 2026-11-22: THE QUEEN CARD WAS TOO RARE)
	if (!all.length) return null;
	const worth = (t) => VALUE[t] || 0, dropped = Math.min(floor, Math.max(...all.map(worth))); // THE FLOOR DROPS TO THE BEST TYPE LEFT
	return put(ctx, color, "moves", { key: "move", piece: ctx.rng.pick(all.filter((t) => worth(t) >= dropped)) });
}

/**
 * @description n move-card draws for color as usual (stopping when color has only its king), then each waiting Mirage in `entering` silently takes over a random real move card in color's hand, old or new (state.rng): it gets that card's id and piece type, the real card is gone with no event. So the holder's count, ids and events are exactly those of the same draws with no Mirage. With no real move card left, a Mirage keeps waiting.
 */
function drawMoves(ctx, color, n, entering = []) {
	const p = ctx.state.players[color];
	for (let i = 0; i < n; i++) if (!drawMove(ctx, color)) break;
	for (const m of entering) {
		if (!p.moves.length) return;
		const real = p.moves.splice(ctx.rng.int(p.moves.length), 1)[0];
		Object.assign(m, { id: real.id, piece: real.piece });
		delete m.waiting;
	}
}

/**
 * @description Throw out p's move cards, entered Mirages with them (they wait again, to take over one of the new draws through drawMoves): returns { out: the cards thrown out as copies, by id, ms: the Mirages }.
 */
function throwMoves(p) {
	const ms = mirages(p), out = moveCards(p).map((c) => ({ ...c }));
	p.moves = [];
	for (const m of ms) m.waiting = true;
	return { out, ms };
}

/**
 * @description color discards the move or active card with this id (no draw): a discard event; an entered Mirage then leaves through ctx.clearCurse. Returns the card (a copy for a Mirage).
 */
function discard(ctx, color, id) {
	const p = ctx.state.players[color], m = mirages(p).find((c) => c.id === id), card = m ? { ...m } : take(p, id);
	ctx.emit({ type: "discard", player: color, card });
	if (m) ctx.clearCurse(color, m);
	return card;
}

/**
 * @description The active or passive keys color can draw now: the registry's, less every version of a card color holds, has waiting in Board Effects or has used, and of `not` (a key, optional), compared by baseKey.
 */
function drawable(state, color, kind, not) {
	const p = state.players[color];
	const held = [...p.moves, ...p.actives, ...p.curses, p.passive].filter(Boolean).map((c) => c.key);
	const out = new Set([...held, ...state.effects.filter((e) => e.owner === color).map((e) => e.card.key), ...p.used, ...(not ? [not] : [])].map(baseKey));
	return (kind === "active" ? ACTIVE_KEYS : PASSIVE_KEYS).filter((k) => !out.has(baseKey(k)));
}

/**
 * @description Draw one active or passive card from the registry, weighted by rarity, leaving out every version of a card color holds, has waiting in Board Effects or has used (drawable), and of `not` (the passive a reroll just discarded: left out of this one draw only, it never joins used). null when nothing is left.
 */
function drawCard(ctx, color, kind, not) {
	const keys = drawable(ctx.state, color, kind, not);
	const weight = (k) => RARITY_WEIGHTS[CARDS[k].rarity];
	const total = keys.reduce((n, k) => n + weight(k), 0);
	if (!total) return null;
	let r = ctx.rng.int(total);
	const key = keys.find((k) => (r -= weight(k)) < 0);
	return put(ctx, color, kind === "active" ? "actives" : "passive", { key });
}

/**
 * @description 1 while a placed passive of color's rules.bigHand(state, color, src) says so (Underdog: a 7th move card and a second active slot), else 0.
 */
const big = (s, color) => (s.effects.some((e) => { const r = e.owner === color && CARDS[e.card.key] && CARDS[e.card.key].rules; return !!(r && r.bigHand && r.bigHand(s, color, e)); }) ? 1 : 0);

/**
 * @description End-of-turn refill: top up to 6 move cards (entered Mirages count) and 1 active, never trimming extras; 7 and 2 while big (Underdog). At the end of color's two-move turn with multi.draw (Four of a Kind), color's move cards are thrown out first (a discard event each; an entered Mirage among them comes back hidden among the draws) and the top-up is to multi.draw. Then each waiting Mirage takes over a random move card in the hand (drawMoves). While refillLock is set (cards lost to a debuff) the draws are skipped (Four of a Kind's throw-out still happens) and the lock counts down. Last, at every refill, each entered Mirage trades places with one random held move card, itself included (state.rng): the two swap id and piece type, with no event, so the holder's view is unchanged and a card's age says nothing about which one is the Mirage (cards drawn after it entered could not be it otherwise).
 */
function refill(ctx, color) {
	const s = ctx.state, p = s.players[color], only = s.multi && s.multi.player === color && s.multi.draw, plus = big(s, color);
	if (only) for (const card of throwMoves(p).out) ctx.emit({ type: "discard", player: color, card });
	if (p.refillLock > 0) p.refillLock--;
	else {
		drawMoves(ctx, color, (only || MOVES + plus) - moveCards(p).length, p.curses.filter((c) => c.waiting));
		while (p.actives.length < ACTIVES + plus && drawCard(ctx, color, "active"));
	}
	p.curses.forEach((m, i) => { // AFTER EVERY DRAW, SO THE HOLDER'S DRAWS ARE THOSE OF A HAND WITH NO MIRAGE
		if (!mirages(p).includes(m)) return;
		const o = ctx.rng.pick(moveCards(p)), slot = p.moves.includes(o) ? p.moves : p.curses, j = slot.indexOf(o);
		p.curses[i] = { ...m, id: o.id, piece: o.piece }; // NEW OBJECTS: THIS TURN'S EVENTS HOLD THE OLD ONES
		if (o === m) return;
		slot[j] = { ...o, id: m.id, piece: m.piece };
		const swap = (id) => (id === o.id ? m.id : id === m.id ? o.id : id); // THE OPPONENT'S SIGHT (REAL OR FAKE) FOLLOWS THE CARD, NOT THE ID
		for (const e of s.enchant) if (e.owner !== color && e.data && isSight(e)) {
			if (e.data.ids) e.data.ids = e.data.ids.map(swap);
			if (e.data.fake) e.data.fake = e.data.fake.map((f) => ({ ...f, id: swap(f.id) }));
		}
		resight(s, color === "w" ? "b" : "w");
	});
}

/**
 * @description Take the move or active card with this id out of color's hand, or the King card ("king") while kingCard offers it (Player.king becomes false); returns it (undefined when not held).
 */
function take(p, id) {
	if (id === "king") { const k = kingCard(p)[0]; if (k) p.king = false; return k; } // ONLY UNDER HOLLOW CROWN
	for (const slot of ["moves", "actives"]) {
		const i = p[slot].findIndex((c) => c.id === id);
		if (i >= 0) return p[slot].splice(i, 1)[0];
	}
}

/**
 * @description Discard n random cards (move, active or passive; never a curse or the King card, unless a Hollow Crown makes it losable (kingCard); an entered Mirage, a move card to its holder, can go: through discard, which clears it) from color's hand, with a discard event each.
 */
function discardRandom(ctx, color, n) {
	const p = ctx.state.players[color];
	for (let k = 0; k < n; k++) {
		const card = ctx.rng.pick([...moveCards(p), ...p.actives, ...(p.passive ? [p.passive] : []), ...kingCard(p)]);
		if (!card) return;
		if (card !== p.passive) discard(ctx, color, card.id);
		else {
			p.passive = null;
			ctx.emit({ type: "discard", player: color, card });
		}
	}
}

module.exports = { MOVES, MOVE_CAP, ACTIVE_CAP, VALUE, newCard, drawMove, drawCard, drawable, refill, take, discardRandom, mirages, moveCards, drawMoves, throwMoves, discard, kingCard, kingFree, big };
