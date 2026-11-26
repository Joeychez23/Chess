/*
 *  view.js  --  chess cards engine
 *	What each player may see. playerView and playerEvents take out what a player may not see (the server sends only
 *	these), playerLegal is the list of actions a player is told, and fromView rebuilds a playable state from a view for
 *	Card Guy's search.
 *	The fog guarantee: nothing a view, the events or the told list show may depend on where the pieces hidden by a Fog
 *	of War stand.
 *
 */

const rng = require("./rng.js");
const board = require("./board.js");
const hand = require("./hand.js");
const { inCheck } = require("./rules.js");
const { makeCtx } = require("./ctx.js");
const { CARDS, baseKey } = require("./cards/index.js");
const duel = require("./duel.js");
const { isSight } = require("./cards/sight.js");

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

// The opponent's player fields a view shows as they are
const OPEN_FIELDS = ["king", "used", "refillLock", "curseWait", "lostTurns", "kingSkulls", "captured"];

// Fields that hold square names, never piece ids
const SQUARE_KEYS = ["square", "from", "to", "ep", "sq", "through"];

// Under the opponent's Fog of War these are told as if the hidden pieces were not there, and refused on play
const BLIND_CARDS = ["trapdoor", "swap", "all-or-nothing"];

function other(color) {
	return color === "w" ? "b" : "w";
}

function copy(value) {
	return JSON.parse(JSON.stringify(value));
}

function byId(a, b) {
	return Number(a.id.slice(1)) - Number(b.id.slice(1));
}

function handOf(side) {
	return [...side.moves, ...side.actives, ...(side.passive ? [side.passive] : []), ...side.curses];
}

// A Mirage as its holder sees it
function disguise(card) {
	return { id: card.id, key: "move", piece: card.piece };
}

// Square index 0 is a8, so white's half is 32 and up
function onHalf(index, color) {
	return color === "w" ? index >= 32 : index < 32;
}

/**
 * @description The ids of color's pieces on color's half: the pieces a Fog of War of color's hides
 */
function hiddenIds(state, color) {
	return state.board.sq.filter((piece, index) => piece && piece.c === color && onHalf(index, color)).map((piece) => piece.id);
}

/**
 * @description value with every trace of these piece ids removed, in place, at any depth: an array element or a property
 * value equal to one, and a property keyed by one. Fields in SQUARE_KEYS are left alone
 * shortcut: a square name held under any other key (a card target) that equals a hidden black piece's id is removed too;
 * name such a field in SQUARE_KEYS if a client misses it
 */
function scrub(value, ids) {
	if (!value || typeof value !== "object" || !ids.length) return value;
	if (Array.isArray(value)) {
		for (let i = value.length - 1; i >= 0; i--) {
			if (ids.includes(value[i])) value.splice(i, 1);
		}
	}
	for (const key of Object.keys(value)) {
		// A square name (b1..b8) can look like a black piece's id
		if (SQUARE_KEYS.includes(key)) continue;
		if (!Array.isArray(value) && (ids.includes(key) || ids.includes(value[key]))) delete value[key];
		else scrub(value[key], ids);
	}
	return value;
}

/**
 * @description True when color's pieces on color's half are hidden from viewer: viewer is the other player and color
 * has a Fog of War (any version) up
 */
function fogged(state, color, viewer) {
	return color !== viewer && state.enchant.some((enchant) => baseKey(enchant.key) === "fog-of-war" && enchant.owner === color);
}

/**
 * @description True when viewer may see this card of the opponent's. It is face up; or it is any curse (the giver knows
 * it); or the opponent's base Fog of War is up, which shows their whole hand (its versions, under their own keys, keep
 * it hidden); or viewer's Foresight or Witness revealed it (viewer's seen.ids, or the whole hand with seen.all); or it
 * is an option of viewer's current choice that shows the opponent's cards (pending.show: Pickpocket's pick)
 */
