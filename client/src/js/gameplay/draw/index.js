/*
 *  index.js  --  chess frontend
 *	Draw
 *	Draws each frame of the game (drawScreen, set by handleInitialData): the pieces row by row with their reflections & shadows,
 *	the selected piece's moves, a piece sliding or a knight hopping to its new square, the taken piece trays (the promotion picker
 *	while promoting) & which way each piece faces (the handle...Direction functions)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, ctx, chessInst } = require("../state/index.js"); // THE GAME'S SHARED STATE, THE CANVAS, THE BOARD THAT'S DRAWN
const { countStartPieces } = require("../utils/index.js"); // HOW MANY PIECES EACH SIDE STARTED WITH
const { images } = require("../images/index.js"); // THE LOADED IMAGES BY IMAGE NUMBER
const { renderBoard } = require("../layout/index.js"); // SIZES THE CANVAS & BOARD TO THE WINDOW & DRAWS THE TABLE & BOARD
const {
	tableShdw, // BOARD
	wFrontKingImg, wBackKingImg, wFrontQueenImg, wBackQueenImg, wFrontBishopBlackSqImg, wFrontBishopWhiteSqImg, wBackBishopImg, wRightKnightImg, wLeftKnightImg, wFrontRookImg, wBackRookImg, wFrontPawnImg, wBackPawnImg, // WHITE IMAGES
	wFrontKingShdw, wBackKingShdw, wFrontQueenShdw, wBackQueenShdw, wFrontBishopShdw, wBackBishopShdw, wRightKnightShdw, wLeftKnightShdw, wFrontRookShdw, wBackRookShdw, wFrontPawnShdw, wBackPawnShdw, // WHITE SHADOW
	wFrontKingRefl, wBackKingRefl, wFrontQueenRefl, wBackQueenRefl, wFrontBishopRefl, wBackBishopRefl, wRightKnightRefl, wLeftKnightRefl, wFrontRookRefl, wBackRookRefl, wFrontPawnRefl, wBackPawnRefl, // WHITE REFLECT
	bFrontKingImg, bBackKingImg, bFrontQueenImg, bBackQueenImg, bFrontBishopBlackSqImg, bFrontBishopWhiteSqImg, bBackBishopImg, bRightKnightImg, bLeftKnightImg, bFrontRookImg, bBackRookImg, bFrontPawnImg, bBackPawnImg, // BLACK IMAGES
	bFrontKingShdw, bBackKingShdw, bFrontQueenShdw, bBackQueenShdw, bFrontBishopShdw, bBackBishopShdw, bRightKnightShdw, bLeftKnightShdw, bFrontRookShdw, bBackRookShdw, bFrontPawnShdw, bBackPawnShdw, // BLACK SHADOW
	bFrontKingRefl, bBackKingRefl, bFrontQueenRefl, bBackQueenRefl, bFrontBishopRefl, bBackBishopRefl, bRightKnightRefl, bLeftKnightRefl, bFrontRookRefl, bBackRookRefl, bFrontPawnRefl, bBackPawnRefl, // BLACK REFLECT
	moveHighlight, takeableHighlight, checkHighlight // UI
} = require("../sprites/index.js"); // IMAGE NUMBERS, images[number].image IS THE IMAGE
const { handleKnightHop, stepSlide, KNIGHT_PAUSE_MS } = require("../animate/index.js"); // HOW HIGH A HOPPING KNIGHT IS, WHERE A SLIDING PIECE IS FROM THE TIME, HOW LONG A KNIGHT STOPS BEFORE ITS HOP
const { updateUserStateSlide, updateOpponentStateSlide } = require("../moves/index.js"); // A SLIDE LANDED: SENDS THE PLAYER'S MOVE, FINISHES THE OPPONENT'S

const DRAG_HOLD_MS = 120; // MOVING A HELD PIECE FOR LONGER THAN THIS MAKES IT A DRAG

let clickX; // PIXEL X OF tileX, A HELD PIECE IS DRAWN THERE
let clickY; // PIXEL Y OF tileY
let slidePos; // SQUARE THE SLIDING PIECE IS CROSSING (trackSlidePosition)
let knightPause = false; // TRUE FOR THE 100MS A KNIGHT STOPS BEFORE ITS HOP (currSlide IS OFF), SO A FRAME DRAWN THEN STILL PUTS IT ON TOP
let availableMoves; // LEGAL MOVES OF THE SELECTED PIECE (chess.js VERBOSE MOVES)
let currInst; // 8 x 8 BOARD FROM chessInst.board(), FLIPPED WHEN PLAYING BLACK
let xPos; // TAKEN PIECE TRAY COLUMN (renderTakenPieces)
let yPos; // TAKEN PIECE TRAY ROW
let overlapSlideObj = null; // THE 3 x 3 SQUARES AROUND A SLIDING PIECE (drawActivePiece), ONLY A HOPPING OR LANDED KNIGHT IS DRAWN AGAIN FROM IT (drawSlideBox)
let yPositive = false; // THE SLIDING PIECE IS GOING DOWN THE SCREEN
let xPositive = false; // THE SLIDING PIECE IS GOING RIGHT

/* ---------------------------------------------------------------- */
// Handle Initial Data Response
/* ---------------------------------------------------------------- */
/**
 * @description Sets drawScreen & gamedata based on player color. Each frame drawScreen() draws the table & board,
 * the pieces, the taken piece trays (the promotion picker while promoting), then a light table shadow over everything.
 * Black's board is flipped (rows & columns reversed) so the player is always at the bottom
 */
export function handleInitialData() {
	if (game.playerColor == "w") { // DRAW SCREEN W
		currInst = chessInst.board(); // ROW 0 IS RANK 8, COLUMN 0 IS THE a FILE
		game.drawScreen = async function () {
			const boardData = renderBoard();
			clickX = boardData.clickX;
			clickY = boardData.clickY;
			currInst = chessInst.board();
			overlapSlideObj = null
			renderPiecesToBoard(currInst, clickX, clickY, true);
			if (game.currPromotion) { // IF A USER PAWN PROMOTION IS ACTIVE
				if (game.playerColor == 'w') { game.bTakenPieces = setTakenPieceArr(game.playerColor); renderTakenPieces(game.bTakenPieces, game.opponentColor); }
				else if (game.playerColor == 'b') { game.wTakenPieces = setTakenPieceArr(game.playerColor); renderTakenPieces(game.wTakenPieces, game.opponentColor); }
			} else { // TAKEN PIECES SIT ON THE SIDE OF THE PLAYER WHO TOOK THEM
				game.wTakenPieces = setTakenPieceArr(game.playerColor);
				game.bTakenPieces = setTakenPieceArr(game.opponentColor);
				renderTakenPieces(game.wTakenPieces, game.opponentColor);
				renderTakenPieces(game.bTakenPieces, game.playerColor)
			}

			ctx.globalAlpha = 0.05
			ctx.drawImage(images[tableShdw].image, 0, 0, game.cw, game.ch); // RENDER TABLE SHDW
			ctx.globalAlpha = 1;
		}
	} else if (game.playerColor == "b") { // DRAW SCREEN B
		currInst = chessInst.board().reverse(); // ROW 0 IS RANK 1
		for (let i = currInst.length - 1; i >= 0; i--) { currInst[i] = currInst[i].reverse(); } // COLUMN 0 IS THE h FILE
		game.drawScreen = async function () {
			const boardData = renderBoard();
			clickX = boardData.clickX;
			clickY = boardData.clickY;
			currInst = chessInst.board().reverse();
			for (let i = currInst.length - 1; i >= 0; i--) { currInst[i] = currInst[i].reverse(); }
			overlapSlideObj = null
			renderPiecesToBoard(currInst, clickX, clickY, true);
			if (game.currPromotion) { // IF A USER PAWN PROMOTION IS ACTIVE
				if (game.playerColor == 'w') { game.bTakenPieces = setTakenPieceArr(game.playerColor); renderTakenPieces(game.bTakenPieces, game.opponentColor); }
				else if (game.playerColor == 'b') { game.wTakenPieces = setTakenPieceArr(game.playerColor); renderTakenPieces(game.wTakenPieces, game.opponentColor); }
			} else { // TAKEN PIECES SIT ON THE SIDE OF THE PLAYER WHO TOOK THEM
				game.wTakenPieces = setTakenPieceArr(game.opponentColor);
				game.bTakenPieces = setTakenPieceArr(game.playerColor);
				renderTakenPieces(game.wTakenPieces, game.playerColor);
				renderTakenPieces(game.bTakenPieces, game.opponentColor);
			}

			ctx.globalAlpha = 0.05
			ctx.drawImage(images[tableShdw].image, 0, 0, game.cw, game.ch); // RENDER TABLE SHDW
			ctx.globalAlpha = 1;
		}
	}
}

/* ---------------------------------------------------------------- */
// Renders Data Game Instance data
/* ---------------------------------------------------------------- */
/**
 * @param [inst] A object array which reperesents the current game board to be rendered
 * @description Renders game data based on input params. Goes through the board one square at a time (row by row,
 * index = row * 8 + column) & draws its piece: a held piece follows the mouse, a clicked piece sits lifted where it was
 * dropped, the rest sit on their square. Also draws the selected piece's legal moves & slides a moving piece toward its
 * new square. A sliding king, queen, bishop, rook or pawn is drawn once, in the turn of the first square after it (slideTurn),
 * & a hopping knight in the turn of the square it's over (hopTurn), not their start square's
 * @param  {[number]} clickX [pixel x of the square under the mouse, from renderBoard()]
 * @param  {[number]} clickY [pixel y of the square under the mouse]
 * @param  {[boolean]} lightObstruction [true draws the reflections & shadows]
 */
