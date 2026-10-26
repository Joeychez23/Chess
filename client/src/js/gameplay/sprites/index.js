/*
 *  index.js  --  chess frontend
 *	Sprites
 *	Every image the game draws, in image number order, the list preloadImages() loads (gameplay/images/index.js),
 *	& the image numbers the game draws them by (wFrontKingImg = 5, ...), each one its url's index in SPRITES.
 *	Home & guest call preloadImages() too, so the game's images are already in the browser cache when a game opens
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const ASSETS = process.env.CHESS_ASSESTS_URL; // S3 / CLOUDFRONT

/* ---------------------------------------------------------------- */
// Sprites
/* ---------------------------------------------------------------- */
/**
 * @description Image urls, the index is the image number used to draw it (the image numbers below, wFrontKingImg = 5, ...)
 */
export const SPRITES = [
	// BOARD (0 - 4)
	`${ASSETS}/images/board/table.webp`,
	`${ASSETS}/images/board/table-shdw.png`,
	`${ASSETS}/images/board/chess-board.png`,
	`${ASSETS}/images/board/chess-board-shdw.webp`,
	`${ASSETS}/images/board/raw-board.png`, // BOARD WITHOUT THE WOOD BORDER, ONLY ITS SIZE IS USED (TO FIND THE SQUARES)
	// WHITE PIECES (5 - 12), BISHOPS ARE NAMED BY SQUARE COLOR (c1 DARK, f1 LIGHT), KNIGHTS BY FACING (b1 RIGHT, g1 LEFT)
	`${ASSETS}/images/white-pieces/wk-e1.png`,
	`${ASSETS}/images/white-pieces/wq-d1.png`,
	`${ASSETS}/images/white-pieces/wb-c1.png`,
	`${ASSETS}/images/white-pieces/wb-f1.png`,
	`${ASSETS}/images/white-pieces/wn-b1.png`,
	`${ASSETS}/images/white-pieces/wn-g1.png`,
	`${ASSETS}/images/white-pieces/wr-h1.png`,
	`${ASSETS}/images/white-pieces/wp-a2.png`,
	// WHITE SHADOWS (13 - 19)
	`${ASSETS}/images/white-pieces/wk-shdw.png`,
	`${ASSETS}/images/white-pieces/wq-shdw.png`,
	`${ASSETS}/images/white-pieces/wb-shdw.png`,
	`${ASSETS}/images/white-pieces/wn-b1-shdw.png`,
	`${ASSETS}/images/white-pieces/wn-g1-shdw.png`,
	`${ASSETS}/images/white-pieces/wr-shdw.png`,
	`${ASSETS}/images/white-pieces/wp-shdw.png`,
	// WHITE REFLECTIONS (20 - 26)
	`${ASSETS}/images/white-pieces/wk-refl.png`,
	`${ASSETS}/images/white-pieces/wq-refl.png`,
	`${ASSETS}/images/white-pieces/wb-refl.png`,
	`${ASSETS}/images/white-pieces/wn-b1-refl.png`,
	`${ASSETS}/images/white-pieces/wn-g1-refl.png`,
	`${ASSETS}/images/white-pieces/wr-refl.png`,
	`${ASSETS}/images/white-pieces/wp-refl.png`,
	// BLACK PIECES (27 - 34), f8 IS THE DARK SQUARE BISHOP, b8 KNIGHT FACES RIGHT, g8 LEFT
	`${ASSETS}/images/black-pieces/bk-e8.png`,
	`${ASSETS}/images/black-pieces/bq-d8.png`,
	`${ASSETS}/images/black-pieces/bb-f8.png`,
	`${ASSETS}/images/black-pieces/bb-c8.png`,
	`${ASSETS}/images/black-pieces/bn-b8.png`,
	`${ASSETS}/images/black-pieces/bn-g8.png`,
	`${ASSETS}/images/black-pieces/br-h8.png`,
	`${ASSETS}/images/black-pieces/bp-a7.png`,
	// BLACK SHADOWS (35 - 41)
	`${ASSETS}/images/black-pieces/bk-shdw.png`,
	`${ASSETS}/images/black-pieces/bq-shdw.png`,
	`${ASSETS}/images/black-pieces/bb-shdw.png`,
	`${ASSETS}/images/black-pieces/bn-b8-shdw.png`,
	`${ASSETS}/images/black-pieces/bn-g8-shdw.png`,
	`${ASSETS}/images/black-pieces/br-shdw.png`,
	`${ASSETS}/images/black-pieces/bp-shdw.png`,
	// BLACK REFLECTIONS (42 - 48)
	`${ASSETS}/images/black-pieces/bk-refl.png`,
	`${ASSETS}/images/black-pieces/bq-refl.png`,
	`${ASSETS}/images/black-pieces/bb-refl.png`,
	`${ASSETS}/images/black-pieces/bn-b8-refl.png`,
	`${ASSETS}/images/black-pieces/bn-g8-refl.png`,
	`${ASSETS}/images/black-pieces/br-refl.png`,
	`${ASSETS}/images/black-pieces/bp-refl.png`,
	// UI (49 - 51)
	`${ASSETS}/images/chess-ui/move-highlight.png`,
	`${ASSETS}/images/chess-ui/takeable-highlight.png`,
	`${ASSETS}/images/chess-ui/check-highlight.png`,
	// TABLE PROPS (52 - 57)
	`${ASSETS}/images/board/coffee.png`,
	`${ASSETS}/images/board/coffee-shdw.png`,
	`${ASSETS}/images/board/cards.png`,
	`${ASSETS}/images/board/cards-shdw.png`,
	`${ASSETS}/images/board/candle.png`,
	`${ASSETS}/images/board/candle-shdw.png`,
	// BACK VIEWS: KINGS, QUEENS, BISHOPS, ROOKS & PAWNS FACING AWAY FROM THE PLAYER
	// WHITE BACKS (58 - 61), SHADOWS (62 - 65), REFLECTIONS (66 - 69)
	`${ASSETS}/images/white-pieces/wk-back.png`,
	`${ASSETS}/images/white-pieces/wq-back.png`,
	`${ASSETS}/images/white-pieces/wb-back.png`,
	`${ASSETS}/images/white-pieces/wr-back.png`,
	`${ASSETS}/images/white-pieces/wk-back-shdw.png`,
	`${ASSETS}/images/white-pieces/wq-back-shdw.png`,
	`${ASSETS}/images/white-pieces/wb-back-shdw.png`,
	`${ASSETS}/images/white-pieces/wr-back-shdw.png`,
	`${ASSETS}/images/white-pieces/wk-back-refl.png`,
	`${ASSETS}/images/white-pieces/wq-back-refl.png`,
	`${ASSETS}/images/white-pieces/wb-back-refl.png`,
	`${ASSETS}/images/white-pieces/wr-back-refl.png`,
	// BLACK BACKS (70 - 73), SHADOWS (74 - 77), REFLECTIONS (78 - 81)
	`${ASSETS}/images/black-pieces/bk-back.png`,
	`${ASSETS}/images/black-pieces/bq-back.png`,
	`${ASSETS}/images/black-pieces/bb-back.png`,
	`${ASSETS}/images/black-pieces/br-back.png`,
	`${ASSETS}/images/black-pieces/bk-back-shdw.png`,
	`${ASSETS}/images/black-pieces/bq-back-shdw.png`,
	`${ASSETS}/images/black-pieces/bb-back-shdw.png`,
	`${ASSETS}/images/black-pieces/br-back-shdw.png`,
	`${ASSETS}/images/black-pieces/bk-back-refl.png`,
	`${ASSETS}/images/black-pieces/bq-back-refl.png`,
	`${ASSETS}/images/black-pieces/bb-back-refl.png`,
	`${ASSETS}/images/black-pieces/br-back-refl.png`,
	// PAWN BACKS: WHITE (82 - 84), BLACK (85 - 87)
	`${ASSETS}/images/white-pieces/wp-back.png`,
	`${ASSETS}/images/white-pieces/wp-back-shdw.png`,
	`${ASSETS}/images/white-pieces/wp-back-refl.png`,
	`${ASSETS}/images/black-pieces/bp-back.png`,
	`${ASSETS}/images/black-pieces/bp-back-shdw.png`,
	`${ASSETS}/images/black-pieces/bp-back-refl.png`,
];

