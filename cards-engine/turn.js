/*
 *  turn.js  --  chess cards engine
 *	The turn: legal actions, resolving one, the free discard, end of turn (ticks, refill), start of turn (passive roll, automatic redraw) and game end.
 *
 */

const { makeMove } = require("./movegen.js");
const { pieceById, sqIndex, sqName } = require("./board.js");
const { inCheck, legalMoves, boardDraw, rulesInPlay, hooksFor } = require("./rules.js");
const statuses = require("./statuses.js");
const hand = require("./hand.js");
const { CARDS } = require("./cards/index.js");
const { makeCtx, capture } = require("./ctx.js");
const duel = require("./duel.js");

const PASSIVE_CHANCE = 1 / 3;
const BUILT_IN = ["move", "active", "passive", "discard", "choice", "duel"]; // ACTION TYPES THE ENGINE RESOLVES ITSELF; choice AND duel ARE RESERVED (NEVER CARD-DEFINED)
const other = (c) => (c === "w" ? "b" : "w");

/**
 * @description Stable string for an action: JSON with every object's keys sorted.
 */
function actionKey(action) {
	return JSON.stringify(action, (k, v) => (v && typeof v === "object" && !Array.isArray(v)
		? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]])) : v));
}

/**
 * @description What state.barred holds for an action Grace takes back: for a move, the move's shape { type, from, to, promotion } (whatever card plays it: a move card, the King card, cardless or routed); for anything else, its actionKey.
 */
function barKey(a) {
	return a.type === "move" ? actionKey({ type: "move", from: a.from, to: a.to, promotion: a.promotion }) : actionKey(a);
}

/**
 * @description The legal moves a card may make for color: no Hexed piece; in a two-move turn that must use different pieces, no piece already moved.
 */
function cardMoves(state, color) {
	const m = state.multi;
	return legalMoves(state, color, (mv) => !statuses.has(state, mv.piece, "hexed") && !(m && m.differ && m.moved.includes(mv.piece)));
}

/**
 * @description The King card's moves for color (castling included), from cardMoves (pass them in when already made). An ordinary king move is free, in check or not. A move legal only with the statuses on color's own king left out (Frozen and Shaken through the hooks, hooksFor(state, kingId); Hexed through the card-move filter) costs a King skull (marked skull: true); never into check, never beside the other king. With kingSkulls 0 those are left out. None without the King card.
 */
function kingMoves(state, color, moves = cardMoves(state, color)) {
	const p = state.players[color], m = state.multi, k = state.board.sq.find((q) => q && q.c === color && q.t === "k");
	if (!hand.kingFree(state, color) || !k) return [];
	const free = moves.filter((mv) => mv.t === "k"), own = state.statuses[k.id];
	if (p.kingSkulls <= 0 || !(own && own.length)) return free; // NO SKULL TO SPEND, OR NOTHING IT WOULD BUY
	const same = (x, y) => x.to === y.to && x.castle === y.castle;
	return legalMoves(state, color, (mv) => mv.piece === k.id && !(m && m.differ && m.moved.includes(k.id)), hooksFor(state, k.id))
		.map((mv) => (free.some((f) => same(f, mv)) ? mv : { ...mv, skull: true }));
}

/**
 * @description Spend one of player's King skulls (automatic, never a choice), with a king-skull event { player, left, why }. why: "status" (the king moved past its own statuses: they are cleared with the move, and their status-ended events and this event come after the move's own move, capture and promote events), "lost-turn" (a lost turn arriving in check is void), "double-move" (the opponent's first move of a two-move turn gave check and they had a second move to make: that turn ends).
 */
function spendSkull(ctx, player, why) {
	const s = ctx.state, p = s.players[player], k = s.board.sq.find((q) => q && q.c === player && q.t === "k");
	if (why === "status") for (const e of [...(s.statuses[k.id] || [])]) statuses.clear(ctx, k.id, e.s);
	p.kingSkulls--;
	ctx.emit({ type: "king-skull", player, left: p.kingSkulls, why });
}

/**
 * @description Move actions for color: one per move card per legal move of its piece type (cardMoves), the cards by id, an entered Mirage among them as the move card it shows (not in check: playing it moves nothing; its act resolves it), and the King card's moves (kingMoves).
 */
