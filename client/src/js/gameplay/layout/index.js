/*
 *  index.js  --  chess frontend
 *	Layout
 *	Sizes the canvas & the board to the window (large, medium & small boards on wide screens, portrait on phones),
 *	draws the table, board & coordinates under the pieces & works out the squares the rest of the game draws on
 *	(game.xBoardOff, game.tileWidth, ...). Redraws the game when the window is resized
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, canvas, ctx } = require("../state/index.js"); // THE GAME'S SHARED STATE, THE CANVAS
const { images } = require("../images/index.js"); // THE LOADED IMAGES BY IMAGE NUMBER
const { tableShdw, boardImg, boardShdw, rawBoardImg } = require("../sprites/index.js"); // IMAGE NUMBERS
const { placeMoveList } = require("../movelist/index.js"); // MOVES THE MOVE LIST PANEL TO THE FREE SPACE NEXT TO THE BOARD
const { placeEvalBar } = require("../analysis/index.js"); // PUTS THE EVALUATION BAR BESIDE THE BOARD
const { drawBoard } = require("../renderer/index.js"); // DRAWS THE BOARD THAT'S ON (2D OR 3D)

const xBoardShadowRatio = 0.985; // NUDGES THE SQUARES RIGHT A LITTLE TO LINE UP WITH THE BOARD IMAGE
const COORD_BORDER_RATIO = 0.285; // SQUARES FROM THE BOARD'S EDGE TO THE MIDDLE OF THE BAND BETWEEN THE BORDER'S GOLD LINES

let bw; // WIDTH OF THE 64 SQUARES (BOARD WITHOUT ITS WOOD BORDER)
let bh; // HEIGHT OF THE 64 SQUARES
let boardWidth; // BOARD IMAGE WIDTH (WITH THE WOOD BORDER)
let boardHeight; // BOARD IMAGE HEIGHT
let xBoardStart; // LEFT OF THE BOARD IMAGE
let yBoardStart; // TOP OF THE BOARD IMAGE

const insetProbe = document.createElement("div"); // ITS PADDING IS THE SAFE AREA (NOTCH, ROUNDED CORNERS, HOME BAR), READ BY safeArea()
insetProbe.style.cssText = "position: fixed; visibility: hidden; pointer-events: none; padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px)";
document.body.appendChild(insetProbe);

let coffeeStartTime = Date.now(); // CLOCK OF THE COFFEE STEAM ANIMATION
let renderCoffeeImg = false; // THE SCREEN IS WIDE ENOUGH FOR THE TABLE PROPS

// TABLE PROPS: img2 = IMAGE, shdw = SHADOW, img = STEAM ANIMATION FRAMES (EMPTY, SO NO STEAM)
// !NOTE: THE PROPS ARE NEVER GIVEN A SIZE (A SMALL BOARD SETS IT TO 0), SO THEY DRAW AT 0 x 0 (HIDDEN) RIGHT NOW
let coffeeObj = { img: [], img2: 52, shdw: 53, x: null, y: null, width: null, height: null }
let deckObj = { img: [], img2: 54, shdw: 55, x: null, y: null, width: null, height: null }
let candleObj = { img: [], img2: 56, shdw: 57, x: null, y: null, width: null, height: null }


/* ---------------------------------------------------------------- */
// Draw Board / Set Variables Accordingly
/* ---------------------------------------------------------------- */
/**
 * @description Initializes draw data which sets positions onto the board. Sizes the canvas to the window, picks the
 * board size for the screen shape (large, medium, small or portrait), sizes the menu, draws the table shadow & board,
 * then works out the squares (bw, bh, xBoardOff, yBoardOff, tileWidth, tileHeight). Resets the piece counts for the frame
 * @return {[object]} { clickX, clickY } [pixel position of the square under the mouse, from the board's top left]
 */