/* ---------------------------------------------------------------- */
// Image Numbers
/* ---------------------------------------------------------------- */
/**
 * @description The image number of each sprite, its index in SPRITES above (& in images[], gameplay/images/index.js). The game draws images[number].image
 */
// !NOTE: IMAGE NUMBERS EQUALS INDEX USED TO CHECK IF ALL IMAGES ARE LOADING IN THE BACKGROUND
// EACH NUMBER IS THE IMAGE'S INDEX IN images[], SO IT HAS TO MATCH THE ORDER OF preloadImages()
// PIECES ARE DRAWN AS 3 LAYERS: REFLECTION (ON THE BOARD BELOW THE PIECE), SHADOW, THEN THE PIECE
// THE ONE OF EACH BEING DRAWN (FRONT OR BACK, RIGHT OR LEFT) IS ON game (game.wKingImg, ...), SET BY THE handle...Direction FUNCTIONS
// TABLE = 0
export const tableShdw = 1; // table-shdw.png

export const boardImg = 2; // chess-board.png
export const boardShdw = 3; // chess-board-shdw.webp
export const rawBoardImg = 4; // raw-board.png, ITS SIZE GIVES THE WOOD BORDER'S WIDTH

// WHITE IMAGES
export const wFrontKingImg = 5; // wk-e1.png, FACES THE PLAYER
export const wBackKingImg = 58; // wk-back.png, FACES AWAY
export const wFrontQueenImg = 6; // wq-d1.png
export const wBackQueenImg = 59; // wq-back.png
export const wFrontBishopBlackSqImg = 7; // wb-c1.png, BISHOP ON A DARK SQUARE
export const wFrontBishopWhiteSqImg = 8; // wb-f1.png, BISHOP ON A LIGHT SQUARE
export const wBackBishopImg = 60; // wb-back.png (BOTH SQUARE COLORS)
export const wRightKnightImg = 9; // wn-b1.png, FACES RIGHT
export const wLeftKnightImg = 10; // wn-g1.png, FACES LEFT
export const wFrontRookImg = 11; // wr-h1.png
export const wBackRookImg = 61; // wr-back.png
export const wFrontPawnImg = 12; // wp-a2.png, FACES THE PLAYER
export const wBackPawnImg = 82; // wp-back.png, FACES AWAY

