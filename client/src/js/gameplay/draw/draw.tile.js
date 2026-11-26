/*
 *  draw.tile.js  --  chess frontend
 *	Draw Tile
 *	One square's part of the frame: the selected piece's legal moves on this square (with the held piece drawn there as a preview),
 *	the piece standing on it, facing the way the server's lists say (the check highlight under a king in check), & the piece's
 *	sprite itself: reflection, shadow & image (draw.slide.js when it's sliding). Private to draw/ (draw/index.js)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, ctx, chessInst } = require("../state/index.js");
const { images } = require("../images/index.js"); // The loaded images by image number
const {
	wRightKnightImg, wLeftKnightImg,
	wRightKnightShdw, wLeftKnightShdw,
	wRightKnightRefl, wLeftKnightRefl,
	bRightKnightImg, bLeftKnightImg,
	bRightKnightShdw, bLeftKnightShdw,
	bRightKnightRefl, bLeftKnightRefl,
	moveHighlight, takeableHighlight, checkHighlight
} = require("../sprites/index.js"); // Image numbers, images[number].image is the image
const { landSlide } = require("../moves/index.js"); // A slide landed: sends the player's move, finishes the opponent's
const { parseList, awayFromRows, facesAway, knightFacesRight } = require("./facing.js"); // Shared piece & knight facing rules
const { setPieceSprites, handlePawnDirection, setKnightSide } = require("./pieceSprites.js");
const drawSlide = require("./draw.slide.js");

/* ---------------------------------------------------------------- */
// Available Moves
/* ---------------------------------------------------------------- */
/**
 * @description Draws this square's part of the selected piece's legal moves: a move highlight (a takeable highlight if the move takes
 * a piece). When the held piece is over this move, it's drawn here as a preview
 * @param  {[number]} row [screen row of the square]
 * @param  {[number]} column [screen column of the square]
 * @param  {[number]} index [this square's tile]
 * @param  {[array]} moves [the selected piece's legal moves (chess.js verbose moves)]
 * @param  {[object]} drawState [the draw state shared by draw/ (draw/index.js)]
 */
export function availableMoves(row, column, index, moves, drawState) {
	const square = squareName(row, column);
	const tile = game.mousedownTile || game.clickedTile; // The selected piece, a held piece comes first
	for (let r = 0; r < moves.length; r++) {
		if (moves[r].to == square) { drawMove(moves[r], tile, moves, index, drawState); }
	}
}

/**
 * @description This square's name (e4)
 */
function squareName(row, column) {
	if (game.viewColor == 'w') { return `${String.fromCharCode(97 + column)}${8 - row}`; }
	if (game.viewColor == 'b') { return `${String.fromCharCode(96 + (8 - column))}${row + 1}`; } // Flipped board
}

/**
 * @description Draws one legal move's highlight, & the held piece over it when the mouse is on it
 * @param  {[object]} move [chess.js verbose move]
 * @param  {[object]} tile [the selected tile]
 */
function drawMove(move, tile, moves, index, drawState) {
	const column = moveColumn(move.to); // Screen column & row of the move
	const row = moveRow(move.to);
	const highlight = move.san.lastIndexOf("x") != -1 ? takeableHighlight : moveHighlight; // The move takes an opposing piece
	clearPreviewOffMoves(tile, moves);
	ctx.globalAlpha = 0.50;
	const highlightX = column * game.tileWidth + game.xBoardOff;
	const highlightY = row * game.tileHeight - game.tileHeight / 10 + game.yBoardOff;
	ctx.drawImage(images[highlight].image, highlightX, highlightY, game.tileWidth, game.tileHeight);
	ctx.globalAlpha = 1.00;
	if (game.tileX == column && game.tileY == row && game.mousedownTile) { // The held piece is over this move: draw it here (preview)
		tile.xAvailInt = column;
		tile.yAvailInt = row;
		const x = column * game.tileWidth + game.xBoardOff;
		const y = row * game.tileHeight - game.tileHeight / 6 + game.yBoardOff;
		drawHeldPreview(tile, x, y, index, drawState);
	}
}