export function renderBoard() {
	game.cw = window.innerWidth;
	game.ch = window.innerHeight;
	const safe = safeArea(); // THE BOARD, ITS TRAYS & THE PROMOTION PICKER FIT & CENTER IN HERE, THE TABLE STILL FILLS THE SCREEN
	const cw = game.cw - safe.left - safe.right;
	const ch = game.ch - safe.top - safe.bottom;
	const dpr = Math.min(window.devicePixelRatio || 1, 2); // RENDER AT DEVICE RESOLUTION (CAPPED) SO THE BOARD IS SHARP ON HIGH DPI / MOBILE SCREENS
	canvas.width = Math.round(game.cw * dpr);
	canvas.height = Math.round(game.ch * dpr);
	canvas.style.width = `${game.cw}px`;
	canvas.style.height = `${game.ch}px`;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // ALL DRAWING STAYS IN CSS PIXELS
	game.portraitBoard = cw < ch;
	let boardPadding = 1.4; // SCREEN SIZE / BOARD SIZE, BIGGER = SMALLER BOARD
	boardWidth = cw / boardPadding;
	boardHeight = (9 * (cw / boardPadding)) / 11; // THE BOARD IMAGE IS 11:9 (WIDE)
	// THE MENU IS SIZED BY CSS (css/nav.css)

	let widthOverHeight, smBoard = false;
	if (canvas.width) { // ASPECT RATIO OF BOARD WITH MARBLE IF CANVAS WIDTH > HEIGHT
		if (cw > ch * (boardPadding - 0.2)) { // LANDSCAPE: THE HEIGHT SIZES THE BOARD
			widthOverHeight = true;
			boardHeight = ch / boardPadding;
			boardWidth = (11 * (ch / boardPadding)) / 9;
			if (cw * .5875 > ch) { // LARGE BOARD
				renderCoffeeImg = true;
				game.widthGreater = true;
				boardPadding = 1.2;
				boardHeight = ch / boardPadding;
				boardWidth = (11 * (ch / boardPadding)) / 9;
			} else if (cw > ch * (boardPadding + 0.215)) { // MEDIUM BOARD
				renderCoffeeImg = true;
				game.widthGreater = true;
				boardPadding = 1.25;
				boardHeight = ch / boardPadding;
				boardWidth = (11 * (ch / boardPadding)) / 9;
			} else { // SMALL BOARD
				smBoard = true;
				renderCoffeeImg = false;
				game.widthGreater = false;
				boardPadding = 1.4;
				boardHeight = ch / boardPadding;
				boardWidth = (11 * (ch / boardPadding)) / 9;
			}
		} else { // NARROW: THE WIDTH SIZES THE BOARD, TAKEN PIECES GO ABOVE & BELOW IT
			renderCoffeeImg = false;
			game.widthGreater = false;
			if (game.portraitBoard) { // PORTRAIT (MOBILE) BOARD: FILL THE WIDTH, LEAVING HEIGHT FOR THE TAKEN PIECE ROWS ABOVE & BELOW
				boardWidth = Math.min(cw * 0.98, ch * 0.8);
				boardHeight = (9 * boardWidth) / 11;
			}
		}
	}

	xBoardStart = safe.left + (cw - boardWidth) / 2; // DIFFERENCE OF THE X AXIS MARBLE EDGES OF THE BOARD TO JUST THE BOARD
	yBoardStart = safe.top + (ch - boardHeight) / 2; // DIFFERENCE OF THE Y AXIS MARBLE EDGES OF THE BOARD TO JUST THE BOARD

	ctx.drawImage(images[tableShdw].image, 0, 0, game.cw, game.ch); // RENDER TABLE SHDW
	ctx.drawImage(images[boardShdw].image, xBoardStart, yBoardStart, boardWidth, boardHeight); // RENDER BOARD SHADOW
	ctx.drawImage(images[boardImg].image, xBoardStart, yBoardStart, boardWidth, boardHeight); // RENDER BOARD

	bw = (boardWidth - (boardWidth * (images[boardImg].image.naturalWidth - images[rawBoardImg].image.naturalWidth) / images[boardImg].image.naturalWidth)) // THE WIDTH OF THE CHESS BOARD NO MARBLE
	bh = (boardHeight - (boardHeight * (images[boardImg].image.naturalHeight - images[rawBoardImg].image.naturalHeight) / images[boardImg].image.naturalHeight)) // THE HEIGHT OF THE CHESS BOARD NO MARBLE
	game.xBoardOff = safe.left + (cw - (bw * xBoardShadowRatio)) / 2; // WHERE THE FIRST TILE OF THE CHESS BOARD STARTS X
	game.yBoardOff = safe.top + (ch - bh) / 2; // WHERE THE FIRST TILE OF THE CHESS BOARD STARTS Y
	game.tileWidth = bw / 8;
	game.tileHeight = bh / 8;
	drawCoordinates();

	game.xPieceOffset = bw / 5.75; // PIECE IMAGES ARE A SQUARE PLUS THIS, CENTERED ON THE SQUARE
	game.yPieceOffset = bh / 4.25;
	placeMoveList(xBoardStart, yBoardStart, boardHeight);
	placeEvalBar(xBoardStart, yBoardStart, boardHeight);

	let clickX = game.tileX * game.tileWidth; // SQUARE UNDER THE MOUSE IN PIXELS
	let clickY = game.tileY * game.tileHeight;
	game.wPieceCount = { king: 0, queen: 0, bishop: 0, knight: 0, rook: 0, pawn: 0 }; // OBJECT STORE OF THE PIECES ON THE BOARD FOR WHITE, COUNTED AS THEY'RE DRAWN (TAKEN = START COUNT - THIS)
	game.bPieceCount = { king: 0, queen: 0, bishop: 0, knight: 0, rook: 0, pawn: 0 }; // OBJECT STORE OF THE PIECES ON THE BOARD FOR BLACK

	if (widthOverHeight) {
		/* Board Extras */
		// !NOTE: THE COFFEE, CARDS & CANDLE ARE NEVER GIVEN A SIZE, SO THEY DRAW AT 0 x 0 (HIDDEN)
		candleObj.y = (yBoardStart);
		if (smBoard) { // SMALL BOARD: NO ROOM FOR THE PROPS
			coffeeObj.height = 0;
			coffeeObj.width = 0;
			deckObj.height = 0;
			deckObj.width = 0;
			candleObj.height = 0;
			candleObj.width = 0;
		}
	}

	if (renderCoffeeImg) { // TABLE PROPS ON WIDE SCREENS
		renderCoffee();
		ctx.drawImage(images[deckObj.shdw].image, deckObj.x, deckObj.y, deckObj.width, deckObj.height);
		ctx.drawImage(images[deckObj.img2].image, deckObj.x, deckObj.y, deckObj.width, deckObj.height);
		ctx.drawImage(images[candleObj.shdw].image, candleObj.x, candleObj.y, candleObj.width, candleObj.height);
		ctx.drawImage(images[candleObj.img2].image, candleObj.x, candleObj.y, candleObj.width, candleObj.height);
	}
	return { clickX, clickY }
}

