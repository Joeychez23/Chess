/*
 *  cards.fog.js  --  chess frontend
 *	Chess Cards Fog
 *	The hand as the table lays it out, and the plays select.js offers under Card Guy's Fog of War (legal_hidden: no moves
 *	listed): a move card's plain moves of its piece type on the board in sight, Last Stand's king lines, and the moves a piece
 *	makes without a card. The server refuses the ones that aren't legal.
 *
 */

// Square index <-> "e4", the engine's own (index 0 is a8)
const { sqName } = require("../../../../../cards-engine/board.js");
const { pseudoMoves } = require("../../../../../cards-engine/movegen.js");

// The free discard's floor. A copy of the engine's hand.js PIECE_VALUE: importing hand.js would bring the whole card registry
// into the bundle. cards-clientSelect.test.js keeps the two the same.
const PIECE_VALUE = { p: 1, n: 3, b: 3, m: 3, r: 5, q: 9 };
// The piece types each move card type moves. A copy of the engine's hand.js CARD_MOVES too, kept the same by the same test.
const CARD_MOVES = { p: "p", m: "nb", r: "r", q: "q" };
// The eight lines a queen moves along, as [rank step, file step]
const QUEEN_LINES = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

// The card or one of its versions (the engine keys a version base-rarity)
function isCard(key, base) {
	return key === base || String(key).startsWith(base + "-");
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

module.exports = {
	PIECE_VALUE,
	CARD_MOVES,
	isCard,
	handCards,
	blindMoves,
	blindLastStand,
	cardlessUnderFog,
	placedPassives,
	blindPieceMoves,
};
