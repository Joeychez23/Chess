/*
 *  select.js  --  chess frontend
 *	Chess Cards Select
 *	What the table lets the player pick, from the server's legal list (store.js cards.legal): the moves a lifted card
 *	allows, an active's targets, the move a piece picked directly spends a card on, the squares that glow while a play is
 *	picked and what a prompt's buttons say.
 *	It never decides what's legal: every play it offers is one of legal's. The one exception is Card Guy's Fog of War
 *	(legal_hidden: no moves listed), when a move card offers the engine's plain moves of its piece type on the board in
 *	sight (blindMoves) and the server refuses the ones that aren't legal.
 *	No DOM: the server tests require it (server/test/cards-clientSelect.test.js).
 *
 */

// Square index <-> "e4", the engine's own (index 0 is a8)
const { sqName, sqIndex } = require("../../../../../cards-engine/board.js");
const { pseudoMoves } = require("../../../../../cards-engine/movegen.js");

// A piece type's name, and a move card type's (m: the Knight / Bishop card)
const PIECE_NAMES = { p: "Pawn", n: "Knight", b: "Bishop", m: "Knight / Bishop", r: "Rook", q: "Queen", k: "King" };
// The free discard's floor. A copy of the engine's hand.js PIECE_VALUE: importing hand.js would bring the whole card registry
// into the bundle. cards-clientSelect.test.js keeps the two the same.
const PIECE_VALUE = { p: 1, n: 3, b: 3, m: 3, r: 5, q: 9 };
// The piece types each move card type moves. A copy of the engine's hand.js CARD_MOVES too, kept the same by the same test.
const CARD_MOVES = { p: "p", m: "nb", r: "r", q: "q" };
// The eight lines a queen moves along, as [rank step, file step]
const QUEEN_LINES = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

function capital(text) {
	return String(text).charAt(0).toUpperCase() + String(text).slice(1);
}

// The card or one of its versions (the engine keys a version base-rarity)
function isCard(key, base) {
	return key === base || String(key).startsWith(base + "-");
}

/* ---------------------------------------------------------------- */
// Cards
/* ---------------------------------------------------------------- */
/**
 * @description The legal moves that spend this card
 * @param  {[array]} legal [cards.legal]
 * @param  {[string]} cardId [a move card's id, or "king"]
 * @return {[array]} actions
 */
function movesForCard(legal, cardId) {
	return legal.filter((action) => action.type === "move" && action.card === cardId);
}

/**
 * @description The legal plays of an active, one per target (one with no target when it needs none)
 * @param  {[array]} legal [cards.legal]
 * @param  {[string]} cardId [the active's id]
 * @return {[array]} actions
 */
function targetsForActive(legal, cardId) {
	return legal.filter((action) => action.type === "active" && action.card === cardId);
}

/**
 * @description A piece picked with no card lifted: one legal move per destination (each promotion its own). The card it
 * spends is the first one legal names for it, so duplicate cards are interchangeable. A move that needs no card
 * (Heretical Subjection, Escape Artist, Retaliation) is taken first: it spends none.
 * @param  {[array]} legal [cards.legal]
 * @param  {[string]} fromSquare ["e2"]
 * @return {[array]} actions
 */
function shortcutFor(legal, fromSquare) {
	const moves = legal.filter((action) => action.type === "move" && action.from === fromSquare);
	const cardless = moves.filter((move) => move.card === null);
	const withCard = moves.filter((move) => move.card !== null);
	const shortcuts = [];
	for (const move of [...cardless, ...withCard]) {
		const isListed = shortcuts.some((kept) => kept.to === move.to && kept.promotion === move.promotion);
		if (!isListed) { shortcuts.push(move); }
	}
	return shortcuts;
}

/**
 * @description Whether the passive can go into Board Effects now
 * @param  {[array]} legal [cards.legal]
 * @return {[boolean]}
 */
function canPlace(legal) {
	return legal.some((action) => action.type === "passive");
}

/**
 * @description The player's hand in the order the table lays it out: the King card (while they hold it), the move cards,
 * the actives, the passive, the curses. Each card as the view has it, plus its kind ("king", "move", "active", "passive"
 * or "curse"). Fields it doesn't know (denied, stopping) are kept and never read.
 * @param  {[object]} view [cards.view]
 * @return {[array]} cards
 */
function handCards(view) {
	const player = view.players[view.you] || {};
	return [
		...(player.king ? [{ id: "king", key: "king", kind: "king" }] : []),
		...(player.moves || []).map((card) => ({ ...card, kind: "move" })),
		...(player.actives || []).map((card) => ({ ...card, kind: "active" })),
		...(player.passive ? [{ ...player.passive, kind: "passive" }] : []),
		...(player.curses || []).map((card) => ({ ...card, kind: "curse" })),
	];
}

/**
 * @description What a lifted card can do: its moves, its targets, placing the passive (then its reroll), paying a curse
 * off (a clear action), and the free discards it's in when legal lists them (buttons on its prompt)
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} view [cards.view]
 * @param  {[string]} cardId
 * @return {[array]} actions
 */
function actionsFor(legal, view, cardId) {
	const card = handCards(view).find((handCard) => handCard.id === cardId);
	if (!card) { return []; }
	// The passive: placing it, then its reroll
	if (card.kind === "passive") {
		return [...legal.filter((action) => action.type === "passive"), ...discardsFor(legal, view, cardId)];
	}
	return [...legal.filter((action) => action.card === cardId), ...discardsFor(legal, view, cardId)];
}

/**
 * @description The free discard of a hand card, one card at a time (a move card, an active, or the held passive: its
 * reroll): its own, when legal lists it. A button for the keys and a tap; the mouse drags the card to the discard pile
 * (dropPlay).
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} view [cards.view]
 * @param  {[string]} cardId
 * @return {[array]} actions
 */