function renderPiecesToBoard(inst, clickX, clickY, lightObstruction) {
	let x, y; // WHERE THIS SQUARE'S PIECE IS DRAWN (PIXELS)
	let index = 0; // TILE BEING DRAWN, COUNTS UP WITH THE LOOP (THE FUNCTIONS BELOW READ IT)

	// MOVE THE SLIDING PIECE TO WHERE THE TIME SAYS IT IS, ONCE A FRAME BEFORE ANYTHING IS DRAWN
	for (let q = 0; q < game.tiles.length; q++) {
		if (game.tiles[q].isSliding) { stepSlide(game.tiles[q], q); }
	}

	// A HOPPING KNIGHT IS DRAWN IN THE TURN OF THE SQUARE IT'S OVER, NOT ITS START SQUARE, SO ITS REFLECTION & SHADOW GO UNDER THE PIECES
	// IN FRONT OF IT & OVER THE ONES BEHIND IT, LIKE A PIECE STANDING THERE (ITS IMAGE IS DRAWN AGAIN ON TOP AT THE END OF THE FRAME, drawSlideBox)
	// !NOTE: IN ITS START SQUARE'S TURN IT PAINTED ITS SHADOW OVER THE PAWNS IT JUMPED (DRAWN BEFORE IT) UNTIL IT LANDED, SO THEY FLASHED
	let hopTurn = null; // { index: THE KNIGHT'S TILE, square: TILE OF THE SQUARE IT'S OVER (row * 8 + column) }, null WHEN IT'S OVER ITS OWN
	for (let q = 0; q < game.tiles.length; q++) {
		if (game.tiles[q].isSliding && game.tiles[q].type == 'n' && (game.tiles[q].xDiff || game.tiles[q].yDiff)) {
			game.tiles[q].x = q % 8; // ITS START SQUARE, AS ITS OWN TURN SETS IT BELOW (THE CLICK THAT STARTED THE SLIDE LEFT x, y ON THE NEW SQUARE),
			game.tiles[q].y = Math.floor(q / 8); // SO IT'S RIGHT IF IT'S DRAWN BEFORE ITS OWN TURN (WITH REDUCE MOTION ITS FIRST FRAME ALREADY HOPS, #354)
			const row =Math.min(Math.max(Math.round(game.tiles[q].y - game.tiles[q].yDiff / game.tileHeight), 0), 7); // yDiff IS SUBTRACTED (UP THE SCREEN IS POSITIVE)
			const column = Math.min(Math.max(Math.round(game.tiles[q].x + game.tiles[q].xDiff / game.tileWidth), 0), 7);
			if (row * 8 + column != q) { hopTurn = { index: q, square: row * 8 + column }; }
			break;
		}
	}

	// A SLIDING KING, QUEEN, BISHOP, ROOK OR PAWN IS DRAWN ONCE, IN THE TURN OF THE FIRST SQUARE AFTER IT (PAINTER'S ORDER: LOWER ROWS IN FRONT,
	// FURTHER RIGHT OVER FURTHER LEFT), NOT ITS START SQUARE'S, SO EVERY REFLECTION, SHADOW & PIECE IS DRAWN EXACTLY ONCE A FRAME
	// !NOTE: DRAWING THE PIECES IN FRONT OF IT AGAIN AT THE END OF THE FRAME PUT THEM OVER THEIR RIGHT NEIGHBOUR'S SHADOW, SO THEY FLASHED (#239)
	let slideTurn = null; // { index: THE SLIDING TILE, sx, sy: WHERE IT'S DRAWN THIS FRAME (IN SQUARES), drawn: ALREADY DRAWN THIS FRAME }
	for (let q = 0; q < game.tiles.length; q++) {
		const tile = game.tiles[q];
		if (tile.isSliding && tile.type && tile.type.match(/[kqbrp]/)) {
			tile.x = q % 8; // ITS START SQUARE, AS ITS OWN TURN SETS IT BELOW (THE CLICK THAT STARTED THE SLIDE LEFT x, y ON THE NEW SQUARE),
			tile.y = Math.floor(q / 8); // SO IT'S RIGHT IF IT'S DRAWN BEFORE ITS OWN TURN (SLIDING UP OR LEFT)
			const sx = tile.x + tile.xDiff / game.tileWidth; // WHERE IT IS THIS FRAME (stepSlide ABOVE), yDiff IS SUBTRACTED (UP THE SCREEN IS POSITIVE)
			const sy = tile.y - tile.yDiff / game.tileHeight;
			slideTurn = { index: q, sx, sy, drawn: false };
			break;
		}
	}

	for (let i = 0; i < inst.length; i++) { // ROW
		for (let j = 0; j < inst[i].length; j++, index++) { // COLUMN
			game.tiles[index] = { ...inst[i][j], ...game.tiles[index], x: j, y: i }; // TILE[INDEX] = DECONSTRUCTED ARRAY OF CHESS BOARD ROW/COLUMN, TILE[INDEX] INIT VALUES, X, Y
			if (inst[i][j]) { // IF CURRENT INDEX OF A TILE EXISTS
				if (game.tiles[index].isMousedown) { // IF MOUSEDOWN SET PIECE TO MOUSE POSITION
					if (game.mouseDownTime === null) { game.mouseDownTime = performance.now(); } else if (performance.now() - game.mouseDownTime > DRAG_HOLD_MS) { game.tiles[index].isClicked = true; } // FRAMES ONLY COME WHILE IT MOVES: MOVED FOR LONG ENOUGH = A DRAG, THE CLICK HANDLER DROPS IT
					game.tiles[index].x = game.tileX;
					game.tiles[index].y = game.tileY;
					x = clickX + game.xBoardOff;
					y = clickY - game.tileHeight / 5 + game.yBoardOff; // LIFTED (A FIFTH OF A SQUARE UP)
				} else if (game.tiles[index].isClicked) { // IF CLICKED
					x = game.tiles[index].x * game.tileWidth + game.xBoardOff;
					y = game.tiles[index].y * game.tileHeight - game.tileHeight / 5 + game.yBoardOff; // LIFTED
				} else { // IF CLICKED IS FALSE SET PIECE BASED ON POSITION DEFINED BY FEN
					x = game.tiles[index].x * game.tileWidth + game.xBoardOff;
					y = game.tiles[index].y * game.tileHeight - game.tileHeight / 10 + game.yBoardOff; // RESTING PIECES SIT A TENTH OF A SQUARE UP SO THEIR BASE IS ON THE SQUARE
				}
			}

			/* ---------------------------------------------------------------- */
			// Check & Render Available Moves
			/* ---------------------------------------------------------------- */
			/**
			 * @description Renders Emply possible pieces moves & pressured piece moves. When this square is a legal move of the
			 * selected piece it gets a move highlight (a takeable highlight if the move takes a piece). If the held piece is over
			 * this square, the piece is drawn here as a preview
			 */
			function checkAvailableMoves() {
				/* ---------------------------------------------------------------- */
				// Draw Tiles (Available Moves)
				/* ---------------------------------------------------------------- */
				/**
				 * @description Draws Tiles to Canvas. Draws the held piece on the legal square under the mouse (the drop preview),
				 * knights face left while the mouse moves left, kings, queens, bishops & rooks face up or down the way they'd move.
				 * Counts the piece, the main loop skips it
				 * @param  {[object]} tile [the held tile]
				 * @param  {[string]} pieceType [chess.js type 'k', 'q', 'b', 'n', 'r', 'p']
				 * @param  {[string]} pieceColor ['w' | 'b']
				 * @param  {[number]} x [pixel x]
				 * @param  {[number]} y [pixel y]
				 */
				function drawTiles(tile, pieceType, pieceColor, x, y) {
					if (pieceType.match(/[kqbr]/) && pieceColor) { // CHECKS CURRENT INDEX FOR KING, QUEEN, BISHOP OR ROOK
						/* ---------------------------------------------------------------- */
						// Draw Piece (Draw Tiles)
						/* ---------------------------------------------------------------- */
						/**
						 * @description Draws the held king, queen, bishop or rook on the move under the mouse. The loops below pick the way it faces now,
						 * a move up or down the board turns it the way it would go
						 */
						function drawPiece() {
							if (tile.yAvailInt != tile.originY) { // UP OR DOWN: FACE THE WAY IT WOULD MOVE (SIDEWAYS FACES ITS LAST WAY)
								if (pieceColor == 'w') { handlePieceDirectionW(tile.originY, tile.yAvailInt); }
								else if (pieceColor == 'b') { handlePieceDirectionB(tile.originY, tile.yAvailInt); }
							}
							if (pieceType.match(/[k]/) && pieceColor) { // CHECKS CURRENT INDEX FOR KING
								if (pieceColor == "w") { drawActivePiece([game.wKingRefl, game.wKingShdw, game.wKingImg], x, y, false); game.wPieceCount.king++; }
								else if (pieceColor == "b") { drawActivePiece([game.bKingRefl, game.bKingShdw, game.bKingImg], x, y, false); game.bPieceCount.king++; }
							} else if (pieceType.match(/[q]/) && pieceColor) { // CHECKS CURRENT INDEX FOR QUEEN
								if (pieceColor == "w") { drawActivePiece([game.wQueenRefl, game.wQueenShdw, game.wQueenImg], x, y, false); game.wPieceCount.queen++; }
								else if (pieceColor == "b") { drawActivePiece([game.bQueenRefl, game.bQueenShdw, game.bQueenImg], x, y, false); game.bPieceCount.queen++; }
							} else if (pieceType.match(/[b]/) && pieceColor) { // CHECKS CURRENT INDEX FOR BISHOP
								if (pieceColor == "w") {
									if (chessInst.squareColor(tile.square) == 'light') { drawActivePiece([game.wBishopRefl, game.wBishopShdw, game.wBishopWhiteSqImg], x, y, false); game.wPieceCount.bishop++; }
									else if (chessInst.squareColor(tile.square) == 'dark') { drawActivePiece([game.wBishopRefl, game.wBishopShdw, game.wBishopBlackSqImg], x, y, false); game.wPieceCount.bishop++; }
								} else if (pieceColor == "b") {
									if (chessInst.squareColor(tile.square) == 'light') { drawActivePiece([game.bBishopRefl, game.bBishopShdw, game.bBishopWhiteSqImg], x, y, false); game.bPieceCount.bishop++; }
									else if (chessInst.squareColor(tile.square) == 'dark') { drawActivePiece([game.bBishopRefl, game.bBishopShdw, game.bBishopBlackSqImg], x, y, false); game.bPieceCount.bishop++; }
								}
							} else if (pieceType.match(/[r]/) && pieceColor) { // CHECKS CURRENT INDEX FOR ROOK
								if (pieceColor == "w") { drawActivePiece([game.wRookRefl, game.wRookShdw, game.wRookImg], x, y, false); game.wPieceCount.rook++; }
								else if (pieceColor == "b") { drawActivePiece([game.bRookRefl, game.bRookShdw, game.bRookImg], x, y, false); game.bPieceCount.rook++; }
							}
						}
						// THE WAY IT FACES NOW, SAME AS THE BOARD (w_piece / b_piece)
						if (pieceColor == "w") {
							let yFrom; // SCREEN ROW IT CAME FROM
							let yTo; // SCREEN ROW IT WENT TO
							for (let n = 0; n < JSON.parse(game.response.w_piece).length; n++) {
								if (JSON.parse(game.response.w_piece)[n].from && JSON.parse(game.response.w_piece)[n].to == tile.square) { // THIS PIECE HAS MOVED UP OR DOWN: FACE THE WAY ITS LAST ONE WENT
									if (game.playerColor == 'w') {
										yFrom = 8 - JSON.parse(game.response.w_piece)[n].from.split("")[1];
										yTo = 8 - JSON.parse(game.response.w_piece)[n].to.split("")[1];
									} else if (game.playerColor == 'b') { // FLIPPED BOARD: RANK 1 IS THE TOP ROW
										yFrom = JSON.parse(game.response.w_piece)[n].from.split("")[1] - 1;
										yTo = JSON.parse(game.response.w_piece)[n].to.split("")[1] - 1;
									}
									handlePieceDirectionW(yFrom, yTo);
									drawPiece();
									break;
								} else if (JSON.parse(game.response.w_piece)[n].from == null && JSON.parse(game.response.w_piece)[n].to == tile.square) { // HASN'T MOVED UP OR DOWN: FACES BLACK'S SIDE
									handlePieceDirectionW(null, null);
									drawPiece();
									break;
								}
							}
						} else if (pieceColor == "b") {
							let yFrom; // SCREEN ROW IT CAME FROM
							let yTo; // SCREEN ROW IT WENT TO
							for (let n = 0; n < JSON.parse(game.response.b_piece).length; n++) {
								if (JSON.parse(game.response.b_piece)[n].from && JSON.parse(game.response.b_piece)[n].to == tile.square) { // THIS PIECE HAS MOVED UP OR DOWN: FACE THE WAY ITS LAST ONE WENT
									if (game.playerColor == 'w') {
										yFrom = 8 - JSON.parse(game.response.b_piece)[n].from.split("")[1];
										yTo = 8 - JSON.parse(game.response.b_piece)[n].to.split("")[1];
									} else if (game.playerColor == 'b') { // FLIPPED BOARD: RANK 1 IS THE TOP ROW
										yFrom = JSON.parse(game.response.b_piece)[n].from.split("")[1] - 1;
										yTo = JSON.parse(game.response.b_piece)[n].to.split("")[1] - 1;
									}
									handlePieceDirectionB(yFrom, yTo);
									drawPiece();
									break;
								} else if (JSON.parse(game.response.b_piece)[n].from == null && JSON.parse(game.response.b_piece)[n].to == tile.square) { // HASN'T MOVED UP OR DOWN: FACES WHITE'S SIDE
									handlePieceDirectionB(null, null);
									drawPiece();
									break;
								}
							}
						}
					} else if (pieceType.match(/[n]/) && pieceColor) { // CHECKS CURRENT INDEX FOR KNIGHT
						if (pieceColor == "w") {
							if (game.tileX < tile.x && game.playerColor == pieceColor) { game.wKnightImg = wLeftKnightImg; game.wKnightShdw = wLeftKnightShdw; game.wKnightRefl = wLeftKnightRefl; drawActivePiece([game.wKnightRefl, game.wKnightShdw, game.wKnightImg], x, y, false); }
							else { game.wKnightImg = wRightKnightImg; game.wKnightShdw = wRightKnightShdw; game.wKnightRefl = wRightKnightRefl; drawActivePiece([game.wKnightRefl, game.wKnightShdw, game.wKnightImg], x, y, false); }
							game.wPieceCount.knight++;
						} else if (pieceColor == "b") {
							if (game.tileX < tile.x && game.playerColor == pieceColor) { game.bKnightImg = bLeftKnightImg; game.bKnightShdw = bLeftKnightShdw; game.bKnightRefl = bLeftKnightRefl; drawActivePiece([game.bKnightRefl, game.bKnightShdw, game.bKnightImg], x, y, false); }
							else { game.bKnightImg = bRightKnightImg; game.bKnightShdw = bRightKnightShdw; game.bKnightRefl = bRightKnightRefl; drawActivePiece([game.bKnightRefl, game.bKnightShdw, game.bKnightImg], x, y, false); }
							game.bPieceCount.knight++;
						}
					} else if (pieceType.match(/[p]/) && pieceColor) { // CHECKS CURRENT INDEX FOR PAWN
						handlePawnDirection(); // PAWNS ALWAYS FACE THE OTHER SIDE
						if (pieceColor == "w") { drawActivePiece([game.wPawnRefl, game.wPawnShdw, game.wPawnImg], x, y, false); game.wPieceCount.pawn++; }
						else if (pieceColor == "b") { drawActivePiece([game.bPawnRefl, game.bPawnShdw, game.bPawnImg], x, y, false); game.bPieceCount.pawn++; }
					}
				}

				if ((game.clickedTile || game.mousedownTile) && !game.currSlide) { // MOVES FOR PIECE TOGGLED BY USER
					let xLet;
					let piecePos; // THIS SQUARE'S NAME (e4)
					if (game.playerColor == 'w') {
						xLet = String.fromCharCode(97 + j);
						piecePos = `${xLet}${8 - i}`
					} else if (game.playerColor == 'b') { // FLIPPED BOARD
						xLet = String.fromCharCode(96 + (8 - j));
						piecePos = `${xLet}${i + 1}`
					}
					let tile; // THE SELECTED PIECE, A HELD PIECE COMES FIRST
					if (game.mousedownTile) { tile = game.mousedownTile }
					else if (game.clickedTile) { tile = game.clickedTile }

					if (game.availableMovesData.piece == tile.type && game.availableMovesData.square == tile.square) { } // SAME PIECE AS BEFORE, KEEP ITS MOVES
					else {
						game.availableMovesData = { piece: tile.type, square: tile.square }
						availableMoves = chessInst.moves({ piece: tile.type, square: tile.square, verbose: true });
					}
					for (let r = 0; r < availableMoves.length; r++) { // RENDER ALL POSSIBLE MOVES
						if (availableMoves[r].to == piecePos) { // THIS SQUARE IS A LEGAL MOVE
							let xAvailInt; // SCREEN COLUMN & ROW OF THE MOVE
							let yAvailInt;

							if (game.playerColor == 'w') {
								xAvailInt = availableMoves[r].to.split("")[0].charCodeAt(0) - 96 - 1;
								yAvailInt = 8 - availableMoves[r].to.split("")[1];
							} else if (game.playerColor == 'b') {
								xAvailInt = 8 - (availableMoves[r].to.split("")[0].charCodeAt(0) - 96);
								yAvailInt = availableMoves[r].to.split("")[1] - 1;
							}

							let availX = xAvailInt * game.tileWidth + game.xBoardOff;
							let availY = yAvailInt * game.tileHeight - game.tileHeight / 10 + game.yBoardOff;
							for (let a = 0; a < availableMoves.length; a++) { // CLEARS THE HELD PIECE'S PREVIEW SQUARE WHEN THE MOUSE ISN'T ON ANY LEGAL MOVE
								let xAvailInt;
								let yAvailInt;
								if (game.playerColor == 'w') {
									xAvailInt = availableMoves[a].to.split("")[0].charCodeAt(0) - 96 - 1;
									yAvailInt = 8 - availableMoves[a].to.split("")[1];
								} else if (game.playerColor == 'b') {
									xAvailInt = 8 - (availableMoves[a].to.split("")[0].charCodeAt(0) - 96);
									yAvailInt = availableMoves[a].to.split("")[1] - 1;
								}
								if (game.tileX == xAvailInt && game.tileY == yAvailInt && game.mousedownTile) { break }
								else if ((a + 1) == availableMoves.length) { tile.xAvailInt = null; tile.yAvailInt = null; }
							}
							if (availableMoves[r].san.lastIndexOf("x") != -1) { // RENDERS TILE WHICH CAN BE MOVE TO THAT TAKE AN OPPOSING PIECES
								ctx.globalAlpha = 0.50;
								ctx.drawImage(images[takeableHighlight].image, availX, availY, game.tileWidth, game.tileHeight);
								ctx.globalAlpha = 1.00;
								if (game.tileX == xAvailInt && game.tileY == yAvailInt && game.mousedownTile) { // THE HELD PIECE IS OVER THIS MOVE: DRAW IT HERE (PREVIEW)
									tile.xAvailInt = xAvailInt;
									tile.yAvailInt = yAvailInt;
									const pieceType = tile.type
									const pieceColor = tile.color;
									let x = xAvailInt * game.tileWidth + game.xBoardOff;
									let y = yAvailInt * game.tileHeight - game.tileHeight / 6 + game.yBoardOff;
									drawTiles(tile, pieceType, pieceColor, x, y);
								}
							} else { // RENDERS TILE WHICH CAN BE MOVED TO
								ctx.globalAlpha = 0.50;
								ctx.drawImage(images[moveHighlight].image, availX, availY, game.tileWidth, game.tileHeight);
								ctx.globalAlpha = 1.00;
								if (game.tileX == xAvailInt && game.tileY == yAvailInt && game.mousedownTile) { // THE HELD PIECE IS OVER THIS MOVE: DRAW IT HERE (PREVIEW)
									tile.xAvailInt = xAvailInt;
									tile.yAvailInt = yAvailInt;
									const pieceType = tile.type
									const pieceColor = tile.color;
									let x = xAvailInt * game.tileWidth + game.xBoardOff;
									let y = yAvailInt * game.tileHeight - game.tileHeight / 6 + game.yBoardOff;
									drawTiles(tile, pieceType, pieceColor, x, y);
								}
							}
						}
					}
				}
			}

			if (!game.currPromotion && !game.opposingMove) { checkAvailableMoves() } // ONLY ON THE PLAYER'S TURN


			/**
			 * @description Draws active piece to canvas: the reflection (30%), shadow (75%) & piece, in that order. Held, clicked
			 * & hovered pieces are a little see through. A sliding piece is drawn where the time says it is (stepSlide) & when it
			 * arrives the move is sent (the player's) or finished (the opponent's). Knights hop over the board while they slide.
			 * !NOTE: IT'S ASYNC & READS tiles[index], SO AFTER AN AWAIT index HAS MOVED ON & tiles MAY BE A NEW ARRAY (refreshData)
			 * @param  {[array]} imgArr [image numbers: reflection, shadow, piece]
			 * @param  {[number]} x [pixel x, when not sliding]
			 * @param  {[number]} y [pixel y, when not sliding]
			 * @param  {[boolean]} opacity [false = always solid (a clicked piece back on its own square, the drop preview)]
			 */
			async function drawActivePiece(imgArr, x, y, opacity) {
				let completeSlide = false; // THE SLIDE REACHED ITS SQUARE THIS FRAME
				for (let w = 0; w < imgArr.length; w++) { // w: 0 REFLECTION, 1 SHADOW, 2 PIECE
					if ((game.tiles[index].isMousedown || game.tiles[index].isClicked || game.tiles[index].isHovering) && opacity && !game.tiles[index].isSliding && !game.opposingMove) { ctx.globalAlpha = 0.85 }
					if (w == 0) { ctx.globalAlpha = 0.30 }
					else if (w == 1) { ctx.globalAlpha = 0.75 }
					if (game.tiles[index].isSliding) { // IF TILE IS SLIDING
						// IF Y IS NEGITIVE ITS UNDER THE OVER PIECE
						// IF Y IS POSITIVE ITS OVER THE UNDER PIECE
						let slideOverlap = true;

						/**
						 * @description Tracks the position of the piece that's sliding which allows for a rerender once all the pieces are rendered
						 * to the board. Sets slidePos (the square it's crossing, in white's file letters) & its direction (xPositive = right,
						 * yPositive = down). Only diagonal slides overlap other pieces, straight slides & rooks turn slideOverlap off
						 */
						function trackSlidePosition() {
							let xLet;
							let xChange = 0; // SCREEN COLUMN BEING CROSSED
							let yChange = 0; // SCREEN ROW BEING CROSSED
							yPositive = false
							xPositive = false
							if (game.tiles[index].type == 'r') { // ROOKS SKIP THE OVERLAP REDRAW
								slideOverlap = false;
							} else if (game.tiles[index].xSlideTo > game.tiles[index].x) {
								xPositive = true;
								// X IS GOING TO THE RIGHT
								if (game.tiles[index].ySlideTo > game.tiles[index].y) {
									// Y GOING DOWN THE BOARD
									let yTilesMoved = Math.floor(game.tiles[index].yDiff / game.tileHeight);
									let xTilesMoved = Math.floor(game.tiles[index].xDiff / game.tileWidth);
									xChange = game.tiles[index].x + xTilesMoved;
									yChange = game.tiles[index].y - yTilesMoved;
									xLet = String.fromCharCode(97 + xChange);
									slidePos = `${xLet}${9 - yChange}`
									yPositive = true;
								} else if (game.tiles[index].ySlideTo < game.tiles[index].y) {
									// Y GOING UP THE BOARD
									let yTilesMoved = Math.floor(game.tiles[index].yDiff / game.tileHeight + 0.001); // + 0.001: THE SNAP LEAVES IT A HAIR SHORT OF THE SQUARE (339.99 OF 340)
									let xTilesMoved = Math.floor(game.tiles[index].xDiff / game.tileWidth + 0.001);
									xChange = game.tiles[index].x + xTilesMoved; // THE SQUARE IT'S LEAVING, LIKE UP TO LEFT (WAS + 1 / - 1, THE SQUARE IT'S ENTERING,
									yChange = game.tiles[index].y - yTilesMoved; // SO THE PIECE BELOW THE SQUARE IT LEFT WASN'T DRAWN AGAIN & IT SLID OVER IT)
									xLet = String.fromCharCode(97 + xChange);
									slidePos = `${xLet}${8 - yChange}`
								} else { slideOverlap = false; }
							} else if ((game.tiles[index].xSlideTo < game.tiles[index].x)) {
								// X IS GOING TO THE LEFT
								if (game.tiles[index].ySlideTo > game.tiles[index].y) {
									// Y GOING DOWN THE BOARD
									let yTilesMoved = Math.floor(game.tiles[index].yDiff / game.tileHeight);
									let xTilesMoved = Math.floor(game.tiles[index].xDiff / game.tileWidth);
									xChange = game.tiles[index].x + xTilesMoved;
									yChange = game.tiles[index].y - yTilesMoved;
									xLet = String.fromCharCode(98 + xChange);
									slidePos = `${xLet}${9 - yChange}`
									yPositive = true;
								} else if (game.tiles[index].ySlideTo < game.tiles[index].y) {
									// Y GOING UP THE BOARD
									let yTilesMoved = Math.floor(game.tiles[index].yDiff / game.tileHeight + 0.001); // + 0.001: THE SNAP LEAVES IT A HAIR SHORT OF THE SQUARE
									let xTilesMoved = Math.ceil(game.tiles[index].xDiff / game.tileWidth - 0.001); // CEIL: ON A SQUARE (FIRST & LANDING FRAME) IT'S THAT SQUARE, NOT THE ONE TO ITS RIGHT
									xChange = game.tiles[index].x + xTilesMoved;
									yChange = game.tiles[index].y - yTilesMoved;
									xLet = String.fromCharCode(97 + xChange);
									slidePos = `${xLet}${8 - yChange}`
								} else {
									slideOverlap = false;
								}
							} else { slideOverlap = false; }
						}

						trackSlidePosition();


						try {
							// GET BOTH PIECES IN THE TILES ARRAY
							// overlapSlideObj = THE NAMES OF THE 3 x 3 SQUARES AROUND slidePos (y2x2 IS THE SLIDING PIECE'S OWN SQUARE),
							// drawSlideBox() REDRAWS THE PIECES ON THEM THAT SHOULD BE IN FRONT OF THE SLIDING PIECE
							if (slideOverlap && slidePos) {
								let xPos; // FILE NUMBER OF slidePos (a = 0)
								let yPos; // RANK OF slidePos
								let y1x1, y1x2, y1x3, y2x1, y2x2, y2x3, y3x1, y3x2, y3x3 = null;

								if (game.playerColor == 'w') {
									xPos = slidePos.split("")[0].charCodeAt(0) - 97;
									yPos = Number(slidePos.split("")[1])

									// X1  = x - 1
									// X2  = x
									// X3 = x + 1

									// Y1 = y - 1
									if (((xPos - 1) >= 0 && (xPos - 1) <= 8 && (yPos - 1) >= 0 && (yPos - 1) <= 8) && (`${String.fromCharCode(97 + (xPos - 1))}${yPos - 1}` != game.tiles[index].square)) { y1x1 = `${String.fromCharCode(97 + (xPos - 1))}${yPos - 1}` }
									if (((xPos) >= 0 && (xPos) <= 8 && (yPos - 1) >= 0 && (yPos - 1) <= 8) && (`${String.fromCharCode(97 + (xPos))}${yPos - 1}` != game.tiles[index].square)) { y1x2 = `${String.fromCharCode(97 + (xPos))}${yPos - 1}` }
									if (((xPos + 1) >= 0 && (xPos + 1) <= 8 && (yPos - 1) >= 0 && (yPos - 1) <= 8) && (`${String.fromCharCode(97 + (xPos + 1))}${yPos - 1}` != game.tiles[index].square)) { y1x3 = `${String.fromCharCode(97 + (xPos + 1))}${yPos - 1}` }

									// Y2 = y
									if (((xPos - 1) >= 0 && (xPos - 1) <= 8 && (yPos) >= 0 && (yPos) <= 8) && (`${String.fromCharCode(97 + (xPos - 1))}${yPos}` != game.tiles[index].square)) { y2x1 = `${String.fromCharCode(97 + (xPos - 1))}${yPos}` }
									if ((xPos) >= 0 && (xPos) <= 8 && (yPos) >= 0 && (yPos) <= 8) { y2x2 = game.tiles[index].square }
									if (((xPos + 1) >= 0 && (xPos + 1) <= 8 && (yPos) >= 0 && (yPos) <= 8) && (`${String.fromCharCode(97 + (xPos + 1))}${yPos}` != game.tiles[index].square)) { y2x3 = `${String.fromCharCode(97 + (xPos + 1))}${yPos}` }
									// Y3 = y + 1
									if (((xPos - 1) >= 0 && (xPos - 1) <= 8 && (yPos + 1) >= 0 && (yPos + 1) <= 8) && (`${String.fromCharCode(97 + (xPos - 1))}${yPos + 1}` != game.tiles[index].square)) { y3x1 = `${String.fromCharCode(97 + (xPos - 1))}${yPos + 1}` }
									if (((xPos) >= 0 && (xPos) <= 8 && (yPos + 1) >= 0 && (yPos + 1) <= 8) && (`${String.fromCharCode(97 + (xPos))}${yPos + 1}` != game.tiles[index].square)) { y3x2 = `${String.fromCharCode(97 + (xPos))}${yPos + 1}` }
									if (((xPos + 1) >= 0 && (xPos + 1) <= 8 && (yPos + 1) >= 0 && (yPos + 1) <= 8) && (`${String.fromCharCode(97 + (xPos + 1))}${yPos + 1}` != game.tiles[index].square)) { y3x3 = `${String.fromCharCode(97 + (xPos + 1))}${yPos + 1}` }

									overlapSlideObj = { y1x1, y1x2, y1x3, y2x1, y2x2, y2x3, y3x1, y3x2, y3x3 }
								}

								else if (game.playerColor == 'b') { // FLIPPED BOARD: TURN slidePos (WHITE'S LETTERS) INTO BLACK'S SQUARE NAMES
									xPos = (8 - (slidePos.split("")[0].charCodeAt(0) - 97))
									yPos = 9 - Number(slidePos.split("")[1])

									// X1  = x
									// X2  = x - 1
									// X3 = x - 2

									// Y1 = y - 1
									if (((xPos) >= 0 && (xPos) <= 8 && (yPos - 1) >= 0 && (yPos - 1) <= 8) && (`${String.fromCharCode(97 + (xPos))}${yPos - 1}` != game.tiles[index].square)) { y1x1 = `${String.fromCharCode(97 + (xPos))}${yPos - 1}` }
									if (((xPos - 1) >= 0 && (xPos - 1) <= 8 && (yPos - 1) >= 0 && (yPos - 1) <= 8) && (`${String.fromCharCode(97 + (xPos - 1))}${yPos - 1}` != game.tiles[index].square)) { y1x2 = `${String.fromCharCode(97 + (xPos - 1))}${yPos - 1}` }
									if (((xPos - 2) >= 0 && (xPos - 2) <= 8 && (yPos - 1) >= 0 && (yPos - 1) <= 8) && (`${String.fromCharCode(97 + (xPos - 2))}${yPos - 1}` != game.tiles[index].square)) { y1x3 = `${String.fromCharCode(97 + (xPos - 2))}${yPos - 1}` }

									// Y2 = y
									if (((xPos) >= 0 && (xPos) <= 8 && (yPos) >= 0 && (yPos) <= 8) && (`${String.fromCharCode(97 + (xPos))}${yPos}` != game.tiles[index].square)) { y2x1 = `${String.fromCharCode(97 + (xPos))}${yPos}` }
									if ((xPos - 1) >= 0 && (xPos - 1) <= 8 && (yPos) >= 0 && (yPos) <= 8) { y2x2 = game.tiles[index].square }
									if (((xPos - 2) >= 0 && (xPos - 2) <= 8 && (yPos) >= 0 && (yPos) <= 8) && (`${String.fromCharCode(97 + (xPos - 2))}${yPos}` != game.tiles[index].square)) { y2x3 = `${String.fromCharCode(97 + (xPos - 2))}${yPos}` }

									// Y3 = y + 1
									if (((xPos) >= 0 && (xPos) <= 8 && (yPos + 1) >= 0 && (yPos + 1) <= 8) && (`${String.fromCharCode(97 + (xPos))}${yPos + 1}` != game.tiles[index].square)) { y3x1 = `${String.fromCharCode(97 + (xPos))}${yPos + 1}` }
									if (((xPos - 1) >= 0 && (xPos - 1) <= 8 && (yPos + 1) >= 0 && (yPos + 1) <= 8) && (`${String.fromCharCode(97 + (xPos - 1))}${yPos + 1}` != game.tiles[index].square)) { y3x2 = `${String.fromCharCode(97 + (xPos - 1))}${yPos + 1}` }
									if (((xPos - 2) >= 0 && (xPos - 2) <= 8 && (yPos + 1) >= 0 && (yPos + 1) <= 8) && (`${String.fromCharCode(97 + (xPos - 2))}${yPos + 1}` != game.tiles[index].square)) { y3x3 = `${String.fromCharCode(97 + (xPos - 2))}${yPos + 1}` }

									overlapSlideObj = { y1x1, y1x2, y1x3, y2x1, y2x2, y2x3, y3x1, y3x2, y3x3 }
								}
							}

							if (game.tiles[index].slideProgress == 1) { completeSlide = true; } // ARRIVED (stepSlide)

							if (game.tiles[index].type.match(/[n]/)) { // KNIGHT SLIDE
								handleKnightHop(game.tiles[index]); // HOW HIGH IT IS THIS FRAME (knightHop)
								if ((w == 0 || w == 1) && lightObstruction) { // REFLECTION & SHADOW STAY ON THE BOARD, SHIFTED UP TO A FIFTH OF A SQUARE LEFT AS IT RISES
									ctx.drawImage(images[imgArr[w]].image, ((((game.tiles[index].x * game.tileWidth) + game.tiles[index].xDiff) + game.xBoardOff) - game.xPieceOffset / 2) - (game.tileWidth / 5) * game.knightHop, (((((game.tiles[index].y * game.tileHeight) - game.tiles[index].yDiff) - game.tileHeight / 10) + game.yBoardOff) - game.yPieceOffset / 2), game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset)
								} // DRAW SHADOW OF KNIGHT
								else if (w == 2) { // DRAW PIECE, UP TO HALF A SQUARE UP WHILE IT HOPS
									if (game.slideStart == true) { // FIRST FRAME: LIFT THE KNIGHT & PAUSE 100MS
										ctx.drawImage(images[imgArr[w]].image, (((game.tiles[index].x * game.tileWidth) + game.tiles[index].xDiff) + game.xBoardOff) - game.xPieceOffset / 2, (((((game.tiles[index].y * game.tileHeight) - game.tiles[index].yDiff) - game.tileHeight / 10) + game.yBoardOff) - game.yPieceOffset / 2) - (game.tileHeight / 2) * game.knightHop, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset); // DRAW KNIGHT AS WITH STOP
										game.currSlide = false; // SO THE TIMEOUT STOPS THE ANIMATION
										knightPause = true; // THE END OF THE FRAME STILL DRAWS IT ON TOP (currSlide IS OFF NOW, IT WAS HELD UNDER THE PIECES IN FRONT FOR 100MS)
										game.slideStart = false;
										const knightIndex = index; // index MOVES ON WITH THE FRAME
										setTimeout(function () { knightPause = false; if (game.tiles[knightIndex].isSliding) { game.currSlide = true; } }, KNIGHT_PAUSE_MS) // SO THE TIMEOUT RESTARTS THE ANIMATION (UNLESS IT ALREADY LANDED: A HIDDEN TAB'S TIMERS RUN LATE)
									} else {
										if (completeSlide) { // LANDED: DRAW IT ON THE SQUARE & FINISH THE MOVE
											game.tiles[index].isSliding = null;
											overlapSlideObj = null; // SO THE END OF THE FRAME USES THE LANDED REDRAW (IN FRONT OF & BEHIND THE RIGHT PIECES), NOT THE HOP'S (ON TOP OF EVERYTHING)
											ctx.drawImage(images[imgArr[w]].image, (((game.tiles[index].x * game.tileWidth) + game.tiles[index].xDiff) + game.xBoardOff) - game.xPieceOffset / 2, (((((game.tiles[index].y * game.tileHeight) - game.tiles[index].yDiff) - game.tileHeight / 10) + game.yBoardOff) - game.yPieceOffset / 2), game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset)
											if (game.tiles[index].color == game.playerColor) {
												await updateUserStateSlide(index); // SENDS THE PLAYER'S MOVE
											}
											else if (game.tiles[index].color == game.opponentColor) {
												await updateOpponentStateSlide(index); // FINISHES THE OPPONENT'S MOVE
											}
										} else { // IN THE AIR
											if (game.knightHop == 0) { overlapSlideObj = null; } // ON ITS NEW SQUARE (THE FRAME BEFORE IT LANDS): DRAWN AGAIN LIKE A LANDED PIECE AT THE END OF THE FRAME, NOT ON TOP
											ctx.drawImage(images[imgArr[w]].image, (((game.tiles[index].x * game.tileWidth) + game.tiles[index].xDiff) + game.xBoardOff) - game.xPieceOffset / 2, (((((game.tiles[index].y * game.tileHeight) - game.tiles[index].yDiff) - game.tileHeight / 10) + game.yBoardOff) - game.yPieceOffset / 2) - (game.tileHeight / 2) * game.knightHop, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset);
										}
									} // DRAW KNIGHT AS USUAL
								}
							} else {
								if ((w == 0 || w == 1) && lightObstruction) {
									ctx.drawImage(images[imgArr[w]].image, (((game.tiles[index].x * game.tileWidth) + game.tiles[index].xDiff) + game.xBoardOff) - game.xPieceOffset / 2, ((((game.tiles[index].y * game.tileHeight) - game.tiles[index].yDiff) - game.tileHeight / 10) + game.yBoardOff) - game.yPieceOffset / 2, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset)
								} else if (w == 2) {
									ctx.drawImage(images[imgArr[w]].image, (((game.tiles[index].x * game.tileWidth) + game.tiles[index].xDiff) + game.xBoardOff) - game.xPieceOffset / 2, ((((game.tiles[index].y * game.tileHeight) - game.tiles[index].yDiff) - game.tileHeight / 10) + game.yBoardOff) - game.yPieceOffset / 2, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset);
									if (completeSlide) { // ARRIVED: FINISH THE MOVE
										game.tiles[index].isSliding = null;
										if (game.tiles[index].color == game.playerColor) {
											await updateUserStateSlide(index); // SENDS THE PLAYER'S MOVE
										}
										else if (game.tiles[index].color == game.opponentColor) {
											await updateOpponentStateSlide(index); // FINISHES THE OPPONENT'S MOVE
										}
									}
								}
							}

						} catch { return; }
					}
					else {
						if ((w == 0 || w == 1) && lightObstruction) {
							ctx.drawImage(images[imgArr[w]].image, x - game.xPieceOffset / 2, y - game.yPieceOffset / 2, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset)
						} else if (w == 2) {
							ctx.drawImage(images[imgArr[w]].image, x - game.xPieceOffset / 2, y - game.yPieceOffset / 2, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset)
						}
					} // DRAWING IMAGE WITH SLIDING FALSE
					if (((game.tiles[index]?.isMousedown || null || game.tiles[index]?.isClicked || null || game.tiles[index]?.isHovering || null) && opacity && !game.tiles[index]?.isSliding || null) || w == 0 || w == 1) { ctx.globalAlpha = 1 } // BACK TO SOLID FOR THE NEXT LAYER
				}
			}

			/* ---------------------------------------------------------------- */
			// Draw Hopping Knight
			/* ---------------------------------------------------------------- */
			/**
			 * @description Draws the hopping knight in this square's turn, before this square's piece (it's over this square, hopTurn),
			 * facing the way this move goes like Draw Knight (Draw Screen). index is the knight's tile while it draws (drawActivePiece reads it)
			 */
			function drawHoppingKnight() {
				const squareIndex = index; // THIS SQUARE'S TILE
				index = hopTurn.index;
				let xFrom = game.moveObj.from.split("")[0].charCodeAt(0) - 96 - 1; // FILE IT CAME FROM (a = 0)
				let xTo = game.moveObj.to.split("")[0].charCodeAt(0) - 96 - 1; // FILE IT'S GOING TO
				if (game.tiles[index].color == 'w') { // SAME FOR BOTH COLORS, handleKnightDirectionW FLIPS ITS TEST FOR BLACK
					handleKnightDirectionW(xFrom, xTo);
					drawActivePiece([game.wKnightRefl, game.wKnightShdw, game.wKnightImg], x, y, false);
				} else if (game.tiles[index].color == 'b') {
					if (game.playerColor == 'b') { xFrom = 7 - xFrom; xTo = 7 - xTo; } // FLIPPED COLUMNS, SO handleKnightDirectionB USES ONE TEST FOR BOTH
					handleKnightDirectionB(xFrom, xTo);
					drawActivePiece([game.bKnightRefl, game.bKnightShdw, game.bKnightImg], x, y, false);
				}
				index = squareIndex;
			}
			if (hopTurn && hopTurn.square == index) { drawHoppingKnight(); } // THE HOPPING KNIGHT IS OVER THIS SQUARE: UNDER THIS SQUARE'S PIECE & THE ONES AFTER IT

			/* ---------------------------------------------------------------- */
			// Draw Board Piece
			/* ---------------------------------------------------------------- */
			/**
			 * @description Draws the king, queen, bishop, rook or pawn on tile index with its reflection & shadow (drawActivePiece), facing
			 * the way the server's piece list says. Used in its own square's turn & for a sliding piece in the turn of the square after it (slideTurn)
			 * @param  {[string]} pieceType [k | q | b | r | p]
			 * @param  {[string]} pieceColor [w | b]
			 * @param  {[boolean]} opacity [false = always solid (a clicked piece back on its own square)]
			 */
			function drawBoardPiece(pieceType, pieceColor, opacity) {
				if (pieceType.match(/[kqbr]/) && pieceColor) { // CHECKS CURRENT INDEX FOR KING, QUEEN, BISHOP OR ROOK
					/* ---------------------------------------------------------------- */
					// Draw Piece (Draw Screen)
					/* ---------------------------------------------------------------- */
					/**
					 * @description Draws the king, queen, bishop or rook to the board with the images the loops below picked (handlePieceDirectionW / B).
					 * While the player holds their piece it faces the way it's dragged (up or down from its square)
					 */
					function drawPiece() {
						if (game.tiles[index].isMousedown && game.tiles[index].y != game.tiles[index].originY && game.playerColor == pieceColor) { // HELD: FACE THE WAY IT'S DRAGGED (UP OR DOWN)
							if (pieceColor == 'w') { handlePieceDirectionW(game.tiles[index].originY, game.tiles[index].y); }
							else if (pieceColor == 'b') { handlePieceDirectionB(game.tiles[index].originY, game.tiles[index].y); }
						}
						if (pieceType.match(/[k]/) && pieceColor) { // CHECKS CURRENT INDEX FOR KING
							if (pieceColor == "w") {
								if (chessInst.isCheck() && pieceColor == chessInst.turn()) { // CHECK HIGHLIGHT UNDER THE KING IN CHECK
									ctx.globalAlpha = 0.70;
									ctx.drawImage(images[checkHighlight].image, (game.tiles[index].x * game.tileWidth + game.xBoardOff) + ((game.tileWidth * 0.0243) / 2), (game.tiles[index].y * game.tileHeight - game.tileHeight / 10 + game.yBoardOff) + ((game.tileHeight * 0.1034) / 2), game.tileWidth, game.tileHeight);
									ctx.globalAlpha = 1.00;
								}
								drawActivePiece([game.wKingRefl, game.wKingShdw, game.wKingImg], x, y, opacity);
								game.wPieceCount.king++;
							}
							else if (pieceColor == "b") {
								if (chessInst.isCheck() && pieceColor == chessInst.turn()) { // CHECK HIGHLIGHT UNDER THE KING IN CHECK
									ctx.globalAlpha = 0.70;
									ctx.drawImage(images[checkHighlight].image, (game.tiles[index].x * game.tileWidth + game.xBoardOff) + ((game.tileWidth * 0.0243) / 2), (game.tiles[index].y * game.tileHeight - game.tileHeight / 10 + game.yBoardOff) + ((game.tileHeight * 0.1034) / 2), game.tileWidth, game.tileHeight);
									ctx.globalAlpha = 1.00;
								}
								drawActivePiece([game.bKingRefl, game.bKingShdw, game.bKingImg], x, y, opacity);
								game.bPieceCount.king++;
							}
						} else if (pieceType.match(/[q]/) && pieceColor) { // CHECKS CURRENT INDEX FOR QUEEN
							if (pieceColor == "w") { drawActivePiece([game.wQueenRefl, game.wQueenShdw, game.wQueenImg], x, y, opacity); game.wPieceCount.queen++; }
							else if (pieceColor == "b") { drawActivePiece([game.bQueenRefl, game.bQueenShdw, game.bQueenImg], x, y, opacity); game.bPieceCount.queen++; }
						} else if (pieceType.match(/[b]/) && pieceColor) { // CHECKS CURRENT INDEX FOR BISHOP
							if (pieceColor == "w") { // THE IMAGE GOES BY THE COLOR OF THE BISHOP'S SQUARE
								if (chessInst.squareColor(game.tiles[index].square) == 'light') { drawActivePiece([game.wBishopRefl, game.wBishopShdw, game.wBishopWhiteSqImg], x, y, opacity); game.wPieceCount.bishop++; }
								else if (chessInst.squareColor(game.tiles[index].square) == 'dark') { drawActivePiece([game.wBishopRefl, game.wBishopShdw, game.wBishopBlackSqImg], x, y, opacity); game.wPieceCount.bishop++; }
							} else if (pieceColor == "b") {
								if (chessInst.squareColor(game.tiles[index].square) == 'light') { drawActivePiece([game.bBishopRefl, game.bBishopShdw, game.bBishopWhiteSqImg], x, y, opacity); game.bPieceCount.bishop++; }
								else if (chessInst.squareColor(game.tiles[index].square) == 'dark') { drawActivePiece([game.bBishopRefl, game.bBishopShdw, game.bBishopBlackSqImg], x, y, opacity); game.bPieceCount.bishop++; }
							}
						} else if (pieceType.match(/[r]/) && pieceColor) { // CHECKS CURRENT INDEX FOR ROOK
							if (pieceColor == "w") { drawActivePiece([game.wRookRefl, game.wRookShdw, game.wRookImg], x, y, opacity); game.wPieceCount.rook++; }
							else if (pieceColor == "b") { drawActivePiece([game.bRookRefl, game.bRookShdw, game.bRookImg], x, y, opacity); game.bPieceCount.rook++; }
						}
					}
					// WHICH WAY A KING, QUEEN, BISHOP OR ROOK FACES COMES FROM THE SERVER'S PIECE LIST (w_piece / b_piece):
					// { from, to } OF EACH ONE'S LAST MOVE UP OR DOWN (A SIDEWAYS MOVE ONLY CHANGES to), from IS null BEFORE IT HAS ONE
					// & BOTH ARE null ONCE IT'S TAKEN
					if (pieceColor == "w") {
						let yFrom; // SCREEN ROW IT CAME FROM
						let yTo; // SCREEN ROW IT WENT TO
						for (let n = 0; n < JSON.parse(game.response.w_piece).length; n++) {
							if (game.tiles[index].isSliding && game.moveObj.from.split("")[1] != game.moveObj.to.split("")[1]) { // SLIDING UP OR DOWN: FACE THE WAY THIS MOVE GOES (SIDEWAYS FACES ITS LAST WAY, BELOW)
								if (game.playerColor == 'w') {
									yFrom = 8 - game.moveObj.from.split("")[1];
									yTo = 8 - game.moveObj.to.split("")[1];
								} else if (game.playerColor == 'b') { // FLIPPED BOARD: RANK 1 IS THE TOP ROW
									yFrom = game.moveObj.from.split("")[1] - 1;
									yTo = game.moveObj.to.split("")[1] - 1;
								}
								handlePieceDirectionW(yFrom, yTo);
								drawPiece();
								break;
							} else if (JSON.parse(game.response.w_piece)[n].from && JSON.parse(game.response.w_piece)[n].to == game.tiles[index].square) { // THIS PIECE HAS MOVED UP OR DOWN: FACE THE WAY ITS LAST ONE WENT
								if (game.playerColor == 'w') {
									yFrom = 8 - JSON.parse(game.response.w_piece)[n].from.split("")[1];
									yTo = 8 - JSON.parse(game.response.w_piece)[n].to.split("")[1];
								} else if (game.playerColor == 'b') { // FLIPPED BOARD: RANK 1 IS THE TOP ROW
									yFrom = JSON.parse(game.response.w_piece)[n].from.split("")[1] - 1;
									yTo = JSON.parse(game.response.w_piece)[n].to.split("")[1] - 1;
								}
								handlePieceDirectionW(yFrom, yTo);
								drawPiece();
								break;
							} else if (JSON.parse(game.response.w_piece)[n].from == null && JSON.parse(game.response.w_piece)[n].to == game.tiles[index].square) { // HASN'T MOVED UP OR DOWN: FACES BLACK'S SIDE
								handlePieceDirectionW(null, null);
								drawPiece();
								break;
							}
						}
					} else if (pieceColor == "b") {
						let yFrom; // SCREEN ROW IT CAME FROM
						let yTo; // SCREEN ROW IT WENT TO
						for (let n = 0; n < JSON.parse(game.response.b_piece).length; n++) {
							if (game.tiles[index].isSliding && game.moveObj.from.split("")[1] != game.moveObj.to.split("")[1]) { // SLIDING UP OR DOWN: FACE THE WAY THIS MOVE GOES (SIDEWAYS FACES ITS LAST WAY, BELOW)
								if (game.playerColor == 'w') {
									yFrom = 8 - game.moveObj.from.split("")[1];
									yTo = 8 - game.moveObj.to.split("")[1];
								} else if (game.playerColor == 'b') { // FLIPPED BOARD: RANK 1 IS THE TOP ROW
									yFrom = game.moveObj.from.split("")[1] - 1;
									yTo = game.moveObj.to.split("")[1] - 1;
								}
								handlePieceDirectionB(yFrom, yTo);
								drawPiece();
								break;
							} else if (JSON.parse(game.response.b_piece)[n].from && JSON.parse(game.response.b_piece)[n].to == game.tiles[index].square) { // THIS PIECE HAS MOVED UP OR DOWN: FACE THE WAY ITS LAST ONE WENT
								if (game.playerColor == 'w') {
									yFrom = 8 - JSON.parse(game.response.b_piece)[n].from.split("")[1];
									yTo = 8 - JSON.parse(game.response.b_piece)[n].to.split("")[1];
								} else if (game.playerColor == 'b') { // FLIPPED BOARD: RANK 1 IS THE TOP ROW
									yFrom = JSON.parse(game.response.b_piece)[n].from.split("")[1] - 1;
									yTo = JSON.parse(game.response.b_piece)[n].to.split("")[1] - 1;
								}
								handlePieceDirectionB(yFrom, yTo);
								drawPiece();
								break;
							} else if (JSON.parse(game.response.b_piece)[n].from == null && JSON.parse(game.response.b_piece)[n].to == game.tiles[index].square) { // HASN'T MOVED UP OR DOWN: FACES WHITE'S SIDE
								handlePieceDirectionB(null, null);
								drawPiece();
								break;
							}
						}
					}
				} else if (pieceType.match(/[p]/) && pieceColor) { // CHECKS CURRENT INDEX FOR PAWN
					handlePawnDirection(); // PAWNS ALWAYS FACE THE OTHER SIDE
					if (pieceColor == "w") { drawActivePiece([game.wPawnRefl, game.wPawnShdw, game.wPawnImg], x, y, opacity); game.wPieceCount.pawn++; }
					else if (pieceColor == "b") { drawActivePiece([game.bPawnRefl, game.bPawnShdw, game.bPawnImg], x, y, opacity); game.bPieceCount.pawn++; }
				}
			}

			/* ---------------------------------------------------------------- */
			// Draw Sliding Piece
			/* ---------------------------------------------------------------- */
			/**
			 * @description Draws the sliding king, queen, bishop, rook or pawn in this square's turn, before this square's piece (slideTurn),
			 * like Draw Hopping Knight. index is the sliding tile while it draws (drawActivePiece reads it)
			 */
			function drawSlidingPiece() {
				slideTurn.drawn = true;
				if (game.currPromotion) { return; } // NO PIECES ON THE BOARD WHILE THE PROMOTION PICKER IS UP
				const squareIndex = index; // THIS SQUARE'S TILE
				index = slideTurn.index;
				drawBoardPiece(game.tiles[index].type, game.tiles[index].color, true);
				index = squareIndex;
			}
			// THE SLIDING PIECE IS DRAWN BEFORE THE FIRST SQUARE AFTER IT: A LOWER ROW, OR ITS ROW & FURTHER RIGHT (THE BOARD AT REST DRAWS IN THIS ORDER)
			if (slideTurn && !slideTurn.drawn && (i > slideTurn.sy + 0.001 || (Math.abs(i - slideTurn.sy) <= 0.001 && j > slideTurn.sx + 0.001))) { drawSlidingPiece(); }

			if (inst[i][j]) { // IF CURRENT INDEX OF A TILE EXISTS
				game.tiles[index].originX = j; // THE PIECE'S OWN SQUARE (x, y FOLLOW THE MOUSE WHILE IT'S HELD)
				game.tiles[index].originY = i;
				const pieceType = inst[i][j].type;
				const pieceColor = inst[i][j].color;
				if (!game.currPromotion) { // NO PIECES ON THE BOARD WHILE THE PROMOTION PICKER IS UP
					if (!(game.mousedownTile.xAvailInt == game.tiles[index].x && game.mousedownTile.yAvailInt == game.tiles[index].y)) { // IF A MOUSE DOWN TILE IS ON AVAILABLE MOVE TILE RENDERING OF THE PIECE FALLS ON THE RESPONSIBILITY OF "checkAvailableMoves()"
						let opacity = true
						if (game.tiles[index].isClicked && (game.tiles[index].x == game.tiles[index].originX && game.tiles[index].y == game.tiles[index].originY)) { opacity = false } // IF TILE IS IN ORIGINAL POSITION SET OPACITY TO FALSE
						if (pieceType.match(/[kqbrp]/) && pieceColor) { // CHECKS CURRENT INDEX FOR KING, QUEEN, BISHOP, ROOK OR PAWN
							if (!(slideTurn && slideTurn.index == index)) { drawBoardPiece(pieceType, pieceColor, opacity); } // SLIDING: DRAWN IN THE TURN OF THE SQUARE AFTER IT (drawSlidingPiece)
						} else if (pieceType.match(/[n]/) && pieceColor) { // CHECKS CURRENT INDEX FOR KNIGHT
							/* ---------------------------------------------------------------- */
							// Draw Knight (Draw Screen)
							/* ---------------------------------------------------------------- */
							/**
							 * @description Draws the knight to the board with the image the loops below picked (wKnightImg / bKnightImg).
							 * While the player holds their knight it faces the way it's dragged (left or right of its square)
							 */
							function drawKnight() {
								if (pieceColor == 'w') {
									if (game.tiles[index].isMousedown) { // HELD: FACE THE WAY IT'S DRAGGED
										if (game.tiles[index].x < game.tiles[index].originX && game.playerColor == pieceColor) { game.wKnightImg = wLeftKnightImg; game.wKnightShdw = wLeftKnightShdw; game.wKnightRefl = wLeftKnightRefl; drawActivePiece([game.wKnightRefl, game.wKnightShdw, game.wKnightImg], x, y, opacity); }
										else if (game.tiles[index].x > game.tiles[index].originX && game.playerColor == pieceColor) { game.wKnightImg = wRightKnightImg; game.wKnightShdw = wRightKnightShdw; game.wKnightRefl = wRightKnightRefl; drawActivePiece([game.wKnightRefl, game.wKnightShdw, game.wKnightImg], x, y, opacity); }
										else { drawActivePiece([game.wKnightRefl, game.wKnightShdw, game.wKnightImg], x, y, opacity); }
									} else { drawActivePiece([game.wKnightRefl, game.wKnightShdw, game.wKnightImg], x, y, opacity); }
								} else if (pieceColor == 'b') {
									if (game.tiles[index].isMousedown) {
										if (game.tiles[index].x < game.tiles[index].originX && game.playerColor == pieceColor) { game.bKnightImg = bLeftKnightImg; game.bKnightShdw = bLeftKnightShdw; game.bKnightRefl = bLeftKnightRefl; drawActivePiece([game.bKnightRefl, game.bKnightShdw, game.bKnightImg], x, y, opacity); }
										else if (game.tiles[index].x > game.tiles[index].originX && game.playerColor == pieceColor) { game.bKnightImg = bRightKnightImg; game.bKnightShdw = bRightKnightShdw; game.bKnightRefl = bRightKnightRefl; drawActivePiece([game.bKnightRefl, game.bKnightShdw, game.bKnightImg], x, y, opacity); }
										else { drawActivePiece([game.bKnightRefl, game.bKnightShdw, game.bKnightImg], x, y, opacity); }
									} else { drawActivePiece([game.bKnightRefl, game.bKnightShdw, game.bKnightImg], x, y, opacity); }
								}
							}
							// WHICH WAY A KNIGHT FACES COMES FROM THE SERVER'S KNIGHT LIST (w_knight / b_knight):
							// { from, to } OF EACH KNIGHT'S LAST MOVE, from IS null BEFORE IT MOVES & BOTH ARE null ONCE IT'S TAKEN
							if (pieceColor == "w") {
								let xFrom; // FILE IT CAME FROM (a = 0)
								let xTo; // FILE IT WENT TO
								for (let n = 0; n < JSON.parse(game.response.w_knight).length; n++) {
									if (game.tiles[index].isSliding) { // SLIDING: FACE THE WAY THIS MOVE GOES
										if (hopTurn) { break; } // OVER ANOTHER SQUARE: DRAWN IN THAT SQUARE'S TURN (drawHoppingKnight), STILL COUNTED BELOW
										if (game.playerColor == 'w') {
											xFrom = game.moveObj.from.split("")[0].charCodeAt(0) - 96 - 1;
											xTo = game.moveObj.to.split("")[0].charCodeAt(0) - 96 - 1;
										} else if (game.playerColor == 'b') { // SAME AS WHITE, handleKnightDirectionW FLIPS ITS TEST FOR BLACK
											xFrom = game.moveObj.from.split("")[0].charCodeAt(0) - 96 - 1;
											xTo = game.moveObj.to.split("")[0].charCodeAt(0) - 96 - 1;
										}
										handleKnightDirectionW(xFrom, xTo);
										drawActivePiece([game.wKnightRefl, game.wKnightShdw, game.wKnightImg], x, y, opacity);
										break;
									} else if (JSON.parse(game.response.w_knight)[n].from && (JSON.parse(game.response.w_knight)[n].to == game.tiles[index].square)) { // THIS KNIGHT HAS MOVED: FACE THE WAY ITS LAST MOVE WENT
										if (game.playerColor == 'w') {
											xFrom = JSON.parse(game.response.w_knight)[n].from.split("")[0].charCodeAt(0) - 96 - 1;
											xTo = JSON.parse(game.response.w_knight)[n].to.split("")[0].charCodeAt(0) - 96 - 1;
										} else if (game.playerColor == 'b') {
											xFrom = JSON.parse(game.response.w_knight)[n].from.split("")[0].charCodeAt(0) - 96 - 1;
											xTo = JSON.parse(game.response.w_knight)[n].to.split("")[0].charCodeAt(0) - 96 - 1;
										}
										handleKnightDirectionW(xFrom, xTo);
										drawKnight();
										break;
									} else if (JSON.parse(game.response.w_knight)[n].from == null && JSON.parse(game.response.w_knight)[n].to) { // HASN'T MOVED: FACES THE MIDDLE, THE a - d FILES RIGHT & e - h LEFT (b1 RIGHT, g1 LEFT), FLIPPED WHEN PLAYING BLACK
										if (game.playerColor == 'w') {
											if (JSON.parse(game.response.w_knight)[n].to == game.tiles[index].square && game.tiles[index].square.split("")[0] < 'e') { game.wKnightImg = wRightKnightImg; game.wKnightShdw = wRightKnightShdw; game.wKnightRefl = wRightKnightRefl; drawKnight(); break; }
											else if (JSON.parse(game.response.w_knight)[n].to == game.tiles[index].square) { game.wKnightImg = wLeftKnightImg; game.wKnightShdw = wLeftKnightShdw; game.wKnightRefl = wLeftKnightRefl; drawKnight(); break; }
										} else if (game.playerColor == 'b') {
											if (JSON.parse(game.response.w_knight)[n].to == game.tiles[index].square && game.tiles[index].square.split("")[0] < 'e') { game.wKnightImg = wLeftKnightImg; game.wKnightShdw = wLeftKnightShdw; game.wKnightRefl = wLeftKnightRefl; drawKnight(); break; }
											else if (JSON.parse(game.response.w_knight)[n].to == game.tiles[index].square) { game.wKnightImg = wRightKnightImg; game.wKnightShdw = wRightKnightShdw; game.wKnightRefl = wRightKnightRefl; drawKnight(); break; }
										}
									}
								}
								game.wPieceCount.knight++;
							} else if (pieceColor == "b") {
								let xFrom; // SCREEN COLUMN IT CAME FROM
								let xTo; // SCREEN COLUMN IT WENT TO
								for (let n = 0; n < JSON.parse(game.response.b_knight).length; n++) {
									if (game.tiles[index].isSliding) { // SLIDING: FACE THE WAY THIS MOVE GOES
										if (hopTurn) { break; } // OVER ANOTHER SQUARE: DRAWN IN THAT SQUARE'S TURN (drawHoppingKnight), STILL COUNTED BELOW
										if (game.playerColor == 'w') {
											xFrom = game.moveObj.from.split("")[0].charCodeAt(0) - 96 - 1;
											xTo = game.moveObj.to.split("")[0].charCodeAt(0) - 96 - 1;
										} else if (game.playerColor == 'b') { // FLIPPED COLUMNS, SO handleKnightDirectionB USES ONE TEST FOR BOTH
											xFrom = 8 - (game.moveObj.from.split("")[0].charCodeAt(0) - 96);
											xTo = 8 - (game.moveObj.to.split("")[0].charCodeAt(0) - 96);
										}
										handleKnightDirectionB(xFrom, xTo);
										drawActivePiece([game.bKnightRefl, game.bKnightShdw, game.bKnightImg], x, y, opacity);
										break;
									} else if (JSON.parse(game.response.b_knight)[n].from && JSON.parse(game.response.b_knight)[n].to == game.tiles[index].square) { // THIS KNIGHT HAS MOVED: FACE THE WAY ITS LAST MOVE WENT
										if (game.playerColor == 'w') {
											xFrom = JSON.parse(game.response.b_knight)[n].from.split("")[0].charCodeAt(0) - 96 - 1;
											xTo = JSON.parse(game.response.b_knight)[n].to.split("")[0].charCodeAt(0) - 96 - 1;
										} else if (game.playerColor == 'b') {
											xFrom = 8 - (JSON.parse(game.response.b_knight)[n].from.split("")[0].charCodeAt(0) - 96);
											xTo = 8 - (JSON.parse(game.response.b_knight)[n].to.split("")[0].charCodeAt(0) - 96);
										}
										handleKnightDirectionB(xFrom, xTo);
										drawKnight();
										break;
									} else if (JSON.parse(game.response.b_knight)[n].from == null && JSON.parse(game.response.b_knight)[n].to) { // HASN'T MOVED: FACES THE MIDDLE, THE a - d FILES RIGHT & e - h LEFT FROM WHITE'S SIDE (b8 RIGHT, g8 LEFT), FLIPPED WHEN PLAYING BLACK
										if (game.playerColor == 'w') {
											if (JSON.parse(game.response.b_knight)[n].to == game.tiles[index].square && game.tiles[index].square.split("")[0] < 'e') { game.bKnightImg = bRightKnightImg; game.bKnightShdw = bRightKnightShdw; game.bKnightRefl = bRightKnightRefl; drawKnight(); break; }
											else if (JSON.parse(game.response.b_knight)[n].to == game.tiles[index].square) { game.bKnightImg = bLeftKnightImg; game.bKnightShdw = bLeftKnightShdw; game.bKnightRefl = bLeftKnightRefl; drawKnight(); break; }
										} else if (game.playerColor == 'b') {
											if (JSON.parse(game.response.b_knight)[n].to == game.tiles[index].square && game.tiles[index].square.split("")[0] < 'e') { game.bKnightImg = bLeftKnightImg; game.bKnightShdw = bLeftKnightShdw; game.bKnightRefl = bLeftKnightRefl; drawKnight(); break; }
											else if (JSON.parse(game.response.b_knight)[n].to == game.tiles[index].square) { game.bKnightImg = bRightKnightImg; game.bKnightShdw = bRightKnightShdw; game.bKnightRefl = bRightKnightRefl; drawKnight(); break; }
										}
									}
								}
								game.bPieceCount.knight++;
							}
						}
					}
				}
			}
			if (index == 63 && slideTurn && !slideTurn.drawn) { drawSlidingPiece(); } // NO SQUARE AFTER IT: DRAWN LAST
		}
	}


	/* ---------------------------------------------------------------- */
	// Draw Slide Box
	/* ---------------------------------------------------------------- */
	/**
	 * @description Handles pieceObj which draws piece over board render. Draws a piece's image again on top of the frame
	 * (no shadow or reflection): a hopping knight on top of everything (it hops over them), a landed knight & the pieces
	 * in front of it (drawPieceBelow). Other slides aren't drawn again, they're drawn once at their depth (slideTurn)
	 * @param  {[object]} pieceObj [tile of the piece to draw again]
	 */
	function drawSlideBox(pieceObj) {
		// CHECK ABOVE OR BELOW FIRST
		const pieceType = pieceObj.type;
		const pieceColor = pieceObj.color;
		const x = pieceObj.x;
		const y = pieceObj.y;

		if (pieceType.match(/[kqbr]/) && pieceColor) { // CHECKS CURRENT INDEX FOR KING, QUEEN, BISHOP OR ROOK
			/* ---------------------------------------------------------------- */
			// Draw Piece (Draw Slide Box)
			/* ---------------------------------------------------------------- */
			/**
			 * @description Draws the king, queen, bishop or rook to the board again (image only) with the images the loops below picked.
			 * The loops pick its facing the same way as Draw Piece (Draw Screen)
			 */
			function drawPiece() {
				if (pieceType.match(/[k]/) && pieceColor) { // CHECKS CURRENT INDEX FOR KING
					if (pieceColor == "w") { ctx.drawImage(images[game.wKingImg].image, (((x * game.tileWidth) + pieceObj.xDiff) + game.xBoardOff) - game.xPieceOffset / 2, ((((y * game.tileHeight) - pieceObj.yDiff) - game.tileHeight / 10) + game.yBoardOff) - game.yPieceOffset / 2, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset) }
					else if (pieceColor == "b") { ctx.drawImage(images[game.bKingImg].image, (((x * game.tileWidth) + pieceObj.xDiff) + game.xBoardOff) - game.xPieceOffset / 2, ((((y * game.tileHeight) - pieceObj.yDiff) - game.tileHeight / 10) + game.yBoardOff) - game.yPieceOffset / 2, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset) }
				} else if (pieceType.match(/[q]/) && pieceColor) { // CHECKS CURRENT INDEX FOR QUEEN
					if (pieceColor == "w") { ctx.drawImage(images[game.wQueenImg].image, (((x * game.tileWidth) + pieceObj.xDiff) + game.xBoardOff) - game.xPieceOffset / 2, ((((y * game.tileHeight) - pieceObj.yDiff) - game.tileHeight / 10) + game.yBoardOff) - game.yPieceOffset / 2, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset) }
					else if (pieceColor == "b") { ctx.drawImage(images[game.bQueenImg].image, (((x * game.tileWidth) + pieceObj.xDiff) + game.xBoardOff) - game.xPieceOffset / 2, ((((y * game.tileHeight) - pieceObj.yDiff) - game.tileHeight / 10) + game.yBoardOff) - game.yPieceOffset / 2, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset) }
				} else if (pieceType.match(/[b]/) && pieceColor) { // CHECKS CURRENT INDEX FOR BISHOP
					if (pieceColor == "w") {
						if (chessInst.squareColor(pieceObj.square) == 'light') { ctx.drawImage(images[game.wBishopWhiteSqImg].image, (((x * game.tileWidth) + pieceObj.xDiff) + game.xBoardOff) - game.xPieceOffset / 2, ((((y * game.tileHeight) - pieceObj.yDiff) - game.tileHeight / 10) + game.yBoardOff) - game.yPieceOffset / 2, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset) }
						else if (chessInst.squareColor(pieceObj.square) == 'dark') { ctx.drawImage(images[game.wBishopBlackSqImg].image, (((x * game.tileWidth) + pieceObj.xDiff) + game.xBoardOff) - game.xPieceOffset / 2, ((((y * game.tileHeight) - pieceObj.yDiff) - game.tileHeight / 10) + game.yBoardOff) - game.yPieceOffset / 2, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset) }
					} else if (pieceColor == "b") {
						if (chessInst.squareColor(pieceObj.square) == 'light') { ctx.drawImage(images[game.bBishopWhiteSqImg].image, (((x * game.tileWidth) + pieceObj.xDiff) + game.xBoardOff) - game.xPieceOffset / 2, ((((y * game.tileHeight) - pieceObj.yDiff) - game.tileHeight / 10) + game.yBoardOff) - game.yPieceOffset / 2, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset) }
						else if (chessInst.squareColor(pieceObj.square) == 'dark') { ctx.drawImage(images[game.bBishopBlackSqImg].image, (((x * game.tileWidth) + pieceObj.xDiff) + game.xBoardOff) - game.xPieceOffset / 2, ((((y * game.tileHeight) - pieceObj.yDiff) - game.tileHeight / 10) + game.yBoardOff) - game.yPieceOffset / 2, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset) }
					}
				} else if (pieceType.match(/[r]/) && pieceColor) { // CHECKS CURRENT INDEX FOR ROOK
					if (pieceColor == "w") { ctx.drawImage(images[game.wRookImg].image, (((x * game.tileWidth) + pieceObj.xDiff) + game.xBoardOff) - game.xPieceOffset / 2, ((((y * game.tileHeight) - pieceObj.yDiff) - game.tileHeight / 10) + game.yBoardOff) - game.yPieceOffset / 2, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset) }
					else if (pieceColor == "b") { ctx.drawImage(images[game.bRookImg].image, (((x * game.tileWidth) + pieceObj.xDiff) + game.xBoardOff) - game.xPieceOffset / 2, ((((y * game.tileHeight) - pieceObj.yDiff) - game.tileHeight / 10) + game.yBoardOff) - game.yPieceOffset / 2, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset) }
				}
			}
			// SAME FACING RULES AS THE BOARD: THIS MOVE WHILE SLIDING UP OR DOWN, ELSE ITS LAST MOVE UP OR DOWN, ELSE ITS START SIDE
			// !NOTE: ON THE FRAME A SLIDE LANDS ITS ENTRY HAS ALREADY MOVED TO THE NEW SQUARE (moveObj.to), SO IT'S LOOKED UP THERE & DRAWN
			// AGAIN. THE BOARD DREW IT IN ITS OLD SQUARE'S TURN, SO WITHOUT THIS THE PIECES DRAWN AGAIN AROUND IT COVERED IT FOR A FRAME
			if (pieceColor == "w") {
				let yFrom; // SCREEN ROW IT CAME FROM
				let yTo; // SCREEN ROW IT WENT TO
				for (let n = 0; n < JSON.parse(game.response.w_piece).length; n++) {
					if (pieceObj.isSliding && game.moveObj.from.split("")[1] != game.moveObj.to.split("")[1]) { // SLIDING UP OR DOWN: FACE THE WAY THIS MOVE GOES (SIDEWAYS FACES ITS LAST WAY, BELOW)
						if (game.playerColor == 'w') {
							yFrom = 8 - game.moveObj.from.split("")[1];
							yTo = 8 - game.moveObj.to.split("")[1];
						} else if (game.playerColor == 'b') { // FLIPPED BOARD: RANK 1 IS THE TOP ROW
							yFrom = game.moveObj.from.split("")[1] - 1;
							yTo = game.moveObj.to.split("")[1] - 1;
						}
						handlePieceDirectionW(yFrom, yTo);
						drawPiece();
						break;
					} else if (JSON.parse(game.response.w_piece)[n].from && JSON.parse(game.response.w_piece)[n].to == pieceObj.square) { // THIS PIECE HAS MOVED UP OR DOWN: FACE THE WAY ITS LAST ONE WENT
						if (game.playerColor == 'w') {
							yFrom = 8 - JSON.parse(game.response.w_piece)[n].from.split("")[1];
							yTo = 8 - JSON.parse(game.response.w_piece)[n].to.split("")[1];
						} else if (game.playerColor == 'b') { // FLIPPED BOARD: RANK 1 IS THE TOP ROW
							yFrom = JSON.parse(game.response.w_piece)[n].from.split("")[1] - 1;
							yTo = JSON.parse(game.response.w_piece)[n].to.split("")[1] - 1;
						}
						handlePieceDirectionW(yFrom, yTo);
						drawPiece();
						break;
					} else if (JSON.parse(game.response.w_piece)[n].from == null && JSON.parse(game.response.w_piece)[n].to == pieceObj.square) { // HASN'T MOVED UP OR DOWN: FACES BLACK'S SIDE
						handlePieceDirectionW(null, null);
						drawPiece();
						break;
					} else if (pieceObj.square == game.moveObj.from && JSON.parse(game.response.w_piece)[n].to == game.moveObj.to) { // JUST LANDED: ITS ENTRY IS ALREADY ON moveObj.to, FACE THE WAY IT LAST WENT UP OR DOWN
						if (JSON.parse(game.response.w_piece)[n].from) {
							if (game.playerColor == 'w') {
								yFrom = 8 - JSON.parse(game.response.w_piece)[n].from.split("")[1];
								yTo = 8 - JSON.parse(game.response.w_piece)[n].to.split("")[1];
							} else if (game.playerColor == 'b') { // FLIPPED BOARD: RANK 1 IS THE TOP ROW
								yFrom = JSON.parse(game.response.w_piece)[n].from.split("")[1] - 1;
								yTo = JSON.parse(game.response.w_piece)[n].to.split("")[1] - 1;
							}
						}
						handlePieceDirectionW(yFrom, yTo);
						drawPiece();
						break;
					}
				}
			} else if (pieceColor == "b") {
				let yFrom; // SCREEN ROW IT CAME FROM
				let yTo; // SCREEN ROW IT WENT TO
				for (let n = 0; n < JSON.parse(game.response.b_piece).length; n++) {
					if (pieceObj.isSliding && game.moveObj.from.split("")[1] != game.moveObj.to.split("")[1]) { // SLIDING UP OR DOWN: FACE THE WAY THIS MOVE GOES (SIDEWAYS FACES ITS LAST WAY, BELOW)
						if (game.playerColor == 'w') {
							yFrom = 8 - game.moveObj.from.split("")[1];
							yTo = 8 - game.moveObj.to.split("")[1];
						} else if (game.playerColor == 'b') { // FLIPPED BOARD: RANK 1 IS THE TOP ROW
							yFrom = game.moveObj.from.split("")[1] - 1;
							yTo = game.moveObj.to.split("")[1] - 1;
						}
						handlePieceDirectionB(yFrom, yTo);
						drawPiece();
						break;
					} else if (JSON.parse(game.response.b_piece)[n].from && JSON.parse(game.response.b_piece)[n].to == pieceObj.square) { // THIS PIECE HAS MOVED UP OR DOWN: FACE THE WAY ITS LAST ONE WENT
						if (game.playerColor == 'w') {
							yFrom = 8 - JSON.parse(game.response.b_piece)[n].from.split("")[1];
							yTo = 8 - JSON.parse(game.response.b_piece)[n].to.split("")[1];
						} else if (game.playerColor == 'b') { // FLIPPED BOARD: RANK 1 IS THE TOP ROW
							yFrom = JSON.parse(game.response.b_piece)[n].from.split("")[1] - 1;
							yTo = JSON.parse(game.response.b_piece)[n].to.split("")[1] - 1;
						}
						handlePieceDirectionB(yFrom, yTo);
						drawPiece();
						break;
					} else if (JSON.parse(game.response.b_piece)[n].from == null && JSON.parse(game.response.b_piece)[n].to == pieceObj.square) { // HASN'T MOVED UP OR DOWN: FACES WHITE'S SIDE
						handlePieceDirectionB(null, null);
						drawPiece();
						break;
					} else if (pieceObj.square == game.moveObj.from && JSON.parse(game.response.b_piece)[n].to == game.moveObj.to) { // JUST LANDED: ITS ENTRY IS ALREADY ON moveObj.to, FACE THE WAY IT LAST WENT UP OR DOWN
						if (JSON.parse(game.response.b_piece)[n].from) {
							if (game.playerColor == 'w') {
								yFrom = 8 - JSON.parse(game.response.b_piece)[n].from.split("")[1];
								yTo = 8 - JSON.parse(game.response.b_piece)[n].to.split("")[1];
							} else if (game.playerColor == 'b') { // FLIPPED BOARD: RANK 1 IS THE TOP ROW
								yFrom = JSON.parse(game.response.b_piece)[n].from.split("")[1] - 1;
								yTo = JSON.parse(game.response.b_piece)[n].to.split("")[1] - 1;
							}
						}
						handlePieceDirectionB(yFrom, yTo);
						drawPiece();
						break;
					}
				}
			}
		} else if (pieceType.match(/[n]/) && pieceColor) { // CHECKS CURRENT INDEX FOR KNIGHT
			handleKnightHop(pieceObj); // HOW HIGH IT IS THIS FRAME (knightHop)
			/* ---------------------------------------------------------------- */
			// Draw Knight (Draw Slide Box)
			/* ---------------------------------------------------------------- */
			/**
			 * @description Draws the knight to the board (image only), up to half a square up while it's hopping (knightHop).
			 * The loops below pick its facing the same way as Draw Knight (Draw Screen)
			 */
			function drawKnight() {
				if (pieceColor == 'w') {
					if (pieceObj.isSliding) { // HOPPING
						ctx.drawImage(images[game.wKnightImg].image, (((x * game.tileWidth) + pieceObj.xDiff) + game.xBoardOff) - game.xPieceOffset / 2, (((((y * game.tileHeight) - pieceObj.yDiff) - game.tileHeight / 10) + game.yBoardOff) - game.yPieceOffset / 2) - (game.tileHeight / 2) * game.knightHop, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset);
					} else {
						ctx.drawImage(images[game.wKnightImg].image, (((x * game.tileWidth) + pieceObj.xDiff) + game.xBoardOff) - game.xPieceOffset / 2, ((((y * game.tileHeight) - pieceObj.yDiff) - game.tileHeight / 10) + game.yBoardOff) - game.yPieceOffset / 2, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset)
					}
				} else if (pieceColor == 'b') {
					if (pieceObj.isSliding) {
						ctx.drawImage(images[game.bKnightImg].image, (((x * game.tileWidth) + pieceObj.xDiff) + game.xBoardOff) - game.xPieceOffset / 2, (((((y * game.tileHeight) - pieceObj.yDiff) - game.tileHeight / 10) + game.yBoardOff) - game.yPieceOffset / 2) - (game.tileHeight / 2) * game.knightHop, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset);
					} else {
						ctx.drawImage(images[game.bKnightImg].image, (((x * game.tileWidth) + pieceObj.xDiff) + game.xBoardOff) - game.xPieceOffset / 2, ((((y * game.tileHeight) - pieceObj.yDiff) - game.tileHeight / 10) + game.yBoardOff) - game.yPieceOffset / 2, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset)
					}
				}
			}
			if (pieceColor == "w") { // SAME FACING RULES AS THE BOARD: THIS MOVE WHILE SLIDING, ELSE ITS LAST MOVE, ELSE ITS START SQUARE
				let xFrom;
				let xTo;
				for (let n = 0; n < JSON.parse(game.response.w_knight).length; n++) {
					if (pieceObj.isSliding) {
						if (game.playerColor == 'w') {
							xFrom = game.moveObj.from.split("")[0].charCodeAt(0) - 96 - 1;
							xTo = game.moveObj.to.split("")[0].charCodeAt(0) - 96 - 1;
						} else if (game.playerColor == 'b') {
							xFrom = game.moveObj.from.split("")[0].charCodeAt(0) - 96 - 1;
							xTo = game.moveObj.to.split("")[0].charCodeAt(0) - 96 - 1;
						}
						handleKnightDirectionW(xFrom, xTo);
						if (pieceObj.isSliding) {
							ctx.drawImage(images[game.wKnightImg].image, (((x * game.tileWidth) + pieceObj.xDiff) + game.xBoardOff) - game.xPieceOffset / 2, (((((y * game.tileHeight) - pieceObj.yDiff) - game.tileHeight / 10) + game.yBoardOff) - game.yPieceOffset / 2) - (game.tileHeight / 2) * game.knightHop, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset);
						} else {
							ctx.drawImage(images[game.wKnightImg].image, (((x * game.tileWidth) + pieceObj.xDiff) + game.xBoardOff) - game.xPieceOffset / 2, ((((y * game.tileHeight) - pieceObj.yDiff) - game.tileHeight / 10) + game.yBoardOff) - game.yPieceOffset / 2, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset)
						}
						break;
					} else if (JSON.parse(game.response.w_knight)[n].from && (JSON.parse(game.response.w_knight)[n].to == pieceObj.square)) {
						if (game.playerColor == 'w') {
							xFrom = JSON.parse(game.response.w_knight)[n].from.split("")[0].charCodeAt(0) - 96 - 1;
							xTo = JSON.parse(game.response.w_knight)[n].to.split("")[0].charCodeAt(0) - 96 - 1;
						} else if (game.playerColor == 'b') {
							xFrom = JSON.parse(game.response.w_knight)[n].from.split("")[0].charCodeAt(0) - 96 - 1;
							xTo = JSON.parse(game.response.w_knight)[n].to.split("")[0].charCodeAt(0) - 96 - 1;
						}
						handleKnightDirectionW(xFrom, xTo);
						drawKnight();
						break;
					} else if (JSON.parse(game.response.w_knight)[n].from == null && JSON.parse(game.response.w_knight)[n].to) {
						if (game.playerColor == 'w') {
							if (JSON.parse(game.response.w_knight)[n].to == pieceObj.square && pieceObj.square.split("")[0] < 'e') { game.wKnightImg = wRightKnightImg; game.wKnightShdw = wRightKnightShdw; game.wKnightRefl = wRightKnightRefl; drawKnight(); break; }
							else if (JSON.parse(game.response.w_knight)[n].to == pieceObj.square) { game.wKnightImg = wLeftKnightImg; game.wKnightShdw = wLeftKnightShdw; game.wKnightRefl = wLeftKnightRefl; drawKnight(); break; }
						} else if (game.playerColor == 'b') {
							if (JSON.parse(game.response.w_knight)[n].to == pieceObj.square && pieceObj.square.split("")[0] < 'e') { game.wKnightImg = wLeftKnightImg; game.wKnightShdw = wLeftKnightShdw; game.wKnightRefl = wLeftKnightRefl; drawKnight(); break; }
							else if (JSON.parse(game.response.w_knight)[n].to == pieceObj.square) { game.wKnightImg = wRightKnightImg; game.wKnightShdw = wRightKnightShdw; game.wKnightRefl = wRightKnightRefl; drawKnight(); break; }
						}
					} else if (pieceObj.square == game.moveObj.from && JSON.parse(game.response.w_knight)[n].from && JSON.parse(game.response.w_knight)[n].to == game.moveObj.to) { // JUST LANDED: ITS ENTRY IS ALREADY ON moveObj.to, FACE THE WAY THIS MOVE WENT
						xFrom = JSON.parse(game.response.w_knight)[n].from.split("")[0].charCodeAt(0) - 96 - 1; // SAME FOR BOTH COLORS, handleKnightDirectionW FLIPS ITS TEST FOR BLACK
						xTo = JSON.parse(game.response.w_knight)[n].to.split("")[0].charCodeAt(0) - 96 - 1;
						handleKnightDirectionW(xFrom, xTo);
						drawKnight();
						break;
					}
				}
			} else if (pieceColor == "b") {
				let xFrom;
				let xTo;
				for (let n = 0; n < JSON.parse(game.response.b_knight).length; n++) {
					if (pieceObj.isSliding) {
						if (game.playerColor == 'w') {
							xFrom = game.moveObj.from.split("")[0].charCodeAt(0) - 96 - 1;
							xTo = game.moveObj.to.split("")[0].charCodeAt(0) - 96 - 1;
						} else if (game.playerColor == 'b') {
							xFrom = 8 - (game.moveObj.from.split("")[0].charCodeAt(0) - 96);
							xTo = 8 - (game.moveObj.to.split("")[0].charCodeAt(0) - 96);
						}
						handleKnightDirectionB(xFrom, xTo);
						if (pieceObj.isSliding) {
							ctx.drawImage(images[game.bKnightImg].image, (((x * game.tileWidth) + pieceObj.xDiff) + game.xBoardOff) - game.xPieceOffset / 2, (((((y * game.tileHeight) - pieceObj.yDiff) - game.tileHeight / 10) + game.yBoardOff) - game.yPieceOffset / 2) - (game.tileHeight / 2) * game.knightHop, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset);
						} else {
							ctx.drawImage(images[game.bKnightImg].image, (((x * game.tileWidth) + pieceObj.xDiff) + game.xBoardOff) - game.xPieceOffset / 2, ((((y * game.tileHeight) - pieceObj.yDiff) - game.tileHeight / 10) + game.yBoardOff) - game.yPieceOffset / 2, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset)
						}
						break;
					} else if (JSON.parse(game.response.b_knight)[n].from && JSON.parse(game.response.b_knight)[n].to == pieceObj.square) {
						if (game.playerColor == 'w') {
							xFrom = JSON.parse(game.response.b_knight)[n].from.split("")[0].charCodeAt(0) - 96 - 1;
							xTo = JSON.parse(game.response.b_knight)[n].to.split("")[0].charCodeAt(0) - 96 - 1;
						} else if (game.playerColor == 'b') {
							xFrom = 8 - (JSON.parse(game.response.b_knight)[n].from.split("")[0].charCodeAt(0) - 96);
							xTo = 8 - (JSON.parse(game.response.b_knight)[n].to.split("")[0].charCodeAt(0) - 96);
						}
						handleKnightDirectionB(xFrom, xTo);
						drawKnight();
						break;
					} else if (JSON.parse(game.response.b_knight)[n].from == null && JSON.parse(game.response.b_knight)[n].to) {
						if (game.playerColor == 'w') {
							if (JSON.parse(game.response.b_knight)[n].to == pieceObj.square && pieceObj.square.split("")[0] < 'e') { game.bKnightImg = bRightKnightImg; game.bKnightShdw = bRightKnightShdw; game.bKnightRefl = bRightKnightRefl; drawKnight(); break; }
							else if (JSON.parse(game.response.b_knight)[n].to == pieceObj.square) { game.bKnightImg = bLeftKnightImg; game.bKnightShdw = bLeftKnightShdw; game.bKnightRefl = bLeftKnightRefl; drawKnight(); break; }
						} else if (game.playerColor == 'b') {
							if (JSON.parse(game.response.b_knight)[n].to == pieceObj.square && pieceObj.square.split("")[0] < 'e') { game.bKnightImg = bLeftKnightImg; game.bKnightShdw = bLeftKnightShdw; game.bKnightRefl = bLeftKnightRefl; drawKnight(); break; }
							else if (JSON.parse(game.response.b_knight)[n].to == pieceObj.square) { game.bKnightImg = bRightKnightImg; game.bKnightShdw = bRightKnightShdw; game.bKnightRefl = bRightKnightRefl; drawKnight(); break; }
						}
					} else if (pieceObj.square == game.moveObj.from && JSON.parse(game.response.b_knight)[n].from && JSON.parse(game.response.b_knight)[n].to == game.moveObj.to) { // JUST LANDED: ITS ENTRY IS ALREADY ON moveObj.to, FACE THE WAY THIS MOVE WENT
						if (game.playerColor == 'w') {
							xFrom = JSON.parse(game.response.b_knight)[n].from.split("")[0].charCodeAt(0) - 96 - 1;
							xTo = JSON.parse(game.response.b_knight)[n].to.split("")[0].charCodeAt(0) - 96 - 1;
						} else if (game.playerColor == 'b') {
							xFrom = 8 - (JSON.parse(game.response.b_knight)[n].from.split("")[0].charCodeAt(0) - 96);
							xTo = 8 - (JSON.parse(game.response.b_knight)[n].to.split("")[0].charCodeAt(0) - 96);
						}
						handleKnightDirectionB(xFrom, xTo);
						drawKnight();
						break;
					}
				}
			}
		} else if (pieceType.match(/[p]/) && pieceColor) { // CHECKS CURRENT INDEX FOR PAWN
			handlePawnDirection(); // PAWNS ALWAYS FACE THE OTHER SIDE
			if (pieceColor == "w") { ctx.drawImage(images[game.wPawnImg].image, (((x * game.tileWidth) + pieceObj.xDiff) + game.xBoardOff) - game.xPieceOffset / 2, ((((y * game.tileHeight) - pieceObj.yDiff) - game.tileHeight / 10) + game.yBoardOff) - game.yPieceOffset / 2, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset) }
			else if (pieceColor == "b") { ctx.drawImage(images[game.bPawnImg].image, (((x * game.tileWidth) + pieceObj.xDiff) + game.xBoardOff) - game.xPieceOffset / 2, ((((y * game.tileHeight) - pieceObj.yDiff) - game.tileHeight / 10) + game.yBoardOff) - game.yPieceOffset / 2, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset) }
		}
	}

	// LANDED KNIGHT: UNTIL THE MOVE COMES BACK & THE BOARD IS REBUILT, THE KNIGHT IS STILL ON ITS OLD TILE (MOVED BY xDiff / yDiff),
	// SO THE BOARD DRAWS IT IN ITS OLD SQUARE'S TURN & NO SLIDE BOX IS MADE. ITS BOX IS JUST ITSELF (drawPieceBelow NEEDS y2x2)
	// (A KING, QUEEN, BISHOP, ROOK OR PAWN IS ALREADY DRAWN ONCE AT ITS DEPTH, slideTurn, SO IT ISN'T DRAWN AGAIN HERE)
	let landedTile = null;
	if (!overlapSlideObj) { // currSlide CAN ALREADY BE false HERE (validateMove TURNS IT OFF BEFORE setTiles() IS DONE)
		for (let q = 0; q < game.tiles.length; q++) {
			if (game.tiles[q].square == game.moveObj.from && game.tiles[q].type == 'n' && (!game.tiles[q].isSliding || game.knightHop == 0) && (game.tiles[q].xDiff || game.tiles[q].yDiff)) { landedTile = game.tiles[q]; overlapSlideObj = { y2x2: game.tiles[q] }; break; } // FROM THE FRAME IT'S BACK ON THE BOARD (drawSlideBox FINDS A LANDED KNIGHT BY moveObj.to)
		}
	}

	if ((game.currSlide || landedTile || knightPause) && overlapSlideObj) { // A SLIDE IS PASSING OTHER PIECES (OR JUST LANDED, OR A KNIGHT'S 100MS STOP): DRAW THE ONES IN FRONT OF IT AGAIN
		for (let q = 0; q < game.tiles.length; q++) { // SWAP EACH SQUARE NAME FOR THE TILE ON IT (SQUARES WITH NO PIECE STAY A NAME)
			if (game.tiles[q].square == overlapSlideObj.y1x1 && game.tiles[q].type) { overlapSlideObj.y1x1 = game.tiles[q] }
			else if (game.tiles[q].square == overlapSlideObj.y1x2 && game.tiles[q].type) { overlapSlideObj.y1x2 = game.tiles[q] }
			else if (game.tiles[q].square == overlapSlideObj.y1x3 && game.tiles[q].type) { overlapSlideObj.y1x3 = game.tiles[q] }
			else if (game.tiles[q].square == overlapSlideObj.y2x1 && game.tiles[q].type) { overlapSlideObj.y2x1 = game.tiles[q] }
			else if (game.tiles[q].square == overlapSlideObj.y2x2 && game.tiles[q].type) { overlapSlideObj.y2x2 = game.tiles[q] }
			else if (game.tiles[q].square == overlapSlideObj.y2x3 && game.tiles[q].type) { overlapSlideObj.y2x3 = game.tiles[q] }
			else if (game.tiles[q].square == overlapSlideObj.y3x1 && game.tiles[q].type) { overlapSlideObj.y3x1 = game.tiles[q] }
			else if (game.tiles[q].square == overlapSlideObj.y3x2 && game.tiles[q].type) { overlapSlideObj.y3x2 = game.tiles[q] }
			else if (game.tiles[q].square == overlapSlideObj.y3x3 && game.tiles[q].type) { overlapSlideObj.y3x3 = game.tiles[q] }
		}

		/**
		 * @description Draws the pieces below a square on screen again, one square at a time down the column
		 * (lower pieces are closer to the player, so they're in front)
		 * @param  {[string]} square [square name]
		 */
		function drawPieceBelow(square) {
			if (square && overlapSlideObj.y2x2?.square || false) {
				let sq = square.split("");
				if (game.playerColor == 'w') { square = `${sq[0]}${Number(sq[1]) - 1}`; }
				else if (game.playerColor == 'b') { square = `${sq[0]}${Number(sq[1]) + 1}`; }
				for (let a = 0; a < game.tiles.length; a++) {
					if (game.tiles[a].square == square && overlapSlideObj.y2x2.square != square) {
						drawSlideBox(game.tiles[a]);
						drawPieceBelow(game.tiles[a].square);
					}
				}
			}
		}

		if (landedTile) { // LANDED: DRAW IT AGAIN OVER THE PIECES BEHIND IT, THEN THE PIECE TO ITS RIGHT (DRAWN AFTER IT ON THE BOARD) & THE PIECES IN FRONT AGAIN
			const to = game.moveObj.to.split("");
			const right = game.playerColor == 'w' ? 1 : -1; // SCREEN RIGHT IS THE NEXT FILE (WHITE) OR THE ONE BEFORE IT (BLACK, FLIPPED)
			drawSlideBox(landedTile);
			for (let q = 0; q < game.tiles.length; q++) {
				if (game.tiles[q].square == `${String.fromCharCode(to[0].charCodeAt(0) + right)}${to[1]}` && game.tiles[q].type) { drawSlideBox(game.tiles[q]); }
			}
			drawPieceBelow(game.moveObj.to);
			drawPieceBelow(`${String.fromCharCode(to[0].charCodeAt(0) - 1)}${to[1]}`);
			drawPieceBelow(`${String.fromCharCode(to[0].charCodeAt(0) + 1)}${to[1]}`);
		} else if (overlapSlideObj.y2x2?.type == "n") { // A HOPPING KNIGHT GOES OVER EVERYTHING: DRAW IT AGAIN ON TOP
			drawSlideBox(overlapSlideObj.y2x2);
		}
		overlapSlideObj = null
	}
	if (!game.currSlide) { game.refresh = true; overlapSlideObj = null; } // NOTHING SLIDING, CLEAR THE OVERLAP
}

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
 */
