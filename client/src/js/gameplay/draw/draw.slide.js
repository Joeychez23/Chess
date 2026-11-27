/*
 *  draw.slide.js  --  chess frontend
 *	Draw Slide
 *	A sliding or hopping piece's part of the frame: the square it's crossing, its reflection, shadow & image where the time says
 *	it is, a knight's hop & its short stop before the hop, & the redraw at the end of the frame that puts a hopping knight on top
 *	of everything & the pieces in front of a landed knight back over it. Private to draw/ (draw/index.js & draw.tile.js)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, ctx, chessInst } = require("../state/index.js");
const { images } = require("../images/index.js"); // The loaded images by image number
const { handleKnightHop } = require("../animate/index.js"); // How high a hopping knight is
const { KNIGHT_PAUSE_MS } = require("../animate/timing.js"); // Not through animate/index.js: it is still loading when this file loads
const { parseList, facesAway, knightFacesRight } = require("./facing.js");
const { setPieceSprites, handlePawnDirection, setKnightSide } = require("./pieceSprites.js");

/**
 * @description The two squares a sliding piece faces the way of: its move (moveObj), or, stepping back in a replay, the pair that keeps
 * the facing it had before the move (moveObj.face, replay/positions.js facePair) so it slides back without turning. Landing & draw
 * order still use moveObj, the squares it actually slides between
 * @return {[object]} { from, to }
 */
export function face() {
	return game.moveObj.face || game.moveObj;
}

/* ---------------------------------------------------------------- */
// Track Slide Position
/* ---------------------------------------------------------------- */
/**
 * @description The square a diagonal slide is crossing, in white's file letters, so the pieces it passes can be drawn again over it
 * (drawState.overlapSlideObj). Straight slides & rooks don't overlap other pieces
 * @param  {[object]} tile [the sliding tile]
 * @return {[string]} the square's name, or null when the slide doesn't overlap
 */
export function trackPosition(tile) {
	const goingRight = tile.xSlideTo > tile.x;
	const goingLeft = tile.xSlideTo < tile.x;
	const goingDown = tile.ySlideTo > tile.y;
	const goingUp = tile.ySlideTo < tile.y;
	if (tile.type == 'r' || !(goingRight || goingLeft) || !(goingDown || goingUp)) { return null; } // Rooks skip the overlap redraw

	if (goingRight && goingDown) {
		const xChange = tile.x + Math.floor(tile.xDiff / game.tileWidth); // Screen column & row being crossed
		const yChange = tile.y - Math.floor(tile.yDiff / game.tileHeight);
		return `${String.fromCharCode(97 + xChange)}${9 - yChange}`;
	}
	if (goingRight) { // Up the board
		// + 0.001: the snap leaves it a hair short of the square (339.99 of 340). It's the square it's leaving, like up & to the left:
		// with the square it's entering, the piece below the square it left wasn't drawn again & it slid over that piece
		const xChange = tile.x + Math.floor(tile.xDiff / game.tileWidth + 0.001);
		const yChange = tile.y - Math.floor(tile.yDiff / game.tileHeight + 0.001);
		return `${String.fromCharCode(97 + xChange)}${8 - yChange}`;
	}
	if (goingDown) { // Going left
		const xChange = tile.x + Math.floor(tile.xDiff / game.tileWidth);
		const yChange = tile.y - Math.floor(tile.yDiff / game.tileHeight);
		return `${String.fromCharCode(98 + xChange)}${9 - yChange}`;
	}
	// Up & to the left. Ceil: on a square (the first & the landing frame) it's that square, not the one to its right
	const xChange = tile.x + Math.ceil(tile.xDiff / game.tileWidth - 0.001);
	const yChange = tile.y - Math.floor(tile.yDiff / game.tileHeight + 0.001); // + 0.001: the snap leaves it a hair short of the square
	return `${String.fromCharCode(97 + xChange)}${8 - yChange}`;
}