function moveActions(state, color) {
	const p = state.players[color], moves = cardMoves(state, color);
	const out = [], add = (card, mv) => out.push(mv.promotion
		? { type: "move", card, from: mv.from, to: mv.to, promotion: mv.promotion } : { type: "move", card, from: mv.from, to: mv.to });
	const checked = inCheck(state, color), cards = hand.moveCards(p).filter((c) => c.key === "move" || !checked); // BY ID, THE ORDER ITS HOLDER SEES, SO A MIRAGE'S PLACE GIVES NOTHING AWAY
	for (const c of cards) for (const mv of moves) if (hand.fits(c.piece, mv.t)) add(c.id, mv);
	for (const mv of kingMoves(state, color, moves)) add("king", mv);
	return out;
}

/**
 * @description Play an active card: it leaves the hand, card-played is emitted, then the card's play runs, unless a handler of card-played called ctx.cancel(): then the card stays spent and a card-cancelled event replaces the play. Every handler of card-played still runs, and later ones can read ctx.cancelled.
 */
function playActive(ctx, color, a) {
	const card = hand.take(ctx.state.players[color], a.card);
	ctx.cancelled = false;
	ctx.emit({ type: "card-played", player: color, card });
	if (ctx.cancelled) return ctx.emit({ type: "card-cancelled", player: color, card });
	CARDS[card.key].play(ctx, color, a.target === undefined ? null : a.target);
}

/**
 * @description Active actions for color: one per target the card offers ([null] = no target), each tried on a copy and dropped when its play leaves color's king in check (so in check, only those that end it). Limit: the copy rolls the real rng, so for an active with a random outcome legalActions would show whether its roll leaves the king in check. No active playable in check may have a random outcome, and no active's random outcome may expose its own king. Card handlers (on, play, rules) also run inside these trials, so a test that counts handler calls through a closure counts the trials too.
 */
function activeActions(state, color) {
	const out = [];
	for (const c of state.players[color].actives) {
		const def = CARDS[c.key];
		if (!def || !def.targets) continue;
		for (const target of def.targets(state, color)) {
			const a = target === null ? { type: "active", card: c.id } : { type: "active", card: c.id, target };
			const ctx = makeCtx(JSON.parse(JSON.stringify(state)));
			ctx.trial = true; // A LEGALITY TRIAL: HIDDEN EFFECTS (TRAPDOOR) DON'T FIRE, SO THE LIST CAN'T REVEAL THEM
			playActive(ctx, color, a);
			if (!inCheck(ctx.state, color)) out.push(a); // AN ACTIVE NEVER LEAVES ITS OWN KING IN CHECK
		}
	}
	return out;
}

/**
 * @description Every action player may take now; empty when the game is over. While a choice is pending, only the pending player's { type: "choice", option } actions (one per pending.options entry; a barred one left out while another remains); else turnActions. While a card duel is open (state.duel, no choice pending) both players get only duel.actions: their picks and the stop-or-go decision (a barred one left out while another remains).
 */
function legalActions(state, player) {
	const pend = state.pending;
	if (!state.result && !pend && state.duel) { // A CARD DUEL HOLDS THE TURN: ONLY ITS PICKS AND DECISIONS, FOR EITHER PLAYER
		const acts = duel.actions(state, player), left = player === state.board.turn ? acts.filter((a) => actionKey(a) !== state.barred) : acts; // THE BAR IS ON THE PLAYER WHOSE TURN IT IS: THE KEY NAMES NO PLAYER
		return left.length ? left : acts; // A BARRED PICK (GRACE) IS LEFT OUT WHILE ANOTHER REMAINS
	}
	if (state.result || !pend) return turnActions(state, player);
	if (pend.player !== player) return [];
	const opts = (pend.options || []).map((option) => ({ type: "choice", option })), left = opts.filter((a) => actionKey(a) !== state.barred); // NO options: REBUILT FROM THE OTHER PLAYER'S VIEW
	return left.length ? left : opts; // A BARRED OPTION (GRACE) IS LEFT OUT WHILE ANOTHER REMAINS: A CHOICE MUST BE ANSWERED
}

/**
 * @description The card whose act resolves a card-defined action: a held card of player's (a.card) or player's own enchantment (a.enchant), with the card's act. Returns { def, src } (src: { owner, card } for a held card, the enchant entry for an enchantment), or null when the source is gone, not player's, or its card has no act.
 */
function sourceOf(state, player, a) {
	const p = state.players[player], held = [...p.moves, ...p.actives, ...p.curses, p.passive].filter(Boolean).find((c) => c.id === a.card);
	const src = a.enchant !== undefined ? state.enchant.find((e) => e.id === a.enchant && e.owner === player) : held && { owner: player, card: held };
	const def = src && CARDS[src.card ? src.card.key : src.key];
	return def && def.act ? { def, src } : null;
}

