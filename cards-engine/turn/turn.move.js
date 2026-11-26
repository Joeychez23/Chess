/*
 *  turn.move.js  --  chess cards engine
 *	The move actions: the move cards' moves, the King card's moves and the king on the board.
 *
 */

const { inCheck, legalMoves, hooksFor } = require("../rules.js");
const statuses = require("../statuses.js");
const hand = require("../hand.js");

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

module.exports = { moveActions, alreadyMoved, kingMoves, findKing };