function shownTo(state, viewer, card) {
	const opp = other(viewer);
	const seen = state.players[viewer].seen;
	const pending = state.pending;
	return !!card.faceUp
		|| state.enchant.some((enchantment) => enchantment.key === "fog-of-war" && enchantment.owner === opp)
		|| state.players[opp].curses.some((curse) => curse.id === card.id)
		|| (!!seen && (!!seen.all || seen.ids.includes(card.id)))
		|| (!!pending && !!pending.show && pending.player === viewer && pending.options.includes(card.id));
}

/* ---------------------------------------------------------------- */
// The view
/* ---------------------------------------------------------------- */

/**
 * @description The state as player may see it. View.you = player, and there is no rng.
 * - The opponent's player is rebuilt from OPEN_FIELDS, so a field not listed stays hidden, plus showOpponentCards' hand,
 *   spot, pile and kept.
 * - Player's own hand: an entered Mirage is a move card of its fake type, a waiting one (given, not yet entered at a
 *   refill) is nowhere. Player's own side has no seen field (it would tell the fakes apart), and their pile's top comes
 *   without its down mark.
 * - piled, the last cards to join either discard pile, newest first, { player, card }: the opponent's face-down card
 *   is { down: true } (no id, key or piece) until the game is over; player's own come without the mark.
 * - No enchantment's data.ids or data.fake (sight bookkeeping). A Trapdoor's square only for its owner.
 * - Phalanx's denied and Peasant Immunity's stopping only on player's own passives, and not under the opponent's Fog of
 *   War: they tell a hidden piece is a pawn.
 * - While the game is on, a veiled status (Tremor's Frozen) is left out for its piece's owner, and a status's by (its
 *   caster) shows only to the piece's owner and the caster.
 * - The current pending choice in full only to its player (the other sees { player, kind }); queued choices to nobody.
 * - Under the opponent's Fog of War: hideFoggedPieces.
 * - A finished game (state.result) hides no piece and shows the opponent's whole hand (the real cards, no fakes), their
 *   pile's top and remembered card, and a Trapdoor's square.
 */
function playerView(state, player) {
	const view = copy(state);
	const opp = other(player);
	const own = view.players[player];
	const theirs = view.players[opp];
	const opponent = Object.fromEntries(OPEN_FIELDS.map((field) => [field, theirs[field]]));
	view.players[opp] = opponent;
	delete view.rng;
	view.you = player;

	// Player's own hand, by id. A waiting Mirage shows nowhere until it enters at a refill
	own.moves = hand.moveCards(own).map((card) => (card.key === "move" ? card : disguise(card)));
	own.curses = own.curses.filter((card) => baseKey(card.key) !== "mirage");
	delete own.seen;
	showOpponentCards(opponent, theirs, state, player);
	if (own.pile && own.pile.top) delete own.pile.top.down;
	// A save from before the discard list (hand.toPile) has none: empty
	view.piled = (view.piled || []).map((entry) => discardEntryAsSeen(entry, state, opp));
	// Not the kind: "passive" would tell the other player they held one
	if (view.discarded && view.discarded.player === opp && !state.result) view.discarded = { player: opp, n: view.discarded.n };

	for (const enchantment of view.enchant) {
		if (!state.result && baseKey(enchantment.key) === "trapdoor" && enchantment.owner !== player && enchantment.data) {
			delete enchantment.data.square;
		}
	}
	// Which cards a sight shows, and which of them are fake (sight.js), stay hidden
	for (const enchantment of view.enchant) {
		if (enchantment.data && isSight(enchantment)) {
			delete enchantment.data.ids;
			delete enchantment.data.fake;
		}
	}

	// A finished game hides nothing
	const fog = !state.result && fogged(state, opp, player);
	// Phalanx's and Peasant Immunity's bookkeeping reads true piece types (a fogged "?" pawn). Player's own stays while no
	// fog hides a piece: fromView needs it to play as the real game
	for (const effect of view.effects) {
		if (fog || effect.owner !== player) {
			delete effect.card.denied;
			delete effect.card.stopping;
		}
	}
	if (!state.result) hideStatuses(view, state, player);
	// No deck and no face-down card, for either player
	if (view.duel) duel.hide(view.duel);
	// The current choice only: queued ones (next) show to nobody until they are current. The other player sees what the
	// choice event told them
	if (view.pending) {
		const { next, ...current } = view.pending;
		view.pending = current.player === player ? current : { player: current.player, kind: current.kind };
	}
	if (fog) hideFoggedPieces(view, state, opp);
	return view;
}