function renderTakenPieces(takenPieces, paramColor) {
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
			ctx.drawImage(images[imgArr[i]].image, xPos * game.tileWidth + game.xBoardOff - game.xPieceOffset / 2, yPos * game.tileHeight + game.yBoardOff - game.yPieceOffset / 2, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset);
			if (((takenPiece.x === game.tileX && takenPiece.y === game.tileY && (takenPiece.color == game.playerColor || !takenPiece.color))) && game.currPromotion) { ctx.globalAlpha = 1; }
		}
	}

	if (game.widthGreater) { // WIDE SCREEN: TRAYS TO THE RIGHT OF THE BOARD (COLUMN 9), THE PLAYER'S AT THE BOTTOM (ROW 6), THE OPPONENT'S AT THE TOP (ROW -1)
		if (game.playerColor == 'w') {
			if (paramColor == "w") { xPos = 9; yPos = 6; }
			else { xPos = 9; yPos = -1; }
		} else if (game.playerColor == 'b') {
			if (paramColor == "w") { xPos = 9; yPos = -1; }
			else { xPos = 9; yPos = 6; }
		}

		for (let i = 0; i < takenPieces.length; i++) {
			takenPieces[i].x = xPos;
			takenPieces[i].y = yPos;
			if (takenPieces[i].type.match(/[k]/) && takenPieces[i].color) { // CHECKS CURRENT INDEX FOR KING
				if (takenPieces[i].color == "w") { drawTakenPiece(takenPieces[i], [wFrontKingShdw, wFrontKingImg]); xPos += 1; if (xPos - 9 == 3) { yPos += 1; xPos = 9 } }
				else if (takenPieces[i].color == "b") { drawTakenPiece(takenPieces[i], [bFrontKingShdw, bFrontKingImg]); xPos += 1; if (xPos - 9 == 3) { yPos += 1; xPos = 9 } }
			} else if (takenPieces[i].type.match(/[q]/) && takenPieces[i].color) { // CHECKS CURRENT INDEX FOR QUEEN
				if (takenPieces[i].color == "w") { drawTakenPiece(takenPieces[i], [wFrontQueenShdw, wFrontQueenImg]); xPos += 1; if (xPos - 9 == 3) { yPos += 1; xPos = 9 } }
				else if (takenPieces[i].color == "b") { drawTakenPiece(takenPieces[i], [bFrontQueenShdw, bFrontQueenImg]); xPos += 1; if (xPos - 9 == 3) { yPos += 1; xPos = 9 } }
			} else if (takenPieces[i].type.match(/[b]/) && takenPieces[i].color) { // CHECKS CURRENT INDEX FOR BISHOP
				if (takenPieces[i].color == "w") { drawTakenPiece(takenPieces[i], [wFrontBishopShdw, wFrontBishopBlackSqImg]); xPos += 1; if (xPos - 9 == 3) { yPos += 1; xPos = 9 } }
				else if (takenPieces[i].color == "b") { drawTakenPiece(takenPieces[i], [bFrontBishopShdw, bFrontBishopWhiteSqImg]); xPos += 1; if (xPos - 9 == 3) { yPos += 1; xPos = 9 } }
			} else if (takenPieces[i].type.match(/[n]/) && takenPieces[i].color) { // CHECKS CURRENT INDEX FOR KNIGHT
				if (takenPieces[i].color == "w") { drawTakenPiece(takenPieces[i], [wRightKnightShdw, wRightKnightImg]); xPos += 1; if (xPos - 9 == 3) { yPos += 1; xPos = 9 } }
				else if (takenPieces[i].color == "b") { drawTakenPiece(takenPieces[i], [bRightKnightShdw, bRightKnightImg]); xPos += 1; if (xPos - 9 == 3) { yPos += 1; xPos = 9 } }
			} else if (takenPieces[i].type.match(/[r]/) && takenPieces[i].color) { // CHECKS CURRENT INDEX FOR ROOK
				if (takenPieces[i].color == "w") { drawTakenPiece(takenPieces[i], [wFrontRookShdw, wFrontRookImg]); xPos += 1; if (xPos - 9 == 3) { yPos += 1; xPos = 9 } }
				else if (takenPieces[i].color == "b") { drawTakenPiece(takenPieces[i], [bFrontRookShdw, bFrontRookImg]); xPos += 1; if (xPos - 9 == 3) { yPos += 1; xPos = 9 } }
			} else if (takenPieces[i].type.match(/[p]/) && takenPieces[i].color) { // CHECKS CURRENT INDEX FOR PAWN
				if (takenPieces[i].color == "w") { drawTakenPiece(takenPieces[i], [wFrontPawnShdw, wFrontPawnImg]); xPos += 1; if (xPos - 9 == 3) { yPos += 1; xPos = 9 } }
				else if (takenPieces[i].color == "b") { drawTakenPiece(takenPieces[i], [bFrontPawnShdw, bFrontPawnImg]); xPos += 1; if (xPos - 9 == 3) { yPos += 1; xPos = 9 } }
			}
		}
	} else { // NARROW SCREEN: ONE ROW BELOW THE BOARD (ROW 9) FOR THE PLAYER, ONE ABOVE (ROW -2) FOR THE OPPONENT
		const xStart = game.portraitBoard ? 0 : -1; // PORTRAIT BOARD FILLS THE WIDTH, SO KEEP TAKEN PIECES ON SCREEN
		if (game.playerColor == 'w') {
			if (paramColor == "w") { xPos = xStart; yPos = 9; }
			else { xPos = xStart; yPos = -2; }
		} else if (game.playerColor == 'b') {
			if (paramColor == "w") { xPos = xStart; yPos = -2; }
			else { xPos = xStart; yPos = 9; }
		}

		for (let i = 0; i < takenPieces.length; i++) {
			takenPieces[i].x = xPos;
			takenPieces[i].y = yPos;
			if (takenPieces[i].type.match(/[k]/) && takenPieces[i].color) { // CHECKS CURRENT INDEX FOR KING
				if (takenPieces[i].color == "w") { drawTakenPiece(takenPieces[i], [wFrontKingShdw, wFrontKingImg]); xPos += 1; }
				else if (takenPieces[i].color == "b") { drawTakenPiece(takenPieces[i], [bFrontKingShdw, bFrontKingImg]); xPos += 1; }
			} else if (takenPieces[i].type.match(/[q]/) && takenPieces[i].color) { // CHECKS CURRENT INDEX FOR QUEEN
				if (takenPieces[i].color == "w") { drawTakenPiece(takenPieces[i], [wFrontQueenShdw, wFrontQueenImg]); xPos += 1; }
				else if (takenPieces[i].color == "b") { drawTakenPiece(takenPieces[i], [bFrontQueenShdw, bFrontQueenImg]); xPos += 1; }
			} else if (takenPieces[i].type.match(/[b]/) && takenPieces[i].color) { // CHECKS CURRENT INDEX FOR BISHOP
				if (takenPieces[i].color == "w") { drawTakenPiece(takenPieces[i], [wFrontBishopShdw, wFrontBishopBlackSqImg]); xPos += 1; }
				else if (takenPieces[i].color == "b") { drawTakenPiece(takenPieces[i], [bFrontBishopShdw, bFrontBishopWhiteSqImg]); xPos += 1; }
			} else if (takenPieces[i].type.match(/[n]/) && takenPieces[i].color) { // CHECKS CURRENT INDEX FOR KNIGHT
				if (takenPieces[i].color == "w") { drawTakenPiece(takenPieces[i], [wRightKnightShdw, wRightKnightImg]); xPos += 1; }
				else if (takenPieces[i].color == "b") { drawTakenPiece(takenPieces[i], [bRightKnightShdw, bRightKnightImg]); xPos += 1; }
			} else if (takenPieces[i].type.match(/[r]/) && takenPieces[i].color) { // CHECKS CURRENT INDEX FOR ROOK
				if (takenPieces[i].color == "w") { drawTakenPiece(takenPieces[i], [wFrontRookShdw, wFrontRookImg]); xPos += 1; }
				else if (takenPieces[i].color == "b") { drawTakenPiece(takenPieces[i], [bFrontRookShdw, bFrontRookImg]); xPos += 1; }
			} else if (takenPieces[i].type.match(/[p]/) && takenPieces[i].color) { // CHECKS CURRENT INDEX FOR PAWN
				if (takenPieces[i].color == "w") { drawTakenPiece(takenPieces[i], [wFrontPawnShdw, wFrontPawnImg]); xPos += 1; }
				else if (takenPieces[i].color == "b") { drawTakenPiece(takenPieces[i], [bFrontPawnShdw, bFrontPawnImg]); xPos += 1; }
			}
		}
	}

}