/**
 * @description Screen column of a move's square
 */
function moveColumn(to) {
	if (game.viewColor == 'w') { return to.split("")[0].charCodeAt(0) - 96 - 1; }
	if (game.viewColor == 'b') { return 8 - (to.split("")[0].charCodeAt(0) - 96); }
}

/**
 * @description Screen row of a move's square
 */
function moveRow(to) {
	if (game.viewColor == 'w') { return 8 - to.split("")[1]; }
	if (game.viewColor == 'b') { return to.split("")[1] - 1; }
}

/**
 * @description Clears the held piece's preview square when the mouse isn't on any of its legal moves
 */
function clearPreviewOffMoves(tile, moves) {
	for (let a = 0; a < moves.length; a++) {
		if (game.tileX == moveColumn(moves[a].to) && game.tileY == moveRow(moves[a].to) && game.mousedownTile) { return; }
	}
	tile.xAvailInt = null;
	tile.yAvailInt = null;
}

/**
 * @description Draws the held piece on the legal square under the mouse (the drop preview), always solid. Knights face left while
 * the mouse is left of them, kings, queens, bishops & rooks face up or down the way they'd move. Counts the piece (the main loop
 * doesn't draw it)
 * @param  {[object]} tile [the held tile]
 * @param  {[number]} x [pixel x]
 * @param  {[number]} y [pixel y]
 */
function drawHeldPreview(tile, x, y, index, drawState) {
	const pieceType = tile.type;
	const pieceColor = tile.color;
	if (pieceType.match(/[kqbr]/) && pieceColor) {
		// The way it faces now, same as the board (w_piece / b_piece)
		if (pieceColor == "w") {
			const away = facesAway(parseList("w_piece", game.response.w_piece), tile.square, "w", {
				viewColor: game.viewColor, slide: null, landed: null,
			});
			if (away !== null) {
				setPieceSprites("w", away);
				drawHeldPiece(tile, pieceType, pieceColor, x, y, index, drawState);
			}
		} else if (pieceColor == "b") {
			const away = facesAway(parseList("b_piece", game.response.b_piece), tile.square, "b", {
				viewColor: game.viewColor, slide: null, landed: null,
			});
			if (away !== null) {
				setPieceSprites("b", away);
				drawHeldPiece(tile, pieceType, pieceColor, x, y, index, drawState);
			}
		}
	} else if (pieceType.match(/[n]/) && pieceColor) {
		const facesLeft = game.tileX < tile.x && game.playerColor == pieceColor;
		if (pieceColor == "w") {
			if (facesLeft) { game.wKnightImg = wLeftKnightImg; game.wKnightShdw = wLeftKnightShdw; game.wKnightRefl = wLeftKnightRefl; }
			else { game.wKnightImg = wRightKnightImg; game.wKnightShdw = wRightKnightShdw; game.wKnightRefl = wRightKnightRefl; }
			piece([game.wKnightRefl, game.wKnightShdw, game.wKnightImg], x, y, false, index, drawState);
			game.wPieceCount.knight++;
		} else if (pieceColor == "b") {
			if (facesLeft) { game.bKnightImg = bLeftKnightImg; game.bKnightShdw = bLeftKnightShdw; game.bKnightRefl = bLeftKnightRefl; }
			else { game.bKnightImg = bRightKnightImg; game.bKnightShdw = bRightKnightShdw; game.bKnightRefl = bRightKnightRefl; }
			piece([game.bKnightRefl, game.bKnightShdw, game.bKnightImg], x, y, false, index, drawState);
			game.bPieceCount.knight++;
		}
	} else if (pieceType.match(/[p]/) && pieceColor) {
		handlePawnDirection(); // Pawns always face the other side
		if (pieceColor == "w") {
			piece([game.wPawnRefl, game.wPawnShdw, game.wPawnImg], x, y, false, index, drawState);
			game.wPieceCount.pawn++;
		} else if (pieceColor == "b") {
			piece([game.bPawnRefl, game.bPawnShdw, game.bPawnImg], x, y, false, index, drawState);
			game.bPieceCount.pawn++;
		}
	}
}