/* ---------------------------------------------------------------- */
// Draw Slide Layer
/* ---------------------------------------------------------------- */
/**
 * @description Draws one layer of a sliding piece where the time says it is (stepSlide): its reflection or shadow (only with
 * drawState.lightObstruction), or its image. A knight hops while it slides
 * @param  {[object]} tile [the sliding tile, game.tiles[index]]
 * @param  {[number]} index [its tile]
 * @param  {[number]} img [image number of this layer]
 * @param  {[number]} layer [0 reflection, 1 shadow, 2 piece]
 * @param  {[string]} slidePos [the square it's crossing (trackPosition), null when it doesn't overlap]
 * @param  {[object]} drawState [the draw state shared by draw/ (draw/index.js)]
 * @return {[boolean]} true when it arrived this frame: the caller sends or finishes the move (landSlide)
 */
export function layer(tile, index, img, layer, slidePos, drawState) {
	if (slidePos) { setOverlapSlide(tile, slidePos, drawState); }
	const arrived = tile.slideProgress == 1; // stepSlide
	if (tile.type.match(/[n]/)) { return drawKnightLayer(tile, index, img, layer, arrived, drawState); }
	return drawSlidingLayer(tile, img, layer, arrived, drawState);
}

/**
 * @description Keeps only the sliding piece's own square for the redraw at the end of the frame (redrawInFront), when the square
 * it's crossing is on the board
 */
function setOverlapSlide(tile, slidePos, drawState) {
	let y2x2;
	if (game.viewColor == 'w') {
		const xPos = slidePos.split("")[0].charCodeAt(0) - 97; // File number of slidePos (a = 0)
		const yPos = Number(slidePos.split("")[1]); // Rank of slidePos
		if ((xPos) >= 0 && (xPos) <= 8 && (yPos) >= 0 && (yPos) <= 8) { y2x2 = tile.square; }
		drawState.overlapSlideObj = { y2x2 };
	} else if (game.viewColor == 'b') { // Flipped board: slidePos is in white's letters
		const xPos = (8 - (slidePos.split("")[0].charCodeAt(0) - 97));
		const yPos = 9 - Number(slidePos.split("")[1]);
		if ((xPos - 1) >= 0 && (xPos - 1) <= 8 && (yPos) >= 0 && (yPos) <= 8) { y2x2 = tile.square; }
		drawState.overlapSlideObj = { y2x2 };
	}
}

/**
 * @description A hopping knight's layer: the reflection & shadow stay on the board, shifted up to a fifth of a square left as it
 * rises, the knight goes up to half a square up (knightHop). On its first frame it stops for KNIGHT_PAUSE_MS before the hop
 */
function drawKnightLayer(tile, index, img, layer, arrived, drawState) {
	handleKnightHop(tile); // How high it is this frame (knightHop)
	if ((layer == 0 || layer == 1) && drawState.lightObstruction) {
		drawSprite(img, slideX(tile) - (game.tileWidth / 5) * game.knightHop, slideY(tile));
		return false;
	}
	if (layer != 2) { return false; }

	if (game.slideStart == true) { // First frame: lift the knight & stop
		drawSprite(img, slideX(tile), slideY(tile) - (game.tileHeight / 2) * game.knightHop);
		startKnightPause(index, drawState);
		return false;
	}
	if (arrived) { // Landed: draw it on the square, the caller finishes the move
		tile.isSliding = null;
		// So the end of the frame uses the landed redraw (in front of & behind the right pieces), not the hop's (on top of everything)
		drawState.overlapSlideObj = null;
		drawSprite(img, slideX(tile), slideY(tile));
		return true;
	}
	// In the air. On its new square (the frame before it lands) it's drawn again like a landed piece at the end of the frame, not on top
	if (game.knightHop == 0) { drawState.overlapSlideObj = null; }
	drawSprite(img, slideX(tile), slideY(tile) - (game.tileHeight / 2) * game.knightHop);
	return false;
}