/**
 * @description The opponent's cards as player may see them, onto opponent (the view's rebuilt player) from theirs (the
 * full one):
 * - hand { count, shown }: count is every card held but the King card; shown is the cards player may see plus
 *   Interdicted Foresight's fakes, by id, with a fake under a card shown for real left out
 * - spot: their active spot (played cards, public)
 * - pile { n, top }: their discard pile; top is the card, { down: true } for one player was never shown, null when empty
 * - kept: their remembered move card of the free discard; { down: true } unless face up, null when none (never gone:
 *   the passives that left this turn)
 */
function showOpponentCards(opponent, theirs, state, player) {
	const seen = state.players[player].seen;
	// A finished game shows the whole hand
	const real = handOf(theirs).filter((card) => state.result || shownTo(state, player, card));
	// A fake wearing the id of a card shown for real gives way; once the game is over there are none
	const fakes = seen && !state.result ? seen.fake.filter((fake) => !real.some((card) => card.id === fake.id)) : [];
	const shown = real.concat(fakes).sort(byId);
	opponent.hand = { count: handOf(theirs).length, shown };
	const top = theirs.pile && theirs.pile.top ? cardOrBack(theirs.pile.top, state) : null;
	opponent.spot = theirs.spot || [];
	opponent.pile = { n: (theirs.pile && theirs.pile.n) || 0, top };
	opponent.kept = theirs.kept ? cardOrBack({ ...theirs.kept, down: !theirs.kept.faceUp }, state) : null;
}

/**
 * @description A discard list entry as player may see it: a back only for the other player's face-down card, as their
 * pile's top
 */
function discardEntryAsSeen(entry, state, opp) {
	return { player: entry.player, card: cardOrBack({ ...entry.card, down: entry.player === opp && entry.card.down }, state) };
}

// A face-down card shows only its back while the game is on
function cardOrBack(card, state) {
	const { down, ...unmarked } = card;
	return down && !state.result ? { down } : unmarked;
}

/**
 * @description The statuses as player may see them while the game is on: Tremor's Frozen (veiled) never reaches its
 * pawn's owner, and the caster (by) shows only to the piece's owner and the caster
 */
function hideStatuses(view, state, player) {
	for (const [id, list] of Object.entries(view.statuses || {})) {
		const piece = state.board.sq.find((square) => square && square.id === id);
		const ownsPiece = piece && piece.c === player;
		const shown = list.filter((status) => !(status.veiled && ownsPiece));
		for (const status of shown) {
			if (status.by !== player && !ownsPiece) delete status.by;
		}
		if (shown.length) view.statuses[id] = shown;
		else delete view.statuses[id];
	}
}

/**
 * @description Under the opponent's Fog of War its pieces on its half are not in the view at all: their squares null,
 * board.hidden how many, and every field holding one of their ids removed (statuses, enchantment pieces and data, card
 * fields, choice options). Its captured list is all "?", its castling rights and en passant square are removed, and the
 * history is [] and half 0: their castling and en passant tokens and the reset counter name fogged pieces (the state
 * keeps both)
 */
function hideFoggedPieces(view, state, opp) {
	const shownBoard = view.board;
	const castlingLetters = opp === "w" ? /[PNBRQK]/g : /[pnbrqk]/g;
	const ids = hiddenIds(state, opp);
	for (const [index, piece] of shownBoard.sq.entries()) {
		if (piece && ids.includes(piece.id)) shownBoard.sq[index] = null;
	}
	// How many, never which or where (fromView places that many)
	shownBoard.hidden = ids.length;
	scrub(view, ids);
	view.players[opp].captured = view.players[opp].captured.map(() => "?");
	shownBoard.history = [];
	shownBoard.half = 0;
	shownBoard.castling = shownBoard.castling.replace(castlingLetters, "") || "-";
	// An en passant square names the piece a pawn
	if (shownBoard.ep && shownBoard.ep[1] === (opp === "w" ? "3" : "6")) shownBoard.ep = null;
}