/**
 * @description Resolve a card-defined action through its source card's act(ctx, player, action, src).
 */
function cardAct(ctx, player, a) {
	const { def, src } = sourceOf(ctx.state, player, a);
	def.act(ctx, player, a, src);
}

/**
 * @description True when a move action's card belongs to another card that resolves it (not the King card, not cardless, not one of player's move cards): act sends it to that card's act.
 */
function routed(state, player, a) {
	return a.card !== "king" && a.card !== null && !state.players[player].moves.some((c) => c.id === a.card);
}

/**
 * @description True when a move action a card added (whatever its card) is sound: player's own piece on from; its card fits (the King card for the king, a held move card of that piece's type, null for cardless, else a held card with an act); a move in rules.legalMoves for that piece, so it never leaves the own king in check unless it takes the enemy king (which ends the game); not a Hexed piece when a card moves it; in a two-move turn with differ, not a piece already moved.
 */
function addedMoveOk(state, player, a) {
	const p = state.players[player], m = state.multi, q = state.board.sq[sqIndex(typeof a.from === "string" ? a.from : "")];
	if (!q || q.c !== player) return false;
	const same = (mv) => mv.from === a.from && mv.to === a.to && mv.promotion === a.promotion;
	if (a.card === "king") return q.t === "k" && kingMoves(state, player).some(same); // SKULL RULES INCLUDED
	const mc = p.moves.find((c) => c.id === a.card), byCard = !!mc;
	if (mc ? !hand.fits(mc.piece, q.t) : a.card !== null && !sourceOf(state, player, a)) return false;
	return legalMoves(state, player, (mv) => mv.piece === q.id && !(byCard && statuses.has(state, mv.piece, "hexed")) && !(m && m.differ && m.moved.includes(mv.piece)))
		.some(same);
}

/**
 * @description The turn's actions for player, ignoring a pending choice; empty when the game is over or it isn't player's turn. During a two-move turn only moves; in check no discard or passive. Then every card in play with rules.actions(state, player, actions, src) -> actions changes the list (rules.rulesInPlay order: placed passives, held curses, enchantments), and what the cards added is checked (anything not built here): an added active, passive or discard is dropped; an added move action stays only when addedMoveOk, and one routed to a card's act also only when, tried on a copy, it leaves player's king out of check; a card-defined action (a type not in BUILT_IN, with card: <held card id> or enchant: <player's enchantment id>) only when sourceOf finds its source, never in a two-move turn, and only when, tried on a copy, it leaves player's king out of check. Then the barred action is left out.
 */
function turnActions(state, player) {
	if (state.result || player !== state.board.turn) return [];
	let out = [...moveActions(state, player)];
	const p = state.players[player], multi = !!(state.multi && state.multi.player === player), checked = inCheck(state, player);
	if (!multi) {
		out.push(...activeActions(state, player));
		if (!checked) {
			const def = p.passive && CARDS[p.passive.key];
			if (p.passive && !(def && def.canPlace && !def.canPlace(state, player))) out.push({ type: "passive" });
		}
	}
	if (!checked && state.discarded !== player && (!multi || state.multi.mulled)) out.push(...freeDiscards(state, player)); // ONCE A TURN, BEFORE THE PLAY: NONE IN A TWO-MOVE TURN, BUT AFTER MULLIGAN (USER RULINGS 2026-11-21)
	const built = new Set(out.map(actionKey));
	for (const [r, src] of rulesInPlay(state)) if (r.actions) out = r.actions(state, player, out, src);
	const survives = (a) => { const ctx = makeCtx(JSON.parse(JSON.stringify(state))); ctx.trial = true; cardAct(ctx, player, a); return !inCheck(ctx.state, player); };
	const ok = (a) => !!a && typeof a === "object" && (built.has(actionKey(a))
		|| (a.type === "move" ? addedMoveOk(state, player, a) && (!routed(state, player, a) || survives(a))
			: !BUILT_IN.includes(a.type) && !multi && !!sourceOf(state, player, a) && survives(a))); // AN ADDED active, passive OR discard IS DROPPED
	return out.filter((a) => ok(a) && (!state.barred || (actionKey(a) !== state.barred && barKey(a) !== state.barred))); // THE EXACT KEY, OR A MOVE'S SHAPE (barKey)
}