function discardsFor(legal, view, cardId) {
	return legal.filter((action) => action.type === "discard" && action.cards.includes(cardId));
}

/**
 * @description The hand cards drawn dimmer: those with no play this turn but a discard (a dimmed card still lifts for its
 * discard). None under Card Guy's Fog of War (legal lists no move), and none when the player has no turn to play (Card
 * Guy's turn, a choice, a duel, the game over): the whole hand would dim and light again every turn.
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} view [cards.view]
 * @param  {[boolean]} hidden [cards.hidden]
 * @return {[array]} ids
 */
function dimmed(legal, view, hidden) {
	if (hidden || !legal.some((action) => action.type !== "choice" && action.type !== "duel")) { return []; }
	const ids = [];
	for (const card of handCards(view)) {
		const plays = actionsFor(legal, view, card.id);
		if (!plays.some((action) => action.type !== "discard")) { ids.push(card.id); }
	}
	return ids;
}

/**
 * @description Whether a King-card move spends a King skull, as the engine decides it (turn.js kingMoves): the king moves
 * past its own Frozen or Hexed (every move), or its Shaken (a capture). legal doesn't say (the action has no skull field,
 * the server works it out), so the view's statuses do. Under fog a capture of a hidden piece can't be seen: it reads as
 * free.
 * @param  {[object]} action
 * @param  {[object]} view [cards.view]
 * @return {[boolean]}
 */
function costsSkull(action, view) {
	if (action.type !== "move" || action.card !== "king") { return false; }
	const player = view.players[view.you] || {};
	const squares = view.board.sq;
	const king = squares.find((piece) => piece && piece.c === view.you && piece.t === "k");
	if (!king || !(player.kingSkulls > 0)) { return false; }
	const statuses = ((view.statuses || {})[king.id] || []).map((status) => status.s);
	const target = squares[sqIndex(action.to)];
	const isCapture = Boolean(target && target.c !== view.you);
	return statuses.includes("frozen") || statuses.includes("hexed") || (statuses.includes("shaken") && isCapture);
}

/* ---------------------------------------------------------------- */
// Fog of War
/* ---------------------------------------------------------------- */
/**
 * @description Under Card Guy's Fog of War legal lists no move: the plain chess moves of this card's piece type on the
 * board the player can see, as the engine makes them (movegen.js pseudoMoves, no card hooks), the same previews as a
 * normal game. A hidden piece blocks nothing here and its square glows as an empty one: to the server a move onto it is
 * the capture. A pawn's two forward diagonals always glow too, so it can try one: never onto the player's own piece, and
 * each promotion onto the last rank. The king's safety isn't checked, and a card that changes how a piece moves isn't
 * counted. The server takes the legal ones and refuses the rest (409).
 * @param  {[object]} view [cards.view]
 * @param  {[object]} card [a hand card: a move card { id, piece } or the King card { id: "king" }]
 * @param  {[string]} from [only this square's piece, left out = all of them]
 * @return {[array]} actions
 */
function blindMoves(view, card, from) {
	const type = card.id === "king" ? "k" : card.piece;
	// A move card's piece types (the Knight / Bishop card: both). The King card and a no-card move name the piece's own.
	const movedTypes = CARD_MOVES[type] || type;
	const plain = pseudoMoves({ board: view.board }, view.you);
	const moves = plain.filter((move) => movedTypes.includes(move.t) && (!from || move.from === from));
	if (type === "p") {
		moves.push(...blindPawnDiagonals(view, from, moves));
	}
	// A castle is its king's from and to, as in legal
	return moves.map((move) => ({
		type: "move",
		card: card.id,
		from: move.from,
		to: move.to,
		...(move.promotion && { promotion: move.promotion }),
	}));
}

// The pawn diagonals the engine left out: the ones that look empty. A piece in sight there is the engine's capture or the
// player's own, and en passant is the engine's too.
function blindPawnDiagonals(view, from, moves) {
	const squares = view.board.sq;
	const me = view.you;
	const rankStep = me === "w" ? -1 : 1;
	const lastRank = me === "w" ? 0 : 7;
	const diagonals = [];
	for (const [index, piece] of squares.entries()) {
		const rank = (index >> 3) + rankStep;
		const at = sqName(index);
		if (!piece || piece.c !== me || piece.t !== "p" || (from && at !== from) || rank < 0 || rank > 7) { continue; }
		for (const file of [(index & 7) - 1, (index & 7) + 1]) {
			const to = sqName(rank * 8 + file);
			if (file < 0 || file > 7 || squares[rank * 8 + file] || moves.some((move) => move.from === at && move.to === to)) { continue; }
			const promotions = rank === lastRank ? ["q", "r", "b", "n"] : [null];
			for (const promotion of promotions) {
				diagonals.push({ from: at, to, promotion });
			}
		}
	}
	return diagonals;
}

/**
 * @description Last Stand under fog (legal leaves it out, its target is a move): the king's queen lines from its square,
 * each up to an own piece (not onto it) or the first other piece (onto it, unless it's a king). A hidden piece doesn't
 * stop a line: the server refuses what goes through one.
 * @param  {[object]} view [cards.view]
 * @param  {[object]} card [the Last Stand in hand]
 * @return {[array]} actions
 */
function blindLastStand(view, card) {
	const squares = view.board.sq;
	const king = squares.findIndex((piece) => piece && piece.c === view.you && piece.t === "k");
	const plays = [];
	if (king < 0) { return plays; }
	for (const [rankStep, fileStep] of QUEEN_LINES) {
		let rank = (king >> 3) + rankStep;
		let file = (king & 7) + fileStep;
		while (rank >= 0 && rank < 8 && file >= 0 && file < 8) {
			const piece = squares[rank * 8 + file];
			if (piece && (piece.c === view.you || piece.t === "k")) { break; }
			plays.push({ type: "active", card: card.id, target: { move: { from: sqName(king), to: sqName(rank * 8 + file) } } });
			if (piece) { break; }
			rank += rankStep;
			file += fileStep;
		}
	}
	return plays;
}