/* ---------------------------------------------------------------- */
// Handle Knight Direction White
/* ---------------------------------------------------------------- */
/**
 * @description Check the previous x pos & the curr x pos to determine orientation. Points the white knight images
 * (wKnightImg, wKnightShdw, wKnightRefl) right when the knight moved right on screen, left when it moved left.
 * The files aren't flipped for black, so the test is flipped here instead
 * @param  {[number]} xFrom [file it came from, a = 0]
 * @param  {[number]} xTo [file it went to]
 */
function handleKnightDirectionW(xFrom, xTo) {
	if (game.playerColor == 'w') {
		if (xFrom < xTo) { game.wKnightImg = wRightKnightImg; game.wKnightShdw = wRightKnightShdw; game.wKnightRefl = wRightKnightRefl; } // MOVED RIGHT
		else if (xFrom > xTo) { game.wKnightImg = wLeftKnightImg; game.wKnightShdw = wLeftKnightShdw; game.wKnightRefl = wLeftKnightRefl; } // MOVED LEFT
		else { game.wKnightImg = wLeftKnightImg; game.wKnightShdw = wLeftKnightShdw; game.wKnightRefl = wLeftKnightRefl; } // SAME FILE (A KNIGHT ALWAYS CHANGES FILE, SO THIS DOESN'T HAPPEN)
	} else if (game.playerColor == 'b') { // FLIPPED BOARD: A HIGHER FILE IS FURTHER LEFT ON SCREEN
		if (xFrom > xTo) { game.wKnightImg = wRightKnightImg; game.wKnightShdw = wRightKnightShdw; game.wKnightRefl = wRightKnightRefl; }
		else if (xFrom < xTo) { game.wKnightImg = wLeftKnightImg; game.wKnightShdw = wLeftKnightShdw; game.wKnightRefl = wLeftKnightRefl; }
		else { game.wKnightImg = wLeftKnightImg; game.wKnightShdw = wLeftKnightShdw; game.wKnightRefl = wLeftKnightRefl; }
	}
}

