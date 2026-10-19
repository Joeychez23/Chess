/* ---------------------------------------------------------------- */
// Player Move
/* ---------------------------------------------------------------- */
/**
 * @description calculates user promotions, and positons of next move
 * @return {[object]} An object of move params
 */
export function playerMove(playerColor, tile) {
	let xLet
	let endPos
	if (playerColor == 'w') {
		xLet = String.fromCharCode(97 + tile.x); // CONEVERT TILE X POSITION TO ASSOICATED LETTER
		endPos = `${xLet}${8 - tile.y}`
	}
	if (playerColor == 'b') {
		xLet = String.fromCharCode(97 + (7 - tile.x)); // CONEVERT TILE X POSITION TO ASSOICATED LETTER
		endPos = `${xLet}${tile.y + 1}`
	}
	let startPos = tile.square;
	let promotion = false
	if ((tile.type == 'p') && ((playerColor == 'b' && Number(startPos.split("")[1]) == 2 && Number(endPos.split("")[1]) == 1) || (playerColor == 'w' && Number(startPos.split("")[1]) == 7 && Number(endPos.split("")[1]) == 8))) {
		promotion = 'n' // STATIC PROMOTION OF QUEEN
		return { from: startPos, to: endPos, promotion: promotion }
	} else {
		return { from: startPos, to: endPos }
	}
}