/**
 * @description The safe area's insets, 0 on screens without a notch or rounded corners (& browsers without env())
 * @return {[object]} { top, right, bottom, left } [CSS pixels]
 */
function safeArea() {
	const style = getComputedStyle(insetProbe);
	const px = (side) => parseFloat(style[`padding${side}`]) || 0;
	return { top: px("Top"), right: px("Right"), bottom: px("Bottom"), left: px("Left") };
}

/* ---------------------------------------------------------------- */
// Board Coordinates
/* ---------------------------------------------------------------- */
/**
 * @description Draws a - h along the bottom & 1 - 8 up the left of the wood border, centered on their files & ranks,
 * reversed when viewing from black's side. Sized from the squares, so it fits every board renderBoard() picks
 */
function drawCoordinates() {
	const flipped = game.viewColor == 'b';
	const fileY = game.yBoardOff + game.tileHeight * (8 + COORD_BORDER_RATIO);
	const rankX = game.xBoardOff - game.tileWidth * COORD_BORDER_RATIO;
	ctx.font = `600 ${game.tileHeight * 0.3}px Archivo, "Helvetica Neue", Arial, sans-serif`;
	ctx.fillStyle = "#d9b27a"; // THE BOARD'S GOLD INLAY
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	for (let i = 0; i < 8; i++) {
		ctx.fillText(String.fromCharCode(97 + (flipped ? 7 - i : i)), game.xBoardOff + (i + 0.5) * game.tileWidth, fileY);
		ctx.fillText(flipped ? i + 1 : 8 - i, rankX, game.yBoardOff + (i + 0.5) * game.tileHeight);
	}
}

/* ---------------------------------------------------------------- */
// Render Coffee
/* ---------------------------------------------------------------- */
/**
 * @description Renders steaming coffee to the table. Draws the cup & its shadow, the steam frames (coffeeObj.img) are empty
 * so there's no steam right now
 */
async function renderCoffee() {
	const coffeeAnimateTime = 2000; // 2 SEC TO SHOW EVERY STEAM FRAME
	const eachCoffeeImgTime = coffeeAnimateTime / coffeeObj.img.length // TIME PER FRAME
	const currCoffeeImgIndex = Math.floor(((Date.now() - coffeeStartTime) % coffeeAnimateTime) / eachCoffeeImgTime); // THE STEAM FRAME FOR NOW
	ctx.drawImage(images[coffeeObj.shdw].image, coffeeObj.x, coffeeObj.y, coffeeObj.width, coffeeObj.height);
	ctx.drawImage(images[coffeeObj.img2].image, coffeeObj.x, coffeeObj.y, coffeeObj.width, coffeeObj.height);
	if (currCoffeeImgIndex == coffeeObj.img.length - 1) { coffeeStartTime = Date.now(); } // LAST FRAME: START THE STEAM OVER
};


/* ---------------------------------------------------------------- */
// Resize Window
/* ---------------------------------------------------------------- */
/**
 * @description Redraws the game at the new window size (renderBoard() resizes everything from the window, the 3D board follows its container)
 */
export function handleWindowResize() {
	if (game.boardReset) { return; } // LOADING: THE OLD BOARD STAYS, SLIDING HOME: drawRestartSlide() DRAWS THE NEW SIZE NEXT FRAME
	game.refresh = true;
	try {
		drawBoard();
		game.refresh = false;
	} catch (err) { console.log(err); }
};