/**
 * @description Under fog, whether one of the player's cards lets this piece move without a card: their Heretical
 * Subjection on it, their placed Escape Artist (in check; the fog can hide the checker, so always), or their placed
 * Retaliation while it's open (only onto its target's square when the target is in sight). legal can't say: no move is
 * listed.
 * @param  {[object]} view [cards.view]
 * @param  {[object]} piece [the player's piece { id, c, t }]
 * @return {[boolean|string|null]} reach [true: any square, a square: only that one, null: no move without a card]
 */
function cardlessUnderFog(view, piece) {
	const placed = placedPassives(view);
	if (isHereticalSubject(view, piece) || placed.some((card) => isCard(card.key, "escape-artist"))) { return true; }
	const open = placed.find((card) => isCard(card.key, "retaliation") && card.open);
	if (!open) { return null; }
	const at = view.board.sq.findIndex((other) => other && other.id === open.target);
	return at < 0 ? true : sqName(at);
}

// Whether the player's own Heretical Subjection lies on this piece
function isHereticalSubject(view, piece) {
	const enchantments = view.enchant || [];
	return enchantments.some((enchant) => enchant
		&& enchant.owner === view.you
		&& isCard(enchant.key, "heretical-subjection")
		&& (enchant.pieces || []).includes(piece.id));
}

// The player's own passives waiting in Board Effects
function placedPassives(view) {
	return (view.effects || []).filter((effect) => effect && effect.owner === view.you && effect.card).map((effect) => effect.card);
}

/* ---------------------------------------------------------------- */
// Picking
/* ---------------------------------------------------------------- */
// A pick in progress is { card, actions, picks }: the lifted card (null: a piece picked directly, or a choice), the plays
// still in reach and the squares picked so far.

/**
 * @description Lifts a card: the plays it can make. With no card (null) every legal action is in reach, for a choice.
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} view [cards.view]
 * @param  {[string|null]} cardId
 * @param  {[boolean]} hidden [cards.hidden: no move listed, a move card offers blindMoves]
 * @return {[object]} pick [{ card, actions, picks: [] }]
 */
function lift(legal, view, cardId, hidden = false) {
	if (cardId === null) { return { card: null, actions: legal.slice(), picks: [] }; }
	// A card duel is on: a hand card plays nothing, under fog too
	if (view.duel) { return { card: cardId, actions: [], picks: [] }; }
	const card = handCards(view).find((handCard) => handCard.id === cardId);
	// The free discards stay listed under fog
	const discards = discardsFor(legal, view, cardId);
	if (hidden && card && (card.kind === "king" || card.kind === "move")) {
		return { card: cardId, actions: [...blindMoves(view, card), ...discards], picks: [] };
	}
	if (hidden && card && isCard(card.key, "last-stand")) {
		return { card: cardId, actions: [...blindLastStand(view, card), ...discards], picks: [] };
	}
	return { card: cardId, actions: actionsFor(legal, view, cardId), picks: [] };
}

/**
 * @description A piece picked with nothing lifted: shortcutFor's moves from its square, or under fog blindPieceMoves
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} view [cards.view]
 * @param  {[string]} square ["e2"]
 * @param  {[boolean]} hidden [cards.hidden]
 * @return {[object|null]} pick [null when it can't move]
 */
function pickPiece(legal, view, square, hidden = false) {
	// A card duel is on: no piece is picked up, under fog too
	if (view.duel) { return null; }
	const actions = hidden ? blindPieceMoves(view, square) : shortcutFor(legal, square);
	return actions.length ? { card: null, actions, picks: [square] } : null;
}

// Under fog, the moves of the player's piece on this square: first the moves without a card where cardlessUnderFog
// allows them, then the blind moves of the first card of its type (the King card for the king). A square can be in
// both forms: the prompt chooses.
function blindPieceMoves(view, square) {
	const piece = view.board.sq.find((other, index) => other && sqName(index) === square);
	if (!piece || piece.c !== view.you) { return []; }
	const card = handCards(view).find((handCard) => movesPiece(handCard, piece));
	const reach = cardlessUnderFog(view, piece);
	const plain = reach ? blindMoves(view, { id: null, piece: piece.t }, square) : [];
	const steps = isHereticalSubject(view, piece) ? hereticSteps(view, piece, square) : [];
	const extraSteps = steps.filter((step) => !plain.some((move) => move.to === step.to));
	const cardless = [...plain, ...extraSteps].filter((move) => reach === true || move.to === reach);
	const withCard = card ? blindMoves(view, card, square) : [];
	return [...cardless, ...withCard];
}

// Whether this hand card moves this piece: the King card the king, a move card the piece types it names
function movesPiece(card, piece) {
	if (piece.t === "k") { return card.kind === "king"; }
	return card.kind === "move" && (CARD_MOVES[card.piece] || "").includes(piece.t);
}

// Heretical Subjection's piece also steps like a king, the one move the card adds that the engine's plain moves lack
function hereticSteps(view, piece, square) {
	const asKing = view.board.sq.map((other) => (other === piece ? { ...other, t: "k" } : other));
	const board = { ...view.board, castling: "", sq: asKing };
	return blindMoves({ ...view, board }, { id: null, piece: "k" }, square);
}

/**
 * @description The squares the player clicks to make a play, in order: a move's from and to; an active target's piece,
 * square, pieces or king move; a choice's piece. A play with none (no target, a curse to clear, a card to choose) is made
 * from a prompt's button.
 * @param  {[object]} action
 * @param  {[object]} board [cards.view.board]
 * @return {[array]} squares
 */
