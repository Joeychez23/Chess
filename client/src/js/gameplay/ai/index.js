const { aiMove, Game } = require('js-chess-engine');

/* ---------------------------------------------------------------- */
// Play Ai
/* ---------------------------------------------------------------- */
/**
 * @description calculates ai promotions, and positons of next move
 * @return {[object]} An object of move params
 */
export function playAi(chessInst, aiColor) {
	try {
		let computerMove = JSON.stringify(aiMove(chessInst.fen(), 1)).split("\""); // AI MOVE -> SPLIT STRING BY "

		let startPos = computerMove[1].toLowerCase();
		let endPos = computerMove[3].toLowerCase();

		let promote = false;

		if (((aiColor == 'b' && Number(startPos.split("")[1]) == 2 && Number(endPos.split("")[1]) == 1) || (aiColor == 'w' && Number(startPos.split("")[1]) == 7 && Number(endPos.split("")[1]) == 8)) && chessInst.get(startPos).type == 'p') { // IF PROMOTION TRUE
			const game = new Game(chessInst.fen());
			game.move(computerMove[1], computerMove[3])
			promote = game.board.configuration.pieces[computerMove[3]] // AI PROMOTION
			return { from: startPos, to: endPos, promotion: promote.toLowerCase() }
		} else {
			return { from: startPos, to: endPos }
		}
	} catch (err) {
		console.log(err);
	}
}