// WHITE SHADOW
export const wFrontKingShdw = 13; // wk-shdw.png
export const wBackKingShdw = 62; // wk-back-shdw.png
export const wFrontQueenShdw = 14; // wq-shdw.png
export const wBackQueenShdw = 63; // wq-back-shdw.png
export const wFrontBishopShdw = 15; // wb-shdw.png (BOTH BISHOPS)
export const wBackBishopShdw = 64; // wb-back-shdw.png
export const wRightKnightShdw = 16; // wn-b1-shdw.png
export const wLeftKnightShdw = 17; // wn-g1-shdw.png
export const wFrontRookShdw = 18; // wr-shdw.png
export const wBackRookShdw = 65; // wr-back-shdw.png
export const wFrontPawnShdw = 19; // wp-shdw.png
export const wBackPawnShdw = 83; // wp-back-shdw.png

// WHITE REFLECT
export const wFrontKingRefl = 20; // wk-refl.png
export const wBackKingRefl = 66; // wk-back-refl.png
export const wFrontQueenRefl = 21; // wq-refl.png
export const wBackQueenRefl = 67; // wq-back-refl.png
export const wFrontBishopRefl = 22; // wb-refl.png (BOTH BISHOPS)
export const wBackBishopRefl = 68; // wb-back-refl.png
export const wRightKnightRefl = 23; // wn-b1-refl.png
export const wLeftKnightRefl = 24; // wn-g1-refl.png
export const wFrontRookRefl = 25; // wr-refl.png
export const wBackRookRefl = 69; // wr-back-refl.png
export const wFrontPawnRefl = 26; // wp-refl.png
export const wBackPawnRefl = 84; // wp-back-refl.png