function squaresOf(action, board) {
	if (action.type === "move") { return [action.from, action.to]; }
	if (action.type === "choice") {
		const square = typeof action.option === "string" ? squareOf(board, action.option) : null;
		return square ? [square] : [];
	}
	const target = action.type === "active" ? action.target : null;
	if (!target) { return []; }
	if (target.move) { return [target.move.from, target.move.to]; }
	if (Array.isArray(target.pieces)) { return target.pieces.map((id) => squareOf(board, id)).filter(Boolean); }
	if (target.square) { return [target.square]; }
	if (target.piece) {
		const square = squareOf(board, target.piece);
		return square ? [square] : [];
	}
	return [];
}

// The square of the piece with this id, null when it isn't on the board (taken, or hidden by fog)
function squareOf(board, id) {
	const index = board.sq.findIndex((piece) => piece && piece.id === id);
	return index < 0 ? null : sqName(index);
}

/**
 * @description Where a pick stands: the squares that glow (the next square of every play still in reach) and the plays
 * whose squares are all picked. One ready play is sent; several are chosen on a prompt; with no square picked, a button
 * plays it, or a second click on the card for an active with no target.
 * @param  {[object]} pick [lift, pickPiece or pick's]
 * @param  {[object]} board [cards.view.board]
 * @return {[object]} { glow: squares, sorted, ready: actions }
 */
function options(pick, board) {
	const open = pick.actions.filter((action) => fits(action, pick.picks, board));
	const ready = open.filter((action) => squaresOf(action, board).length === pick.picks.length);
	const waiting = open.filter((action) => !ready.includes(action));
	const glow = [...new Set(waiting.flatMap((action) => nextSquares(action, pick.picks, board)))].sort();
	return { glow, ready };
}

// Whether the squares picked so far lead to this play
function fits(action, picks, board) {
	const squares = squaresOf(action, board);
	if (picks.length > squares.length) { return false; }
	if (isUnordered(action)) {
		// A Swap's piece picked twice is no swap
		return new Set(picks).size === picks.length && picks.every((square) => squares.includes(square));
	}
	return picks.every((square, index) => squares[index] === square);
}

// Swap: its two pieces are picked in either order
function isUnordered(action) {
	return action.type === "active" && Boolean(action.target) && Array.isArray(action.target.pieces);
}

// The squares that carry a play on: a Swap's pieces not picked yet, else the next square in order
function nextSquares(action, picks, board) {
	const squares = squaresOf(action, board);
	return isUnordered(action) ? squares.filter((square) => !picks.includes(square)) : [squares[picks.length]];
}

/**
 * @description Picks one more square
 * @param  {[object]} selection [the pick so far]
 * @param  {[object]} board [cards.view.board]
 * @param  {[string]} square ["e4"]
 * @return {[object|null]} pick [null when no play goes through that square]
 */
function pick(selection, board, square) {
	const picks = [...selection.picks, square];
	return selection.actions.some((action) => fits(action, picks, board)) ? { ...selection, picks } : null;
}

/**
 * @description A left mouse press on a square (flow.js pressSquare, the drag's start): the pick a click on it would give
 * (flow.js clickSquare: one of the lifted card's pieces through that card, else the piece picked directly, a card of its
 * type spent), when the square holds one of the player's pieces and that pick has squares to be dragged to. null leaves
 * the press to the click: a piece with nothing to play, the next square of the play being picked (a Swap's second piece),
 * or a piece that is itself the play (an active's target).
 * @param  {[object|null]} selection [the play being picked, null for none]
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} view [cards.view]
 * @param  {[string]} square ["e2"]
 * @param  {[boolean]} hidden [cards.hidden]
 * @return {[object|null]} pick [the piece is held with it]
 */
function pressPick(selection, legal, view, square, hidden = false) {
	const board = view.board;
	const piece = board.sq[sqIndex(square)];
	if (!piece || piece.c !== view.you) { return null; }
	const through = selection ? pick(selection, board, square) : null;
	// The play being picked goes on through this square: that's the click's
	if (through && selection.picks.length) { return null; }
	// A lifted card part picked: this piece starts that card's pick again
	const isPartPicked = Boolean(selection && selection.card !== null && selection.picks.length);
	const restarted = isPartPicked ? pick({ ...selection, picks: [] }, board, square) : null;
	const next = through || restarted || pickPiece(legal, view, square, hidden);
	if (!next) { return null; }
	const { glow, ready } = options(next, board);
	return glow.length && !ready.length ? next : null;
}

/**
 * @description Whether the plays ready are one move's promotions (the same from and to): the 3D promotion cards choose
 * the piece, as in a normal game
 * @param  {[array]} ready [options().ready]
 * @return {[boolean]}
 */
function promotionPick(ready) {
	const [first] = ready;
	return ready.length > 1 && ready.every((action) => action.type === "move"
		&& Boolean(action.promotion)
		&& action.from === first.from
		&& action.to === first.to);
}

/**
 * @description What a card dragged with the mouse and let go over a place of the desk plays (flow.js dropCard).
 * - A hand card on the player's discard pile: its own free discard.
 * - An active on their active spot: played at once when it has one play with no target, else its targets are picked
 *   next (its plays without its discard).
 * - The held passive on their passive pile: placed.
 * - One of the player's placed cards (an opened pile's) on their discard pile: its drop.
 * Only what legal lists (under fog Last Stand's blind plays too, as lift); anything else puts the card back.
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} view [cards.view]
 * @param  {[object]} drag [{ from: "hand" | "pile", id }: the card dragged, from the hand or from an opened pile]
 * @param  {[object|null]} place [where it was let go (three/tableLayout.js placeAt):
 * { side: "mine" | "his", place: "spot" | "passive" | "discard" }, null for nowhere]
 * @param  {[boolean]} hidden [cards.hidden]
 * @return {[object|null]} play [{ action }: sent, { pick }: the play being picked from here on, null: the card goes back]
 */