/* ---------------------------------------------------------------- */
// The events
/* ---------------------------------------------------------------- */

/**
 * @description The events of one action as player may see them, given state = the state after the action (the inputs
 * are not changed).
 * - When that action ended the game (state.result): all of them, as they are.
 * - Under a Fog of War no event names a piece hidden after the action or a fogged piece taken in it: the id is removed
 *   wherever it stands (piece, by, any card field). A hidden piece's move is { type, player } alone and any other event
 *   about it is left out. A ranged shot's capture is about the piece shot: its from, the hidden shooter's square, stays.
 * - Squares and types the fog hides: hideFoggedSquares.
 * - The opponent's own events: opponentEventAsSeen.
 * - Player's own Mirage reads as a move card. Its curse-given is left out: it shows only once it has taken over a held
 *   move card at a refill (that card's id and type), except in its curse-cleared and curse-fired (it is gone then). The
 *   other player sees it as it is.
 * - A veiled status event (Tremor's Frozen, given or ended) is left out for its piece's owner, and a status event's
 *   player (the caster) is removed for a player who is neither the piece's owner nor the caster.
 */
function playerEvents(state, events, player) {
	// The action that ended the game is told in full
	if (state.result) return copy(events);
	const opp = other(player);
	const fog = fogged(state, opp, player);
	// Taken in this action: off the board, still not named
	const captures = fog ? events.filter((event) => event.type === "capture" && colorOf(state, events, event) === opp) : [];
	const taken = captures.map((capture) => capture.piece);
	const hidden = fog ? hiddenIds(state, opp) : [];
	// Kept after resight drops a gone card's fake
	const ownSights = state.enchant.filter((enchant) => enchant.owner === player && enchant.data && enchant.data.fake && isSight(enchant));
	const fakes = ownSights.flatMap((sight) => sight.data.fake);
	const telling = { state, events, player, opp, fog, hidden, fakes };
	const unnamed = hidden.concat(taken);
	return copy(events).map((event, index) => scrub(eventAsSeen(telling, event, index), unnamed)).filter(Boolean);
}

/**
 * @description One event (a copy, changed in place) as telling.player may see it, null when it is not told at all.
 * index is its place in telling.events
 */
function eventAsSeen(telling, event, index) {
	const { state, events, player, opp, fog, hidden } = telling;
	const card = event.card && typeof event.card === "object" ? event.card : null;
	// As in the view: this bookkeeping names a fogged pawn
	if (card) {
		delete card.denied;
		delete card.stopping;
	}
	if (card && baseKey(card.key) === "mirage") {
		// A curse-given names the giver, any other event the holder
		const holder = event.type === "curse-given" ? other(event.player) : event.player;
		if (holder === player) {
			if (event.type === "curse-given") return null;
			if (event.type !== "curse-cleared" && event.type !== "curse-fired") event.card = disguise(card);
		}
	}
	// Tremor's Frozen (given or ended): never told its pawn's owner, nor anyone while the pawn is fogged
	if (event.veiled) {
		if (colorOf(state, events, event) === player) return null;
		const square = state.board.sq.findIndex((piece) => piece && piece.id === event.piece);
		if (fog && square >= 0 && state.board.sq[square].c === opp && onHalf(square, opp)) return null;
		delete event.veiled;
	}
	// A status event's player is its caster (statuses.give): told only to the piece's owner and the caster
	if (event.type === "status" && event.player !== player && colorOf(state, events, event) !== player) delete event.player;
	// A piece hidden now: its move is told bare, anything else about it not at all
	if (hidden.includes(event.piece)) {
		if (event.type !== "move") return null;
		return { type: "move", player: event.player };
	}
	if (fog) hideFoggedSquares(telling, event, index);
	if (event.player !== opp) return event;
	return opponentEventAsSeen(telling, event, card);
}