/**
 * @description The free discard's actions for player (user rulings 2026-11-21, 2026-11-22): each pair of move cards in hand order (by id; an entered Mirage shows as a move card), { type: "discard", cards: [a, b] }, then each active alone, { type: "discard", cards: [id] }, then the reroll of the passive held in the hand, { type: "discard", cards: [passive id] } (told apart by the id being the held passive's), only while another passive is left to draw (hand.drawable): with none it would only lose the card. Never the King card, a curse or a passive placed in Board Effects.
 */
function freeDiscards(state, player) {
	const p = state.players[player], ms = hand.moveCards(p).map((c) => c.id);
	const reroll = p.passive && hand.drawable(state, player, "passive").length ? [[p.passive.id]] : []; // THE HELD PASSIVE IS ALREADY LEFT OUT OF drawable
	return [...ms.flatMap((a, i) => ms.slice(i + 1).map((b) => [a, b])), ...p.actives.map((c) => [c.id]), ...reroll].map((cards) => ({ type: "discard", cards }));
}

/**
 * @description End the game: result { winner, reason } (winner null for a draw; reason "checkmate", "stalemate", "repetition", "fifty", "material" or "king"), no pending choice, and a game-over event that no card hears (nothing resolves after the game ends).
 */
function end(ctx, winner, reason) {
	ctx.state.result = { winner, reason };
	ctx.state.pending = null; // NO CHOICE OUTLIVES THE GAME
	ctx.events.push({ type: "game-over", player: winner, winner, reason });
}

/**
 * @description Resolve a move action: spend the card (never the King card; none for a cardless move, card null; a King-card move marked skull spends a King skull as part of the move, see below), move, then capture, promotion and check. Their events (move, capture, promote) go out in that order and their triggers run once all of it is applied, so no handler sees a half-applied move; check is decided after those triggers, then emitted. Returns true when a two-move turn goes on (a further move is in legalActions); then the position isn't kept in history and full isn't counted yet. A first move that gives check ends the two-move turn when the mover has a second move and the checked player has a King skull (spent, why "double-move"); with no second move the turn ends anyway and no skull is spent; with no skull it goes on, and the second move may take the king (reason "king"). A King-card move marked skull clears the king's statuses and spends the skull after the move's own events (move, capture, promote, status-ended, king-skull), inside the held triggers.
 */
function move(ctx, player, a) {
	const s = ctx.state, p = s.players[player];
	const mc = a.card === "king" || a.card === null ? null : p.moves.find((c) => c.id === a.card); // THE KING CARD'S MOVES ARE kingMoves', A CARDLESS MOVE IS ITS PIECE'S OWN
	const match = (m) => m.from === a.from && m.to === a.to && m.promotion === a.promotion && (a.card === "king" ? m.t === "k" : !mc || hand.fits(mc.piece, m.t));
	const mv = a.card === "king" ? kingMoves(s, player).find(match) : legalMoves(s, player).find(match);
	const card = a.card === "king" || a.card === null ? a.card : hand.take(p, a.card);
	const vi = mv.capture ? pieceById(s.board, mv.capture) : -1, victim = vi < 0 ? null : s.board.sq[vi], vsq = sqName(vi); // vsq: WHERE IT STOOD (EN PASSANT: THE PAWN'S SQUARE)
	s.board = makeMove(s.board, mv);
	const ev = { type: "move", player, card, piece: mv.piece, from: mv.from, to: mv.to };
	if (mv.castle) ev.castle = mv.castle;
	if (mv.through) ev.through = true; // A CASTLE ONLY castleThroughCheck ALLOWED (rules.legalMoves)
	if (victim && victim.t === "k") { // A KING LEFT IN CHECK ON ITS OWNER'S OPPONENT'S TURN: TAKING IT WINS, NOTHING ELSE RESOLVES
		s.players[victim.c].captured.push("k");
		delete s.statuses[victim.id];
		ctx.events.push(ev, { type: "capture", player, piece: victim.id, t: "k", c: victim.c, by: mv.piece, sq: vsq });
		if (mv.promotion) ctx.events.push({ type: "promote", player, piece: mv.piece, t: mv.promotion });
		end(ctx, player, "king");
		return false;
	}
	ctx.held = []; // EVENTS NOW, TRIGGERS ONCE THE MOVE IS WHOLE
	ctx.emit(ev);
	if (victim) { capture(ctx, player, victim, mv.piece, vsq); ctx.resetHalf = false; } // makeMove ALREADY RESET half FOR ITS OWN CAPTURE
	if (mv.promotion) ctx.emit({ type: "promote", player, piece: mv.piece, t: mv.promotion });
	if (mv.skull) spendSkull(ctx, player, "status"); // PAST THE KING'S OWN STATUSES: PART OF THE MOVE, SO ITS EVENTS ARE HELD TOO
	const held = ctx.held;
	ctx.held = null;
	for (const e of held) ctx.trigger(e);
	const check = inCheck(s, other(player)); // AFTER THE TRIGGERS, SO THE check EVENT AND THE TWO-MOVE DECISION ARE TRUE
	if (check) ctx.emit({ type: "check", player: other(player) }); // player = THE SIDE IN CHECK
	if (inCheck(s, player)) ctx.emit({ type: "check", player }); // A TRIGGER LEFT THE MOVER IN CHECK (A SHIELD TAKEN BY A GUARD, OVERWATCH): SAID NOW, ALSO INSIDE A TWO-MOVE TURN
	const m = s.multi;
	if (!m || m.player !== player) return false;
	m.left--;
	m.moved.push(mv.piece);
	if (m.left <= 0) return false;
	s.board.turn = player; // TRY THE TURN GOING ON: UNDO makeMove'S HANDOVER
	if (!turnActions(s, player).length) { s.board.turn = other(player); return false; } // NO FURTHER MOVE: THE TURN ENDS ON THIS POSITION (NO SKULL)
	if (check && s.players[other(player)].king && s.players[other(player)].kingSkulls > 0) { // THE CHECKED PLAYER'S SKULL ENDS THE TWO-MOVE TURN; WITHOUT ONE (OR WITHOUT THE KING CARD: HOLLOW CROWN) THE SECOND MOVE MAY TAKE THE KING
		s.board.turn = other(player);
		spendSkull(ctx, other(player), "double-move");
		return false;
	}
	s.board.history.pop(); // ONLY END-OF-TURN POSITIONS COUNT FOR REPETITION
	if (player === "b") s.board.full--;
	return true;
}