function dropPlay(legal, view, drag, place, hidden = false) {
	if (!place || place.side !== "mine") { return null; }
	if (drag.from === "pile") {
		return asPlay(place.place === "discard" && legal.find((action) => action.type === "drop" && action.card === drag.id));
	}
	const card = handCards(view).find((handCard) => handCard.id === drag.id);
	if (!card) { return null; }
	if (place.place === "discard") {
		return asPlay(legal.find((action) => action.type === "discard" && action.cards.length === 1 && action.cards[0] === card.id));
	}
	if (place.place === "passive") {
		return asPlay(card.kind === "passive" && legal.find((action) => action.type === "passive"));
	}
	if (card.kind !== "active") { return null; }
	const targets = lift(legal, view, card.id, hidden).actions.filter((action) => action.type === "active");
	const selection = { card: card.id, actions: targets, picks: [] };
	if (!selection.actions.length) { return null; }
	const { glow, ready } = options(selection, view.board);
	return !glow.length && ready.length === 1 ? { action: ready[0] } : { pick: selection };
}

// A play found is sent; none puts the card back
function asPlay(action) {
	return action ? { action } : null;
}

/**
 * @description The drops the keys and a tap offer as buttons for the player's own opened pile (the mouse drags the card
 * to the discard pile, dropPlay): one per card of it whose drop legal lists. Never one of Card Guy's cards, whatever
 * legal says.
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} view [cards.view]
 * @param  {[string]} pile [the opened pile, a key of three/tableLayout.js PILES: only "mine" (the passives waiting) and
 * "mineSpot" (the actives in effect) hold the player's cards]
 * @param  {[string|null]} id [only this card's (a tap on it), null: every card's (Enter on the pile)]
 * @return {[array]} actions [{ type: "drop", card }]
 */
function pileDrops(legal, view, pile, id = null) {
	const drops = [];
	for (const card of ownPileCards(view, pile)) {
		if (card.down || card.id === undefined || (id !== null && card.id !== id)) { continue; }
		const drop = legal.find((action) => action.type === "drop" && action.card === card.id);
		if (drop) { drops.push(drop); }
	}
	return drops;
}

// The player's own cards in an opened pile
function ownPileCards(view, pile) {
	if (pile === "mine") { return placedPassives(view); }
	if (pile === "mineSpot") { return ((view.players[view.you] || {}).spot || []).filter(Boolean); }
	return [];
}

/**
 * @description The plays a prompt offers as buttons. The mouse plays by dragging, so its prompt has no discard and no
 * placing, and an active's plays only once the card was dropped on the active spot (placed: its targets with no square)
 * or squares are picked (two plays on the same squares). A curse's clear and a move's two forms stay. The keys and a tap
 * keep every button.
 * @param  {[array]} plays [the plays ready (options().ready)]
 * @param  {[object]} how [{ mouse: the pick is the mouse's, picks: the squares picked so far, placed: the card lies on
 * the active spot }]
 * @return {[array]} plays
 */
function promptPlays(plays, { mouse = false, picks = 0, placed = false } = {}) {
	if (!mouse) { return plays; }
	const isActiveShown = picks > 0 || placed;
	return plays.filter((action) => action.type !== "discard" && action.type !== "passive" && (action.type !== "active" || isActiveShown));
}

/**
 * @description The keyboard's stops, in order: the hand, then the player's pieces with a move that needs no card, then
 * the piles. While a card duel is on: only the duel cards legal lets the player pick.
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} view [cards.view]
 * @param  {[boolean]} hidden [cards.hidden]
 * @return {[array]} [{ kind: "hand", id } | { kind: "square", square } | { kind: "pile", pile } | { kind: "duel", index }]
 */
function focusList(legal, view, hidden) {
	if (view.duel) {
		const duelPicks = legal.filter((action) => action.type === "duel" && Number.isInteger(action.pick));
		return duelPicks.map((action) => ({ kind: "duel", index: action.pick }));
	}
	const hand = handCards(view).map((card) => ({ kind: "hand", id: card.id }));
	const squares = cardlessSquares(legal, view, hidden).sort().map((square) => ({ kind: "square", square }));
	const piles = focusPiles(view).map((pile) => ({ kind: "pile", pile }));
	return [...hand, ...squares, ...piles];
}

// The squares of the player's pieces with a move that needs no card: cardless in legal, or under fog those
// cardlessUnderFog covers
function cardlessSquares(legal, view, hidden) {
	if (!hidden) {
		const cardless = legal.filter((action) => action.type === "move" && action.card === null);
		return [...new Set(cardless.map((action) => action.from))];
	}
	const squares = [];
	for (const [index, piece] of view.board.sq.entries()) {
		if (piece && piece.c === view.you && cardlessUnderFog(view, piece)) { squares.push(sqName(index)); }
	}
	return squares;
}

// Each Board Effects pile that holds a card ("mine" first), then each active spot that holds one ("mineSpot",
// "hisSpot"; they open as the piles do), then the discard list once it holds one ("discard", opened from either
// discard pile)
function focusPiles(view) {
	const me = view.you;
	const opp = me === "w" ? "b" : "w";
	const piles = [];
	for (const [pile, owner] of [["mine", me], ["his", opp]]) {
		if ((view.effects || []).some((effect) => effect && effect.owner === owner && effect.card)) { piles.push(pile); }
	}
	for (const [pile, owner] of [["mineSpot", me], ["hisSpot", opp]]) {
		if (((view.players[owner] || {}).spot || []).length) { piles.push(pile); }
	}
	if ((view.piled || []).length) { piles.push("discard"); }
	return piles;
}

/* ---------------------------------------------------------------- */
// Words
/* ---------------------------------------------------------------- */
/**
 * @description What a prompt's button says for a play
 * @param  {[object]} action
 * @param  {[object]} view [cards.view]
 * @param  {[object]} catalog [cards.catalog]
 * @param  {[object]} taken [the last card-taken event's card, flow.js keeps it: names Pickpocket's stolen card, null
 * when it isn't at hand (a reload)]
 * @return {[string]} label
 */
