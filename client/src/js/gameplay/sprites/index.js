/*
 *  index.js  --  chess frontend
 *	Sprites
 *	Every image the game draws, in image number order (the same list preloadImages() loads in gameplay/index.js).
 *	Its own file so the pages without the game (home & guest) can warm the browser cache without loading gameplay
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
 * @description Image urls, the index is the image number used to draw it in renderCanvas (wFrontKingImg = 5, ...)
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
	// BACK VIEWS: KINGS, QUEENS, BISHOPS & ROOKS FACING AWAY FROM THE PLAYER
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
];
