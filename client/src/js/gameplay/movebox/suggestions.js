/*
 *  suggestions.js  --  chess frontend
 *	Move Box Suggestions (#378)
 *	The rules behind the box's list: when the player can move, which legal moves start with what was typed & where the arrow keys
 *	go. No page or game state in here, so the server tests can run it (server/test/moveSuggestions.test.js)
 *
 */

const PROMOTION_ORDER = "QRBN"; // chess.js LISTS THE KNIGHT FIRST, THE QUEEN IS THE ONE MOST PLAYERS WANT
const EXAMPLE_COUNT = 3; // HOW MANY MOVES THE EMPTY INPUT SHOWS

/**
 * @description Why the player can't move right now. The box refuses a typed move & lists nothing for the same reasons
 * @param  {[object]} game [the game's shared state]
 * @param  {[string]} turn [whose turn it is on the board that's drawn, "w" or "b"]
 * @return {[string]} reason [what the player reads, undefined when they can move]
 */
function moveBlockReason(game, turn) {
	if (game.gameOver) { return "The game is over"; }
	const sliding = game.currSlide && !game.currPromotion; // THE PICKER IS STILL THE PLAYER'S MOVE, A TYPED MOVE REPLACES IT
	if (sliding || game.opposingMove || game.boardReset || turn != game.playerColor) { return "Not your turn"; } // opposingMove IS ALSO ON DURING THE PLAYER'S OWN SLIDE
	return undefined;
}

/**
 * @description One move's place in the list: by its text, a promotion's pieces together with the queen first
 */
function compareSuggestions(a, b) {
	const [aMove, aPiece = ""] = a.split("=");
	const [bMove, bPiece = ""] = b.split("=");
	if (aMove != bMove) { return aMove < bMove ? -1 : 1; }
	return PROMOTION_ORDER.indexOf(aPiece[0]) - PROMOTION_ORDER.indexOf(bPiece[0]);
}

/**
 * @description The legal moves that start with what was typed. Capitals count like they do when chess.js reads the move, so
 * b lists the b pawn & B the bishops. It reads 0-0 as O-O, like chess.js
 * @param  {[object]} chess [a chess.js board loaded with the game's position]
 * @param  {[string]} text [what was typed]
 * @return {[array]} moves [the moves as chess.js writes them, like Nf3 or e8=Q. Empty when nothing was typed]
 */
function suggestMoves(chess, text) {
	const typed = text.trim().replace(/0/g, "O");
	if (!typed) { return []; }
	return chess.moves().filter(function (move) { return move.startsWith(typed); }).sort(compareSuggestions);
}

/**
 * @description The moves the empty input shows as examples: spread across the sorted legal moves so they aren't all one piece,
 * & the same ones until the position changes
 * @param  {[object]} chess [a chess.js board loaded with the game's position]
 * @return {[array]} moves [up to EXAMPLE_COUNT moves as chess.js writes them]
 */
function exampleMoves(chess) {
	const moves = chess.moves().sort(compareSuggestions);
	const count = Math.min(EXAMPLE_COUNT, moves.length);
	return Array.from({ length: count }, function (_, i) { return moves[Math.floor(i * moves.length / count)]; });
}

/**
 * @description Where an arrow key puts the highlight. It wraps around, from nothing highlighted Down goes to the first & Up to the last
 * @param  {[number]} current [the highlighted suggestion, -1 for none]
 * @param  {[number]} count [how many suggestions there are]
 * @param  {[number]} step [1 for Down, -1 for Up]
 * @return {[number]} index [the suggestion to highlight, -1 for none]
 */
function stepHighlight(current, count, step) {
	if (count == 0) { return -1; }
	if (current < 0) { return step > 0 ? 0 : count - 1; }
	return (current + step + count) % count;
}

/**
 * @description What a screen reader hears about the list
 * @param  {[number]} count [how many suggestions there are]
 * @return {[string]} message
 */
function countMessage(count) {
	if (count == 0) { return "No suggestions"; }
	return count == 1 ? "1 suggestion" : `${count} suggestions`;
}

module.exports = { moveBlockReason, suggestMoves, exampleMoves, stepHighlight, countMessage };