function label(action, view, catalog, taken = null) {
	switch (action.type) {
		case "move": return moveLabel(action);
		case "passive": return "Place in Board Effects (uses your turn)";
		case "drop": return dropLabel(action, view, catalog);
		case "discard": return discardLabel(action, view, catalog);
		case "clear": return clearLabel(action, view, catalog);
		case "choice": return choiceLabel(action, view, catalog, taken);
		case "active": return activeLabel(action, view, catalog);
		// A duel's pick is never a button: its card is clicked on the table
		case "duel": return action.stop ? "Stop" : "Continue";
		default: return capital(action.type);
	}
}

// A move names its squares, or the piece a promotion makes
function moveLabel(action) {
	const move = action.promotion ? PIECE_NAMES[action.promotion] : `${action.from} to ${action.to}`;
	return move + (action.card === null ? " without a card" : "");
}

// One of the player's placed cards: a passive waiting or an active in effect
function dropLabel(action, view, catalog) {
	const placed = [...(view.effects || []).map((effect) => effect && effect.card), ...((view.players[view.you] || {}).spot || [])];
	const card = placed.find((placedCard) => placedCard && placedCard.id === action.card);
	return `Discard your ${(card && catalog[card.key] && catalog[card.key].name) || "card"} from the table`;
}

// A free discard says what comes back for it
function discardLabel(action, view, catalog) {
	const hand = handCards(view);
	const held = action.cards.map((id) => hand.find((card) => card.id === id) || {});
	if (held[0].kind === "passive") { return `Reroll your ${cardName(view, catalog, action.cards[0]) || "passive"} (new passive now)`; }
	// A move card: the first is remembered, and its pair draws
	let back = "new one at turn end";
	if (held[0].kind === "move") {
		back = view.players[view.you].kept ? drawBack(held, view) : "the next one discarded draws 1";
	}
	const names = action.cards.map((id) => cardName(view, catalog, id) || "card");
	return `Discard your ${names.join(" & ")} (${back})`;
}

/**
 * @description What the second move card of a free discard's pair draws back (the first is remembered,
 * view.players[you].kept): one random card, or none for a bare king. The player's own pieces are in view.board under
 * fog too.
 * A floor was tried and dropped (the draw-back is random again); its label is kept below for reference. It read: "draw 1"
 * with a pawn in the pair (anything), else the lower card's own type, "draw a Rook or better" (two queens: "draw a
 * Queen"; a floor of 3 "draw a Knight / Bishop or better"). When the player had no piece worth more than that floor
 * (nothing better to draw, or nothing worth it: it drops) it named the most valuable card type they could still draw:
 * "draw a Knight / Bishop" with a knight or a bishop left.
 * @param  {[array]} pair [the 2 move cards, as handCards has them]
 * @param  {[object]} view [cards.view]
 * @return {[string]} words
 */
function drawBack(pair, view) {
	const best = view.board.sq.some((piece) => piece && piece.c === view.you && piece.t !== "k");
	return best ? "draw 1" : "no card back"; // A bare king draws none
	// THE DRAW-BACK FLOOR'S LABEL, DROPPED BY THE USER 2026-11-22 AFTER A TRIAL: THE DRAW-BACK IS RANDOM AGAIN. KEPT FOR REFERENCE:
	// const low = pair.reduce((a, b) => (PIECE_VALUE[b.piece] < PIECE_VALUE[a.piece] ? b : a)).piece, floor = PIECE_VALUE[low];
	// const own = Object.keys(CARD_MOVES).filter((t) => view.board.sq.some((p) => p && p.c === view.you && CARD_MOVES[t].includes(p.t))), best = Math.max(0, ...own.map((t) => PIECE_VALUE[t])); // THE CARD TYPES THE PLAYER CAN DRAW
	// if (!best) { return "no card back"; } // A BARE KING DRAWS NONE
	// if (!(floor > 1)) { return "draw 1"; } // A PAWN (OR A CARD THE VIEW DOESN'T NAME): ANYTHING
	// if (floor >= best) { return `draw a ${own.filter((t) => PIECE_VALUE[t] === best).map((t) => PIECE_NAMES[t]).join(" or ")}`; }
	// return `draw a ${PIECE_NAMES[low]} or better`; // TWO QUEENS ARE floor >= best: "draw a Queen"
}

// A curse paid off: by skipping this move, or with the cards it costs
function clearLabel(action, view, catalog) {
	if (action.discard === undefined) { return "Pay: skip this move"; }
	const names = [].concat(action.discard).map((id) => cardName(view, catalog, id) || "card");
	return `Pay with your ${names.join(" & ")}`;
}

// A choice's option: a piece, a card, a piece type, or a slot the player can't see
function choiceLabel(action, view, catalog, taken) {
	const option = action.option;
	if (typeof option !== "string") { return String(option); }
	const pending = view.pending;
	// Pickpocket's take-back: the card is in Card Guy's hidden hand now, only the card-taken event named it
	if (pending && pending.stolen === option) {
		const name = takenName(option, catalog, taken);
		return name ? `Your ${name} card` : "The card taken from you";
	}
	// The duel's first win: Knight or Bishop
	if (pending && isCard(pending.card, "all-or-nothing") && PIECE_NAMES[option]) { return PIECE_NAMES[option]; }
	const named = pieceAt(view.board, option) || (catalog[option] && catalog[option].name) || cardName(view, catalog, option);
	if (named) { return named; }
	// "?n": a slot for something the fog or a hidden hand keeps from the player (Opposing Finality's are pieces)
	if (option[0] === "?") {
		return pending && isCard(pending.card, "opposing-finality") ? "A hidden piece" : "A hidden card";
	}
	return option;
}