/**
 * @description Under the opponent's Fog of War: a piece that came out of the fog loses its from (its colour read as it
 * was at that event: a piece handed over later in the action is still the giver's); a handover to player of a piece
 * that stood hidden before the action loses its from; a fogged piece removed by its own side from the fogged half loses
 * its sq; and the fogged side's captures and promotions are masked, on the open half too (deliberately more than the
 * view hides, never less)
 */
function hideFoggedSquares(telling, event, index) {
	const { state, events, player, opp } = telling;
	// It came out of the fog, or was handed over out of it: where it stood stays hidden
	if (event.type === "move" && colorAt(state, events, event, index) === opp && onHalf(board.sqIndex(event.from), opp)) {
		delete event.from;
	}
	// A fogged piece handed to player: its square before the action stays hidden
	if (event.type === "handover" && event.player === player && onHalf(board.sqIndex(startSquare(events, event, index)), opp)) {
		delete event.from;
	}
	// A fogged piece removed by its own side (a forfeit: All or Nothing's lost hand): its square stays hidden
	if (event.type === "capture" && event.player === opp && event.c === opp && event.sq && onHalf(board.sqIndex(event.sq), opp)) {
		delete event.sq;
	}
	if ((event.type === "capture" || event.type === "promote") && colorOf(state, events, event) === opp) event.t = "?";
}

/**
 * @description An event of the opponent's as player may see it. A draw or discard of a card player can't see becomes
 * { type, player }, except one under a fake of player's (a sight's data.fake: Interdicted Foresight), which carries that
 * fake as real sight would carry the card. Their Trapdoor placement loses its square, and under their fog their moves
 * lose the spent card and the castle flag
 */
function opponentEventAsSeen(telling, event, card) {
	const { state, player, opp, fog, fakes } = telling;
	if ((event.type === "draw" || event.type === "discard") && card && !shownTo(state, player, card)) {
		const fake = fakes.find((candidate) => candidate.id === card.id);
		return fake ? { ...event, card: { ...fake } } : { type: event.type, player: opp };
	}
	if (card && baseKey(card.key) === "trapdoor") {
		delete event.square;
		delete event.target;
	}
	if (fog && event.type === "move") {
		delete event.card;
		delete event.castle;
		delete event.through;
	}
	return event;
}

/**
 * @description An event's piece's colour: the event's own c, else from the board after the action, else from this
 * action's capture of it. Never from the id: a piece handed over keeps its id
 */
function colorOf(state, events, event) {
	const piece = state.board.sq.find((square) => square && square.id === event.piece);
	const capture = events.find((candidate) => candidate.type === "capture" && candidate.piece === event.piece && candidate.c);
	return event.c || (piece ? piece.c : capture && capture.c);
}

/**
 * @description The colour of an event's piece when the event at index happened, not after the action: a piece handed
 * over at or after it is still the giver's until then
 */
function colorAt(state, events, event, index) {
	const handover = events.find((later, at) => at >= index && later.type === "handover" && later.piece === event.piece);
	return handover ? other(handover.player) : colorOf(state, events, event);
}

// Where an event's piece stood before the action: the from of its first move in it, else the event's own
function startSquare(events, event, index) {
	const firstMove = events.find((earlier, at) => at < index && earlier.type === "move" && earlier.piece === event.piece);
	return (firstMove || event).from;
}

/* ---------------------------------------------------------------- */
// The told list
/* ---------------------------------------------------------------- */

/**
 * @description The legal actions player is told. All of them, but under the opponent's Fog of War none that would show
 * where a hidden piece stands: no move, no action with a move in it (Last Stand) and none naming a hidden piece's id (a
 * square under a SQUARE_KEYS field never counts as one: Trapdoor's b1..b8). Trapdoor, Swap and All or Nothing (any
 * version) are told as they would be legal with the hidden pieces off the board, so the list never depends on where they
 * stand, and applyAction refuses the ones the hidden pieces rule out. Every drop of player's own placed cards is told,
 * also one that would put a king in check, which applyAction refuses (as a blind move).
 * None is told that is legal only because of a veiled status (Tremor's Frozen) on player's own piece, which playerView
 * leaves out for them: Cleanse's { piece, s } on it, the rare Cleanse with nothing else to clear. What the status takes
 * away (the pawn's moves, its Swap target) stays away: the accepted tell. Unless that would leave player no told action
 * at all: then they are told. The rules don't change: applyAction still takes any legal action
 */
