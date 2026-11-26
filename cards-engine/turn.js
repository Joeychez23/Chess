/*
 *  turn.js  --  chess cards engine
 *	The turn: the legal actions, resolving one, the free discard and the drops, the end of the turn (ticks, refill),
 *	the start of the next (passive roll, automatic redraw) and the end of the game.
 *
 */

const { makeMove } = require("./movegen.js");
const { pieceById, sqIndex, sqName } = require("./board.js");
const { inCheck, legalMoves, boardDraw, rulesInPlay, hooksFor } = require("./rules.js");
const statuses = require("./statuses.js");
const hand = require("./hand.js");
const { CARDS, baseKey } = require("./cards/index.js");
const { makeCtx, capture } = require("./ctx.js");
const duel = require("./duel.js");

const PASSIVE_CHANCE = 1 / 3;
// How many placed passives may wait in Board Effects for one player; how many move cards the free discard takes in one turn
const PASSIVES = 3, MOVE_DISCARDS = 2;
// The action types the engine resolves itself. "choice" and "duel" are reserved: no card may define them
const BUILT_IN = ["move", "active", "passive", "discard", "drop", "choice", "duel"];

function other(color) {
	return color === "w" ? "b" : "w";
}

/**
 * @description A stable string for an action: its JSON with every object's keys sorted.
 */
function actionKey(action) {
	return JSON.stringify(action, sortObjectKeys);
}

/**
 * @description actionKey's JSON.stringify replacer: a plain object comes back with its keys sorted, anything else as it is.
 */
function sortObjectKeys(_key, value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	return Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));
}

/**
 * @description What state.barred holds for an action Grace takes back. For a move, the move's shape { type, from, to,
 * promotion }, whatever card plays it (a move card, the King card, cardless or routed); for anything else its actionKey.
 */
function barKey(action) {
	if (action.type !== "move") return actionKey(action);
	return actionKey({ type: "move", from: action.from, to: action.to, promotion: action.promotion });
}

/* ---------------------------------------------------------------- */
// The legal actions
/* ---------------------------------------------------------------- */

/**
 * @description Every action player may take now; empty when the game is over.
 * While a card duel is open (state.duel, no choice pending) both players get only duel.actions: their picks and the
 * stop-or-go decision. While a choice is pending, only the pending player gets actions: one { type: "choice", option }
 * per pending.options entry. In both, a barred action (Grace) is left out while another remains. Otherwise turnActions.
 */
function legalActions(state, player, blind) {
	const pending = state.pending;
	if (!state.result && !pending && state.duel) {
		const actions = duel.actions(state, player);
		// The bar is on the player whose turn it is: the key itself names no player
		const allowed = player === state.board.turn ? actions.filter((action) => actionKey(action) !== state.barred) : actions;
		return allowed.length ? allowed : actions;
	}
	if (state.result || !pending) return turnActions(state, player, blind);
	if (pending.player !== player) return [];
	// A choice saved with no options was rebuilt from the other player's view: it offers nothing
	const options = (pending.options || []).map((option) => ({ type: "choice", option }));
	const allowed = options.filter((action) => actionKey(action) !== state.barred);
	// A choice must be answered, so the barred option comes back when it is the only one
	return allowed.length ? allowed : options;
}

/**
 * @description The turn's actions for player, ignoring a pending choice; empty when the game is over or it isn't
 * player's turn. In a two-move turn only moves. In check no free discard and no passive. The drops (dropActions) come
 * outside a two-move turn, in check too; the free discard and the drops stay open after Mulligan. Then the cards in
 * play change the list and what they added is checked (applyCardRules), and the barred action is left out.
 */
function turnActions(state, player, blind) {
	if (state.result || player !== state.board.turn) return [];
	const actions = [...moveActions(state, player)];
	const multi = !!(state.multi && state.multi.player === player);
	const checked = inCheck(state, player);
	if (!multi) {
		actions.push(...activeActions(state, player));
		if (!checked && canPlacePassive(state, player)) actions.push({ type: "passive" });
	}
	// The free discard and the drops come before the play, so they are also open before Mulligan's one move
	if (!checked && (!multi || state.multi.mulled)) actions.push(...freeDiscards(state, player));
	if (!multi || state.multi.mulled) actions.push(...dropActions(state, player, blind));
	return applyCardRules(state, player, actions, multi);
}

/**
 * @description True exactly when legalActions(state, player) holds action (compared by actionKey). It builds only
 * action.type's actions, narrowed by the action's card (and a move's from) where the builders allow: applyAction's
 * check. Outside the turn (a choice pending, a duel open, the game over, not player's turn) it asks legalActions, which
 * is cheap there. It relies on every card's rules.actions treating the list one action at a time (adding actions, or
 * dropping ones by their own shape), as all do now: a rule that looked at the whole list would need the full list.
 * Pure.
 */