// The name of the card Pickpocket took, as the card-taken event told it; nothing when that event isn't at hand
function takenName(option, catalog, taken) {
	if (!taken || taken.id !== option) { return null; }
	if (taken.key === "move") { return PIECE_NAMES[taken.piece]; }
	return catalog[taken.key] && catalog[taken.key].name;
}

// An active's target
function activeLabel(action, view, catalog) {
	const target = action.target;
	const board = view.board;
	if (!target) { return "Play it"; }
	if (target.curses === "all") { return "Clear all your curses"; }
	if (target.t) { return PIECE_NAMES[target.t] || target.t; }
	if (target.s) { return `Remove ${capital(target.s)} from the ${pieceAt(board, target.piece) || "piece"}`; }
	if (target.mark) { return `Mark the ${pieceAt(board, target.mark) || "piece"}`; }
	if (target.enchant) {
		const enchantment = (view.enchant || []).find((placed) => placed.id === target.enchant);
		const name = (enchantment && catalog[enchantment.key] && catalog[enchantment.key].name) || "it";
		return `End ${name} on the ${pieceAt(board, target.piece) || "piece"}`;
	}
	if (target.move) { return `King to ${target.move.to}`; }
	if (target.square) { return target.square; }
	if (Array.isArray(target.pieces)) { return target.pieces.map((id) => pieceAt(board, id) || "a piece").join(" & "); }
	if (target.piece) { return pieceAt(board, target.piece) || "That piece"; }
	return "Play it";
}

// The piece with this id and its square ("Knight on f3"), null when it isn't on the board
function pieceAt(board, id) {
	const index = board.sq.findIndex((piece) => piece && piece.id === id);
	return index < 0 ? null : `${PIECE_NAMES[board.sq[index].t] || "Piece"} on ${sqName(index)}`;
}

// A card's name, from the player's hand or the opponent's cards shown to them; null when neither holds it
function cardName(view, catalog, id) {
	const opp = view.you === "w" ? "b" : "w";
	const shown = (view.players[opp] && view.players[opp].hand && view.players[opp].hand.shown) || [];
	const card = [...handCards(view), ...shown].find((known) => known.id === id);
	if (!card) { return null; }
	if (card.key === "move") { return `${PIECE_NAMES[card.piece] || "Move"} card`; }
	if (card.id === "king") { return "King card"; }
	return (catalog[card.key] && catalog[card.key].name) || "card";
}

/**
 * @description The arrows step through a list (the hand, or the squares that glow) and stop at its ends. Nothing
 * focused yet: the first.
 * @param  {[number]} count [the list's length]
 * @param  {[number|null]} index [the focused one]
 * @param  {[string]} key [a KeyboardEvent.key]
 * @return {[number|null]} index [null for an empty list; index itself for other keys]
 */
function stepFocus(count, index, key) {
	if (!count) { return null; }
	const isBack = key === "ArrowUp" || key === "ArrowLeft";
	const isOn = key === "ArrowDown" || key === "ArrowRight";
	if (!isBack && !isOn) { return index; }
	if (index === null || index === undefined) { return 0; }
	return Math.min(count - 1, Math.max(0, index + (isOn ? 1 : -1)));
}

/**
 * @description What a Chess Cards game's key does (cards/flow.js handKey). While the game is on, the arrows and Enter
 * never reach the page's nav, on the turn or off it: off it the arrows still step the hand's focus and Enter does
 * nothing. A focused button keeps Enter (Tab put it there: the menu stays reachable); an arrow takes the focus off it
 * first, as handleCardKey does. While the promotion cards are out only Escape is the hand's. A held key (repeat) does
 * nothing more.
 * @param  {[object]} keyState [{ key: a KeyboardEvent.key, repeat, on: a game loaded and not over, yours: the player
 * may pick (flow.js yourMove), button: a button or link has the focus, promoting: the promotion cards are out, picked:
 * a pick the player can put down, pile: a pile is opened (Escape closes it, on the turn or off it, once any pick is
 * down), zoomed: the camera is zoomed in on a hand card (Escape ends it as it closes a pile) }]
 * @return {[string]} plan ["page": the page has it (its nav, the focused button, handleCardKey), "stop": nobody, "hand":
 * the hand uses it, "blur": the focus leaves the button, then "hand"]
 */
function keyPlan({ key, repeat = false, on, yours, button = false, promoting = false, picked = false, pile = false, zoomed = false }) {
	if (!on) { return "page"; }
	// Nothing to put down, no pile to close and no zoom to end: the menu's Escape
	if (key === "Escape") { return (yours && picked) || pile || zoomed ? "hand" : "page"; }
	if (repeat) { return "stop"; }
	if (key === "Enter" && button) { return "page"; }
	// handleCardKey has the arrows and Enter
	if (promoting) { return "page"; }
	if (key === "Enter" && !yours) { return "stop"; }
	return button ? "blur" : "hand";
}

/**
 * @description The prompt's button the keys focus: Cancel (after the plays) when the first play is a discard or a placed
 * card's drop, so Enter alone never discards a dimmed card or drops a card; else the first.
 * @param  {[array]} actions [the prompt's plays, its buttons in order; Cancel follows them]
 * @return {[number]} index [of the button]
 */
function promptFocus(actions) {
	return actions.length && (actions[0].type === "discard" || actions[0].type === "drop") ? actions.length : 0;
}

/**
 * @description A prompt's buttons in order, for the 2D prompt and the 3D plaques alike (flow.js showPrompt): one per play
 * (its label), or Play for a King move waiting on a King skull, and Cancel (not for a choice: it must be answered)
 * @param  {[object]} prompt [{ skull: the King move waiting (flow.js confirm) | null, pick: the prompt's plays, choosing:
 * a choice or the duel's Stop or Continue is asked }]
 * @param  {[object]} view [cards.view]
 * @param  {[object]} catalog [cards.catalog]
 * @param  {[object]} taken [as label's]
 * @return {[array]} [{ id: the plaque's, label, action: the play it sends (Play: the King move), null for Cancel }]
 */
