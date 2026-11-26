/*
 *  ctx.js  --  chess cards engine
 *	The context an action resolves through: the state, the events so far, and the helpers cards act with (triggers,
 *	choices, captures, enchantments).
 *
 */

const rng = require("./rng.js");
const hand = require("./hand.js");
const statuses = require("./statuses.js");
const { pieceById, sqName } = require("./board.js");
const { CASTLING_LOST } = require("./movegen.js");
const { CARDS, CURSE_KEYS, RARITY_WEIGHTS, baseKey } = require("./cards/index.js");

const CURSE_LIMIT = 2; // curses a player may hold
const CURSE_WAIT = 5; // own turns a giver waits after giving one

function other(color) {
	return color === "w" ? "b" : "w";
}

/**
 * @description The one curse-limit test: true when `by` may give `to` a curse now: `to` holds fewer than opts.max
 * curses (default CURSE_LIMIT; Infinity for no limit) and `by` doesn't wait (curseWait 0), unless opts.wait === false.
 * Versions that relax the limit pass opts (Hexcraft's legendary { max: 4, wait: false }, Bad Omen's epic
 * { max: Infinity, wait: false }).
 */
function canCurse(state, to, by, opts = {}) {
	const limit = opts.max === undefined ? CURSE_LIMIT : opts.max;
	return state.players[to].curses.length < limit && (opts.wait === false || state.players[by].curseWait <= 0);
}

/**
 * @description A captured piece (already off the board): a capture event { player, piece, t, c: the victim's colour,
 * by: the capturing piece's id, null for a card effect, sq: the square it stood on (en passant: the pawn's square),
 * passed in since the piece is gone, from: only for a card's ranged shot, the shooting piece's square (Overwatch's
 * bishop: the client plays the shot; view.js keeps it under fog, SQUARE_KEYS) }, its statuses cleared, its type added
 * to its owner's captured list, ctx.resetHalf set (for a capture made outside a chess move); a Marked piece makes the
 * capturer draw a move card and its owner discard 2 random cards.
 */
function capture(ctx, player, victim, by = null, sq, from) {
	const state = ctx.state;
	const isMarked = statuses.has(state, victim.id, "marked");
	ctx.resetHalf = true;
	ctx.emit({ type: "capture", player, piece: victim.id, t: victim.t, c: victim.c, by, sq, ...(from ? { from } : {}) });
	for (const entry of state.statuses[victim.id] || []) statuses.clear(ctx, victim.id, entry.s);
	state.players[victim.c].captured.push(victim.t);
	if (isMarked) {
		ctx.draw(player, 1);
		ctx.discardRandom(victim.c, 2);
	}
}

/**
 * @description After each event, the cards in play whose card has on[ev.type] run: those of the player whose turn it
 * is (ctx.turn) first, then the other's; within a player, placed passives by placedAt, then held curses in hand order,
 * then enchantments in the order they were added (not for enchant-ended: only the ended entry's own card hears that,
 * through endEnchant). Each gets (ctx, owner, ev, src): src is its effects entry, { owner, card } for a curse, or its
 * enchant entry. Returning true means it fired: a passive leaves Board Effects (passiveFired), a curse stays and a
 * curse-fired event is emitted, an enchantment ends (endEnchant). A handler that returns false must not emit events
 * (it may still change its own card's data, e.g. a counter). One removed by an earlier one doesn't run. A card already
 * running (ctx.busy) is not re-entered by the events it causes, so the nesting is at most one level per card in play;
 * with one-shot passives, a few curses a player (2 under the curse limit, more only through Hexcraft's legendary and
 * Bad Omen's epic versions) and handlers that emit only when they fire, the work stays small.
 */
function triggerCards(ctx, ev) {
	const state = ctx.state;
	for (const listener of listenersInOrder(state, ctx.turn, ev)) {
		const def = CARDS[listener.key];
		const handler = def && def.on && def.on[ev.type];
		// Not live: removed by an earlier one
		if (!handler || ctx.busy.includes(listener.id) || !isLive(state, listener)) continue;
		ctx.busy.push(listener.id);
		if (handler(ctx, listener.src.owner, ev, listener.src)) {
			if (listener.kind === "curse") ctx.emit({ type: "curse-fired", player: listener.src.owner, card: listener.src.card });
			else if (listener.kind === "passive") ctx.passiveFired(listener.src);
			else ctx.endEnchant(listener.src);
		}
		// Popped after its fired event, so that event can't re-enter it either
		ctx.busy.pop();
	}
}