/* ---------------------------------------------------------------- */
// Handle Knight Direction Black
/* ---------------------------------------------------------------- */
/**
 * @description Check the previous x pos & the curr x pos to determine orientation. Points the black knight images
 * (bKnightImg, bKnightShdw, bKnightRefl) right when the knight moved right on screen, left when it moved left.
 * The callers already flip the columns for black, so both colors use the same test
 * @param  {[number]} xFrom [screen column it came from]
 * @param  {[number]} xTo [screen column it went to]
 */
function handleKnightDirectionB(xFrom, xTo) {
	if (game.playerColor == 'w') {
		if (xFrom < xTo) { game.bKnightImg = bRightKnightImg; game.bKnightShdw = bRightKnightShdw; game.bKnightRefl = bRightKnightRefl; } // MOVED RIGHT
		else if (xFrom > xTo) { game.bKnightImg = bLeftKnightImg; game.bKnightShdw = bLeftKnightShdw; game.bKnightRefl = bLeftKnightRefl; } // MOVED LEFT
		else { game.bKnightImg = bRightKnightImg; game.bKnightShdw = bRightKnightShdw; game.bKnightRefl = bRightKnightRefl; } // SAME COLUMN (DOESN'T HAPPEN FOR A KNIGHT)
	} else if (game.playerColor == 'b') {
		if (xFrom < xTo) { game.bKnightImg = bRightKnightImg; game.bKnightShdw = bRightKnightShdw; game.bKnightRefl = bRightKnightRefl; }
		else if (xFrom > xTo) { game.bKnightImg = bLeftKnightImg; game.bKnightShdw = bLeftKnightShdw; game.bKnightRefl = bLeftKnightRefl; }
		else { game.bKnightImg = bRightKnightImg; game.bKnightShdw = bRightKnightShdw; game.bKnightRefl = bRightKnightRefl; }
	}
}

