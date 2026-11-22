/*
 *  hand.js  --  chess cards engine
 *	Move-card and card draws, refill, hand caps and discards.
 *
 */

const { CARDS, ACTIVE_KEYS, PASSIVE_KEYS, RARITY_WEIGHTS, CLIMB_SHARES, CLIMB_END, baseKey } = require("./cards/index.js");
const { resight, isSight } = require("./cards/sight.js");

const MOVES = 5, ACTIVES = 1, MOVE_CAP = 9, ACTIVE_CAP = 3;
const VALUE = { p: 1, n: 3, b: 3, m: 3, r: 5, q: 9 }; // THE VALUES, THE ONE PLACE IN THE ENGINE: A PIECE TYPE'S (UNDERDOG'S MATERIAL) AND A MOVE CARD TYPE'S (THE FREE DISCARD'S FLOOR, drawMove; m: THE KNIGHT / BISHOP CARD)
const CARD_MOVES = { p: "p", m: "nb", r: "r", q: "q" }; // THE PIECE TYPES EACH MOVE CARD TYPE MOVES, THE ONE TABLE (USER RULING 2026-11-22: ONE KNIGHT / BISHOP CARD, "m", IN PLACE OF THE KNIGHT CARD AND THE BISHOP CARD)

/**
 * @description The move card type that moves a piece of type t: "m" for a knight or a bishop, else t itself (CARD_MOVES); undefined for a king.
 */
const cardOf = (t) => Object.keys(CARD_MOVES).find((k) => CARD_MOVES[k].includes(t));

/**
 * @description True when a move card of type `piece` moves a piece of type t (CARD_MOVES). An unknown card type (an old Knight or Bishop card) moves nothing.
 */
const fits = (piece, t) => (CARD_MOVES[piece] || "").includes(t);
const byId = (a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1));
const asMove = (c) => (baseKey(c.key) === "mirage" ? { id: c.id, key: "move", piece: c.piece } : { ...c }); // A COPY; A MIRAGE AS ITS HOLDER SAW IT: ON THE DISCARD PILE OR REMEMBERED IT NAMES NO CURSE (THE PILE'S COUNT AND TOP MUST NOT TELL IT APART)

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
 * @description card joins p's discard pile, Player.pile { n, top }: only how many lie there and the top card are kept. down: the other player was never shown this card (a discard from the hand, a move card played under a Fog of War), so the top carries down: true and view.js shows them its back; a face-up card never does. Phalanx's and Peasant Immunity's bookkeeping stays behind (it names pieces), a Mirage lies there as the move card it showed (asMove), and the King card is no played card: it never lies there.
 */
