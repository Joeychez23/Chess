/*
 *  main.js  --  chess frontend
 *	Chess Frontend
 *
 */

/* ---------------------------------------------------------------- */
// TOD0
/* ---------------------------------------------------------------- */
/**
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
import "../../css/style.css";

const { Chess } = require("chess.js");
const { validate } = require("./validate/index.js");
const { playerMove } = require("./user/index.js");
const { playAi } = require("./ai/index.js");
const { setTiles } = require("./utils/index.js");
const main = document.querySelector("#main");
const optBtn = document.getElementById("optBtn");
const menu = document.getElementById("menuContainer");
const optResumeBtn = document.getElementById("optResume");
const optRestartBtn = document.getElementById("optRestart");
const optHomepageBtn = document.getElementById("optSettings");
const optExitBtn = document.getElementById("optExit");
const canvas = document.createElement("canvas");
const resultDisplay = document.getElementById("resultDisplay");
const newGameInput = document.getElementsByClassName("newGameInput");

const OVERRIDE_TV = false;

/* ---------------------------------------------------------------- */
// Render Canvas
/* ---------------------------------------------------------------- */
/**
 * @description Renders canvas to main, and holds all associating canvas functions
 */
export async function renderCanvas(playerData) {
	const { GAME_URL, GAME_ID, PLAYER_ID, TV_BOOL } = playerData; // SETS CONSTANT GAME VARIABLES

	optBtn.style.display = "flex";

	const ctx = canvas.getContext("2d");
	canvas.id = "canvas";

	const chessInst = new Chess();
	const validateState = new Chess();
	let cw = (canvas.width = window.innerWidth);
	let ch = (canvas.height = window.innerHeight);
	let bw;
	let bh;
	let drawScreen;
	let refresh = true;
	let tileWidth;
	let tileHeight;
	let tileX;
	let tileY;
	let clientX;
	let clientY;
	let clickX;
	let clickY;
	let opponentColor;
	let ai
	let aiTurn = false;
	let response;
	let revert;
	let playerColor;
	let moveObj = [null, null]
	let tiles = setTiles();
	let boardWidth;
	let boardHeight;
	let xBoardStart;
	let yBoardStart;
	let xBoardOff;
	let yBoardOff;
	let offBoardRefresh = true;
	let wPieceCount = { king: 0, queen: 0, bishop: 0, knight: 0, rook: 0, pawn: 0 };
	let bPieceCount = { king: 0, queen: 0, bishop: 0, knight: 0, rook: 0, pawn: 0 };
	let wTakenPieces;
	let bTakenPieces;
	let clickedTile = false;
	let mousedownTile = false;
	let currPromotion = false;
	let currSlide = false;
	let slidePos;
	let slideStart = false;
	let menuToggled = false;
	let mouseDownCount = 0;
	let opposingMove = false;
	let boardReset = false;
	let availableMoves;
	let initialAnimation = true;
	// let initialRender = true;
	let currInst;
	let availableMovesData = { piece: null, square: null }
	let widthGreater;
	let portraitBoard = false;
	let touchState = null; // ACTIVE TOUCH (MOBILE): { id, startX, startY, dragging, point }
	const frameRate = 1000 / 33;
	const imagePaths = [];			// This will hold array of all loaded image resources
	const images = [];
	let imagememory = 0;
	const moveAudio = new Audio('./audio/piece-jump.mp4');

	let startTime = new Date();
	let endTime = new Date();
	let timeElapsed = endTime - startTime;

	let remoteNavBox = { x: 7, y: 0, menuHover: false, menuBtn: false }

	// !NOTE: IMAGE NUMBERS EQUALS INDEX USED TO CHECK IF ALL IMAGES ARE LOADING IN THE BACKGROUND

	loadImage("./images/board/table.webp");
	const tableShdw = 1; loadImage("./images/board/table-shdw.png");

	const boardImg = 2; loadImage("./images/board/chess-board.png");
	const boardShdw = 3; loadImage("./images/board/chess-board-shdw.webp")
	const rawBoardImg = 4; loadImage("./images/board/raw-board.png");

	const xBoardShadowRatio = 0.985;

	// WHITE IMAGES
	const wKingImg = 5; loadImage("./images/white-pieces/wk-e1.png");
	const wQueenImg = 6; loadImage("./images/white-pieces/wq-d1.png");
	const wBishopBlackSqImg = 7; loadImage("./images/white-pieces/wb-c1.png");
	const wBishopWhiteSqImg = 8; loadImage("./images/white-pieces/wb-f1.png");
	let wKnightImg;
	const wRightKnightImg = 9; loadImage("./images/white-pieces/wn-b1.png");
	const wLeftKnightImg = 10; loadImage("./images/white-pieces/wn-g1.png");
	const wRookImg = 11; loadImage("./images/white-pieces/wr-h1.png");
	const wPawnImg = 12; loadImage("./images/white-pieces/wp-a2.png");

	// WHITE SHADOW
	const wKingShdw = 13; loadImage("./images/white-pieces/wk-shdw.png");
	const wQueenShdw = 14; loadImage("./images/white-pieces/wq-shdw.png");
	const wBishopShdw = 15; loadImage("./images/white-pieces/wb-shdw.png");
	let wKnightShdw
	const wRightKnightShdw = 16; loadImage("./images/white-pieces/wn-b1-shdw.png");
	const wLeftKnightShdw = 17; loadImage("./images/white-pieces/wn-g1-shdw.png");
	const wRookShdw = 18; loadImage("./images/white-pieces/wr-shdw.png");
	const wPawnShdw = 19; loadImage("./images/white-pieces/wp-shdw.png");

	// WHITE REFLECT
	const wKingRefl = 20; loadImage("./images/white-pieces/wk-refl.png");
	const wQueenRefl = 21; loadImage("./images/white-pieces/wq-refl.png");
	const wBishopRefl = 22; loadImage("./images/white-pieces/wb-refl.png");
	let wKnightRefl
	const wRightKnightRefl = 23; loadImage("./images/white-pieces/wn-b1-refl.png");
	const wLeftKnightRefl = 24; loadImage("./images/white-pieces/wn-g1-refl.png");
	const wRookRefl = 25; loadImage("./images/white-pieces/wr-refl.png");
	const wPawnRefl = 26; loadImage("./images/white-pieces/wp-refl.png");

	// BLACK IMAGES
	const bKingImg = 27; loadImage("./images/black-pieces/bk-e8.png");
	const bQueenImg = 28; loadImage("./images/black-pieces/bq-d8.png");
	const bBishopBlackSqImg = 29; loadImage("./images/black-pieces/bb-f8.png");
	const bBishopWhiteSqImg = 30; loadImage("./images/black-pieces/bb-c8.png");
	let bKnightImg;
	const bRightKnightImg = 31; loadImage("./images/black-pieces/bn-b8.png");
	const bLeftKnightImg = 32; loadImage("./images/black-pieces/bn-g8.png");
	const bRookImg = 33; loadImage("./images/black-pieces/br-h8.png");
	const bPawnImg = 34; loadImage("./images/black-pieces/bp-a7.png");

	// BLACK SHADOW
	const bKingShdw = 35; loadImage("./images/black-pieces/bk-shdw.png");
	const bQueenShdw = 36; loadImage("./images/black-pieces/bq-shdw.png");
	const bBishopShdw = 37; loadImage("./images/black-pieces/bb-shdw.png");

	let bKnightShdw;
	const bRightKnightShdw = 38; loadImage("./images/black-pieces/bn-b8-shdw.png");
	const bLeftKnightShdw = 39; loadImage("./images/black-pieces/bn-g8-shdw.png");
	const bRookShdw = 40; loadImage("./images/black-pieces/br-shdw.png");
	const bPawnShdw = 41; loadImage("./images/black-pieces/bp-shdw.png");

	// BLACK REFLECT
	const bKingRefl = 42; loadImage("./images/black-pieces/bk-refl.png");
	const bQueenRefl = 43; loadImage("./images/black-pieces/bq-refl.png");
	const bBishopRefl = 44; loadImage("./images/black-pieces/bb-refl.png");
	let bKnightRefl;
	const bRightKnightRefl = 45; loadImage("./images/black-pieces/bn-b8-refl.png");
	const bLeftKnightRefl = 46; loadImage("./images/black-pieces/bn-g8-refl.png");
	const bRookRefl = 47; loadImage("./images/black-pieces/br-refl.png");
	const bPawnRefl = 48; loadImage("./images/black-pieces/bp-refl.png");

	// UI
	const moveHighlight = 49; loadImage("./images/chess-ui/move-highlight.png");
	const takeableHighlight = 50; loadImage("./images/chess-ui/takeable-highlight.png");
	const checkHighlight = 51; loadImage("./images/chess-ui/check-highlight.png");

	loadImage("./images/board/coffee.png"); // 52
	loadImage("./images/board/coffee-shdw.png"); // 53

	loadImage("./images/board/cards.png"); // 54
	loadImage("./images/board/cards-shdw.png"); // 55

	loadImage("./images/board/candle.png"); // 56
	loadImage("./images/board/candle-shdw.png") // 57

	let coffeeObj = { img: [], img2: 52, shdw: 53, x: null, y: null, width: null, height: null }
	let deckObj = { img: [], img2: 54, shdw: 55, x: null, y: null, width: null, height: null }
	let candleObj = { img: [], img2: 56, shdw: 57, x: null, y: null, width: null, height: null }

	let loadedImages = 0;

	/* ---------------------------------------------------------------- */
	// Load Image
	/* ---------------------------------------------------------------- */
	/**
	 * @description Loads image
	 */
	async function loadImage(path) {
		return new Promise(function (resolve) {
			if (path.indexOf('.') == -1) path += '.png';			// If no file extension provided, default to .png (lowercase is important for linux)
			if (imagePaths.indexOf(path) == -1) {					// First, check to see if image is already loaded and available
				let img = new Image();
				img.src = path;
				images.push({ "path": path, "image": img });		// Save it right away
				img.onload = (() => {
					imagememory += (img.naturalWidth * img.naturalHeight) * 4;
					console.log('loadImage():Total Memory allocated:' + imagememory + ' for:' + path);
					loadedImages += 1
					resolve(img);
				});
				imagePaths.push(path);								// Add the new path to the imagePaths array
			}
			else													// It's already been loaded
				for (let i = 0; i < images.length; i++) { if (images[i].path == path) { resolve(images[i].image); } }
		})
	}


	/* ---------------------------------------------------------------- */
	// Check Image Loaded
	/* ---------------------------------------------------------------- */
	/**
	 * @description If all images are loaded start game
	 */
	const startGameCheck = setInterval(async function () { if (loadedImages == images.length) { startGame(); clearInterval(startGameCheck) } }, 1000);


	/* ---------------------------------------------------------------- */
	// Start Game
	/* ---------------------------------------------------------------- */
	/**
	 * @description Starts the core game interval loop
	 */
	async function startGame() {
		let refreshDataStartTime = Date.now();
		let coffeeStartTime = Date.now();
		let renderCoffeeImg = false;

		wTakenPieces = setTakenPieceArr("b");
		bTakenPieces = setTakenPieceArr("w");

		let xPieceOffset; // Width of the tile proportionality to the board width
		let yPieceOffset; // Height of the tile proportionality to the board height

		let xPos;
		let yPos;

		refreshDataStartTime = Date.now();
		coffeeStartTime = Date.now();

		let overlapSlideObj = null;

		let yPositive = false;
		let xPositive = false;

		cw = 0;
		ch = 0;

		await setInitialData(); // SETS INITIAL DATA
		handleInitialData(); // HANDLES INITIAL DATA


		canvas.style.backgroundRepeat = "repeat-y";
		canvas.style.backgroundImage = 'url("./images/board/table.webp")';
		canvas.style.backgroundSize = "cover";
		canvas.style.backgroundPosition = "center";
		window.postMessage({
			action: "ready",          		 // Action key.
			receiptToken: "{receipt-token}", // Receipt validation token.
		})
		main.append(canvas);
		
		/* ################################################################ */
		/* ################################################################ */
		// CORE RENDER LOOP
		/* ################################################################ */
		/* ################################################################ */
		const drawInterval = setInterval(async function () {
			const endTime = Date.now();
			initialAnimation = false;
			if ((refresh || currSlide) && !boardReset) {
				try {
					if (initialAnimation) { renderBoardAnimation(currInst); refresh = true; }
					else {
						if (ai && chessInst.turn() != playerColor && aiTurn) { // IF AI
							revert = response;
							moveObj = playAi(chessInst, opponentColor); // IF PLAYER MOVE IS VALID -> MAKE AI MOVE
							validateState.load(response.game_board);
							validateState.move(moveObj);
							for (let i = 0; i < tiles.length; i++) {
								if (tiles[i].square == moveObj.from) {
									slideStart = true;
									tiles[i].isSliding = true;
									if (playerColor == 'w') {
										tiles[i].xSlideTo = moveObj.to.split("")[0].charCodeAt(0) - 96 - 1;
										tiles[i].ySlideTo = 8 - moveObj.to.split("")[1];
									} else if (playerColor == 'b') {
										tiles[i].xSlideTo = 8 - (moveObj.to.split("")[0].charCodeAt(0) - 96);
										tiles[i].ySlideTo = moveObj.to.split("")[1] - 1;
									}
									tiles[i].xDiff = 0;
									tiles[i].yDiff = 0;
								} else if (tiles[i].isSliding) {
									tiles[i].isSliding = false;
									tiles[i].xDiff = 0;
									tiles[i].yDiff = 0;
								}
							}
							aiTurn = false;
							currSlide = true;
							startTime = new Date();
							return;
						}
						drawScreen();
						refresh = false;
					}
				} catch (err) { console.log(err); }
			}
			if ((endTime - refreshDataStartTime > 2000) && !ai) { await checkOpponentMove(); } // PROMOTIONS OF OPPOSING PLAYER THROWS INVALID MOVE
		}, frameRate);

		/* ################################################################ */
		/* ################################################################ */
		// CORE GAME FUNCTIONS
		/* ################################################################ */
		/* ################################################################ */

		/* ---------------------------------------------------------------- */
		// Start Animation
		/* ---------------------------------------------------------------- */
		/**
		 * @description Animates board from a position
		 */
		function renderBoardAnimation(inst) {
			renderBoard();
			let index = 0;
			let totalSlide = 0;
			let completedSlide = 0;
			for (let i = 0; i < inst.length; i++) { // ROW
				for (let j = 0; j < inst[i].length; j++, index++) { // COLUMN
					tiles[index] = { ...inst[i][j], ...tiles[index], x: -1, y: -1 }; // TILE[INDEX] = DECONSTRUCTED ARRAY OF CHESS BOARD ROW/COLUMN, TILE[INDEX] INIT VALUES, X, Y
					if (inst[i][j]) {
						tiles[index].isSliding = true;
						totalSlide += 1;
						tiles[index].xSlideTo = j;
						tiles[index].ySlideTo = i;

						/* ---------------------------------------------------------------- */
						// Draw image
						/* ---------------------------------------------------------------- */
						/**
						 * @description Draws active piece to canvas
						 */
						async function drawActivePiece(imgArr) {
							for (let w = 0; w < imgArr.length; w++) {
								if (w == 0) { ctx.globalAlpha = 0.30; }
								else if (w == 1) { ctx.globalAlpha = 0.75; }
								else if (w == 2) { ctx.globalAlpha = 1; }

								if (tiles[index].isSliding) { // IF TILE IS SLIDING
									const xChange = (frameRate / tileHeight) * 5;
									const yChange = (frameRate / tileWidth) * 5;
									let endTileX;
									let endTileY;
									let xBool = false;
									let yBool = false;
									// X
									if (tiles[index].xSlideTo > tiles[index].x) { // X: Greater
										endTileX = tiles[index].xSlideTo - tiles[index].x;
										if (((tiles[index].x * tileWidth) + tiles[index].xDiff > ((tiles[index].x * tileWidth) + (tileWidth * endTileX)))) { xBool = true }
										else {
											tiles[index].xDiff = tiles[index].xDiff + xChange
										}
									} else if (tiles[index].xSlideTo < tiles[index].x) { // X: Less
										endTileX = tiles[index].x - tiles[index].xSlideTo;
										if (((tiles[index].x * tileWidth) + tiles[index].xDiff < ((tiles[index].x * tileWidth) - (tileWidth * endTileX)))) { xBool = true }
										else { tiles[index].xDiff = tiles[index].xDiff - xChange }
									} else { xBool = true } // X: Zero
									// Y
									if (tiles[index].ySlideTo > tiles[index].y) { // Y: Greater
										endTileY = tiles[index].ySlideTo - tiles[index].y;
										if (((tiles[index].y * tileHeight) - tiles[index].yDiff > ((tiles[index].y * tileHeight) + (tileHeight * endTileY)))) { yBool = true; }
										else { tiles[index].yDiff = tiles[index].yDiff - yChange }
									} else if (tiles[index].ySlideTo < tiles[index].y) { // Y: Less
										endTileY = tiles[index].y - tiles[index].ySlideTo;
										if (((tiles[index].y * tileHeight) - tiles[index].yDiff < ((tiles[index].y * tileHeight) - (tileHeight * endTileY)))) { yBool = true }
										else { tiles[index].yDiff = tiles[index].yDiff + yChange }
									} else { yBool = true } // Y: Zero
									try {
										if (xBool && yBool) {
											tiles[index].isSliding = false;
											ctx.drawImage(images[imgArr[w]].image, ((tiles[index].xSlideTo * tileWidth) + xBoardOff) - xPieceOffset / 2, ((tiles[index].ySlideTo * tileHeight) - yPieceOffset / 2) - ((tileHeight / 10) - yBoardOff), tileWidth + xPieceOffset, tileHeight + yPieceOffset);
											completedSlide += 1;
										} else { ctx.drawImage(images[imgArr[w]].image, (((tiles[index].x * tileWidth) + tiles[index].xDiff) + xBoardOff) - xPieceOffset / 2, ((((tiles[index].y * tileHeight) - tiles[index].yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset); }
									} catch (err) { return; }
								} else {
									ctx.drawImage(images[imgArr[w]].image, ((tiles[index].xSlideTo * tileWidth) + xBoardOff) - xPieceOffset / 2, ((tiles[index].ySlideTo * tileHeight) - yPieceOffset / 2) - ((tileHeight / 10) - yBoardOff), tileWidth + xPieceOffset, tileHeight + yPieceOffset)
								} // DRAWING IMAGE WITH SLIDING FALSE
							}
						}

						if (inst[i][j]) { // IF CURRENT INDEX OF A TILE EXISTS
							tiles[index].originX = j;
							tiles[index].originY = i;
							const pieceType = inst[i][j].type;
							const pieceColor = inst[i][j].color;
							if (!currPromotion) {
								if (pieceType.match(/[k]/) && pieceColor) { // CHECKS CURRENT INDEX FOR KING
									if (pieceColor == "w") { drawActivePiece([wKingRefl, wKingShdw, wKingImg]); }
									else if (pieceColor == "b") { drawActivePiece([bKingRefl, bKingShdw, bKingImg]); }
								} else if (pieceType.match(/[q]/) && pieceColor) { // CHECKS CURRENT INDEX FOR QUEEN
									if (pieceColor == "w") { drawActivePiece([wQueenRefl, wQueenShdw, wQueenImg]); }
									else if (pieceColor == "b") { drawActivePiece([bQueenRefl, bQueenShdw, bQueenImg]); }
								} else if (pieceType.match(/[b]/) && pieceColor) { // CHECKS CURRENT INDEX FOR BISHOP
									if (pieceColor == "w") {
										if (chessInst.squareColor(tiles[index].square) == 'light') { drawActivePiece([wBishopRefl, wBishopShdw, wBishopWhiteSqImg]); }
										else if (chessInst.squareColor(tiles[index].square) == 'dark') { drawActivePiece([wBishopRefl, wBishopShdw, wBishopBlackSqImg]); }
									} else if (pieceColor == "b") {
										if (chessInst.squareColor(tiles[index].square) == 'light') { drawActivePiece([bBishopRefl, bBishopShdw, bBishopWhiteSqImg]); }
										else if (chessInst.squareColor(tiles[index].square) == 'dark') { drawActivePiece([wBishopRefl, bBishopShdw, bBishopBlackSqImg]); }
									}
								} else if (pieceType.match(/[n]/) && pieceColor) { // CHECKS CURRENT INDEX FOR KNIGHT
									/* ---------------------------------------------------------------- */
									// Draw Knight (Board Animation)
									/* ---------------------------------------------------------------- */
									/**
									 * @description Draws the knight to the board
									 */
									function drawKnight() {
										if (pieceColor == 'w') {
											if (tiles[index].isMousedown) {
												if (tiles[index].x < tiles[index].originX && playerColor == pieceColor) { wKnightImg = wLeftKnightImg; wKnightShdw = wLeftKnightShdw; wKnightRefl = wLeftKnightRefl; drawActivePiece([wKnightRefl, wKnightShdw, wKnightImg]); }
												else if (tiles[index].x > tiles[index].originX && playerColor == pieceColor) { wKnightImg = wRightKnightImg; wKnightShdw = wRightKnightShdw; wKnightRefl = wRightKnightRefl; drawActivePiece([wKnightRefl, wKnightShdw, wKnightImg]); }
												else { drawActivePiece([wKnightRefl, wKnightShdw, wKnightImg]); }
											} else { drawActivePiece([wKnightRefl, wKnightShdw, wKnightImg]); }
										} else if (pieceColor == 'b') {
											if (tiles[index].isMousedown) {
												if (tiles[index].x < tiles[index].originX && playerColor == pieceColor) { bKnightImg = bLeftKnightImg; bKnightShdw = bLeftKnightShdw; bKnightRefl = bLeftKnightRefl; drawActivePiece([bKnightRefl, bKnightShdw, bKnightImg]); }
												else if (tiles[index].x > tiles[index].originX && playerColor == pieceColor) { bKnightImg = bRightKnightImg; bKnightShdw = bRightKnightShdw; bKnightRefl = bRightKnightRefl; drawActivePiece([bKnightRefl, bKnightShdw, bKnightImg]); }
												else { drawActivePiece([bKnightRefl, bKnightShdw, bKnightImg]); }
											} else { drawActivePiece([bKnightRefl, bKnightShdw, bKnightImg]); }
										}
									}
									if (pieceColor == "w") { // WHITE KNIGHT
										let xFrom;
										let xTo;
										for (let n = 0; n < JSON.parse(response.w_knight).length; n++) {
											if (JSON.parse(response.w_knight)[n].from && (JSON.parse(response.w_knight)[n].to == tiles[index].square)) {
												if (playerColor == 'w') {
													xFrom = JSON.parse(response.w_knight)[n].from.split("")[0].charCodeAt(0) - 96 - 1;
													xTo = JSON.parse(response.w_knight)[n].to.split("")[0].charCodeAt(0) - 96 - 1;
												} else if (playerColor == 'b') {
													xFrom = JSON.parse(response.w_knight)[n].from.split("")[0].charCodeAt(0) - 96 - 1;
													xTo = JSON.parse(response.w_knight)[n].to.split("")[0].charCodeAt(0) - 96 - 1;
												}
												handleKnightDirectionW(xFrom, xTo);
												drawKnight();
												break;
											} else if (JSON.parse(response.w_knight)[n].from == null && JSON.parse(response.w_knight)[n].to) {
												if (playerColor == 'w') {
													if (JSON.parse(response.w_knight)[n].to == 'b1' && tiles[index].square == 'b1') { wKnightImg = wRightKnightImg; wKnightShdw = wRightKnightShdw; wKnightRefl = wRightKnightRefl; drawKnight(); break; }
													else if (JSON.parse(response.w_knight)[n].to == tiles[index].square) { wKnightImg = wLeftKnightImg; wKnightShdw = wLeftKnightShdw; wKnightRefl = wLeftKnightRefl; drawKnight(); break; }
												} else if (playerColor == 'b') {
													if (JSON.parse(response.w_knight)[n].to == 'b1' && tiles[index].square == 'b1') { wKnightImg = wLeftKnightImg; wKnightShdw = wLeftKnightShdw; wKnightRefl = wLeftKnightRefl; drawKnight(); break; }
													else if (JSON.parse(response.w_knight)[n].to == tiles[index].square) { wKnightImg = wRightKnightImg; wKnightShdw = wRightKnightShdw; wKnightRefl = wRightKnightRefl; drawKnight(); break; }
												}
											}
										}
									} else if (pieceColor == "b") { // BLACK KNIGHT
										let xFrom;
										let xTo;
										for (let n = 0; n < JSON.parse(response.b_knight).length; n++) {
											if (JSON.parse(response.b_knight)[n].from && JSON.parse(response.b_knight)[n].to == tiles[index].square) {
												if (playerColor == 'w') {
													xFrom = JSON.parse(response.b_knight)[n].from.split("")[0].charCodeAt(0) - 96 - 1;
													xTo = JSON.parse(response.b_knight)[n].to.split("")[0].charCodeAt(0) - 96 - 1;
												} else if (playerColor == 'b') {
													xFrom = 8 - (JSON.parse(response.b_knight)[n].from.split("")[0].charCodeAt(0) - 96);
													xTo = 8 - (JSON.parse(response.b_knight)[n].to.split("")[0].charCodeAt(0) - 96);
												}
												handleKnightDirectionB(xFrom, xTo);
												drawKnight();
											} else if (JSON.parse(response.b_knight)[n].from == null && JSON.parse(response.b_knight)[n].to) {
												if (playerColor == 'w') {
													if (JSON.parse(response.b_knight)[n].to == 'b8' && tiles[index].square == 'b8') { bKnightImg = bRightKnightImg; bKnightShdw = bRightKnightShdw; bKnightRefl = bRightKnightRefl; drawKnight(); }
													else if (JSON.parse(response.b_knight)[n].to == tiles[index].square) { bKnightImg = bLeftKnightImg; bKnightShdw = bLeftKnightShdw; bKnightRefl = bLeftKnightRefl; drawKnight(); }
												} else if (playerColor == 'b') {
													if (JSON.parse(response.b_knight)[n].to == 'b8' && tiles[index].square == 'b8') { bKnightImg = bLeftKnightImg; bKnightShdw = bLeftKnightShdw; bKnightRefl = bLeftKnightRefl; drawKnight(); }
													else if (JSON.parse(response.b_knight)[n].to == tiles[index].square) { bKnightImg = bRightKnightImg; bKnightShdw = bRightKnightShdw; bKnightRefl = bRightKnightRefl; drawKnight(); }
												}
											}
										}
									}
								} else if (pieceType.match(/[r]/) && pieceColor) { // CHECKS CURRENT INDEX FOR ROOK
									if (pieceColor == "w") { drawActivePiece([wRookRefl, wRookShdw, wRookImg]); wPieceCount.rook++; }
									else if (pieceColor == "b") { drawActivePiece([bRookRefl, bRookShdw, bRookImg]); bPieceCount.rook++; }
								} else if (pieceType.match(/[p]/) && pieceColor) { // CHECKS CURRENT INDEX FOR PAWN
									if (pieceColor == "w") { drawActivePiece([wPawnRefl, wPawnShdw, wPawnImg]); }
									else if (pieceColor == "b") { drawActivePiece([bPawnRefl, bPawnShdw, bPawnImg]); }
								}
							}
						}
					}
				}
			}
			if (completedSlide == totalSlide) { initialAnimation = false; tiles = setTiles(); }
		}


		/* ---------------------------------------------------------------- */
		// Set Initial Board Data
		/* ---------------------------------------------------------------- */
		/**
		 * @description Sets initial data
		 */
		async function setInitialData() {
			if (PLAYER_ID == "LAKESIDE_GUEST_USER") {
				await validate(GAME_URL, GAME_ID, PLAYER_ID, false, false, 'b');
			} else if (PLAYER_ID === GAME_ID && PLAYER_ID && GAME_ID) {
				response = await validate(GAME_URL, GAME_ID, PLAYER_ID, false, false, false);
				if (!response?.game_board) { response = await validate(GAME_URL, GAME_ID, PLAYER_ID, false, false, 'b'); }
			}
			response = await validate(GAME_URL, GAME_ID, PLAYER_ID, false, false, false);
			playerColor = response?.player_color || null;
			if (response.status == 200) { // IF GAME IS ON AI TURN, PLAY TURN
				opponentColor = response?.opponent_color || false;
				chessInst.load(response.game_board);
				if (chessInst.isGameOver()) {
					menuToggled = true;
					menu.style.display = "flex"
					optResumeBtn.parentElement.style.display = 'none';
					if (playerColor == 'w') { resultDisplay.innerText = "White Wins!" }
					else if (playerColor == 'b') { resultDisplay.innerText = "Black Wins!" }

					handleRemoteMenuEnter(optRestartBtn);
					return;
				}

				// NOTE : CONDITONALIZE BACK END TO SUPPORT DETIRMINING AI COLOR OR REAL OPPONENT COLOR
				// THEN : CONDITIONALIZE BOARD ACCORDINGLY

				if (chessInst.turn() == playerColor) { opposingMove = false; } else { opposingMove = true; }
				if (response.ai) {
					ai = true;
					if (opponentColor == chessInst.turn()) { //PLAY AI MOVE
						moveObj = playAi(chessInst, opponentColor); // IF PLAYER MOVE IS VALID -> MAKE AI MOVE
						tiles = await setTiles();
						aiTurn = true;
						refresh = true;
						setTimeout(function () { aiTurn = true; refresh = true; }, 500);
						return;
					}

				}
			} else {
				return false;
			}
		}

		/* ---------------------------------------------------------------- */
		// Handle Initial Data Response
		/* ---------------------------------------------------------------- */
		/**
		 * @description Sets drawScreen & gamedata based on player color
		 */
		function handleInitialData() {
			if (playerColor == "w") { // DRAW SCREEN W
				currInst = chessInst.board();
				drawScreen = async function () {
					const boardData = renderBoard();
					clickX = boardData.clickX;
					clickY = boardData.clickY;
					currInst = chessInst.board();
					overlapSlideObj = null
					renderPiecesToBoard(currInst, clickX, clickY, true);
					if (currPromotion) { // IF A USER PAWN PROMOTION IS ACTIVE
						if (playerColor == 'w') { bTakenPieces = setTakenPieceArr(playerColor); renderTakenPieces(bTakenPieces, opponentColor); }
						else if (playerColor == 'b') { wTakenPieces = setTakenPieceArr(playerColor); renderTakenPieces(wTakenPieces, opponentColor); }
					} else {
						wTakenPieces = setTakenPieceArr(playerColor);
						bTakenPieces = setTakenPieceArr(opponentColor);
						renderTakenPieces(wTakenPieces, opponentColor);
						renderTakenPieces(bTakenPieces, playerColor)
					}

					ctx.globalAlpha = 0.05
					ctx.drawImage(images[tableShdw].image, 0, 0, cw, ch); // RENDER TABLE SHDW
					ctx.globalAlpha = 1;
				}
			} else if (playerColor == "b") { // DRAW SCREEN W
				currInst = chessInst.board().reverse();
				for (let i = currInst.length - 1; i >= 0; i--) { currInst[i] = currInst[i].reverse(); }
				drawScreen = async function () {
					const boardData = renderBoard();
					clickX = boardData.clickX;
					clickY = boardData.clickY;
					currInst = chessInst.board().reverse();
					for (let i = currInst.length - 1; i >= 0; i--) { currInst[i] = currInst[i].reverse(); }
					overlapSlideObj = null
					renderPiecesToBoard(currInst, clickX, clickY, true);
					if (currPromotion) { // IF A USER PAWN PROMOTION IS ACTIVE
						if (playerColor == 'w') { bTakenPieces = setTakenPieceArr(playerColor); renderTakenPieces(bTakenPieces, opponentColor); }
						else if (playerColor == 'b') { wTakenPieces = setTakenPieceArr(playerColor); renderTakenPieces(wTakenPieces, opponentColor); }
					} else {
						wTakenPieces = setTakenPieceArr(opponentColor);
						bTakenPieces = setTakenPieceArr(playerColor);
						renderTakenPieces(wTakenPieces, playerColor);
						renderTakenPieces(bTakenPieces, opponentColor);
					}

					ctx.globalAlpha = 0.05
					ctx.drawImage(images[tableShdw].image, 0, 0, cw, ch); // RENDER TABLE SHDW
					ctx.globalAlpha = 1;
				}
			}
		}

		/* ---------------------------------------------------------------- */
		// Draw Board / Set Variables Accordingly
		/* ---------------------------------------------------------------- */
		/**
		 * @description Initializes draw data which sets positions onto the board
		 */
		function renderBoard() {
			cw = window.innerWidth;
			ch = window.innerHeight;
			const dpr = Math.min(window.devicePixelRatio || 1, 2); // RENDER AT DEVICE RESOLUTION (CAPPED) SO THE BOARD IS SHARP ON HIGH DPI / MOBILE SCREENS
			canvas.width = Math.round(cw * dpr);
			canvas.height = Math.round(ch * dpr);
			canvas.style.width = `${cw}px`;
			canvas.style.height = `${ch}px`;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // ALL DRAWING STAYS IN CSS PIXELS
			portraitBoard = cw < ch;
			let boardPadding = 1.4;
			boardWidth = cw / boardPadding;
			boardHeight = (9 * (cw / boardPadding)) / 11;
			// SET MENU ELEMENT SIZING

			const resultDisplay = document.getElementById("resultDisplay");
			const menuBox = document.getElementById("menuBox");
			const menuButtons = document.getElementsByClassName("menuButton");

			if ((ch / cw) > .225) {
				let menuSize = ((ch) * .90);
				if (Math.min(cw, ch) < 600) { menuSize = Math.min(ch * 1.9, cw * 2.2); } // SMALL (MOBILE) SCREENS: GROW MENU TO FIT THE SCREEN SO BUTTONS ARE TAPPABLE
				menu.style.width = `${Math.min(menuSize, cw)}px`; // CONTAINER NEVER WIDER / TALLER THAN THE SCREEN, MOBILE BROWSERS ZOOM OUT TO FIT OVERFLOW
				menu.style.height = `${Math.min(9 * (menuSize) / 16, ch)}px`;
				menuBox.style.width = `${menuSize * .375}px`;
				menuBox.style.height = `${(9 * (menuSize) / 16) * .7}px`;

				for (let i = 0; i < menuButtons.length; i++) {
					menuButtons[i].style.fontSize = `${(menuSize) * .035}px`
					for (let i = 0; i < newGameInput.length; i++) {
						newGameInput[i].style.fontSize = `${Math.max(16, (menuSize) * .035)}px` // >= 16PX STOPS IOS FROM ZOOMING IN ON INPUT FOCUS
					}
				}
				resultDisplay.style.fontSize = `${(menuSize) * .05}px`
			}

			let widthOverHeight, smBoard = false;
			if (canvas.width) { // ASPECT RATIO OF BOARD WITH MARBLE IF CANVAS WIDTH > HEIGHT
				if (cw > ch * (boardPadding - 0.2)) {
					widthOverHeight = true;
					boardHeight = ch / boardPadding;
					boardWidth = (11 * (ch / boardPadding)) / 9;
					if (cw * .5875 > ch) { // LARGE BOARD
						renderCoffeeImg = true;
						widthGreater = true;
						boardPadding = 1.2;
						boardHeight = ch / boardPadding;
						boardWidth = (11 * (ch / boardPadding)) / 9;
					} else if (cw > ch * (boardPadding + 0.215)) { // MEDIUM BOARD
						renderCoffeeImg = true;
						widthGreater = true;
						boardPadding = 1.25;
						boardHeight = ch / boardPadding;
						boardWidth = (11 * (ch / boardPadding)) / 9;
					} else { // SMALL BOARD
						smBoard = true;
						renderCoffeeImg = false;
						widthGreater = false;
						boardPadding = 1.4;
						boardHeight = ch / boardPadding;
						boardWidth = (11 * (ch / boardPadding)) / 9;
					}
				} else {
					renderCoffeeImg = false;
					widthGreater = false;
					if (portraitBoard) { // PORTRAIT (MOBILE) BOARD: FILL THE WIDTH, LEAVING HEIGHT FOR THE TAKEN PIECE ROWS ABOVE & BELOW
						boardWidth = Math.min(cw * 0.98, ch * 0.8);
						boardHeight = (9 * boardWidth) / 11;
					}
				}
			}

			xBoardStart = (cw - boardWidth) / 2; // DIFFERENCE OF THE X AXIS MARBLE EDGES OF THE BOARD TO JUST THE BOARD
			yBoardStart = (ch - boardHeight) / 2; // DIFFERENCE OF THE Y AXIS MARBLE EDGES OF THE BOARD TO JUST THE BOARD

			ctx.drawImage(images[tableShdw].image, 0, 0, cw, ch); // RENDER TABLE SHDW
			ctx.drawImage(images[boardShdw].image, xBoardStart, yBoardStart, boardWidth, boardHeight); // RENDER BOARD SHADOW
			ctx.drawImage(images[boardImg].image, xBoardStart, yBoardStart, boardWidth, boardHeight); // RENDER BOARD

			bw = (boardWidth - (boardWidth * (images[boardImg].image.naturalWidth - images[rawBoardImg].image.naturalWidth) / images[boardImg].image.naturalWidth)) // THE WIDTH OF THE CHESS BOARD NO MARBLE
			bh = (boardHeight - (boardHeight * (images[boardImg].image.naturalHeight - images[rawBoardImg].image.naturalHeight) / images[boardImg].image.naturalHeight)) // THE HEIGHT OF THE CHESS BOARD NO MARBLE
			xBoardOff = ((cw - (bw * xBoardShadowRatio)) / 2) //* xBoardShadowRatio; // WHERE THE FIRST TILE OF THE CHESS BOARD STARTS X
			yBoardOff = (ch - bh) / 2; // WHERE THE FIRST TILE OF THE CHESS BOARD STARTS Y
			tileWidth = bw / 8;
			tileHeight = bh / 8;

			xPieceOffset = bw / 5.75;
			yPieceOffset = bh / 4.25;

			let clickX = tileX * tileWidth;
			let clickY = tileY * tileHeight;
			wPieceCount = { king: 0, queen: 0, bishop: 0, knight: 0, rook: 0, pawn: 0 }; // OBJECT STORE OF TAKEN PIECES ON THE BOARD FOR WHITE
			bPieceCount = { king: 0, queen: 0, bishop: 0, knight: 0, rook: 0, pawn: 0 }; // OBJECT STORE OF TAKEN PIECES ON THE BOARD FOR BLACK

			if (widthOverHeight) {
				coffeeObj.height = tileHeight * 3.5;
				coffeeObj.width = (9 * coffeeObj.height) / 10;
				coffeeObj.x = ((cw - xBoardStart) + coffeeObj.width / 8);
				coffeeObj.y = ((ch - yBoardStart) - (tileHeight * 3) - coffeeObj.height);

				deckObj.height = tileHeight * 2.5;
				deckObj.width = (9 * deckObj.height) / 10;
				deckObj.x = (xBoardStart - (deckObj.width + tileWidth));
				deckObj.y = ((ch - yBoardStart) - (tileHeight * 3) - deckObj.height);

				candleObj.width = tileWidth * 2.5;
				candleObj.height = (9 * candleObj.width) / 10;
				candleObj.x = (xBoardStart - (candleObj.width + (tileWidth * .75)));
				candleObj.y = (yBoardStart);
				if (smBoard) { // Small Board
					boardPadding = 1.4;
					coffeeObj.height = 0;
					coffeeObj.width = 0;
					deckObj.height = 0;
					deckObj.width = 0;
					candleObj.height = 0;
					candleObj.width = 0;
				}
			}

			if (renderCoffeeImg) {
				renderCoffee();
				ctx.drawImage(images[deckObj.shdw].image, deckObj.x, deckObj.y, deckObj.width, deckObj.height);
				ctx.drawImage(images[deckObj.img2].image, deckObj.x, deckObj.y, deckObj.width, deckObj.height);
				ctx.drawImage(images[candleObj.shdw].image, candleObj.x, candleObj.y, candleObj.width, candleObj.height);
				ctx.drawImage(images[candleObj.img2].image, candleObj.x, candleObj.y, candleObj.width, candleObj.height);
			}
			return { clickX, clickY }
		}

		/* ---------------------------------------------------------------- */
		// Renders Data Game Instance data
		/* ---------------------------------------------------------------- */
		/**
		 * @param [inst] A object array which reperesents the current game board to be rendered
		 * @description Renders game data based on input params
		 */
		function renderPiecesToBoard(inst, clickX, clickY, lightObstruction) {
			let x, y;
			let index = 0;

			/* ################################################################ */
			// if (!remoteNavBox.menuHover && !menuToggled && TV_BOOL || OVERRIDE_TV) {  ctx.drawImage(images[checkHighlight].image, remoteNavBox.x * tileWidth + xBoardOff, (remoteNavBox.y * tileHeight - tileHeight / 10 + yBoardOff), tileWidth, tileHeight);  }
			/* ################################################################ */

			for (let i = 0; i < inst.length; i++) { // ROW
				for (let j = 0; j < inst[i].length; j++, index++) { // COLUMN
					tiles[index] = { ...inst[i][j], ...tiles[index], x: j, y: i }; // TILE[INDEX] = DECONSTRUCTED ARRAY OF CHESS BOARD ROW/COLUMN, TILE[INDEX] INIT VALUES, X, Y
					if (inst[i][j]) { // IF CURRENT INDEX OF A TILE EXISTS
						if (tiles[index].isMousedown) { // IF MOUSEDOWN SET PIECE TO MOUSE POSITION
							if (mouseDownCount > 3) { tiles[index].isClicked = true; } else { mouseDownCount += 1; }
							tiles[index].x = tileX;
							tiles[index].y = tileY;
							x = clickX + xBoardOff;
							y = clickY - tileHeight / 5 + yBoardOff;
						} else if (tiles[index].isClicked) { // IF CLICKED
							x = tiles[index].x * tileWidth + xBoardOff;
							y = tiles[index].y * tileHeight - tileHeight / 5 + yBoardOff;
						} else { // IF CLICKED IS FALSE SET PIECE BASED ON POSITION DEFINED BY FEN
							x = tiles[index].x * tileWidth + xBoardOff;
							y = tiles[index].y * tileHeight - tileHeight / 10 + yBoardOff;
						}
					}

					/* ---------------------------------------------------------------- */
					// Check & Render Available Moves
					/* ---------------------------------------------------------------- */
					/**
					 * @description Renders Emply possible pieces moves & pressured piece moves
					 */
					function checkAvailableMoves() {
						/* ---------------------------------------------------------------- */
						// Draw Tiles (Available Moves)
						/* ---------------------------------------------------------------- */
						/**
						 * @description Draws Tiles to Canvas
						 */
						function drawTiles(tile, pieceType, pieceColor, x, y) {
							if (pieceType.match(/[k]/) && pieceColor) { // CHECKS CURRENT INDEX FOR KING
								if (pieceColor == "w") { drawActivePiece([wKingRefl, wKingShdw, wKingImg], x, y, false); wPieceCount.king++; }
								else if (pieceColor == "b") { drawActivePiece([bKingRefl, bKingShdw, bKingImg], x, y, false); bPieceCount.king++; }
							} else if (pieceType.match(/[q]/) && pieceColor) { // CHECKS CURRENT INDEX FOR QUEEN
								if (pieceColor == "w") { drawActivePiece([wQueenRefl, wQueenShdw, wQueenImg], x, y, false); wPieceCount.queen++; }
								else if (pieceColor == "b") { drawActivePiece([bQueenRefl, bQueenShdw, bQueenImg], x, y, false); bPieceCount.queen++; }
							} else if (pieceType.match(/[b]/) && pieceColor) { // CHECKS CURRENT INDEX FOR BISHOP
								if (pieceColor == "w") {
									if (chessInst.squareColor(tile.square) == 'light') { drawActivePiece([wBishopRefl, wBishopShdw, wBishopWhiteSqImg], x, y, false); wPieceCount.bishop++; }
									else if (chessInst.squareColor(tile.square) == 'dark') { drawActivePiece([wBishopRefl, wBishopShdw, wBishopBlackSqImg], x, y, false); wPieceCount.bishop++; }
								} else if (pieceColor == "b") {
									if (chessInst.squareColor(tile.square) == 'light') { drawActivePiece([bBishopRefl, bBishopShdw, bBishopWhiteSqImg], x, y, false); bPieceCount.bishop++; }
									else if (chessInst.squareColor(tile.square) == 'dark') { drawActivePiece([bBishopRefl, bBishopShdw, bBishopBlackSqImg], x, y, false); bPieceCount.bishop++; }
								}
							} else if (pieceType.match(/[n]/) && pieceColor) { // CHECKS CURRENT INDEX FOR KNIGHT
								if (pieceColor == "w") {
									if (tileX < tile.x && playerColor == pieceColor) { wKnightImg = wLeftKnightImg; wKnightShdw = wLeftKnightShdw; wKnightRefl = wLeftKnightRefl; drawActivePiece([wKnightRefl, wKnightShdw, wKnightImg], x, y, false); }
									else { wKnightImg = wRightKnightImg; wKnightShdw = wRightKnightShdw; wKnightRefl = wRightKnightRefl; drawActivePiece([wKnightRefl, wKnightShdw, wKnightImg], x, y, false); }
									wPieceCount.knight++;
								} else if (pieceColor == "b") {
									if (tileX < tile.x && playerColor == pieceColor) { bKnightImg = bLeftKnightImg; bKnightShdw = bLeftKnightShdw; bKnightRefl = bLeftKnightRefl; drawActivePiece([bKnightRefl, bKnightShdw, bKnightImg], x, y, false); }
									else { bKnightImg = bRightKnightImg; bKnightShdw = bRightKnightShdw; bKnightRefl = bRightKnightRefl; drawActivePiece([bKnightRefl, bKnightShdw, bKnightImg], x, y, false); }
									bPieceCount.knight++;
								}
							} else if (pieceType.match(/[r]/) && pieceColor) { // CHECKS CURRENT INDEX FOR ROOK
								if (pieceColor == "w") { drawActivePiece([wRookRefl, wRookShdw, wRookImg], x, y, false); wPieceCount.rook++; }
								else if (pieceColor == "b") { drawActivePiece([bRookRefl, bRookShdw, bRookImg], x, y, false); bPieceCount.rook++; }
							} else if (pieceType.match(/[p]/) && pieceColor) { // CHECKS CURRENT INDEX FOR PAWN
								if (pieceColor == "w") { drawActivePiece([wPawnRefl, wPawnShdw, wPawnImg], x, y, false); wPieceCount.pawn++; }
								else if (pieceColor == "b") { drawActivePiece([bPawnRefl, bPawnShdw, bPawnImg], x, y, false); bPieceCount.pawn++; }
							}
						}

						if ((clickedTile || mousedownTile) && !currSlide) { // MOVES FOR PIECE TOGGLED BY USER
							let xLet;
							let piecePos;
							if (playerColor == 'w') {
								xLet = String.fromCharCode(97 + j);
								piecePos = `${xLet}${8 - i}`
							} else if (playerColor == 'b') {
								xLet = String.fromCharCode(96 + (8 - j));
								piecePos = `${xLet}${i + 1}`
							}
							let tile;
							if (mousedownTile) { tile = mousedownTile }
							else if (clickedTile) { tile = clickedTile }

							if (availableMovesData.piece == tile.type && availableMovesData.square == tile.square) { }
							else {
								availableMovesData = { piece: tile.type, square: tile.square }
								availableMoves = chessInst.moves({ piece: tile.type, square: tile.square, verbose: true });
							}
							for (let r = 0; r < availableMoves.length; r++) { // RENDER ALL POSSIBLE MOVES 
								if (availableMoves[r].to == piecePos) {
									let xAvailInt;
									let yAvailInt;

									if (playerColor == 'w') {
										xAvailInt = availableMoves[r].to.split("")[0].charCodeAt(0) - 96 - 1;
										yAvailInt = 8 - availableMoves[r].to.split("")[1];
									} else if (playerColor == 'b') {
										xAvailInt = 8 - (availableMoves[r].to.split("")[0].charCodeAt(0) - 96);
										yAvailInt = availableMoves[r].to.split("")[1] - 1;
									}

									let availX = xAvailInt * tileWidth + xBoardOff;
									let availY = yAvailInt * tileHeight - tileHeight / 10 + yBoardOff;
									for (let a = 0; a < availableMoves.length; a++) {
										let xAvailInt;
										let yAvailInt;
										if (playerColor == 'w') {
											xAvailInt = availableMoves[a].to.split("")[0].charCodeAt(0) - 96 - 1;
											yAvailInt = 8 - availableMoves[a].to.split("")[1];
										} else if (playerColor == 'b') {
											xAvailInt = 8 - (availableMoves[a].to.split("")[0].charCodeAt(0) - 96);
											yAvailInt = availableMoves[a].to.split("")[1] - 1;
										}
										if (tileX == xAvailInt && tileY == yAvailInt && mousedownTile) { break }
										else if ((a + 1) == availableMoves.length) { tile.xAvailInt = null; tile.yAvailInt = null; }
									}
									if (availableMoves[r].san.lastIndexOf("x") != -1) { // RENDERS TILE WHICH CAN BE MOVE TO THAT TAKE AN OPPOSING PIECES
										ctx.globalAlpha = 0.50;
										ctx.drawImage(images[takeableHighlight].image, availX, availY, tileWidth, tileHeight);
										ctx.globalAlpha = 1.00;
										if (tileX == xAvailInt && tileY == yAvailInt && mousedownTile) {
											tile.xAvailInt = xAvailInt;
											tile.yAvailInt = yAvailInt;
											const pieceType = tile.type
											const pieceColor = tile.color;
											let x = xAvailInt * tileWidth + xBoardOff;
											let y = yAvailInt * tileHeight - tileHeight / 6 + yBoardOff;
											drawTiles(tile, pieceType, pieceColor, x, y);
										}
									} else {
										ctx.globalAlpha = 0.50;
										ctx.drawImage(images[moveHighlight].image, availX, availY, tileWidth, tileHeight);
										ctx.globalAlpha = 1.00;
										if (tileX == xAvailInt && tileY == yAvailInt && mousedownTile) {
											tile.xAvailInt = xAvailInt;
											tile.yAvailInt = yAvailInt;
											const pieceType = tile.type
											const pieceColor = tile.color;
											let x = xAvailInt * tileWidth + xBoardOff;
											let y = yAvailInt * tileHeight - tileHeight / 6 + yBoardOff;
											drawTiles(tile, pieceType, pieceColor, x, y);
										}
									}
								}
							}
						}
					}

					if (!currPromotion && !opposingMove) { checkAvailableMoves() }


					// /* ---------------------------------------------------------------- */
					// // Draw image
					// /* ---------------------------------------------------------------- */
					// /**
					//  * @description Draws active piece to canvas
					//  */
					async function drawActivePiece(imgArr, x, y, opacitiy) {
						let completeSlide = false;
						for (let w = 0; w < imgArr.length; w++) {
							if ((tiles[index].isMousedown || tiles[index].isClicked || tiles[index].isHovering) && opacitiy && !tiles[index].isSliding) { ctx.globalAlpha = 0.85 }
							if (w == 0) { ctx.globalAlpha = 0.30 }
							else if (w == 1) { ctx.globalAlpha = 0.75 }
							if (tiles[index].isSliding) { // IF TILE IS SLIDING
								// IF Y IS NEGITIVE ITS UNDER THE OVER PIECE
								// IF Y IS POSITIVE ITS OVER THE UNDER PIECE
								let slideOverlap = true;

								// /* ---------------------------------------------------------------- */
								// // Track Slide Position
								// /* ---------------------------------------------------------------- */
								// /**
								//  * @description Tracks the position of the piece that's sliding which allows for a rerender once all the pieces are rendered to the board
								//  */
								function trackSlidePosition() {
									let xLet;
									let xChange = 0;
									let yChange = 0;
									yPositive = false
									xPositive = false
									if (tiles[index].type == 'r') {
										slideOverlap = false;
									} else if (tiles[index].xSlideTo > tiles[index].x) {
										xPositive = true;
										// X IS GOING TO THE RIGHT
										// console.log("X RIGHT")
										if (tiles[index].ySlideTo > tiles[index].y) {
											// Y GOING DOWN THE BOARD
											// console.log("Y DOWN")
											let yTilesMoved = Math.floor(tiles[index].yDiff / tileHeight);
											let xTilesMoved = Math.floor(tiles[index].xDiff / tileWidth);
											xChange = tiles[index].x + xTilesMoved;
											yChange = tiles[index].y - yTilesMoved;
											xLet = String.fromCharCode(97 + xChange);
											slidePos = `${xLet}${9 - yChange}`
											yPositive = true;
										} else if (tiles[index].ySlideTo < tiles[index].y) {
											// Y GOING UP THE BOARD
											//console.log("Y UP")
											let yTilesMoved = Math.floor(tiles[index].yDiff / tileHeight);
											let xTilesMoved = Math.floor(tiles[index].xDiff / tileWidth);
											xChange = tiles[index].x + xTilesMoved + 1;
											yChange = tiles[index].y - yTilesMoved - 1;
											xLet = String.fromCharCode(97 + xChange);
											slidePos = `${xLet}${8 - yChange}`
										} else { slideOverlap = false; }
									} else if ((tiles[index].xSlideTo < tiles[index].x)) {
										// X IS GOING TO THE LEFT
										// console.log("X LEFT")
										if (tiles[index].ySlideTo > tiles[index].y) {
											// Y GOING DOWN THE BOARD
											// console.log("Y DOWN")
											let yTilesMoved = Math.floor(tiles[index].yDiff / tileHeight);
											let xTilesMoved = Math.floor(tiles[index].xDiff / tileWidth);
											xChange = tiles[index].x + xTilesMoved;
											yChange = tiles[index].y - yTilesMoved;
											xLet = String.fromCharCode(98 + xChange);
											slidePos = `${xLet}${9 - yChange}`
											yPositive = true;
										} else if (tiles[index].ySlideTo < tiles[index].y) {
											// Y GOING UP THE BOARD
											// console.log("Y UP")
											let yTilesMoved = Math.floor(tiles[index].yDiff / tileHeight);
											let xTilesMoved = Math.floor(tiles[index].xDiff / tileWidth);
											xChange = tiles[index].x + xTilesMoved;
											yChange = tiles[index].y - yTilesMoved;
											xLet = String.fromCharCode(98 + xChange);
											slidePos = `${xLet}${8 - yChange}`
										} else {
											slideOverlap = false;
										}
									} else { slideOverlap = false; }
								}

								trackSlidePosition();

								let xChange = (tileWidth / frameRate) * 3.48513659;
								let yChange = (tileHeight / frameRate) * 3.48513659;

								let endTileX;
								let endTileY;
								let xBool = false;
								let yBool = false;
								// X

								if (tiles[index].xSlideTo > tiles[index].x && w == 0) { // X: Greater
									endTileX = tiles[index].xSlideTo - tiles[index].x;
									if (Math.floor((tiles[index].x * tileWidth) + tiles[index].xDiff) == Math.floor((tiles[index].x * tileWidth) + (tileWidth * endTileX))) {
										xBool = true
									} else if (((tiles[index].x * tileWidth) + (tiles[index].xDiff + xChange)) >= ((tiles[index].x * tileWidth) + (tileWidth * endTileX))) {
										const remainder = (tiles[index].x * tileWidth) + tiles[index].xDiff - ((tiles[index].x * tileWidth) + (tileWidth * endTileX));
										tiles[index].xDiff = tiles[index].xDiff - remainder;
									} else {
										if (tiles[index].type.match(/[n]/) && (endTileX > endTileY)) {
											tiles[index].xDiff = tiles[index].xDiff + (xChange * 2);
										} // KNIGHT SLIDE
										else { tiles[index].xDiff = tiles[index].xDiff + xChange }
									}
								} else if (tiles[index].xSlideTo < tiles[index].x && w == 0) { // X: Less
									endTileX = tiles[index].x - tiles[index].xSlideTo;
									if (Math.floor((tiles[index].x * tileWidth) + tiles[index].xDiff) == Math.floor((tiles[index].x * tileWidth) - (tileWidth * endTileX))) {
										xBool = true
									} else if (((tiles[index].x * tileWidth) + (tiles[index].xDiff - xChange)) <= ((tiles[index].x * tileWidth) - (tileWidth * endTileX))) {
										const remainder = (((tiles[index].x * tileWidth) + tiles[index].xDiff) - ((tiles[index].x * tileWidth) - (tileWidth * endTileX)));
										tiles[index].xDiff = tiles[index].xDiff - remainder;
									} else {
										if (tiles[index].type.match(/[n]/) && (endTileX > endTileY)) {
											tiles[index].xDiff = tiles[index].xDiff - (xChange * 2);
										} // KNIGHT SLIDE
										else { tiles[index].xDiff = tiles[index].xDiff - xChange; }
									}
								} else if (w == 0) { xBool = true } // X: Zero
								// Y
								if (tiles[index].ySlideTo > tiles[index].y && w == 0) { // Y: Greater
									endTileY = tiles[index].ySlideTo - tiles[index].y;
									if (Math.floor((tiles[index].y * tileHeight) - tiles[index].yDiff) == Math.floor((tiles[index].y * tileHeight) + (tileHeight * endTileY))) {
										yBool = true;
									} else if (((tiles[index].y * tileHeight) - (tiles[index].yDiff - yChange)) >= ((tiles[index].y * tileHeight) + (tileHeight * endTileY))) {
										const remainder = (((tiles[index].y * tileHeight) + (tileHeight * endTileY)) - ((tiles[index].y * tileHeight) - tiles[index].yDiff));
										tiles[index].yDiff = tiles[index].yDiff - remainder;
									} else {
										if (tiles[index].type.match(/[n]/) && (endTileY > endTileX)) {
											tiles[index].yDiff = tiles[index].yDiff - (yChange * 2);
										} // KNIGHT SLIDE
										else { tiles[index].yDiff = tiles[index].yDiff - yChange; }
									}
								} else if (tiles[index].ySlideTo < tiles[index].y && w == 0) { // Y: Less
									endTileY = tiles[index].y - tiles[index].ySlideTo;
									if (Math.floor((tiles[index].y * tileHeight) - tiles[index].yDiff) == Math.floor((tiles[index].y * tileHeight) - (tileHeight * endTileY))) {
										yBool = true
									} else if (((tiles[index].y * tileHeight) - (tiles[index].yDiff + yChange)) <= ((tiles[index].y * tileHeight) - (tileHeight * endTileY))) {
										const remainder = (((tiles[index].y * tileHeight) - (tileHeight * endTileY)) - ((tiles[index].y * tileHeight) - tiles[index].yDiff));
										tiles[index].yDiff = tiles[index].yDiff - remainder;
									} else {
										if (tiles[index].type.match(/[n]/) && (endTileY > endTileX)) {
											tiles[index].yDiff = tiles[index].yDiff + (yChange * 2)
										} // KNIGHT SLIDE
										else { tiles[index].yDiff = tiles[index].yDiff + yChange; }
									}
								} else if (w == 0) { yBool = true } // Y: Zero


								try {
									// GET BOTH PIECES IN THE TILES ARRAY
									if (slideOverlap && slidePos) {
										let xPos;
										let yPos;
										let y1x1, y1x2, y1x3, y2x1, y2x2, y2x3, y3x1, y3x2, y3x3 = null;

										if (playerColor == 'w') {
											xPos = slidePos.split("")[0].charCodeAt(0) - 97;
											yPos = Number(slidePos.split("")[1])

											// X1  = x - 1
											// X2  = x
											// X3 = x + 1

											// Y1 = y - 1
											if (((xPos - 1) >= 0 && (xPos - 1) <= 8 && (yPos - 1) >= 0 && (yPos - 1) <= 8) && (`${String.fromCharCode(97 + (xPos - 1))}${yPos - 1}` != tiles[index].square)) { y1x1 = `${String.fromCharCode(97 + (xPos - 1))}${yPos - 1}` }
											if (((xPos) >= 0 && (xPos) <= 8 && (yPos - 1) >= 0 && (yPos - 1) <= 8) && (`${String.fromCharCode(97 + (xPos))}${yPos - 1}` != tiles[index].square)) { y1x2 = `${String.fromCharCode(97 + (xPos))}${yPos - 1}` }
											if (((xPos + 1) >= 0 && (xPos + 1) <= 8 && (yPos - 1) >= 0 && (yPos - 1) <= 8) && (`${String.fromCharCode(97 + (xPos + 1))}${yPos - 1}` != tiles[index].square)) { y1x3 = `${String.fromCharCode(97 + (xPos + 1))}${yPos - 1}` }

											// Y2 = y
											if (((xPos - 1) >= 0 && (xPos - 1) <= 8 && (yPos) >= 0 && (yPos) <= 8) && (`${String.fromCharCode(97 + (xPos - 1))}${yPos}` != tiles[index].square)) { y2x1 = `${String.fromCharCode(97 + (xPos - 1))}${yPos}` }
											if ((xPos) >= 0 && (xPos) <= 8 && (yPos) >= 0 && (yPos) <= 8) { y2x2 = tiles[index].square }
											if (((xPos + 1) >= 0 && (xPos + 1) <= 8 && (yPos) >= 0 && (yPos) <= 8) && (`${String.fromCharCode(97 + (xPos + 1))}${yPos}` != tiles[index].square)) { y2x3 = `${String.fromCharCode(97 + (xPos + 1))}${yPos}` }
											// Y3 = y + 1
											if (((xPos - 1) >= 0 && (xPos - 1) <= 8 && (yPos + 1) >= 0 && (yPos + 1) <= 8) && (`${String.fromCharCode(97 + (xPos - 1))}${yPos + 1}` != tiles[index].square)) { y3x1 = `${String.fromCharCode(97 + (xPos - 1))}${yPos + 1}` }
											if (((xPos) >= 0 && (xPos) <= 8 && (yPos + 1) >= 0 && (yPos + 1) <= 8) && (`${String.fromCharCode(97 + (xPos))}${yPos + 1}` != tiles[index].square)) { y3x2 = `${String.fromCharCode(97 + (xPos))}${yPos + 1}` }
											if (((xPos + 1) >= 0 && (xPos + 1) <= 8 && (yPos + 1) >= 0 && (yPos + 1) <= 8) && (`${String.fromCharCode(97 + (xPos + 1))}${yPos + 1}` != tiles[index].square)) { y3x3 = `${String.fromCharCode(97 + (xPos + 1))}${yPos + 1}` }

											overlapSlideObj = { y1x1, y1x2, y1x3, y2x1, y2x2, y2x3, y3x1, y3x2, y3x3 }
										}

										else if (playerColor == 'b') {
											xPos = (8 - (slidePos.split("")[0].charCodeAt(0) - 97))
											yPos = 9 - Number(slidePos.split("")[1])

											// X1  = x
											// X2  = x - 1
											// X3 = x - 2

											// Y1 = y - 1
											if (((xPos) >= 0 && (xPos) <= 8 && (yPos - 1) >= 0 && (yPos - 1) <= 8) && (`${String.fromCharCode(97 + (xPos))}${yPos - 1}` != tiles[index].square)) { y1x1 = `${String.fromCharCode(97 + (xPos))}${yPos - 1}` }
											if (((xPos - 1) >= 0 && (xPos - 1) <= 8 && (yPos - 1) >= 0 && (yPos - 1) <= 8) && (`${String.fromCharCode(97 + (xPos - 1))}${yPos - 1}` != tiles[index].square)) { y1x2 = `${String.fromCharCode(97 + (xPos - 1))}${yPos - 1}` }
											if (((xPos - 2) >= 0 && (xPos - 2) <= 8 && (yPos - 1) >= 0 && (yPos - 1) <= 8) && (`${String.fromCharCode(97 + (xPos - 2))}${yPos - 1}` != tiles[index].square)) { y1x3 = `${String.fromCharCode(97 + (xPos - 2))}${yPos - 1}` }

											// Y2 = y
											if (((xPos) >= 0 && (xPos) <= 8 && (yPos) >= 0 && (yPos) <= 8) && (`${String.fromCharCode(97 + (xPos))}${yPos}` != tiles[index].square)) { y2x1 = `${String.fromCharCode(97 + (xPos))}${yPos}` }
											if ((xPos - 1) >= 0 && (xPos - 1) <= 8 && (yPos) >= 0 && (yPos) <= 8) { y2x2 = tiles[index].square }
											if (((xPos - 2) >= 0 && (xPos - 2) <= 8 && (yPos) >= 0 && (yPos) <= 8) && (`${String.fromCharCode(97 + (xPos - 2))}${yPos}` != tiles[index].square)) { y2x3 = `${String.fromCharCode(97 + (xPos - 2))}${yPos}` }

											// Y3 = y + 1
											if (((xPos) >= 0 && (xPos) <= 8 && (yPos + 1) >= 0 && (yPos + 1) <= 8) && (`${String.fromCharCode(97 + (xPos))}${yPos + 1}` != tiles[index].square)) { y3x1 = `${String.fromCharCode(97 + (xPos))}${yPos + 1}` }
											if (((xPos - 1) >= 0 && (xPos - 1) <= 8 && (yPos + 1) >= 0 && (yPos + 1) <= 8) && (`${String.fromCharCode(97 + (xPos - 1))}${yPos + 1}` != tiles[index].square)) { y3x2 = `${String.fromCharCode(97 + (xPos - 1))}${yPos + 1}` }
											if (((xPos - 2) >= 0 && (xPos - 2) <= 8 && (yPos + 1) >= 0 && (yPos + 1) <= 8) && (`${String.fromCharCode(97 + (xPos - 2))}${yPos + 1}` != tiles[index].square)) { y3x3 = `${String.fromCharCode(97 + (xPos - 2))}${yPos + 1}` }

											overlapSlideObj = { y1x1, y1x2, y1x3, y2x1, y2x2, y2x3, y3x1, y3x2, y3x3 }
										}
									}

									if (xBool && yBool) { completeSlide = true; }

									if (tiles[index].type.match(/[n]/)) { // KNIGHT SLIDE
										if ((w == 0 || w == 1) && lightObstruction) {
											ctx.drawImage(images[imgArr[w]].image, ((((tiles[index].x * tileWidth) + tiles[index].xDiff) + xBoardOff) - xPieceOffset / 2) - tileWidth / 5, (((((tiles[index].y * tileHeight) - tiles[index].yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2), tileWidth + xPieceOffset, tileHeight + yPieceOffset)
										} // DRAW SHADOW OF KNIGHT
										else if (w == 2) { // DRAW PIECE
											if (slideStart == true) {
												ctx.drawImage(images[imgArr[w]].image, (((tiles[index].x * tileWidth) + tiles[index].xDiff) + xBoardOff) - xPieceOffset / 2, (((((tiles[index].y * tileHeight) - tiles[index].yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2) - tileHeight / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset); // DRAW KNIGHT AS WITH STOP
												currSlide = false; // SO THE TIMEOUT STOPS THE ANIMATION
												slideStart = false;
												setTimeout(function () { currSlide = true; }, 100) // SO THE TIMEOUT RESTARTS THE ANIMATION
												slideStart = false;
											} else {
												if (completeSlide) {
													tiles[index].isSliding = null;
													ctx.drawImage(images[imgArr[w]].image, (((tiles[index].x * tileWidth) + tiles[index].xDiff) + xBoardOff) - xPieceOffset / 2, (((((tiles[index].y * tileHeight) - tiles[index].yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2), tileWidth + xPieceOffset, tileHeight + yPieceOffset)
													if (tiles[index].color == playerColor) {
														await updateUserStateSlide(index);
													}
													else if (tiles[index].color == opponentColor) {
														await updateOpponentStateSlide(index);
													}
												} else {
													ctx.drawImage(images[imgArr[w]].image, (((tiles[index].x * tileWidth) + tiles[index].xDiff) + xBoardOff) - xPieceOffset / 2, (((((tiles[index].y * tileHeight) - tiles[index].yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2) - tileHeight / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset);
												}
											} // DRAW KNIGHT AS USUAL
										}
									} else {
										if ((w == 0 || w == 1) && lightObstruction) {
											ctx.drawImage(images[imgArr[w]].image, (((tiles[index].x * tileWidth) + tiles[index].xDiff) + xBoardOff) - xPieceOffset / 2, ((((tiles[index].y * tileHeight) - tiles[index].yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset)
										} else if (w == 2) {
											ctx.drawImage(images[imgArr[w]].image, (((tiles[index].x * tileWidth) + tiles[index].xDiff) + xBoardOff) - xPieceOffset / 2, ((((tiles[index].y * tileHeight) - tiles[index].yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset);
											if (completeSlide) {
												tiles[index].isSliding = null;
												if (tiles[index].color == playerColor) {
													setTimeout(function () { })
													await updateUserStateSlide(index);
												}
												else if (tiles[index].color == opponentColor) {
													await updateOpponentStateSlide(index);
												}
											}
										}
									}

								} catch (err) { return; }
							}
							else {
								if ((w == 0 || w == 1) && lightObstruction) {
									ctx.drawImage(images[imgArr[w]].image, x - xPieceOffset / 2, y - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset)
								} else if (w == 2) {
									ctx.drawImage(images[imgArr[w]].image, x - xPieceOffset / 2, y - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset)
								}
							} // DRAWING IMAGE WITH SLIDING FALSE
							if (((tiles[index]?.isMousedown || null || tiles[index]?.isClicked || null || tiles[index]?.isHovering || null) && opacitiy && !tiles[index]?.isSliding || null) || w == 0 || w == 1) { ctx.globalAlpha = 1 }
						}
					}

					if (inst[i][j]) { // IF CURRENT INDEX OF A TILE EXISTS
						tiles[index].originX = j;
						tiles[index].originY = i;
						const pieceType = inst[i][j].type;
						const pieceColor = inst[i][j].color;
						if (!currPromotion) {
							if (!(mousedownTile.xAvailInt == tiles[index].x && mousedownTile.yAvailInt == tiles[index].y)) { // IF A MOUSE DOWN TILE IS ON AVAILABLE MOVE TILE RENDERING OF THE PIECE FALLS ON THE RESPONSIBILITY OF "checkAvailableMoves()"
								let opacitiy = true
								if (tiles[index].isClicked && (tiles[index].x == tiles[index].originX && tiles[index].y == tiles[index].originY)) { opacitiy = false } // IF TILE IS IN ORIGINAL POSITION SET OPACITIY TO FALSE
								if (pieceType.match(/[k]/) && pieceColor) { // CHECKS CURRENT INDEX FOR KING
									if (pieceColor == "w") {
										if (chessInst.isCheck() && pieceColor == chessInst.turn()) {
											ctx.globalAlpha = 0.70;
											ctx.drawImage(images[checkHighlight].image, (tiles[index].x * tileWidth + xBoardOff) + ((tileWidth * 0.0243) / 2), (tiles[index].y * tileHeight - tileHeight / 10 + yBoardOff) + ((tileHeight * 0.1034) / 2), tileWidth, tileHeight);
											ctx.globalAlpha = 1.00;
										}
										drawActivePiece([wKingRefl, wKingShdw, wKingImg], x, y, opacitiy);
										wPieceCount.king++;
									}
									else if (pieceColor == "b") {
										if (chessInst.isCheck() && pieceColor == chessInst.turn()) {
											ctx.globalAlpha = 0.70;
											ctx.drawImage(images[checkHighlight].image, (tiles[index].x * tileWidth + xBoardOff) + ((tileWidth * 0.0243) / 2), (tiles[index].y * tileHeight - tileHeight / 10 + yBoardOff) + ((tileHeight * 0.1034) / 2), tileWidth, tileHeight);
											ctx.globalAlpha = 1.00;
										}
										drawActivePiece([bKingRefl, bKingShdw, bKingImg], x, y, opacitiy);
										bPieceCount.king++;
									}
								} else if (pieceType.match(/[q]/) && pieceColor) { // CHECKS CURRENT INDEX FOR QUEEN
									if (pieceColor == "w") { drawActivePiece([wQueenRefl, wQueenShdw, wQueenImg], x, y, opacitiy); wPieceCount.queen++; }
									else if (pieceColor == "b") { drawActivePiece([bQueenRefl, bQueenShdw, bQueenImg], x, y, opacitiy); bPieceCount.queen++; }
								} else if (pieceType.match(/[b]/) && pieceColor) { // CHECKS CURRENT INDEX FOR BISHOP
									if (pieceColor == "w") {
										if (chessInst.squareColor(tiles[index].square) == 'light') { drawActivePiece([wBishopRefl, wBishopShdw, wBishopWhiteSqImg], x, y, opacitiy); wPieceCount.bishop++; }
										else if (chessInst.squareColor(tiles[index].square) == 'dark') { drawActivePiece([wBishopRefl, wBishopShdw, wBishopBlackSqImg], x, y, opacitiy); wPieceCount.bishop++; }
									} else if (pieceColor == "b") {
										if (chessInst.squareColor(tiles[index].square) == 'light') { drawActivePiece([bBishopRefl, bBishopShdw, bBishopWhiteSqImg], x, y, opacitiy); bPieceCount.bishop++; }
										else if (chessInst.squareColor(tiles[index].square) == 'dark') { drawActivePiece([wBishopRefl, bBishopShdw, bBishopBlackSqImg], x, y, opacitiy); bPieceCount.bishop++; }
									}
								} else if (pieceType.match(/[n]/) && pieceColor) { // CHECKS CURRENT INDEX FOR KNIGHT
									/* ---------------------------------------------------------------- */
									// Draw Knight (Draw Screen)
									/* ---------------------------------------------------------------- */
									/**
									 * @description Draws the knight to the board
									 */
									function drawKnight() {
										if (pieceColor == 'w') {
											if (tiles[index].isMousedown) {
												if (tiles[index].x < tiles[index].originX && playerColor == pieceColor) { wKnightImg = wLeftKnightImg; wKnightShdw = wLeftKnightShdw; wKnightRefl = wLeftKnightRefl; drawActivePiece([wKnightRefl, wKnightShdw, wKnightImg], x, y, opacitiy); }
												else if (tiles[index].x > tiles[index].originX && playerColor == pieceColor) { wKnightImg = wRightKnightImg; wKnightShdw = wRightKnightShdw; wKnightRefl = wRightKnightRefl; drawActivePiece([wKnightRefl, wKnightShdw, wKnightImg], x, y, opacitiy); }
												else { drawActivePiece([wKnightRefl, wKnightShdw, wKnightImg], x, y, opacitiy); }
											} else { drawActivePiece([wKnightRefl, wKnightShdw, wKnightImg], x, y, opacitiy); }
										} else if (pieceColor == 'b') {
											if (tiles[index].isMousedown) {
												if (tiles[index].x < tiles[index].originX && playerColor == pieceColor) { bKnightImg = bLeftKnightImg; bKnightShdw = bLeftKnightShdw; bKnightRefl = bLeftKnightRefl; drawActivePiece([bKnightRefl, bKnightShdw, bKnightImg], x, y, opacitiy); }
												else if (tiles[index].x > tiles[index].originX && playerColor == pieceColor) { bKnightImg = bRightKnightImg; bKnightShdw = bRightKnightShdw; bKnightRefl = bRightKnightRefl; drawActivePiece([bKnightRefl, bKnightShdw, bKnightImg], x, y, opacitiy); }
												else { drawActivePiece([bKnightRefl, bKnightShdw, bKnightImg], x, y, opacitiy); }
											} else { drawActivePiece([bKnightRefl, bKnightShdw, bKnightImg], x, y, opacitiy); }
										}
									}
									if (pieceColor == "w") {
										let xFrom;
										let xTo;
										for (let n = 0; n < JSON.parse(response.w_knight).length; n++) {
											if (tiles[index].isSliding) {
												if (playerColor == 'w') {
													xFrom = moveObj.from.split("")[0].charCodeAt(0) - 96 - 1;
													xTo = moveObj.to.split("")[0].charCodeAt(0) - 96 - 1;
												} else if (playerColor == 'b') {
													xFrom = moveObj.from.split("")[0].charCodeAt(0) - 96 - 1;
													xTo = moveObj.to.split("")[0].charCodeAt(0) - 96 - 1;
												}
												handleKnightDirectionW(xFrom, xTo);
												drawActivePiece([wKnightRefl, wKnightShdw, wKnightImg], x, y, opacitiy);
												break;
											} else if (JSON.parse(response.w_knight)[n].from && (JSON.parse(response.w_knight)[n].to == tiles[index].square)) {
												if (playerColor == 'w') {
													xFrom = JSON.parse(response.w_knight)[n].from.split("")[0].charCodeAt(0) - 96 - 1;
													xTo = JSON.parse(response.w_knight)[n].to.split("")[0].charCodeAt(0) - 96 - 1;
												} else if (playerColor == 'b') {
													xFrom = JSON.parse(response.w_knight)[n].from.split("")[0].charCodeAt(0) - 96 - 1;
													xTo = JSON.parse(response.w_knight)[n].to.split("")[0].charCodeAt(0) - 96 - 1;
												}
												handleKnightDirectionW(xFrom, xTo);
												drawKnight();
												break;
											} else if (JSON.parse(response.w_knight)[n].from == null && JSON.parse(response.w_knight)[n].to) {
												if (playerColor == 'w') {
													if (JSON.parse(response.w_knight)[n].to == 'b1' && tiles[index].square == 'b1') { wKnightImg = wRightKnightImg; wKnightShdw = wRightKnightShdw; wKnightRefl = wRightKnightRefl; drawKnight(); break; }
													else if (JSON.parse(response.w_knight)[n].to == tiles[index].square) { wKnightImg = wLeftKnightImg; wKnightShdw = wLeftKnightShdw; wKnightRefl = wLeftKnightRefl; drawKnight(); break; }
												} else if (playerColor == 'b') {
													if (JSON.parse(response.w_knight)[n].to == 'b1' && tiles[index].square == 'b1') { wKnightImg = wLeftKnightImg; wKnightShdw = wLeftKnightShdw; wKnightRefl = wLeftKnightRefl; drawKnight(); break; }
													else if (JSON.parse(response.w_knight)[n].to == tiles[index].square) { wKnightImg = wRightKnightImg; wKnightShdw = wRightKnightShdw; wKnightRefl = wRightKnightRefl; drawKnight(); break; }
												}
											}
										}
										wPieceCount.knight++;
									} else if (pieceColor == "b") {
										let xFrom;
										let xTo;
										for (let n = 0; n < JSON.parse(response.b_knight).length; n++) {
											if (tiles[index].isSliding) {
												if (playerColor == 'w') {
													xFrom = moveObj.from.split("")[0].charCodeAt(0) - 96 - 1;
													xTo = moveObj.to.split("")[0].charCodeAt(0) - 96 - 1;
												} else if (playerColor == 'b') {
													xFrom = 8 - (moveObj.from.split("")[0].charCodeAt(0) - 96);
													xTo = 8 - (moveObj.to.split("")[0].charCodeAt(0) - 96);
												}
												handleKnightDirectionB(xFrom, xTo);
												drawActivePiece([bKnightRefl, bKnightShdw, bKnightImg], x, y, opacitiy);
												break;
											} else if (JSON.parse(response.b_knight)[n].from && JSON.parse(response.b_knight)[n].to == tiles[index].square) {
												if (playerColor == 'w') {
													xFrom = JSON.parse(response.b_knight)[n].from.split("")[0].charCodeAt(0) - 96 - 1;
													xTo = JSON.parse(response.b_knight)[n].to.split("")[0].charCodeAt(0) - 96 - 1;
												} else if (playerColor == 'b') {
													xFrom = 8 - (JSON.parse(response.b_knight)[n].from.split("")[0].charCodeAt(0) - 96);
													xTo = 8 - (JSON.parse(response.b_knight)[n].to.split("")[0].charCodeAt(0) - 96);
												}
												handleKnightDirectionB(xFrom, xTo);
												drawKnight();
												break;
											} else if (JSON.parse(response.b_knight)[n].from == null && JSON.parse(response.b_knight)[n].to) {
												if (playerColor == 'w') {
													if (JSON.parse(response.b_knight)[n].to == 'b8' && tiles[index].square == 'b8') { bKnightImg = bRightKnightImg; bKnightShdw = bRightKnightShdw; bKnightRefl = bRightKnightRefl; drawKnight(); }
													else if (JSON.parse(response.b_knight)[n].to == tiles[index].square) { bKnightImg = bLeftKnightImg; bKnightShdw = bLeftKnightShdw; bKnightRefl = bLeftKnightRefl; drawKnight(); }
												} else if (playerColor == 'b') {
													if (JSON.parse(response.b_knight)[n].to == 'b8' && tiles[index].square == 'b8') { bKnightImg = bLeftKnightImg; bKnightShdw = bLeftKnightShdw; bKnightRefl = bLeftKnightRefl; drawKnight(); }
													else if (JSON.parse(response.b_knight)[n].to == tiles[index].square) { bKnightImg = bRightKnightImg; bKnightShdw = bRightKnightShdw; bKnightRefl = bRightKnightRefl; drawKnight(); }
												}
											}
										}
										bPieceCount.knight++;
									}
								} else if (pieceType.match(/[r]/) && pieceColor) { // CHECKS CURRENT INDEX FOR ROOK
									if (pieceColor == "w") { drawActivePiece([wRookRefl, wRookShdw, wRookImg], x, y, opacitiy); wPieceCount.rook++; }
									else if (pieceColor == "b") { drawActivePiece([bRookRefl, bRookShdw, bRookImg], x, y, opacitiy); bPieceCount.rook++; }
								} else if (pieceType.match(/[p]/) && pieceColor) { // CHECKS CURRENT INDEX FOR PAWN
									if (pieceColor == "w") { drawActivePiece([wPawnRefl, wPawnShdw, wPawnImg], x, y, opacitiy); wPieceCount.pawn++; }
									else if (pieceColor == "b") { drawActivePiece([bPawnRefl, bPawnShdw, bPawnImg], x, y, opacitiy); bPieceCount.pawn++; }
								}
							}
						}
					}
				}
			}


			/* ---------------------------------------------------------------- */
			// Draw Slide Box
			/* ---------------------------------------------------------------- */
			/**
			 * @description Handles pieceObj which draws piece over board render
			 */
			function drawSlideBox(pieceObj) {
				// CHECK ABOVE OR BELOW FIRST
				const pieceType = pieceObj.type;
				const pieceColor = pieceObj.color;
				const x = pieceObj.x;
				const y = pieceObj.y;

				if (pieceType.match(/[k]/) && pieceColor) { // CHECKS CURRENT INDEX FOR KING
					if (pieceColor == "w") { ctx.drawImage(images[wKingImg].image, (((x * tileWidth) + pieceObj.xDiff) + xBoardOff) - xPieceOffset / 2, ((((y * tileHeight) - pieceObj.yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset) }
					else if (pieceColor == "b") { ctx.drawImage(images[bKingImg].image, (((x * tileWidth) + pieceObj.xDiff) + xBoardOff) - xPieceOffset / 2, ((((y * tileHeight) - pieceObj.yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset) }
				} else if (pieceType.match(/[q]/) && pieceColor) { // CHECKS CURRENT INDEX FOR QUEEN
					if (pieceColor == "w") { ctx.drawImage(images[wQueenImg].image, (((x * tileWidth) + pieceObj.xDiff) + xBoardOff) - xPieceOffset / 2, ((((y * tileHeight) - pieceObj.yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset) }
					else if (pieceColor == "b") { ctx.drawImage(images[bQueenImg].image, (((x * tileWidth) + pieceObj.xDiff) + xBoardOff) - xPieceOffset / 2, ((((y * tileHeight) - pieceObj.yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset) }
				} else if (pieceType.match(/[b]/) && pieceColor) { // CHECKS CURRENT INDEX FOR BISHOP
					if (pieceColor == "w") {
						if (chessInst.squareColor(pieceObj.square) == 'light') { ctx.drawImage(images[wBishopWhiteSqImg].image, (((x * tileWidth) + pieceObj.xDiff) + xBoardOff) - xPieceOffset / 2, ((((y * tileHeight) - pieceObj.yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset) }
						else if (chessInst.squareColor(pieceObj.square) == 'dark') { ctx.drawImage(images[wBishopBlackSqImg].image, (((x * tileWidth) + pieceObj.xDiff) + xBoardOff) - xPieceOffset / 2, ((((y * tileHeight) - pieceObj.yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset) }
					} else if (pieceColor == "b") {
						if (chessInst.squareColor(pieceObj.square) == 'light') { ctx.drawImage(images[bBishopWhiteSqImg].image, (((x * tileWidth) + pieceObj.xDiff) + xBoardOff) - xPieceOffset / 2, ((((y * tileHeight) - pieceObj.yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset) }
						else if (chessInst.squareColor(pieceObj.square) == 'dark') { ctx.drawImage(images[bBishopBlackSqImg].image, (((x * tileWidth) + pieceObj.xDiff) + xBoardOff) - xPieceOffset / 2, ((((y * tileHeight) - pieceObj.yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset) }
					}
				} else if (pieceType.match(/[n]/) && pieceColor) { // CHECKS CURRENT INDEX FOR KNIGHT
					/* ---------------------------------------------------------------- */
					// Draw Knight (Draw Slide Box)
					/* ---------------------------------------------------------------- */
					/**
					 * @description Draws the knight to the board
					 */
					function drawKnight() {
						if (pieceColor == 'w') {
							if (pieceObj.isSliding) {
								ctx.drawImage(images[wKnightImg].image, (((x * tileWidth) + pieceObj.xDiff) + xBoardOff) - xPieceOffset / 2, (((((y * tileHeight) - pieceObj.yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2) - tileHeight / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset);
							} else {
								ctx.drawImage(images[wKnightImg].image, (((x * tileWidth) + pieceObj.xDiff) + xBoardOff) - xPieceOffset / 2, ((((y * tileHeight) - pieceObj.yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset)
							}
						} else if (pieceColor == 'b') {
							if (pieceObj.isSliding) {
								ctx.drawImage(images[bKnightImg].image, (((x * tileWidth) + pieceObj.xDiff) + xBoardOff) - xPieceOffset / 2, (((((y * tileHeight) - pieceObj.yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2) - tileHeight / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset);
							} else {
								ctx.drawImage(images[bKnightImg].image, (((x * tileWidth) + pieceObj.xDiff) + xBoardOff) - xPieceOffset / 2, ((((y * tileHeight) - pieceObj.yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset)
							}
						}
					}
					if (pieceColor == "w") {
						let xFrom;
						let xTo;
						for (let n = 0; n < JSON.parse(response.w_knight).length; n++) {
							if (pieceObj.isSliding) {
								if (playerColor == 'w') {
									xFrom = moveObj.from.split("")[0].charCodeAt(0) - 96 - 1;
									xTo = moveObj.to.split("")[0].charCodeAt(0) - 96 - 1;
								} else if (playerColor == 'b') {
									xFrom = moveObj.from.split("")[0].charCodeAt(0) - 96 - 1;
									xTo = moveObj.to.split("")[0].charCodeAt(0) - 96 - 1;
								}
								handleKnightDirectionW(xFrom, xTo);
								if (pieceObj.isSliding) {
									ctx.drawImage(images[wKnightImg].image, (((x * tileWidth) + pieceObj.xDiff) + xBoardOff) - xPieceOffset / 2, (((((y * tileHeight) - pieceObj.yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2) - tileHeight / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset);
								} else {
									ctx.drawImage(images[wKnightImg].image, (((x * tileWidth) + pieceObj.xDiff) + xBoardOff) - xPieceOffset / 2, ((((y * tileHeight) - pieceObj.yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset)
								}
								break;
							} else if (JSON.parse(response.w_knight)[n].from && (JSON.parse(response.w_knight)[n].to == pieceObj.square)) {
								if (playerColor == 'w') {
									xFrom = JSON.parse(response.w_knight)[n].from.split("")[0].charCodeAt(0) - 96 - 1;
									xTo = JSON.parse(response.w_knight)[n].to.split("")[0].charCodeAt(0) - 96 - 1;
								} else if (playerColor == 'b') {
									xFrom = JSON.parse(response.w_knight)[n].from.split("")[0].charCodeAt(0) - 96 - 1;
									xTo = JSON.parse(response.w_knight)[n].to.split("")[0].charCodeAt(0) - 96 - 1;
								}
								handleKnightDirectionW(xFrom, xTo);
								drawKnight();
								break;
							} else if (JSON.parse(response.w_knight)[n].from == null && JSON.parse(response.w_knight)[n].to) {
								if (playerColor == 'w') {
									if (JSON.parse(response.w_knight)[n].to == 'b1' && pieceObj.square == 'b1') { wKnightImg = wRightKnightImg; wKnightShdw = wRightKnightShdw; wKnightRefl = wRightKnightRefl; drawKnight(); break; }
									else if (JSON.parse(response.w_knight)[n].to == pieceObj.square) { wKnightImg = wLeftKnightImg; wKnightShdw = wLeftKnightShdw; wKnightRefl = wLeftKnightRefl; drawKnight(); break; }
								} else if (playerColor == 'b') {
									if (JSON.parse(response.w_knight)[n].to == 'b1' && pieceObj.square == 'b1') { wKnightImg = wLeftKnightImg; wKnightShdw = wLeftKnightShdw; wKnightRefl = wLeftKnightRefl; drawKnight(); break; }
									else if (JSON.parse(response.w_knight)[n].to == pieceObj.square) { wKnightImg = wRightKnightImg; wKnightShdw = wRightKnightShdw; wKnightRefl = wRightKnightRefl; drawKnight(); break; }
								}
							}
						}
					} else if (pieceColor == "b") {
						let xFrom;
						let xTo;
						for (let n = 0; n < JSON.parse(response.b_knight).length; n++) {
							if (pieceObj.isSliding) {
								if (playerColor == 'w') {
									xFrom = moveObj.from.split("")[0].charCodeAt(0) - 96 - 1;
									xTo = moveObj.to.split("")[0].charCodeAt(0) - 96 - 1;
								} else if (playerColor == 'b') {
									xFrom = 8 - (moveObj.from.split("")[0].charCodeAt(0) - 96);
									xTo = 8 - (moveObj.to.split("")[0].charCodeAt(0) - 96);
								}
								handleKnightDirectionB(xFrom, xTo);
								if (pieceObj.isSliding) {
									ctx.drawImage(images[bKnightImg].image, (((x * tileWidth) + pieceObj.xDiff) + xBoardOff) - xPieceOffset / 2, (((((y * tileHeight) - pieceObj.yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2) - tileHeight / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset);
								} else {
									ctx.drawImage(images[bKnightImg].image, (((x * tileWidth) + pieceObj.xDiff) + xBoardOff) - xPieceOffset / 2, ((((y * tileHeight) - pieceObj.yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset)
								}
							} else if (JSON.parse(response.b_knight)[n].from && JSON.parse(response.b_knight)[n].to == pieceObj.square) {
								if (playerColor == 'w') {
									xFrom = JSON.parse(response.b_knight)[n].from.split("")[0].charCodeAt(0) - 96 - 1;
									xTo = JSON.parse(response.b_knight)[n].to.split("")[0].charCodeAt(0) - 96 - 1;
								} else if (playerColor == 'b') {
									xFrom = 8 - (JSON.parse(response.b_knight)[n].from.split("")[0].charCodeAt(0) - 96);
									xTo = 8 - (JSON.parse(response.b_knight)[n].to.split("")[0].charCodeAt(0) - 96);
								}
								handleKnightDirectionB(xFrom, xTo);
								drawKnight();
							} else if (JSON.parse(response.b_knight)[n].from == null && JSON.parse(response.b_knight)[n].to) {
								if (playerColor == 'w') {
									if (JSON.parse(response.b_knight)[n].to == 'b8' && pieceObj.square == 'b8') { bKnightImg = bRightKnightImg; bKnightShdw = bRightKnightShdw; bKnightRefl = bRightKnightRefl; drawKnight(); }
									else if (JSON.parse(response.b_knight)[n].to == pieceObj.square) { bKnightImg = bLeftKnightImg; bKnightShdw = bLeftKnightShdw; bKnightRefl = bLeftKnightRefl; drawKnight(); }
								} else if (playerColor == 'b') {
									if (JSON.parse(response.b_knight)[n].to == 'b8' && pieceObj.square == 'b8') { bKnightImg = bLeftKnightImg; bKnightShdw = bLeftKnightShdw; bKnightRefl = bLeftKnightRefl; drawKnight(); }
									else if (JSON.parse(response.b_knight)[n].to == pieceObj.square) { bKnightImg = bRightKnightImg; bKnightShdw = bRightKnightShdw; bKnightRefl = bRightKnightRefl; drawKnight(); }
								}
							}
						}
					}
				} else if (pieceType.match(/[r]/) && pieceColor) { // CHECKS CURRENT INDEX FOR ROOK
					if (pieceColor == "w") { ctx.drawImage(images[wRookImg].image, (((x * tileWidth) + pieceObj.xDiff) + xBoardOff) - xPieceOffset / 2, ((((y * tileHeight) - pieceObj.yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset) }
					else if (pieceColor == "b") { ctx.drawImage(images[bRookImg].image, (((x * tileWidth) + pieceObj.xDiff) + xBoardOff) - xPieceOffset / 2, ((((y * tileHeight) - pieceObj.yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset) }
				} else if (pieceType.match(/[p]/) && pieceColor) { // CHECKS CURRENT INDEX FOR PAWN
					if (pieceColor == "w") { ctx.drawImage(images[wPawnImg].image, (((x * tileWidth) + pieceObj.xDiff) + xBoardOff) - xPieceOffset / 2, ((((y * tileHeight) - pieceObj.yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset) }
					else if (pieceColor == "b") { ctx.drawImage(images[bPawnImg].image, (((x * tileWidth) + pieceObj.xDiff) + xBoardOff) - xPieceOffset / 2, ((((y * tileHeight) - pieceObj.yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset) }
				}
			}

			if (currSlide && overlapSlideObj) {
				for (let q = 0; q < tiles.length; q++) {
					if (tiles[q].square == overlapSlideObj.y1x1 && tiles[q].type) { overlapSlideObj.y1x1 = tiles[q] }
					else if (tiles[q].square == overlapSlideObj.y1x2 && tiles[q].type) { overlapSlideObj.y1x2 = tiles[q] }
					else if (tiles[q].square == overlapSlideObj.y1x3 && tiles[q].type) { overlapSlideObj.y1x3 = tiles[q] }
					else if (tiles[q].square == overlapSlideObj.y2x1 && tiles[q].type) { overlapSlideObj.y2x1 = tiles[q] }
					else if (tiles[q].square == overlapSlideObj.y2x2 && tiles[q].type) { overlapSlideObj.y2x2 = tiles[q] }
					else if (tiles[q].square == overlapSlideObj.y2x3 && tiles[q].type) { overlapSlideObj.y2x3 = tiles[q] }
					else if (tiles[q].square == overlapSlideObj.y3x1 && tiles[q].type) { overlapSlideObj.y3x1 = tiles[q] }
					else if (tiles[q].square == overlapSlideObj.y3x2 && tiles[q].type) { overlapSlideObj.y3x2 = tiles[q] }
					else if (tiles[q].square == overlapSlideObj.y3x3 && tiles[q].type) { overlapSlideObj.y3x3 = tiles[q] }
				}

				function drawPieceBelow(square) {
					if (square && overlapSlideObj.y2x2?.square || false) {
						let sq = square.split("");
						if (playerColor == 'w') { square = `${sq[0]}${Number(sq[1]) - 1}`; }
						else if (playerColor == 'b') { square = `${sq[0]}${Number(sq[1]) + 1}`; }
						for (let a = 0; a < tiles.length; a++) {
							if (tiles[a].square == square && overlapSlideObj.y2x2.square != square) {
								drawSlideBox(tiles[a]);
								drawPieceBelow(tiles[a].square);
							}
						}
					}
				}

				if (playerColor == 'w') {
					if (overlapSlideObj.y2x2?.type == "n") {
						drawSlideBox(overlapSlideObj.y2x2);
					} else {
						if (!yPositive && !xPositive) { // UP TO LEFT
							if (overlapSlideObj.y2x1 && typeof overlapSlideObj.y2x1 == "object") { drawSlideBox(overlapSlideObj.y2x1); drawPieceBelow(overlapSlideObj.y2x1.square); }
							if (overlapSlideObj.y1x2 && typeof overlapSlideObj.y1x2 == "object") { drawSlideBox(overlapSlideObj.y1x2); drawPieceBelow(overlapSlideObj.y1x2.square); }
						}
						if (!yPositive && xPositive) { // UP TO RIGHT
							if (overlapSlideObj.y2x3 && typeof overlapSlideObj.y2x3 == "object") { drawSlideBox(overlapSlideObj.y2x3); drawPieceBelow(overlapSlideObj.y2x3.square); }
							if (overlapSlideObj.y1x2 && typeof overlapSlideObj.y1x2 == "object") { drawSlideBox(overlapSlideObj.y1x2); drawPieceBelow(overlapSlideObj.y1x2.square); }
						}
						if (yPositive && !xPositive) { // DOWN TO LEFT
							if (overlapSlideObj.y2x1 && typeof overlapSlideObj.y2x1 == "object") { drawSlideBox(overlapSlideObj.y2x1); drawPieceBelow(overlapSlideObj.y2x1.square); }
							if (overlapSlideObj.y3x2 && typeof overlapSlideObj.y3x2 == "object") { drawSlideBox(overlapSlideObj.y3x2); drawPieceBelow(overlapSlideObj.y3x2.square); }
							if (overlapSlideObj.y2x2 && typeof overlapSlideObj.y2x2 == "object") { drawSlideBox(overlapSlideObj.y2x2); drawPieceBelow(slidePos); }
							if (overlapSlideObj.y2x3 && typeof overlapSlideObj.y2x3 == "object") { drawSlideBox(overlapSlideObj.y2x3); drawPieceBelow(overlapSlideObj.y2x3.square); }
							if (overlapSlideObj.y1x2 && typeof overlapSlideObj.y1x2 == "object") { drawSlideBox(overlapSlideObj.y1x2); drawPieceBelow(overlapSlideObj.y1x2.square); }
							if (overlapSlideObj.y1x1 && typeof overlapSlideObj.y1x1 == "string") { drawPieceBelow(overlapSlideObj.y1x1); }
						}
						if (yPositive && xPositive) { // DOWN TO RIGHT
							if (overlapSlideObj.y2x3 && typeof overlapSlideObj.y2x3 == "object") { drawSlideBox(overlapSlideObj.y2x3); drawPieceBelow(overlapSlideObj.y2x3.square); }
							if (overlapSlideObj.y1x2 && typeof overlapSlideObj.y1x2 == "object") { drawSlideBox(overlapSlideObj.y1x2); drawPieceBelow(overlapSlideObj.y1x2.square); }
							if (overlapSlideObj.y2x2 && typeof overlapSlideObj.y2x2 == "object") { drawSlideBox(overlapSlideObj.y2x2); drawPieceBelow(slidePos); }
							if (overlapSlideObj.y2x1 && typeof overlapSlideObj.y2x1 == "object") { drawSlideBox(overlapSlideObj.y2x1); drawPieceBelow(overlapSlideObj.y2x1.square); }
							if (overlapSlideObj.y1x2 && typeof overlapSlideObj.y1x2 == "object") { drawSlideBox(overlapSlideObj.y1x2); drawPieceBelow(overlapSlideObj.y1x2.square); }
							if (overlapSlideObj.y1x3 && typeof overlapSlideObj.y1x3 == "string") { drawPieceBelow(overlapSlideObj.y1x3); }
						}
					}
				} else if (playerColor == 'b') {
					if (overlapSlideObj.y2x2?.type == "n") {
						drawSlideBox(overlapSlideObj.y2x2);
					} else {
						if (!yPositive && !xPositive) { // UP TO LEFT
							if (overlapSlideObj.y2x1 && typeof overlapSlideObj.y2x1 == "object") { drawSlideBox(overlapSlideObj.y2x1); drawPieceBelow(overlapSlideObj.y2x1.square); }
							if (overlapSlideObj.y3x2 && typeof overlapSlideObj.y3x2 == "object") { drawSlideBox(overlapSlideObj.y3x2); drawPieceBelow(overlapSlideObj.y3x2.square); }
						}
						if (!yPositive && xPositive) { // UP TO RIGHT
							if (overlapSlideObj.y2x3 && typeof overlapSlideObj.y2x3 == "object") { drawSlideBox(overlapSlideObj.y2x3); drawPieceBelow(overlapSlideObj.y2x3.square); }
							if (overlapSlideObj.y3x2 && typeof overlapSlideObj.y3x2 == "object") { drawSlideBox(overlapSlideObj.y3x2); drawPieceBelow(overlapSlideObj.y3x2.square); }
						}
						if (yPositive && !xPositive) { // DOWN TO LEFT
							if (overlapSlideObj.y2x1 && typeof overlapSlideObj.y2x1 == "object") { drawSlideBox(overlapSlideObj.y2x1); drawPieceBelow(overlapSlideObj.y2x1.square); }
							if (overlapSlideObj.y1x2 && typeof overlapSlideObj.y1x2 == "object") { drawSlideBox(overlapSlideObj.y1x2); drawPieceBelow(overlapSlideObj.y1x2.square); }
							if (overlapSlideObj.y2x2 && typeof overlapSlideObj.y2x2 == "object") { drawSlideBox(overlapSlideObj.y2x2); drawPieceBelow(slidePos); }
							if (overlapSlideObj.y3x2 && typeof overlapSlideObj.y3x2 == "string") { drawPieceBelow(overlapSlideObj.y3x2); }
							if (overlapSlideObj.y3x1 && typeof overlapSlideObj.y3x1 == "string") { drawPieceBelow(overlapSlideObj.y3x1); }
							if (overlapSlideObj.y3x2 && typeof overlapSlideObj.y3x2 == "object") { drawSlideBox(overlapSlideObj.y3x2); drawPieceBelow(overlapSlideObj.y3x2.square); }
						}
						if (yPositive && xPositive) { // DOWN TO RIGHT
							if (overlapSlideObj.y2x3 && typeof overlapSlideObj.y2x3 == "object") { drawSlideBox(overlapSlideObj.y2x3); drawPieceBelow(overlapSlideObj.y2x3.square); }
							if (overlapSlideObj.y1x2 && typeof overlapSlideObj.y1x2 == "object") { drawSlideBox(overlapSlideObj.y1x2); drawPieceBelow(overlapSlideObj.y1x2.square); }
							if (overlapSlideObj.y2x2 && typeof overlapSlideObj.y2x2 == "object") { drawSlideBox(overlapSlideObj.y2x2); drawPieceBelow(slidePos); }
							if (overlapSlideObj.y3x2 && typeof overlapSlideObj.y3x2 == "string") { drawPieceBelow(overlapSlideObj.y3x2); }
							if (overlapSlideObj.y3x3 && typeof overlapSlideObj.y3x3 == "string") { drawPieceBelow(overlapSlideObj.y3x3); }
							if (overlapSlideObj.y3x2 && typeof overlapSlideObj.y3x2 == "object") { drawSlideBox(overlapSlideObj.y3x2); drawPieceBelow(overlapSlideObj.y3x2.square); }
						}
					}
				}
				overlapSlideObj = null
			}
			if (!currSlide) { refresh = true; overlapSlideObj = null; }
		}

		/* ---------------------------------------------------------------- */
		// Set Taken Pieces Array
		/* ---------------------------------------------------------------- */
		/**
		 * @description Sets Object array with all taken pieces
		 */
		function setTakenPieceArr(paramColor) { // DRAW ALL TAKEN PIECES
			let takenArr = new Array();
			let currPieces;
			if (currPromotion) { currPieces = { king: 1, queen: 0, bishop: 1, knight: 1, rook: 1, pawn: 8 } } // SETS TAKEN PIECES ARRAY TO ONLY CONTAIN ONE OF EACH UNIQUE PIECE THAT ISN'T A KING
			else { if (paramColor == "w") { currPieces = wPieceCount } else if (paramColor == "b") { currPieces = bPieceCount } }

			function countToObj(amountOnBoard, type, maxCount) {
				let takenCount;
				takenCount = maxCount - amountOnBoard;
				for (let i = 1; i < takenCount + 1; i++) { takenArr[takenArr.length] = { color: paramColor, type: type } }
			}

			countToObj(currPieces.king, "k", 1);
			countToObj(currPieces.queen, "q", 1);
			countToObj(currPieces.bishop, "b", 2);
			countToObj(currPieces.knight, "n", 2);
			countToObj(currPieces.rook, "r", 2);

			return takenArr;
		}

		/* ---------------------------------------------------------------- */
		// Renders Taken Pieces
		/* ---------------------------------------------------------------- */
		/**
		 * @description Draw a single taken piece
		 */
		function renderTakenPieces(takenPieces, paramColor) {
			/* ---------------------------------------------------------------- */
			// Draw taken pieces
			/* ---------------------------------------------------------------- */
			/**
			 * @description Draws taken piece images to canvas
			 */
			function drawTakenPiece(takenPiece, imgArr) {
				for (let i = 0; i < imgArr.length; i++) { // DRAW TAKEN PIECE IMAGES
					if (((takenPiece.x === tileX && takenPiece.y === tileY && (takenPiece.color == playerColor || !takenPiece.color))) && currPromotion) { ctx.globalAlpha = 0.8; }
					ctx.drawImage(images[imgArr[i]].image, xPos * tileWidth + xBoardOff - xPieceOffset / 2, yPos * tileHeight + yBoardOff - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset);
					if (((takenPiece.x === tileX && takenPiece.y === tileY && (takenPiece.color == playerColor || !takenPiece.color))) && currPromotion) { ctx.globalAlpha = 1; }
				}
			}

			if (widthGreater) {
				if (playerColor == 'w') {
					if (paramColor == "w") { xPos = 9; yPos = 6; }
					else { xPos = 9; yPos = -1; }
				} else if (playerColor == 'b') {
					if (paramColor == "w") { xPos = 9; yPos = -1; }
					else { xPos = 9; yPos = 6; }
				}

				for (let i = 0; i < takenPieces.length; i++) {
					takenPieces[i].x = xPos;
					takenPieces[i].y = yPos;
					if (takenPieces[i].type.match(/[k]/) && takenPieces[i].color) { // CHECKS CURRENT INDEX FOR KING
						if (takenPieces[i].color == "w") { drawTakenPiece(takenPieces[i], [wKingShdw, wKingImg]); xPos += 1; if (xPos - 9 == 3) { yPos += 1; xPos = 9 } }
						else if (takenPieces[i].color == "b") { drawTakenPiece(takenPieces[i], [bKingShdw, bKingImg]); xPos += 1; if (xPos - 9 == 3) { yPos += 1; xPos = 9 } }
					} else if (takenPieces[i].type.match(/[q]/) && takenPieces[i].color) { // CHECKS CURRENT INDEX FOR QUEEN
						if (takenPieces[i].color == "w") { drawTakenPiece(takenPieces[i], [wQueenShdw, wQueenImg]); xPos += 1; if (xPos - 9 == 3) { yPos += 1; xPos = 9 } }
						else if (takenPieces[i].color == "b") { drawTakenPiece(takenPieces[i], [bQueenShdw, bQueenImg]); xPos += 1; if (xPos - 9 == 3) { yPos += 1; xPos = 9 } }
					} else if (takenPieces[i].type.match(/[b]/) && takenPieces[i].color) { // CHECKS CURRENT INDEX FOR BISHOP
						if (takenPieces[i].color == "w") { drawTakenPiece(takenPieces[i], [wBishopShdw, wBishopBlackSqImg]); xPos += 1; if (xPos - 9 == 3) { yPos += 1; xPos = 9 } }
						else if (takenPieces[i].color == "b") { drawTakenPiece(takenPieces[i], [bBishopShdw, bBishopWhiteSqImg]); xPos += 1; if (xPos - 9 == 3) { yPos += 1; xPos = 9 } }
					} else if (takenPieces[i].type.match(/[n]/) && takenPieces[i].color) { // CHECKS CURRENT INDEX FOR KNIGHT
						if (takenPieces[i].color == "w") { drawTakenPiece(takenPieces[i], [wRightKnightShdw, wRightKnightImg]); xPos += 1; if (xPos - 9 == 3) { yPos += 1; xPos = 9 } }
						else if (takenPieces[i].color == "b") { drawTakenPiece(takenPieces[i], [bRightKnightShdw, bRightKnightImg]); xPos += 1; if (xPos - 9 == 3) { yPos += 1; xPos = 9 } }
					} else if (takenPieces[i].type.match(/[r]/) && takenPieces[i].color) { // CHECKS CURRENT INDEX FOR ROOK
						if (takenPieces[i].color == "w") { drawTakenPiece(takenPieces[i], [wRookShdw, wRookImg]); xPos += 1; if (xPos - 9 == 3) { yPos += 1; xPos = 9 } }
						else if (takenPieces[i].color == "b") { drawTakenPiece(takenPieces[i], [bRookShdw, bRookImg]); xPos += 1; if (xPos - 9 == 3) { yPos += 1; xPos = 9 } }
					} else if (takenPieces[i].type.match(/[p]/) && takenPieces[i].color) { // CHECKS CURRENT INDEX FOR PAWN
						if (takenPieces[i].color == "w") { drawTakenPiece(takenPieces[i], [wPawnShdw, wPawnImg]); xPos += 1; if (xPos - 9 == 3) { yPos += 1; xPos = 9 } }
						else if (takenPieces[i].color == "b") { drawTakenPiece(takenPieces[i], [bPawnShdw, bPawnImg]); xPos += 1; if (xPos - 9 == 3) { yPos += 1; xPos = 9 } }
					}
				}
			} else {
				const xStart = portraitBoard ? 0 : -1; // PORTRAIT BOARD FILLS THE WIDTH, SO KEEP TAKEN PIECES ON SCREEN
				if (playerColor == 'w') {
					if (paramColor == "w") { xPos = xStart; yPos = 9; }
					else { xPos = xStart; yPos = -2; }
				} else if (playerColor == 'b') {
					if (paramColor == "w") { xPos = xStart; yPos = -2; }
					else { xPos = xStart; yPos = 9; }
				}

				for (let i = 0; i < takenPieces.length; i++) {
					takenPieces[i].x = xPos;
					takenPieces[i].y = yPos;
					if (takenPieces[i].type.match(/[k]/) && takenPieces[i].color) { // CHECKS CURRENT INDEX FOR KING
						if (takenPieces[i].color == "w") { drawTakenPiece(takenPieces[i], [wKingShdw, wKingImg]); xPos += 1; }
						else if (takenPieces[i].color == "b") { drawTakenPiece(takenPieces[i], [bKingShdw, bKingImg]); xPos += 1; }
					} else if (takenPieces[i].type.match(/[q]/) && takenPieces[i].color) { // CHECKS CURRENT INDEX FOR QUEEN
						if (takenPieces[i].color == "w") { drawTakenPiece(takenPieces[i], [wQueenShdw, wQueenImg]); xPos += 1; }
						else if (takenPieces[i].color == "b") { drawTakenPiece(takenPieces[i], [bQueenShdw, bQueenImg]); xPos += 1; }
					} else if (takenPieces[i].type.match(/[b]/) && takenPieces[i].color) { // CHECKS CURRENT INDEX FOR BISHOP
						if (takenPieces[i].color == "w") { drawTakenPiece(takenPieces[i], [wBishopShdw, wBishopBlackSqImg]); xPos += 1; }
						else if (takenPieces[i].color == "b") { drawTakenPiece(takenPieces[i], [bBishopShdw, bBishopWhiteSqImg]); xPos += 1; }
					} else if (takenPieces[i].type.match(/[n]/) && takenPieces[i].color) { // CHECKS CURRENT INDEX FOR KNIGHT
						if (takenPieces[i].color == "w") { drawTakenPiece(takenPieces[i], [wRightKnightShdw, wRightKnightImg]); xPos += 1; }
						else if (takenPieces[i].color == "b") { drawTakenPiece(takenPieces[i], [bRightKnightShdw, bRightKnightImg]); xPos += 1; }
					} else if (takenPieces[i].type.match(/[r]/) && takenPieces[i].color) { // CHECKS CURRENT INDEX FOR ROOK
						if (takenPieces[i].color == "w") { drawTakenPiece(takenPieces[i], [wRookShdw, wRookImg]); xPos += 1; }
						else if (takenPieces[i].color == "b") { drawTakenPiece(takenPieces[i], [bRookShdw, bRookImg]); xPos += 1; }
					} else if (takenPieces[i].type.match(/[p]/) && takenPieces[i].color) { // CHECKS CURRENT INDEX FOR PAWN
						if (takenPieces[i].color == "w") { drawTakenPiece(takenPieces[i], [wPawnShdw, wPawnImg]); xPos += 1; }
						else if (takenPieces[i].color == "b") { drawTakenPiece(takenPieces[i], [bPawnShdw, bPawnImg]); xPos += 1; }
					}
				}
			}

		}

		/* ---------------------------------------------------------------- */
		// Check Opponent Move
		/* ---------------------------------------------------------------- */
		/**
		 * @description Checks if opponent made a new move [No AI]
		 */
		async function checkOpponentMove() { // PROMOTIONS OF OPPOSING PLAYER THROWS INVALID MOVE
			try {
				refreshDataStartTime = Date.now();
				revert = response
				const updatedResponse = await validate(GAME_URL, GAME_ID, PLAYER_ID, false, false, false);
				if (updatedResponse.game_board != revert.game_board && opposingMove) {
					if (chessInst.isGameOver()) {
						menuToggled = true;
						menu.style.display = "flex"
						optResumeBtn.parentElement.style.display = 'none';
						if (playerColor == 'w') { resultDisplay.innerText = "White Wins!" }
						else if (playerColor == 'b') { resultDisplay.innerText = "Black Wins!" }
						handleRemoteMenuEnter(optRestartBtn);
					}

					validateState.load(updatedResponse.game_board);
					const serverPiece = validateState.get(updatedResponse.prev_move[1]) // PIECE RETURNED FROM THE SERVER GAME BOARD

					validateState.load(revert.game_board);
					const clientPiece = validateState.get(updatedResponse.prev_move[0]); // PIECE RETURNED FROM LOCAL/CLIENT GAME BOARD

					if ((serverPiece.color == clientPiece.color) && (serverPiece.type != 'p' && clientPiece.type == 'p')) {
						moveObj = { from: updatedResponse.prev_move[0], to: updatedResponse.prev_move[1], promotion: serverPiece.type }
					} else {
						moveObj = { from: updatedResponse.prev_move[0], to: updatedResponse.prev_move[1] }
					}

					validateState.move(moveObj);
					for (let i = 0; i < tiles.length; i++) {
						if (tiles[i].square == moveObj.from) {
							slideStart = true;
							tiles[i].isSliding = true
							if (playerColor == 'w') {
								tiles[i].xSlideTo = moveObj.to.split("")[0].charCodeAt(0) - 96 - 1;
								tiles[i].ySlideTo = 8 - moveObj.to.split("")[1];
							} else if (playerColor == 'b') {
								tiles[i].xSlideTo = 8 - (moveObj.to.split("")[0].charCodeAt(0) - 96);
								tiles[i].ySlideTo = moveObj.to.split("")[1] - 1;
							}
							tiles[i].xDiff = 0;
							tiles[i].yDiff = 0;
						}
					}
					currSlide = true;
					refresh = true;
				}
			} catch (err) { console.log(err); refreshDataStartTime = Date.now(); }
		}

		/* ---------------------------------------------------------------- */
		// On User Slide Complete
		/* ---------------------------------------------------------------- */
		/**
		 * @description Updates data for user slide completion, starts ai slide if ai is active
		 */
		async function updateUserStateSlide(index) {
			try {
				tiles[index].xSlideTo = 0;
				tiles[index].ySlideTo = 0;
				if (moveObj.promotion) { currPromotion = true; refresh = true; return; }
				await validateMove();
				tiles[index].isSliding = null;
			} catch (err) { console.log(err); currSlide = false; return refreshData(response); }
		}

		/* ---------------------------------------------------------------- */
		// Validates User Move
		/* ---------------------------------------------------------------- */
		/**
		 * @description Validates user move post slide or drag/drop then starts ai slide
		 */
		async function validateMove() {
			try {
				endTime = new Date();
				timeElapsed = endTime - startTime;

				moveAudio.load();
				moveAudio.play().catch((err) => { console.log(err) });
				revert = response;
				opposingMove = true;
				chessInst.move(moveObj);
				if (playerColor == 'w') {
					for (let n = 0; n < JSON.parse(response.w_knight).length; n++) {
						if (moveObj.from == JSON.parse(response.w_knight)[n].to) {
							let w_knight = JSON.parse(response.w_knight)
							w_knight[n].from = moveObj.from;
							w_knight[n].to = moveObj.to;
							response.w_knight = JSON.stringify(w_knight);
							break;
						}
					}
				} else if (playerColor == 'b') {
					for (let n = 0; n < JSON.parse(response.b_knight).length; n++) {
						if (moveObj.from == JSON.parse(response.b_knight)[n].to) {
							let b_knight = JSON.parse(response.b_knight)
							b_knight[n].from = moveObj.from;
							b_knight[n].to = moveObj.to;
							response.b_knight = JSON.stringify(b_knight);
							break;
						}
					}
				}

				response = await validate(GAME_URL, GAME_ID, PLAYER_ID, [moveObj.from, moveObj.to], moveObj.promotion, false);
				chessInst.load(response.game_board);

				if (response.status == 200) {
					currSlide = false;
					if (chessInst.isGameOver()) {
						menuToggled = true;
						menu.style.display = "flex"
						optResumeBtn.parentElement.style.display = 'none';
						if (playerColor == 'w') { resultDisplay.innerText = "White Wins!" }
						else if (playerColor == 'b') { resultDisplay.innerText = "Black Wins!" }
						handleRemoteMenuEnter(optRestartBtn);
						return;
					}

					if (ai) {
						tiles = await setTiles();
						refresh = true;
						setTimeout(function () { aiTurn = true; refresh = true; }, 500);
						return;
					}
					else { return refreshData(response); }

				} else { opposingMove = false; return refreshData(revert); }
			} catch (err) { console.log(err); opposingMove = false; mousedownTile = false; clickedTile = false; return refreshData(revert); }
		}

		/* ---------------------------------------------------------------- */
		// On Opponent Slide Complete
		/* ---------------------------------------------------------------- */
		/**
		 * @description Updates board data on slide completion for opposing player
		 */
		async function updateOpponentStateSlide(index) {
			try {
				endTime = new Date();
				timeElapsed = endTime - startTime;

				moveAudio.load();
				moveAudio.play().catch((err) => { console.log(err) });
				tiles[index].xSlideTo = 0;
				tiles[index].ySlideTo = 0;
				chessInst.move(moveObj);

				if (opponentColor == 'w') {
					for (let n = 0; n < JSON.parse(response.w_knight).length; n++) {
						if (moveObj.from == JSON.parse(response.w_knight)[n].to) {
							let w_knight = JSON.parse(response.w_knight)
							w_knight[n].from = moveObj.from;
							w_knight[n].to = moveObj.to;
							response.w_knight = JSON.stringify(w_knight);
						}
					}
				} else if (opponentColor == 'b') {
					for (let n = 0; n < JSON.parse(response.b_knight).length; n++) {
						if (moveObj.from == JSON.parse(response.b_knight)[n].to) {
							let b_knight = JSON.parse(response.b_knight)
							b_knight[n].from = moveObj.from;
							b_knight[n].to = moveObj.to;
							response.b_knight = JSON.stringify(b_knight);
						}
					}
				}

				revert = response;
				if (ai) { response = await validate(GAME_URL, GAME_ID, "CHESS_AI", [moveObj.from, moveObj.to], moveObj.promotion, false); }
				else { response = await validate(GAME_URL, GAME_ID, PLAYER_ID, false, false, false); }
				chessInst.load(response.game_board); // UPDATE BOARD
				if (response.status == 200) { // IF VALIDATED UPDATE BOARD STATE
					currSlide = false;

					tiles[index].isSliding = null;
					tiles[index].xDiff = 0;
					tiles[index].yDiff = 0;
					tiles[index].x = tiles[index].xSlideTo;
					tiles[index].y = tiles[index].ySlideTo;

					if (chessInst.isGameOver()) {
						menuToggled = true;
						menu.style.display = "flex"
						optResumeBtn.parentElement.style.display = 'none';
						if (opponentColor == 'w') { resultDisplay.innerText = "White Wins!" }
						else if (opponentColor == 'b') { resultDisplay.innerText = "Black Wins!" }

						handleRemoteMenuEnter(optRestartBtn);
					}
					opposingMove = false;
					refreshData(response);
				} else { opposingMove = true; return refreshData(revert); } // IF VALIDATION FAILS REVERT BACK TO PREVIOUS BOARD
			} catch (err) { currSlide = false; console.log(err); return refreshData(response); }
		}

		/* ---------------------------------------------------------------- */
		// Refresh Game Data
		/* ---------------------------------------------------------------- */
		/**
		 * @description Refreshes data based on passed in response
		 */
		function refreshData(response) {
			try {
				chessInst.load(response.game_board);
				tiles = setTiles();
				clickedTile = false;
				mousedownTile = false;
				currPromotion = false;
				currSlide = false;
				slideStart = false;
				refresh = true;
				availableMoves;
				availableMovesData = { piece: null, square: null }
				menuToggled = false;
				return response;
			} catch (err) { console.log(err); tiles = setTiles(); refresh = true; return response; }
		}



		/* ################################################################ */
		/* ################################################################ */
		// UTIL
		/* ################################################################ */
		/* ################################################################ */


		/* ---------------------------------------------------------------- */
		// Handle Knight Direction White
		/* ---------------------------------------------------------------- */
		/**
		 * @description Check the previous x pos & the curr x pos to determine orientation
		 */
		function handleKnightDirectionW(xFrom, xTo) {
			if (playerColor == 'w') {
				if (xFrom < xTo) { wKnightImg = wRightKnightImg; wKnightShdw = wRightKnightShdw; wKnightRefl = wRightKnightRefl; }
				else if (xFrom > xTo) { wKnightImg = wLeftKnightImg; wKnightShdw = wLeftKnightShdw; wKnightRefl = wLeftKnightRefl; }
				else { wKnightImg = wLeftKnightImg; wKnightShdw = wLeftKnightShdw; wKnightRefl = wLeftKnightRefl; }
			} else if (playerColor == 'b') {
				if (xFrom > xTo) { wKnightImg = wRightKnightImg; wKnightShdw = wRightKnightShdw; wKnightRefl = wRightKnightRefl; }
				else if (xFrom < xTo) { wKnightImg = wLeftKnightImg; wKnightShdw = wLeftKnightShdw; wKnightRefl = wLeftKnightRefl; }
				else { wKnightImg = wLeftKnightImg; wKnightShdw = wLeftKnightShdw; wKnightRefl = wLeftKnightRefl; }
			}
		}


		/* ---------------------------------------------------------------- */
		// Handle Knight Direction Black
		/* ---------------------------------------------------------------- */
		/**
		 * @description Check the previous x pos & the curr x pos to determine orientation
		 */
		function handleKnightDirectionB(xFrom, xTo) {
			if (playerColor == 'w') {
				if (xFrom < xTo) { bKnightImg = bRightKnightImg; bKnightShdw = bRightKnightShdw; bKnightRefl = bRightKnightRefl; }
				else if (xFrom > xTo) { bKnightImg = bLeftKnightImg; bKnightShdw = bLeftKnightShdw; bKnightRefl = bLeftKnightRefl; }
				else { bKnightImg = bRightKnightImg; bKnightShdw = bRightKnightShdw; bKnightRefl = bRightKnightRefl; }
			} else if (playerColor == 'b') {
				if (xFrom < xTo) { bKnightImg = bRightKnightImg; bKnightShdw = bRightKnightShdw; bKnightRefl = bRightKnightRefl; }
				else if (xFrom > xTo) { bKnightImg = bLeftKnightImg; bKnightShdw = bLeftKnightShdw; bKnightRefl = bLeftKnightRefl; }
				else { bKnightImg = bRightKnightImg; bKnightShdw = bRightKnightShdw; bKnightRefl = bRightKnightRefl; }
			}
		}


		/* ---------------------------------------------------------------- */
		// Handle Remote Nav Button Hover
		/* ---------------------------------------------------------------- */
		/**
		 * @description Changes current button effect when keydown is handled
		 */
		function handleRemoteNavBtnHover(btn) {
			if (btn.parentElement.style.display != "none") {
				remoteNavBox.menuBtn.style.transition = "ease-out 375ms";
				remoteNavBox.menuBtn.style.backgroundColor = "#CD853F";
				remoteNavBox.menuBtn = btn;
				remoteNavBox.menuBtn.style.transition = "ease-in 375ms"
				remoteNavBox.menuBtn.style.backgroundColor = "burlywood"
			}
		}

		/* ---------------------------------------------------------------- */
		// Handle Remote Menu Enter
		/* ---------------------------------------------------------------- */
		/**
		 * @description Handles menu button style when clicked with remote select box
		 */
		function handleRemoteMenuEnter(btn) {
			if (TV_BOOL) { optBtn.style.transition = "ease-out 375ms"; optBtn.style.color = "burlywood"; }
			if (TV_BOOL || OVERRIDE_TV) { remoteNavBox.menuHover = false; remoteNavBox.menuBtn = btn; remoteNavBox.menuBtn.style.transition = "ease-in 375ms"; remoteNavBox.menuBtn.style.backgroundColor = "burlywood" }
		}


		/* ---------------------------------------------------------------- */
		// Render Coffee
		/* ---------------------------------------------------------------- */
		/**
		 * @description Renders steaming coffee to the table 
		 */
		async function renderCoffee() {
			const coffeeAnimateTime = 2000; // 1 sec to display all the images
			const eachCoffeeImgTime = coffeeAnimateTime / coffeeObj.img.length // amount of time per image
			const currCoffeeImgIndex = Math.floor(((Date.now() - coffeeStartTime) % coffeeAnimateTime) / eachCoffeeImgTime);
			// ctx.clearRect(coffeeObj.x, coffeeObj.y, coffeeObj.width, coffeeObj.height);
			// ctx.drawImage(coffeeObj.img[currCoffeeImgIndex], coffeeObj.x, coffeeObj.y, coffeeObj.width, coffeeObj.height);
			ctx.drawImage(images[coffeeObj.shdw].image, coffeeObj.x, coffeeObj.y, coffeeObj.width, coffeeObj.height);
			ctx.drawImage(images[coffeeObj.img2].image, coffeeObj.x, coffeeObj.y, coffeeObj.width, coffeeObj.height);
			if (currCoffeeImgIndex == coffeeObj.img.length - 1) { coffeeStartTime = Date.now(); }
		};


		/* ################################################################ */
		/* ################################################################ */
		// EVENT LISTENERS
		/* ################################################################ */
		/* ################################################################ */

		/* ---------------------------------------------------------------- */
		// Resize Window
		/* ---------------------------------------------------------------- */
		/**
		 * @description Sets tile object, which is set by chess.js (npm) on render
		 */
		window.addEventListener("resize", handleWindowResize);
		function handleWindowResize(e) {
			refresh = true;
			try {
				if (initialAnimation) { renderBoardAnimation(currInst); }
				else { drawScreen(); refresh = false; }
			} catch (err) { console.log(err); }
		};


		/* ---------------------------------------------------------------- */
		// Handle Keydown
		/* ---------------------------------------------------------------- */
		/**
		 * @description Handles Keydown events
		 */
		if (TV_BOOL || OVERRIDE_TV) { window.addEventListener("keydown", handleKeyPress) }
		async function handleKeyPress(e) {
			e.preventDefault();
			e.stopPropagation();
			if (!e?.repeat && e?.keyCode) {
				function checkBoxOverPiece() {
					for (let i = 0; i < tiles.length; i++) {
						let tile = tiles[i];
						tile.isHovering = false;
						tile.isHovering = (!tile.isSliding) && (remoteNavBox.x == tile.originX && remoteNavBox.y == tile.originY) && ((tile.color == playerColor || !tile.color)) && (!opposingMove && !menuToggled)
					}
				}

				if (e.keyCode == 37) { // LEFT
					if (remoteNavBox.x > 0 && !menuToggled) {
						if (remoteNavBox.menuHover) {
							if (TV_BOOL) { optBtn.style.transition = "ease-out 375ms"; optBtn.style.color = "burlywood"; }
							remoteNavBox.menuHover = false;
						} else {
							remoteNavBox.x -= 1;
						}
						refresh = true;
					}
					else { refresh = true; }
					checkBoxOverPiece();
				}

				if (e.keyCode == 39) { // RIGHT
					if (remoteNavBox.x < 7 && !menuToggled) {
						remoteNavBox.x += 1;
						refresh = true;
					}
					else if (remoteNavBox.x == 7 && !menuToggled) {
						remoteNavBox.y = 0;
						remoteNavBox.menuHover = true;
						if (TV_BOOL) { optBtn.style.transition = "ease-in 375ms"; optBtn.style.color = "white"; }
					}

					else { refresh = true; }
					checkBoxOverPiece();
				}

				if (e.keyCode == 38) { // UP
					if (remoteNavBox.y > 0 && (!remoteNavBox.menuHover && !menuToggled)) { remoteNavBox.y -= 1; refresh = true; }
					else if (menuToggled) {
						if (remoteNavBox.menuBtn == optExitBtn) { handleRemoteNavBtnHover(optHomepageBtn) } // 4 -> 3
						else if (remoteNavBox.menuBtn == optHomepageBtn) { handleRemoteNavBtnHover(optRestartBtn) } // 3 -> 2
						else if (remoteNavBox.menuBtn == optRestartBtn) { handleRemoteNavBtnHover(optResumeBtn) } // 2 -> 1			
					}
					else { refresh = true; }
					checkBoxOverPiece();
				}
				if (e.keyCode == 40) { // DOWN
					if (remoteNavBox.y < 7 && (!remoteNavBox.menuHover && !menuToggled)) { remoteNavBox.y += 1; refresh = true; }
					else if (menuToggled) {
						if (remoteNavBox.menuBtn == optResumeBtn) { handleRemoteNavBtnHover(optRestartBtn) } // 1 -> 2
						else if (remoteNavBox.menuBtn == optRestartBtn) { handleRemoteNavBtnHover(optHomepageBtn) } // 2 -> 3
						else if (remoteNavBox.menuBtn == optHomepageBtn) { handleRemoteNavBtnHover(optExitBtn) } // 3 -> 4
					}
					else { refresh = true; }
					checkBoxOverPiece();
				}
				if (e.keyCode == 13) { // ENTER
					if (!remoteNavBox.menuHover && !menuToggled) { checkBoxOverPiece(); handleCanvasClick(e); }
					else if (remoteNavBox.menuHover && !menuToggled) { handleMenuBtn(e); handleRemoteMenuEnter(optResumeBtn); }
					else if (menuToggled && remoteNavBox.menuBtn) {
						remoteNavBox.menuBtn.style.backgroundColor = "#CD853F"
						if (remoteNavBox.menuBtn == optResumeBtn) { handleResume(e); }
						else if (remoteNavBox.menuBtn == optRestartBtn) { handleRestart(e); }
						else if (remoteNavBox.menuBtn == optHomepageBtn) { handleHomepage(e) }
						else if (remoteNavBox.menuBtn == optExitBtn) { handleExit(e) }
						remoteNavBox = { x: 7, y: 0, menuHover: false, menuBtn: false }
					}
				}
				// if (e.keyCode == 10009) { // BACK
				if (e.keyCode == 49) { // BACK
				}
				// if (e.keyCode == 10182) { // EXIT
				if (e.keyCode == 50) { // EXIT
				}
				refresh = true
			}
		}

		/* ---------------------------------------------------------------- */
		// On Click
		/* ---------------------------------------------------------------- */
		/**
		 * @description If piece is clicked, based on new positions or if piece is set back in original position, etc...
		 */
		/* ---------------------------------------------------------------- */
		// Get Canvas Point
		/* ---------------------------------------------------------------- */
		/**
		 * @description Converts viewport coordinates to canvas coordinates (mobile browser toolbars can offset the canvas)
		 */
		function getCanvasPoint(e) {
			const rect = canvas.getBoundingClientRect();
			return { x: e.clientX - rect.left, y: e.clientY - rect.top };
		}

		if (!TV_BOOL || OVERRIDE_TV) { canvas.addEventListener("click", handleCanvasClick); }
		async function handleCanvasClick(e) {
			e.preventDefault();
			e.stopPropagation();
			const point = getCanvasPoint(e);
			clientX = point.x;
			clientY = point.y;
			tileX = Math.floor((point.x - xBoardOff) / tileWidth);
			tileY = Math.floor((point.y - yBoardOff) / tileHeight);

			if (e.clientX === undefined && remoteNavBox) { // KEYBOARD (TV REMOTE) ENTER HAS NO POINTER POSITION
				tileX = remoteNavBox.x; tileY = remoteNavBox.y;
			}

			if (currPromotion) { // IF PROMOTION IS TRUE LOOK FOR USER TO CLICK ON TAKEN PIECES TO UPDATE BOARD
				revert = response;
				let takenPieces
				if (playerColor == 'w') { takenPieces = bTakenPieces }
				else if (playerColor == 'b') { takenPieces = wTakenPieces }
				for (let i = 0; i < takenPieces.length; i++) {
					let takenPiece = takenPieces[i];
					if (((takenPiece.x === tileX && takenPiece.y === tileY && (takenPiece.color == playerColor || !takenPiece.color))) && takenPiece.type && takenPiece.color == playerColor) {
						const promotion = takenPiece.type;
						try { // TEST MOVE CLIENT SIDE TO JUSTIFY SERVER CALL
							moveObj.promotion = promotion;
							currPromotion = false;
							await validateMove();
						} catch (err) { console.log(err); opposingMove = false; return refreshData(revert); }
					}
				}
			} else if (!currSlide) {
				revert = response;
				for (let i = 0; i < tiles.length; i++) {
					let tile = tiles[i];
					if (tile.isHovering && tile.type && tile.color == playerColor) { // DRAG AND DROP && IF HOVER IS TRUE
						if (tile.isClicked && tileX == tile.originX && tileY == tile.originY) { // IF TILE IS CLICKED AND SET BACK IN ORIGINAL POSITION
							tile.isClicked = false;
							clickedTile = false;
							mousedownTile = false;
							refresh = true;
							return;
						}

						if (tile.isClicked && tile.color == playerColor && (tileX != tile.originX || tileY != tile.originY)) { // IF PIECE IS CLICKED AND SET IN A NEW POSITION
							try { // TEST MOVE CLIENT SIDE TO JUSTIFY SERVER CALL
								moveObj = playerMove(playerColor, tile);
								if (moveObj.promotion) { currPromotion = true; refresh = true; return; }
								tile.isClicked = false;
								clickedTile = false;
								mousedownTile = false;
								return await validateMove();
							} catch (err) {
								console.log(err);
								opposingMove = false;
								return refreshData(revert);
							}
						}

						tile.isClicked = true;
						clickedTile = tile;
						refresh = true;
					} else if (!tile.isHovering && (tile.isClicked && tile.color == playerColor && (tileX != tile.originX || tileY != tile.originY))) { // CLICK PIECE WHILE MAINTAINING POSITION
						try {
							for (let z = 0; z < tiles.length; z++) { tiles[z].isClicked = false; clickedTile = false; }
							for (let j = 0; j < tiles.length; j++) {
								if ((tiles[j].isHovering && tiles[j].x == tileX && tiles[j].y == tileY) && tiles[j].color == playerColor) {
									tiles[j].isClicked = true
									clickedTile = tiles[j];
									refresh = true;
									return;
								}
							}
							tile.x = tileX;
							tile.y = tileY;
							moveObj = playerMove(playerColor, tile);
							validateState.load(response.game_board);
							validateState.move(moveObj); // CHECK MOVE WITHOUT UPDATING THE BOARD SO THE DRAWSCREEN FUNCTION CAN OPERATE WITH THE PREVIOUS MOVE WHILE CHECKING IF THE MOVE IS ALLOWED
							currSlide = true;
							slideStart = true;
							tile.isSliding = true
							tile.xSlideTo = tileX;
							tile.ySlideTo = tileY;
							tile.xDiff = 0;
							tile.yDiff = 0;
							for (let j = 0; j < tiles.length; j++) { tiles[j].isClicked = false; tiles[j].isMousedown = false }
							clickedTile = false;
							mousedownTile = false;
							refresh = true;

							startTime = new Date();


							return;
						} catch (err) { console.log(err); clickedTile = false; opposingMove = false; return refreshData(revert); }
					}
				}
			}
		};

		/* ---------------------------------------------------------------- */
		// On Mouse Move (hover)
		/* ---------------------------------------------------------------- */
		/**
		 * @description Conditializes hover of piece based on color
		 */
		if (!TV_BOOL || OVERRIDE_TV) { canvas.addEventListener("mousemove", handleMouseMove); }
		function handleMouseMove(e) {
			e.preventDefault();
			e.stopPropagation();
			// IF PIECE IS CLICK TO BE MOVED MOUSE POSITION
			const point = getCanvasPoint(e);
			clientX = point.x
			clientY = point.y
			tileX = Math.floor((point.x - xBoardOff) / tileWidth);
			tileY = Math.floor((point.y - yBoardOff) / tileHeight);
			// remoteNavBox.isClicked = false;
			if (!((tileX < 0 || tileX > 7) && (tileY < 0 || tileY > 7))) { // MOUSE INSIDE THE BOARD
				if (currPromotion) {
					let takenPieces
					if (playerColor == 'w') { takenPieces = bTakenPieces }
					else if (playerColor == 'b') { takenPieces = wTakenPieces }
					for (let i = 0; i < takenPieces.length; i++) {
						let takenPiece = takenPieces[i];
						takenPiece.isHovering = (((takenPiece.x === tileX && takenPiece.y === tileY && (takenPiece.color == playerColor || !takenPiece.color)))) && !menuToggled
						if (takenPiece.isHovering || takenPiece.isClicked) { refresh = true; offBoardRefresh = true; }
						if (takenPiece.color != playerColor && takenPiece.color) { refresh = true }
					}
				} else {
					for (let i = 0; i < tiles.length; i++) {
						let tile = tiles[i];
						tile.isHovering =
							(!tile.isSliding) &&
							(tile.x === tileX && tile.y === tileY) && //|| (remoteNavBox.x == tile.originX && remoteNavBox.y == tile.originY)) && 
							((tile.color == playerColor || !tile.color) || tile.isMousedown) &&
							(!opposingMove && !menuToggled)
						if (tile.isHovering || tile.isClicked) { refresh = true; offBoardRefresh = true; }
						if (tile.color != playerColor && tile.color) { refresh = true }
					}
				}
			}
			if (tileX < 0 || tileX > 7 || tileY < 0 || tileY > 7) { // MOUSE OUTSIDE THE BOARD
				if (offBoardRefresh) { refresh = true }
			}
		}

		/* ---------------------------------------------------------------- */
		// Mouse Down
		/* ---------------------------------------------------------------- */
		/**
		 * @description Sets positions / tracks user mousedown drag
		 */
		if (!TV_BOOL || OVERRIDE_TV) { canvas.addEventListener("mousedown", handleMouseDown); }
		async function handleMouseDown(e) {
			e.preventDefault();
			e.stopPropagation();
			const point = getCanvasPoint(e);
			tileX = Math.floor((point.x - xBoardOff) / tileWidth);
			tileY = Math.floor((point.y - yBoardOff) / tileHeight); // IF HOVER IS TRUE
			for (let i = 0; i < tiles.length; i++) {
				let tile = tiles[i];
				if ((tile.isHovering && tile.type && tile.color == playerColor)) {
					tile.isMousedown = true;
					mousedownTile = tile;
					mouseDownCount = 0;
					for (let j = 0; j < tiles.length; j++) {
						if (tiles[j].isClicked && (tiles[j].x != tileX || tiles[j].y != tileY) && tiles[j].color == playerColor) {
							tiles[j].isClicked = false
							clickedTile = false;
							refresh = true;
							return
						}
					}
				}
			}
		};

		/* ---------------------------------------------------------------- */
		// Mouse Up
		/* ---------------------------------------------------------------- */
		/**
		 * @description Sets positions based on mouse up event position
		 */
		if (!TV_BOOL || OVERRIDE_TV) { canvas.addEventListener("mouseup", handleMouseUp); }
		async function handleMouseUp(e) {
			e.preventDefault();
			e.stopPropagation();
			const point = getCanvasPoint(e);
			tileX = Math.floor((point.x - xBoardOff) / tileWidth);
			tileY = Math.floor((point.y - yBoardOff) / tileHeight); // IF HOVER IS TRUE
			for (let i = 0; i < tiles.length; i++) {
				let tile = tiles[i];
				if (tile.isMousedown && tile.isHovering && tile.type && tile.color == playerColor) {
					tile.isMousedown = false;
					mousedownTile = false;
					tileX = tile.originX
					tileY = tile.originY
					refresh = true;
				}
			}
		}


		/* ---------------------------------------------------------------- */
		// Touch (Mobile)
		/* ---------------------------------------------------------------- */
		/**
		 * @description Maps touch input onto the mouse handlers so pieces can be tapped or dragged on mobile browsers
		 */
		const touchDragThreshold = 10; // PX A FINGER MUST MOVE BEFORE A TAP BECOMES A DRAG
		let audioUnlocked = false;

		function touchToMouseEvent(touch) {
			return { clientX: touch.clientX, clientY: touch.clientY, preventDefault() { }, stopPropagation() { } };
		}

		function findActiveTouch(touchList) {
			for (let i = 0; i < touchList.length; i++) { if (touchList[i].identifier == touchState.id) { return touchList[i]; } }
			return null;
		}

		function unlockAudio() { // IOS ONLY PLAYS AUDIO STARTED BY A USER GESTURE, PLAY MUTED ONCE SO LATER MOVE SOUNDS (AI / OPPONENT) CAN PLAY
			if (audioUnlocked) { return; }
			audioUnlocked = true;
			moveAudio.muted = true;
			moveAudio.play().then(() => { moveAudio.pause(); moveAudio.currentTime = 0; moveAudio.muted = false; }).catch(() => { moveAudio.muted = false; });
		}

		if (!TV_BOOL || OVERRIDE_TV) {
			canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
			canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
			canvas.addEventListener("touchend", handleTouchEnd, { passive: false });
			canvas.addEventListener("touchcancel", handleTouchCancel, { passive: false });
		}

		function handleTouchStart(e) {
			e.preventDefault(); // STOPS SCROLL / ZOOM & THE BROWSER'S EMULATED MOUSE EVENTS
			if (touchState) { return; } // IGNORE EXTRA FINGERS
			const touch = e.changedTouches[0];
			const point = touchToMouseEvent(touch);
			touchState = { id: touch.identifier, startX: touch.clientX, startY: touch.clientY, dragging: false, point };
			handleMouseMove(point); // TOUCH HAS NO HOVER, SO SET IT BEFORE MOUSEDOWN
			handleMouseDown(point);
		}

		function handleTouchMove(e) {
			e.preventDefault();
			if (!touchState) { return; }
			const touch = findActiveTouch(e.changedTouches);
			if (!touch) { return; }
			touchState.point = touchToMouseEvent(touch);
			if (!touchState.dragging && Math.hypot(touch.clientX - touchState.startX, touch.clientY - touchState.startY) < touchDragThreshold) { return; } // SMALL FINGER JITTER IS STILL A TAP
			touchState.dragging = true;
			handleMouseMove(touchState.point);
		}

		function handleTouchEnd(e) {
			e.preventDefault();
			if (!touchState) { return; }
			const touch = findActiveTouch(e.changedTouches);
			if (!touch) { return; }
			const point = touchToMouseEvent(touch);
			const dragging = touchState.dragging;
			touchState = null;
			unlockAudio();
			handleMouseMove(point);
			if (dragging) { // DROP THE DRAGGED PIECE ON THE RELEASE TILE (THE RENDER LOOP ONLY DOES THIS ON ITS NEXT FRAME)
				for (let i = 0; i < tiles.length; i++) {
					if (tiles[i].isMousedown && tiles[i].color == playerColor) { tiles[i].x = tileX; tiles[i].y = tileY; tiles[i].isClicked = true; }
				}
				handleMouseMove(point);
			}
			handleMouseUp(point);
			handleCanvasClick(point);
		}

		function handleTouchCancel(e) {
			if (!touchState) { return; }
			handleMouseUp(touchState.point);
			touchState = null;
		}


		/* ---------------------------------------------------------------- */
		// Options (Menu) Button
		/* ---------------------------------------------------------------- */
		/**
		 * @description Toggles menu based on menu state
		 */
		if (!TV_BOOL || OVERRIDE_TV) { optBtn.addEventListener("click", handleMenuBtn); }
		function handleMenuBtn(e) {
			e.preventDefault();
			e.stopPropagation();
			menuToggled = !menuToggled;
			refresh = false;
			if (menuToggled) { menu.style.display = "flex" }
			else { menu.style.display = "none" }
		}

		/* ---------------------------------------------------------------- */
		// Resume Button (Menu)
		/* ---------------------------------------------------------------- */
		/**
		 * @description Opens or closes menu based on menu state
		 */
		if (!TV_BOOL || OVERRIDE_TV) { optResumeBtn.addEventListener("click", handleResume); }
		function handleResume(e) {
			e.preventDefault();
			e.stopPropagation();
			menuToggled = !menuToggled;
			refresh = false;
			if (menuToggled) { menu.style.display = "flex" }
			else { menu.style.display = "none" }
		}

		/* ---------------------------------------------------------------- */
		// Restart Button (Menu)
		/* ---------------------------------------------------------------- */
		/**
		 * @description Restart current game & render a new board
		 */
		if (!TV_BOOL || OVERRIDE_TV) { optRestartBtn.addEventListener("click", handleRestart) }
		async function handleRestart(e) {
			e.preventDefault();
			e.stopPropagation();
			boardReset = true;
			ctx.clearRect(0, 0, cw, ch);
			refresh = false;
			menuToggled = false;
			optBtn.style.display = "none"
			menu.style.display = "none"
			// THE RESTART PARAM IS THE AI'S COLOR (THE BACKEND STORES PLAYER_ID_1 AS WHITE), GIVING THE AI THE PLAYER'S COLOR FLIPS SIDES EACH RESTART
			const aiColor = playerColor;
			const restartResponse = await validate(GAME_URL, GAME_ID, PLAYER_ID, false, false, aiColor); // RESETS THE GAME IN THE DATABASE
			if (restartResponse?.status != 200 || !restartResponse?.game_board) { // RESET FAILED, KEEP THE CURRENT GAME
				console.log(restartResponse);
				optBtn.style.display = "flex";
				boardReset = false;
				refresh = true;
				return;
			}
			drawScreen = function () { return };
			await setInitialData(); // GETS THE NEW BOARD & PLAYER COLOR FROM THE DATABASE
			handleInitialData();
			optBtn.style.display = "flex";
			optResumeBtn.parentElement.style.display = 'flex';
			resultDisplay.innerText = "Lakeside Chess"
			await refreshData(response);
			opposingMove = chessInst.turn() != playerColor;
			boardReset = false;
			refresh = true;
			return
		}

		/* ---------------------------------------------------------------- */
		// Homepage Button (Menu)
		/* ---------------------------------------------------------------- */
		/**
		 * @description Renders homepage & removes event listeners
		 */
		if (!TV_BOOL || OVERRIDE_TV) { optHomepageBtn.addEventListener("click", handleHomepage); }
		function handleHomepage(e) {
			e.preventDefault();
			e.stopPropagation();

			window.clearInterval(drawInterval);
			if (PLAYER_ID != "LAKESIDE_GUEST_USER") {
				menu.style.display = "none"
				if (document.getElementById("loadingDiv")) { document.getElementById("loadingDiv").remove(); }

				window.removeEventListener("resize", handleWindowResize);
				window.removeEventListener("keydown", handleKeyPress);
				canvas.removeEventListener("click", handleCanvasClick);
				canvas.removeEventListener("mousemove", handleMouseMove);
				canvas.removeEventListener("mousedown", handleMouseDown);
				canvas.removeEventListener("mouseup", handleMouseUp);
				canvas.removeEventListener("touchstart", handleTouchStart);
				canvas.removeEventListener("touchmove", handleTouchMove);
				canvas.removeEventListener("touchend", handleTouchEnd);
				canvas.removeEventListener("touchcancel", handleTouchCancel);

				optBtn.removeEventListener("click", handleMenuBtn);
				optResumeBtn.removeEventListener("click", handleResume);
				optRestartBtn.removeEventListener("click", handleRestart);
				optHomepageBtn.removeEventListener("click", handleHomepage);
				optExitBtn.removeEventListener("click", handleExit);
			}
			menu.style.display = 'none';

			window.postMessage({
				action: "home",          // Action key.
				receiptToken: "{receipt-token}", // Receipt validation token.
			})
		}

		/* ---------------------------------------------------------------- */
		// Exit Button (Menu)
		/* ---------------------------------------------------------------- */
		/**
		 * @description Exits game
		 */
		if (!TV_BOOL || OVERRIDE_TV) { optExitBtn.addEventListener("click", handleExit); }
		function handleExit(e) {
			e.preventDefault();
			e.stopPropagation();
			window.postMessage({
				action: "exit",          // Action key.
				receiptToken: "{receipt-token}", // Receipt validation token.
			})
		}
	}
}