function isLegal(state, player, action) {
	const outsideTurn = !action || typeof action !== "object" || state.result || state.pending || state.duel
		|| player !== state.board.turn;
	if (outsideTurn) {
		const key = actionKey(action);
		return legalActions(state, player).some((offered) => actionKey(offered) === key);
	}
	const multi = !!(state.multi && state.multi.player === player);
	const open = !multi || state.multi.mulled;
	const checked = inCheck(state, player);
	let built = [];
	if (action.type === "move") built = moveActions(state, player, action);
	else if (action.type === "active" && !multi) built = activeActions(state, player, action);
	else if (action.type === "passive" && !multi && !checked) {
		if (canPlacePassive(state, player)) built = [{ type: "passive" }];
	} else if (action.type === "discard" && !checked && open) built = freeDiscards(state, player);
	else if (action.type === "drop" && open) built = dropActions(state, player, false, action.card);
	// A card-defined type builds nothing here: only the cards' rules can add it
	return applyCardRules(state, player, built, multi, actionKey(action)).length > 0;
}

/**
 * @description The move actions for color: one per move card per legal move of its piece type (cardMoves), the cards
 * by id, and the King card's moves (kingMoves). An entered Mirage is among them as the move card it shows, but not in
 * check: playing it moves nothing, its act resolves it. only (isLegal): just the ones with only's card and from.
 */
function moveActions(state, color, only) {
	const player = state.players[color];
	const moves = cardMoves(state, color, only && ((mv) => mv.from === only.from));
	const checked = inCheck(state, color);
	// By id, the order their holder sees, so a Mirage's place in the hand gives nothing away
	const cards = hand.moveCards(player).filter((card) => (card.key === "move" || !checked) && (!only || card.id === only.card));
	const actions = [];
	for (const card of cards) {
		for (const mv of moves) if (hand.fits(card.piece, mv.t)) actions.push(moveAction(card.id, mv));
	}
	// Narrowed to the king's from, moves still holds every free king move
	if (!only || only.card === "king") for (const mv of kingMoves(state, color, moves)) actions.push(moveAction("king", mv));
	return actions;
}

/**
 * @description The move action that plays mv with card; promotion only when the move promotes.
 */
function moveAction(card, mv) {
	if (mv.promotion) return { type: "move", card, from: mv.from, to: mv.to, promotion: mv.promotion };
	return { type: "move", card, from: mv.from, to: mv.to };
}

/**
 * @description The legal moves a card may make for color: no Hexed piece, and in a two-move turn that must use
 * different pieces, no piece already moved. also(mv), when given, narrows them further (isLegal).
 */
function cardMoves(state, color, also) {
	return legalMoves(state, color, (mv) => !statuses.has(state, mv.piece, "hexed") && !alreadyMoved(state, mv.piece)
		&& (!also || also(mv)));
}

/**
 * @description True when pieceId has already moved in a two-move turn whose moves must use different pieces.
 */
function alreadyMoved(state, pieceId) {
	const multi = state.multi;
	return !!(multi && multi.differ && multi.moved.includes(pieceId));
}

/**
 * @description The King card's moves for color, castling included, from cardMoves (passed in when already made);
 * none without the King card. An ordinary king move is free, in check or not. A move that is legal only with the
 * statuses on color's own king left out (Frozen and Shaken through the hooks, hooksFor(state, kingId); Hexed through
 * the card-move filter) costs a King skull and is marked skull: true. It never goes into check or beside the other
 * king. With kingSkulls 0 those are left out.
 */
function kingMoves(state, color, moves = cardMoves(state, color)) {
	const player = state.players[color];
	const king = findKing(state, color);
	if (!hand.kingFree(state, color) || !king) return [];
	const free = moves.filter((mv) => mv.t === "k");
	const kingStatuses = state.statuses[king.id];
	// No skull to spend, or nothing a skull would buy
	if (player.kingSkulls <= 0 || !(kingStatuses && kingStatuses.length)) return free;
	const sameMove = (moveA, moveB) => moveA.to === moveB.to && moveA.castle === moveB.castle;
	const kingOnly = (mv) => mv.piece === king.id && !alreadyMoved(state, king.id);
	return legalMoves(state, color, kingOnly, hooksFor(state, king.id))
		.map((mv) => (free.some((freeMove) => sameMove(freeMove, mv)) ? mv : { ...mv, skull: true }));
}

/**
 * @description color's king on the board.
 */