function toPile(p, card, down) {
	if (card.key === "king") return;
	const top = asMove(card);
	for (const k of ["denied", "stopping", "down"]) delete top[k];
	if (down && !card.faceUp) top.down = true;
	p.pile = { n: ((p.pile && p.pile.n) || 0) + 1, top };
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

const PAWN_WEIGHT = 6; // THE MOST PAWNS THE MOVE-CARD DRAW COUNTS: 8 ON THE BOARD DRAW AS 6
const HELD_SCALE = 2520; // DIVIDES BY EVERY HELD COUNT + 1 A HAND CAN REACH (1 TO 10, MOVE_CAP + 1), SO THE MOVE-CARD DRAW'S WEIGHTS ARE WHOLE NUMBERS FOR rng.int

/**
 * @description Draw one move card. A card type's base weight is color's pieces it moves (king aside; cardOf: a knight and a bishop both count for the Knight / Bishop card), a queen counting as 2 & the pawns as 6 at most (PAWN_WEIGHT). Its weight in the draw is that base / (cards of the type color holds now + 1), an entered Mirage counting as the type it shows (moveCards; user ruling 2026-11-22: a held type comes less often, each held card cutting its own type by the same share). A type with no piece is never drawn, a held type always can be. null when color has only its king.
 * The free discard's draw-back is this same random draw (user ruling 2026-11-22, after a trial of a floor). The floor, kept for reference: only the pieces worth floor or more (VALUE); when color has none of those, the most valuable type it still has (a knight and a bishop are both 3, so both stay in). No floor draws from every piece, with one rng pick.
 */
function drawMove(ctx, color /* , floor = 0 */) {
	const base = {}, held = {};
	for (const q of ctx.state.board.sq) if (q && q.c === color && q.t !== "k") base[cardOf(q.t)] = (base[cardOf(q.t)] || 0) + (q.t === "q" ? 2 : 1); // A QUEEN COUNTS DOUBLE (USER RULING 2026-11-22: THE QUEEN CARD WAS TOO RARE)
	if (base.p > PAWN_WEIGHT) base.p = PAWN_WEIGHT; // PAWNS COUNT AS PAWN_WEIGHT AT MOST (USER RULING 2026-11-22: FEWER PAWN CARDS)
	for (const c of moveCards(ctx.state.players[color])) held[c.piece] = (held[c.piece] || 0) + 1;
	const types = Object.keys(CARD_MOVES).filter((t) => base[t]), weight = (t) => Math.max(1, Math.round(base[t] * HELD_SCALE / ((held[t] || 0) + 1))); // ROUNDED, AT LEAST 1: A HAND A TEST OR AN OLD GAME MADE LARGER THAN THE CAP STILL DRAWS
	if (!types.length) return null;
	// THE DRAW-BACK FLOOR, DROPPED BY THE USER 2026-11-22 AFTER A TRIAL: THE DRAW-BACK IS RANDOM AGAIN. KEPT FOR REFERENCE (FROM THE DRAW BEFORE THE HELD-CARD WEIGHTS, all: ONE ENTRY PER PIECE):
	// const worth = (t) => VALUE[t] || 0, dropped = Math.min(floor, Math.max(...all.map(worth))); // THE FLOOR DROPS TO THE BEST TYPE LEFT
	// return put(ctx, color, "moves", { key: "move", piece: cardOf(ctx.rng.pick(all.filter((t) => worth(t) >= dropped))) });
	let r = ctx.rng.int(types.reduce((n, t) => n + weight(t), 0));
	return put(ctx, color, "moves", { key: "move", piece: types.find((t) => (r -= weight(t)) < 0) });
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
 * @description Throw out p's move cards, entered Mirages with them (they wait again, to take over one of the new draws through drawMoves): returns { out: the cards thrown out as copies, by id, ms: the Mirages }. They go to p's discard pile face down, a Mirage as the move card it shows (the pile's count must not tell it apart).
 */
function throwMoves(p) {
	const ms = mirages(p), out = moveCards(p).map((c) => ({ ...c }));
	for (const c of out) toPile(p, c, true);
	p.moves = [];
	for (const m of ms) m.waiting = true;
	return { out, ms };
}

/**
 * @description color discards the move or active card with this id (no draw): a discard event; an entered Mirage then leaves through ctx.clearCurse. The card goes to color's discard pile face down, or with keep (the free discard's first move card of a pair) it becomes Player.kept, the remembered card, and the event says kept: true. Returns the card (a copy for a Mirage).
 */
function discard(ctx, color, id, keep) {
	const p = ctx.state.players[color], m = mirages(p).find((c) => c.id === id), card = m ? { ...m } : take(p, id);
	if (keep) p.kept = asMove(card);
	else toPile(p, card, true);
	ctx.emit(keep ? { type: "discard", player: color, card, kept: true } : { type: "discard", player: color, card });
	if (m) ctx.clearCurse(color, m);
	return card;
}

/**
 * @description The active or passive keys color can draw now: the registry's, less every version of a card color holds, has waiting in Board Effects or has used, of a passive that left this turn (Player.gone: dropped, replaced or rerolled; turn.endTurn empties it), and of `not` (a key, optional), compared by baseKey.
 */
function drawable(state, color, kind, not) {
	const p = state.players[color];
	const held = [...p.moves, ...p.actives, ...p.curses, p.passive].filter(Boolean).map((c) => c.key);
	const out = new Set([...held, ...state.effects.filter((e) => e.owner === color).map((e) => e.card.key), ...p.used, ...(p.gone || []), ...(not ? [not] : [])].map(baseKey));
	return (kind === "active" ? ACTIVE_KEYS : PASSIVE_KEYS).filter((k) => !out.has(baseKey(k)));
}

/**
 * @description Draw one active or passive card from the registry, weighted by rarity, leaving out every version of a card color holds, has waiting in Board Effects or has used (drawable), and of `not` (the passive a reroll just discarded: left out of this one draw only, it never joins used). null when nothing is left.
 * The climb (user ruling 2026-11-22): at turn 1 (board.full) each tier's chance is its share by RARITY_WEIGHTS of the cards color can draw at this moment; at turn CLIMB_END and after it is the tier's CLIMB_SHARES share; between, each tier's share moves in equal steps per turn. A tier with no card to draw has no share: its table share goes to the tiers that have cards, in proportion to theirs, so no tier with a card is ever at 0. Inside a tier every card is equally likely. It never lowers the chance of epic or legendary: a pool whose base epic-plus-legendary share is at or above the table's (the absent tiers shared out) draws by the base weights. board.full steps back when a move is taken back, and the odds with it. Curse draws (ctx.randomCurses) have no climb.
 */
function drawCard(ctx, color, kind, not) {
	const keys = drawable(ctx.state, color, kind, not), base = (k) => RARITY_WEIGHTS[CARDS[k].rarity];
	if (!keys.length) return null;
	const of = (t) => keys.filter((k) => CARDS[k].rarity === t), tiers = Object.keys(CLIMB_SHARES).filter((t) => of(t).length);
	const sum = (weight, ts = tiers) => ts.reduce((n, t) => n + weight(t), 0), top = tiers.filter((t) => t === "epic" || t === "legendary");
	const start = (t) => of(t).length * RARITY_WEIGHTS[t], table = (t) => CLIMB_SHARES[t], all = sum(start), shared = sum(table);
	const steps = CLIMB_END - 1, step = Math.min(ctx.state.board.full, CLIMB_END) - 1;
	let key;
	if (step <= 0 || sum(start, top) * shared >= sum(table, top) * all) { // THE BASE WEIGHTS: TURN 1, OR THE CLIMB WOULD LOWER EPIC OR LEGENDARY
		let r = ctx.rng.int(all);
		key = keys.find((k) => (r -= base(k)) < 0);
	} else { // IN WHOLE NUMBERS (rng.int): THE TIER FIRST, ITS SHARE OUT OF all * shared * steps (WELL UNDER 2^32), THEN ONE OF ITS CARDS
		let r = ctx.rng.int(all * shared * steps);
		key = ctx.rng.pick(of(tiers.find((t) => (r -= start(t) * shared * (steps - step) + table(t) * all * step) < 0)));
	}
	return put(ctx, color, kind === "active" ? "actives" : "passive", { key });
}

/**
 * @description 1 while a placed passive of color's rules.bigHand(state, color, src) says so (Underdog: a 6th move card and a second active slot), else 0.
 */
const big = (s, color) => (s.effects.some((e) => { const r = e.owner === color && CARDS[e.card.key] && CARDS[e.card.key].rules; return !!(r && r.bigHand && r.bigHand(s, color, e)); }) ? 1 : 0);

/**
 * @description End-of-turn refill: top up to 5 move cards (MOVES, user ruling 2026-11-22: was 6; entered Mirages count) and 1 active, never trimming extras; 6 and 2 while big (Underdog). At the end of color's two-move turn with multi.draw (Four of a Kind), color's move cards are thrown out first (a discard event each; an entered Mirage among them comes back hidden among the draws) and the top-up is to multi.draw. Then each waiting Mirage takes over a random move card in the hand (drawMoves). While refillLock is set (cards lost to a debuff) the draws are skipped (Four of a Kind's throw-out still happens) and the lock counts down. Last, at every refill, each entered Mirage trades places with one random held move card, itself included (state.rng): the two swap id and piece type, with no event, so the holder's view is unchanged and a card's age says nothing about which one is the Mirage (cards drawn after it entered could not be it otherwise).
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
 * @description Discard n random cards, the whole hand when n is left out (move, active or passive; never a curse or the King card, unless a Hollow Crown makes it losable (kingCard); an entered Mirage, a move card to its holder, can go: through discard, which clears it) from color's hand, with a discard event each.
 */
function discardRandom(ctx, color, n) {
	const p = ctx.state.players[color], pool = () => [...moveCards(p), ...p.actives, ...(p.passive ? [p.passive] : []), ...kingCard(p)];
	if (n === undefined) n = 40; // THE WHOLE HAND: UNTIL THE POOL IS EMPTY (A CARD A TRIGGER DRAWS MEANWHILE GOES TOO), CAPPED SO A CARD THAT WON'T LEAVE CAN'T LOOP
	for (let k = 0; k < n; k++) {
		const card = ctx.rng.pick(pool());
		if (!card) return;
		if (card !== p.passive) discard(ctx, color, card.id);
		else {
			p.passive = null;
			toPile(p, card, true);
			ctx.emit({ type: "discard", player: color, card });
		}
	}
}

module.exports = { MOVES, MOVE_CAP, ACTIVE_CAP, VALUE, CARD_MOVES, cardOf, fits, newCard, drawMove, drawCard, drawable, refill, take, discardRandom, mirages, moveCards, drawMoves, throwMoves, discard, toPile, kingCard, kingFree, big };