/**
 * @description Resolve a legal action for player on ctx.state, then end the turn unless the game ended or a two-move turn goes on (after a move, or after an active that set state.multi for player with a move to make). After an active or a card-defined action, a check event when the opponent is in check and the action emitted none (checkAfter). The free discard keeps the turn: its cards go, a pair draws 1 move card back at once (worth at least the lower of the two, hand.drawMove's floor), the held passive draws a different passive at once (the reroll), state.discarded marks it used, and with no card action left the automatic redraw runs now (noAction). After Mulligan (state.multi.mulled) with no move the same. An active that opens a card duel holds the turn until the duel is over; a duel action goes to duelAct. A choice asked during the action holds the end of the turn: pending.end (and resetHalf) record it, and the choice action runs it once after choice.resolve.
 */
function act(ctx, player, a) {
	const s = ctx.state, p = s.players[player];
	ctx.stood = ["w", "b"].filter((c) => inCheck(s, c)); // CHECKS STANDING BEFORE THIS ACTION: ALREADY ANNOUNCED, startTurn DOESN'T SAY THEM AGAIN
	if (a.type === "choice") return choose(ctx, a.option);
	if (a.type === "duel") return duelAct(ctx, player, a);
	if (a.type === "discard") {
		if (p.passive && a.cards[0] === p.passive.id) { // THE REROLL: THE HELD PASSIVE GOES, A DIFFERENT ONE COMES AT ONCE (IT ISN'T used: A LATER DRAW CAN BRING IT BACK)
			const card = p.passive;
			p.passive = null;
			ctx.emit({ type: "discard", player, card });
			hand.drawCard(ctx, player, "passive", card.key);
		} else {
			const floor = a.cards.length === 2 ? Math.min(...hand.moveCards(p).filter((c) => a.cards.includes(c.id)).map((c) => hand.VALUE[c.piece])) : 0; // THE LOWER OF THE TWO, READ BEFORE THEY GO (AN ENTERED MIRAGE: THE TYPE IT SHOWS)
			for (const id of a.cards) hand.discard(ctx, player, id);
			if (a.cards.length === 2) hand.drawMove(ctx, player, floor); // 2 MOVE CARDS: 1 BACK AT ONCE, WORTH THE FLOOR OR MORE. AN ACTIVE COMES BACK WITH THIS TURN'S REFILL
		}
		s.discarded = player;
		return void noAction(ctx, player); // THE TURN GOES ON. NO CARD ACTION LEFT: THE AUTOMATIC REDRAW NOW, STILL NONE IS A STALEMATE (NEVER IN CHECK HERE)
	} else {
		if (a.type === "passive") {
			s.effects.push({ id: p.passive.id, owner: player, card: p.passive, placedAt: s.ply });
			ctx.emit({ type: "passive-placed", player, card: p.passive });
			p.passive = null;
		} else if (a.type === "active") {
			const from = ctx.events.length;
			playActive(ctx, player, a);
			checkAfter(ctx, player, from);
			if (s.duel) return; // ALL OR NOTHING STARTED A CARD DUEL: IT HOLDS THE TURN, AND THE duel ACTION THAT ENDS IT ENDS THE TURN (duelAct)
			if (s.multi && s.multi.player === player && s.multi.left > 0 && (s.multi.mulled ? !noAction(ctx, player) : turnActions(s, player).length)) { // AFTER MULLIGAN WITH NO MOVE: THE AUTOMATIC REDRAW, STILL NONE IS A STALEMATE
				if (ctx.resetHalf) s.board.half = 0; // THE ACTIVE CAPTURED OR MOVED A PAWN BEFORE THE MOVES
				return; // THE ACTIVE STARTED A TWO-MOVE TURN (MULLIGAN'S: ONE MOVE)
			}
		} else if (a.type === "move" && !routed(s, player, a)) {
			if (move(ctx, player, a)) {
				if (ctx.resetHalf) s.board.half = 0; // A TRIGGER CAPTURED DURING THE FIRST MOVE OF A TWO-MOVE TURN
				return;
			}
		} else {
			const from = ctx.events.length;
			cardAct(ctx, player, a); // A CARD-DEFINED ACTION (OR A MOVE UNDER A CARD'S OWN ID): USES THE TURN LIKE AN ACTIVE
			checkAfter(ctx, player, from);
		}
	}
	if (s.pending) return void Object.assign(s.pending, { end: true, resetHalf: ctx.resetHalf }); // THE TURN ENDS AFTER THE CHOICE
	if (!s.result) endTurn(ctx, player);
}