/**
 * @description Draws the held king, queen, bishop or rook on the move under the mouse. A move up or down the board turns it the way it
 * would go (sideways keeps the way it faces now)
 */
function drawHeldPiece(tile, pieceType, pieceColor, x, y, index, drawState) {
	if (tile.yAvailInt != tile.originY) {
		setPieceSprites(pieceColor, awayFromRows(tile.originY, tile.yAvailInt, pieceColor, game.viewColor));
	}
	if (pieceType.match(/[k]/) && pieceColor) {
		if (pieceColor == "w") {
			piece([game.wKingRefl, game.wKingShdw, game.wKingImg], x, y, false, index, drawState);
			game.wPieceCount.king++;
		} else if (pieceColor == "b") {
			piece([game.bKingRefl, game.bKingShdw, game.bKingImg], x, y, false, index, drawState);
			game.bPieceCount.king++;
		}
	} else if (pieceType.match(/[q]/) && pieceColor) {
		if (pieceColor == "w") {
			piece([game.wQueenRefl, game.wQueenShdw, game.wQueenImg], x, y, false, index, drawState);
			game.wPieceCount.queen++;
		} else if (pieceColor == "b") {
			piece([game.bQueenRefl, game.bQueenShdw, game.bQueenImg], x, y, false, index, drawState);
			game.bPieceCount.queen++;
		}
	} else if (pieceType.match(/[b]/) && pieceColor) { // The image goes by the color of the bishop's square
		if (pieceColor == "w") {
			if (chessInst.squareColor(tile.square) == 'light') {
				piece([game.wBishopRefl, game.wBishopShdw, game.wBishopWhiteSqImg], x, y, false, index, drawState);
				game.wPieceCount.bishop++;
			} else if (chessInst.squareColor(tile.square) == 'dark') {
				piece([game.wBishopRefl, game.wBishopShdw, game.wBishopBlackSqImg], x, y, false, index, drawState);
				game.wPieceCount.bishop++;
			}
		} else if (pieceColor == "b") {
			if (chessInst.squareColor(tile.square) == 'light') {
				piece([game.bBishopRefl, game.bBishopShdw, game.bBishopWhiteSqImg], x, y, false, index, drawState);
				game.bPieceCount.bishop++;
			} else if (chessInst.squareColor(tile.square) == 'dark') {
				piece([game.bBishopRefl, game.bBishopShdw, game.bBishopBlackSqImg], x, y, false, index, drawState);
				game.bPieceCount.bishop++;
			}
		}
	} else if (pieceType.match(/[r]/) && pieceColor) {
		if (pieceColor == "w") {
			piece([game.wRookRefl, game.wRookShdw, game.wRookImg], x, y, false, index, drawState);
			game.wPieceCount.rook++;
		} else if (pieceColor == "b") {
			piece([game.bRookRefl, game.bRookShdw, game.bRookImg], x, y, false, index, drawState);
			game.bPieceCount.rook++;
		}
	}
}

/* ---------------------------------------------------------------- */
// Board Piece
/* ---------------------------------------------------------------- */
/**
 * @description Draws the king, queen, bishop, rook or pawn on tile index with its reflection & shadow, facing the way the server's piece
 * list says (w_piece / b_piece): { from, to } of each one's last move up or down (a sideways move only changes to), from is null before
 * it has one & both are null once it's taken. Used in its own square's turn & for a sliding piece in the turn of the square after it
 * @param  {[string]} pieceType [k | q | b | r | p]
 * @param  {[string]} pieceColor [w | b]
 * @param  {[number]} x [pixel x, when not sliding]
 * @param  {[number]} y [pixel y, when not sliding]
 * @param  {[boolean]} opacity [false = always solid (a clicked piece back on its own square)]
 * @param  {[number]} index [the piece's tile]
 * @param  {[object]} drawState [the draw state shared by draw/ (draw/index.js)]
 */
