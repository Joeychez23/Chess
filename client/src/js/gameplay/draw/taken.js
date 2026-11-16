// taken.js -- the taken-piece trays beside the board
const { game, ctx } = require("../state/index.js"); // THE GAME'S SHARED STATE, THE CANVAS
const { countStartPieces, materialDiff } = require("../utils/index.js"); // HOW MANY PIECES EACH SIDE STARTED WITH, WHO'S AHEAD IN MATERIAL
const { images } = require("../images/index.js"); // THE LOADED IMAGES BY IMAGE NUMBER
const {
	wFrontKingImg, wFrontQueenImg, wFrontBishopBlackSqImg, wRightKnightImg, wFrontRookImg, wFrontPawnImg, // WHITE IMAGES
	wFrontKingShdw, wFrontQueenShdw, wFrontBishopShdw, wRightKnightShdw, wFrontRookShdw, wFrontPawnShdw, // WHITE SHADOW
	bFrontKingImg, bFrontQueenImg, bFrontBishopWhiteSqImg, bRightKnightImg, bFrontRookImg, bFrontPawnImg, // BLACK IMAGES
	bFrontKingShdw, bFrontQueenShdw, bFrontBishopShdw, bRightKnightShdw, bFrontRookShdw, bFrontPawnShdw // BLACK SHADOW
} = require("../sprites/index.js"); // IMAGE NUMBERS, images[number].image IS THE IMAGE
const { trayNudge } = require("../animate/index.js"); // HOW FAR THE BOTTOM TRAY SITS DOWN

let xPos; // TAKEN PIECE TRAY COLUMN (renderTakenPieces)
let yPos; // TAKEN PIECE TRAY ROW

/* ---------------------------------------------------------------- */
// Set Taken Pieces Array
/* ---------------------------------------------------------------- */
/**
 * @description Sets Object array with all taken pieces of one color: the starting count of each piece minus the ones drawn
 * on the board this frame (wPieceCount / bPieceCount). Pawns aren't listed. While promoting it lists one queen, bishop,
 * knight & rook instead, the promotion picker
 * @param  {[string]} paramColor ['w' | 'b']
 * @return {[array]} takenArr [{ color, type }]
 */
export function setTakenPieceArr(paramColor) { // DRAW ALL TAKEN PIECES
	let takenArr = new Array();
	let currPieces; // HOW MANY OF EACH ARE ON THE BOARD
	if (game.currPromotion) { currPieces = { king: 1, queen: 0, bishop: 1, knight: 1, rook: 1, pawn: 8 } } // SETS TAKEN PIECES ARRAY TO ONLY CONTAIN ONE OF EACH UNIQUE PIECE THAT ISN'T A KING
	else { if (paramColor == "w") { currPieces = game.wPieceCount } else if (paramColor == "b") { currPieces = game.bPieceCount } }

	/**
	 * @description Adds (maxCount - amountOnBoard) pieces of one type to takenArr
	 */
	function countToObj(amountOnBoard, type, maxCount) {
		let takenCount;
		takenCount = maxCount - amountOnBoard;
		for (let i = 1; i < takenCount + 1; i++) { takenArr[takenArr.length] = { color: paramColor, type: type } }
	}

	const startCount = game.currPromotion ? countStartPieces().w : game.startPieceCount[paramColor]; // HOW MANY STARTED, THE PROMOTION PICKER USES THE STANDARD SET (ONE OF EACH)
	countToObj(currPieces.king, "k", startCount.king);
	countToObj(currPieces.queen, "q", startCount.queen);
	countToObj(currPieces.bishop, "b", startCount.bishop);
	countToObj(currPieces.knight, "n", startCount.knight);
	countToObj(currPieces.rook, "r", startCount.rook);

	return takenArr;
}

/* ---------------------------------------------------------------- */
// Renders Taken Pieces
/* ---------------------------------------------------------------- */
/**
 * @description Draw a single taken piece, for each piece in a tray next to the board, in squares off the board:
 * to the right on wide screens (3 to a row), above & below it otherwise. While promoting this is the promotion picker
 * & the piece under the mouse is see through. Tray knights always face right
 * @param  {[array]} takenPieces [from setTakenPieceArr(), each one gets its tray square (x, y) so it can be clicked]
 * @param  {[string]} paramColor [the color that took them, its tray is on its side of the board]
 * @param {[array]} board [the drawn board, for the material lead]
 */