/* ---------------------------------------------------------------- */
// Handle Piece Direction White
/* ---------------------------------------------------------------- */
/**
 * @description Check the previous y pos & the curr y pos to determine orientation. Points the white king, queen, bishop & rook
 * images (wKingImg, wKingShdw, wKingRefl, ...) away from the player (their backs) when the piece moved up the screen,
 * toward the player (their fronts) when it moved down. One that hasn't moved up or down faces black's side
 * @param  {[number]} yFrom [screen row it came from, null before it has moved up or down]
 * @param  {[number]} yTo [screen row it went to, null before it has moved up or down]
 */
export function handlePieceDirectionW(yFrom, yTo) {
	if (yFrom > yTo) { // MOVED UP: FACES AWAY
		game.wKingImg = wBackKingImg; game.wKingShdw = wBackKingShdw; game.wKingRefl = wBackKingRefl;
		game.wQueenImg = wBackQueenImg; game.wQueenShdw = wBackQueenShdw; game.wQueenRefl = wBackQueenRefl;
		game.wBishopBlackSqImg = wBackBishopImg; game.wBishopWhiteSqImg = wBackBishopImg; game.wBishopShdw = wBackBishopShdw; game.wBishopRefl = wBackBishopRefl;
		game.wRookImg = wBackRookImg; game.wRookShdw = wBackRookShdw; game.wRookRefl = wBackRookRefl;
	} else if (yFrom < yTo) { // MOVED DOWN: FACES THE PLAYER
		game.wKingImg = wFrontKingImg; game.wKingShdw = wFrontKingShdw; game.wKingRefl = wFrontKingRefl;
		game.wQueenImg = wFrontQueenImg; game.wQueenShdw = wFrontQueenShdw; game.wQueenRefl = wFrontQueenRefl;
		game.wBishopBlackSqImg = wFrontBishopBlackSqImg; game.wBishopWhiteSqImg = wFrontBishopWhiteSqImg; game.wBishopShdw = wFrontBishopShdw; game.wBishopRefl = wFrontBishopRefl;
		game.wRookImg = wFrontRookImg; game.wRookShdw = wFrontRookShdw; game.wRookRefl = wFrontRookRefl;
	} else if (game.playerColor == 'w') { // HASN'T MOVED UP OR DOWN: FACES BLACK'S SIDE (THE TOP OF THE BOARD)
		game.wKingImg = wBackKingImg; game.wKingShdw = wBackKingShdw; game.wKingRefl = wBackKingRefl;
		game.wQueenImg = wBackQueenImg; game.wQueenShdw = wBackQueenShdw; game.wQueenRefl = wBackQueenRefl;
		game.wBishopBlackSqImg = wBackBishopImg; game.wBishopWhiteSqImg = wBackBishopImg; game.wBishopShdw = wBackBishopShdw; game.wBishopRefl = wBackBishopRefl;
		game.wRookImg = wBackRookImg; game.wRookShdw = wBackRookShdw; game.wRookRefl = wBackRookRefl;
	} else if (game.playerColor == 'b') { // FLIPPED BOARD: BLACK'S SIDE IS THE BOTTOM
		game.wKingImg = wFrontKingImg; game.wKingShdw = wFrontKingShdw; game.wKingRefl = wFrontKingRefl;
		game.wQueenImg = wFrontQueenImg; game.wQueenShdw = wFrontQueenShdw; game.wQueenRefl = wFrontQueenRefl;
		game.wBishopBlackSqImg = wFrontBishopBlackSqImg; game.wBishopWhiteSqImg = wFrontBishopWhiteSqImg; game.wBishopShdw = wFrontBishopShdw; game.wBishopRefl = wFrontBishopRefl;
		game.wRookImg = wFrontRookImg; game.wRookShdw = wFrontRookShdw; game.wRookRefl = wFrontRookRefl;
	}
}