export function boardPiece(pieceType, pieceColor, x, y, opacity, index, drawState) {
	const tile = game.tiles[index];
	if (pieceType.match(/[kqbr]/) && pieceColor) {
		if (pieceColor == "w") {
			const away = facesAway(parseList("w_piece", game.response.w_piece), tile.square, "w", {
				viewColor: game.viewColor, slide: tile.isSliding ? drawSlide.face() : null, landed: null,
			});
			if (away !== null) {
				setPieceSprites("w", away);
				drawStandingPiece(pieceType, pieceColor, x, y, opacity, index, drawState);
			}
		} else if (pieceColor == "b") {
			const away = facesAway(parseList("b_piece", game.response.b_piece), tile.square, "b", {
				viewColor: game.viewColor, slide: tile.isSliding ? drawSlide.face() : null, landed: null,
			});
			if (away !== null) {
				setPieceSprites("b", away);
				drawStandingPiece(pieceType, pieceColor, x, y, opacity, index, drawState);
			}
		}
	} else if (pieceType.match(/[p]/) && pieceColor) {
		handlePawnDirection(); // Pawns always face the other side
		if (pieceColor == "w") {
			piece([game.wPawnRefl, game.wPawnShdw, game.wPawnImg], x, y, opacity, index, drawState);
			game.wPieceCount.pawn++;
		} else if (pieceColor == "b") {
			piece([game.bPawnRefl, game.bPawnShdw, game.bPawnImg], x, y, opacity, index, drawState);
			game.bPieceCount.pawn++;
		}
	}
}

/**
 * @description Draws the king, queen, bishop or rook with the images the facing above picked (draw/facing.js). While the player holds
 * their piece it faces the way it's dragged (up or down from its square)
 */
function drawStandingPiece(pieceType, pieceColor, x, y, opacity, index, drawState) {
	const tile = game.tiles[index];
	if (tile.isMousedown && tile.y != tile.originY && game.playerColor == pieceColor) {
		setPieceSprites(pieceColor, awayFromRows(tile.originY, tile.y, pieceColor, game.viewColor));
	}
	if (pieceType.match(/[k]/) && pieceColor) {
		if (pieceColor == "w") {
			if (chessInst.isCheck() && pieceColor == chessInst.turn()) { drawCheckHighlight(tile); }
			piece([game.wKingRefl, game.wKingShdw, game.wKingImg], x, y, opacity, index, drawState);
			game.wPieceCount.king++;
		} else if (pieceColor == "b") {
			if (chessInst.isCheck() && pieceColor == chessInst.turn()) { drawCheckHighlight(tile); }
			piece([game.bKingRefl, game.bKingShdw, game.bKingImg], x, y, opacity, index, drawState);
			game.bPieceCount.king++;
		}
	} else if (pieceType.match(/[q]/) && pieceColor) {
		if (pieceColor == "w") {
			piece([game.wQueenRefl, game.wQueenShdw, game.wQueenImg], x, y, opacity, index, drawState);
			game.wPieceCount.queen++;
		} else if (pieceColor == "b") {
			piece([game.bQueenRefl, game.bQueenShdw, game.bQueenImg], x, y, opacity, index, drawState);
			game.bPieceCount.queen++;
		}
	} else if (pieceType.match(/[b]/) && pieceColor) { // The image goes by the color of the bishop's square
		if (pieceColor == "w") {
			if (chessInst.squareColor(tile.square) == 'light') {
				piece([game.wBishopRefl, game.wBishopShdw, game.wBishopWhiteSqImg], x, y, opacity, index, drawState);
				game.wPieceCount.bishop++;
			} else if (chessInst.squareColor(tile.square) == 'dark') {
				piece([game.wBishopRefl, game.wBishopShdw, game.wBishopBlackSqImg], x, y, opacity, index, drawState);
				game.wPieceCount.bishop++;
			}
		} else if (pieceColor == "b") {
			if (chessInst.squareColor(tile.square) == 'light') {
				piece([game.bBishopRefl, game.bBishopShdw, game.bBishopWhiteSqImg], x, y, opacity, index, drawState);
				game.bPieceCount.bishop++;
			} else if (chessInst.squareColor(tile.square) == 'dark') {
				piece([game.bBishopRefl, game.bBishopShdw, game.bBishopBlackSqImg], x, y, opacity, index, drawState);
				game.bPieceCount.bishop++;
			}
		}
	} else if (pieceType.match(/[r]/) && pieceColor) {
		if (pieceColor == "w") {
			piece([game.wRookRefl, game.wRookShdw, game.wRookImg], x, y, opacity, index, drawState);
			game.wPieceCount.rook++;
		} else if (pieceColor == "b") {
			piece([game.bRookRefl, game.bRookShdw, game.bRookImg], x, y, opacity, index, drawState);
			game.bPieceCount.rook++;
		}
	}
}