function promptButtons({ skull = null, pick = [], choosing = false }, view, catalog, taken = null) {
	const buttons = skull
		? [{ label: "Play", action: skull }]
		: pick.map((action) => ({ label: label(action, view, catalog, taken), action }));
	if (skull || !choosing) { buttons.push({ label: "Cancel", action: null }); }
	// Not a hand card's id: a plaque is never grabbed as one
	return buttons.map((button, index) => ({ id: `b${index}`, ...button }));
}

/**
 * @description Whether the 3D view shows a prompt's buttons as brass plaques on the table, and by what:
 * - the card duel's Stop or Continue, and Knight or Bishop (the duel cards);
 * - a King move that costs a King skull (the king's square);
 * - a move's two forms under fog, with and without a card (the moving piece's square);
 * - a lifted card's free discards, a passive's place and reroll (the card).
 * Any other prompt keeps its 2D buttons.
 * @param  {[object]} prompt [{ skull, pick, choosing: as promptButtons', duel: a card duel is on, card: the lifted card's
 * id | null, hidden: cards.hidden (fog) }]
 * @return {[object|null]} at [{ duel: true } | { square } | { card } (tableLayout.js plaqueAnchor), null: the 2D buttons]
 */
function plaquePrompt({ skull = null, pick = [], choosing = false, duel = false, card = null, hidden = false }) {
	if (skull) { return { square: skull.from }; }
	if (choosing) { return duel ? { duel: true } : null; }
	// Only fog's two forms of one move (pickPiece): any other prompt of moves keeps its 2D box
	if (hidden && isTwoForms(pick)) {
		const [move] = pick;
		return { square: move.from };
	}
	if (card !== null && pick.length && pick.every((action) => action.type === "discard" || action.type === "passive")) { return { card }; }
	return null;
}

// One move offered twice, with and without a card
function isTwoForms(pick) {
	const [first] = pick;
	const isOneMove = pick.length > 1
		&& pick.every((action) => action.type === "move" && action.from === first.from && action.to === first.to && !action.promotion);
	return isOneMove && pick.some((action) => action.card === null) && pick.some((action) => action.card !== null);
}

/**
 * @description Whether the player is asked for an answer: every legal action is a choice's option, or a card duel's Stop
 * or Continue (step decide). The prompt's buttons are all of them, with no Cancel, and nothing else is picked meanwhile.
 * @param  {[array]} legal [cards.legal]
 * @return {[boolean]}
 */
function asking(legal) {
	return legal.length > 0 && legal.every((action) => action.type === "choice" || (action.type === "duel" && action.stop !== undefined));
}

/**
 * @description The key of the card a choice or the card duel's Stop or Continue is asked for (flow.js askingCard: the
 * prompt's title and border): while a duel is on, its own card (the version played), also for All or Nothing's Knight
 * or Bishop (the engine asks that with the base key); else the pending choice's card.
 * @param  {[object]} view [cards.view]
 * @return {[string|null]} key
 */
function askedBy(view) {
	const pending = view.pending;
	const duel = view.duel;
	if (duel && (!pending || pending.card === "all-or-nothing")) { return duel.card || null; }
	return (pending && pending.card) || null;
}

/**
 * @description Whether a click on a hand card zooms in on it to be read (an ability card: an active, the passive, a
 * curse) rather than lifting it to be played (a move card, the King card)
 * @param  {[string]} kind [handCards' kind]
 * @return {[boolean]}
 */
function zooms(kind) {
	return kind === "active" || kind === "passive" || kind === "curse";
}

/**
 * @description A hand card clicked, tapped or picked with the keys (flow.js clickCard). An ability card (zooms) clicked
 * or tapped is read, never lifted (no high lift, no readable copy), and the camera zooms in on it whoever's turn it is.
 * Not while an answer's steps play, a card duel is on or the promotion cards are out: the camera can't frame it then.
 * The keys' pick lifts as before.
 * @param  {[object]} click [{ kind: handCards' kind, keys: the keys picked it, showing: an answer's steps play (flow.js
 * showing), duel: a card duel is on, promoting: the promotion cards are out }]
 * @return {[object]} { read: it isn't lifted, zoom: the camera zooms in on it (three/pointer.js pickTable) }
 */
function handRead({ kind, keys, showing, duel, promoting }) {
	const read = zooms(kind) && !keys;
	return { read, zoom: read && !showing && !duel && !promoting };
}

/**
 * @description The hand card the table lifts (three/cardTable.js lift: the high lift and an ability card's readable
 * copy): the card being played, unless a click or tap picked it to be read (handRead); else the card the mouse let go on
 * one of the player's places while its targets are picked or its play is on its way (flow.js onPlace)
 * @param  {[object|null]} selection [the play being picked]
 * @param  {[string|null]} onPlace [flow.js onPlace]
 * @param  {[string|null]} read [the ability card a click or tap picked last, null for none]
 * @return {[string|null]} id
 */
function liftedCard(selection, onPlace, read) {
	const isRead = read && selection && selection.card === read;
	return selection && !isRead ? selection.card : onPlace;
}

module.exports = {
	asking,
	askedBy,
	movesForCard,
	targetsForActive,
	shortcutFor,
	canPlace,
	handCards,
	actionsFor,
	dimmed,
	costsSkull,
	blindMoves,
	lift,
	pickPiece,
	pressPick,
	squaresOf,
	options,
	pick,
	promotionPick,
	dropPlay,
	pileDrops,
	promptPlays,
	focusList,
	label,
	stepFocus,
	keyPlan,
	promptFocus,
	promptButtons,
	plaquePrompt,
	zooms,
	handRead,
	liftedCard,
	PIECE_NAMES,
	PIECE_VALUE,
	CARD_MOVES,
};