/**
 * @description Stops the hop for KNIGHT_PAUSE_MS: currSlide off stops the animation, knightPause still draws the knight on top at the
 * end of each frame meanwhile. The timeout starts it again, unless it already landed (a hidden tab's timers run late)
 */
function startKnightPause(index, drawState) {
	game.currSlide = false;
	drawState.knightPause = true;
	game.slideStart = false;
	setTimeout(function () {
		drawState.knightPause = false;
		if (game.tiles[index].isSliding) { game.currSlide = true; }
	}, KNIGHT_PAUSE_MS);
}

/**
 * @description A sliding king, queen, bishop, rook or pawn's layer. Its image is drawn before it arrives & on the frame it arrives
 */
function drawSlidingLayer(tile, img, layer, arrived, drawState) {
	if ((layer == 0 || layer == 1) && drawState.lightObstruction) {
		drawSprite(img, slideX(tile), slideY(tile));
		return false;
	}
	if (layer != 2) { return false; }
	drawSprite(img, slideX(tile), slideY(tile));
	if (!arrived) { return false; }
	tile.isSliding = null; // Arrived: the caller finishes the move
	return true;
}

/**
 * @description Pixel x of a sliding piece's sprite this frame: its square moved by xDiff, centered on the sprite's larger size
 */
function slideX(tile) {
	return (((tile.x * game.tileWidth) + tile.xDiff) + game.xBoardOff) - game.xPieceOffset / 2;
}

/**
 * @description Pixel y of a sliding piece's sprite this frame: its square moved by yDiff (subtracted, up the screen is positive), resting
 * a tenth of a square up like every piece, centered on the sprite's larger size
 */
function slideY(tile) {
	return ((((tile.y * game.tileHeight) - tile.yDiff) - game.tileHeight / 10) + game.yBoardOff) - game.yPieceOffset / 2;
}

/**
 * @description Draws one sprite image at the piece sprite's size (a little bigger than a square)
 */
function drawSprite(img, x, y) {
	ctx.drawImage(images[img].image, x, y, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset);
}

/* ---------------------------------------------------------------- */
// Redraw In Front
/* ---------------------------------------------------------------- */
/**
 * @description End of the frame: while a slide passes other pieces (or a knight just landed, or stops before its hop), draws the
 * pieces in front of it again (image only). A hopping knight goes over everything; a landed knight goes over the pieces behind it,
 * then the piece to its right & the pieces in front are drawn again over it. Other slides aren't drawn again, they're drawn once at
 * their depth (draw/index.js slideTurn)
 * @param  {[object]} drawState [the draw state shared by draw/ (draw/index.js)]
 */
export function redrawInFront(drawState) {
	let landedTile = null;
	if (!drawState.overlapSlideObj) { landedTile = findLandedKnight(drawState); } // currSlide can already be false here (see below)
	if (!((game.currSlide || landedTile || drawState.knightPause) && drawState.overlapSlideObj)) { return; }

	for (let q = 0; q < game.tiles.length; q++) { // Swap the sliding piece's square name for its tile (an empty square stays a name)
		if (game.tiles[q].square == drawState.overlapSlideObj.y2x2 && game.tiles[q].type) { drawState.overlapSlideObj.y2x2 = game.tiles[q]; }
	}

	const slidTile = drawState.overlapSlideObj.y2x2;
	if (landedTile) {
		redrawAroundLandedKnight(landedTile, slidTile);
	} else if (slidTile?.type == "n") { // A hopping knight goes over everything: draw it again on top
		drawSlideBox(slidTile);
	}
	drawState.overlapSlideObj = null;
}

/**
 * @description A landed knight: until the move comes back & the board is rebuilt, the knight is still on its old tile (moved by
 * xDiff / yDiff), so the board draws it in its old square's turn & no overlap is kept for it. Its overlap is just itself (from the
 * frame it's back on the board), drawPieceBelow needs it. validateMove turns currSlide off before setTiles() is done, so this is
 * looked for even when nothing is sliding
 * @return {[object]} the knight's tile, or null
 */