/**
 * @description The check highlight under the king in check
 */
function drawCheckHighlight(tile) {
	ctx.globalAlpha = 0.70;
	ctx.drawImage(
		images[checkHighlight].image,
		(tile.x * game.tileWidth + game.xBoardOff) + ((game.tileWidth * 0.0243) / 2),
		(tile.y * game.tileHeight - game.tileHeight / 10 + game.yBoardOff) + ((game.tileHeight * 0.1034) / 2),
		game.tileWidth,
		game.tileHeight
	);
	ctx.globalAlpha = 1.00;
}

/* ---------------------------------------------------------------- */
// Knight
/* ---------------------------------------------------------------- */
/**
 * @description Draws the knight on tile index, facing the way the server's knight list says (w_knight / b_knight): { from, to } of each
 * knight's last move, from is null before it moves & both are null once it's taken. A sliding knight is drawn here only when it isn't
 * hopping over another square (hopTurn: then it's drawn in that square's turn)
 * @param  {[string]} pieceColor [w | b]
 * @param  {[boolean]} opacity [false = always solid (a clicked piece back on its own square)]
 * @param  {[object]} hopTurn [the hopping knight's turn (draw/index.js), null when it's over its own square]
 */
export function knight(pieceColor, x, y, opacity, index, hopTurn, drawState) {
	const tile = game.tiles[index];
	if (pieceColor == "w") {
		const right = knightFacesRight(parseList("w_knight", game.response.w_knight), tile.square, "w", {
			viewColor: game.viewColor, slide: tile.isSliding ? drawSlide.face() : null, landed: null,
		});
		if (right !== null && tile.isSliding) {
			if (!hopTurn) {
				setKnightSide("w", right ? 'right' : 'left');
				piece([game.wKnightRefl, game.wKnightShdw, game.wKnightImg], x, y, opacity, index, drawState);
			}
		} else if (right !== null) {
			setKnightSide("w", right ? 'right' : 'left');
			drawStandingKnight(pieceColor, x, y, opacity, index, drawState);
		}
		game.wPieceCount.knight++;
	} else if (pieceColor == "b") {
		const right = knightFacesRight(parseList("b_knight", game.response.b_knight), tile.square, "b", {
			viewColor: game.viewColor, slide: tile.isSliding ? drawSlide.face() : null, landed: null,
		});
		if (right !== null && tile.isSliding) {
			if (!hopTurn) {
				setKnightSide("b", right ? 'right' : 'left');
				piece([game.bKnightRefl, game.bKnightShdw, game.bKnightImg], x, y, opacity, index, drawState);
			}
		} else if (right !== null) {
			setKnightSide("b", right ? 'right' : 'left');
			drawStandingKnight(pieceColor, x, y, opacity, index, drawState);
		}
		game.bPieceCount.knight++;
	}
}

/**
 * @description Draws the knight with the images the facing above picked. While the player holds their knight it faces the way it's
 * dragged (left or right of its square)
 */