/* ---------------------------------------------------------------- */
// Handle Piece Direction Black
/* ---------------------------------------------------------------- */
/**
 * @description Check the previous y pos & the curr y pos to determine orientation. Points the black king, queen, bishop & rook
 * images (bKingImg, bKingShdw, bKingRefl, ...) away from the player (their backs) when the piece moved up the screen,
 * toward the player (their fronts) when it moved down. One that hasn't moved up or down faces white's side
 * @param  {[number]} yFrom [screen row it came from, null before it has moved up or down]
 * @param  {[number]} yTo [screen row it went to, null before it has moved up or down]
 */
export function handlePieceDirectionB(yFrom, yTo) {
	if (yFrom > yTo) { // MOVED UP: FACES AWAY
		game.bKingImg = bBackKingImg; game.bKingShdw = bBackKingShdw; game.bKingRefl = bBackKingRefl;
		game.bQueenImg = bBackQueenImg; game.bQueenShdw = bBackQueenShdw; game.bQueenRefl = bBackQueenRefl;
		game.bBishopBlackSqImg = bBackBishopImg; game.bBishopWhiteSqImg = bBackBishopImg; game.bBishopShdw = bBackBishopShdw; game.bBishopRefl = bBackBishopRefl;
		game.bRookImg = bBackRookImg; game.bRookShdw = bBackRookShdw; game.bRookRefl = bBackRookRefl;
	} else if (yFrom < yTo) { // MOVED DOWN: FACES THE PLAYER
		game.bKingImg = bFrontKingImg; game.bKingShdw = bFrontKingShdw; game.bKingRefl = bFrontKingRefl;
		game.bQueenImg = bFrontQueenImg; game.bQueenShdw = bFrontQueenShdw; game.bQueenRefl = bFrontQueenRefl;
		game.bBishopBlackSqImg = bFrontBishopBlackSqImg; game.bBishopWhiteSqImg = bFrontBishopWhiteSqImg; game.bBishopShdw = bFrontBishopShdw; game.bBishopRefl = bFrontBishopRefl;
		game.bRookImg = bFrontRookImg; game.bRookShdw = bFrontRookShdw; game.bRookRefl = bFrontRookRefl;
	} else if (game.playerColor == 'w') { // HASN'T MOVED UP OR DOWN: FACES WHITE'S SIDE (THE BOTTOM OF THE BOARD)
		game.bKingImg = bFrontKingImg; game.bKingShdw = bFrontKingShdw; game.bKingRefl = bFrontKingRefl;
		game.bQueenImg = bFrontQueenImg; game.bQueenShdw = bFrontQueenShdw; game.bQueenRefl = bFrontQueenRefl;
		game.bBishopBlackSqImg = bFrontBishopBlackSqImg; game.bBishopWhiteSqImg = bFrontBishopWhiteSqImg; game.bBishopShdw = bFrontBishopShdw; game.bBishopRefl = bFrontBishopRefl;
		game.bRookImg = bFrontRookImg; game.bRookShdw = bFrontRookShdw; game.bRookRefl = bFrontRookRefl;
	} else if (game.playerColor == 'b') { // FLIPPED BOARD: WHITE'S SIDE IS THE TOP
		game.bKingImg = bBackKingImg; game.bKingShdw = bBackKingShdw; game.bKingRefl = bBackKingRefl;
		game.bQueenImg = bBackQueenImg; game.bQueenShdw = bBackQueenShdw; game.bQueenRefl = bBackQueenRefl;
		game.bBishopBlackSqImg = bBackBishopImg; game.bBishopWhiteSqImg = bBackBishopImg; game.bBishopShdw = bBackBishopShdw; game.bBishopRefl = bBackBishopRefl;
		game.bRookImg = bBackRookImg; game.bRookShdw = bBackRookShdw; game.bRookRefl = bBackRookRefl;
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
	if (game.playerColor == 'w') { // WHITE PAWNS FACE BLACK'S SIDE (THE TOP OF THE BOARD), BLACK PAWNS FACE THE PLAYER
		game.wPawnImg = wBackPawnImg; game.wPawnShdw = wBackPawnShdw; game.wPawnRefl = wBackPawnRefl;
		game.bPawnImg = bFrontPawnImg; game.bPawnShdw = bFrontPawnShdw; game.bPawnRefl = bFrontPawnRefl;
	} else if (game.playerColor == 'b') { // FLIPPED BOARD: BLACK PAWNS FACE WHITE'S SIDE (THE TOP), WHITE PAWNS FACE THE PLAYER
		game.wPawnImg = wFrontPawnImg; game.wPawnShdw = wFrontPawnShdw; game.wPawnRefl = wFrontPawnRefl;
		game.bPawnImg = bBackPawnImg; game.bPawnShdw = bBackPawnShdw; game.bPawnRefl = bBackPawnRefl;
	}
}