function findLandedKnight(drawState) {
	for (let q = 0; q < game.tiles.length; q++) {
		const tile = game.tiles[q];
		if (tile.square == game.moveObj.from && tile.type == 'n' && (!tile.isSliding || game.knightHop == 0) && (tile.xDiff || tile.yDiff)) {
			drawState.overlapSlideObj = { y2x2: tile };
			return tile;
		}
	}
	return null;
}

/**
 * @description Draws the landed knight again over the pieces behind it, then the piece to its right (drawn after it on the board) &
 * the pieces in front of it & of its two neighbouring files again
 */
function redrawAroundLandedKnight(landedTile, slidTile) {
	const to = game.moveObj.to.split("");
	const right = game.viewColor == 'w' ? 1 : -1; // Screen right is the next file (white) or the one before it (black, flipped)
	drawSlideBox(landedTile);
	for (let q = 0; q < game.tiles.length; q++) {
		if (game.tiles[q].square == `${String.fromCharCode(to[0].charCodeAt(0) + right)}${to[1]}` && game.tiles[q].type) {
			drawSlideBox(game.tiles[q]);
		}
	}
	drawPieceBelow(game.moveObj.to, slidTile);
	drawPieceBelow(`${String.fromCharCode(to[0].charCodeAt(0) - 1)}${to[1]}`, slidTile);
	drawPieceBelow(`${String.fromCharCode(to[0].charCodeAt(0) + 1)}${to[1]}`, slidTile);
}

/**
 * @description Draws the pieces below a square on screen again, one square at a time down the column (lower pieces are closer to the
 * player, so they're in front)
 * @param  {[string]} square [square name]
 * @param  {[object]} slidTile [the sliding piece's tile (or its square's name), never drawn again here]
 */
function drawPieceBelow(square, slidTile) {
	if (!(square && slidTile?.square)) { return; }
	const sq = square.split("");
	let below = square;
	if (game.viewColor == 'w') { below = `${sq[0]}${Number(sq[1]) - 1}`; }
	else if (game.viewColor == 'b') { below = `${sq[0]}${Number(sq[1]) + 1}`; }
	for (let a = 0; a < game.tiles.length; a++) {
		if (game.tiles[a].square == below && slidTile.square != below) {
			drawSlideBox(game.tiles[a]);
			drawPieceBelow(game.tiles[a].square, slidTile);
		}
	}
}

/* ---------------------------------------------------------------- */
// Draw Slide Box
/* ---------------------------------------------------------------- */
/**
 * @description Draws a piece's image again on top of the frame (no shadow or reflection), facing the same way as on the board: this
 * move while sliding, else its last move, else its start side.
 * !NOTE: ON THE FRAME A SLIDE LANDS ITS ENTRY HAS ALREADY MOVED TO THE NEW SQUARE (moveObj.to), SO IT'S LOOKED UP THERE (landed) &
 * DRAWN AGAIN. THE BOARD DREW IT IN ITS OLD SQUARE'S TURN, SO WITHOUT THIS THE PIECES DRAWN AGAIN AROUND IT COVERED IT FOR A FRAME
 * @param  {[object]} pieceObj [tile of the piece to draw again]
 */