// BLACK IMAGES
export const bFrontKingImg = 27; // bk-e8.png, FACES THE PLAYER (WHEN PLAYING WHITE)
export const bBackKingImg = 70; // bk-back.png, FACES AWAY
export const bFrontQueenImg = 28; // bq-d8.png
export const bBackQueenImg = 71; // bq-back.png
export const bFrontBishopBlackSqImg = 29; // bb-f8.png, BISHOP ON A DARK SQUARE
export const bFrontBishopWhiteSqImg = 30; // bb-c8.png, BISHOP ON A LIGHT SQUARE
export const bBackBishopImg = 72; // bb-back.png (BOTH SQUARE COLORS)
export const bRightKnightImg = 31; // bn-b8.png, FACES RIGHT
export const bLeftKnightImg = 32; // bn-g8.png, FACES LEFT
export const bFrontRookImg = 33; // br-h8.png
export const bBackRookImg = 73; // br-back.png
export const bFrontPawnImg = 34; // bp-a7.png, FACES THE PLAYER (WHEN PLAYING WHITE)
export const bBackPawnImg = 85; // bp-back.png, FACES AWAY

// BLACK SHADOW
export const bFrontKingShdw = 35; // bk-shdw.png
export const bBackKingShdw = 74; // bk-back-shdw.png
export const bFrontQueenShdw = 36; // bq-shdw.png
export const bBackQueenShdw = 75; // bq-back-shdw.png
export const bFrontBishopShdw = 37; // bb-shdw.png (BOTH BISHOPS)
export const bBackBishopShdw = 76; // bb-back-shdw.png

export const bRightKnightShdw = 38; // bn-b8-shdw.png
export const bLeftKnightShdw = 39; // bn-g8-shdw.png
export const bFrontRookShdw = 40; // br-shdw.png
export const bBackRookShdw = 77; // br-back-shdw.png
export const bFrontPawnShdw = 41; // bp-shdw.png
export const bBackPawnShdw = 86; // bp-back-shdw.png

// BLACK REFLECT
export const bFrontKingRefl = 42; // bk-refl.png
export const bBackKingRefl = 78; // bk-back-refl.png
export const bFrontQueenRefl = 43; // bq-refl.png
export const bBackQueenRefl = 79; // bq-back-refl.png
export const bFrontBishopRefl = 44; // bb-refl.png (BOTH BISHOPS)
export const bBackBishopRefl = 80; // bb-back-refl.png
export const bRightKnightRefl = 45; // bn-b8-refl.png
export const bLeftKnightRefl = 46; // bn-g8-refl.png
export const bFrontRookRefl = 47; // br-refl.png
export const bBackRookRefl = 81; // br-back-refl.png
export const bFrontPawnRefl = 48; // bp-refl.png
export const bBackPawnRefl = 87; // bp-back-refl.png

// UI
export const moveHighlight = 49; // move-highlight.png, A SQUARE THE SELECTED PIECE CAN MOVE TO
export const takeableHighlight = 50; // takeable-highlight.png, A MOVE THAT TAKES A PIECE
export const checkHighlight = 51; // check-highlight.png, UNDER A KING IN CHECK

// COFFEE = 52
// COFFEE SHDW = 53

// CARDS = 54
// CARDS SHDW = 55

// CANDLE = 56
// CANDLE SHDW = 57

// BACKS = 58 - 87 (SET UP WITH THE FRONTS ABOVE)