/**
 * @description Every card in play that may hear ev, in the order triggerCards runs them, taken once before any runs.
 */
function listenersInOrder(state, turn, ev) {
	const list = [];
	for (const color of [turn, other(turn)]) {
		const placed = state.effects.filter((entry) => entry.owner === color).sort((a, b) => a.placedAt - b.placedAt);
		for (const entry of placed) list.push({ kind: "passive", id: entry.id, key: entry.card.key, src: entry });
		for (const card of state.players[color].curses) {
			list.push({ kind: "curse", id: card.id, key: card.key, src: { owner: color, card } });
		}
		// An ended entry's own card hears enchant-ended through endEnchant; other entries don't
		if (ev.type === "enchant-ended") continue;
		for (const entry of state.enchant.filter((enchantment) => enchantment.owner === color))
			list.push({ kind: "enchant", id: entry.id, key: entry.key, src: entry });
	}
	return list;
}

function isLive(state, listener) {
	if (listener.kind === "passive") return state.effects.some((entry) => entry.id === listener.id);
	if (listener.kind === "curse") return state.players[listener.src.owner].curses.some((card) => card.id === listener.id);
	return state.enchant.some((entry) => entry.id === listener.id);
}

function curseWeight(key) {
	return RARITY_WEIGHTS[CARDS[key].rarity];
}

/**
 * @description A ctx over state (changed in place). ctx.turn is the colour whose turn is in progress, set before the
 * action applies (board.turn flips inside makeMove). ctx.resetHalf: set by a capture or a pawn move made outside a
 * chess move, so a turn without a move ends with half 0. Every emit runs ctx.trigger, except while ctx.held is an
 * array (a move being applied): then the event waits there and turn.js resolveMove triggers it once the move is whole.
 * ctx.ticked: the colour whose end-of-turn tick has run in this ctx (what is given to it afterwards is not fresh).
 * ctx.cancelled: set by ctx.cancel() during card-played. ctx.trial: true on the copies turn.js plays to test an
 * action's legality (activeActions, a card-defined action's trial): a hidden effect (Trapdoor) does not fire there, so
 * the offered actions never depend on it. ctx.stood: the sides in check when the action began (turn.act sets it;
 * turn.endTurn drops a side no longer in check): their check was already announced, so startTurn doesn't name the side
 * to move again.
 */