function drawSlideBox(pieceObj) {
	const pieceType = pieceObj.type;
	const pieceColor = pieceObj.color;
	if (pieceType.match(/[kqbr]/) && pieceColor) {
		if (pieceColor == "w") {
			const away = facesAway(parseList("w_piece", game.response.w_piece), pieceObj.square, "w", {
				viewColor: game.viewColor, slide: pieceObj.isSliding ? face() : null, landed: game.moveObj,
			});
			if (away !== null) {
				setPieceSprites("w", away);
				drawPieceOnTop(pieceObj, pieceType, pieceColor);
			}
		} else if (pieceColor == "b") {
			const away = facesAway(parseList("b_piece", game.response.b_piece), pieceObj.square, "b", {
				viewColor: game.viewColor, slide: pieceObj.isSliding ? face() : null, landed: game.moveObj,
			});
			if (away !== null) {
				setPieceSprites("b", away);
				drawPieceOnTop(pieceObj, pieceType, pieceColor);
			}
		}
	} else if (pieceType.match(/[n]/) && pieceColor) {
		handleKnightHop(pieceObj); // How high it is this frame (knightHop), up to half a square up while it's hopping
		if (pieceColor == "w") {
			const right = knightFacesRight(parseList("w_knight", game.response.w_knight), pieceObj.square, "w", {
				viewColor: game.viewColor, slide: pieceObj.isSliding ? face() : null, landed: game.moveObj,
			});
			if (right !== null) {
				setKnightSide("w", right ? 'right' : 'left');
				drawOnTop(game.wKnightImg, pieceObj, pieceObj.isSliding);
			}
		} else if (pieceColor == "b") {
			const right = knightFacesRight(parseList("b_knight", game.response.b_knight), pieceObj.square, "b", {
				viewColor: game.viewColor, slide: pieceObj.isSliding ? face() : null, landed: game.moveObj,
			});
			if (right !== null) {
				setKnightSide("b", right ? 'right' : 'left');
				drawOnTop(game.bKnightImg, pieceObj, pieceObj.isSliding);
			}
		}
	} else if (pieceType.match(/[p]/) && pieceColor) {
		handlePawnDirection(); // Pawns always face the other side
		if (pieceColor == "w") { drawOnTop(game.wPawnImg, pieceObj, false); }
		else if (pieceColor == "b") { drawOnTop(game.bPawnImg, pieceObj, false); }
	}
}

/**
 * @description Draws the king, queen, bishop or rook image again with the images the facing above picked. A bishop's image goes by
 * the color of its square
 */
function drawPieceOnTop(pieceObj, pieceType, pieceColor) {
	if (pieceType.match(/[k]/) && pieceColor) {
		if (pieceColor == "w") { drawOnTop(game.wKingImg, pieceObj, false); }
		else if (pieceColor == "b") { drawOnTop(game.bKingImg, pieceObj, false); }
	} else if (pieceType.match(/[q]/) && pieceColor) {
		if (pieceColor == "w") { drawOnTop(game.wQueenImg, pieceObj, false); }
		else if (pieceColor == "b") { drawOnTop(game.bQueenImg, pieceObj, false); }
	} else if (pieceType.match(/[b]/) && pieceColor) {
		if (pieceColor == "w") {
			if (chessInst.squareColor(pieceObj.square) == 'light') { drawOnTop(game.wBishopWhiteSqImg, pieceObj, false); }
			else if (chessInst.squareColor(pieceObj.square) == 'dark') { drawOnTop(game.wBishopBlackSqImg, pieceObj, false); }
		} else if (pieceColor == "b") {
			if (chessInst.squareColor(pieceObj.square) == 'light') { drawOnTop(game.bBishopWhiteSqImg, pieceObj, false); }
			else if (chessInst.squareColor(pieceObj.square) == 'dark') { drawOnTop(game.bBishopBlackSqImg, pieceObj, false); }
		}
	} else if (pieceType.match(/[r]/) && pieceColor) {
		if (pieceColor == "w") { drawOnTop(game.wRookImg, pieceObj, false); }
		else if (pieceColor == "b") { drawOnTop(game.bRookImg, pieceObj, false); }
	}
}

/**
 * @description Draws a piece's image over the frame where it is now, lifted by the hop when hop is set
 */
function drawOnTop(img, pieceObj, hop) {
	if (hop) { drawSprite(img, slideX(pieceObj), slideY(pieceObj) - (game.tileHeight / 2) * game.knightHop); }
	else { drawSprite(img, slideX(pieceObj), slideY(pieceObj)); }
}