function drawStandingKnight(pieceColor, x, y, opacity, index, drawState) {
	const tile = game.tiles[index];
	const draggedLeft = tile.isMousedown && tile.x < tile.originX && game.playerColor == pieceColor;
	const draggedRight = tile.isMousedown && tile.x > tile.originX && game.playerColor == pieceColor;
	if (pieceColor == 'w') {
		if (draggedLeft) { game.wKnightImg = wLeftKnightImg; game.wKnightShdw = wLeftKnightShdw; game.wKnightRefl = wLeftKnightRefl; }
		else if (draggedRight) { game.wKnightImg = wRightKnightImg; game.wKnightShdw = wRightKnightShdw; game.wKnightRefl = wRightKnightRefl; }
		piece([game.wKnightRefl, game.wKnightShdw, game.wKnightImg], x, y, opacity, index, drawState);
	} else if (pieceColor == 'b') {
		if (draggedLeft) { game.bKnightImg = bLeftKnightImg; game.bKnightShdw = bLeftKnightShdw; game.bKnightRefl = bLeftKnightRefl; }
		else if (draggedRight) { game.bKnightImg = bRightKnightImg; game.bKnightShdw = bRightKnightShdw; game.bKnightRefl = bRightKnightRefl; }
		piece([game.bKnightRefl, game.bKnightShdw, game.bKnightImg], x, y, opacity, index, drawState);
	}
}

/* ---------------------------------------------------------------- */
// Piece
/* ---------------------------------------------------------------- */
/**
 * @description Draws a piece's sprite: the reflection (30%), shadow (75%) & piece, in that order. Held, clicked & hovered pieces are a
 * little see through. A sliding piece is drawn where the time says it is (draw.slide.js) & when it arrives the move is sent (the
 * player's) or finished (the opponent's)
 * !NOTE: IT'S ASYNC: AFTER THE AWAIT, game.tiles MAY BE A NEW ARRAY (refreshData) & THE FRAME HAS MOVED ON
 * @param  {[array]} imgArr [image numbers: reflection, shadow, piece]
 * @param  {[number]} x [pixel x, when not sliding]
 * @param  {[number]} y [pixel y, when not sliding]
 * @param  {[boolean]} opacity [false = always solid (a clicked piece back on its own square, the drop preview)]
 * @param  {[number]} index [the tile whose held, clicked, hovered & sliding state is read]
 * @param  {[object]} drawState [the draw state shared by draw/ (draw/index.js)]
 */
export async function piece(imgArr, x, y, opacity, index, drawState) {
	const tile = game.tiles[index];
	for (let layer = 0; layer < imgArr.length; layer++) { // 0 reflection, 1 shadow, 2 piece
		const heldOrHovered = tile.isMousedown || tile.isClicked || tile.isHovering;
		if (heldOrHovered && opacity && !tile.isSliding && !game.opposingMove) { ctx.globalAlpha = 0.85; }
		if (layer == 0) { ctx.globalAlpha = 0.30; }
		else if (layer == 1) { ctx.globalAlpha = 0.75; }

		if (tile.isSliding) {
			const slidePos = drawSlide.trackPosition(tile);
			try {
				if (drawSlide.layer(tile, index, imgArr[layer], layer, slidePos, drawState)) {
					await landSlide(index); // Sends the player's move, finishes the opponent's or the replay's step
					// Nothing after the wait: the frame has moved past the board, so the solid reset below read no tile & did nothing
					return;
				}
			} catch { return; }
		} else if (layer == 2 || drawState.lightObstruction) { // The reflection & shadow only with lightObstruction
			const width = game.tileWidth + game.xPieceOffset;
			const height = game.tileHeight + game.yPieceOffset;
			ctx.drawImage(images[imgArr[layer]].image, x - game.xPieceOffset / 2, y - game.yPieceOffset / 2, width, height);
		}
		// Back to solid for the next layer
		if ((heldOrHovered && opacity && !tile.isSliding) || layer == 0 || layer == 1) { ctx.globalAlpha = 1; }
	}
}