function playerLegal(state, player) {
	const fog = fogged(state, other(player), player);
	const ids = fog ? hiddenIds(state, other(player)) : [];
	const told = tellable(state, player, fog, ids);
	const blindCards = fog ? state.players[player].actives.filter((card) => BLIND_CARDS.includes(baseKey(card.key))) : [];
	const blind = blindCards.map((card) => card.id);
	if (!blind.length) return told;
	// The board as player sees it: the hidden pieces gone
	const open = copy(state);
	open.board.sq = open.board.sq.map((piece) => (piece && ids.includes(piece.id) ? null : piece));
	// Only these cards' trials run twice (Card Guy's time)
	const own = open.players[player];
	own.moves = [];
	own.actives = own.actives.filter((card) => blind.includes(card.id));
	const kept = told.filter((action) => !isBlindPlay(action, blind));
	const out = kept.concat(tellable(open, player, fog, ids).filter((action) => isBlindPlay(action, blind)));
	return out.length ? out : told;
}

function isBlindPlay(action, blind) {
	return action.type === "active" && blind.includes(action.card);
}

/**
 * @description playerLegal's list for one state (the real one, or the one with the hidden pieces off the board): the
 * legal actions less, under the fog (fog true, ids the hidden pieces), the moves and those naming a hidden id, less the
 * ones only a veiled status makes legal
 */
function tellable(state, player, fog, ids) {
	// Lazy: turn.js loads the cards, which load this file's neighbours
	const turn = require("./turn.js");
	// Under the fog this holds every drop of the player's own placed cards: leaving out the one that gives check would
	// tell where a hidden king stands
	const all = turn.legalActions(state, player, fog);
	const told = fog ? all.filter((action) => !showsHiddenPiece(action, ids)) : all;
	const veiled = veiledOwnPieces(state, player);
	if (!veiled.length) return told;
	// The state as player's view has it: an action not legal there names or needs the veiled status
	const open = copy(state);
	for (const id of veiled) {
		open.statuses[id] = open.statuses[id].filter((status) => !status.veiled);
		if (!open.statuses[id].length) delete open.statuses[id];
	}
	const keys = new Set(turn.legalActions(open, player, fog).map(turn.actionKey));
	const kept = told.filter((action) => keys.has(turn.actionKey(action)));
	// Hiding them would leave no legal action at all and hang the game, so the rare dead end tells them
	return kept.length ? kept : told;
}

/**
 * @description True when an action would show where a hidden piece stands: it holds a move, or it names one of ids. A
 * square under a SQUARE_KEYS field never counts: a square b1..b8 is not a black piece's id
 */
function showsHiddenPiece(action, ids) {
	const json = JSON.stringify(action, (key, value) => (SQUARE_KEYS.includes(key) ? undefined : value));
	return json.includes('"move"') || ids.some((id) => json.includes('"' + id + '"'));
}

// The ids of player's own pieces that carry a veiled status
function veiledOwnPieces(state, player) {
	const veiled = [];
	for (const id of Object.keys(state.statuses || {})) {
		const isVeiled = state.statuses[id].some((status) => status.veiled);
		if (isVeiled && state.board.sq.some((piece) => piece && piece.id === id && piece.c === player)) veiled.push(id);
	}
	return veiled;
}

/* ---------------------------------------------------------------- */
// Card Guy's guess
/* ---------------------------------------------------------------- */

/**
 * @description A full state from a view, for Card Guy's search only: rng from seed (rng.seed: a 64-character hex
 * string or an integer), the fogged pieces (board.hidden of them) put on empty squares of their half under ids
 * "<colour>?<n>" and given types, and the opponent's unknown cards, all filled from it (deterministic for a view and
 * seed), seen null. The view is not changed. A hidden Trapdoor stays without its square
 */
