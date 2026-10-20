const { aiMove, Game } = require('js-chess-engine');
const { stockfishAPI } = require("../validate/index.js")
/* ---------------------------------------------------------------- */
// Play Ai
/* ---------------------------------------------------------------- */
/**
 * @description calculates ai promotions, and positons of next move
 * @return {[object]} An object of move params
 */

export async function playAi(chessInst, aiColor) {
	let computerMove
	let startPos;
	let endPos;
	let promote;
	try {
		let response = await stockfishAPI({ fen: `${chessInst.fen()}`, depth: 1 });
		// console.log(response);
		startPos = response.from;
		endPos = response.to;
		promote = response.promotion
	} catch (err) {
		computerMove = JSON.stringify(aiMove(chessInst.fen(), 1)).split("\""); // AI MOVE -> SPLIT STRING BY "
		startPos = computerMove[1].toLowerCase();
		endPos = computerMove[3].toLowerCase();
		// console.log(computerMove)
		promote = false;
	}
	// let computerMove = JSON.stringify(aiMove(chessInst.fen(), 1)).split("\""); // AI MOVE -> SPLIT STRING BY "

	// let startPos = computerMove[1].toLowerCase();
	// let endPos = computerMove[3].toLowerCase();

	// console.log(computerMove)\
	// let promote = false;

	// console.log(chessInst.fen())
	// postChessApi({ fen: `${chessInst.fen()}` }).then((data) => {console.log(data); });

	// console.log(startPos, endPos)

	if (((aiColor == 'b' && Number(startPos.split("")[1]) == 2 && Number(endPos.split("")[1]) == 1) || (aiColor == 'w' && Number(startPos.split("")[1]) == 7 && Number(endPos.split("")[1]) == 8)) && chessInst.get(startPos).type == 'p') { // IF PROMOTION TRUE
		const game = new Game(chessInst.fen());
		game.move(computerMove[1], computerMove[3])

		promote = game.board.configuration.pieces[computerMove[3]] // AI PROMOTION
		return { from: startPos, to: endPos, promotion: promote.toLowerCase() }
	} else {
		return { from: startPos, to: endPos }
	}
	// } catch (err) {

	// 	// console.throw(err);
	// }
}