/**
 * @description One check event for player's opponent when they are in check and none was emitted for them since event index from: an active, a card-defined action or a choice that moved or removed a piece gives check as a move does. The event says what holds when it is emitted: a choice resolved later, or the end of the turn (a status given then, e.g. Heretical Subjection's Shaken), can still lift it; the client reads the standing check from the state at turn-start.
 */
function checkAfter(ctx, player, from) {
	const opp = other(player);
	if (!ctx.state.result && !ctx.events.slice(from).some((e) => e.type === "check" && e.player === opp) && inCheck(ctx.state, opp)) ctx.emit({ type: "check", player: opp });
}

/**
 * @description Resolve a duel action (duel.act) by either player during the duel player's turn: a check event when it put that player's opponent in check (an upgrade, or a lost piece opening a line) and no check stood before it (checkAfter); when the duel is over, the duel player's turn ends (after a choice a trigger asked, if any).
 */
function duelAct(ctx, player, a) {
	const s = ctx.state, who = s.duel.player, from = ctx.events.length, was = inCheck(s, other(who));
	const over = duel.act(ctx, player, a);
	if (s.barred && JSON.parse(s.barred).type === "duel") s.barred = null; // GRACE TAKES BACK ONE DUEL ACTION: A LATER STOP OR PICK IS ANOTHER ONE
	if (!was) checkAfter(ctx, who, from);
	if (!over || s.result) return;
	if (s.pending) return void Object.assign(s.pending, { end: true, resetHalf: ctx.resetHalf }); // THE TURN ENDS AFTER THE CHOICE
	endTurn(ctx, who);
}

/**
 * @description Resolve the current choice with option: the next queued one (pending.next) becomes current first, so a choice resolve asks queues behind those asked before it; then its card's choice.resolve runs (ctx.turn back to the turn it was asked in), with a check event when it put the opponent in check (checkAfter). While choices remain, the next current one carries what is left of the turn (end, resetHalf). After the last: the end of turn when pending.end; else, as the turn goes on, a capture made by resolve zeroes half now (as act does when an active starts a two-move turn). Also ends a two-move turn the choice left with no move; in Mulligan's one-move turn that is the automatic redraw instead (noAction; an open free discard doesn't keep the turn waiting) (shortcut: that end adds no history entry and counts half + 1 instead of the move's value; fine while no choice card resolves into a stuck two-move turn).
 */