export function renderTakenPieces(takenPieces, paramColor, board) {
	/* ---------------------------------------------------------------- */
	// Draw taken pieces
	/* ---------------------------------------------------------------- */
	/**
	 * @description Draws taken piece images to canvas (shadow & piece, no reflection) at xPos, yPos
	 * @param  {[object]} takenPiece [{ color, type, x, y }]
	 * @param  {[array]} imgArr [image numbers: shadow, piece]
	 */
	function drawTakenPiece(takenPiece, imgArr) {
		for (let i = 0; i < imgArr.length; i++) { // DRAW TAKEN PIECE IMAGES
			if (((takenPiece.x === game.tileX && takenPiece.y === game.tileY && (takenPiece.color == game.playerColor || !takenPiece.color))) && game.currPromotion) { ctx.globalAlpha = 0.8; } // HOVERED PROMOTION CHOICE
			ctx.drawImage(images[imgArr[i]].image, xPos * game.tileWidth + game.xBoardOff - game.xPieceOffset / 2, (yPos + trayNudge(yPos)) * game.tileHeight + game.yBoardOff - game.yPieceOffset / 2, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset);
			if (((takenPiece.x === game.tileX && takenPiece.y === game.tileY && (takenPiece.color == game.playerColor || !takenPiece.color))) && game.currPromotion) { ctx.globalAlpha = 1; }
		}
	}

	if (game.widthGreater) { // WIDE SCREEN: TRAYS TO THE RIGHT OF THE BOARD (COLUMN 9), THE PLAYER'S AT THE BOTTOM (ROW 6), THE OPPONENT'S AT THE TOP (ROW -1)
		if (game.viewColor == 'w') {
			if (paramColor == "w") { xPos = 9; yPos = 6; }
			else { xPos = 9; yPos = -1; }
		} else if (game.viewColor == 'b') {
			if (paramColor == "w") { xPos = 9; yPos = -1; }
			else { xPos = 9; yPos = 6; }
		}
	} else { // NARROW SCREEN: ONE ROW BELOW THE BOARD (ROW 9) FOR THE PLAYER, ONE ABOVE (ROW -2) FOR THE OPPONENT
		const xStart = game.portraitBoard ? 0 : -1; // PORTRAIT BOARD FILLS THE WIDTH, SO KEEP TAKEN PIECES ON SCREEN
		if (game.viewColor == 'w') {
			if (paramColor == "w") { xPos = xStart; yPos = 9; }
			else { xPos = xStart; yPos = -2; }
		} else if (game.viewColor == 'b') {
			if (paramColor == "w") { xPos = xStart; yPos = -2; }
			else { xPos = xStart; yPos = 9; }
		}
	}

	const trayImages = { // [SHADOW, PIECE] FOR EACH COLOR & TYPE, FRONTS ONLY, TRAY KNIGHTS ALWAYS FACE RIGHT
		w: { k: [wFrontKingShdw, wFrontKingImg], q: [wFrontQueenShdw, wFrontQueenImg], b: [wFrontBishopShdw, wFrontBishopBlackSqImg], n: [wRightKnightShdw, wRightKnightImg], r: [wFrontRookShdw, wFrontRookImg], p: [wFrontPawnShdw, wFrontPawnImg] },
		b: { k: [bFrontKingShdw, bFrontKingImg], q: [bFrontQueenShdw, bFrontQueenImg], b: [bFrontBishopShdw, bFrontBishopWhiteSqImg], n: [bRightKnightShdw, bRightKnightImg], r: [bFrontRookShdw, bFrontRookImg], p: [bFrontPawnShdw, bFrontPawnImg] }
	};
	for (let i = 0; i < takenPieces.length; i++) {
		takenPieces[i].x = xPos; // ITS TRAY SQUARE, SO IT CAN BE CLICKED (THE PROMOTION PICKER)
		takenPieces[i].y = yPos;
		const imgArr = takenPieces[i].color && trayImages[takenPieces[i].color]?.[takenPieces[i].type];
		if (!imgArr) { continue; } // NO COLOR OR UNKNOWN TYPE: NOT DRAWN & TAKES NO SQUARE
		drawTakenPiece(takenPieces[i], imgArr);
		xPos += 1;
		if (game.widthGreater && xPos - 9 == 3) { yPos += 1; xPos = 9; } // WIDE SCREEN: 3 TO A ROW
	}

	const lead = (paramColor == 'w' ? 1 : -1) * materialDiff(board);
	if (lead > 0 && !game.currPromotion) { // +N IN THE TRAY'S NEXT FREE SQUARE, THE PROMOTION PICKER HAS NO COUNT
		ctx.font = `600 ${game.tileHeight * 0.45}px Archivo, "Helvetica Neue", Arial, sans-serif`;
		ctx.fillStyle = "#d9b27a"; // SAME GOLD AS THE BOARD COORDINATES
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(`+${lead}`, (xPos + 0.5) * game.tileWidth + game.xBoardOff, (yPos + trayNudge(yPos) + 0.5) * game.tileHeight + game.yBoardOff);
	}
}
