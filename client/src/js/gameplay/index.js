/*
 *  index.js  --  chess frontend
 *	Gameplay
 *	Draws the game to a canvas (table, board, pieces, shadows & reflections), handles moves by
 *	click, drag, touch & TV remote, slides the AI's / opponent's moves in & runs the in game menu.
 *	Moves are checked locally with chess.js, then saved by the chess server (validate/index.js)
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
import "../../css/style.css"; // PAGE & MENU STYLES

const { Chess } = require("chess.js"); // RULES, LEGAL MOVES & FEN (SAME VERSION AS THE SERVER)
const { validate, restartGame, forfeitGame, rematchGame } = require("./validate/index.js"); // REQUESTS TO THE CHESS SERVER (/api/chess)
const { playerMove } = require("./user/index.js"); // TURNS A DROPPED TILE INTO A { from, to, promotion } MOVE
const { playAi } = require("./ai/index.js"); // ASKS THE SERVER FOR THE AI'S MOVE
const { setTiles } = require("./utils/index.js"); // NEW ARRAY OF 64 BLANK TILE STATES
const { SPRITES } = require("./sprites/index.js"); // EVERY SPRITE URL IN IMAGE NUMBER ORDER (HOME & GUEST USE IT TO WARM THE BROWSER CACHE)
const { joinGame, leaveGame } = require("../socket/index.js"); // FRIEND GAMES: THE SERVER PUSHES MOVES, FORFEITS & REMATCHES
const main = document.querySelector("#main"); // THE CANVAS IS ADDED HERE
const optBtn = document.getElementById("optBtn"); // GEAR BUTTON, OPENS THE MENU
const menu = document.getElementById("menuContainer"); // IN GAME MENU
const optResumeBtn = document.getElementById("optResume"); // MENU: RESUME
const optRestartBtn = document.getElementById("optRestart"); // MENU: RESTART (AI GAMES) / FORFEIT & REMATCH (FRIEND GAMES)
const optHomepageBtn = document.getElementById("optSettings"); // MENU: HOMEPAGE
const optExitBtn = document.getElementById("optExit"); // MENU: EXIT
const canvas = document.createElement("canvas"); // THE WHOLE GAME IS DRAWN ON THIS
const resultDisplay = document.getElementById("resultDisplay"); // MENU TITLE ("Chess" OR THE RESULT)
const newGameInput = document.getElementsByClassName("newGameInput"); // HOME SCREEN INPUTS, SIZED WITH THE MENU

const OVERRIDE_TV = false; // TRUE TURNS ON THE TV REMOTE (ARROW KEYS & ENTER) & THE MOUSE TOGETHER, FOR TESTING

const imagePaths = [];			// This will hold array of all loaded image resources
const images = [];				// { path, image } IN LOAD ORDER, THE INDEX IS THE IMAGE NUMBER USED TO DRAW IT (SEE IMAGE NUMBERS IN renderCanvas)
let imagememory = 0;			// BYTES OF ALL LOADED IMAGES (LOGGED)
let loadedImages = 0;			// IMAGES FINISHED LOADING, THE GAME STARTS WHEN THIS MATCHES images.length
/* ---------------------------------------------------------------- */
// Load Image
/* ---------------------------------------------------------------- */
/**
 * @description Loads an image once. It's added to images[] before it finishes loading, so its index is the order loadImage() was called in
 * @param  {[string]} path [image url, ".png" is added when there's no extension]
 * @return {[object]} img [Promise of the loaded Image, or the saved one if this path was already loaded]
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
// Preload Images
/* ---------------------------------------------------------------- */
/**
 * @description Loads every image the game draws, from CHESS_ASSESTS_URL (S3 / CloudFront). The list is SPRITES (gameplay/sprites/index.js).
 * !NOTE: THE ORDER MATTERS. EACH IMAGE'S INDEX IN images[] IS ITS IMAGE NUMBER IN renderCanvas (wFrontKingImg = 5, ...),
 * SO NEW IMAGES GO AT THE END OF SPRITES OR EVERY NUMBER AFTER THEM HAS TO CHANGE
 */
export function preloadImages() {
	for (let i = 0; i < SPRITES.length; i++) { loadImage(SPRITES[i]); } // IN ORDER, SO images[i] IS SPRITES[i]
}

/* ---------------------------------------------------------------- */
// Render Canvas
/* ---------------------------------------------------------------- */
/**
 * @description Starts a game: adds the canvas to main, loads the game from the server & runs the render loop.
 * Holds all of the game's state & every function that uses it
 * @param  {[object]} playerData [{ GAME_URL, GAME_ID, PLAYER_ID, TV_BOOL }, TV_BOOL = TV REMOTE CONTROLS INSTEAD OF THE MOUSE]
 */