function fromView(view, seed) {
	const state = copy(view);
	delete state.you;
	state.rng = rng.seed(seed);
	const ctx = makeCtx(state);
	// Filling in hidden cards is not play: no card fires on these draws
	ctx.trigger = () => {};
	// The fogged pieces, guessed onto empty squares of their half ("?" types, filled below)
	if (state.board.hidden) {
		const color = other(view.you);
		const free = state.board.sq.map((piece, index) => index).filter((index) => !state.board.sq[index] && onHalf(index, color));
		const guessed = ctx.rng.shuffle(free).slice(0, state.board.hidden);
		for (const [slot, index] of guessed.entries()) state.board.sq[index] = { id: color + "?" + slot, c: color, t: "?" };
	}
	delete state.board.hidden;
	for (const color of ["w", "b"]) fillPieces(ctx, color);
	for (const color of ["w", "b"]) {
		if (state.players[color].hand) fillHand(ctx, color);
		state.players[color].seen = null;
		// A view from before the field
		state.players[color].lostTurns = state.players[color].lostTurns || 0;
		// Lazy: index.js requires this file
		if (state.players[color].kingSkulls === undefined) state.players[color].kingSkulls = require("./index.js").KING_SKULLS;
	}
	// The duel's hidden cards and deck, dealt again from the seed
	if (state.duel) duel.fill(ctx, state.duel);
	return state;
}

/**
 * @description Give color's "?" pieces types from ctx.rng: a king (unless color's king is in sight, off its fogged half)
 * and the rest from a shuffled starting set (queens past it), no pawn on a back rank. Re-drawn, one try per "?" piece,
 * until the side not to move isn't in check; if no try works the last one stays (that position is illegal)
 */
function fillPieces(ctx, color) {
	const squares = ctx.state.board.sq;
	const unknown = [];
	for (const [index, piece] of squares.entries()) {
		if (piece && piece.c === color && piece.t === "?") unknown.push(index);
	}
	const kingInSight = squares.some((piece) => piece && piece.c === color && piece.t === "k");
	// Each try makes another "?" piece the king; with the king in sight none is (-1)
	const kingTries = kingInSight ? unknown.map(() => -1) : ctx.rng.shuffle([...unknown]);
	for (const kingSquare of kingTries) {
		const pool = ctx.rng.shuffle([..."qrrbbnnpppppppp"]);
		for (const index of unknown) {
			const pick = index < 8 || index >= 56 ? pool.findIndex((type) => type !== "p") : 0;
			if (index === kingSquare) squares[index].t = "k";
			else if (pick >= 0 && pool[pick]) squares[index].t = pool.splice(pick, 1)[0];
			else squares[index].t = "q";
		}
		if (!inCheck(ctx.state, other(ctx.state.board.turn))) return;
	}
}

/**
 * @description Rebuild color's hand from { count, shown }: the shown cards to their slots by kind, then the unknown rest
 * drawn from ctx.rng (move cards up to hand.HAND_MOVES, 5, an active if none is shown, then move cards)
 */
function fillHand(ctx, color) {
	const side = ctx.state.players[color];
	const { count, shown } = side.hand;
	delete side.hand;
	Object.assign(side, { moves: [], actives: [], passive: null, curses: [] });
	for (const card of shown) {
		const kind = card.key === "move" ? "move" : CARDS[card.key] && CARDS[card.key].kind;
		if (kind === "move") side.moves.push(card);
		else if (kind === "passive" && !side.passive) side.passive = card;
		else if (kind === "curse") side.curses.push(card);
		else side.actives.push(card);
	}
	let left = count - shown.length;
	// A shown Mirage counts as a move card
	while (left > 0 && hand.moveCards(side).length < hand.HAND_MOVES && hand.drawMove(ctx, color)) left--;
	if (left > 0 && !side.actives.length && hand.drawCard(ctx, color, "active")) left--;
	while (left > 0 && hand.moveCards(side).length < hand.MOVE_CAP && hand.drawMove(ctx, color)) left--;
}

/**
 * @description FEN of a state's or a view's board; a fogged view prints its hidden squares empty
 */
function toFen(stateOrView) {
	return board.toFen(stateOrView.board);
}

module.exports = { playerView, playerEvents, fromView, toFen, shownTo, playerLegal, fogged };
