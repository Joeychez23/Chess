// pieceSprites.js -- sets which sprite each piece type is drawn with (front / back, left / right)
const { game } = require("../state/index.js"); // THE GAME'S SHARED STATE
const {
 wFrontKingImg, wBackKingImg, wFrontQueenImg, wBackQueenImg, wFrontBishopBlackSqImg, wFrontBishopWhiteSqImg, wBackBishopImg, wRightKnightImg, wLeftKnightImg, wFrontRookImg, wBackRookImg, wFrontPawnImg, wBackPawnImg,
 wFrontKingShdw, wBackKingShdw, wFrontQueenShdw, wBackQueenShdw, wFrontBishopShdw, wBackBishopShdw, wRightKnightShdw, wLeftKnightShdw, wFrontRookShdw, wBackRookShdw, wFrontPawnShdw, wBackPawnShdw,
 wFrontKingRefl, wBackKingRefl, wFrontQueenRefl, wBackQueenRefl, wFrontBishopRefl, wBackBishopRefl, wRightKnightRefl, wLeftKnightRefl, wFrontRookRefl, wBackRookRefl, wFrontPawnRefl, wBackPawnRefl,
 bFrontKingImg, bBackKingImg, bFrontQueenImg, bBackQueenImg, bFrontBishopBlackSqImg, bFrontBishopWhiteSqImg, bBackBishopImg, bRightKnightImg, bLeftKnightImg, bFrontRookImg, bBackRookImg, bFrontPawnImg, bBackPawnImg,
 bFrontKingShdw, bBackKingShdw, bFrontQueenShdw, bBackQueenShdw, bFrontBishopShdw, bBackBishopShdw, bRightKnightShdw, bLeftKnightShdw, bFrontRookShdw, bBackRookShdw, bFrontPawnShdw, bBackPawnShdw,
 bFrontKingRefl, bBackKingRefl, bFrontQueenRefl, bBackQueenRefl, bFrontBishopRefl, bBackBishopRefl, bRightKnightRefl, bLeftKnightRefl, bFrontRookRefl, bBackRookRefl, bFrontPawnRefl, bBackPawnRefl
} = require("../sprites/index.js"); // IMAGE NUMBERS

/**
 * @description Points the knight's image, shadow, and reflection left or right.
 */
export function setKnightSide(color, side) {
	// SET THE SPRITES FOR THE KNIGHT'S STARTING SIDE
	if (color == "w" && side == "right") { game.wKnightImg = wRightKnightImg; game.wKnightShdw = wRightKnightShdw; game.wKnightRefl = wRightKnightRefl; }
	else if (color == "w") { game.wKnightImg = wLeftKnightImg; game.wKnightShdw = wLeftKnightShdw; game.wKnightRefl = wLeftKnightRefl; }
	else if (side == "right") { game.bKnightImg = bRightKnightImg; game.bKnightShdw = bRightKnightShdw; game.bKnightRefl = bRightKnightRefl; }
	else { game.bKnightImg = bLeftKnightImg; game.bKnightShdw = bLeftKnightShdw; game.bKnightRefl = bLeftKnightRefl; }
}

/**
 * @description Points one color's king, queen, bishop & rook images (game.wKingImg, ...) at their backs or their fronts
 * @param  {[string]} color ['w' | 'b']
 * @param  {[boolean]} back [true = backs (facing away from the player), false = fronts]
 */
export function setPieceSprites(color, back) {
	if (color == 'w' && back) {
		game.wKingImg = wBackKingImg; game.wKingShdw = wBackKingShdw; game.wKingRefl = wBackKingRefl;
		game.wQueenImg = wBackQueenImg; game.wQueenShdw = wBackQueenShdw; game.wQueenRefl = wBackQueenRefl;
		game.wBishopBlackSqImg = wBackBishopImg; game.wBishopWhiteSqImg = wBackBishopImg; game.wBishopShdw = wBackBishopShdw; game.wBishopRefl = wBackBishopRefl;
		game.wRookImg = wBackRookImg; game.wRookShdw = wBackRookShdw; game.wRookRefl = wBackRookRefl;
	} else if (color == 'w') {
		game.wKingImg = wFrontKingImg; game.wKingShdw = wFrontKingShdw; game.wKingRefl = wFrontKingRefl;
		game.wQueenImg = wFrontQueenImg; game.wQueenShdw = wFrontQueenShdw; game.wQueenRefl = wFrontQueenRefl;
		game.wBishopBlackSqImg = wFrontBishopBlackSqImg; game.wBishopWhiteSqImg = wFrontBishopWhiteSqImg; game.wBishopShdw = wFrontBishopShdw; game.wBishopRefl = wFrontBishopRefl;
		game.wRookImg = wFrontRookImg; game.wRookShdw = wFrontRookShdw; game.wRookRefl = wFrontRookRefl;
	} else if (back) {
		game.bKingImg = bBackKingImg; game.bKingShdw = bBackKingShdw; game.bKingRefl = bBackKingRefl;
		game.bQueenImg = bBackQueenImg; game.bQueenShdw = bBackQueenShdw; game.bQueenRefl = bBackQueenRefl;
		game.bBishopBlackSqImg = bBackBishopImg; game.bBishopWhiteSqImg = bBackBishopImg; game.bBishopShdw = bBackBishopShdw; game.bBishopRefl = bBackBishopRefl;
		game.bRookImg = bBackRookImg; game.bRookShdw = bBackRookShdw; game.bRookRefl = bBackRookRefl;
	} else {
		game.bKingImg = bFrontKingImg; game.bKingShdw = bFrontKingShdw; game.bKingRefl = bFrontKingRefl;
		game.bQueenImg = bFrontQueenImg; game.bQueenShdw = bFrontQueenShdw; game.bQueenRefl = bFrontQueenRefl;
		game.bBishopBlackSqImg = bFrontBishopBlackSqImg; game.bBishopWhiteSqImg = bFrontBishopWhiteSqImg; game.bBishopShdw = bFrontBishopShdw; game.bBishopRefl = bFrontBishopRefl;
		game.bRookImg = bFrontRookImg; game.bRookShdw = bFrontRookShdw; game.bRookRefl = bFrontRookRefl;
	}
}

/* ---------------------------------------------------------------- */
// Handle Pawn Direction
/* ---------------------------------------------------------------- */
/**
 * @description Pawns only move forward, so they always face the other side & nothing is saved in the database. Points the
 * pawn images (wPawnImg, wPawnShdw, wPawnRefl, bPawnImg, ...) away from the player for the player's own pawns (their backs)
 * & toward the player for the opponent's
 */
export function handlePawnDirection() {
	if (game.viewColor == 'w') { // WHITE PAWNS FACE BLACK'S SIDE (THE TOP OF THE BOARD), BLACK PAWNS FACE THE PLAYER
		game.wPawnImg = wBackPawnImg; game.wPawnShdw = wBackPawnShdw; game.wPawnRefl = wBackPawnRefl;
		game.bPawnImg = bFrontPawnImg; game.bPawnShdw = bFrontPawnShdw; game.bPawnRefl = bFrontPawnRefl;
	} else if (game.viewColor == 'b') { // FLIPPED BOARD: BLACK PAWNS FACE WHITE'S SIDE (THE TOP), WHITE PAWNS FACE THE PLAYER
		game.wPawnImg = wFrontPawnImg; game.wPawnShdw = wFrontPawnShdw; game.wPawnRefl = wFrontPawnRefl;
		game.bPawnImg = bBackPawnImg; game.bPawnShdw = bBackPawnShdw; game.bPawnRefl = bBackPawnRefl;
	}
}