export async function renderCanvas(playerData) {
	const { GAME_URL, PLAYER_ID, TV_BOOL } = playerData; // SETS CONSTANT GAME VARIABLES
	let GAME_ID = playerData.GAME_ID; // CHANGES WHEN AN AI GAME RESTARTS OR A FRIEND GAME REMATCHES

	optBtn.style.display = "flex"; // SHOW THE GEAR BUTTON

	const ctx = canvas.getContext("2d"); // EVERYTHING IS DRAWN WITH THIS
	canvas.id = "canvas";

	const chessInst = new Chess(); // THE BOARD THAT'S DRAWN, LOADED FROM THE SERVER'S FEN
	const validateState = new Chess(); // SCRATCH BOARD, TESTS A MOVE WITHOUT CHANGING chessInst
	let cw = (canvas.width = window.innerWidth); // CANVAS WIDTH (CSS PIXELS)
	let ch = (canvas.height = window.innerHeight); // CANVAS HEIGHT (CSS PIXELS)
	let bw; // WIDTH OF THE 64 SQUARES (BOARD WITHOUT ITS WOOD BORDER)
	let bh; // HEIGHT OF THE 64 SQUARES
	let drawScreen; // DRAWS ONE FRAME, SET BY handleInitialData() FOR THE PLAYER'S COLOR
	let refresh = true; // TRUE DRAWS A FRAME ON THE NEXT TICK OF THE RENDER LOOP
	let tileWidth; // WIDTH OF ONE SQUARE
	let tileHeight; // HEIGHT OF ONE SQUARE
	let tileX; // SCREEN COLUMN UNDER THE MOUSE (0 - 7 ON THE BOARD)
	let tileY; // SCREEN ROW UNDER THE MOUSE (0 - 7 ON THE BOARD)
	let clientX; // MOUSE X ON THE CANVAS
	let clientY; // MOUSE Y ON THE CANVAS
	let clickX; // PIXEL X OF tileX, A HELD PIECE IS DRAWN THERE
	let clickY; // PIXEL Y OF tileY
	let opponentColor; // 'w' OR 'b'
	let ai // TRUE IN AI GAMES
	let aiTurn = false; // TRUE WHEN THE RENDER LOOP SHOULD ASK THE SERVER FOR THE AI'S MOVE
	let response; // LATEST GAME FROM THE SERVER { game_board, w_knight, b_knight, w_piece, b_piece, player_color, state, ... }
	let revert; // GAME TO GO BACK TO IF A MOVE FAILS
	let playerColor; // 'w' OR 'b', BLACK FLIPS THE BOARD SO THE PLAYER IS ALWAYS AT THE BOTTOM
	let moveObj = [null, null] // MOVE BEING PLAYED { from, to, promotion }, THE AI'S ALSO HAS response
	let tiles = setTiles(); // 64 TILE STATES IN SCREEN ORDER (ROW * 8 + COLUMN), FILLED WITH THE PIECE ON EACH SQUARE WHILE DRAWING
	let boardWidth; // BOARD IMAGE WIDTH (WITH THE WOOD BORDER)
	let boardHeight; // BOARD IMAGE HEIGHT
	let xBoardStart; // LEFT OF THE BOARD IMAGE
	let yBoardStart; // TOP OF THE BOARD IMAGE
	let xBoardOff; // LEFT OF THE SQUARES (SCREEN COLUMN 0)
	let yBoardOff; // TOP OF THE SQUARES (SCREEN ROW 0)
	let offBoardRefresh = true; // REDRAW WHEN THE MOUSE LEAVES THE BOARD (CLEARS HOVER EFFECTS)
	let wPieceCount = { king: 0, queen: 0, bishop: 0, knight: 0, rook: 0, pawn: 0 }; // WHITE PIECES DRAWN THIS FRAME, TAKEN PIECES = START COUNT - THIS
	let bPieceCount = { king: 0, queen: 0, bishop: 0, knight: 0, rook: 0, pawn: 0 }; // BLACK PIECES DRAWN THIS FRAME
	let wTakenPieces; // WHITE PIECES THAT WERE TAKEN [{ color, type, x, y }]
	let bTakenPieces; // BLACK PIECES THAT WERE TAKEN
	let clickedTile = false; // TILE PICKED UP BY A CLICK (OR A FINISHED DRAG)
	let mousedownTile = false; // TILE BEING DRAGGED
	let currPromotion = false; // TRUE WHILE THE PLAYER PICKS THEIR PROMOTION PIECE
	let currSlide = false; // TRUE WHILE A PIECE SLIDES TO ITS NEW SQUARE
	let slidePos; // SQUARE THE SLIDING PIECE IS CROSSING (trackSlidePosition)
	let slideStart = false; // FIRST FRAME OF A SLIDE, A KNIGHT STOPS FOR 100MS BEFORE ITS HOP
	let menuToggled = false; // MENU IS OPEN
	let mouseDownCount = 0; // FRAMES THE MOUSE HAS BEEN HELD ON A PIECE, MORE THAN 3 MAKES IT A DRAG
	let opposingMove = false; // TRUE WHILE IT'S NOT THE PLAYER'S TURN, LOCKS THE BOARD
	let boardReset = false; // TRUE WHILE A NEW BOARD LOADS (RESTART & REMATCH), STOPS DRAWING
	let gameOver = false; // THE SERVER CLOSED THE GAME (CHECKMATE, DRAW OR FORFEIT)
	let confirmForfeit = false; // FORFEIT NEEDS A SECOND PRESS
	let rematchWaiting = false; // TIMER WHILE WAITING 1 MINUTE ON THE OPPONENT'S REMATCH PRESS
	let availableMoves; // LEGAL MOVES OF THE SELECTED PIECE (chess.js VERBOSE MOVES)
	let initialAnimation = true; // START ANIMATION (renderBoardAnimation), NOT USED: renderLoop() SETS IT TO FALSE FIRST
	// let initialRender = true;
	let currInst; // 8 x 8 BOARD FROM chessInst.board(), FLIPPED WHEN PLAYING BLACK
	let availableMovesData = { piece: null, square: null } // PIECE & SQUARE availableMoves IS FOR, SO THE MOVES ARE ONLY FOUND ONCE
	let widthGreater; // WIDE SCREEN: TAKEN PIECES GO TO THE RIGHT OF THE BOARD
	let portraitBoard = false; // TALL SCREEN (MOBILE)
	let touchState = null; // ACTIVE TOUCH (MOBILE): { id, startX, startY, dragging, point }
	const frameRate = 1000 / 33; // MS BETWEEN FRAMES (ABOUT 33 A SECOND)
	// const imagePaths = [];			// This will hold array of all loaded image resources
	// const images = [];
	// imagememory = 0;
	// loadedImages = 0;
	const moveAudio = new Audio(`${process.env.CHESS_ASSESTS_URL}/audio/piece-jump.mp4`); // MOVE SOUND

	let startTime = new Date(); // WHEN THE LAST SLIDE STARTED
	let endTime = new Date(); // WHEN THE LAST SLIDE FINISHED
	let timeElapsed = endTime - startTime; // HOW LONG THE LAST SLIDE TOOK (MS)


	let remoteNavBox = { x: 7, y: 0, menuHover: false, menuBtn: false } // TV REMOTE SELECT BOX: SQUARE (x, y), ON THE GEAR BUTTON (menuHover) & THE SELECTED MENU BUTTON

	// !NOTE: IMAGE NUMBERS EQUALS INDEX USED TO CHECK IF ALL IMAGES ARE LOADING IN THE BACKGROUND
	// EACH NUMBER IS THE IMAGE'S INDEX IN images[], SO IT HAS TO MATCH THE ORDER OF preloadImages()
	// PIECES ARE DRAWN AS 3 LAYERS: REFLECTION (ON THE BOARD BELOW THE PIECE), SHADOW, THEN THE PIECE
	// TABLE = 0
	const tableShdw = 1; // table-shdw.png

	const boardImg = 2; // chess-board.png
	const boardShdw = 3; // chess-board-shdw.webp
	const rawBoardImg = 4; // raw-board.png, ITS SIZE GIVES THE WOOD BORDER'S WIDTH

	const xBoardShadowRatio = 0.985; // NUDGES THE SQUARES RIGHT A LITTLE TO LINE UP WITH THE BOARD IMAGE

	// WHITE IMAGES
	let wKingImg; // KING IMAGE BEING DRAWN, SET TO THE FRONT OR BACK ONE BEFORE EACH DRAW (handlePieceDirectionW)
	const wFrontKingImg = 5; // wk-e1.png, FACES THE PLAYER
	const wBackKingImg = 58; // wk-back.png, FACES AWAY
	let wQueenImg; // SET WITH wKingImg
	const wFrontQueenImg = 6; // wq-d1.png
	const wBackQueenImg = 59; // wq-back.png
	let wBishopBlackSqImg; // SET WITH wKingImg
	let wBishopWhiteSqImg; // SET WITH wKingImg
	const wFrontBishopBlackSqImg = 7; // wb-c1.png, BISHOP ON A DARK SQUARE
	const wFrontBishopWhiteSqImg = 8; // wb-f1.png, BISHOP ON A LIGHT SQUARE
	const wBackBishopImg = 60; // wb-back.png (BOTH SQUARE COLORS)
	let wKnightImg; // KNIGHT IMAGE BEING DRAWN, SET TO THE RIGHT OR LEFT ONE BEFORE EACH DRAW (BOTH WHITE KNIGHTS SHARE IT)
	const wRightKnightImg = 9; // wn-b1.png, FACES RIGHT
	const wLeftKnightImg = 10; // wn-g1.png, FACES LEFT
	let wRookImg; // SET WITH wKingImg
	const wFrontRookImg = 11; // wr-h1.png
	const wBackRookImg = 61; // wr-back.png
	const wPawnImg = 12; // wp-a2.png

	// WHITE SHADOW
	let wKingShdw; // SET WITH wKingImg
	const wFrontKingShdw = 13; // wk-shdw.png
	const wBackKingShdw = 62; // wk-back-shdw.png
	let wQueenShdw; // SET WITH wKingImg
	const wFrontQueenShdw = 14; // wq-shdw.png
	const wBackQueenShdw = 63; // wq-back-shdw.png
	let wBishopShdw; // SET WITH wKingImg
	const wFrontBishopShdw = 15; // wb-shdw.png (BOTH BISHOPS)
	const wBackBishopShdw = 64; // wb-back-shdw.png
	let wKnightShdw // SET WITH wKnightImg
	const wRightKnightShdw = 16; // wn-b1-shdw.png
	const wLeftKnightShdw = 17; // wn-g1-shdw.png
	let wRookShdw; // SET WITH wKingImg
	const wFrontRookShdw = 18; // wr-shdw.png
	const wBackRookShdw = 65; // wr-back-shdw.png
	const wPawnShdw = 19; // wp-shdw.png

	// WHITE REFLECT
	let wKingRefl; // SET WITH wKingImg
	const wFrontKingRefl = 20; // wk-refl.png
	const wBackKingRefl = 66; // wk-back-refl.png
	let wQueenRefl; // SET WITH wKingImg
	const wFrontQueenRefl = 21; // wq-refl.png
	const wBackQueenRefl = 67; // wq-back-refl.png
	let wBishopRefl; // SET WITH wKingImg
	const wFrontBishopRefl = 22; // wb-refl.png (BOTH BISHOPS)
	const wBackBishopRefl = 68; // wb-back-refl.png
	let wKnightRefl // SET WITH wKnightImg
	const wRightKnightRefl = 23; // wn-b1-refl.png
	const wLeftKnightRefl = 24; // wn-g1-refl.png
	let wRookRefl; // SET WITH wKingImg
	const wFrontRookRefl = 25; // wr-refl.png
	const wBackRookRefl = 69; // wr-back-refl.png
	const wPawnRefl = 26; // wp-refl.png

	// BLACK IMAGES
	let bKingImg; // KING IMAGE BEING DRAWN, SET TO THE FRONT OR BACK ONE BEFORE EACH DRAW (handlePieceDirectionB)
	const bFrontKingImg = 27; // bk-e8.png, FACES THE PLAYER (WHEN PLAYING WHITE)
	const bBackKingImg = 70; // bk-back.png, FACES AWAY
	let bQueenImg; // SET WITH bKingImg
	const bFrontQueenImg = 28; // bq-d8.png
	const bBackQueenImg = 71; // bq-back.png
	let bBishopBlackSqImg; // SET WITH bKingImg
	let bBishopWhiteSqImg; // SET WITH bKingImg
	const bFrontBishopBlackSqImg = 29; // bb-f8.png, BISHOP ON A DARK SQUARE
	const bFrontBishopWhiteSqImg = 30; // bb-c8.png, BISHOP ON A LIGHT SQUARE
	const bBackBishopImg = 72; // bb-back.png (BOTH SQUARE COLORS)
	let bKnightImg; // KNIGHT IMAGE BEING DRAWN, SET TO THE RIGHT OR LEFT ONE BEFORE EACH DRAW (BOTH BLACK KNIGHTS SHARE IT)
	const bRightKnightImg = 31; // bn-b8.png, FACES RIGHT
	const bLeftKnightImg = 32; // bn-g8.png, FACES LEFT
	let bRookImg; // SET WITH bKingImg
	const bFrontRookImg = 33; // br-h8.png
	const bBackRookImg = 73; // br-back.png
	const bPawnImg = 34; // bp-a7.png

	// BLACK SHADOW
	let bKingShdw; // SET WITH bKingImg
	const bFrontKingShdw = 35; // bk-shdw.png
	const bBackKingShdw = 74; // bk-back-shdw.png
	let bQueenShdw; // SET WITH bKingImg
	const bFrontQueenShdw = 36; // bq-shdw.png
	const bBackQueenShdw = 75; // bq-back-shdw.png
	let bBishopShdw; // SET WITH bKingImg
	const bFrontBishopShdw = 37; // bb-shdw.png (BOTH BISHOPS)
	const bBackBishopShdw = 76; // bb-back-shdw.png

	let bKnightShdw; // SET WITH bKnightImg
	const bRightKnightShdw = 38; // bn-b8-shdw.png
	const bLeftKnightShdw = 39; // bn-g8-shdw.png
	let bRookShdw; // SET WITH bKingImg
	const bFrontRookShdw = 40; // br-shdw.png
	const bBackRookShdw = 77; // br-back-shdw.png
	const bPawnShdw = 41; // bp-shdw.png

	// BLACK REFLECT
	let bKingRefl; // SET WITH bKingImg
	const bFrontKingRefl = 42; // bk-refl.png
	const bBackKingRefl = 78; // bk-back-refl.png
	let bQueenRefl; // SET WITH bKingImg
	const bFrontQueenRefl = 43; // bq-refl.png
	const bBackQueenRefl = 79; // bq-back-refl.png
	let bBishopRefl; // SET WITH bKingImg
	const bFrontBishopRefl = 44; // bb-refl.png (BOTH BISHOPS)
	const bBackBishopRefl = 80; // bb-back-refl.png
	let bKnightRefl; // SET WITH bKnightImg
	const bRightKnightRefl = 45; // bn-b8-refl.png
	const bLeftKnightRefl = 46; // bn-g8-refl.png
	let bRookRefl; // SET WITH bKingImg
	const bFrontRookRefl = 47; // br-refl.png
	const bBackRookRefl = 81; // br-back-refl.png
	const bPawnRefl = 48; // bp-refl.png

	// UI
	const moveHighlight = 49; // move-highlight.png, A SQUARE THE SELECTED PIECE CAN MOVE TO
	const takeableHighlight = 50; // takeable-highlight.png, A MOVE THAT TAKES A PIECE
	const checkHighlight = 51; // check-highlight.png, UNDER A KING IN CHECK

	// COFFEE = 52
	// COFFEE SHDW = 53

	// CARDS = 54
	// CARDS SHDW = 55

	// CANDLE = 56
	// CANDLE SHDW = 57

	// BACKS = 58 - 81 (SET UP WITH THE FRONTS ABOVE)

	// TABLE PROPS: img2 = IMAGE, shdw = SHADOW, img = OLD STEAM ANIMATION FRAMES (EMPTY)
	// !NOTE: THE PROP SIZES ARE COMMENTED OUT IN renderBoard(), SO THEY DRAW AT 0 x 0 (HIDDEN) RIGHT NOW
	let coffeeObj = { img: [], img2: 52, shdw: 53, x: null, y: null, width: null, height: null }
	let deckObj = { img: [], img2: 54, shdw: 55, x: null, y: null, width: null, height: null }
	let candleObj = { img: [], img2: 56, shdw: 57, x: null, y: null, width: null, height: null }


	/* ---------------------------------------------------------------- */
	// Check Image Loaded
	/* ---------------------------------------------------------------- */
	/**
	 * @description If all images are loaded start game. Checks once a second, then removes the loading screen (gameContainer)
	 */
	const startGameCheck = setInterval(async function () { if (loadedImages == images.length) {
		if(document.getElementById('gameContainer')) {document.getElementById('gameContainer').remove();}
		startGame(); 
		clearInterval(startGameCheck);
	} }, 1000);

	/* ---------------------------------------------------------------- */
	// Start Game
	/* ---------------------------------------------------------------- */
	/**
	 * @description Starts the core game interval loop. Loads the game, joins a friend game's socket room, adds the canvas
	 * to main & runs renderLoop() every frameRate ms. Every game function below lives in here
	 */
	async function startGame() {
		let refreshDataStartTime = Date.now(); // LAST TIME THE OPPONENT'S MOVE WAS CHECKED (THE OLD POLLING, THE SOCKET PUSHES MOVES NOW)
		let coffeeStartTime = Date.now(); // CLOCK OF THE COFFEE STEAM ANIMATION
		let renderCoffeeImg = false; // THE SCREEN IS WIDE ENOUGH FOR THE TABLE PROPS

		wTakenPieces = setTakenPieceArr("b");
		bTakenPieces = setTakenPieceArr("w");

		let xPieceOffset; // Width of the tile proportionality to the board width (PIECE IMAGES ARE THIS MUCH WIDER THAN A SQUARE, THEY OVERHANG IT)
		let yPieceOffset; // Height of the tile proportionality to the board height (PIECES ARE TALLER THAN A SQUARE)

		let xPos; // TAKEN PIECE TRAY COLUMN (renderTakenPieces)
		let yPos; // TAKEN PIECE TRAY ROW

		refreshDataStartTime = Date.now();
		coffeeStartTime = Date.now();

		let overlapSlideObj = null; // THE 3 x 3 SQUARES AROUND A SLIDING PIECE, SO THE PIECES IT PASSES BEHIND ARE DRAWN ON TOP (drawSlideBox)

		let yPositive = false; // THE SLIDING PIECE IS GOING DOWN THE SCREEN
		let xPositive = false; // THE SLIDING PIECE IS GOING RIGHT

		cw = 0; // SET BY renderBoard()
		ch = 0;

		await setInitialData(); // SETS INITIAL DATA
		handleInitialData(); // HANDLES INITIAL DATA
		const socketHandlers = { move: checkOpponentMove, gameOver: showGameOver, rematch: loadRematch }; // SOCKET EVENT -> HANDLER
		if (!ai && response?.status == 200) { // FRIEND GAME
			joinGame(GAME_ID, PLAYER_ID, socketHandlers); // THE SERVER PUSHES MOVES, FORFEITS & REMATCHES (server/socket.js)
			if (!gameOver) { optRestartBtn.innerHTML = "Forfeit"; } // RESTART IS FORFEIT IN FRIEND GAMES
		}


		canvas.style.backgroundRepeat = "repeat-y"; // THE TABLE BEHIND THE BOARD
		canvas.style.backgroundImage = `url("${process.env.CHESS_ASSESTS_URL}/images/board/table.webp")`;
		canvas.style.backgroundSize = "cover";
		canvas.style.backgroundPosition = "center";
		main.append(canvas);

		/* ################################################################ */
		/* ################################################################ */
		// CORE RENDER LOOP
		/* ################################################################ */
		/* ################################################################ */

		/**
		 * @description Runs every frame (drawInterval). On the AI's turn it asks the server for the AI's move & starts its slide,
		 * otherwise it draws a frame when something changed (refresh) or a piece is sliding (currSlide)
		 */
		async function renderLoop() {
			const endTime = Date.now(); // USED BY THE OLD POLLING CHECK AT THE BOTTOM
			initialAnimation = false; // THE START ANIMATION IS OFF
			if ((refresh || currSlide) && !boardReset) {
				try {
					if (initialAnimation) { renderBoardAnimation(currInst); refresh = true; }
					else {
						if (ai && chessInst.turn() != playerColor && aiTurn) { // IF AI
							revert = response; // GO BACK TO THIS IF THE AI MOVE FAILS
							clearInterval(drawInterval) // NO FRAMES WHILE THE SERVER PICKS THE MOVE
							moveObj = await playAi(GAME_URL, GAME_ID); // THE SERVER PICKS & SAVES THE AI MOVE

							validateState.load(response.game_board); // CHECK THE MOVE ON THE SCRATCH BOARD (THROWS IF IT'S NOT LEGAL)
							validateState.move(moveObj);
							for (let i = 0; i < tiles.length; i++) { // START THE SLIDE OF THE PIECE ON moveObj.from
								if (tiles[i].square == moveObj.from) {
									slideStart = true;
									tiles[i].isSliding = true;
									if (playerColor == 'w') { // SCREEN COLUMN & ROW OF moveObj.to (a8 IS 0, 0)
										tiles[i].xSlideTo = moveObj.to.split("")[0].charCodeAt(0) - 96 - 1;
										tiles[i].ySlideTo = 8 - moveObj.to.split("")[1];
									} else if (playerColor == 'b') { // FLIPPED BOARD (h1 IS 0, 0)
										tiles[i].xSlideTo = 8 - (moveObj.to.split("")[0].charCodeAt(0) - 96);
										tiles[i].ySlideTo = moveObj.to.split("")[1] - 1;
									}
									tiles[i].xDiff = 0; // PIXELS MOVED SO FAR
									tiles[i].yDiff = 0;
								} else if (tiles[i].isSliding) { // STOP ANY OTHER SLIDE
									tiles[i].isSliding = false;
									tiles[i].xDiff = 0;
									tiles[i].yDiff = 0;
								}
							}
							aiTurn = false;
							currSlide = true;
							startTime = new Date();
							drawInterval = setInterval(async function () { await renderLoop() }, frameRate); // FRAMES AGAIN, THE SLIDE PLAYS
							return;
						}
						drawScreen(); // DRAW ONE FRAME
						refresh = false;
					}
				} catch (err) { console.log(err); }
			}
			// if ((endTime - refreshDataStartTime > 2000) && !ai) { await checkOpponentMove(); } // PROMOTIONS OF OPPOSING PLAYER THROWS INVALID MOVE
		}

		let drawInterval = setInterval(async function () { await renderLoop() }, frameRate); // THE RENDER LOOP, ABOUT 33 FRAMES A SECOND

		/*____________________________________________________________________________________________________________________________*/

		/* ################################################################ */
		/* ################################################################ */
		// CORE GAME FUNCTIONS
		/* ################################################################ */
		/* ################################################################ */

		/* ---------------------------------------------------------------- */
		// Start Animation
		/* ---------------------------------------------------------------- */
		/**
		 * @description Animates board from a position: every piece slides in from the top left corner to its square.
		 * !NOTE: NOT USED, renderLoop() SETS initialAnimation TO FALSE BEFORE IT CHECKS IT
		 * @param  {[array]} inst [8 x 8 board from chessInst.board(), flipped when playing black]
		 */
		function renderBoardAnimation(inst) {
			renderBoard();
			let index = 0;
			let totalSlide = 0; // PIECES SLIDING IN
			let completedSlide = 0; // PIECES THAT REACHED THEIR SQUARE
			for (let i = 0; i < inst.length; i++) { // ROW
				for (let j = 0; j < inst[i].length; j++, index++) { // COLUMN
					tiles[index] = { ...inst[i][j], ...tiles[index], x: -1, y: -1 }; // TILE[INDEX] = DECONSTRUCTED ARRAY OF CHESS BOARD ROW/COLUMN, TILE[INDEX] INIT VALUES, X, Y
					if (inst[i][j]) {
						tiles[index].isSliding = true;
						totalSlide += 1;
						tiles[index].xSlideTo = j; // SLIDES FROM -1, -1 TO ITS SQUARE
						tiles[index].ySlideTo = i;

						/* ---------------------------------------------------------------- */
						// Draw image
						/* ---------------------------------------------------------------- */
						/**
						 * @description Draws active piece to canvas (start animation): reflection, shadow, then the piece, a step closer to its square each frame
						 * @param  {[array]} imgArr [image numbers: reflection, shadow, piece]
						 */
						async function drawActivePiece(imgArr) {
							for (let w = 0; w < imgArr.length; w++) {
								if (w == 0) { ctx.globalAlpha = 0.30; } // REFLECTION
								else if (w == 1) { ctx.globalAlpha = 0.75; } // SHADOW
								else if (w == 2) { ctx.globalAlpha = 1; } // PIECE

								if (tiles[index].isSliding) { // IF TILE IS SLIDING
									const xChange = (frameRate / tileHeight) * 5; // PIXELS MOVED PER FRAME
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
										if (xBool && yBool) { // ARRIVED: DRAW IT ON ITS SQUARE
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
									if (pieceColor == "w") { drawActivePiece([wFrontKingRefl, wFrontKingShdw, wFrontKingImg]); }
									else if (pieceColor == "b") { drawActivePiece([bFrontKingRefl, bFrontKingShdw, bFrontKingImg]); }
								} else if (pieceType.match(/[q]/) && pieceColor) { // CHECKS CURRENT INDEX FOR QUEEN
									if (pieceColor == "w") { drawActivePiece([wFrontQueenRefl, wFrontQueenShdw, wFrontQueenImg]); }
									else if (pieceColor == "b") { drawActivePiece([bFrontQueenRefl, bFrontQueenShdw, bFrontQueenImg]); }
								} else if (pieceType.match(/[b]/) && pieceColor) { // CHECKS CURRENT INDEX FOR BISHOP
									if (pieceColor == "w") {
										if (chessInst.squareColor(tiles[index].square) == 'light') { drawActivePiece([wFrontBishopRefl, wFrontBishopShdw, wFrontBishopWhiteSqImg]); }
										else if (chessInst.squareColor(tiles[index].square) == 'dark') { drawActivePiece([wFrontBishopRefl, wFrontBishopShdw, wFrontBishopBlackSqImg]); }
									} else if (pieceColor == "b") {
										if (chessInst.squareColor(tiles[index].square) == 'light') { drawActivePiece([bFrontBishopRefl, bFrontBishopShdw, bFrontBishopWhiteSqImg]); }
										else if (chessInst.squareColor(tiles[index].square) == 'dark') { drawActivePiece([bFrontBishopRefl, bFrontBishopShdw, bFrontBishopBlackSqImg]); }
									}
								} else if (pieceType.match(/[n]/) && pieceColor) { // CHECKS CURRENT INDEX FOR KNIGHT
									/* ---------------------------------------------------------------- */
									// Draw Knight (Board Animation)
									/* ---------------------------------------------------------------- */
									/**
									 * @description Draws the knight to the board (start animation), same as Draw Knight (Draw Screen) below
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
												break;
											} else if (JSON.parse(response.b_knight)[n].from == null && JSON.parse(response.b_knight)[n].to) {
												if (playerColor == 'w') {
													if (JSON.parse(response.b_knight)[n].to == 'b8' && tiles[index].square == 'b8') { bKnightImg = bRightKnightImg; bKnightShdw = bRightKnightShdw; bKnightRefl = bRightKnightRefl; drawKnight(); break; }
													else if (JSON.parse(response.b_knight)[n].to == tiles[index].square) { bKnightImg = bLeftKnightImg; bKnightShdw = bLeftKnightShdw; bKnightRefl = bLeftKnightRefl; drawKnight(); break; }
												} else if (playerColor == 'b') {
													if (JSON.parse(response.b_knight)[n].to == 'b8' && tiles[index].square == 'b8') { bKnightImg = bLeftKnightImg; bKnightShdw = bLeftKnightShdw; bKnightRefl = bLeftKnightRefl; drawKnight(); break; }
													else if (JSON.parse(response.b_knight)[n].to == tiles[index].square) { bKnightImg = bRightKnightImg; bKnightShdw = bRightKnightShdw; bKnightRefl = bRightKnightRefl; drawKnight(); break; }
												}
											}
										}
									}
								} else if (pieceType.match(/[r]/) && pieceColor) { // CHECKS CURRENT INDEX FOR ROOK
									if (pieceColor == "w") { drawActivePiece([wFrontRookRefl, wFrontRookShdw, wFrontRookImg]); wPieceCount.rook++; }
									else if (pieceColor == "b") { drawActivePiece([bFrontRookRefl, bFrontRookShdw, bFrontRookImg]); bPieceCount.rook++; }
								} else if (pieceType.match(/[p]/) && pieceColor) { // CHECKS CURRENT INDEX FOR PAWN
									if (pieceColor == "w") { drawActivePiece([wPawnRefl, wPawnShdw, wPawnImg]); }
									else if (pieceColor == "b") { drawActivePiece([bPawnRefl, bPawnShdw, bPawnImg]); }
								}
							}
						}
					}
				}
			}
			if (completedSlide == totalSlide) { initialAnimation = false; tiles = setTiles(); } // EVERY PIECE ARRIVED, THE ANIMATION IS DONE
		}


		/* ---------------------------------------------------------------- */
		// Set Initial Board Data
		/* ---------------------------------------------------------------- */
		/**
		 * @description Sets initial data. Gets the game from the server & sets the player's color & the board.
		 * Guests get a new AI game first if they don't have one. If it's the AI's turn its move is asked for here & slid in by renderLoop()
		 * @return {[boolean]} false [the game couldn't be loaded]
		 */
		async function setInitialData() {
			if (PLAYER_ID == "GUEST_USER") { // OLD GUEST ID: ALWAYS A NEW GAME, THE GUEST IS WHITE ('b' = THE AI'S COLOR)
				await validate(GAME_URL, GAME_ID, PLAYER_ID, false, false, 'b');
			} else if (PLAYER_ID === GAME_ID && PLAYER_ID && GAME_ID) { // GUEST (A GUEST'S PLAYER ID IS THEIR GAME ID)
				response = await validate(GAME_URL, GAME_ID, PLAYER_ID, false, false, false);
				if (!response?.game_board) { response = await validate(GAME_URL, GAME_ID, PLAYER_ID, false, false, 'b'); } // NO GAME YET: NEW GAME VS THE AI
			}
			response = await validate(GAME_URL, GAME_ID, PLAYER_ID, false, false, false); // GET THE GAME
			playerColor = response?.player_color || null;
			if (response.status == 200) { // IF GAME IS ON AI TURN, PLAY TURN
				opponentColor = response?.opponent_color || false;
				chessInst.load(response.game_board); // THE BOARD TO DRAW
				if (response.state == "CLOSED") { // GAME IS OVER (CHECKMATE, DRAW OR FORFEIT)
					ai = response.ai;
					showGameOver(response);
					return;
				}

				// NOTE : CONDITONALIZE BACK END TO SUPPORT DETIRMINING AI COLOR OR REAL OPPONENT COLOR
				// THEN : CONDITIONALIZE BOARD ACCORDINGLY

				if (chessInst.turn() == playerColor) { opposingMove = false; } else { opposingMove = true; } // LOCK THE BOARD ON THE OPPONENT'S TURN
				if (response.ai) {
					ai = true;
					if (opponentColor == chessInst.turn()) { //PLAY AI MOVE
						moveObj = await playAi(GAME_URL, GAME_ID); // THE SERVER PICKS & SAVES THE AI MOVE (renderLoop ASKS AGAIN, GETS THE SAME MOVE & SLIDES IT IN)
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
		 * @description Sets drawScreen & gamedata based on player color. Each frame drawScreen() draws the table & board,
		 * the pieces, the taken piece trays (the promotion picker while promoting), then a light table shadow over everything.
		 * Black's board is flipped (rows & columns reversed) so the player is always at the bottom
		 */
		function handleInitialData() {
			if (playerColor == "w") { // DRAW SCREEN W
				currInst = chessInst.board(); // ROW 0 IS RANK 8, COLUMN 0 IS THE a FILE
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
					} else { // TAKEN PIECES SIT ON THE SIDE OF THE PLAYER WHO TOOK THEM
						wTakenPieces = setTakenPieceArr(playerColor);
						bTakenPieces = setTakenPieceArr(opponentColor);
						renderTakenPieces(wTakenPieces, opponentColor);
						renderTakenPieces(bTakenPieces, playerColor)
					}

					ctx.globalAlpha = 0.05
					ctx.drawImage(images[tableShdw].image, 0, 0, cw, ch); // RENDER TABLE SHDW
					ctx.globalAlpha = 1;
				}
			} else if (playerColor == "b") { // DRAW SCREEN B
				currInst = chessInst.board().reverse(); // ROW 0 IS RANK 1
				for (let i = currInst.length - 1; i >= 0; i--) { currInst[i] = currInst[i].reverse(); } // COLUMN 0 IS THE h FILE
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
					} else { // TAKEN PIECES SIT ON THE SIDE OF THE PLAYER WHO TOOK THEM
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
		 * @description Initializes draw data which sets positions onto the board. Sizes the canvas to the window, picks the
		 * board size for the screen shape (large, medium, small or portrait), sizes the menu, draws the table shadow & board,
		 * then works out the squares (bw, bh, xBoardOff, yBoardOff, tileWidth, tileHeight). Resets the piece counts for the frame
		 * @return {[object]} { clickX, clickY } [pixel position of the square under the mouse, from the board's top left]
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
			let boardPadding = 1.4; // SCREEN SIZE / BOARD SIZE, BIGGER = SMALLER BOARD
			boardWidth = cw / boardPadding;
			boardHeight = (9 * (cw / boardPadding)) / 11; // THE BOARD IMAGE IS 11:9 (WIDE)
			// SET MENU ELEMENT SIZING

			const resultDisplay = document.getElementById("resultDisplay");
			const menuBox = document.getElementById("menuBox");
			const menuButtons = document.getElementsByClassName("menuButton");

			if ((ch / cw) > .225) { // NOT A VERY SHORT, WIDE WINDOW
				let menuSize = ((ch) * .90); // MENU IS 16:9, SIZED FROM THE SCREEN HEIGHT
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
				if (cw > ch * (boardPadding - 0.2)) { // LANDSCAPE: THE HEIGHT SIZES THE BOARD
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
				} else { // NARROW: THE WIDTH SIZES THE BOARD, TAKEN PIECES GO ABOVE & BELOW IT
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

			xPieceOffset = bw / 5.75; // PIECE IMAGES ARE A SQUARE PLUS THIS, CENTERED ON THE SQUARE
			yPieceOffset = bh / 4.25;

			let clickX = tileX * tileWidth; // SQUARE UNDER THE MOUSE IN PIXELS
			let clickY = tileY * tileHeight;
			wPieceCount = { king: 0, queen: 0, bishop: 0, knight: 0, rook: 0, pawn: 0 }; // OBJECT STORE OF THE PIECES ON THE BOARD FOR WHITE, COUNTED AS THEY'RE DRAWN (TAKEN = START COUNT - THIS)
			bPieceCount = { king: 0, queen: 0, bishop: 0, knight: 0, rook: 0, pawn: 0 }; // OBJECT STORE OF THE PIECES ON THE BOARD FOR BLACK

			if (widthOverHeight) {
				/* Board Extras */
				// !NOTE: THE PROP SIZES & POSITIONS ARE COMMENTED OUT, SO THE COFFEE, CARDS & CANDLE DRAW AT 0 x 0 (HIDDEN)
				// coffeeObj.height = tileHeight * 3.5;
				// coffeeObj.width = (9 * coffeeObj.height) / 10;
				// coffeeObj.x = ((cw - xBoardStart) + coffeeObj.width / 8);
				// coffeeObj.y = ((ch - yBoardStart) - (tileHeight * 3) - coffeeObj.height);

				// deckObj.height = tileHeight * 2.5;
				// deckObj.width = (9 * deckObj.height) / 10;
				// deckObj.x = (xBoardStart - (deckObj.width + tileWidth));
				// deckObj.y = ((ch - yBoardStart) - (tileHeight * 3) - deckObj.height);

				// candleObj.width = tileWidth * 2.5;
				// candleObj.height = (9 * candleObj.width) / 10;
				// candleObj.x = (xBoardStart - (candleObj.width + (tileWidth * .75)));
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

			if (renderCoffeeImg) { // TABLE PROPS ON WIDE SCREENS
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
		 * @description Renders game data based on input params. Goes through the board one square at a time (row by row,
		 * index = row * 8 + column) & draws its piece: a held piece follows the mouse, a clicked piece sits lifted where it was
		 * dropped, the rest sit on their square. Also draws the selected piece's legal moves, slides a moving piece toward its
		 * new square & draws the pieces it passes behind again on top (drawSlideBox)
		 * @param  {[number]} clickX [pixel x of the square under the mouse, from renderBoard()]
		 * @param  {[number]} clickY [pixel y of the square under the mouse]
		 * @param  {[boolean]} lightObstruction [true draws the reflections & shadows]
		 */
		function renderPiecesToBoard(inst, clickX, clickY, lightObstruction) {
			let x, y; // WHERE THIS SQUARE'S PIECE IS DRAWN (PIXELS)
			let index = 0; // TILE BEING DRAWN, COUNTS UP WITH THE LOOP (THE FUNCTIONS BELOW READ IT)

			/* ################################################################ */
			// TV REMOTE SELECT BOX (TURNED OFF)
			// if (!remoteNavBox.menuHover && !menuToggled && TV_BOOL || OVERRIDE_TV) {  ctx.drawImage(images[checkHighlight].image, remoteNavBox.x * tileWidth + xBoardOff, (remoteNavBox.y * tileHeight - tileHeight / 10 + yBoardOff), tileWidth, tileHeight);  }
			/* ################################################################ */

			for (let i = 0; i < inst.length; i++) { // ROW
				for (let j = 0; j < inst[i].length; j++, index++) { // COLUMN
					tiles[index] = { ...inst[i][j], ...tiles[index], x: j, y: i }; // TILE[INDEX] = DECONSTRUCTED ARRAY OF CHESS BOARD ROW/COLUMN, TILE[INDEX] INIT VALUES, X, Y
					if (inst[i][j]) { // IF CURRENT INDEX OF A TILE EXISTS
						if (tiles[index].isMousedown) { // IF MOUSEDOWN SET PIECE TO MOUSE POSITION
							if (mouseDownCount > 3) { tiles[index].isClicked = true; } else { mouseDownCount += 1; } // HELD FOR MORE THAN 3 FRAMES = A DRAG, THE CLICK HANDLER DROPS IT
							tiles[index].x = tileX;
							tiles[index].y = tileY;
							x = clickX + xBoardOff;
							y = clickY - tileHeight / 5 + yBoardOff; // LIFTED (A FIFTH OF A SQUARE UP)
						} else if (tiles[index].isClicked) { // IF CLICKED
							x = tiles[index].x * tileWidth + xBoardOff;
							y = tiles[index].y * tileHeight - tileHeight / 5 + yBoardOff; // LIFTED
						} else { // IF CLICKED IS FALSE SET PIECE BASED ON POSITION DEFINED BY FEN
							x = tiles[index].x * tileWidth + xBoardOff;
							y = tiles[index].y * tileHeight - tileHeight / 10 + yBoardOff; // RESTING PIECES SIT A TENTH OF A SQUARE UP SO THEIR BASE IS ON THE SQUARE
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
									} else if (pieceType.match(/[r]/) && pieceColor) { // CHECKS CURRENT INDEX FOR ROOK
										if (pieceColor == "w") { drawActivePiece([wRookRefl, wRookShdw, wRookImg], x, y, false); wPieceCount.rook++; }
										else if (pieceColor == "b") { drawActivePiece([bRookRefl, bRookShdw, bRookImg], x, y, false); bPieceCount.rook++; }
									}
								}
								// THE WAY IT FACES NOW, SAME AS THE BOARD (w_piece / b_piece)
								if (pieceColor == "w") {
									let yFrom; // SCREEN ROW IT CAME FROM
									let yTo; // SCREEN ROW IT WENT TO
									for (let n = 0; n < JSON.parse(response.w_piece).length; n++) {
										if (JSON.parse(response.w_piece)[n].from && JSON.parse(response.w_piece)[n].to == tile.square) { // THIS PIECE HAS MOVED UP OR DOWN: FACE THE WAY ITS LAST ONE WENT
											if (playerColor == 'w') {
												yFrom = 8 - JSON.parse(response.w_piece)[n].from.split("")[1];
												yTo = 8 - JSON.parse(response.w_piece)[n].to.split("")[1];
											} else if (playerColor == 'b') { // FLIPPED BOARD: RANK 1 IS THE TOP ROW
												yFrom = JSON.parse(response.w_piece)[n].from.split("")[1] - 1;
												yTo = JSON.parse(response.w_piece)[n].to.split("")[1] - 1;
											}
											handlePieceDirectionW(yFrom, yTo);
											drawPiece();
											break;
										} else if (JSON.parse(response.w_piece)[n].from == null && JSON.parse(response.w_piece)[n].to == tile.square) { // HASN'T MOVED UP OR DOWN: FACES BLACK'S SIDE
											handlePieceDirectionW(null, null);
											drawPiece();
											break;
										}
									}
								} else if (pieceColor == "b") {
									let yFrom; // SCREEN ROW IT CAME FROM
									let yTo; // SCREEN ROW IT WENT TO
									for (let n = 0; n < JSON.parse(response.b_piece).length; n++) {
										if (JSON.parse(response.b_piece)[n].from && JSON.parse(response.b_piece)[n].to == tile.square) { // THIS PIECE HAS MOVED UP OR DOWN: FACE THE WAY ITS LAST ONE WENT
											if (playerColor == 'w') {
												yFrom = 8 - JSON.parse(response.b_piece)[n].from.split("")[1];
												yTo = 8 - JSON.parse(response.b_piece)[n].to.split("")[1];
											} else if (playerColor == 'b') { // FLIPPED BOARD: RANK 1 IS THE TOP ROW
												yFrom = JSON.parse(response.b_piece)[n].from.split("")[1] - 1;
												yTo = JSON.parse(response.b_piece)[n].to.split("")[1] - 1;
											}
											handlePieceDirectionB(yFrom, yTo);
											drawPiece();
											break;
										} else if (JSON.parse(response.b_piece)[n].from == null && JSON.parse(response.b_piece)[n].to == tile.square) { // HASN'T MOVED UP OR DOWN: FACES WHITE'S SIDE
											handlePieceDirectionB(null, null);
											drawPiece();
											break;
										}
									}
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
							} else if (pieceType.match(/[p]/) && pieceColor) { // CHECKS CURRENT INDEX FOR PAWN
								if (pieceColor == "w") { drawActivePiece([wPawnRefl, wPawnShdw, wPawnImg], x, y, false); wPieceCount.pawn++; }
								else if (pieceColor == "b") { drawActivePiece([bPawnRefl, bPawnShdw, bPawnImg], x, y, false); bPieceCount.pawn++; }
							}
						}

						if ((clickedTile || mousedownTile) && !currSlide) { // MOVES FOR PIECE TOGGLED BY USER
							let xLet;
							let piecePos; // THIS SQUARE'S NAME (e4)
							if (playerColor == 'w') {
								xLet = String.fromCharCode(97 + j);
								piecePos = `${xLet}${8 - i}`
							} else if (playerColor == 'b') { // FLIPPED BOARD
								xLet = String.fromCharCode(96 + (8 - j));
								piecePos = `${xLet}${i + 1}`
							}
							let tile; // THE SELECTED PIECE, A HELD PIECE COMES FIRST
							if (mousedownTile) { tile = mousedownTile }
							else if (clickedTile) { tile = clickedTile }

							if (availableMovesData.piece == tile.type && availableMovesData.square == tile.square) { } // SAME PIECE AS BEFORE, KEEP ITS MOVES
							else {
								availableMovesData = { piece: tile.type, square: tile.square }
								availableMoves = chessInst.moves({ piece: tile.type, square: tile.square, verbose: true });
							}
							for (let r = 0; r < availableMoves.length; r++) { // RENDER ALL POSSIBLE MOVES
								if (availableMoves[r].to == piecePos) { // THIS SQUARE IS A LEGAL MOVE
									let xAvailInt; // SCREEN COLUMN & ROW OF THE MOVE
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
									for (let a = 0; a < availableMoves.length; a++) { // CLEARS THE HELD PIECE'S PREVIEW SQUARE WHEN THE MOUSE ISN'T ON ANY LEGAL MOVE
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
										if (tileX == xAvailInt && tileY == yAvailInt && mousedownTile) { // THE HELD PIECE IS OVER THIS MOVE: DRAW IT HERE (PREVIEW)
											tile.xAvailInt = xAvailInt;
											tile.yAvailInt = yAvailInt;
											const pieceType = tile.type
											const pieceColor = tile.color;
											let x = xAvailInt * tileWidth + xBoardOff;
											let y = yAvailInt * tileHeight - tileHeight / 6 + yBoardOff;
											drawTiles(tile, pieceType, pieceColor, x, y);
										}
									} else { // RENDERS TILE WHICH CAN BE MOVED TO
										ctx.globalAlpha = 0.50;
										ctx.drawImage(images[moveHighlight].image, availX, availY, tileWidth, tileHeight);
										ctx.globalAlpha = 1.00;
										if (tileX == xAvailInt && tileY == yAvailInt && mousedownTile) { // THE HELD PIECE IS OVER THIS MOVE: DRAW IT HERE (PREVIEW)
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

					if (!currPromotion && !opposingMove) { checkAvailableMoves() } // ONLY ON THE PLAYER'S TURN


					// /* ---------------------------------------------------------------- */
					// // Draw image
					// /* ---------------------------------------------------------------- */
					// /**
					//  * @description Draws active piece to canvas
					//  */
					/**
					 * @description Draws active piece to canvas: the reflection (30%), shadow (75%) & piece, in that order. Held, clicked
					 * & hovered pieces are a little see through. A sliding piece moves a step toward its new square each frame & when it
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
							if ((tiles[index].isMousedown || tiles[index].isClicked || tiles[index].isHovering) && opacity && !tiles[index].isSliding) { ctx.globalAlpha = 0.85 }
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
									if (tiles[index].type == 'r') { // ROOKS SKIP THE OVERLAP REDRAW
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

								let xChange = (tileWidth / frameRate) * 3.48513659; // PIXELS MOVED PER FRAME, ABOUT 9 FRAMES PER SQUARE
								let yChange = (tileHeight / frameRate) * 3.48513659;

								let endTileX; // SQUARES TO GO ACROSS
								let endTileY; // SQUARES TO GO UP OR DOWN
								let xBool = false; // ARRIVED ACROSS
								let yBool = false; // ARRIVED UP OR DOWN
								// THE SLIDE MOVES ON THE REFLECTION LAYER (w == 0), THE SHADOW & PIECE ARE DRAWN AT THE SAME SPOT
								// X

								if (tiles[index].xSlideTo > tiles[index].x && w == 0) { // X: Greater
									endTileX = tiles[index].xSlideTo - tiles[index].x;
									if (Math.floor((tiles[index].x * tileWidth) + tiles[index].xDiff) == Math.floor((tiles[index].x * tileWidth) + (tileWidth * endTileX))) { // ARRIVED
										xBool = true
									} else if (((tiles[index].x * tileWidth) + (tiles[index].xDiff + xChange)) >= ((tiles[index].x * tileWidth) + (tileWidth * endTileX))) { // NEXT STEP GOES PAST: SNAP TO THE SQUARE
										const remainder = (tiles[index].x * tileWidth) + tiles[index].xDiff - ((tiles[index].x * tileWidth) + (tileWidth * endTileX));
										tiles[index].xDiff = tiles[index].xDiff - remainder;
									} else {
										// KNIGHTS MOVE TWICE AS FAST ALONG THEIR LONG SIDE SO BOTH SIDES FINISH TOGETHER
										// !NOTE: endTileY IS SET BELOW (Y), SO HERE IT'S STILL UNDEFINED & ONLY THE Y SIDE EVER DOUBLES
										if (tiles[index].type.match(/[n]/) && (endTileX > endTileY)) {
											tiles[index].xDiff = tiles[index].xDiff + (xChange * 2);
										} // KNIGHT SLIDE
										else { tiles[index].xDiff = tiles[index].xDiff + xChange }
									}
								} else if (tiles[index].xSlideTo < tiles[index].x && w == 0) { // X: Less
									endTileX = tiles[index].x - tiles[index].xSlideTo;
									if (Math.floor((tiles[index].x * tileWidth) + tiles[index].xDiff) == Math.floor((tiles[index].x * tileWidth) - (tileWidth * endTileX))) { // ARRIVED
										xBool = true
									} else if (((tiles[index].x * tileWidth) + (tiles[index].xDiff - xChange)) <= ((tiles[index].x * tileWidth) - (tileWidth * endTileX))) { // NEXT STEP GOES PAST: SNAP TO THE SQUARE
										const remainder = (((tiles[index].x * tileWidth) + tiles[index].xDiff) - ((tiles[index].x * tileWidth) - (tileWidth * endTileX)));
										tiles[index].xDiff = tiles[index].xDiff - remainder;
									} else {
										if (tiles[index].type.match(/[n]/) && (endTileX > endTileY)) {
											tiles[index].xDiff = tiles[index].xDiff - (xChange * 2);
										} // KNIGHT SLIDE
										else { tiles[index].xDiff = tiles[index].xDiff - xChange; }
									}
								} else if (w == 0) { xBool = true } // X: Zero
								// Y (yDiff IS SUBTRACTED, SO GOING DOWN THE SCREEN MAKES IT NEGATIVE)
								if (tiles[index].ySlideTo > tiles[index].y && w == 0) { // Y: Greater
									endTileY = tiles[index].ySlideTo - tiles[index].y;
									if (Math.floor((tiles[index].y * tileHeight) - tiles[index].yDiff) == Math.floor((tiles[index].y * tileHeight) + (tileHeight * endTileY))) { // ARRIVED
										yBool = true;
									} else if (((tiles[index].y * tileHeight) - (tiles[index].yDiff - yChange)) >= ((tiles[index].y * tileHeight) + (tileHeight * endTileY))) { // NEXT STEP GOES PAST: SNAP TO THE SQUARE
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
									if (Math.floor((tiles[index].y * tileHeight) - tiles[index].yDiff) == Math.floor((tiles[index].y * tileHeight) - (tileHeight * endTileY))) { // ARRIVED
										yBool = true
									} else if (((tiles[index].y * tileHeight) - (tiles[index].yDiff + yChange)) <= ((tiles[index].y * tileHeight) - (tileHeight * endTileY))) { // NEXT STEP GOES PAST: SNAP TO THE SQUARE
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
									// overlapSlideObj = THE NAMES OF THE 3 x 3 SQUARES AROUND slidePos (y2x2 IS THE SLIDING PIECE'S OWN SQUARE),
									// drawSlideBox() REDRAWS THE PIECES ON THEM THAT SHOULD BE IN FRONT OF THE SLIDING PIECE
									if (slideOverlap && slidePos) {
										let xPos; // FILE NUMBER OF slidePos (a = 0)
										let yPos; // RANK OF slidePos
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

										else if (playerColor == 'b') { // FLIPPED BOARD: TURN slidePos (WHITE'S LETTERS) INTO BLACK'S SQUARE NAMES
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

									if (xBool && yBool) { completeSlide = true; } // ARRIVED BOTH WAYS

									if (tiles[index].type.match(/[n]/)) { // KNIGHT SLIDE
										if ((w == 0 || w == 1) && lightObstruction) { // REFLECTION & SHADOW STAY ON THE BOARD, SHIFTED A FIFTH OF A SQUARE LEFT
											ctx.drawImage(images[imgArr[w]].image, ((((tiles[index].x * tileWidth) + tiles[index].xDiff) + xBoardOff) - xPieceOffset / 2) - tileWidth / 5, (((((tiles[index].y * tileHeight) - tiles[index].yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2), tileWidth + xPieceOffset, tileHeight + yPieceOffset)
										} // DRAW SHADOW OF KNIGHT
										else if (w == 2) { // DRAW PIECE, HALF A SQUARE UP WHILE IT HOPS
											if (slideStart == true) { // FIRST FRAME: LIFT THE KNIGHT & PAUSE 100MS
												ctx.drawImage(images[imgArr[w]].image, (((tiles[index].x * tileWidth) + tiles[index].xDiff) + xBoardOff) - xPieceOffset / 2, (((((tiles[index].y * tileHeight) - tiles[index].yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2) - tileHeight / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset); // DRAW KNIGHT AS WITH STOP
												currSlide = false; // SO THE TIMEOUT STOPS THE ANIMATION
												slideStart = false;
												setTimeout(function () { currSlide = true; }, 100) // SO THE TIMEOUT RESTARTS THE ANIMATION
												slideStart = false;
											} else {
												if (completeSlide) { // LANDED: DRAW IT ON THE SQUARE & FINISH THE MOVE
													tiles[index].isSliding = null;
													ctx.drawImage(images[imgArr[w]].image, (((tiles[index].x * tileWidth) + tiles[index].xDiff) + xBoardOff) - xPieceOffset / 2, (((((tiles[index].y * tileHeight) - tiles[index].yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2), tileWidth + xPieceOffset, tileHeight + yPieceOffset)
													if (tiles[index].color == playerColor) {
														await updateUserStateSlide(index); // SENDS THE PLAYER'S MOVE
													}
													else if (tiles[index].color == opponentColor) {
														await updateOpponentStateSlide(index); // FINISHES THE OPPONENT'S MOVE
													}
												} else { // IN THE AIR
													ctx.drawImage(images[imgArr[w]].image, (((tiles[index].x * tileWidth) + tiles[index].xDiff) + xBoardOff) - xPieceOffset / 2, (((((tiles[index].y * tileHeight) - tiles[index].yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2) - tileHeight / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset);
												}
											} // DRAW KNIGHT AS USUAL
										}
									} else {
										if ((w == 0 || w == 1) && lightObstruction) {
											ctx.drawImage(images[imgArr[w]].image, (((tiles[index].x * tileWidth) + tiles[index].xDiff) + xBoardOff) - xPieceOffset / 2, ((((tiles[index].y * tileHeight) - tiles[index].yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset)
										} else if (w == 2) {
											ctx.drawImage(images[imgArr[w]].image, (((tiles[index].x * tileWidth) + tiles[index].xDiff) + xBoardOff) - xPieceOffset / 2, ((((tiles[index].y * tileHeight) - tiles[index].yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset);
											if (completeSlide) { // ARRIVED: FINISH THE MOVE
												tiles[index].isSliding = null;
												if (tiles[index].color == playerColor) {
													setTimeout(function () { })
													await updateUserStateSlide(index); // SENDS THE PLAYER'S MOVE
												}
												else if (tiles[index].color == opponentColor) {
													await updateOpponentStateSlide(index); // FINISHES THE OPPONENT'S MOVE
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
							if (((tiles[index]?.isMousedown || null || tiles[index]?.isClicked || null || tiles[index]?.isHovering || null) && opacity && !tiles[index]?.isSliding || null) || w == 0 || w == 1) { ctx.globalAlpha = 1 } // BACK TO SOLID FOR THE NEXT LAYER
						}
					}

					if (inst[i][j]) { // IF CURRENT INDEX OF A TILE EXISTS
						tiles[index].originX = j; // THE PIECE'S OWN SQUARE (x, y FOLLOW THE MOUSE WHILE IT'S HELD)
						tiles[index].originY = i;
						const pieceType = inst[i][j].type;
						const pieceColor = inst[i][j].color;
						if (!currPromotion) { // NO PIECES ON THE BOARD WHILE THE PROMOTION PICKER IS UP
							if (!(mousedownTile.xAvailInt == tiles[index].x && mousedownTile.yAvailInt == tiles[index].y)) { // IF A MOUSE DOWN TILE IS ON AVAILABLE MOVE TILE RENDERING OF THE PIECE FALLS ON THE RESPONSIBILITY OF "checkAvailableMoves()"
								let opacity = true
								if (tiles[index].isClicked && (tiles[index].x == tiles[index].originX && tiles[index].y == tiles[index].originY)) { opacity = false } // IF TILE IS IN ORIGINAL POSITION SET OPACITY TO FALSE
								if (pieceType.match(/[kqbr]/) && pieceColor) { // CHECKS CURRENT INDEX FOR KING, QUEEN, BISHOP OR ROOK
									/* ---------------------------------------------------------------- */
									// Draw Piece (Draw Screen)
									/* ---------------------------------------------------------------- */
									/**
									 * @description Draws the king, queen, bishop or rook to the board with the images the loops below picked (handlePieceDirectionW / B).
									 * While the player holds their piece it faces the way it's dragged (up or down from its square)
									 */
									function drawPiece() {
										if (tiles[index].isMousedown && tiles[index].y != tiles[index].originY && playerColor == pieceColor) { // HELD: FACE THE WAY IT'S DRAGGED (UP OR DOWN)
											if (pieceColor == 'w') { handlePieceDirectionW(tiles[index].originY, tiles[index].y); }
											else if (pieceColor == 'b') { handlePieceDirectionB(tiles[index].originY, tiles[index].y); }
										}
										if (pieceType.match(/[k]/) && pieceColor) { // CHECKS CURRENT INDEX FOR KING
											if (pieceColor == "w") {
												if (chessInst.isCheck() && pieceColor == chessInst.turn()) { // CHECK HIGHLIGHT UNDER THE KING IN CHECK
													ctx.globalAlpha = 0.70;
													ctx.drawImage(images[checkHighlight].image, (tiles[index].x * tileWidth + xBoardOff) + ((tileWidth * 0.0243) / 2), (tiles[index].y * tileHeight - tileHeight / 10 + yBoardOff) + ((tileHeight * 0.1034) / 2), tileWidth, tileHeight);
													ctx.globalAlpha = 1.00;
												}
												drawActivePiece([wKingRefl, wKingShdw, wKingImg], x, y, opacity);
												wPieceCount.king++;
											}
											else if (pieceColor == "b") {
												if (chessInst.isCheck() && pieceColor == chessInst.turn()) { // CHECK HIGHLIGHT UNDER THE KING IN CHECK
													ctx.globalAlpha = 0.70;
													ctx.drawImage(images[checkHighlight].image, (tiles[index].x * tileWidth + xBoardOff) + ((tileWidth * 0.0243) / 2), (tiles[index].y * tileHeight - tileHeight / 10 + yBoardOff) + ((tileHeight * 0.1034) / 2), tileWidth, tileHeight);
													ctx.globalAlpha = 1.00;
												}
												drawActivePiece([bKingRefl, bKingShdw, bKingImg], x, y, opacity);
												bPieceCount.king++;
											}
										} else if (pieceType.match(/[q]/) && pieceColor) { // CHECKS CURRENT INDEX FOR QUEEN
											if (pieceColor == "w") { drawActivePiece([wQueenRefl, wQueenShdw, wQueenImg], x, y, opacity); wPieceCount.queen++; }
											else if (pieceColor == "b") { drawActivePiece([bQueenRefl, bQueenShdw, bQueenImg], x, y, opacity); bPieceCount.queen++; }
										} else if (pieceType.match(/[b]/) && pieceColor) { // CHECKS CURRENT INDEX FOR BISHOP
											if (pieceColor == "w") { // THE IMAGE GOES BY THE COLOR OF THE BISHOP'S SQUARE
												if (chessInst.squareColor(tiles[index].square) == 'light') { drawActivePiece([wBishopRefl, wBishopShdw, wBishopWhiteSqImg], x, y, opacity); wPieceCount.bishop++; }
												else if (chessInst.squareColor(tiles[index].square) == 'dark') { drawActivePiece([wBishopRefl, wBishopShdw, wBishopBlackSqImg], x, y, opacity); wPieceCount.bishop++; }
											} else if (pieceColor == "b") {
												if (chessInst.squareColor(tiles[index].square) == 'light') { drawActivePiece([bBishopRefl, bBishopShdw, bBishopWhiteSqImg], x, y, opacity); bPieceCount.bishop++; }
												else if (chessInst.squareColor(tiles[index].square) == 'dark') { drawActivePiece([bBishopRefl, bBishopShdw, bBishopBlackSqImg], x, y, opacity); bPieceCount.bishop++; }
											}
										} else if (pieceType.match(/[r]/) && pieceColor) { // CHECKS CURRENT INDEX FOR ROOK
											if (pieceColor == "w") { drawActivePiece([wRookRefl, wRookShdw, wRookImg], x, y, opacity); wPieceCount.rook++; }
											else if (pieceColor == "b") { drawActivePiece([bRookRefl, bRookShdw, bRookImg], x, y, opacity); bPieceCount.rook++; }
										}
									}
									// WHICH WAY A KING, QUEEN, BISHOP OR ROOK FACES COMES FROM THE SERVER'S PIECE LIST (w_piece / b_piece):
									// { from, to } OF EACH ONE'S LAST MOVE UP OR DOWN (A SIDEWAYS MOVE ONLY CHANGES to), from IS null BEFORE IT HAS ONE
									// & BOTH ARE null ONCE IT'S TAKEN
									if (pieceColor == "w") {
										let yFrom; // SCREEN ROW IT CAME FROM
										let yTo; // SCREEN ROW IT WENT TO
										for (let n = 0; n < JSON.parse(response.w_piece).length; n++) {
											if (tiles[index].isSliding && moveObj.from.split("")[1] != moveObj.to.split("")[1]) { // SLIDING UP OR DOWN: FACE THE WAY THIS MOVE GOES (SIDEWAYS FACES ITS LAST WAY, BELOW)
												if (playerColor == 'w') {
													yFrom = 8 - moveObj.from.split("")[1];
													yTo = 8 - moveObj.to.split("")[1];
												} else if (playerColor == 'b') { // FLIPPED BOARD: RANK 1 IS THE TOP ROW
													yFrom = moveObj.from.split("")[1] - 1;
													yTo = moveObj.to.split("")[1] - 1;
												}
												handlePieceDirectionW(yFrom, yTo);
												drawPiece();
												break;
											} else if (JSON.parse(response.w_piece)[n].from && JSON.parse(response.w_piece)[n].to == tiles[index].square) { // THIS PIECE HAS MOVED UP OR DOWN: FACE THE WAY ITS LAST ONE WENT
												if (playerColor == 'w') {
													yFrom = 8 - JSON.parse(response.w_piece)[n].from.split("")[1];
													yTo = 8 - JSON.parse(response.w_piece)[n].to.split("")[1];
												} else if (playerColor == 'b') { // FLIPPED BOARD: RANK 1 IS THE TOP ROW
													yFrom = JSON.parse(response.w_piece)[n].from.split("")[1] - 1;
													yTo = JSON.parse(response.w_piece)[n].to.split("")[1] - 1;
												}
												handlePieceDirectionW(yFrom, yTo);
												drawPiece();
												break;
											} else if (JSON.parse(response.w_piece)[n].from == null && JSON.parse(response.w_piece)[n].to == tiles[index].square) { // HASN'T MOVED UP OR DOWN: FACES BLACK'S SIDE
												handlePieceDirectionW(null, null);
												drawPiece();
												break;
											}
										}
									} else if (pieceColor == "b") {
										let yFrom; // SCREEN ROW IT CAME FROM
										let yTo; // SCREEN ROW IT WENT TO
										for (let n = 0; n < JSON.parse(response.b_piece).length; n++) {
											if (tiles[index].isSliding && moveObj.from.split("")[1] != moveObj.to.split("")[1]) { // SLIDING UP OR DOWN: FACE THE WAY THIS MOVE GOES (SIDEWAYS FACES ITS LAST WAY, BELOW)
												if (playerColor == 'w') {
													yFrom = 8 - moveObj.from.split("")[1];
													yTo = 8 - moveObj.to.split("")[1];
												} else if (playerColor == 'b') { // FLIPPED BOARD: RANK 1 IS THE TOP ROW
													yFrom = moveObj.from.split("")[1] - 1;
													yTo = moveObj.to.split("")[1] - 1;
												}
												handlePieceDirectionB(yFrom, yTo);
												drawPiece();
												break;
											} else if (JSON.parse(response.b_piece)[n].from && JSON.parse(response.b_piece)[n].to == tiles[index].square) { // THIS PIECE HAS MOVED UP OR DOWN: FACE THE WAY ITS LAST ONE WENT
												if (playerColor == 'w') {
													yFrom = 8 - JSON.parse(response.b_piece)[n].from.split("")[1];
													yTo = 8 - JSON.parse(response.b_piece)[n].to.split("")[1];
												} else if (playerColor == 'b') { // FLIPPED BOARD: RANK 1 IS THE TOP ROW
													yFrom = JSON.parse(response.b_piece)[n].from.split("")[1] - 1;
													yTo = JSON.parse(response.b_piece)[n].to.split("")[1] - 1;
												}
												handlePieceDirectionB(yFrom, yTo);
												drawPiece();
												break;
											} else if (JSON.parse(response.b_piece)[n].from == null && JSON.parse(response.b_piece)[n].to == tiles[index].square) { // HASN'T MOVED UP OR DOWN: FACES WHITE'S SIDE
												handlePieceDirectionB(null, null);
												drawPiece();
												break;
											}
										}
									}
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
											if (tiles[index].isMousedown) { // HELD: FACE THE WAY IT'S DRAGGED
												if (tiles[index].x < tiles[index].originX && playerColor == pieceColor) { wKnightImg = wLeftKnightImg; wKnightShdw = wLeftKnightShdw; wKnightRefl = wLeftKnightRefl; drawActivePiece([wKnightRefl, wKnightShdw, wKnightImg], x, y, opacity); }
												else if (tiles[index].x > tiles[index].originX && playerColor == pieceColor) { wKnightImg = wRightKnightImg; wKnightShdw = wRightKnightShdw; wKnightRefl = wRightKnightRefl; drawActivePiece([wKnightRefl, wKnightShdw, wKnightImg], x, y, opacity); }
												else { drawActivePiece([wKnightRefl, wKnightShdw, wKnightImg], x, y, opacity); }
											} else { drawActivePiece([wKnightRefl, wKnightShdw, wKnightImg], x, y, opacity); }
										} else if (pieceColor == 'b') {
											if (tiles[index].isMousedown) {
												if (tiles[index].x < tiles[index].originX && playerColor == pieceColor) { bKnightImg = bLeftKnightImg; bKnightShdw = bLeftKnightShdw; bKnightRefl = bLeftKnightRefl; drawActivePiece([bKnightRefl, bKnightShdw, bKnightImg], x, y, opacity); }
												else if (tiles[index].x > tiles[index].originX && playerColor == pieceColor) { bKnightImg = bRightKnightImg; bKnightShdw = bRightKnightShdw; bKnightRefl = bRightKnightRefl; drawActivePiece([bKnightRefl, bKnightShdw, bKnightImg], x, y, opacity); }
												else { drawActivePiece([bKnightRefl, bKnightShdw, bKnightImg], x, y, opacity); }
											} else { drawActivePiece([bKnightRefl, bKnightShdw, bKnightImg], x, y, opacity); }
										}
									}
									// WHICH WAY A KNIGHT FACES COMES FROM THE SERVER'S KNIGHT LIST (w_knight / b_knight):
									// { from, to } OF EACH KNIGHT'S LAST MOVE, from IS null BEFORE IT MOVES & BOTH ARE null ONCE IT'S TAKEN
									if (pieceColor == "w") {
										let xFrom; // FILE IT CAME FROM (a = 0)
										let xTo; // FILE IT WENT TO
										for (let n = 0; n < JSON.parse(response.w_knight).length; n++) {
											if (tiles[index].isSliding) { // SLIDING: FACE THE WAY THIS MOVE GOES
												if (playerColor == 'w') {
													xFrom = moveObj.from.split("")[0].charCodeAt(0) - 96 - 1;
													xTo = moveObj.to.split("")[0].charCodeAt(0) - 96 - 1;
												} else if (playerColor == 'b') { // SAME AS WHITE, handleKnightDirectionW FLIPS ITS TEST FOR BLACK
													xFrom = moveObj.from.split("")[0].charCodeAt(0) - 96 - 1;
													xTo = moveObj.to.split("")[0].charCodeAt(0) - 96 - 1;
												}
												handleKnightDirectionW(xFrom, xTo);
												drawActivePiece([wKnightRefl, wKnightShdw, wKnightImg], x, y, opacity);
												break;
											} else if (JSON.parse(response.w_knight)[n].from && (JSON.parse(response.w_knight)[n].to == tiles[index].square)) { // THIS KNIGHT HAS MOVED: FACE THE WAY ITS LAST MOVE WENT
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
											} else if (JSON.parse(response.w_knight)[n].from == null && JSON.parse(response.w_knight)[n].to) { // HASN'T MOVED: b1 FACES RIGHT & g1 LEFT (TOWARD THE MIDDLE), FLIPPED WHEN PLAYING BLACK
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
										let xFrom; // SCREEN COLUMN IT CAME FROM
										let xTo; // SCREEN COLUMN IT WENT TO
										for (let n = 0; n < JSON.parse(response.b_knight).length; n++) {
											if (tiles[index].isSliding) { // SLIDING: FACE THE WAY THIS MOVE GOES
												if (playerColor == 'w') {
													xFrom = moveObj.from.split("")[0].charCodeAt(0) - 96 - 1;
													xTo = moveObj.to.split("")[0].charCodeAt(0) - 96 - 1;
												} else if (playerColor == 'b') { // FLIPPED COLUMNS, SO handleKnightDirectionB USES ONE TEST FOR BOTH
													xFrom = 8 - (moveObj.from.split("")[0].charCodeAt(0) - 96);
													xTo = 8 - (moveObj.to.split("")[0].charCodeAt(0) - 96);
												}
												handleKnightDirectionB(xFrom, xTo);
												drawActivePiece([bKnightRefl, bKnightShdw, bKnightImg], x, y, opacity);
												break;
											} else if (JSON.parse(response.b_knight)[n].from && JSON.parse(response.b_knight)[n].to == tiles[index].square) { // THIS KNIGHT HAS MOVED: FACE THE WAY ITS LAST MOVE WENT
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
											} else if (JSON.parse(response.b_knight)[n].from == null && JSON.parse(response.b_knight)[n].to) { // HASN'T MOVED: b8 FACES RIGHT & g8 LEFT FROM WHITE'S SIDE, FLIPPED WHEN PLAYING BLACK
												if (playerColor == 'w') {
													if (JSON.parse(response.b_knight)[n].to == 'b8' && tiles[index].square == 'b8') { bKnightImg = bRightKnightImg; bKnightShdw = bRightKnightShdw; bKnightRefl = bRightKnightRefl; drawKnight(); break; }
													else if (JSON.parse(response.b_knight)[n].to == tiles[index].square) { bKnightImg = bLeftKnightImg; bKnightShdw = bLeftKnightShdw; bKnightRefl = bLeftKnightRefl; drawKnight(); break; }
												} else if (playerColor == 'b') {
													if (JSON.parse(response.b_knight)[n].to == 'b8' && tiles[index].square == 'b8') { bKnightImg = bLeftKnightImg; bKnightShdw = bLeftKnightShdw; bKnightRefl = bLeftKnightRefl; drawKnight(); break; }
													else if (JSON.parse(response.b_knight)[n].to == tiles[index].square) { bKnightImg = bRightKnightImg; bKnightShdw = bRightKnightShdw; bKnightRefl = bRightKnightRefl; drawKnight(); break; }
												}
											}
										}
										bPieceCount.knight++;
									}
								} else if (pieceType.match(/[p]/) && pieceColor) { // CHECKS CURRENT INDEX FOR PAWN
									if (pieceColor == "w") { drawActivePiece([wPawnRefl, wPawnShdw, wPawnImg], x, y, opacity); wPieceCount.pawn++; }
									else if (pieceColor == "b") { drawActivePiece([bPawnRefl, bPawnShdw, bPawnImg], x, y, opacity); bPieceCount.pawn++; }
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
			 * @description Handles pieceObj which draws piece over board render. Draws a piece's image again on top of the frame
			 * (no shadow or reflection), so a sliding piece looks like it passes behind the pieces in front of it.
			 * A sliding knight is drawn on top of everything (it hops over them)
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
						} else if (pieceType.match(/[r]/) && pieceColor) { // CHECKS CURRENT INDEX FOR ROOK
							if (pieceColor == "w") { ctx.drawImage(images[wRookImg].image, (((x * tileWidth) + pieceObj.xDiff) + xBoardOff) - xPieceOffset / 2, ((((y * tileHeight) - pieceObj.yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset) }
							else if (pieceColor == "b") { ctx.drawImage(images[bRookImg].image, (((x * tileWidth) + pieceObj.xDiff) + xBoardOff) - xPieceOffset / 2, ((((y * tileHeight) - pieceObj.yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset) }
						}
					}
					// SAME FACING RULES AS THE BOARD: THIS MOVE WHILE SLIDING UP OR DOWN, ELSE ITS LAST MOVE UP OR DOWN, ELSE ITS START SIDE
					// !NOTE: ON THE FRAME A SLIDE LANDS ITS ENTRY HAS ALREADY MOVED TO THE NEW SQUARE, SO NOTHING MATCHES & IT ISN'T DRAWN
					// A SECOND TIME (THE BOARD ALREADY DREW IT, SAME AS THE KNIGHT)
					if (pieceColor == "w") {
						let yFrom; // SCREEN ROW IT CAME FROM
						let yTo; // SCREEN ROW IT WENT TO
						for (let n = 0; n < JSON.parse(response.w_piece).length; n++) {
							if (pieceObj.isSliding && moveObj.from.split("")[1] != moveObj.to.split("")[1]) { // SLIDING UP OR DOWN: FACE THE WAY THIS MOVE GOES (SIDEWAYS FACES ITS LAST WAY, BELOW)
								if (playerColor == 'w') {
									yFrom = 8 - moveObj.from.split("")[1];
									yTo = 8 - moveObj.to.split("")[1];
								} else if (playerColor == 'b') { // FLIPPED BOARD: RANK 1 IS THE TOP ROW
									yFrom = moveObj.from.split("")[1] - 1;
									yTo = moveObj.to.split("")[1] - 1;
								}
								handlePieceDirectionW(yFrom, yTo);
								drawPiece();
								break;
							} else if (JSON.parse(response.w_piece)[n].from && JSON.parse(response.w_piece)[n].to == pieceObj.square) { // THIS PIECE HAS MOVED UP OR DOWN: FACE THE WAY ITS LAST ONE WENT
								if (playerColor == 'w') {
									yFrom = 8 - JSON.parse(response.w_piece)[n].from.split("")[1];
									yTo = 8 - JSON.parse(response.w_piece)[n].to.split("")[1];
								} else if (playerColor == 'b') { // FLIPPED BOARD: RANK 1 IS THE TOP ROW
									yFrom = JSON.parse(response.w_piece)[n].from.split("")[1] - 1;
									yTo = JSON.parse(response.w_piece)[n].to.split("")[1] - 1;
								}
								handlePieceDirectionW(yFrom, yTo);
								drawPiece();
								break;
							} else if (JSON.parse(response.w_piece)[n].from == null && JSON.parse(response.w_piece)[n].to == pieceObj.square) { // HASN'T MOVED UP OR DOWN: FACES BLACK'S SIDE
								handlePieceDirectionW(null, null);
								drawPiece();
								break;
							}
						}
					} else if (pieceColor == "b") {
						let yFrom; // SCREEN ROW IT CAME FROM
						let yTo; // SCREEN ROW IT WENT TO
						for (let n = 0; n < JSON.parse(response.b_piece).length; n++) {
							if (pieceObj.isSliding && moveObj.from.split("")[1] != moveObj.to.split("")[1]) { // SLIDING UP OR DOWN: FACE THE WAY THIS MOVE GOES (SIDEWAYS FACES ITS LAST WAY, BELOW)
								if (playerColor == 'w') {
									yFrom = 8 - moveObj.from.split("")[1];
									yTo = 8 - moveObj.to.split("")[1];
								} else if (playerColor == 'b') { // FLIPPED BOARD: RANK 1 IS THE TOP ROW
									yFrom = moveObj.from.split("")[1] - 1;
									yTo = moveObj.to.split("")[1] - 1;
								}
								handlePieceDirectionB(yFrom, yTo);
								drawPiece();
								break;
							} else if (JSON.parse(response.b_piece)[n].from && JSON.parse(response.b_piece)[n].to == pieceObj.square) { // THIS PIECE HAS MOVED UP OR DOWN: FACE THE WAY ITS LAST ONE WENT
								if (playerColor == 'w') {
									yFrom = 8 - JSON.parse(response.b_piece)[n].from.split("")[1];
									yTo = 8 - JSON.parse(response.b_piece)[n].to.split("")[1];
								} else if (playerColor == 'b') { // FLIPPED BOARD: RANK 1 IS THE TOP ROW
									yFrom = JSON.parse(response.b_piece)[n].from.split("")[1] - 1;
									yTo = JSON.parse(response.b_piece)[n].to.split("")[1] - 1;
								}
								handlePieceDirectionB(yFrom, yTo);
								drawPiece();
								break;
							} else if (JSON.parse(response.b_piece)[n].from == null && JSON.parse(response.b_piece)[n].to == pieceObj.square) { // HASN'T MOVED UP OR DOWN: FACES WHITE'S SIDE
								handlePieceDirectionB(null, null);
								drawPiece();
								break;
							}
						}
					}
				} else if (pieceType.match(/[n]/) && pieceColor) { // CHECKS CURRENT INDEX FOR KNIGHT
					/* ---------------------------------------------------------------- */
					// Draw Knight (Draw Slide Box)
					/* ---------------------------------------------------------------- */
					/**
					 * @description Draws the knight to the board (image only), half a square up while it's hopping.
					 * The loops below pick its facing the same way as Draw Knight (Draw Screen)
					 */
					function drawKnight() {
						if (pieceColor == 'w') {
							if (pieceObj.isSliding) { // HOPPING
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
					if (pieceColor == "w") { // SAME FACING RULES AS THE BOARD: THIS MOVE WHILE SLIDING, ELSE ITS LAST MOVE, ELSE ITS START SQUARE
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
								break;
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
								break;
							} else if (JSON.parse(response.b_knight)[n].from == null && JSON.parse(response.b_knight)[n].to) {
								if (playerColor == 'w') {
									if (JSON.parse(response.b_knight)[n].to == 'b8' && pieceObj.square == 'b8') { bKnightImg = bRightKnightImg; bKnightShdw = bRightKnightShdw; bKnightRefl = bRightKnightRefl; drawKnight(); break; }
									else if (JSON.parse(response.b_knight)[n].to == pieceObj.square) { bKnightImg = bLeftKnightImg; bKnightShdw = bLeftKnightShdw; bKnightRefl = bLeftKnightRefl; drawKnight(); break; }
								} else if (playerColor == 'b') {
									if (JSON.parse(response.b_knight)[n].to == 'b8' && pieceObj.square == 'b8') { bKnightImg = bLeftKnightImg; bKnightShdw = bLeftKnightShdw; bKnightRefl = bLeftKnightRefl; drawKnight(); break; }
									else if (JSON.parse(response.b_knight)[n].to == pieceObj.square) { bKnightImg = bRightKnightImg; bKnightShdw = bRightKnightShdw; bKnightRefl = bRightKnightRefl; drawKnight(); break; }
								}
							}
						}
					}
				} else if (pieceType.match(/[p]/) && pieceColor) { // CHECKS CURRENT INDEX FOR PAWN
					if (pieceColor == "w") { ctx.drawImage(images[wPawnImg].image, (((x * tileWidth) + pieceObj.xDiff) + xBoardOff) - xPieceOffset / 2, ((((y * tileHeight) - pieceObj.yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset) }
					else if (pieceColor == "b") { ctx.drawImage(images[bPawnImg].image, (((x * tileWidth) + pieceObj.xDiff) + xBoardOff) - xPieceOffset / 2, ((((y * tileHeight) - pieceObj.yDiff) - tileHeight / 10) + yBoardOff) - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset) }
				}
			}

			if (currSlide && overlapSlideObj) { // A SLIDE IS PASSING OTHER PIECES: DRAW THE ONES IN FRONT OF IT AGAIN
				for (let q = 0; q < tiles.length; q++) { // SWAP EACH SQUARE NAME FOR THE TILE ON IT (SQUARES WITH NO PIECE STAY A NAME)
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

				/**
				 * @description Draws the pieces below a square on screen again, one square at a time down the column
				 * (lower pieces are closer to the player, so they're in front)
				 * @param  {[string]} square [square name]
				 */
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
					if (overlapSlideObj.y2x2?.type == "n") { // A HOPPING KNIGHT GOES OVER EVERYTHING: DRAW IT AGAIN ON TOP
						drawSlideBox(overlapSlideObj.y2x2);
					} else { // DRAW THE PIECES BESIDE & BELOW THE SLIDE (IN FRONT OF IT) AGAIN, BY DIRECTION
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
					if (overlapSlideObj.y2x2?.type == "n") { // A HOPPING KNIGHT GOES OVER EVERYTHING: DRAW IT AGAIN ON TOP
						drawSlideBox(overlapSlideObj.y2x2);
					} else { // DRAW THE PIECES BESIDE & BELOW THE SLIDE (IN FRONT OF IT) AGAIN, BY DIRECTION
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
			if (!currSlide) { refresh = true; overlapSlideObj = null; } // NOTHING SLIDING, CLEAR THE OVERLAP
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
		function setTakenPieceArr(paramColor) { // DRAW ALL TAKEN PIECES
			let takenArr = new Array();
			let currPieces; // HOW MANY OF EACH ARE ON THE BOARD
			if (currPromotion) { currPieces = { king: 1, queen: 0, bishop: 1, knight: 1, rook: 1, pawn: 8 } } // SETS TAKEN PIECES ARRAY TO ONLY CONTAIN ONE OF EACH UNIQUE PIECE THAT ISN'T A KING
			else { if (paramColor == "w") { currPieces = wPieceCount } else if (paramColor == "b") { currPieces = bPieceCount } }

			/**
			 * @description Adds (maxCount - amountOnBoard) pieces of one type to takenArr
			 */
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
					if (((takenPiece.x === tileX && takenPiece.y === tileY && (takenPiece.color == playerColor || !takenPiece.color))) && currPromotion) { ctx.globalAlpha = 0.8; } // HOVERED PROMOTION CHOICE
					ctx.drawImage(images[imgArr[i]].image, xPos * tileWidth + xBoardOff - xPieceOffset / 2, yPos * tileHeight + yBoardOff - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset);
					if (((takenPiece.x === tileX && takenPiece.y === tileY && (takenPiece.color == playerColor || !takenPiece.color))) && currPromotion) { ctx.globalAlpha = 1; }
				}
			}

			if (widthGreater) { // WIDE SCREEN: TRAYS TO THE RIGHT OF THE BOARD (COLUMN 9), THE PLAYER'S AT THE BOTTOM (ROW 6), THE OPPONENT'S AT THE TOP (ROW -1)
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
						if (takenPieces[i].color == "w") { drawTakenPiece(takenPieces[i], [wPawnShdw, wPawnImg]); xPos += 1; if (xPos - 9 == 3) { yPos += 1; xPos = 9 } }
						else if (takenPieces[i].color == "b") { drawTakenPiece(takenPieces[i], [bPawnShdw, bPawnImg]); xPos += 1; if (xPos - 9 == 3) { yPos += 1; xPos = 9 } }
					}
				}
			} else { // NARROW SCREEN: ONE ROW BELOW THE BOARD (ROW 9) FOR THE PLAYER, ONE ABOVE (ROW -2) FOR THE OPPONENT
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
		 * @description Checks if opponent made a new move [No AI]. The socket calls this when the friend moved: it gets the game,
		 * works out their move from prev_move (a pawn that became another piece was a promotion) & starts its slide.
		 * The move is finished by updateOpponentStateSlide() when the slide lands
		 */
		async function checkOpponentMove() { // PROMOTIONS OF OPPOSING PLAYER THROWS INVALID MOVE
			try {
				refreshDataStartTime = Date.now();
				revert = response
				const updatedResponse = await validate(GAME_URL, GAME_ID, PLAYER_ID, false, false, false); // GET THE GAME
				if (updatedResponse.game_board != revert.game_board && opposingMove) { // THE BOARD CHANGED ON THE OPPONENT'S TURN
					if (chessInst.isGameOver()) { // THIS BOARD WAS ALREADY OVER
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

					if ((serverPiece.color == clientPiece.color) && (serverPiece.type != 'p' && clientPiece.type == 'p')) { // PROMOTION
						moveObj = { from: updatedResponse.prev_move[0], to: updatedResponse.prev_move[1], promotion: serverPiece.type }
					} else {
						moveObj = { from: updatedResponse.prev_move[0], to: updatedResponse.prev_move[1] }
					}

					validateState.move(moveObj); // CHECK IT ON THE SCRATCH BOARD (THROWS IF IT'S NOT LEGAL)
					for (let i = 0; i < tiles.length; i++) { // START THE SLIDE (SAME AS THE AI'S IN renderLoop)
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
		 * @description Updates data for user slide completion, starts ai slide if ai is active. A pawn reaching the last rank opens
		 * the promotion picker instead (the move is sent once a piece is picked in handleCanvasClick), any other move is sent now
		 * @param  {[number]} index [tile that slid]
		 */
		async function updateUserStateSlide(index) {
			try {
				tiles[index].xSlideTo = 0;
				tiles[index].ySlideTo = 0;
				if (moveObj.promotion) { currPromotion = true; refresh = true; return; } // OPEN THE PROMOTION PICKER
				await validateMove(); // SEND THE MOVE
				tiles[index].isSliding = null;
			} catch (err) { console.log(err); currSlide = false; return refreshData(response); }
		}

		/* ---------------------------------------------------------------- */
		// Validates User Move
		/* ---------------------------------------------------------------- */
		/**
		 * @description Validates user move post slide or drag/drop then starts ai slide. Plays the move sound, moves the piece on
		 * the local board, knight list & piece list, sends the move (PUT) & loads the server's board. AI games give the AI its turn
		 * half a second later, friend games wait for the socket. A move the server turns down goes back to revert
		 */
		async function validateMove() {
			try {
				endTime = new Date();
				timeElapsed = endTime - startTime;

				moveAudio.load();
				moveAudio.play().catch((err) => { console.log(err) });
				revert = { ...response }; // GO BACK TO THIS IF THE SERVER SAYS NO (A COPY, THE LISTS BELOW CHANGE response)
				opposingMove = true; // LOCK THE BOARD
				chessInst.move(moveObj); // LOCAL BOARD FIRST SO IT DRAWS RIGHT AWAY (THROWS IF IT'S NOT LEGAL)
				if (playerColor == 'w') { // KEEP THE LOCAL KNIGHT & PIECE LISTS IN STEP UNTIL THE SERVER'S COMES BACK
					for (let n = 0; n < JSON.parse(response.w_knight).length; n++) {
						if (moveObj.from == JSON.parse(response.w_knight)[n].to) {
							let w_knight = JSON.parse(response.w_knight)
							w_knight[n].from = moveObj.from;
							w_knight[n].to = moveObj.to;
							response.w_knight = JSON.stringify(w_knight);
							break;
						}
					}
					for (let n = 0; n < JSON.parse(response.w_piece).length; n++) { // SAME FOR THE KINGS, QUEENS, BISHOPS & ROOKS
						if (moveObj.from == JSON.parse(response.w_piece)[n].to) {
							let w_piece = JSON.parse(response.w_piece)
							if (moveObj.from.split("")[1] != moveObj.to.split("")[1]) { w_piece[n].from = moveObj.from; } // MOVED UP OR DOWN (SIDEWAYS KEEPS ITS from)
							w_piece[n].to = moveObj.to;
							response.w_piece = JSON.stringify(w_piece);
							break;
						}
					}
					// !NOTE: THE OLD ROOK SQUARE STAYS UNTIL THE SERVER'S LIST COMES BACK. THE MOVE LANDS HALFWAY THROUGH DRAWING A FRAME
					// & THE REST OF THAT FRAME STILL DRAWS THE OLD BOARD, SO THE ROOK WOULD DISAPPEAR FOR A FRAME IF ITS SQUARE WAS GONE
					if (chessInst.get(moveObj.to).type == 'k' && moveObj.from == 'e1' && (moveObj.to == 'g1' || moveObj.to == 'c1')) { // CASTLING: THE ROOK MOVES SIDEWAYS TOO, ITS NEW SQUARE IS ADDED
						for (let n = 0; n < JSON.parse(response.w_piece).length; n++) {
							let w_piece = JSON.parse(response.w_piece)
							if (moveObj.to == 'g1' && w_piece[n].to == 'h1') { w_piece[w_piece.length] = { from: w_piece[n].from, to: 'f1' }; response.w_piece = JSON.stringify(w_piece); break; } // KING SIDE
							else if (moveObj.to == 'c1' && w_piece[n].to == 'a1') { w_piece[w_piece.length] = { from: w_piece[n].from, to: 'd1' }; response.w_piece = JSON.stringify(w_piece); break; } // QUEEN SIDE
						}
					}
					if (moveObj.promotion && moveObj.promotion != 'n') { // PROMOTED TO A QUEEN, BISHOP OR ROOK: ADDED SO IT DRAWS BEFORE THE SERVER'S LIST COMES BACK
						let w_piece = JSON.parse(response.w_piece)
						w_piece[w_piece.length] = { from: moveObj.from, to: moveObj.to };
						response.w_piece = JSON.stringify(w_piece);
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
					for (let n = 0; n < JSON.parse(response.b_piece).length; n++) { // SAME FOR THE KINGS, QUEENS, BISHOPS & ROOKS
						if (moveObj.from == JSON.parse(response.b_piece)[n].to) {
							let b_piece = JSON.parse(response.b_piece)
							if (moveObj.from.split("")[1] != moveObj.to.split("")[1]) { b_piece[n].from = moveObj.from; } // MOVED UP OR DOWN (SIDEWAYS KEEPS ITS from)
							b_piece[n].to = moveObj.to;
							response.b_piece = JSON.stringify(b_piece);
							break;
						}
					}
					if (chessInst.get(moveObj.to).type == 'k' && moveObj.from == 'e8' && (moveObj.to == 'g8' || moveObj.to == 'c8')) { // CASTLING: THE ROOK MOVES SIDEWAYS TOO, ITS NEW SQUARE IS ADDED
						for (let n = 0; n < JSON.parse(response.b_piece).length; n++) {
							let b_piece = JSON.parse(response.b_piece)
							if (moveObj.to == 'g8' && b_piece[n].to == 'h8') { b_piece[b_piece.length] = { from: b_piece[n].from, to: 'f8' }; response.b_piece = JSON.stringify(b_piece); break; } // KING SIDE
							else if (moveObj.to == 'c8' && b_piece[n].to == 'a8') { b_piece[b_piece.length] = { from: b_piece[n].from, to: 'd8' }; response.b_piece = JSON.stringify(b_piece); break; } // QUEEN SIDE
						}
					}
					if (moveObj.promotion && moveObj.promotion != 'n') { // PROMOTED TO A QUEEN, BISHOP OR ROOK: ADDED SO IT DRAWS BEFORE THE SERVER'S LIST COMES BACK
						let b_piece = JSON.parse(response.b_piece)
						b_piece[b_piece.length] = { from: moveObj.from, to: moveObj.to };
						response.b_piece = JSON.stringify(b_piece);
					}
				}


				response = await validate(GAME_URL, GAME_ID, PLAYER_ID, [moveObj.from, moveObj.to], moveObj.promotion, false); // SEND THE MOVE (PUT), THE SERVER CHECKS & SAVES IT

				chessInst.load(response.game_board); // THE SERVER'S BOARD

				if (response.status == 200) {
					currSlide = false;
					if (response.state == "CLOSED") { showGameOver(response); return; } // CHECKMATE OR DRAW

					if (ai) {
						tiles = await setTiles();
						refresh = true;
						setTimeout(function () { aiTurn = true; refresh = true; }, 500); // THE AI MOVES HALF A SECOND LATER (renderLoop)
						return;
					}
					else { return refreshData(response); } // FRIEND GAME: THE SOCKET SAYS WHEN THEY MOVE

				} else { opposingMove = false; return refreshData(revert); } // TURNED DOWN: BACK TO THE OLD BOARD
			} catch (err) { console.log(err); opposingMove = false; mousedownTile = false; clickedTile = false; return refreshData(revert); }
		}

		/* ---------------------------------------------------------------- */
		// On Opponent Slide Complete
		/* ---------------------------------------------------------------- */
		/**
		 * @description Updates board data on slide completion for opposing player (AI or friend). Plays the move sound, moves the
		 * piece on the local board, knight list & piece list, then loads the saved game (the AI's came with its move, a friend game is fetched)
		 * & gives the turn back to the player
		 * !NOTE: KEEP THE AWAIT ON THE AI LINE, WITHOUT IT refreshData() RESETS THE TILES WHILE THE FRAME IS STILL DRAWING
		 * & A TAKEN PIECE CAN BE LEFT ON THE BOARD
		 * @param  {[number]} index [tile that slid]
		 */
		async function updateOpponentStateSlide(index) {
			try {
				endTime = new Date();
				timeElapsed = endTime - startTime;

				moveAudio.load();
				moveAudio.play().catch((err) => { console.log(err) });
				tiles[index].xSlideTo = 0;
				tiles[index].ySlideTo = 0;
				chessInst.move(moveObj); // LOCAL BOARD

				if (opponentColor == 'w') { // KEEP THE LOCAL KNIGHT & PIECE LISTS IN STEP
					for (let n = 0; n < JSON.parse(response.w_knight).length; n++) {
						if (moveObj.from == JSON.parse(response.w_knight)[n].to) {
							let w_knight = JSON.parse(response.w_knight)
							w_knight[n].from = moveObj.from;
							w_knight[n].to = moveObj.to;
							response.w_knight = JSON.stringify(w_knight);
						}
					}
					for (let n = 0; n < JSON.parse(response.w_piece).length; n++) { // SAME FOR THE KINGS, QUEENS, BISHOPS & ROOKS
						if (moveObj.from == JSON.parse(response.w_piece)[n].to) {
							let w_piece = JSON.parse(response.w_piece)
							if (moveObj.from.split("")[1] != moveObj.to.split("")[1]) { w_piece[n].from = moveObj.from; } // MOVED UP OR DOWN (SIDEWAYS KEEPS ITS from)
							w_piece[n].to = moveObj.to;
							response.w_piece = JSON.stringify(w_piece);
						}
					}
					// !NOTE: THE OLD ROOK SQUARE STAYS UNTIL THE SERVER'S LIST COMES BACK. THE MOVE LANDS HALFWAY THROUGH DRAWING A FRAME
					// & THE REST OF THAT FRAME STILL DRAWS THE OLD BOARD, SO THE ROOK WOULD DISAPPEAR FOR A FRAME IF ITS SQUARE WAS GONE
					if (chessInst.get(moveObj.to).type == 'k' && moveObj.from == 'e1' && (moveObj.to == 'g1' || moveObj.to == 'c1')) { // CASTLING: THE ROOK MOVES SIDEWAYS TOO, ITS NEW SQUARE IS ADDED
						for (let n = 0; n < JSON.parse(response.w_piece).length; n++) {
							let w_piece = JSON.parse(response.w_piece)
							if (moveObj.to == 'g1' && w_piece[n].to == 'h1') { w_piece[w_piece.length] = { from: w_piece[n].from, to: 'f1' }; response.w_piece = JSON.stringify(w_piece); break; } // KING SIDE
							else if (moveObj.to == 'c1' && w_piece[n].to == 'a1') { w_piece[w_piece.length] = { from: w_piece[n].from, to: 'd1' }; response.w_piece = JSON.stringify(w_piece); break; } // QUEEN SIDE
						}
					}
					if (moveObj.promotion && moveObj.promotion != 'n') { // PROMOTED TO A QUEEN, BISHOP OR ROOK: ADDED SO IT DRAWS BEFORE THE SERVER'S LIST COMES BACK
						let w_piece = JSON.parse(response.w_piece)
						w_piece[w_piece.length] = { from: moveObj.from, to: moveObj.to };
						response.w_piece = JSON.stringify(w_piece);
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
					for (let n = 0; n < JSON.parse(response.b_piece).length; n++) { // SAME FOR THE KINGS, QUEENS, BISHOPS & ROOKS
						if (moveObj.from == JSON.parse(response.b_piece)[n].to) {
							let b_piece = JSON.parse(response.b_piece)
							if (moveObj.from.split("")[1] != moveObj.to.split("")[1]) { b_piece[n].from = moveObj.from; } // MOVED UP OR DOWN (SIDEWAYS KEEPS ITS from)
							b_piece[n].to = moveObj.to;
							response.b_piece = JSON.stringify(b_piece);
						}
					}
					if (chessInst.get(moveObj.to).type == 'k' && moveObj.from == 'e8' && (moveObj.to == 'g8' || moveObj.to == 'c8')) { // CASTLING: THE ROOK MOVES SIDEWAYS TOO, ITS NEW SQUARE IS ADDED
						for (let n = 0; n < JSON.parse(response.b_piece).length; n++) {
							let b_piece = JSON.parse(response.b_piece)
							if (moveObj.to == 'g8' && b_piece[n].to == 'h8') { b_piece[b_piece.length] = { from: b_piece[n].from, to: 'f8' }; response.b_piece = JSON.stringify(b_piece); break; } // KING SIDE
							else if (moveObj.to == 'c8' && b_piece[n].to == 'a8') { b_piece[b_piece.length] = { from: b_piece[n].from, to: 'd8' }; response.b_piece = JSON.stringify(b_piece); break; } // QUEEN SIDE
						}
					}
					if (moveObj.promotion && moveObj.promotion != 'n') { // PROMOTED TO A QUEEN, BISHOP OR ROOK: ADDED SO IT DRAWS BEFORE THE SERVER'S LIST COMES BACK
						let b_piece = JSON.parse(response.b_piece)
						b_piece[b_piece.length] = { from: moveObj.from, to: moveObj.to };
						response.b_piece = JSON.stringify(b_piece);
					}
				}

				revert = response;
				if (ai) { response = await new Promise((resolve) => setTimeout(() => resolve(moveObj.response))); } // ALREADY SAVED BY THE SERVER (NO PUT), WAITS LIKE THE OLD PUT SO THE FRAME FINISHES DRAWING BEFORE refreshData() RESETS THE TILES
				else { response = await validate(GAME_URL, GAME_ID, PLAYER_ID, false, false, false); }
				chessInst.load(response.game_board); // UPDATE BOARD
				if (response.status == 200) { // IF VALIDATED UPDATE BOARD STATE
					currSlide = false;

					tiles[index].isSliding = null;
					tiles[index].xDiff = 0;
					tiles[index].yDiff = 0;
					tiles[index].x = tiles[index].xSlideTo;
					tiles[index].y = tiles[index].ySlideTo;

					opposingMove = false;
					refreshData(response);
					if (response.state == "CLOSED") { showGameOver(response); } // CHECKMATE OR DRAW
				} else { opposingMove = true; return refreshData(revert); } // IF VALIDATION FAILS REVERT BACK TO PREVIOUS BOARD
			} catch (err) { currSlide = false; console.log(err); return refreshData(response); }
		}

		/* ---------------------------------------------------------------- */
		// Refresh Game Data
		/* ---------------------------------------------------------------- */
		/**
		 * @description Refreshes data based on passed in response. Loads its board, clears every tile (selection, drag, slide),
		 * closes the promotion picker & the menu & draws the next frame
		 * @param  {[object]} response [game from the server]
		 * @return {[object]} response
		 */
		function refreshData(response) {
			try {
				chessInst.load(response.game_board);
				tiles = setTiles(); // NEW TILE ARRAY, THE OLD ONE IS DROPPED
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
		 * @description Check the previous x pos & the curr x pos to determine orientation. Points the white knight images
		 * (wKnightImg, wKnightShdw, wKnightRefl) right when the knight moved right on screen, left when it moved left.
		 * The files aren't flipped for black, so the test is flipped here instead
		 * @param  {[number]} xFrom [file it came from, a = 0]
		 * @param  {[number]} xTo [file it went to]
		 */
		function handleKnightDirectionW(xFrom, xTo) {
			if (playerColor == 'w') {
				if (xFrom < xTo) { wKnightImg = wRightKnightImg; wKnightShdw = wRightKnightShdw; wKnightRefl = wRightKnightRefl; } // MOVED RIGHT
				else if (xFrom > xTo) { wKnightImg = wLeftKnightImg; wKnightShdw = wLeftKnightShdw; wKnightRefl = wLeftKnightRefl; } // MOVED LEFT
				else { wKnightImg = wLeftKnightImg; wKnightShdw = wLeftKnightShdw; wKnightRefl = wLeftKnightRefl; } // SAME FILE (A KNIGHT ALWAYS CHANGES FILE, SO THIS DOESN'T HAPPEN)
			} else if (playerColor == 'b') { // FLIPPED BOARD: A HIGHER FILE IS FURTHER LEFT ON SCREEN
				if (xFrom > xTo) { wKnightImg = wRightKnightImg; wKnightShdw = wRightKnightShdw; wKnightRefl = wRightKnightRefl; }
				else if (xFrom < xTo) { wKnightImg = wLeftKnightImg; wKnightShdw = wLeftKnightShdw; wKnightRefl = wLeftKnightRefl; }
				else { wKnightImg = wLeftKnightImg; wKnightShdw = wLeftKnightShdw; wKnightRefl = wLeftKnightRefl; }
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
			if (playerColor == 'w') {
				if (xFrom < xTo) { bKnightImg = bRightKnightImg; bKnightShdw = bRightKnightShdw; bKnightRefl = bRightKnightRefl; } // MOVED RIGHT
				else if (xFrom > xTo) { bKnightImg = bLeftKnightImg; bKnightShdw = bLeftKnightShdw; bKnightRefl = bLeftKnightRefl; } // MOVED LEFT
				else { bKnightImg = bRightKnightImg; bKnightShdw = bRightKnightShdw; bKnightRefl = bRightKnightRefl; } // SAME COLUMN (DOESN'T HAPPEN FOR A KNIGHT)
			} else if (playerColor == 'b') {
				if (xFrom < xTo) { bKnightImg = bRightKnightImg; bKnightShdw = bRightKnightShdw; bKnightRefl = bRightKnightRefl; }
				else if (xFrom > xTo) { bKnightImg = bLeftKnightImg; bKnightShdw = bLeftKnightShdw; bKnightRefl = bLeftKnightRefl; }
				else { bKnightImg = bRightKnightImg; bKnightShdw = bRightKnightShdw; bKnightRefl = bRightKnightRefl; }
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
		function handlePieceDirectionW(yFrom, yTo) {
			if (yFrom > yTo) { // MOVED UP: FACES AWAY
				wKingImg = wBackKingImg; wKingShdw = wBackKingShdw; wKingRefl = wBackKingRefl;
				wQueenImg = wBackQueenImg; wQueenShdw = wBackQueenShdw; wQueenRefl = wBackQueenRefl;
				wBishopBlackSqImg = wBackBishopImg; wBishopWhiteSqImg = wBackBishopImg; wBishopShdw = wBackBishopShdw; wBishopRefl = wBackBishopRefl;
				wRookImg = wBackRookImg; wRookShdw = wBackRookShdw; wRookRefl = wBackRookRefl;
			} else if (yFrom < yTo) { // MOVED DOWN: FACES THE PLAYER
				wKingImg = wFrontKingImg; wKingShdw = wFrontKingShdw; wKingRefl = wFrontKingRefl;
				wQueenImg = wFrontQueenImg; wQueenShdw = wFrontQueenShdw; wQueenRefl = wFrontQueenRefl;
				wBishopBlackSqImg = wFrontBishopBlackSqImg; wBishopWhiteSqImg = wFrontBishopWhiteSqImg; wBishopShdw = wFrontBishopShdw; wBishopRefl = wFrontBishopRefl;
				wRookImg = wFrontRookImg; wRookShdw = wFrontRookShdw; wRookRefl = wFrontRookRefl;
			} else if (playerColor == 'w') { // HASN'T MOVED UP OR DOWN: FACES BLACK'S SIDE (THE TOP OF THE BOARD)
				wKingImg = wBackKingImg; wKingShdw = wBackKingShdw; wKingRefl = wBackKingRefl;
				wQueenImg = wBackQueenImg; wQueenShdw = wBackQueenShdw; wQueenRefl = wBackQueenRefl;
				wBishopBlackSqImg = wBackBishopImg; wBishopWhiteSqImg = wBackBishopImg; wBishopShdw = wBackBishopShdw; wBishopRefl = wBackBishopRefl;
				wRookImg = wBackRookImg; wRookShdw = wBackRookShdw; wRookRefl = wBackRookRefl;
			} else if (playerColor == 'b') { // FLIPPED BOARD: BLACK'S SIDE IS THE BOTTOM
				wKingImg = wFrontKingImg; wKingShdw = wFrontKingShdw; wKingRefl = wFrontKingRefl;
				wQueenImg = wFrontQueenImg; wQueenShdw = wFrontQueenShdw; wQueenRefl = wFrontQueenRefl;
				wBishopBlackSqImg = wFrontBishopBlackSqImg; wBishopWhiteSqImg = wFrontBishopWhiteSqImg; wBishopShdw = wFrontBishopShdw; wBishopRefl = wFrontBishopRefl;
				wRookImg = wFrontRookImg; wRookShdw = wFrontRookShdw; wRookRefl = wFrontRookRefl;
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
		function handlePieceDirectionB(yFrom, yTo) {
			if (yFrom > yTo) { // MOVED UP: FACES AWAY
				bKingImg = bBackKingImg; bKingShdw = bBackKingShdw; bKingRefl = bBackKingRefl;
				bQueenImg = bBackQueenImg; bQueenShdw = bBackQueenShdw; bQueenRefl = bBackQueenRefl;
				bBishopBlackSqImg = bBackBishopImg; bBishopWhiteSqImg = bBackBishopImg; bBishopShdw = bBackBishopShdw; bBishopRefl = bBackBishopRefl;
				bRookImg = bBackRookImg; bRookShdw = bBackRookShdw; bRookRefl = bBackRookRefl;
			} else if (yFrom < yTo) { // MOVED DOWN: FACES THE PLAYER
				bKingImg = bFrontKingImg; bKingShdw = bFrontKingShdw; bKingRefl = bFrontKingRefl;
				bQueenImg = bFrontQueenImg; bQueenShdw = bFrontQueenShdw; bQueenRefl = bFrontQueenRefl;
				bBishopBlackSqImg = bFrontBishopBlackSqImg; bBishopWhiteSqImg = bFrontBishopWhiteSqImg; bBishopShdw = bFrontBishopShdw; bBishopRefl = bFrontBishopRefl;
				bRookImg = bFrontRookImg; bRookShdw = bFrontRookShdw; bRookRefl = bFrontRookRefl;
			} else if (playerColor == 'w') { // HASN'T MOVED UP OR DOWN: FACES WHITE'S SIDE (THE BOTTOM OF THE BOARD)
				bKingImg = bFrontKingImg; bKingShdw = bFrontKingShdw; bKingRefl = bFrontKingRefl;
				bQueenImg = bFrontQueenImg; bQueenShdw = bFrontQueenShdw; bQueenRefl = bFrontQueenRefl;
				bBishopBlackSqImg = bFrontBishopBlackSqImg; bBishopWhiteSqImg = bFrontBishopWhiteSqImg; bBishopShdw = bFrontBishopShdw; bBishopRefl = bFrontBishopRefl;
				bRookImg = bFrontRookImg; bRookShdw = bFrontRookShdw; bRookRefl = bFrontRookRefl;
			} else if (playerColor == 'b') { // FLIPPED BOARD: WHITE'S SIDE IS THE TOP
				bKingImg = bBackKingImg; bKingShdw = bBackKingShdw; bKingRefl = bBackKingRefl;
				bQueenImg = bBackQueenImg; bQueenShdw = bBackQueenShdw; bQueenRefl = bBackQueenRefl;
				bBishopBlackSqImg = bBackBishopImg; bBishopWhiteSqImg = bBackBishopImg; bBishopShdw = bBackBishopShdw; bBishopRefl = bBackBishopRefl;
				bRookImg = bBackRookImg; bRookShdw = bBackRookShdw; bRookRefl = bBackRookRefl;
			}
		}


		/* ---------------------------------------------------------------- */
		// Handle Remote Nav Button Hover
		/* ---------------------------------------------------------------- */
		/**
		 * @description Changes current button effect when keydown is handled. TV remote: moves the menu highlight from the
		 * selected button to btn, hidden buttons are skipped
		 * @param  {[object]} btn [menu button element]
		 */
		function handleRemoteNavBtnHover(btn) {
			if (btn.parentElement.style.display != "none") { // SKIP HIDDEN BUTTONS (RESUME IS HIDDEN WHEN THE GAME IS OVER)
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
		 * @description Handles menu button style when clicked with remote select box. TV remote: the menu opened, so btn
		 * becomes the selected (highlighted) menu button & the gear button goes back to its normal color
		 * @param  {[object]} btn [menu button element]
		 */
		function handleRemoteMenuEnter(btn) {
			if (TV_BOOL) { optBtn.style.transition = "ease-out 375ms"; optBtn.style.color = "burlywood"; }
			if (TV_BOOL || OVERRIDE_TV) { remoteNavBox.menuHover = false; remoteNavBox.menuBtn = btn; remoteNavBox.menuBtn.style.transition = "ease-in 375ms"; remoteNavBox.menuBtn.style.backgroundColor = "burlywood" }
		}


		/* ---------------------------------------------------------------- */
		// Render Coffee
		/* ---------------------------------------------------------------- */
		/**
		 * @description Renders steaming coffee to the table. Draws the cup & its shadow, the steam frames (coffeeObj.img) are empty
		 * so there's no steam right now
		 */
		async function renderCoffee() {
			const coffeeAnimateTime = 2000; // 2 sec to display all the images
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
		 * @description Redraws the game at the new window size (renderBoard() resizes everything from the window)
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
		 * @description Handles Keydown events. TV remote: the arrows move the select box (remoteNavBox) around the board, right
		 * from the last column moves it onto the gear button & up / down move between menu buttons. Enter clicks the square
		 * (handleCanvasClick), opens the menu or presses the selected menu button
		 */
		if (TV_BOOL || OVERRIDE_TV) { window.addEventListener("keydown", handleKeyPress) }
		async function handleKeyPress(e) {
			e.preventDefault();
			e.stopPropagation();
			if (!e?.repeat && e?.keyCode) { // HOLDING A KEY DOESN'T REPEAT
				/**
				 * @description Hovers the player's piece under the select box (the remote's version of handleMouseMove)
				 */
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
					else if (remoteNavBox.x == 7 && !menuToggled) { // PAST THE LAST COLUMN: SELECT THE GEAR BUTTON
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
					if (!remoteNavBox.menuHover && !menuToggled) { checkBoxOverPiece(); handleCanvasClick(e); } // CLICK THE SELECTED SQUARE
					else if (remoteNavBox.menuHover && !menuToggled) { handleMenuBtn(e); handleRemoteMenuEnter(optResumeBtn); } // OPEN THE MENU ON RESUME
					else if (menuToggled && remoteNavBox.menuBtn) { // PRESS THE SELECTED MENU BUTTON, THEN THE SELECT BOX GOES BACK TO THE TOP RIGHT
						remoteNavBox.menuBtn.style.backgroundColor = "#CD853F"
						if (remoteNavBox.menuBtn == optResumeBtn) { handleResume(e); }
						else if (remoteNavBox.menuBtn == optRestartBtn) { handleRestart(e); }
						else if (remoteNavBox.menuBtn == optHomepageBtn) { handleHomepage(e) }
						else if (remoteNavBox.menuBtn == optExitBtn) { handleExit(e) }
						remoteNavBox = { x: 7, y: 0, menuHover: false, menuBtn: false }
					}
				}
				// if (e.keyCode == 10009) { // BACK
				if (e.keyCode == 49) { // BACK ("1" KEY STANDS IN FOR THE REMOTE'S BACK BUTTON, NOTHING YET)
				}
				// if (e.keyCode == 10182) { // EXIT
				if (e.keyCode == 50) { // EXIT ("2" KEY STANDS IN FOR THE REMOTE'S EXIT BUTTON, NOTHING YET)
				}
				refresh = true
			}
		}

		/* ---------------------------------------------------------------- */
		// Get Canvas Point
		/* ---------------------------------------------------------------- */
		/**
		 * @description Converts viewport coordinates to canvas coordinates (mobile browser toolbars can offset the canvas)
		 * @param  {[object]} e [mouse event, or a touch made to look like one]
		 * @return {[object]} { x, y } [position on the canvas]
		 */
		function getCanvasPoint(e) {
			const rect = canvas.getBoundingClientRect();
			return { x: e.clientX - rect.left, y: e.clientY - rect.top };
		}

		/* ---------------------------------------------------------------- */
		// On Click
		/* ---------------------------------------------------------------- */
		/**
		 * @description If piece is clicked, based on new positions or if piece is set back in original position, etc...
		 * While promoting, a click on a piece in the picker finishes the move. Otherwise a click on the player's piece picks it up
		 * (or puts it back down on its own square), a click on another square slides the picked up piece there & a dragged piece
		 * is dropped where it's let go. Mouse up, touch end & the TV remote's enter all end up here
		 */
		if (!TV_BOOL || OVERRIDE_TV) { canvas.addEventListener("click", handleCanvasClick); }
		async function handleCanvasClick(e) {
			e.preventDefault();
			e.stopPropagation();
			const point = getCanvasPoint(e);
			clientX = point.x;
			clientY = point.y;
			tileX = Math.floor((point.x - xBoardOff) / tileWidth); // SCREEN COLUMN CLICKED
			tileY = Math.floor((point.y - yBoardOff) / tileHeight); // SCREEN ROW CLICKED

			if (e.clientX === undefined && remoteNavBox) { // KEYBOARD (TV REMOTE) ENTER HAS NO POINTER POSITION
				tileX = remoteNavBox.x; tileY = remoteNavBox.y;
			}

			if (currPromotion) { // IF PROMOTION IS TRUE LOOK FOR USER TO CLICK ON TAKEN PIECES TO UPDATE BOARD
				revert = response;
				let takenPieces // THE PICKER (drawScreen PUTS IT IN THIS LIST WHILE PROMOTING)
				if (playerColor == 'w') { takenPieces = bTakenPieces }
				else if (playerColor == 'b') { takenPieces = wTakenPieces }
				for (let i = 0; i < takenPieces.length; i++) {
					let takenPiece = takenPieces[i];
					if (((takenPiece.x === tileX && takenPiece.y === tileY && (takenPiece.color == playerColor || !takenPiece.color))) && takenPiece.type && takenPiece.color == playerColor) { // CLICKED THIS PIECE IN THE PICKER
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
								moveObj = playerMove(playerColor, tile); // { from, to } FROM WHERE IT WAS DROPPED
								if (moveObj.promotion) { currPromotion = true; refresh = true; return; } // PAWN ON THE LAST RANK: OPEN THE PICKER
								tile.isClicked = false;
								clickedTile = false;
								mousedownTile = false;
								return await validateMove(); // DROPPED, SO NO SLIDE: SEND IT NOW
							} catch (err) {
								console.log(err);
								opposingMove = false;
								return refreshData(revert);
							}
						}

						tile.isClicked = true; // PICK IT UP
						clickedTile = tile;
						refresh = true;
					} else if (!tile.isHovering && (tile.isClicked && tile.color == playerColor && (tileX != tile.originX || tileY != tile.originY))) { // CLICK PIECE WHILE MAINTAINING POSITION
						try {
							for (let z = 0; z < tiles.length; z++) { tiles[z].isClicked = false; clickedTile = false; }
							for (let j = 0; j < tiles.length; j++) { // CLICKED ANOTHER OF THE PLAYER'S PIECES: PICK THAT ONE UP INSTEAD
								if ((tiles[j].isHovering && tiles[j].x == tileX && tiles[j].y == tileY) && tiles[j].color == playerColor) {
									tiles[j].isClicked = true
									clickedTile = tiles[j];
									refresh = true;
									return;
								}
							}
							tile.x = tileX; // CLICKED A SQUARE: SLIDE THE PICKED UP PIECE THERE (THE MOVE IS SENT WHEN IT LANDS)
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
		 * @description Conditializes hover of piece based on color. Tracks the square under the mouse (tileX, tileY, a held piece
		 * follows it) & sets isHovering on the player's piece under it, or on the promotion picker while promoting.
		 * Asks for a new frame when the hover changes
		 */
		if (!TV_BOOL || OVERRIDE_TV) { canvas.addEventListener("mousemove", handleMouseMove); }
		function handleMouseMove(e) {
			e.preventDefault();
			e.stopPropagation();
			// IF PIECE IS CLICK TO BE MOVED MOUSE POSITION
			const point = getCanvasPoint(e);
			clientX = point.x
			clientY = point.y
			tileX = Math.floor((point.x - xBoardOff) / tileWidth); // SCREEN COLUMN (OFF THE BOARD IS BELOW 0 OR ABOVE 7)
			tileY = Math.floor((point.y - yBoardOff) / tileHeight); // SCREEN ROW
			// remoteNavBox.isClicked = false;
			if (!((tileX < 0 || tileX > 7) && (tileY < 0 || tileY > 7))) { // MOUSE INSIDE THE BOARD (OR BESIDE IT, WHERE THE TRAYS ARE)
				if (currPromotion) { // HOVER THE PICKER
					let takenPieces
					if (playerColor == 'w') { takenPieces = bTakenPieces }
					else if (playerColor == 'b') { takenPieces = wTakenPieces }
					for (let i = 0; i < takenPieces.length; i++) {
						let takenPiece = takenPieces[i];
						takenPiece.isHovering = (((takenPiece.x === tileX && takenPiece.y === tileY && (takenPiece.color == playerColor || !takenPiece.color)))) && !menuToggled
						if (takenPiece.isHovering || takenPiece.isClicked) { refresh = true; offBoardRefresh = true; }
						if (takenPiece.color != playerColor && takenPiece.color) { refresh = true }
					}
				} else { // HOVER THE PLAYER'S PIECE UNDER THE MOUSE (ONLY ON THEIR TURN, WITH THE MENU CLOSED)
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
		 * @description Sets positions / tracks user mousedown drag. Starts a drag on the player's hovered piece (the render loop
		 * makes it a drag after 3 frames). If another piece was picked up by a click, that one is put down instead
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
				if ((tile.isHovering && tile.type && tile.color == playerColor)) { // GRAB THE HOVERED PIECE
					tile.isMousedown = true;
					mousedownTile = tile;
					mouseDownCount = 0;
					for (let j = 0; j < tiles.length; j++) { // A DIFFERENT PIECE WAS PICKED UP: PUT IT DOWN
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
		 * @description Sets positions based on mouse up event position. Lets go of the held piece. The click event comes right
		 * after & handleCanvasClick() drops it on the square (a drag) or keeps it picked up (a quick click)
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
				if (tile.isMousedown && tile.isHovering && tile.type && tile.color == playerColor) { // LET GO OF THE HELD PIECE
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
		let audioUnlocked = false; // THE MOVE SOUND WAS UNLOCKED BY A TAP (IOS)

		function touchToMouseEvent(touch) { // A TOUCH WITH THE FIELDS THE MOUSE HANDLERS USE
			return { clientX: touch.clientX, clientY: touch.clientY, preventDefault() { }, stopPropagation() { } };
		}

		function findActiveTouch(touchList) { // THE FINGER THAT STARTED (touchState.id), OTHER FINGERS ARE IGNORED
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

		function handleTouchStart(e) { // FINGER DOWN = HOVER + MOUSE DOWN
			e.preventDefault(); // STOPS SCROLL / ZOOM & THE BROWSER'S EMULATED MOUSE EVENTS
			if (touchState) { return; } // IGNORE EXTRA FINGERS
			const touch = e.changedTouches[0];
			const point = touchToMouseEvent(touch);
			touchState = { id: touch.identifier, startX: touch.clientX, startY: touch.clientY, dragging: false, point };
			handleMouseMove(point); // TOUCH HAS NO HOVER, SO SET IT BEFORE MOUSEDOWN
			handleMouseDown(point);
		}

		function handleTouchMove(e) { // FINGER MOVES = MOUSE MOVE, ONCE IT'S MOVED FAR ENOUGH TO BE A DRAG
			e.preventDefault();
			if (!touchState) { return; }
			const touch = findActiveTouch(e.changedTouches);
			if (!touch) { return; }
			touchState.point = touchToMouseEvent(touch);
			if (!touchState.dragging && Math.hypot(touch.clientX - touchState.startX, touch.clientY - touchState.startY) < touchDragThreshold) { return; } // SMALL FINGER JITTER IS STILL A TAP
			touchState.dragging = true;
			handleMouseMove(touchState.point);
		}

		function handleTouchEnd(e) { // FINGER UP = MOUSE UP + CLICK
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

		function handleTouchCancel(e) { // THE BROWSER TOOK THE TOUCH (A SYSTEM GESTURE): LET GO WITHOUT A CLICK
			if (!touchState) { return; }
			handleMouseUp(touchState.point);
			touchState = null;
		}


		/* ---------------------------------------------------------------- */
		// Options (Menu) Button
		/* ---------------------------------------------------------------- */
		/**
		 * @description Toggles menu based on menu state. The gear button opens or closes the menu
		 */
		if (!TV_BOOL || OVERRIDE_TV) { optBtn.addEventListener("click", handleMenuBtn); }
		function handleMenuBtn(e) {
			e.preventDefault();
			e.stopPropagation();
			menuToggled = !menuToggled;
			refresh = false; // THE BOARD STAYS AS IT IS UNDER THE MENU
			if (menuToggled) { menu.style.display = "flex" }
			else { menu.style.display = "none" }
		}

		/* ---------------------------------------------------------------- */
		// Resume Button (Menu)
		/* ---------------------------------------------------------------- */
		/**
		 * @description Opens or closes menu based on menu state. Resume is only seen while the menu is open, so it closes it
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
		 * @description AI games: a game that's still going is forfeited, then a new game starts.
		 * Friend games: the same button is Forfeit, then Rematch once the game is over
		 */
		if (!TV_BOOL || OVERRIDE_TV) { optRestartBtn.addEventListener("click", handleRestart) }
		async function handleRestart(e) {
			e.preventDefault();
			e.stopPropagation();
			if (!ai) { return await handleFriendBtn(); } // FORFEIT / REMATCH
			boardReset = true; // STOP DRAWING WHILE THE NEW BOARD LOADS
			ctx.clearRect(0, 0, cw, ch);
			refresh = false;
			menuToggled = false;
			optBtn.style.display = "none"
			menu.style.display = "none"
			// THE RESTART PARAM IS THE AI'S COLOR (THE BACKEND STORES PLAYER_ID_1 AS WHITE), GIVING THE AI THE PLAYER'S COLOR FLIPS SIDES EACH RESTART
			const aiColor = playerColor;
			const restartResponse = await restartGame(GAME_URL, GAME_ID, aiColor); // FORFEITS IF STILL GOING, THEN A NEW GAME IN THE DATABASE
			if (restartResponse?.status != 200 || !restartResponse?.game_board) { // RESET FAILED, KEEP THE CURRENT GAME
				// console.log(restartResponse);
				optBtn.style.display = "flex";
				boardReset = false;
				refresh = true;
				return;
			}
			GAME_ID = restartResponse.game_id; // NEW GAME ID (GUESTS KEEP THEIRS)
			if (playerData.SIGNED_IN) { history.replaceState(null, "", `/play/${GAME_ID}`); } // THE URL FOLLOWS THE NEW GAME, BACK DOESN'T RETURN TO THE OLD ONE (GUESTS STAY ON /play)
			await loadNewBoard();
			return
		}

		/**
		 * @description Loads GAME_ID's board in place (restart & rematch), the canvas, listeners & render loop stay the same
		 */
		async function loadNewBoard() {
			gameOver = false;
			drawScreen = function () { return }; // DRAW NOTHING UNTIL THE NEW BOARD IS IN
			await setInitialData(); // GETS THE NEW BOARD & PLAYER COLOR FROM THE DATABASE
			handleInitialData(); // NEW drawScreen FOR THE (MAYBE NEW) PLAYER COLOR
			optBtn.style.display = "flex";
			optResumeBtn.parentElement.style.display = 'flex'; // RESUME COMES BACK (IT'S HIDDEN WHEN A GAME IS OVER)
			resultDisplay.innerText = "Chess"
			await refreshData(response);
			opposingMove = chessInst.turn() != playerColor; // LOCKED IF THE OPPONENT GOES FIRST
			boardReset = false;
			refresh = true;
		}

		/* ---------------------------------------------------------------- */
		// Forfeit / Rematch Button (Menu, friend games)
		/* ---------------------------------------------------------------- */
		/**
		 * @description Game going: Forfeit -> "Are you sure?" -> forfeits. Game over: Rematch, starts when both players press it within 1 minute
		 */
		async function handleFriendBtn() {
			if (!gameOver) {
				if (!confirmForfeit) { // FIRST PRESS ASKS, THE QUESTION GOES AWAY AFTER 5 SECONDS
					confirmForfeit = true;
					optRestartBtn.innerHTML = "Are you sure?";
					setTimeout(function () { if (confirmForfeit && !gameOver) { confirmForfeit = false; optRestartBtn.innerHTML = "Forfeit"; } }, 5000);
					return;
				}
				confirmForfeit = false;
				const forfeitResponse = await forfeitGame(GAME_URL, GAME_ID);
				if (forfeitResponse?.state == "CLOSED") { return showGameOver(forfeitResponse); }
				optRestartBtn.innerHTML = "Forfeit"; // FORFEIT FAILED, KEEP PLAYING
				return;
			}
			if (rematchWaiting) { return; } // ALREADY ASKED, STILL WAITING
			const rematchResponse = await rematchGame(GAME_URL, GAME_ID);
			if (rematchResponse?.new_game_id) { return await loadRematch(rematchResponse.new_game_id); } // OPPONENT WAS ALREADY WAITING
			if (rematchResponse?.waiting) { // WAIT 1 MINUTE FOR THE OPPONENT
				optRestartBtn.innerHTML = "Waiting...";
				rematchWaiting = setTimeout(function () { rematchWaiting = false; optRestartBtn.innerHTML = "Rematch"; }, rematchResponse.expires_in);
			}
		}

		/* ---------------------------------------------------------------- */
		// Game Over
		/* ---------------------------------------------------------------- */
		/**
		 * @description Locks the board & opens the menu with the server's result. AI games offer Restart, friend games offer Rematch
		 * @param  {[object]} result [{ winner: "w" | "b" | "draw", reason }]
		 */
		function showGameOver(result) {
			if (gameOver) { return; } // ALREADY SHOWN
			gameOver = true;
			opposingMove = true; // NO MORE MOVES
			menuToggled = true;
			menu.style.display = "flex"
			optResumeBtn.parentElement.style.display = 'none';
			if (result?.reason == "forfeit") { resultDisplay.innerText = result.winner == 'w' ? "Black Forfeits" : "White Forfeits" } // THE TITLE ONLY FITS ONE LINE
			else if (result?.winner == 'w') { resultDisplay.innerText = "White Wins!" }
			else if (result?.winner == 'b') { resultDisplay.innerText = "Black Wins!" }
			else { resultDisplay.innerText = "Draw" }
			if (!ai) { optRestartBtn.innerHTML = "Rematch"; } // FRIEND GAME
			handleRemoteMenuEnter(optRestartBtn); // TV REMOTE: SELECT RESTART / REMATCH
		}

		/* ---------------------------------------------------------------- */
		// Load Rematch
		/* ---------------------------------------------------------------- */
		/**
		 * @description Both players asked for a rematch: loads the new game in place (the server picked the sides)
		 * @param  {[string]} newGameId [rematch game id, from the request or the socket]
		 */
		async function loadRematch(newGameId) {
			if (!newGameId || `${newGameId}` == `${GAME_ID}`) { return; } // ALREADY LOADED (THE REQUEST & THE SOCKET BOTH SEND IT)
			GAME_ID = newGameId;
			history.replaceState(null, "", `/play/${GAME_ID}`); // THE URL FOLLOWS THE REMATCH
			clearTimeout(rematchWaiting); // STOP THE 1 MINUTE WAIT
			rematchWaiting = false;
			boardReset = true; // STOP DRAWING WHILE THE NEW BOARD LOADS
			ctx.clearRect(0, 0, cw, ch);
			refresh = false;
			menuToggled = false;
			menu.style.display = "none"
			optRestartBtn.innerHTML = "Forfeit";
			joinGame(GAME_ID, PLAYER_ID, socketHandlers); // NEW GAME'S ROOM
			await loadNewBoard();
		}

		/* ---------------------------------------------------------------- */
		// Homepage Button (Menu)
		/* ---------------------------------------------------------------- */
		/**
		 * @description Goes to Home (/). Stops the render loop & leaves the friend game's socket room first,
		 * the page load clears everything else (listeners, canvas)
		 */
		if (!TV_BOOL || OVERRIDE_TV) { optHomepageBtn.addEventListener("click", handleHomepage); }
		function handleHomepage(e) {
			e.preventDefault();
			e.stopPropagation();

			window.clearInterval(drawInterval); // STOP THE RENDER LOOP
			leaveGame();
			window.location.href = "/"; // HOME (server/routes/pageRoutes.js)
		}

		/* ---------------------------------------------------------------- */
		// Exit Button (Menu)
		/* ---------------------------------------------------------------- */
		/**
		 * @description Exits game: a signed in player logs out, a guest logs in (the server's auth routes, server/routes/api/authRoutes.js)
		 */
		if (!TV_BOOL || OVERRIDE_TV) { optExitBtn.addEventListener("click", handleExit); }
		function handleExit(e) {
			e.preventDefault();
			e.stopPropagation();
			window.location.href = playerData.SIGNED_IN ? "/api/auth/logout" : "/api/auth/login";
		}
	}
}