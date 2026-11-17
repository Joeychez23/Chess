/*
 *  ctx.js  --  chess cards engine
 *	The context an action resolves through: the state, the events so far, and the helpers cards act with (triggers, choices, captures, enchantments).
 *
 */

const rng = require("./rng.js");
const hand = require("./hand.js");
const statuses = require("./statuses.js");
const { pieceById } = require("./board.js");
const { LOSES } = require("./movegen.js");
const { CARDS } = require("./cards/index.js");

const other = (c) => (c === "w" ? "b" : "w");

/**
 * @description A captured piece (already off the board): a capture event { player, piece, t, c: the victim's colour, by: the capturing piece's id, null for a card effect }, its statuses cleared, its type added to its owner's captured list, ctx.resetHalf set (for a capture made outside a chess move); a Marked piece makes the capturer draw a move card and its owner discard 2 random cards.
 */
function capture(ctx, player, victim, by = null) {
	const s = ctx.state, marked = statuses.has(s, victim.id, "marked");
	ctx.resetHalf = true;
	ctx.emit({ type: "capture", player, piece: victim.id, t: victim.t, c: victim.c, by });
	for (const e of s.statuses[victim.id] || []) statuses.clear(ctx, victim.id, e.s);
	s.players[victim.c].captured.push(victim.t);
	if (marked) { ctx.draw(player, 1); ctx.discardRandom(victim.c, 2); }
}

/**
 * @description After each event, the cards in play whose card has on[ev.type] run: those of the player whose turn it is (ctx.turn) first, then the other's; within a player, placed passives by placedAt, then held curses in hand order, then enchantments in the order they were added (not for enchant-ended: only the ended entry's own card hears that, through endEnchant). Each gets (ctx, owner, ev, src): src is its effects entry, { owner, card } for a curse, or its enchant entry. Returning true means it fired: a passive leaves Board Effects (passiveFired), a curse stays and a curse-fired event is emitted, an enchantment ends (endEnchant). A handler that returns false must not emit events (it may still change its own card's data, e.g. a counter). One removed by an earlier one doesn't run. A card already running (ctx.busy) is not re-entered by the events it causes, so the nesting is at most one level per card in play; with one-shot passives, at most 2 curses a player and handlers that emit only when they fire, the work stays small.
 */
function trigger(ctx, ev) {
	const s = ctx.state, list = [];
	for (const c of [ctx.turn, other(ctx.turn)]) {
		for (const e of s.effects.filter((x) => x.owner === c).sort((a, b) => a.placedAt - b.placedAt)) list.push({ kind: "passive", id: e.id, key: e.card.key, src: e });
		for (const card of s.players[c].curses) list.push({ kind: "curse", id: card.id, key: card.key, src: { owner: c, card } });
		if (ev.type !== "enchant-ended") for (const e of s.enchant.filter((x) => x.owner === c)) list.push({ kind: "enchant", id: e.id, key: e.key, src: e }); // AN ENDED ENTRY'S OWN CARD HEARS IT THROUGH endEnchant; OTHER ENTRIES DON'T
	}
	const live = { passive: (x) => s.effects.some((e) => e.id === x.id), curse: (x) => s.players[x.src.owner].curses.some((c) => c.id === x.id), enchant: (x) => s.enchant.some((e) => e.id === x.id) };
	for (const x of list) {
		const def = CARDS[x.key], fn = def && def.on && def.on[ev.type];
		if (!fn || ctx.busy.includes(x.id) || !live[x.kind](x)) continue; // NOT LIVE: REMOVED BY AN EARLIER ONE
		ctx.busy.push(x.id);
		if (fn(ctx, x.src.owner, ev, x.src)) {
			if (x.kind === "curse") ctx.emit({ type: "curse-fired", player: x.src.owner, card: x.src.card });
			else if (x.kind === "passive") ctx.passiveFired(x.src);
			else ctx.endEnchant(x.src);
		}
		ctx.busy.pop(); // AFTER ITS FIRED EVENT, SO THAT EVENT CAN'T RE-ENTER IT EITHER
	}
}

/**
 * @description A ctx over state (changed in place). ctx.turn is the colour whose turn is in progress, set before the action applies (board.turn flips inside makeMove). ctx.resetHalf: set by a capture or a pawn move made outside a chess move, so a turn without a move ends with half 0. Every emit runs ctx.trigger, except while ctx.held is an array (a move being applied): then the event waits there and turn.move triggers it once the move is whole. ctx.ticked: the colour whose end-of-turn tick has run in this ctx (what is given to it afterwards is not fresh). ctx.cancelled: set by ctx.cancel() during card-played.
 */