function choose(ctx, option) {
	const s = ctx.state, pend = s.pending, [head, ...rest] = pend.next || [];
	s.pending = head ? (rest.length ? { ...head, next: rest } : head) : null;
	ctx.turn = pend.turn;
	const from = ctx.events.length, was = inCheck(s, other(pend.turn));
	CARDS[pend.card].choice.resolve(ctx, pend, option);
	if (!was) checkAfter(ctx, pend.turn, from); // ONLY A CHECK THIS resolve MADE: ONE THAT STOOD BEFORE IT WAS ALREADY EMITTED
	const resetHalf = ctx.resetHalf || !!pend.resetHalf;
	if (s.pending && pend.end) return void Object.assign(s.pending, { end: true, resetHalf });
	if (s.result) return;
	if (!s.pending && !pend.end && s.multi && s.multi.mulled && noAction(ctx, pend.turn)) return; // MULLIGAN'S ONE MOVE GONE: THE AUTOMATIC REDRAW, AS RIGHT AFTER MULLIGAN (act); STILL NONE ENDED THE GAME
	if (!s.pending && (pend.end || (s.multi && !turnActions(s, pend.turn).length))) { ctx.resetHalf = resetHalf; return endTurn(ctx, pend.turn); }
	if (ctx.resetHalf) s.board.half = 0; // THE TURN GOES ON (A TWO-MOVE TURN, OR A CHOICE ASKED AT START OF TURN)
}

/**
 * @description End of color's turn: statuses tick, refill, the turn passes, then the other player's start of turn. A turn with no move (active, passive, clear, switch) still hands it over and clears en passant, and sets half = ctx.resetHalf ? 0 : half + 1, so the fifty-move rule keeps counting; it adds no position to history (repetition counts positions reached by moves only). capture() sets ctx.resetHalf; an active that moves a pawn sets ctx.resetHalf = true itself. The flag also holds on a turn with a move: a capture after the move ends the turn with half 0, and an active that starts a two-move turn zeroes half before the moves.
 */
function endTurn(ctx, color) {
	const s = ctx.state;
	ctx.stood = ctx.stood.filter((c) => inCheck(s, c)); // A CHECK LIFTED BEFORE THE TURN PASSES NO LONGER COUNTS AS ANNOUNCED: IF IT COMES BACK, startTurn NAMES IT
	ctx.ticked = color; // GIVEN TO color FROM HERE ON (DURING THE TICKS, REFILL TRIGGERS): NOT fresh, color'S TICK IS RUNNING OR HAS RUN
	const enchants = s.enchant.slice(); // THE ENCHANTMENTS PRESENT WHEN THE TICK STARTS: ONE GIVEN DURING THE STATUS TICK IS NOT TICKED NOW
	statuses.tick(ctx, color);
	tickEnchant(ctx, color, enchants);
	if (s.players[color].curseWait > 0) s.players[color].curseWait--; // giveCurse'S WAIT COUNTS color'S OWN TURNS
	hand.refill(ctx, color);
	if (s.board.turn === color) {
		s.board.turn = other(color);
		s.board.ep = null;
		s.board.half = ctx.resetHalf ? 0 : s.board.half + 1;
		if (color === "b") s.board.full++;
	} else if (ctx.resetHalf) s.board.half = 0; // A CAPTURE MADE AFTER THE MOVE (A PASSIVE FIRING)
	s.ply++;
	s.barred = null;
	s.multi = null;
	s.discarded = null; // THE FREE DISCARD IS ONCE A TURN
	startTurn(ctx, other(color));
}

/**
 * @description End of color's turn, after statuses: every timed enchantment color owns among `enchants` (those present when the tick started) loses a turn and ends at 0 (endEnchant); a `fresh` one (given during this same turn) only loses its fresh mark. left null never ends.
 */
function tickEnchant(ctx, color, enchants) {
	const s = ctx.state;
	for (const e of enchants.filter((x) => x.owner === color && x.left !== null)) {
		if (!s.enchant.includes(e)) continue; // ENDED BY AN EARLIER ONE'S EVENT
		if (e.fresh) delete e.fresh;
		else if (--e.left <= 0) ctx.endEnchant(e);
	}
}