function makeCtx(state) {
	const ctx = {
		state,
		events: [],
		turn: state.board.turn,
		resetHalf: false,
		busy: [],
		held: null,
		ticked: null,
		cancelled: false,
		trial: false,
		stood: [],
		emit(ev) {
			ctx.events.push(ev);
			if (ctx.held) ctx.held.push(ev);
			else ctx.trigger(ev);
		},
		trigger(ev) {
			triggerCards(ctx, ev);
		},
		rng: {
			next() {
				return rng.next(state);
			},
			int(limit) {
				return rng.int(state, limit);
			},
			shuffle(list) {
				return rng.shuffle(state, list);
			},
			pick(list) {
				return rng.pick(state, list);
			},
		},
		// A plain "draw a card" is a move card
		draw(color, count) {
			for (let i = 0; i < count; i++) hand.drawMove(ctx, color);
		},
		discardRandom(color, count) {
			return hand.discardRandom(ctx, color, count);
		},
		giveStatus(pieceId, status, turns, by) {
			return statuses.give(ctx, pieceId, status, turns, by);
		},
		/**
		 * @description A card takes the piece with this id outside a chess move: it leaves the board (a rook on its home
		 * square takes that castling right with it), then the shared capture handling (from: the shooting piece's square
		 * of a ranged shot, on the capture event), and returns true. A king is never taken by a card: returns false and
		 * changes nothing (a handler that takes "whatever stands on a square" can meet a king there). Throws for a piece
		 * not on the board.
		 */
		capture(player, pieceId, from) {
			const board = state.board;
			const square = pieceById(board, pieceId);
			const victim = board.sq[square];
			if (!victim) throw new Error("A card can't capture a piece not on the board");
			// A card effect never takes a king
			if (victim.t === "k") return false;
			board.sq[square] = null;
			for (const right of CASTLING_LOST[square] || "") board.castling = board.castling.replace(right, "");
			board.castling = board.castling || "-";
			capture(ctx, player, victim, null, sqName(square), from);
			return true;
		},
		/**
		 * @description Ask player to choose one of options: { ...resume, player, kind, options, turn } becomes
		 * state.pending, or, when a choice is already pending, joins state.pending.next (the queue, in the order asked);
		 * a choice event (no options in it) either way. resume is plain JSON: { card: <key whose
		 * choice.resolve(ctx, pending, option) continues>, ...any data resolve needs }; throws without a card. The asking
		 * code returns after this; the turn waits until every choice is answered with
		 * applyAction(state, player, { type: "choice", option }).
		 */
		ask(player, kind, options, resume) {
			if (!resume || !resume.card) throw new Error("ctx.ask needs resume.card");
			const choice = { ...resume, player, kind, options, turn: ctx.turn };
			if (state.pending) {
				state.pending.next = state.pending.next || [];
				state.pending.next.push(choice);
			} else {
				state.pending = choice;
			}
			ctx.emit({ type: "choice", player, kind });
		},
		/**
		 * @description Called by a handler of card-played: the active just played doesn't run its play (it stays spent;
		 * turn.playActive emits card-cancelled). Later handlers of the same card-played still run and can read
		 * ctx.cancelled.
		 */
		cancel() {
			ctx.cancelled = true;
		},
		/**
		 * @description The one way a card puts an enchantment in play (never push into state.enchant by hand): entry
		 * { id: "e<n>", key, owner, pieces, left, data } with an enchant event { player: owner, id, key, pieces: a copy }
		 * (no data: it may hold a hidden square). left counts owner's turns (null = until removed); given during owner's
		 * own turn before its end-of-turn tick, that turn doesn't count (stored fresh, like a status). Returns the entry.
		 */
		enchant(owner, key, pieces = [], left = null, data = {}) {
			const entry = { id: "e" + state.nextId++, key, owner, pieces, left, data };
			if (left !== null && ctx.turn === owner && ctx.ticked !== owner) entry.fresh = true;
			state.enchant.push(entry);
			ctx.emit({ type: "enchant", player: owner, id: entry.id, key, pieces: [...pieces] });
			return entry;
		},
		/**
		 * @description An enchantment ends (its turns ran out, its on handler fired, or a card ends it): it leaves
		 * state.enchant, an enchant-ended event goes out (other cards' handlers run on it), then its own card's
		 * on["enchant-ended"](ctx, owner, event, entry) runs once (return value ignored). Nothing when it already ended.
		 */
		endEnchant(entry) {
			// Already ended: one end, one event
			if (!state.enchant.some((enchantment) => enchantment.id === entry.id)) return;
			state.enchant = state.enchant.filter((enchantment) => enchantment.id !== entry.id);
			const ev = { type: "enchant-ended", player: entry.owner, id: entry.id, key: entry.key };
			const def = CARDS[entry.key];
			const own = def && def.on && def.on["enchant-ended"];
			ctx.emit(ev);
			if (own) own(ctx, entry.owner, ev, entry);
		},
		/**
		 * @description player loses their next `count` turns (Player.lostTurns, public): at the start of each, a turn-skipped
		 * event, then the end of turn runs as usual (no passive roll); a lost turn that arrives in check is void instead
		 * when the player has a King skull (spent automatically; the turn is played), and only while they hold the King
		 * card (a Hollow Crown can take it: then the turn is lost and no skull is spent). Either way that lost turn is
		 * gone. Not a discard skip.
		 */
		skipTurn(player, count = 1) {
			state.players[player].lostTurns += count;
		},
		/**
		 * @description The one way a curse is given: refused (false, no change) when canCurse(state, to, by, opts) says
		 * no, or when to already holds a curse with this key (a player never holds two of one curse, whatever the limit:
		 * a waiting Mirage counts, a passable curse passed back is then simply lost, and a Pact that turns while its
		 * holder has a Debt gives no second Debt); else a new card { id, key, ...make(ctx, to) } (the curse unit's
		 * optional make builds its own fields, e.g. Mirage's piece; a made id is kept and no number is taken from nextId)
		 * joins to's curses, by's curseWait becomes CURSE_WAIT (one less at the end of each of by's own turns; one more
		 * when given during by's own turn before its tick, so the giving turn doesn't count: by's next 5 own turns can't
		 * give, the 6th can) unless opts.wait === false (a give that ignores the wait starts none), a curse-given event
		 * { player: by, card }; returns the card.
		 */
		giveCurse(to, key, by, opts = {}) {
			if (!canCurse(state, to, by, opts)) return false;
			if (state.players[to].curses.some((curse) => baseKey(curse.key) === baseKey(key))) return false;
			const make = CARDS[key] && CARDS[key].make;
			const made = make ? make(ctx, to) : undefined;
			// A curse that names its own id (a waiting Mirage) takes no number from nextId: its holder would see the gap
			const card = made && made.id ? { id: made.id, key, ...made } : hand.newCard(state, key, made);
			state.players[to].curses.push(card);
			// 5 of by's own turns after the giving: the giving turn's own countdown doesn't count
			if (opts.wait !== false) state.players[by].curseWait = ctx.turn === by && ctx.ticked !== by ? CURSE_WAIT + 1 : CURSE_WAIT;
			// A copy: a Mirage entering at this action's refill changes its id
			ctx.emit({ type: "curse-given", player: by, card: { ...card } });
			return card;
		},
		/**
		 * @description `count` different curse keys (fewer when fewer are registered), each picked by RARITY_WEIGHTS through
		 * state.rng among those not yet picked and not held by `to` (a waiting Mirage counts; giveCurse would refuse
		 * them); [] when none is left. Hexcraft's two, Bad Omen's one.
		 */
		randomCurses(count, to) {
			const held = to ? state.players[to].curses.map((curse) => baseKey(curse.key)) : [];
			const keys = CURSE_KEYS.filter((key) => !held.includes(baseKey(key)));
			const out = [];
			while (out.length < count && keys.length) {
				let roll = ctx.rng.int(keys.reduce((total, key) => total + curseWeight(key), 0));
				// The first key whose weight takes the roll below zero
				const picked = keys.findIndex((key) => (roll -= curseWeight(key)) < 0);
				out.push(keys.splice(picked, 1)[0]);
			}
			return out;
		},
		/**
		 * @description The one way a held curse leaves its holder's hand (its clear action, Cleanse, firing once, being
		 * passed back): it leaves player's curses, a curse-cleared event { player, card } (other cards' handlers run on
		 * it), then the curse's own on["curse-cleared"](ctx, player, event, { owner: player, card }) runs once (return
		 * value ignored; no curse-fired). Returns false (no event) when player doesn't hold it.
		 */
		clearCurse(player, card) {
			const holder = state.players[player];
			// Already gone: one clear, one event
			if (!holder.curses.some((curse) => curse.id === card.id)) return false;
			holder.curses = holder.curses.filter((curse) => curse.id !== card.id);
			const ev = { type: "curse-cleared", player, card };
			const def = CARDS[card.key];
			const own = def && def.on && def.on["curse-cleared"];
			ctx.emit(ev);
			// Gone from curses, so triggerCards didn't reach it: it hears its own clearing here (Hollow Crown)
			if (own) own(ctx, player, ev, { owner: player, card });
			return true;
		},
		/**
		 * @description A placed passive (its effects entry) has fired: it leaves Board Effects for its owner's discard
		 * pile, a once-per-game card goes into its owner's used, then a passive-fired event. Nothing when it already
		 * fired.
		 */
		passiveFired(entry) {
			// Already fired: once
			if (!state.effects.some((effect) => effect.id === entry.id)) return;
			state.effects = state.effects.filter((effect) => effect.id !== entry.id);
			const def = CARDS[entry.card.key];
			if (def && def.oncePerGame) state.players[entry.owner].used.push(entry.card.key);
			hand.toPile(state, entry.owner, entry.card);
			ctx.emit({ type: "passive-fired", player: entry.owner, card: entry.card });
		},
	};
	return ctx;
}

module.exports = { makeCtx, capture, canCurse, CURSE_LIMIT, CURSE_WAIT };