function findKing(state, color) {
	return state.board.sq.find((piece) => piece && piece.c === color && piece.t === "k");
}

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
 * @description A ctx over a copy of state for a legality trial: hidden effects (Trapdoor) don't fire on it, so the
 * offered actions can't reveal them.
 */
function trialCtx(state) {
	const ctx = makeCtx(JSON.parse(JSON.stringify(state)));
	ctx.trial = true;
	return ctx;
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
 * @description The sides in check on state.
 */
function sidesInCheck(state) {
	return ["w", "b"].filter((color) => inCheck(state, color));
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
 * @description The last step on the actions the turn built: every card in play with rules.actions(state, player,
 * actions, src) changes the list (rules.rulesInPlay order: placed passives, held curses, enchantments), what the cards
 * added is checked (isSoundAction), and the barred action is left out. want (isLegal): keep only the action with that
 * actionKey, before the checks, so no other added action is tried.
 */
function applyCardRules(state, player, actions, multi, want) {
	const built = new Set(actions.map(actionKey));
	for (const [rule, src] of rulesInPlay(state)) if (rule.actions) actions = rule.actions(state, player, actions, src);
	const kept = [];
	for (const action of actions) {
		if (want !== undefined && actionKey(action) !== want) continue;
		if (!isSoundAction(state, player, action, built, multi)) continue;
		// Barred by the exact key, or a move by its shape (barKey)
		if (state.barred && (actionKey(action) === state.barred || barKey(action) === state.barred)) continue;
		kept.push(action);
	}
	return kept;
}

/**
 * @description True when an action in the list is one the turn built, or a sound one a card added. An added active,
 * passive, discard or drop is not. An added move stays only when addedMoveOk, and one routed to a card's act also only
 * when, tried on a copy, it leaves player's king out of check. A card-defined action (a type not in BUILT_IN, with
 * card: <held card id> or enchant: <player's enchantment id>) stays only when sourceOf finds its source, never in a
 * two-move turn, and only when, tried on a copy, it leaves player's king out of check.
 */
function isSoundAction(state, player, action, built, multi) {
	if (!action || typeof action !== "object") return false;
	if (built.has(actionKey(action))) return true;
	if (action.type === "move") {
		return addedMoveOk(state, player, action) && (!isRouted(state, player, action) || survivesTrial(state, player, action));
	}
	return !BUILT_IN.includes(action.type) && !multi && !!sourceOf(state, player, action) && survivesTrial(state, player, action);
}

/**
 * @description True when a move action a card added (whatever its card) is sound: player's own piece on from; its card
 * fits (the King card for the king, a held move card of that piece's type, null for cardless, else a held card with an
 * act); a move in rules.legalMoves for that piece, so it never leaves the own king in check unless it takes the enemy
 * king (which ends the game); not a Hexed piece when a move card moves it; in a two-move turn with differ, not a piece
 * already moved.
 */
function addedMoveOk(state, player, action) {
	const holder = state.players[player];
	const square = state.board.sq[sqIndex(typeof action.from === "string" ? action.from : "")];
	if (!square || square.c !== player) return false;
	const isThisMove = (mv) => mv.from === action.from && mv.to === action.to && mv.promotion === action.promotion;
	// kingMoves brings the King skull rules with it
	if (action.card === "king") return square.t === "k" && kingMoves(state, player).some(isThisMove);
	const moveCard = holder.moves.find((card) => card.id === action.card);
	if (moveCard ? !hand.fits(moveCard.piece, square.t) : action.card !== null && !sourceOf(state, player, action)) return false;
	const pieceMoves = legalMoves(state, player, (mv) => mv.piece === square.id
		&& !(moveCard && statuses.has(state, mv.piece, "hexed")) && !alreadyMoved(state, mv.piece));
	return pieceMoves.some(isThisMove);
}

/**
 * @description True when a move action's card is another card that resolves it (not the King card, not cardless, not
 * one of player's move cards): act sends it to that card's act.
 */
function isRouted(state, player, action) {
	return action.card !== "king" && action.card !== null && !state.players[player].moves.some((card) => card.id === action.card);
}

/**
 * @description True when the card-resolved action, tried on a copy, leaves player's king out of check.
 */
function survivesTrial(state, player, action) {
	const ctx = trialCtx(state);
	cardAct(ctx, player, action);
	return !inCheck(ctx.state, player);
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

/* ---------------------------------------------------------------- */
// Resolving an action
/* ---------------------------------------------------------------- */

/**
 * @description Resolve a legal action for player on ctx.state, then end the turn, unless the game ended or a two-move
 * turn goes on (after a move, or after an active that set state.multi for player with a move to make).
 * - A choice goes to resolveChoice, a duel action to duelAct.
 * - A drop (dropActions) and the free discard (resolveDiscard) keep the turn; with no card action left the automatic
 *   redraw runs now (noAction).
 * - A passive placed with PASSIVES already waiting replaces the player's oldest (placePassive).
 * - After an active or a card-defined action, a check event when the opponent is in check and the action emitted none
 *   (checkAfter). An active that opens a card duel holds the turn until the duel is over. After Mulligan
 *   (state.multi.mulled) with no move, the automatic redraw.
 * - A choice asked during the action holds the end of the turn: pending.end (and resetHalf) record it, and the choice
 *   action runs it once choice.resolve has run.
 */
function act(ctx, player, action) {
	const state = ctx.state;
	// The checks standing before this action were already announced: startTurn doesn't say them again
	ctx.stood = sidesInCheck(state);
	if (action.type === "choice") return resolveChoice(ctx, action.option);
	if (action.type === "duel") return duelAct(ctx, player, action);
	if (action.type === "drop") {
		resolveDrop(ctx, player, action);
		// Free, like the free discard: the turn goes on
		return void noAction(ctx, player);
	}
	if (action.type === "discard") {
		resolveDiscard(ctx, player, action);
		// The turn goes on. With no card action left the automatic redraw runs now, and still none is a stalemate
		// (never in check here)
		return void noAction(ctx, player);
	}
	if (action.type === "passive") placePassive(ctx, player);
	else if (action.type === "active") {
		const from = ctx.events.length;
		playActive(ctx, player, action);
		checkAfter(ctx, player, from);
		// All or Nothing started a card duel: it holds the turn, and the duel action that ends the duel ends the turn (duelAct)
		if (state.duel) return;
		// More than a question: on the Mulligan path this can redraw the hand and end the game
		if (activeStartedTwoMoveTurn(ctx, player)) {
			// The active captured or moved a pawn before the moves
			if (ctx.resetHalf) state.board.half = 0;
			return;
		}
	} else if (action.type === "move" && !isRouted(state, player, action)) {
		if (resolveMove(ctx, player, action)) {
			// A trigger captured during the first move of a two-move turn
			if (ctx.resetHalf) state.board.half = 0;
			return;
		}
	} else {
		// A card-defined action, or a move under a card's own id: it uses the turn like an active
		const from = ctx.events.length;
		cardAct(ctx, player, action);
		checkAfter(ctx, player, from);
	}
	// The turn ends after the choice is answered
	if (state.pending) return void Object.assign(state.pending, { end: true, resetHalf: ctx.resetHalf });
	if (!state.result) endTurn(ctx, player);
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
 * @description After an active: true when it started a two-move turn for player with a move to make, so the turn goes
 * on. After Mulligan (multi.mulled) this asks noAction instead: with no move left the automatic redraw runs, and still
 * none is a stalemate.
 */
function activeStartedTwoMoveTurn(ctx, player) {
	const multi = ctx.state.multi;
	if (!(multi && multi.player === player && multi.left > 0)) return false;
	if (multi.mulled) return !noAction(ctx, player);
	return !!turnActions(ctx.state, player).length;
}

/**
 * @description One check event for player's opponent when they are in check and no check event named them since event
 * index from: an active, a card-defined action or a choice that moved or removed a piece gives check as a move does.
 * The event says what holds when it is emitted: a choice resolved later, or the end of the turn (a status given then,
 * e.g. Heretical Subjection's Shaken), can still lift it; the client reads the standing check from the state at
 * turn-start.
 */
function checkAfter(ctx, player, from) {
	const opponent = other(player);
	if (ctx.state.result) return;
	if (ctx.events.slice(from).some((event) => event.type === "check" && event.player === opponent)) return;
	if (inCheck(ctx.state, opponent)) ctx.emit({ type: "check", player: opponent });
}

/**
 * @description Resolve a move action: spend the card, move, then capture, promotion and check. No card is spent for
 * the King card or a cardless move (card null); a King-card move marked skull spends a King skull as part of the move.
 * The move, capture and promote events go out in that order and their triggers run once all of it is applied, so no
 * handler sees a half-applied move; check is decided after those triggers, then emitted. A King-card move marked skull
 * clears the king's statuses and spends the skull after the move's own events (move, capture, promote, status-ended,
 * king-skull), inside the held triggers.
 * Returns true when a two-move turn goes on (twoMoveTurnGoesOn).
 */
function resolveMove(ctx, player, action) {
	const state = ctx.state, holder = state.players[player];
	// The King card's moves are kingMoves'; a cardless move is its piece's own
	const moveCard = action.card === "king" || action.card === null ? null : holder.moves.find((heldCard) => heldCard.id === action.card);
	const isThisMove = (mv) => mv.from === action.from && mv.to === action.to && mv.promotion === action.promotion
		&& (action.card === "king" ? mv.t === "k" : !moveCard || hand.fits(moveCard.piece, mv.t));
	const mv = action.card === "king" ? kingMoves(state, player).find(isThisMove) : legalMoves(state, player).find(isThisMove);
	const card = action.card === "king" || action.card === null ? action.card : hand.take(holder, action.card);
	if (card && card !== "king") {
		// Played: to the discard pile, face down under the mover's fog (view.js hides the card of a fogged move)
		const fogged = state.enchant.some((entry) => baseKey(entry.key) === "fog-of-war" && entry.owner === player);
		hand.toPile(state, player, card, fogged);
	}
	const victimIndex = mv.capture ? pieceById(state.board, mv.capture) : -1;
	const victim = victimIndex < 0 ? null : state.board.sq[victimIndex];
	// Where the victim stood (en passant: the pawn's square, not the move's to)
	const victimSquare = sqName(victimIndex);
	state.board = makeMove(state.board, mv);
	const moveEvent = { type: "move", player, card, piece: mv.piece, from: mv.from, to: mv.to };
	if (mv.castle) moveEvent.castle = mv.castle;
	// A castle that only castleThroughCheck allowed (rules.legalMoves)
	if (mv.through) moveEvent.through = true;
	if (victim && victim.t === "k") {
		// A king left in check on its owner's opponent's turn: taking it wins, and nothing else resolves
		state.players[victim.c].captured.push("k");
		delete state.statuses[victim.id];
		ctx.events.push(moveEvent, { type: "capture", player, piece: victim.id, t: "k", c: victim.c, by: mv.piece, sq: victimSquare });
		if (mv.promotion) ctx.events.push({ type: "promote", player, piece: mv.piece, t: mv.promotion });
		endGame(ctx, player, "king");
		return false;
	}
	// The events go out now, their triggers once the move is whole
	ctx.held = [];
	ctx.emit(moveEvent);
	if (victim) {
		capture(ctx, player, victim, mv.piece, victimSquare);
		// makeMove already reset half for its own capture
		ctx.resetHalf = false;
	}
	if (mv.promotion) ctx.emit({ type: "promote", player, piece: mv.piece, t: mv.promotion });
	// Past the king's own statuses: part of the move, so its events are held too
	if (mv.skull) spendSkull(ctx, player, "status");
	const held = ctx.held;
	ctx.held = null;
	for (const event of held) ctx.trigger(event);
	// After the triggers, so the check event and the two-move decision are true
	const opponent = other(player);
	const gaveCheck = inCheck(state, opponent);
	if (gaveCheck) ctx.emit({ type: "check", player: opponent });
	// A trigger left the mover in check (a shield taken by a guard, Overwatch): said now, also inside a two-move turn
	if (inCheck(state, player)) ctx.emit({ type: "check", player });
	return twoMoveTurnGoesOn(ctx, player, mv, gaveCheck);
}

/**
 * @description Spend one of player's King skulls (automatic, never a choice), with a king-skull event { player, left,
 * why }. why is one of:
 * - "status": the king moved past its own statuses. They are cleared with the move, and their status-ended events and
 *   this event come after the move's own move, capture and promote events.
 * - "lost-turn": a lost turn arriving in check is void.
 * - "double-move": the opponent's first move of a two-move turn gave check and they had a second move to make: that
 *   turn ends.
 */
function spendSkull(ctx, player, why) {
	const state = ctx.state, holder = state.players[player], king = findKing(state, player);
	if (why === "status") {
		for (const entry of [...(state.statuses[king.id] || [])]) statuses.clear(ctx, king.id, entry.s);
	}
	holder.kingSkulls--;
	ctx.emit({ type: "king-skull", player, left: holder.kingSkulls, why });
}

/**
 * @description After a move in player's two-move turn: true when the turn goes on (a further move is in
 * legalActions). Then the position isn't kept in history and full isn't counted yet.
 * A first move that gives check ends the two-move turn when the mover has a second move and the checked player has a
 * King skull (spent, why "double-move"). With no second move the turn ends anyway and no skull is spent. With no skull
 * it goes on, and the second move may take the king (reason "king").
 */
function twoMoveTurnGoesOn(ctx, player, mv, gaveCheck) {
	const state = ctx.state, multi = state.multi, opponent = other(player);
	if (!multi || multi.player !== player) return false;
	multi.left--;
	multi.moved.push(mv.piece);
	if (multi.left <= 0) return false;
	// Try the turn going on: undo makeMove's handover
	state.board.turn = player;
	if (!turnActions(state, player).length) {
		// No further move: the turn ends on this position, and no skull is spent
		state.board.turn = opponent;
		return false;
	}
	// The checked player's skull ends the two-move turn. Without one, or without the King card (Hollow Crown), the
	// second move may take the king
	const checkedPlayer = state.players[opponent];
	if (gaveCheck && checkedPlayer.king && checkedPlayer.kingSkulls > 0) {
		state.board.turn = opponent;
		spendSkull(ctx, opponent, "double-move");
		return false;
	}
	// Only end-of-turn positions count for repetition
	state.board.history.pop();
	if (player === "b") state.board.full--;
	return true;
}

/**
 * @description Resolve a card-defined action through its source card's act(ctx, player, action, src).
 */
function cardAct(ctx, player, action) {
	const { def, src } = sourceOf(ctx.state, player, action);
	def.act(ctx, player, action, src);
}

/**
 * @description Resolve a duel action (duel.act) by either player during the duel player's turn. A check event when it
 * put that player's opponent in check (an upgrade, or a lost piece opening a line) and no check stood before it
 * (checkAfter). When the duel is over, the duel player's turn ends (after a choice a trigger asked, if any).
 */
function duelAct(ctx, player, action) {
	const state = ctx.state, duelPlayer = state.duel.player, from = ctx.events.length;
	const checkStood = inCheck(state, other(duelPlayer));
	const over = duel.act(ctx, player, action);
	// Grace takes back one duel action: a later stop or pick is another one
	if (state.barred && JSON.parse(state.barred).type === "duel") state.barred = null;
	if (!checkStood) checkAfter(ctx, duelPlayer, from);
	if (!over || state.result) return;
	// The turn ends after the choice is answered
	if (state.pending) return void Object.assign(state.pending, { end: true, resetHalf: ctx.resetHalf });
	endTurn(ctx, duelPlayer);
}

/**
 * @description Resolve the current choice with option. The next queued choice (pending.next) becomes current first,
 * so a choice that resolve asks queues behind those asked before it. Then the card's choice.resolve runs (ctx.turn back
 * to the turn it was asked in), with a check event when it put the opponent in check (checkAfter).
 * While choices remain, the next current one carries what is left of the turn (end, resetHalf). After the last: the end
 * of the turn when pending.end; else, as the turn goes on, a capture made by resolve zeroes half now (as act does when
 * an active starts a two-move turn). It also ends a two-move turn the choice left with no move; in Mulligan's one-move
 * turn that is the automatic redraw instead (noAction; an open free discard doesn't keep the turn waiting).
 * (shortcut: that end adds no history entry and counts half + 1 instead of the move's value; fine while no choice card
 * resolves into a stuck two-move turn).
 */
function resolveChoice(ctx, option) {
	const state = ctx.state, asked = state.pending;
	const [head, ...rest] = asked.next || [];
	state.pending = head ? (rest.length ? { ...head, next: rest } : head) : null;
	ctx.turn = asked.turn;
	const from = ctx.events.length, checkStood = inCheck(state, other(asked.turn));
	CARDS[asked.card].choice.resolve(ctx, asked, option);
	// Only a check this resolve made: one that stood before it was already emitted
	if (!checkStood) checkAfter(ctx, asked.turn, from);
	const resetHalf = ctx.resetHalf || !!asked.resetHalf;
	if (state.pending && asked.end) return void Object.assign(state.pending, { end: true, resetHalf });
	if (state.result) return;
	// Mulligan's one move is gone: the automatic redraw, as right after Mulligan (act). Still none ended the game
	if (!state.pending && !asked.end && state.multi && state.multi.mulled && noAction(ctx, asked.turn)) return;
	if (!state.pending && (asked.end || (state.multi && !turnActions(state, asked.turn).length))) {
		ctx.resetHalf = resetHalf;
		return endTurn(ctx, asked.turn);
	}
	// The turn goes on (a two-move turn, or a choice asked at the start of the turn)
	if (ctx.resetHalf) state.board.half = 0;
}

/* ---------------------------------------------------------------- */
// The end and the start of a turn
/* ---------------------------------------------------------------- */

/**
 * @description End of color's turn: statuses tick, enchantments tick, refill, the actives whose effect is over leave
 * the active spots (sweepActiveSpots), the turn passes, then the other player's start of turn.
 * A turn with no move (active, passive, clear, switch) still hands the turn over and clears en passant, and sets
 * half = ctx.resetHalf ? 0 : half + 1, so the fifty-move rule keeps counting; it adds no position to history
 * (repetition counts positions reached by moves only). capture() sets ctx.resetHalf; an active that moves a pawn sets
 * ctx.resetHalf = true itself. The flag also holds on a turn with a move: a capture after the move ends the turn with
 * half 0, and an active that starts a two-move turn zeroes half before the moves.
 */
function endTurn(ctx, color) {
	const state = ctx.state, player = state.players[color];
	// A check lifted before the turn passes no longer counts as announced: if it comes back, startTurn names it
	ctx.stood = ctx.stood.filter((side) => inCheck(state, side));
	// What is given to color from here on (during the ticks and the refill's triggers) is not fresh: color's tick is
	// running or has run
	ctx.ticked = color;
	// The enchantments present when the tick starts: one given during the status tick is not ticked now
	const enchants = state.enchant.slice();
	statuses.tick(ctx, color);
	tickEnchant(ctx, color, enchants);
	// giveCurse's wait counts color's own turns
	if (player.curseWait > 0) player.curseWait--;
	hand.refill(ctx, color);
	sweepActiveSpots(ctx);
	// A passive that left this turn can be drawn again from the next
	player.gone = [];
	if (state.board.turn === color) {
		state.board.turn = other(color);
		state.board.ep = null;
		state.board.half = ctx.resetHalf ? 0 : state.board.half + 1;
		if (color === "b") state.board.full++;
	} else if (ctx.resetHalf) {
		// The move already handed the turn over: a capture made after it (a passive firing) still zeroes half
		state.board.half = 0;
	}
	state.ply++;
	state.barred = null;
	state.multi = null;
	// The free discard's kind and count belong to the turn
	state.discarded = null;
	startTurn(ctx, other(color));
}

/**
 * @description End of color's turn, after statuses: every timed enchantment color owns among enchants (those present
 * when the tick started) loses a turn and ends at 0 (endEnchant). A fresh one (given during this same turn) only loses
 * its fresh mark. left null never ends.
 */
function tickEnchant(ctx, color, enchants) {
	const state = ctx.state;
	for (const entry of enchants.filter((enchantment) => enchantment.owner === color && enchantment.left !== null)) {
		// Ended by an earlier one's event
		if (!state.enchant.includes(entry)) continue;
		if (entry.fresh) delete entry.fresh;
		else if (--entry.left <= 0) ctx.endEnchant(entry);
	}
}

/**
 * @description The actives whose effect is over leave their active spot for their owner's discard pile, a card-ended
 * event each (either player's; endTurn runs it): one with no enchantment of its own left (inEffect). So an active with
 * no lasting effect goes at the end of the turn it was played in.
 */
function sweepActiveSpots(ctx) {
	for (const color of ["w", "b"]) {
		const player = ctx.state.players[color];
		for (const [card, entry] of inEffect(ctx.state, color)) {
			if (entry) continue;
			player.spot = player.spot.filter((held) => held !== card);
			hand.toPile(ctx.state, color, card);
			ctx.emit({ type: "card-ended", player: color, card });
		}
	}
}

/**
 * @description Start of color's turn:
 * - a turn-start event (triggers run on it);
 * - the checks no event of this action named (announceChecks);
 * - a lost turn (loseTurn): lost, or void in check with a King skull;
 * - else the passive roll (from the second turn on, empty slot only);
 * - a just-started two-move turn with no move to make is dropped: a normal turn, so the actives are offered;
 * - no card action: the automatic redraw, and still none ends the game (noAction);
 * - then the board draws (repetition, fifty, material), even when plain chess has no move.
 */
function startTurn(ctx, color) {
	const state = ctx.state, player = state.players[color];
	ctx.turn = color;
	// A new turn
	ctx.resetHalf = false;
	ctx.emit({ type: "turn-start", player: color });
	if (state.result) return;
	announceChecks(ctx, color);
	if (player.lostTurns > 0 && loseTurn(ctx, color)) return;
	if (state.ply >= 2 && !player.passive && ctx.rng.next() < PASSIVE_CHANCE) hand.drawCard(ctx, color, "passive");
	// A turn-start effect (Debt, for one) took a just-started two-move turn's only move: it becomes a normal turn, so the
	// actives are offered (Four of a Kind stays spent, its debuff dropped)
	const multi = state.multi;
	if (multi && multi.player === color && !multi.moved.length && !turnActions(state, color).some((action) => action.type === "move")) {
		state.multi = null;
	}
	if (noAction(ctx, color)) return;
	// A card captured at the start of the turn
	if (ctx.resetHalf) state.board.half = 0;
	// Card mate and stalemate are decided above, from the hand
	const draw = boardDraw(state.board);
	if (draw) endGame(ctx, null, draw);
}

/**
 * @description A check event for each side in check that no check event of this action named: a check no move
 * announced (a trigger removed a shield, as Overwatch does; a status ended; a turn-start effect). Not for color when its
 * check already stood before this action began (ctx.stood, set by act): it was announced then. The side that just
 * played and is still in check is always named.
 */
function announceChecks(ctx, color) {
	for (const side of [other(color), color]) {
		if (!inCheck(ctx.state, side)) continue;
		if (side === color && (ctx.stood || []).includes(side)) continue;
		if (ctx.events.some((event) => event.type === "check" && event.player === side)) continue;
		ctx.emit({ type: "check", player: side });
	}
}

/**
 * @description color has a lost turn (lostTurns > 0): one is gone for good, lost or void. In check with a King skull
 * the skull is spent and the lost turn is void, so the turn is played: returns false. Else the turn is lost: a
 * turn-skipped event, then endTurn (ticks, refill, half + 1, play passes; no passive roll): returns true. A two-move
 * turn started at this turn start is dropped then, so its refill is the usual one.
 */
function loseTurn(ctx, color) {
	const state = ctx.state, player = state.players[color];
	player.lostTurns--;
	// No skull is spent while the King card is gone (Hollow Crown)
	if (player.king && player.kingSkulls > 0 && inCheck(state, color)) {
		spendSkull(ctx, color, "lost-turn");
		return false;
	}
	ctx.emit({ type: "turn-skipped", player: color });
	// Four of a Kind can start a two-move turn at a turn start whose lost turn was void and then lost again (Debt took
	// the King card: Hollow Crown). That turn is not played, so its debuff is dropped; the card stays spent
	if (state.multi && state.multi.player === color) state.multi = null;
	endTurn(ctx, color);
	return true;
}

/**
 * @description The no-legal-action rule for color (startTurn; after a free discard or Mulligan; Grace after barring a
 * move). With no card action (cardActions), move cards are thrown out and a full hand is redrawn: as many as were thrown
 * out, and at least hand.HAND_MOVES (5; 6 while hand.big: Underdog), under the move-card cap of 9 and ignoring refillLock. Still none, and
 * no drop that, tried on a copy, itself leaves one: checkmate by the cards when in check, else stalemate. A drop that
 * opens nothing doesn't keep the game alive and buys no further redraw. Returns true when the game ended.
 */
function noAction(ctx, color) {
	const state = ctx.state;
	if (cardActions(state, color).length) return false;
	// An entered Mirage goes with them and comes back hidden among the draws
	const thrown = hand.throwMoves(state, color);
	ctx.emit({ type: "redraw", player: color });
	// hand.big adds one while Underdog's player is behind
	hand.drawMoves(ctx, color, Math.max(thrown.out.length, hand.HAND_MOVES + hand.big(state, color)), thrown.ms);
	if (cardActions(state, color).length) return false;
	// A drop that would leave a card action (a Stronghold on the only mobile piece) keeps the game going
	if (turnActions(state, color).some((action) => action.type === "drop" && dropOpensCardAction(state, color, action))) return false;
	const mate = inCheck(state, color);
	endGame(ctx, mate ? other(color) : null, mate ? "checkmate" : "stalemate");
	return true;
}

/**
 * @description color's card actions: moves (cardless ones count), actives and card-defined actions. A free discard, a
 * drop or placing a passive is not one.
 */
function cardActions(state, color) {
	return turnActions(state, color).filter((action) => action.type !== "passive" && action.type !== "discard" && action.type !== "drop");
}

/**
 * @description True when the drop, tried on a copy, itself leaves color a card action. Only what the drop opens
 * counts: no second redraw for a card that does nothing.
 */
function dropOpensCardAction(state, color, action) {
	const ctx = trialCtx(state);
	resolveDrop(ctx, color, action);
	return cardActions(ctx.state, color).length > 0;
}

/**
 * @description End the game: result { winner, reason } (winner null for a draw; reason "checkmate", "stalemate",
 * "repetition", "fifty", "material" or "king"), no pending choice, and a game-over event that no card hears (nothing
 * resolves after the game ends).
 */
function endGame(ctx, winner, reason) {
	ctx.state.result = { winner, reason };
	// No choice outlives the game
	ctx.state.pending = null;
	ctx.events.push({ type: "game-over", player: winner, winner, reason });
}

module.exports = { PASSIVE_CHANCE, PASSIVES, actionKey, barKey, legalActions, isLegal, act, endTurn, startTurn, noAction };