/**
 * @description Start of color's turn: a turn-start event (triggers run on it); a check event for each side in check that no check event of this action named, but not for color when its check already stood before this action began (ctx.stood, set by act: it was announced then; the side that just played and is still in check is always named) (a trigger or a status ending made it, e.g. Overwatch taking a shield); a player with lostTurns has one less and loses this turn (a turn-skipped event, then endTurn: ticks, refill, half + 1, play passes; no passive roll; a two-move turn started at this turn start is dropped, so its refill is the usual one), unless in check with a King skull: the skull is spent and the lost turn is void, so the turn is played; else the passive roll (from their second turn, empty slot only); a just-started two-move turn with no move to make is dropped (a normal turn, so the actives are offered); no card action (move, active, or card-defined action) → move cards thrown out and a full hand redrawn, max(thrown out, 6; 7 while hand.big: Underdog) under the 9 cap and ignoring refillLock; still none → checkmate by the cards in check, else stalemate. Then the board draws (repetition, fifty, material), even when plain chess has no move.
 */
function startTurn(ctx, color) {
	const s = ctx.state, p = s.players[color];
	ctx.turn = color;
	ctx.resetHalf = false; // A NEW TURN
	ctx.emit({ type: "turn-start", player: color });
	if (s.result) return;
	for (const c of [other(color), color]) if (inCheck(s, c) && !(c === color && (ctx.stood || []).includes(c)) && !ctx.events.some((e) => e.type === "check" && e.player === c)) ctx.emit({ type: "check", player: c }); // A CHECK NO MOVE ANNOUNCED: A TRIGGER REMOVED A SHIELD (OVERWATCH), A STATUS ENDED, A TURN-START EFFECT
	if (p.lostTurns > 0) {
		p.lostTurns--; // GONE FOR GOOD, LOST OR VOID
		if (p.king && p.kingSkulls > 0 && inCheck(s, color)) spendSkull(ctx, color, "lost-turn"); // VOID: THE PLAYER ANSWERS THE CHECK (NO SKULL IS SPENT WHILE THE KING CARD IS GONE: HOLLOW CROWN)
		else {
			ctx.emit({ type: "turn-skipped", player: color });
			if (s.multi && s.multi.player === color) s.multi = null; // A TWO-MOVE TURN STARTED AT THIS TURN START (FOUR OF A KIND SAW A VOID LOST TURN, THEN DEBT TOOK THE KING CARD: HOLLOW CROWN): NOT PLAYED, SO ITS DEBUFF IS DROPPED (THE CARD STAYS SPENT)
			return endTurn(ctx, color);
		}
	}
	if (s.ply >= 2 && !p.passive && ctx.rng.next() < PASSIVE_CHANCE) hand.drawCard(ctx, color, "passive");
	if (s.multi && s.multi.player === color && !s.multi.moved.length && !turnActions(s, color).some((a) => a.type === "move")) s.multi = null; // A TURN-START EFFECT (DEBT AND HUNGER, FOR TWO) TOOK A JUST-STARTED TWO-MOVE TURN'S ONLY MOVE: A NORMAL TURN, SO THE ACTIVES ARE OFFERED (FOUR OF A KIND STAYS SPENT, ITS DEBUFF DROPPED)
	if (noAction(ctx, color)) return;
	if (ctx.resetHalf) s.board.half = 0; // A CARD CAPTURED AT THE START OF THE TURN
	const draw = boardDraw(s.board); // CARD MATE AND STALEMATE ARE DECIDED ABOVE, FROM THE HAND
	if (draw) end(ctx, null, draw);
}

/**
 * @description The no-legal-action rule for color (startTurn; after a free discard or Mulligan; Grace after barring a move): with no card action (move, active, or card-defined action; cardless moves count, a discard or placing a passive doesn't), move cards are thrown out and a full hand redrawn, max(thrown out, 6; 7 while hand.big: Underdog) under the 9 cap and ignoring refillLock; still none → checkmate by the cards in check, else stalemate. Returns true when the game ended.
 */
function noAction(ctx, color) {
	const s = ctx.state, p = s.players[color];
	const cardActions = () => turnActions(s, color).filter((a) => a.type !== "passive" && a.type !== "discard");
	if (cardActions().length) return false;
	const { out, ms } = hand.throwMoves(p); // AN ENTERED MIRAGE GOES WITH THEM AND COMES BACK HIDDEN AMONG THE DRAWS
	ctx.emit({ type: "redraw", player: color });
	hand.drawMoves(ctx, color, Math.max(out.length, hand.MOVES + hand.big(s, color)), ms); // UNDERDOG BEHIND: 7
	if (cardActions().length) return false;
	const mate = inCheck(s, color);
	end(ctx, mate ? other(color) : null, mate ? "checkmate" : "stalemate");
	return true;
}

module.exports = { PASSIVE_CHANCE, actionKey, barKey, legalActions, act, endTurn, startTurn, noAction };