function makeCtx(state) {
	const ctx = {
		state, events: [], turn: state.board.turn, resetHalf: false, busy: [], held: null, ticked: null, cancelled: false,
		emit(ev) { ctx.events.push(ev); if (ctx.held) ctx.held.push(ev); else ctx.trigger(ev); },
		trigger: (ev) => trigger(ctx, ev),
		rng: { next: () => rng.next(state), int: (n) => rng.int(state, n), shuffle: (a) => rng.shuffle(state, a), pick: (a) => rng.pick(state, a) },
		draw(color, n) { for (let i = 0; i < n; i++) hand.drawMove(ctx, color); }, // A PLAIN "DRAW A CARD" IS A MOVE CARD
		discardRandom: (color, n) => hand.discardRandom(ctx, color, n),
		giveStatus: (pieceId, s, turns, by) => statuses.give(ctx, pieceId, s, turns, by),
		/**
		 * @description A card takes the piece with this id outside a chess move: it leaves the board (a rook on its home square takes that castling right with it), then the shared capture handling, and returns true. A king is never taken by a card: returns false and changes nothing (a handler that takes "whatever stands on a square" can meet a king there). Throws for a piece not on the board.
		 */
		capture(player, pieceId) {
			const b = state.board, i = pieceById(b, pieceId), victim = b.sq[i];
			if (!victim) throw new Error("A card can't capture a piece not on the board");
			if (victim.t === "k") return false; // A CARD EFFECT NEVER TAKES A KING
			b.sq[i] = null;
			for (const ch of LOSES[i] || "") b.castling = b.castling.replace(ch, "");
			b.castling = b.castling || "-";
			capture(ctx, player, victim);
			return true;
		},
		/**
		 * @description Ask player to choose one of options: { ...resume, player, kind, options, turn } becomes state.pending, or, when a choice is already pending, joins state.pending.next (the queue, in the order asked); a choice event (no options in it) either way. resume is plain JSON: { card: <key whose choice.resolve(ctx, pending, option) continues>, ...any data resolve needs }; throws without a card. The asking code returns after this; the turn waits until every choice is answered with applyAction(state, player, { type: "choice", option }).
		 */
		ask(player, kind, options, resume) {
			if (!resume || !resume.card) throw new Error("ctx.ask needs resume.card");
			const choice = { ...resume, player, kind, options, turn: ctx.turn };
			if (state.pending) (state.pending.next = state.pending.next || []).push(choice);
			else state.pending = choice;
			ctx.emit({ type: "choice", player, kind });
		},
		/**
		 * @description Called by a handler of card-played: the active just played doesn't run its play (it stays spent; turn.playActive emits card-cancelled). Later handlers of the same card-played still run and can read ctx.cancelled.
		 */
		cancel() { ctx.cancelled = true; },
		/**
		 * @description The one way a card puts an enchantment in play (never push into state.enchant by hand): entry { id: "e<n>", key, owner, pieces, left, data } with an enchant event { player: owner, id, key, pieces: a copy } (no data: it may hold a hidden square). left counts owner's turns (null = until removed); given during owner's own turn before its end-of-turn tick, that turn doesn't count (stored fresh, like a status). Returns the entry.
		 */
		enchant(owner, key, pieces = [], left = null, data = {}) {
			const e = { id: "e" + state.nextId++, key, owner, pieces, left, data };
			if (left !== null && ctx.turn === owner && ctx.ticked !== owner) e.fresh = true;
			state.enchant.push(e);
			ctx.emit({ type: "enchant", player: owner, id: e.id, key, pieces: [...pieces] });
			return e;
		},
		/**
		 * @description An enchantment ends (its turns ran out, its on handler fired, or a card ends it): it leaves state.enchant, an enchant-ended event goes out (other cards' handlers run on it), then its own card's on["enchant-ended"](ctx, owner, event, entry) runs once (return value ignored). Nothing when it already ended.
		 */
		endEnchant(e) {
			if (!state.enchant.some((x) => x.id === e.id)) return; // ALREADY ENDED: ONE END, ONE EVENT
			state.enchant = state.enchant.filter((x) => x.id !== e.id);
			const ev = { type: "enchant-ended", player: e.owner, id: e.id, key: e.key }, own = CARDS[e.key] && CARDS[e.key].on && CARDS[e.key].on["enchant-ended"];
			ctx.emit(ev);
			if (own) own(ctx, e.owner, ev, e);
		},
		/**
		 * @description player loses their next n turns (Player.lostTurns, public): at the start of each, a turn-skipped event, then the end of turn runs as usual (no passive roll); a lost turn that arrives in check is void instead when the player has a King skull (spent automatically; the turn is played). Either way that lost turn is gone. Not a discard skip.
		 */
		skipTurn(player, n = 1) { state.players[player].lostTurns += n; },
		/**
		 * @description The one way a curse is given: refused (false, no change) when `to` already holds 2 curses or `by` still waits (curseWait > 0); else a new card { id, key, ...extra } joins to's curses, by's curseWait becomes 5 (one less at the end of each of by's own turns; 6 when given during by's own turn before its tick, so the giving turn doesn't count: by's next 5 own turns can't give, the 6th can), a curse-given event { player: by, card }; returns the card.
		 */
		giveCurse(to, key, by, extra) {
			const t = state.players[to], g = state.players[by];
			if (t.curses.length >= 2 || g.curseWait > 0) return false;
			const card = hand.newCard(state, key, extra);
			t.curses.push(card);
			g.curseWait = ctx.turn === by && ctx.ticked !== by ? 6 : 5; // 5 OF by'S OWN TURNS AFTER THE GIVING: THE GIVING TURN'S OWN COUNTDOWN DOESN'T COUNT
			ctx.emit({ type: "curse-given", player: by, card });
			return card;
		},
		/**
		 * @description A placed passive (its effects entry) has fired: it leaves Board Effects, a once-per-game card goes into its owner's used, then a passive-fired event. Nothing when it already fired.
		 */
		passiveFired(e) {
			if (!state.effects.some((x) => x.id === e.id)) return; // ALREADY FIRED: ONCE
			state.effects = state.effects.filter((x) => x.id !== e.id);
			if (CARDS[e.card.key] && CARDS[e.card.key].oncePerGame) state.players[e.owner].used.push(e.card.key);
			ctx.emit({ type: "passive-fired", player: e.owner, card: e.card });
		},
	};
	return ctx;
}

module.exports = { makeCtx, capture };
