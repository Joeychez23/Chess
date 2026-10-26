/*
 *  index.js  --  chess frontend
 *	Gameplay
 *	Draws the game to a canvas (table, board, pieces, shadows & reflections), handles moves by
 *	click, drag, touch & TV remote, slides the AI's / opponent's moves in & runs the in game menu.
 *	Moves are checked locally with chess.js, then saved by the chess server (validate/index.js)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, canvas, ctx, chessInst, validateState } = require("./state/index.js"); // THE GAME'S SHARED STATE (game.tiles, game.moveObj, ...), THE CANVAS & THE chess.js BOARDS
const { validate, restartGame, forfeitGame, rematchGame } = require("./validate/index.js"); // REQUESTS TO THE CHESS SERVER (/api/chess)
const { playerMove } = require("./user/index.js"); // TURNS A DROPPED TILE INTO A { from, to, promotion } MOVE
const { playAi } = require("./ai/index.js"); // ASKS THE SERVER FOR THE AI'S MOVE
const { setTiles, countStartPieces } = require("./utils/index.js"); // NEW ARRAY OF 64 BLANK TILE STATES, HOW MANY PIECES EACH SIDE STARTED WITH
const { images, imageProgress } = require("./images/index.js"); // THE LOADED IMAGES BY IMAGE NUMBER, HOW MANY HAVE LOADED (0 - 1)
const { renderBoard, handleWindowResize } = require("./layout/index.js"); // SIZES THE CANVAS & BOARD TO THE WINDOW & DRAWS THE TABLE & BOARD, REDRAWS ON RESIZE
const {
	tableShdw, // BOARD (THE BOARD ITSELF IS DRAWN BY renderBoard, gameplay/layout/index.js)
	wFrontKingImg, wBackKingImg, wFrontQueenImg, wBackQueenImg, wFrontBishopBlackSqImg, wFrontBishopWhiteSqImg, wBackBishopImg, wRightKnightImg, wLeftKnightImg, wFrontRookImg, wBackRookImg, wFrontPawnImg, wBackPawnImg, // WHITE IMAGES
	wFrontKingShdw, wBackKingShdw, wFrontQueenShdw, wBackQueenShdw, wFrontBishopShdw, wBackBishopShdw, wRightKnightShdw, wLeftKnightShdw, wFrontRookShdw, wBackRookShdw, wFrontPawnShdw, wBackPawnShdw, // WHITE SHADOW
	wFrontKingRefl, wBackKingRefl, wFrontQueenRefl, wBackQueenRefl, wFrontBishopRefl, wBackBishopRefl, wRightKnightRefl, wLeftKnightRefl, wFrontRookRefl, wBackRookRefl, wFrontPawnRefl, wBackPawnRefl, // WHITE REFLECT
	bFrontKingImg, bBackKingImg, bFrontQueenImg, bBackQueenImg, bFrontBishopBlackSqImg, bFrontBishopWhiteSqImg, bBackBishopImg, bRightKnightImg, bLeftKnightImg, bFrontRookImg, bBackRookImg, bFrontPawnImg, bBackPawnImg, // BLACK IMAGES
	bFrontKingShdw, bBackKingShdw, bFrontQueenShdw, bBackQueenShdw, bFrontBishopShdw, bBackBishopShdw, bRightKnightShdw, bLeftKnightShdw, bFrontRookShdw, bBackRookShdw, bFrontPawnShdw, bBackPawnShdw, // BLACK SHADOW
	bFrontKingRefl, bBackKingRefl, bFrontQueenRefl, bBackQueenRefl, bFrontBishopRefl, bBackBishopRefl, bRightKnightRefl, bLeftKnightRefl, bFrontRookRefl, bBackRookRefl, bFrontPawnRefl, bBackPawnRefl, // BLACK REFLECT
	moveHighlight, takeableHighlight, checkHighlight // UI
} = require("./sprites/index.js"); // IMAGE NUMBERS, images[number].image IS THE IMAGE
const { joinGame, leaveGame } = require("../socket/index.js"); // FRIEND GAMES: THE SERVER PUSHES MOVES, FORFEITS & REMATCHES
const main = document.querySelector("#main"); // THE CANVAS IS ADDED HERE
const optBtn = document.getElementById("optBtn"); // MENU BUTTON (3 LINES, TOP RIGHT), OPENS THE MENU
const menu = document.getElementById("menuContainer"); // IN GAME MENU
const optResumeBtn = document.getElementById("optResume"); // MENU: RESUME
const optRestartBtn = document.getElementById("optRestart"); // MENU: RESTART (AI GAMES) / FORFEIT & REMATCH (FRIEND GAMES)
const optHomepageBtn = document.getElementById("optSettings"); // MENU: HOMEPAGE
const optExitBtn = document.getElementById("optExit"); // MENU: EXIT
const resultDisplay = document.getElementById("resultDisplay"); // MENU TITLE ("Chess" OR THE RESULT)

const OVERRIDE_TV = false; // TRUE TURNS ON THE TV REMOTE (ARROW KEYS & ENTER) & THE MOUSE TOGETHER, FOR TESTING

/* ---------------------------------------------------------------- */
// Game Variables
/* ---------------------------------------------------------------- */
// USED BY THE FUNCTIONS BELOW ONLY (THE STATE OTHER FILES SHARE IS game, gameplay/state/index.js)
let clickX; // PIXEL X OF tileX, A HELD PIECE IS DRAWN THERE
let clickY; // PIXEL Y OF tileY
let offBoardRefresh = true; // REDRAW WHEN THE MOUSE LEAVES THE BOARD (CLEARS HOVER EFFECTS)
let slidePos; // SQUARE THE SLIDING PIECE IS CROSSING (trackSlidePosition)
let knightPause = false; // TRUE FOR THE 100MS A KNIGHT STOPS BEFORE ITS HOP (currSlide IS OFF), SO A FRAME DRAWN THEN STILL PUTS IT ON TOP
const RESTART_SLIDE_MS = 800; // HOW LONG THE PIECES TAKE TO SLIDE HOME
let confirmForfeit = false; // FORFEIT NEEDS A SECOND PRESS
let rematchWaiting = false; // TIMER WHILE WAITING 1 MINUTE ON THE OPPONENT'S REMATCH PRESS
let availableMoves; // LEGAL MOVES OF THE SELECTED PIECE (chess.js VERBOSE MOVES)
let currInst; // 8 x 8 BOARD FROM chessInst.board(), FLIPPED WHEN PLAYING BLACK
let touchState = null; // ACTIVE TOUCH (MOBILE): { id, startX, startY, dragging, point }
const frameRate = 1000 / 33; // MS BETWEEN FRAMES (ABOUT 33 A SECOND)
let moveAudio; // MOVE SOUND (MADE IN renderCanvas)
let remoteNavBox = { x: 7, y: 0, menuHover: false, menuBtn: false } // TV REMOTE SELECT BOX: SQUARE (x, y), ON THE MENU BUTTON (menuHover) & THE SELECTED MENU BUTTON

let xPos; // TAKEN PIECE TRAY COLUMN (renderTakenPieces)
let yPos; // TAKEN PIECE TRAY ROW
let overlapSlideObj = null; // THE 3 x 3 SQUARES AROUND A SLIDING PIECE, SO THE PIECES IT PASSES BEHIND ARE DRAWN ON TOP (drawSlideBox)
let yPositive = false; // THE SLIDING PIECE IS GOING DOWN THE SCREEN
let xPositive = false; // THE SLIDING PIECE IS GOING RIGHT
const socketHandlers = { move: checkOpponentMove, gameOver: showGameOver, rematch: loadRematch }; // SOCKET EVENT -> HANDLER
const touchDragThreshold = 10; // PX A FINGER MUST MOVE BEFORE A TAP BECOMES A DRAG
let audioUnlocked = false; // THE MOVE SOUND WAS UNLOCKED BY A TAP (IOS)

/* ---------------------------------------------------------------- */
// Render Canvas
/* ---------------------------------------------------------------- */
/**
 * @description Starts a game: adds the canvas to main & starts the game (startGame) once the images are loaded.
 * The game's functions are below, the state they share is game (gameplay/state/index.js)
 * @param  {[object]} playerData [{ GAME_URL, GAME_ID, PLAYER_ID, TV_BOOL, SIGNED_IN }, TV_BOOL = TV REMOTE CONTROLS INSTEAD OF THE MOUSE]
 */
export async function renderCanvas(playerData) {
	game.GAME_URL = playerData.GAME_URL; // SETS CONSTANT GAME VARIABLES
	game.PLAYER_ID = playerData.PLAYER_ID;
	game.TV_BOOL = playerData.TV_BOOL;
	game.SIGNED_IN = playerData.SIGNED_IN; // A SIGNED IN PLAYER (NOT A GUEST): RESTART CHANGES THE URL, EXIT LOGS OUT
	game.GAME_ID = playerData.GAME_ID; // CHANGES WHEN AN AI GAME RESTARTS OR A FRIEND GAME REMATCHES

	optBtn.style.display = "flex"; // SHOW THE MENU BUTTON

	canvas.id = "canvas";

	game.cw = (canvas.width = window.innerWidth); // CANVAS WIDTH (CSS PIXELS)
	game.ch = (canvas.height = window.innerHeight); // CANVAS HEIGHT (CSS PIXELS)
	moveAudio = new Audio(`${process.env.CHESS_ASSESTS_URL}/audio/piece-jump.mp4`); // MOVE SOUND

	canvas.style.backgroundRepeat = "repeat-y"; // THE TABLE BEHIND THE BOARD
	canvas.style.backgroundImage = `url("${process.env.CHESS_ASSESTS_URL}/images/board/table.webp")`;
	canvas.style.backgroundSize = "cover";
	canvas.style.backgroundPosition = "center";
	main.append(canvas);


	/* ---------------------------------------------------------------- */
	// Check Image Loaded
	/* ---------------------------------------------------------------- */
	/**
	 * @description If all images are loaded start game. Checks every 100ms (Home already loaded them, so they come from the browser cache)
	 */
	const startGameCheck = setInterval(async function () {
		if (imageProgress() == 1) { // EVERY IMAGE preloadImages() STARTED IS IN (THE PLAY PAGE STARTS THEM BEFORE renderCanvas)
			startGame();
			clearInterval(startGameCheck);
		}
	}, 100);
}

/* ---------------------------------------------------------------- */
// Start Game
/* ---------------------------------------------------------------- */
/**
 * @description Starts the core game interval loop. Loads the game, joins a friend game's socket room, adds the canvas
 * to main, runs renderLoop() every frameRate ms & adds the event listeners (their handlers are in EVENT LISTENERS below)
 */
async function startGame() {
	game.wTakenPieces = setTakenPieceArr("b");
	game.bTakenPieces = setTakenPieceArr("w");

	game.cw = 0; // SET BY renderBoard()
	game.ch = 0;

	await setInitialData(); // SETS INITIAL DATA
	handleInitialData(); // HANDLES INITIAL DATA
	if (!game.ai && game.response?.status == 200) { // FRIEND GAME
		joinGame(game.GAME_ID, game.PLAYER_ID, socketHandlers); // THE SERVER PUSHES MOVES, FORFEITS & REMATCHES (server/socket.js)
		if (!game.gameOver) { optRestartBtn.innerHTML = "Forfeit"; } // RESTART IS FORFEIT IN FRIEND GAMES
	}

	
	// JUST IN CASE
	canvas.style.backgroundRepeat = "repeat-y"; // THE TABLE BEHIND THE BOARD
	canvas.style.backgroundImage = `url("${process.env.CHESS_ASSESTS_URL}/images/board/table.webp")`;
	canvas.style.backgroundSize = "cover";
	canvas.style.backgroundPosition = "center";
	main.append(canvas);
	//

	game.drawInterval = setInterval(async function () { await renderLoop() }, frameRate); // THE RENDER LOOP, ABOUT 33 FRAMES A SECOND

	// EVENT LISTENERS (THE HANDLERS ARE IN EVENT LISTENERS BELOW, handleWindowResize IS IN gameplay/layout/index.js)
	window.addEventListener("resize", handleWindowResize);
	if (game.TV_BOOL || OVERRIDE_TV) { window.addEventListener("keydown", handleKeyPress) }
	if (!game.TV_BOOL || OVERRIDE_TV) { canvas.addEventListener("click", handleCanvasClick); }
	if (!game.TV_BOOL || OVERRIDE_TV) { canvas.addEventListener("mousemove", handleMouseMove); }
	if (!game.TV_BOOL || OVERRIDE_TV) { canvas.addEventListener("mousedown", handleMouseDown); }
	if (!game.TV_BOOL || OVERRIDE_TV) { canvas.addEventListener("mouseup", handleMouseUp); }
	if (!game.TV_BOOL || OVERRIDE_TV) {
		canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
		canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
		canvas.addEventListener("touchend", handleTouchEnd, { passive: false });
		canvas.addEventListener("touchcancel", handleTouchCancel, { passive: false });
	}
	if (!game.TV_BOOL || OVERRIDE_TV) { optBtn.addEventListener("click", handleMenuBtn); }
	if (!game.TV_BOOL || OVERRIDE_TV) { optResumeBtn.addEventListener("click", handleResume); }
	if (!game.TV_BOOL || OVERRIDE_TV) { optRestartBtn.addEventListener("click", handleRestart) }
	if (!game.TV_BOOL || OVERRIDE_TV) { optHomepageBtn.addEventListener("click", handleHomepage); }
	if (!game.TV_BOOL || OVERRIDE_TV) { optExitBtn.addEventListener("click", handleExit); }
}

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
	if (game.restartSlide) { return drawRestartSlide(); } // RESTART & REMATCH: THE PIECES SLIDE HOME
	if ((game.refresh || game.currSlide) && !game.boardReset) {
		try {
			if (game.ai && chessInst.turn() != game.playerColor && game.aiTurn) { // IF AI
				game.revert = game.response; // GO BACK TO THIS IF THE AI MOVE FAILS
				clearInterval(game.drawInterval) // NO FRAMES WHILE THE SERVER PICKS THE MOVE
				game.moveObj = await playAi(game.GAME_URL, game.GAME_ID); // THE SERVER PICKS & SAVES THE AI MOVE

				validateState.load(game.response.game_board); // CHECK THE MOVE ON THE SCRATCH BOARD (THROWS IF IT'S NOT LEGAL)
				validateState.move(game.moveObj);
				for (let i = 0; i < game.tiles.length; i++) { // START THE SLIDE OF THE PIECE ON moveObj.from
					if (game.tiles[i].square == game.moveObj.from) {
						game.slideStart = true;
						game.tiles[i].isSliding = true;
						if (game.playerColor == 'w') { // SCREEN COLUMN & ROW OF moveObj.to (a8 IS 0, 0)
							game.tiles[i].xSlideTo = game.moveObj.to.split("")[0].charCodeAt(0) - 96 - 1;
							game.tiles[i].ySlideTo = 8 - game.moveObj.to.split("")[1];
						} else if (game.playerColor == 'b') { // FLIPPED BOARD (h1 IS 0, 0)
							game.tiles[i].xSlideTo = 8 - (game.moveObj.to.split("")[0].charCodeAt(0) - 96);
							game.tiles[i].ySlideTo = game.moveObj.to.split("")[1] - 1;
						}
						game.tiles[i].xDiff = 0; // PIXELS MOVED SO FAR
						game.tiles[i].yDiff = 0;
					} else if (game.tiles[i].isSliding) { // STOP ANY OTHER SLIDE
						game.tiles[i].isSliding = false;
						game.tiles[i].xDiff = 0;
						game.tiles[i].yDiff = 0;
					}
				}
				game.aiTurn = false;
				game.currSlide = true;
				game.drawInterval = setInterval(async function () { await renderLoop() }, frameRate); // FRAMES AGAIN, THE SLIDE PLAYS
				return;
			}
			game.drawScreen(); // DRAW ONE FRAME
			document.documentElement.classList.remove("loadingPage"); // THE FIRST FRAME IS DRAWN: FADE INTO THE GAME (play.html), DOES NOTHING AFTER THAT
			game.refresh = false;
		} catch (err) { console.log(err); }
	}
}

/*____________________________________________________________________________________________________________________________*/

/* ################################################################ */
/* ################################################################ */
// CORE GAME FUNCTIONS
/* ################################################################ */
/* ################################################################ */

/* ---------------------------------------------------------------- */
// Set Initial Board Data
/* ---------------------------------------------------------------- */
/**
 * @description Sets initial data. Gets the game from the server & sets the player's color & the board.
 * Guests get a new AI game first if they don't have one. If it's the AI's turn its move is asked for here & slid in by renderLoop()
 * @return {[boolean]} false [the game couldn't be loaded]
 */
async function setInitialData() {
	if (game.PLAYER_ID === game.GAME_ID && game.PLAYER_ID && game.GAME_ID) { // GUEST (A GUEST'S PLAYER ID IS THEIR GAME ID)
		game.response = await validate(game.GAME_URL, game.GAME_ID, game.PLAYER_ID, false, false, false);
		if (!game.response?.game_board) { game.response = await validate(game.GAME_URL, game.GAME_ID, game.PLAYER_ID, false, false, 'b'); } // NO GAME YET: NEW GAME VS THE AI
	}
	game.response = await validate(game.GAME_URL, game.GAME_ID, game.PLAYER_ID, false, false, false); // GET THE GAME
	game.playerColor = game.response?.player_color || null;
	if (game.response.status == 200) { // IF GAME IS ON AI TURN, PLAY TURN
		game.opponentColor = game.response?.opponent_color || false;
		chessInst.load(game.response.game_board); // THE BOARD TO DRAW
		game.startPieceCount = countStartPieces(game.response.start_params?.fen); // A SET POSITION CAN START WITH FEWER PIECES, THE MISSING ONES WEREN'T TAKEN
		if (game.response.state == "CLOSED") { // GAME IS OVER (CHECKMATE, DRAW OR FORFEIT)
			game.ai = game.response.ai;
			showGameOver(game.response);
			return;
		}

		// NOTE : CONDITONALIZE BACK END TO SUPPORT DETIRMINING AI COLOR OR REAL OPPONENT COLOR
		// THEN : CONDITIONALIZE BOARD ACCORDINGLY

		if (chessInst.turn() == game.playerColor) { game.opposingMove = false; } else { game.opposingMove = true; } // LOCK THE BOARD ON THE OPPONENT'S TURN
		if (game.response.ai) {
			game.ai = true;
			if (game.opponentColor == chessInst.turn()) { //PLAY AI MOVE
				game.moveObj = await playAi(game.GAME_URL, game.GAME_ID); // THE SERVER PICKS & SAVES THE AI MOVE (renderLoop ASKS AGAIN, GETS THE SAME MOVE & SLIDES IT IN)
				game.tiles = await setTiles();
				game.aiTurn = true;
				game.refresh = true;
				setTimeout(function () { game.aiTurn = true; game.refresh = true; }, 500);
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
 * dropped, the rest sit on their square. Also draws the selected piece's legal moves, slides a moving piece toward its
 * new square & draws the pieces it passes behind again on top (drawSlideBox). A hopping knight is drawn in the turn of the
 * square it's over (hopTurn), not its start square's
 * @param  {[number]} clickX [pixel x of the square under the mouse, from renderBoard()]
 * @param  {[number]} clickY [pixel y of the square under the mouse]
 * @param  {[boolean]} lightObstruction [true draws the reflections & shadows]
 */
function renderPiecesToBoard(inst, clickX, clickY, lightObstruction) {
	let x, y; // WHERE THIS SQUARE'S PIECE IS DRAWN (PIXELS)
	let index = 0; // TILE BEING DRAWN, COUNTS UP WITH THE LOOP (THE FUNCTIONS BELOW READ IT)

	// A HOPPING KNIGHT IS DRAWN IN THE TURN OF THE SQUARE IT'S OVER, NOT ITS START SQUARE, SO ITS REFLECTION & SHADOW GO UNDER THE PIECES
	// IN FRONT OF IT & OVER THE ONES BEHIND IT, LIKE A PIECE STANDING THERE (ITS IMAGE IS DRAWN AGAIN ON TOP AT THE END OF THE FRAME, drawSlideBox)
	// !NOTE: IN ITS START SQUARE'S TURN IT PAINTED ITS SHADOW OVER THE PAWNS IT JUMPED (DRAWN BEFORE IT) UNTIL IT LANDED, SO THEY FLASHED
	let hopTurn = null; // { index: THE KNIGHT'S TILE, square: TILE OF THE SQUARE IT'S OVER (row * 8 + column) }, null WHEN IT'S OVER ITS OWN
	for (let q = 0; q < game.tiles.length; q++) {
		if (game.tiles[q].isSliding && game.tiles[q].type == 'n' && (game.tiles[q].xDiff || game.tiles[q].yDiff)) {
			const row = Math.min(Math.max(Math.round(game.tiles[q].y - game.tiles[q].yDiff / game.tileHeight), 0), 7); // yDiff IS SUBTRACTED (UP THE SCREEN IS POSITIVE)
			const column = Math.min(Math.max(Math.round(game.tiles[q].x + game.tiles[q].xDiff / game.tileWidth), 0), 7);
			if (row * 8 + column != q) { hopTurn = { index: q, square: row * 8 + column }; }
			break;
		}
	}

	/* ################################################################ */
	// TV REMOTE SELECT BOX (TURNED OFF)
	// if (!remoteNavBox.menuHover && !menuToggled && TV_BOOL || OVERRIDE_TV) {  ctx.drawImage(images[checkHighlight].image, remoteNavBox.x * tileWidth + xBoardOff, (remoteNavBox.y * tileHeight - tileHeight / 10 + yBoardOff), tileWidth, tileHeight);  }
	/* ################################################################ */

	for (let i = 0; i < inst.length; i++) { // ROW
		for (let j = 0; j < inst[i].length; j++, index++) { // COLUMN
			game.tiles[index] = { ...inst[i][j], ...game.tiles[index], x: j, y: i }; // TILE[INDEX] = DECONSTRUCTED ARRAY OF CHESS BOARD ROW/COLUMN, TILE[INDEX] INIT VALUES, X, Y
			if (inst[i][j]) { // IF CURRENT INDEX OF A TILE EXISTS
				if (game.tiles[index].isMousedown) { // IF MOUSEDOWN SET PIECE TO MOUSE POSITION
					if (game.mouseDownCount > 3) { game.tiles[index].isClicked = true; } else { game.mouseDownCount += 1; } // HELD FOR MORE THAN 3 FRAMES = A DRAG, THE CLICK HANDLER DROPS IT
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

						let xChange = (game.tileWidth / frameRate) * 3.48513659; // PIXELS MOVED PER FRAME, ABOUT 9 FRAMES PER SQUARE
						let yChange = (game.tileHeight / frameRate) * 3.48513659;

						let endTileX = Math.abs(game.tiles[index].xSlideTo - game.tiles[index].x); // SQUARES TO GO ACROSS
						let endTileY = Math.abs(game.tiles[index].ySlideTo - game.tiles[index].y); // SQUARES TO GO UP OR DOWN
						if (game.tiles[index].type.match(/[n]/) && endTileX > endTileY) { xChange = xChange * 2; } // KNIGHTS MOVE TWICE AS FAST ALONG THEIR LONG SIDE SO BOTH SIDES FINISH TOGETHER
						else if (game.tiles[index].type.match(/[n]/) && endTileY > endTileX) { yChange = yChange * 2; } // (SET BEFORE THE CHECKS BELOW SO THEY SNAP ON THE REAL STEP)
						let xBool = false; // ARRIVED ACROSS
						let yBool = false; // ARRIVED UP OR DOWN
						// THE SLIDE MOVES ON THE REFLECTION LAYER (w == 0), THE SHADOW & PIECE ARE DRAWN AT THE SAME SPOT
						// X

						if (game.tiles[index].xSlideTo > game.tiles[index].x && w == 0) { // X: Greater
							endTileX = game.tiles[index].xSlideTo - game.tiles[index].x;
							if (Math.floor((game.tiles[index].x * game.tileWidth) + game.tiles[index].xDiff) == Math.floor((game.tiles[index].x * game.tileWidth) + (game.tileWidth * endTileX))) { // ARRIVED
								xBool = true
							} else if (((game.tiles[index].x * game.tileWidth) + (game.tiles[index].xDiff + xChange)) >= ((game.tiles[index].x * game.tileWidth) + (game.tileWidth * endTileX))) { // NEXT STEP GOES PAST: SNAP TO THE SQUARE
								const remainder = (game.tiles[index].x * game.tileWidth) + game.tiles[index].xDiff - ((game.tiles[index].x * game.tileWidth) + (game.tileWidth * endTileX));
								game.tiles[index].xDiff = game.tiles[index].xDiff - remainder;
							} else { game.tiles[index].xDiff = game.tiles[index].xDiff + xChange } // (A KNIGHT'S LONG SIDE IS ALREADY DOUBLED ABOVE)
						} else if (game.tiles[index].xSlideTo < game.tiles[index].x && w == 0) { // X: Less
							endTileX = game.tiles[index].x - game.tiles[index].xSlideTo;
							if (Math.floor((game.tiles[index].x * game.tileWidth) + game.tiles[index].xDiff) == Math.floor((game.tiles[index].x * game.tileWidth) - (game.tileWidth * endTileX))) { // ARRIVED
								xBool = true
							} else if (((game.tiles[index].x * game.tileWidth) + (game.tiles[index].xDiff - xChange)) <= ((game.tiles[index].x * game.tileWidth) - (game.tileWidth * endTileX))) { // NEXT STEP GOES PAST: SNAP TO THE SQUARE
								const remainder = (((game.tiles[index].x * game.tileWidth) + game.tiles[index].xDiff) - ((game.tiles[index].x * game.tileWidth) - (game.tileWidth * endTileX)));
								game.tiles[index].xDiff = game.tiles[index].xDiff - remainder;
							} else { game.tiles[index].xDiff = game.tiles[index].xDiff - xChange; }
						} else if (w == 0) { xBool = true } // X: Zero
						// Y (yDiff IS SUBTRACTED, SO GOING DOWN THE SCREEN MAKES IT NEGATIVE)
						if (game.tiles[index].ySlideTo > game.tiles[index].y && w == 0) { // Y: Greater
							endTileY = game.tiles[index].ySlideTo - game.tiles[index].y;
							if (Math.floor((game.tiles[index].y * game.tileHeight) - game.tiles[index].yDiff) == Math.floor((game.tiles[index].y * game.tileHeight) + (game.tileHeight * endTileY))) { // ARRIVED
								yBool = true;
							} else if (((game.tiles[index].y * game.tileHeight) - (game.tiles[index].yDiff - yChange)) >= ((game.tiles[index].y * game.tileHeight) + (game.tileHeight * endTileY))) { // NEXT STEP GOES PAST: SNAP TO THE SQUARE
								const remainder = (((game.tiles[index].y * game.tileHeight) + (game.tileHeight * endTileY)) - ((game.tiles[index].y * game.tileHeight) - game.tiles[index].yDiff));
								game.tiles[index].yDiff = game.tiles[index].yDiff - remainder;
							} else { game.tiles[index].yDiff = game.tiles[index].yDiff - yChange; }
						} else if (game.tiles[index].ySlideTo < game.tiles[index].y && w == 0) { // Y: Less
							endTileY = game.tiles[index].y - game.tiles[index].ySlideTo;
							if (Math.floor((game.tiles[index].y * game.tileHeight) - game.tiles[index].yDiff) == Math.floor((game.tiles[index].y * game.tileHeight) - (game.tileHeight * endTileY))) { // ARRIVED
								yBool = true
							} else if (((game.tiles[index].y * game.tileHeight) - (game.tiles[index].yDiff + yChange)) <= ((game.tiles[index].y * game.tileHeight) - (game.tileHeight * endTileY))) { // NEXT STEP GOES PAST: SNAP TO THE SQUARE
								const remainder = (((game.tiles[index].y * game.tileHeight) - (game.tileHeight * endTileY)) - ((game.tiles[index].y * game.tileHeight) - game.tiles[index].yDiff));
								game.tiles[index].yDiff = game.tiles[index].yDiff - remainder;
							} else { game.tiles[index].yDiff = game.tiles[index].yDiff + yChange; }
						} else if (w == 0) { yBool = true } // Y: Zero


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

							if (xBool && yBool) { completeSlide = true; } // ARRIVED BOTH WAYS

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
										setTimeout(function () { game.currSlide = true; knightPause = false; }, 100) // SO THE TIMEOUT RESTARTS THE ANIMATION
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

			if (inst[i][j]) { // IF CURRENT INDEX OF A TILE EXISTS
				game.tiles[index].originX = j; // THE PIECE'S OWN SQUARE (x, y FOLLOW THE MOUSE WHILE IT'S HELD)
				game.tiles[index].originY = i;
				const pieceType = inst[i][j].type;
				const pieceColor = inst[i][j].color;
				if (!game.currPromotion) { // NO PIECES ON THE BOARD WHILE THE PROMOTION PICKER IS UP
					if (!(game.mousedownTile.xAvailInt == game.tiles[index].x && game.mousedownTile.yAvailInt == game.tiles[index].y)) { // IF A MOUSE DOWN TILE IS ON AVAILABLE MOVE TILE RENDERING OF THE PIECE FALLS ON THE RESPONSIBILITY OF "checkAvailableMoves()"
						let opacity = true
						if (game.tiles[index].isClicked && (game.tiles[index].x == game.tiles[index].originX && game.tiles[index].y == game.tiles[index].originY)) { opacity = false } // IF TILE IS IN ORIGINAL POSITION SET OPACITY TO FALSE
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
						} else if (pieceType.match(/[p]/) && pieceColor) { // CHECKS CURRENT INDEX FOR PAWN
							handlePawnDirection(); // PAWNS ALWAYS FACE THE OTHER SIDE
							if (pieceColor == "w") { drawActivePiece([game.wPawnRefl, game.wPawnShdw, game.wPawnImg], x, y, opacity); game.wPieceCount.pawn++; }
							else if (pieceColor == "b") { drawActivePiece([game.bPawnRefl, game.bPawnShdw, game.bPawnImg], x, y, opacity); game.bPieceCount.pawn++; }
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

	// LANDED: UNTIL THE MOVE COMES BACK & THE BOARD IS REBUILT, THE PIECE IS STILL ON ITS OLD TILE (MOVED BY xDiff / yDiff),
	// SO THE BOARD DRAWS IT IN ITS OLD SQUARE'S TURN & NO SLIDE BOX IS MADE. ITS BOX IS JUST ITSELF (drawPieceBelow NEEDS y2x2)
	let landedTile = null;
	if (!overlapSlideObj) { // currSlide CAN ALREADY BE false HERE (validateMove TURNS IT OFF BEFORE setTiles() IS DONE)
		for (let q = 0; q < game.tiles.length; q++) {
			if (game.tiles[q].square == game.moveObj.from && (!game.tiles[q].isSliding || (game.tiles[q].type == 'n' && game.knightHop == 0)) && (game.tiles[q].xDiff || game.tiles[q].yDiff) && game.tiles[q].type) { landedTile = game.tiles[q]; overlapSlideObj = { y2x2: game.tiles[q] }; break; } // KNIGHTS TOO, FROM THE FRAME THEY'RE BACK ON THE BOARD (drawSlideBox FINDS A LANDED KNIGHT BY moveObj.to)
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
		} else if (game.playerColor == 'w') {
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
		} else if (game.playerColor == 'b') {
			const slideSquare = `${String.fromCharCode(97 + (7 - (slidePos.split("")[0].charCodeAt(0) - 97)))}${9 - Number(slidePos.split("")[1])}`; // slidePos IN BLACK'S SQUARE NAMES (slidePos USES WHITE'S LETTERS)
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
					if (overlapSlideObj.y2x2 && typeof overlapSlideObj.y2x2 == "object") { drawSlideBox(overlapSlideObj.y2x2); drawPieceBelow(slideSquare); }
					if (overlapSlideObj.y3x2 && typeof overlapSlideObj.y3x2 == "string") { drawPieceBelow(overlapSlideObj.y3x2); }
					if (overlapSlideObj.y3x1 && typeof overlapSlideObj.y3x1 == "string") { drawPieceBelow(overlapSlideObj.y3x1); }
					if (overlapSlideObj.y3x2 && typeof overlapSlideObj.y3x2 == "object") { drawSlideBox(overlapSlideObj.y3x2); drawPieceBelow(overlapSlideObj.y3x2.square); }
				}
				if (yPositive && xPositive) { // DOWN TO RIGHT
					if (overlapSlideObj.y2x3 && typeof overlapSlideObj.y2x3 == "object") { drawSlideBox(overlapSlideObj.y2x3); drawPieceBelow(overlapSlideObj.y2x3.square); }
					if (overlapSlideObj.y1x2 && typeof overlapSlideObj.y1x2 == "object") { drawSlideBox(overlapSlideObj.y1x2); drawPieceBelow(overlapSlideObj.y1x2.square); }
					if (overlapSlideObj.y2x2 && typeof overlapSlideObj.y2x2 == "object") { drawSlideBox(overlapSlideObj.y2x2); drawPieceBelow(slideSquare); }
					if (overlapSlideObj.y3x2 && typeof overlapSlideObj.y3x2 == "string") { drawPieceBelow(overlapSlideObj.y3x2); }
					if (overlapSlideObj.y3x3 && typeof overlapSlideObj.y3x3 == "string") { drawPieceBelow(overlapSlideObj.y3x3); }
					if (overlapSlideObj.y3x2 && typeof overlapSlideObj.y3x2 == "object") { drawSlideBox(overlapSlideObj.y3x2); drawPieceBelow(overlapSlideObj.y3x2.square); }
				}
			}
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
function setTakenPieceArr(paramColor) { // DRAW ALL TAKEN PIECES
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
// Check Opponent Move
/* ---------------------------------------------------------------- */
/**
 * @description Checks if opponent made a new move [No AI]. The socket calls this when the friend moved: it gets the game,
 * works out their move from prev_move (a pawn that became another piece was a promotion) & starts its slide.
 * The move is finished by updateOpponentStateSlide() when the slide lands
 */
async function checkOpponentMove() { // PROMOTIONS OF OPPOSING PLAYER THROWS INVALID MOVE
	try {
		game.revert = game.response
		const updatedResponse = await validate(game.GAME_URL, game.GAME_ID, game.PLAYER_ID, false, false, false); // GET THE GAME
		if (updatedResponse.game_board != game.revert.game_board && game.opposingMove) { // THE BOARD CHANGED ON THE OPPONENT'S TURN
			if (chessInst.isGameOver()) { // THIS BOARD WAS ALREADY OVER
				game.menuToggled = true;
				menu.style.display = "flex"
				optResumeBtn.parentElement.style.display = 'none';
				if (game.playerColor == 'w') { resultDisplay.innerText = "White Wins!" }
				else if (game.playerColor == 'b') { resultDisplay.innerText = "Black Wins!" }
				handleRemoteMenuEnter(optRestartBtn);
			}

			validateState.load(updatedResponse.game_board);
			const serverPiece = validateState.get(updatedResponse.prev_move[1]) // PIECE RETURNED FROM THE SERVER GAME BOARD

			validateState.load(game.revert.game_board);
			const clientPiece = validateState.get(updatedResponse.prev_move[0]); // PIECE RETURNED FROM LOCAL/CLIENT GAME BOARD

			if ((serverPiece.color == clientPiece.color) && (serverPiece.type != 'p' && clientPiece.type == 'p')) { // PROMOTION
				game.moveObj = { from: updatedResponse.prev_move[0], to: updatedResponse.prev_move[1], promotion: serverPiece.type }
			} else {
				game.moveObj = { from: updatedResponse.prev_move[0], to: updatedResponse.prev_move[1] }
			}

			validateState.move(game.moveObj); // CHECK IT ON THE SCRATCH BOARD (THROWS IF IT'S NOT LEGAL)
			for (let i = 0; i < game.tiles.length; i++) { // START THE SLIDE (SAME AS THE AI'S IN renderLoop)
				if (game.tiles[i].square == game.moveObj.from) {
					game.slideStart = true;
					game.tiles[i].isSliding = true
					if (game.playerColor == 'w') {
						game.tiles[i].xSlideTo = game.moveObj.to.split("")[0].charCodeAt(0) - 96 - 1;
						game.tiles[i].ySlideTo = 8 - game.moveObj.to.split("")[1];
					} else if (game.playerColor == 'b') {
						game.tiles[i].xSlideTo = 8 - (game.moveObj.to.split("")[0].charCodeAt(0) - 96);
						game.tiles[i].ySlideTo = game.moveObj.to.split("")[1] - 1;
					}
					game.tiles[i].xDiff = 0;
					game.tiles[i].yDiff = 0;
				}
			}
			game.currSlide = true;
			game.refresh = true;
		}
	} catch (err) { console.log(err); }
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
		game.tiles[index].xSlideTo = 0;
		game.tiles[index].ySlideTo = 0;
		if (game.moveObj.promotion) { game.currPromotion = true; game.refresh = true; return; } // OPEN THE PROMOTION 
		
		await validateMove(); // SEND THE MOVE
		game.tiles[index].isSliding = null;
	} catch (err) { console.log(err); game.currSlide = false; return refreshData(game.response); }
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
		moveAudio.load();
		moveAudio.play().catch((err) => { console.log(err) });
		game.revert = { ...game.response }; // GO BACK TO THIS IF THE SERVER SAYS NO (A COPY, THE LISTS BELOW CHANGE response)
		game.opposingMove = true; // LOCK THE BOARD
		chessInst.move(game.moveObj); // LOCAL BOARD FIRST SO IT DRAWS RIGHT AWAY (THROWS IF IT'S NOT LEGAL)
		if (game.playerColor == 'w') { // KEEP THE LOCAL KNIGHT & PIECE LISTS IN STEP UNTIL THE SERVER'S COMES BACK
			for (let n = 0; n < JSON.parse(game.response.w_knight).length; n++) {
				if (game.moveObj.from == JSON.parse(game.response.w_knight)[n].to) {
					let w_knight = JSON.parse(game.response.w_knight)
					w_knight[n].from = game.moveObj.from;
					w_knight[n].to = game.moveObj.to;
					game.response.w_knight = JSON.stringify(w_knight);
					break;
				}
			}
			for (let n = 0; n < JSON.parse(game.response.w_piece).length; n++) { // SAME FOR THE KINGS, QUEENS, BISHOPS & ROOKS
				if (game.moveObj.from == JSON.parse(game.response.w_piece)[n].to) {
					let w_piece = JSON.parse(game.response.w_piece)
					if (game.moveObj.from.split("")[1] != game.moveObj.to.split("")[1]) { w_piece[n].from = game.moveObj.from; } // MOVED UP OR DOWN (SIDEWAYS KEEPS ITS from)
					w_piece[n].to = game.moveObj.to;
					game.response.w_piece = JSON.stringify(w_piece);
					break;
				}
			}
			// !NOTE: THE OLD ROOK SQUARE STAYS UNTIL THE SERVER'S LIST COMES BACK. THE MOVE LANDS HALFWAY THROUGH DRAWING A FRAME
			// & THE REST OF THAT FRAME STILL DRAWS THE OLD BOARD, SO THE ROOK WOULD DISAPPEAR FOR A FRAME IF ITS SQUARE WAS GONE
			if (chessInst.get(game.moveObj.to).type == 'k' && game.moveObj.from == 'e1' && (game.moveObj.to == 'g1' || game.moveObj.to == 'c1')) { // CASTLING: THE ROOK MOVES SIDEWAYS TOO, ITS NEW SQUARE IS ADDED
				for (let n = 0; n < JSON.parse(game.response.w_piece).length; n++) {
					let w_piece = JSON.parse(game.response.w_piece)
					if (game.moveObj.to == 'g1' && w_piece[n].to == 'h1') { w_piece[w_piece.length] = { from: w_piece[n].from, to: 'f1' }; game.response.w_piece = JSON.stringify(w_piece); break; } // KING SIDE
					else if (game.moveObj.to == 'c1' && w_piece[n].to == 'a1') { w_piece[w_piece.length] = { from: w_piece[n].from, to: 'd1' }; game.response.w_piece = JSON.stringify(w_piece); break; } // QUEEN SIDE
				}
			}
			if (game.moveObj.promotion && game.moveObj.promotion != 'n') { // PROMOTED TO A QUEEN, BISHOP OR ROOK: ADDED SO IT DRAWS BEFORE THE SERVER'S LIST COMES BACK
				let w_piece = JSON.parse(game.response.w_piece)
				w_piece[w_piece.length] = { from: game.moveObj.from, to: game.moveObj.to };
				game.response.w_piece = JSON.stringify(w_piece);
			}
		} else if (game.playerColor == 'b') {
			for (let n = 0; n < JSON.parse(game.response.b_knight).length; n++) {
				if (game.moveObj.from == JSON.parse(game.response.b_knight)[n].to) {
					let b_knight = JSON.parse(game.response.b_knight)
					b_knight[n].from = game.moveObj.from;
					b_knight[n].to = game.moveObj.to;
					game.response.b_knight = JSON.stringify(b_knight);
					break;
				}
			}
			for (let n = 0; n < JSON.parse(game.response.b_piece).length; n++) { // SAME FOR THE KINGS, QUEENS, BISHOPS & ROOKS
				if (game.moveObj.from == JSON.parse(game.response.b_piece)[n].to) {
					let b_piece = JSON.parse(game.response.b_piece)
					if (game.moveObj.from.split("")[1] != game.moveObj.to.split("")[1]) { b_piece[n].from = game.moveObj.from; } // MOVED UP OR DOWN (SIDEWAYS KEEPS ITS from)
					b_piece[n].to = game.moveObj.to;
					game.response.b_piece = JSON.stringify(b_piece);
					break;
				}
			}
			if (chessInst.get(game.moveObj.to).type == 'k' && game.moveObj.from == 'e8' && (game.moveObj.to == 'g8' || game.moveObj.to == 'c8')) { // CASTLING: THE ROOK MOVES SIDEWAYS TOO, ITS NEW SQUARE IS ADDED
				for (let n = 0; n < JSON.parse(game.response.b_piece).length; n++) {
					let b_piece = JSON.parse(game.response.b_piece)
					if (game.moveObj.to == 'g8' && b_piece[n].to == 'h8') { b_piece[b_piece.length] = { from: b_piece[n].from, to: 'f8' }; game.response.b_piece = JSON.stringify(b_piece); break; } // KING SIDE
					else if (game.moveObj.to == 'c8' && b_piece[n].to == 'a8') { b_piece[b_piece.length] = { from: b_piece[n].from, to: 'd8' }; game.response.b_piece = JSON.stringify(b_piece); break; } // QUEEN SIDE
				}
			}
			if (game.moveObj.promotion && game.moveObj.promotion != 'n') { // PROMOTED TO A QUEEN, BISHOP OR ROOK: ADDED SO IT DRAWS BEFORE THE SERVER'S LIST COMES BACK
				let b_piece = JSON.parse(game.response.b_piece)
				b_piece[b_piece.length] = { from: game.moveObj.from, to: game.moveObj.to };
				game.response.b_piece = JSON.stringify(b_piece);
			}
		}


		game.response = await validate(game.GAME_URL, game.GAME_ID, game.PLAYER_ID, [game.moveObj.from, game.moveObj.to], game.moveObj.promotion, false); // SEND THE MOVE (PUT), THE SERVER CHECKS & SAVES IT

		chessInst.load(game.response.game_board); // THE SERVER'S BOARD

		if (game.response.status == 200) {
			game.currSlide = false;
			if (game.response.state == "CLOSED") { showGameOver(game.response); return; } // CHECKMATE OR DRAW

			if (game.ai) {
				game.tiles = await setTiles();
				game.refresh = true;
				setTimeout(function () { game.aiTurn = true; game.refresh = true; }, 500); // THE AI MOVES HALF A SECOND LATER (renderLoop)
				return;
			}
			else { return refreshData(game.response); } // FRIEND GAME: THE SOCKET SAYS WHEN THEY MOVE

		} else { game.opposingMove = false; return refreshData(game.revert); } // TURNED DOWN: BACK TO THE OLD BOARD
	} catch (err) { console.log(err); game.opposingMove = false; game.mousedownTile = false; game.clickedTile = false; return refreshData(game.revert); }
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
		moveAudio.load();
		moveAudio.play().catch((err) => { console.log(err) });
		game.tiles[index].xSlideTo = 0;
		game.tiles[index].ySlideTo = 0;
		chessInst.move(game.moveObj); // LOCAL BOARD

		if (game.opponentColor == 'w') { // KEEP THE LOCAL KNIGHT & PIECE LISTS IN STEP
			for (let n = 0; n < JSON.parse(game.response.w_knight).length; n++) {
				if (game.moveObj.from == JSON.parse(game.response.w_knight)[n].to) {
					let w_knight = JSON.parse(game.response.w_knight)
					w_knight[n].from = game.moveObj.from;
					w_knight[n].to = game.moveObj.to;
					game.response.w_knight = JSON.stringify(w_knight);
				}
			}
			for (let n = 0; n < JSON.parse(game.response.w_piece).length; n++) { // SAME FOR THE KINGS, QUEENS, BISHOPS & ROOKS
				if (game.moveObj.from == JSON.parse(game.response.w_piece)[n].to) {
					let w_piece = JSON.parse(game.response.w_piece)
					if (game.moveObj.from.split("")[1] != game.moveObj.to.split("")[1]) { w_piece[n].from = game.moveObj.from; } // MOVED UP OR DOWN (SIDEWAYS KEEPS ITS from)
					w_piece[n].to = game.moveObj.to;
					game.response.w_piece = JSON.stringify(w_piece);
				}
			}
			// !NOTE: THE OLD ROOK SQUARE STAYS UNTIL THE SERVER'S LIST COMES BACK. THE MOVE LANDS HALFWAY THROUGH DRAWING A FRAME
			// & THE REST OF THAT FRAME STILL DRAWS THE OLD BOARD, SO THE ROOK WOULD DISAPPEAR FOR A FRAME IF ITS SQUARE WAS GONE
			if (chessInst.get(game.moveObj.to).type == 'k' && game.moveObj.from == 'e1' && (game.moveObj.to == 'g1' || game.moveObj.to == 'c1')) { // CASTLING: THE ROOK MOVES SIDEWAYS TOO, ITS NEW SQUARE IS ADDED
				for (let n = 0; n < JSON.parse(game.response.w_piece).length; n++) {
					let w_piece = JSON.parse(game.response.w_piece)
					if (game.moveObj.to == 'g1' && w_piece[n].to == 'h1') { w_piece[w_piece.length] = { from: w_piece[n].from, to: 'f1' }; game.response.w_piece = JSON.stringify(w_piece); break; } // KING SIDE
					else if (game.moveObj.to == 'c1' && w_piece[n].to == 'a1') { w_piece[w_piece.length] = { from: w_piece[n].from, to: 'd1' }; game.response.w_piece = JSON.stringify(w_piece); break; } // QUEEN SIDE
				}
			}
			if (game.moveObj.promotion && game.moveObj.promotion != 'n') { // PROMOTED TO A QUEEN, BISHOP OR ROOK: ADDED SO IT DRAWS BEFORE THE SERVER'S LIST COMES BACK
				let w_piece = JSON.parse(game.response.w_piece)
				w_piece[w_piece.length] = { from: game.moveObj.from, to: game.moveObj.to };
				game.response.w_piece = JSON.stringify(w_piece);
			}
		} else if (game.opponentColor == 'b') {
			for (let n = 0; n < JSON.parse(game.response.b_knight).length; n++) {
				if (game.moveObj.from == JSON.parse(game.response.b_knight)[n].to) {
					let b_knight = JSON.parse(game.response.b_knight)
					b_knight[n].from = game.moveObj.from;
					b_knight[n].to = game.moveObj.to;
					game.response.b_knight = JSON.stringify(b_knight);
				}
			}
			for (let n = 0; n < JSON.parse(game.response.b_piece).length; n++) { // SAME FOR THE KINGS, QUEENS, BISHOPS & ROOKS
				if (game.moveObj.from == JSON.parse(game.response.b_piece)[n].to) {
					let b_piece = JSON.parse(game.response.b_piece)
					if (game.moveObj.from.split("")[1] != game.moveObj.to.split("")[1]) { b_piece[n].from = game.moveObj.from; } // MOVED UP OR DOWN (SIDEWAYS KEEPS ITS from)
					b_piece[n].to = game.moveObj.to;
					game.response.b_piece = JSON.stringify(b_piece);
				}
			}
			if (chessInst.get(game.moveObj.to).type == 'k' && game.moveObj.from == 'e8' && (game.moveObj.to == 'g8' || game.moveObj.to == 'c8')) { // CASTLING: THE ROOK MOVES SIDEWAYS TOO, ITS NEW SQUARE IS ADDED
				for (let n = 0; n < JSON.parse(game.response.b_piece).length; n++) {
					let b_piece = JSON.parse(game.response.b_piece)
					if (game.moveObj.to == 'g8' && b_piece[n].to == 'h8') { b_piece[b_piece.length] = { from: b_piece[n].from, to: 'f8' }; game.response.b_piece = JSON.stringify(b_piece); break; } // KING SIDE
					else if (game.moveObj.to == 'c8' && b_piece[n].to == 'a8') { b_piece[b_piece.length] = { from: b_piece[n].from, to: 'd8' }; game.response.b_piece = JSON.stringify(b_piece); break; } // QUEEN SIDE
				}
			}
			if (game.moveObj.promotion && game.moveObj.promotion != 'n') { // PROMOTED TO A QUEEN, BISHOP OR ROOK: ADDED SO IT DRAWS BEFORE THE SERVER'S LIST COMES BACK
				let b_piece = JSON.parse(game.response.b_piece)
				b_piece[b_piece.length] = { from: game.moveObj.from, to: game.moveObj.to };
				game.response.b_piece = JSON.stringify(b_piece);
			}
		}

		game.revert = game.response;
		if (game.ai) { game.response = await new Promise((resolve) => setTimeout(() => resolve(game.moveObj.response))); } // ALREADY SAVED BY THE SERVER (NO PUT), WAITS LIKE THE OLD PUT SO THE FRAME FINISHES DRAWING BEFORE refreshData() RESETS THE TILES
		else { game.response = await validate(game.GAME_URL, game.GAME_ID, game.PLAYER_ID, false, false, false); }
		chessInst.load(game.response.game_board); // UPDATE BOARD
		if (game.response.status == 200) { // IF VALIDATED UPDATE BOARD STATE
			game.currSlide = false;

			game.tiles[index].isSliding = null;
			game.tiles[index].xDiff = 0;
			game.tiles[index].yDiff = 0;
			game.tiles[index].x = game.tiles[index].xSlideTo;
			game.tiles[index].y = game.tiles[index].ySlideTo;

			game.opposingMove = false;
			refreshData(game.response);
			if (game.response.state == "CLOSED") { showGameOver(game.response); } // CHECKMATE OR DRAW
		} else { game.opposingMove = true; return refreshData(game.revert); } // IF VALIDATION FAILS REVERT BACK TO PREVIOUS BOARD
	} catch (err) { game.currSlide = false; console.log(err); return refreshData(game.response); }
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
		game.tiles = setTiles(); // NEW TILE ARRAY, THE OLD ONE IS DROPPED
		game.clickedTile = false;
		game.mousedownTile = false;
		game.currPromotion = false;
		game.currSlide = false;
		game.slideStart = false;
		game.refresh = true;
		game.availableMovesData = { piece: null, square: null }
		game.menuToggled = false;
		
		return response;
	} catch (err) { console.log(err); game.tiles = setTiles(); game.refresh = true; return response; }
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
// Handle Knight Hop
/* ---------------------------------------------------------------- */
/**
 * @description Check how far the sliding knight has gone to determine how high it is. Sets knightHop on an arc,
 * 0 as it leaves its square, 1 halfway (half a square up) & back to 0 as it lands, so it doesn't pop up or drop.
 * Its shadow & reflection use it too (they slide out from under it as it rises)
 * @param  {[object]} tile [the knight's tile]
 */
function handleKnightHop(tile) {
	let xMoved = 0; // HOW FAR ACROSS IT'S GONE (0 - 1)
	let yMoved = 0; // HOW FAR UP OR DOWN IT'S GONE (0 - 1)
	if (tile.isSliding) {
		if (tile.xSlideTo != tile.x) { xMoved = Math.abs(tile.xDiff) / (Math.abs(tile.xSlideTo - tile.x) * game.tileWidth); }
		if (tile.ySlideTo != tile.y) { yMoved = Math.abs(tile.yDiff) / (Math.abs(tile.ySlideTo - tile.y) * game.tileHeight); }
		game.knightHop = Math.sin(Math.min(Math.max(xMoved, yMoved), 1) * Math.PI); // 0 AT THE START & END, 1 HALFWAY
		if (game.knightHop < 0.001) { game.knightHop = 0; } // BACK ON THE BOARD (sin(PI) ISN'T EXACTLY 0)
	} else { game.knightHop = 0; } // ON THE BOARD
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
function handlePieceDirectionB(yFrom, yTo) {
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
function handlePawnDirection() {
	if (game.playerColor == 'w') { // WHITE PAWNS FACE BLACK'S SIDE (THE TOP OF THE BOARD), BLACK PAWNS FACE THE PLAYER
		game.wPawnImg = wBackPawnImg; game.wPawnShdw = wBackPawnShdw; game.wPawnRefl = wBackPawnRefl;
		game.bPawnImg = bFrontPawnImg; game.bPawnShdw = bFrontPawnShdw; game.bPawnRefl = bFrontPawnRefl;
	} else if (game.playerColor == 'b') { // FLIPPED BOARD: BLACK PAWNS FACE WHITE'S SIDE (THE TOP), WHITE PAWNS FACE THE PLAYER
		game.wPawnImg = wFrontPawnImg; game.wPawnShdw = wFrontPawnShdw; game.wPawnRefl = wFrontPawnRefl;
		game.bPawnImg = bBackPawnImg; game.bPawnShdw = bBackPawnShdw; game.bPawnRefl = bBackPawnRefl;
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
 * becomes the selected (highlighted) menu button & the menu button goes back to its normal color
 * @param  {[object]} btn [menu button element]
 */
function handleRemoteMenuEnter(btn) {
	if (game.TV_BOOL) { optBtn.style.transition = "ease-out 375ms"; optBtn.style.color = "burlywood"; }
	if (game.TV_BOOL || OVERRIDE_TV) { remoteNavBox.menuHover = false; remoteNavBox.menuBtn = btn; remoteNavBox.menuBtn.style.transition = "ease-in 375ms"; remoteNavBox.menuBtn.style.backgroundColor = "burlywood" }
}


/* ################################################################ */
/* ################################################################ */
// EVENT LISTENERS
/* ################################################################ */
/* ################################################################ */
// THE addEventListener LINES ARE AT THE END OF startGame(), THE RESIZE HANDLER IS handleWindowResize (gameplay/layout/index.js)

/* ---------------------------------------------------------------- */
// Handle Keydown
/* ---------------------------------------------------------------- */
/**
 * @description Handles Keydown events. TV remote: the arrows move the select box (remoteNavBox) around the board, right
 * from the last column moves it onto the menu button & up / down move between menu buttons. Enter clicks the square
 * (handleCanvasClick), opens the menu or presses the selected menu button
 */
async function handleKeyPress(e) {
	e.preventDefault();
	e.stopPropagation();
	if (!e?.repeat && e?.keyCode) { // HOLDING A KEY DOESN'T REPEAT
		/**
		 * @description Hovers the player's piece under the select box (the remote's version of handleMouseMove)
		 */
		function checkBoxOverPiece() {
			for (let i = 0; i < game.tiles.length; i++) {
				let tile = game.tiles[i];
				tile.isHovering = false;
				tile.isHovering = (!tile.isSliding) && (remoteNavBox.x == tile.originX && remoteNavBox.y == tile.originY) && ((tile.color == game.playerColor || !tile.color)) && (!game.opposingMove && !game.menuToggled)
			}
		}

		if (e.keyCode == 37) { // LEFT
			if (remoteNavBox.x > 0 && !game.menuToggled) {
				if (remoteNavBox.menuHover) {
					if (game.TV_BOOL) { optBtn.style.transition = "ease-out 375ms"; optBtn.style.color = "burlywood"; }
					remoteNavBox.menuHover = false;
				} else {
					remoteNavBox.x -= 1;
				}
				game.refresh = true;
			}
			else { game.refresh = true; }
			checkBoxOverPiece();
		}

		if (e.keyCode == 39) { // RIGHT
			if (remoteNavBox.x < 7 && !game.menuToggled) {
				remoteNavBox.x += 1;
				game.refresh = true;
			}
			else if (remoteNavBox.x == 7 && !game.menuToggled) { // PAST THE LAST COLUMN: SELECT THE MENU BUTTON
				remoteNavBox.y = 0;
				remoteNavBox.menuHover = true;
				if (game.TV_BOOL) { optBtn.style.transition = "ease-in 375ms"; optBtn.style.color = "white"; }
			}

			else { game.refresh = true; }
			checkBoxOverPiece();
		}

		if (e.keyCode == 38) { // UP
			if (remoteNavBox.y > 0 && (!remoteNavBox.menuHover && !game.menuToggled)) { remoteNavBox.y -= 1; game.refresh = true; }
			else if (game.menuToggled) {
				if (remoteNavBox.menuBtn == optExitBtn) { handleRemoteNavBtnHover(optHomepageBtn) } // 4 -> 3
				else if (remoteNavBox.menuBtn == optHomepageBtn) { handleRemoteNavBtnHover(optRestartBtn) } // 3 -> 2
				else if (remoteNavBox.menuBtn == optRestartBtn) { handleRemoteNavBtnHover(optResumeBtn) } // 2 -> 1			
			}
			else { game.refresh = true; }
			checkBoxOverPiece();
		}
		if (e.keyCode == 40) { // DOWN
			if (remoteNavBox.y < 7 && (!remoteNavBox.menuHover && !game.menuToggled)) { remoteNavBox.y += 1; game.refresh = true; }
			else if (game.menuToggled) {
				if (remoteNavBox.menuBtn == optResumeBtn) { handleRemoteNavBtnHover(optRestartBtn) } // 1 -> 2
				else if (remoteNavBox.menuBtn == optRestartBtn) { handleRemoteNavBtnHover(optHomepageBtn) } // 2 -> 3
				else if (remoteNavBox.menuBtn == optHomepageBtn) { handleRemoteNavBtnHover(optExitBtn) } // 3 -> 4
			}
			else { game.refresh = true; }
			checkBoxOverPiece();
		}
		if (e.keyCode == 13) { // ENTER
			if (!remoteNavBox.menuHover && !game.menuToggled) { checkBoxOverPiece(); handleCanvasClick(e); } // CLICK THE SELECTED SQUARE
			else if (remoteNavBox.menuHover && !game.menuToggled) { handleMenuBtn(e); handleRemoteMenuEnter(optResumeBtn); } // OPEN THE MENU ON RESUME
			else if (game.menuToggled && remoteNavBox.menuBtn) { // PRESS THE SELECTED MENU BUTTON, THEN THE SELECT BOX GOES BACK TO THE TOP RIGHT
				remoteNavBox.menuBtn.style.backgroundColor = "#CD853F"
				if (remoteNavBox.menuBtn == optResumeBtn) { handleResume(e); }
				else if (remoteNavBox.menuBtn == optRestartBtn) { handleRestart(e); }
				else if (remoteNavBox.menuBtn == optHomepageBtn) { handleHomepage(e) }
				else if (remoteNavBox.menuBtn == optExitBtn) { handleExit(e) }
				remoteNavBox = { x: 7, y: 0, menuHover: false, menuBtn: false }
			}
		}
		game.refresh = true
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
async function handleCanvasClick(e) {
	e.preventDefault();
	e.stopPropagation();
	const point = getCanvasPoint(e);
	game.tileX = Math.floor((point.x - game.xBoardOff) / game.tileWidth); // SCREEN COLUMN CLICKED
	game.tileY = Math.floor((point.y - game.yBoardOff) / game.tileHeight); // SCREEN ROW CLICKED

	if (e.clientX === undefined && remoteNavBox) { // KEYBOARD (TV REMOTE) ENTER HAS NO POINTER POSITION
		game.tileX = remoteNavBox.x; game.tileY = remoteNavBox.y;
	}

	if (game.currPromotion) { // IF PROMOTION IS TRUE LOOK FOR USER TO CLICK ON TAKEN PIECES TO UPDATE BOARD
		game.revert = game.response;
		let takenPieces // THE PICKER (drawScreen PUTS IT IN THIS LIST WHILE PROMOTING)
		if (game.playerColor == 'w') { takenPieces = game.bTakenPieces }
		else if (game.playerColor == 'b') { takenPieces = game.wTakenPieces }
		for (let i = 0; i < takenPieces.length; i++) {
			let takenPiece = takenPieces[i];
			if (((takenPiece.x === game.tileX && takenPiece.y === game.tileY && (takenPiece.color == game.playerColor || !takenPiece.color))) && takenPiece.type && takenPiece.color == game.playerColor) { // CLICKED THIS PIECE IN THE PICKER
				const promotion = takenPiece.type;
				try { // TEST MOVE CLIENT SIDE TO JUSTIFY SERVER CALL
					game.moveObj.promotion = promotion;
					game.currPromotion = false;
					await validateMove();
				} catch (err) { console.log(err); game.opposingMove = false; return refreshData(game.revert); }
			}
		}
	} else if (!game.currSlide) {
		game.revert = game.response;
		for (let i = 0; i < game.tiles.length; i++) {
			let tile = game.tiles[i];
			if (tile.isHovering && tile.type && tile.color == game.playerColor) { // DRAG AND DROP && IF HOVER IS TRUE
				if (tile.isClicked && game.tileX == tile.originX && game.tileY == tile.originY) { // IF TILE IS CLICKED AND SET BACK IN ORIGINAL POSITION
					tile.isClicked = false;
					game.clickedTile = false;
					game.mousedownTile = false;
					game.refresh = true;
					return;
				}

				if (tile.isClicked && tile.color == game.playerColor && (game.tileX != tile.originX || game.tileY != tile.originY)) { // IF PIECE IS CLICKED AND SET IN A NEW POSITION
					try { // TEST MOVE CLIENT SIDE TO JUSTIFY SERVER CALL
						game.moveObj = playerMove(game.playerColor, tile); // { from, to } FROM WHERE IT WAS DROPPED
						if (game.moveObj.promotion) { game.currPromotion = true; game.refresh = true; return; } // PAWN ON THE LAST RANK: OPEN THE PICKER
						tile.isClicked = false;
						game.clickedTile = false;
						game.mousedownTile = false;
						game.opposingMove = true;
						game.refresh = true;
						return await validateMove(); // DROPPED, SO NO SLIDE: SEND IT NOW
					} catch (err) {
						console.log(err);
						game.opposingMove = false;
						return refreshData(game.revert);
					}
				}

				tile.isClicked = true; // PICK IT UP
				game.clickedTile = tile;
				game.refresh = true;
			} else if (!tile.isHovering && (tile.isClicked && tile.color == game.playerColor && (game.tileX != tile.originX || game.tileY != tile.originY))) { // CLICK PIECE WHILE MAINTAINING POSITION
				try {
					for (let z = 0; z < game.tiles.length; z++) { game.tiles[z].isClicked = false; game.clickedTile = false; }
					for (let j = 0; j < game.tiles.length; j++) { // CLICKED ANOTHER OF THE PLAYER'S PIECES: PICK THAT ONE UP INSTEAD
						if ((game.tiles[j].isHovering && game.tiles[j].x == game.tileX && game.tiles[j].y == game.tileY) && game.tiles[j].color == game.playerColor) {
							game.tiles[j].isClicked = true
							game.clickedTile = game.tiles[j];
							game.refresh = true;
							return;
						}
					}
					tile.x = game.tileX; // CLICKED A SQUARE: SLIDE THE PICKED UP PIECE THERE (THE MOVE IS SENT WHEN IT LANDS)
					tile.y = game.tileY;
					game.moveObj = playerMove(game.playerColor, tile);
					validateState.load(game.response.game_board);
					validateState.move(game.moveObj); // CHECK MOVE WITHOUT UPDATING THE BOARD SO THE DRAWSCREEN FUNCTION CAN OPERATE WITH THE PREVIOUS MOVE WHILE CHECKING IF THE MOVE IS ALLOWED
					game.currSlide = true;
					game.slideStart = true;
					tile.isSliding = true;
					tile.xSlideTo = game.tileX;
					tile.ySlideTo = game.tileY;
					tile.xDiff = 0;
					tile.yDiff = 0;
					for (let j = 0; j < game.tiles.length; j++) { game.tiles[j].isClicked = false; game.tiles[j].isMousedown = false }
					game.clickedTile = false;
					game.mousedownTile = false;
					game.opposingMove = true;
					game.refresh = true;

					return;
				} catch (err) { console.log(err); game.clickedTile = false; game.opposingMove = false; return refreshData(game.revert); }
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
function handleMouseMove(e) {
	e.preventDefault();
	e.stopPropagation();
	// IF PIECE IS CLICK TO BE MOVED MOUSE POSITION
	const point = getCanvasPoint(e);
	game.tileX = Math.floor((point.x - game.xBoardOff) / game.tileWidth); // SCREEN COLUMN (OFF THE BOARD IS BELOW 0 OR ABOVE 7)
	game.tileY = Math.floor((point.y - game.yBoardOff) / game.tileHeight); // SCREEN ROW
	if (!((game.tileX < 0 || game.tileX > 7) && (game.tileY < 0 || game.tileY > 7))) { // MOUSE INSIDE THE BOARD (OR BESIDE IT, WHERE THE TRAYS ARE)
		if (game.currPromotion) { // HOVER THE PICKER
			let takenPieces
			if (game.playerColor == 'w') { takenPieces = game.bTakenPieces }
			else if (game.playerColor == 'b') { takenPieces = game.wTakenPieces }
			for (let i = 0; i < takenPieces.length; i++) {
				let takenPiece = takenPieces[i];
				takenPiece.isHovering = (((takenPiece.x === game.tileX && takenPiece.y === game.tileY && (takenPiece.color == game.playerColor || !takenPiece.color)))) && !game.menuToggled
				if (takenPiece.isHovering || takenPiece.isClicked) { game.refresh = true; offBoardRefresh = true; }
				if (takenPiece.color != game.playerColor && takenPiece.color) { game.refresh = true }
			}
		} else { // HOVER THE PLAYER'S PIECE UNDER THE MOUSE (ONLY ON THEIR TURN, WITH THE MENU CLOSED)
			for (let i = 0; i < game.tiles.length; i++) {
				let tile = game.tiles[i];
				tile.isHovering =
					(!tile.isSliding) &&
					(tile.x === game.tileX && tile.y === game.tileY) &&
					((tile.color == game.playerColor || !tile.color) || tile.isMousedown) &&
					(!game.opposingMove && !game.menuToggled)
				if (tile.isHovering || tile.isClicked) { game.refresh = true; offBoardRefresh = true; }
				if (tile.color != game.playerColor && tile.color) { game.refresh = true }
			}
		}
	}
	if (game.tileX < 0 || game.tileX > 7 || game.tileY < 0 || game.tileY > 7) { // MOUSE OUTSIDE THE BOARD
		if (offBoardRefresh) { game.refresh = true }
	}
}

/* ---------------------------------------------------------------- */
// Mouse Down
/* ---------------------------------------------------------------- */
/**
 * @description Sets positions / tracks user mousedown drag. Starts a drag on the player's hovered piece (the render loop
 * makes it a drag after 3 frames). If another piece was picked up by a click, that one is put down instead
 */
async function handleMouseDown(e) {
	e.preventDefault();
	e.stopPropagation();
	const point = getCanvasPoint(e);
	game.tileX = Math.floor((point.x - game.xBoardOff) / game.tileWidth);
	game.tileY = Math.floor((point.y - game.yBoardOff) / game.tileHeight); // IF HOVER IS TRUE
	for (let i = 0; i < game.tiles.length; i++) {
		let tile = game.tiles[i];
		if ((tile.isHovering && tile.type && tile.color == game.playerColor)) { // GRAB THE HOVERED PIECE
			tile.isMousedown = true;
			game.mousedownTile = tile;
			game.mouseDownCount = 0;
			for (let j = 0; j < game.tiles.length; j++) { // A DIFFERENT PIECE WAS PICKED UP: PUT IT DOWN
				if (game.tiles[j].isClicked && (game.tiles[j].x != game.tileX || game.tiles[j].y != game.tileY) && game.tiles[j].color == game.playerColor) {
					game.tiles[j].isClicked = false
					game.clickedTile = false;
					game.refresh = true;
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
async function handleMouseUp(e) {
	e.preventDefault();
	e.stopPropagation();
	const point = getCanvasPoint(e);
	game.tileX = Math.floor((point.x - game.xBoardOff) / game.tileWidth);
	game.tileY = Math.floor((point.y - game.yBoardOff) / game.tileHeight); // IF HOVER IS TRUE
	for (let i = 0; i < game.tiles.length; i++) {
		let tile = game.tiles[i];
		if (tile.isMousedown && tile.isHovering && tile.type && tile.color == game.playerColor) { // LET GO OF THE HELD PIECE
			tile.isMousedown = false;
			game.mousedownTile = false;
			game.tileX = tile.originX
			game.tileY = tile.originY
			game.refresh = true;
		}
	}
}


/* ---------------------------------------------------------------- */
// Touch (Mobile)
/* ---------------------------------------------------------------- */
/**
 * @description Maps touch input onto the mouse handlers so pieces can be tapped or dragged on mobile browsers
 */

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
		for (let i = 0; i < game.tiles.length; i++) {
			if (game.tiles[i].isMousedown && game.tiles[i].color == game.playerColor) { game.tiles[i].x = game.tileX; game.tiles[i].y = game.tileY; game.tiles[i].isClicked = true; }
		}
		handleMouseMove(point);
	}
	handleMouseUp(point);
	handleCanvasClick(point);
}

function handleTouchCancel() { // THE BROWSER TOOK THE TOUCH (A SYSTEM GESTURE): LET GO WITHOUT A CLICK
	if (!touchState) { return; }
	handleMouseUp(touchState.point);
	touchState = null;
}


/* ---------------------------------------------------------------- */
// Options (Menu) Button
/* ---------------------------------------------------------------- */
/**
 * @description Toggles menu based on menu state. The menu button (3 lines) opens or closes the menu
 */
function handleMenuBtn(e) {
	e.preventDefault();
	e.stopPropagation();
	game.menuToggled = !game.menuToggled;
	game.refresh = false; // THE BOARD STAYS AS IT IS UNDER THE MENU
	if (game.menuToggled) { menu.style.display = "flex" }
	else { menu.style.display = "none" }
}

/* ---------------------------------------------------------------- */
// Resume Button (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description Opens or closes menu based on menu state. Resume is only seen while the menu is open, so it closes it
 */
function handleResume(e) {
	e.preventDefault();
	e.stopPropagation();
	if (game.boardReset) { return; } // THE MENU STAYS OPEN WHILE A NEW BOARD LOADS (THE OLD BOARD UNDER IT IS LOCKED)
	game.menuToggled = !game.menuToggled;
	game.refresh = false;
	if (game.menuToggled) { menu.style.display = "flex" }
	else { menu.style.display = "none" }
}

/* ---------------------------------------------------------------- */
// Restart Button (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description AI games: a game that's still going is forfeited, then a new game starts. The old board stays on screen
 * under the menu & Restart says Loading & fills up while it loads, then the pieces slide home (startRestartSlide).
 * Friend games: the same button is Forfeit, then Rematch once the game is over
 */
async function handleRestart(e) {
	e.preventDefault();
	e.stopPropagation();
	if (game.boardReset) { return; } // ALREADY LOADING A NEW BOARD (A SECOND PRESS, THE TV REMOTE'S ENTER)
	if (!game.ai) { return await handleFriendBtn(); } // FORFEIT / REMATCH
	const fromPieces = getRestartPieces(true); // WHERE THE PIECES ARE NOW, THEY SLIDE HOME FROM HERE
	game.boardReset = true; // STOP DRAWING, THE OLD BOARD STAYS ON SCREEN UNDER THE MENU WHILE THE NEW ONE LOADS
	game.refresh = false;
	optBtn.style.display = "none"
	setRestartLoading(0.15); // "Loading" & THE FILL
	const restartResponse = await restartGame(game.GAME_URL, game.GAME_ID); // FORFEITS IF STILL GOING, THEN A NEW GAME WITH THE SAME START SETTINGS (LEVEL & COLOR)
	if (restartResponse?.status != 200 || !restartResponse?.game_board) { // RESET FAILED, KEEP THE CURRENT GAME (THE MENU STAYS OPEN)
		game.boardReset = false;
		setRestartLoading(false);
		optBtn.style.display = "flex";
		game.refresh = true;
		return;
	}
	setRestartLoading(0.5);
	game.GAME_ID = restartResponse.game_id; // NEW GAME ID (GUESTS KEEP THEIRS)
	if (game.SIGNED_IN) { history.replaceState(null, "", `/play/${game.GAME_ID}`); } // THE URL FOLLOWS THE NEW GAME, BACK DOESN'T RETURN TO THE OLD ONE (GUESTS STAY ON /play)
	await loadNewBoard(fromPieces);
	return
}

/**
 * @description Loads GAME_ID's board in place (restart & rematch), the canvas, listeners & render loop stay the same.
 * The old board stays on screen while it loads, then the menu closes & the pieces slide home (startRestartSlide)
 * @param  {[array]} fromPieces [where the old game's pieces were, getRestartPieces(true)]
 */
async function loadNewBoard(fromPieces) {
	game.gameOver = false;
	game.drawScreen = function () { return }; // DRAW NOTHING UNTIL THE NEW BOARD IS IN (THE OLD ONE STAYS ON THE CANVAS)
	await setInitialData(); // GETS THE NEW BOARD & PLAYER COLOR FROM THE DATABASE
	handleInitialData(); // NEW drawScreen FOR THE (MAYBE NEW) PLAYER COLOR
	setRestartLoading(1); // FULL
	await new Promise(function (resolve) { setTimeout(resolve, 200); }); // THE FILL REACHES THE END
	menu.style.display = "none"
	optResumeBtn.parentElement.style.display = 'flex'; // RESUME COMES BACK (IT'S HIDDEN WHEN A GAME IS OVER)
	resultDisplay.innerText = "Chess"
	await refreshData(game.response); // ALSO SETS menuToggled TO FALSE
	game.opposingMove = true; // LOCKED WHILE THE PIECES SLIDE HOME (drawRestartSlide UNLOCKS IT)
	startRestartSlide(fromPieces);
}

/* ---------------------------------------------------------------- */
// Restart Slide (Restart & Rematch)
/* ---------------------------------------------------------------- */
/**
 * @description Where every piece is on screen in squares (screen column x & row y, like tiles), so the slide still lines up
 * after a resize. Board pieces sit a tenth of a square up like they're drawn, taken pieces are where renderTakenPieces()
 * last drew them (pawns aren't in the trays)
 * @param  {[boolean]} withTrays [true adds the taken pieces (the old game), the new game has none]
 * @return {[array]} pieces [{ type, color, square, x, y }, square is null in a tray]
 */
function getRestartPieces(withTrays) {
	let pieces = [];
	let board = chessInst.board(); // ROW 0 IS RANK 8, COLUMN 0 IS THE a FILE
	if (game.playerColor == 'b') { // FLIPPED BOARD, SAME AS handleInitialData()
		board = board.reverse();
		for (let i = board.length - 1; i >= 0; i--) { board[i] = board[i].reverse(); }
	}
	for (let i = 0; i < board.length; i++) { // ROW
		for (let j = 0; j < board[i].length; j++) { // COLUMN
			if (board[i][j]) { pieces[pieces.length] = { type: board[i][j].type, color: board[i][j].color, square: board[i][j].square, x: j, y: i - 0.1 }; } // RESTING PIECES SIT A TENTH OF A SQUARE UP
		}
	}
	if (withTrays && !game.currPromotion) { // WHILE PROMOTING THE TRAY IS THE PROMOTION PICKER
		const takenPieces = [...(game.wTakenPieces || []), ...(game.bTakenPieces || [])];
		for (let i = 0; i < takenPieces.length; i++) {
			if (takenPieces[i].x !== undefined) { pieces[pieces.length] = { type: takenPieces[i].type, color: takenPieces[i].color, square: null, x: takenPieces[i].x, y: takenPieces[i].y }; } // DRAWN IN A TRAY
		}
	}
	return pieces;
}

/**
 * @description Restart (Rematch in friend games) says Loading & fills up from the left while the new board loads
 * (.loading IN nav.css), like the Home button. false puts the button back
 * @param  {[number]} load [how full, 0 - 1, it only fills up. false = done or failed]
 */
function setRestartLoading(load) {
	if (load === false) { // DONE OR FAILED
		optRestartBtn.classList.remove("loading");
		optRestartBtn.style.removeProperty("--load");
		optRestartBtn.innerHTML = game.ai ? "Restart" : "Forfeit";
		return;
	}
	if (!optRestartBtn.classList.contains("loading")) { // FIRST CALL
		optRestartBtn.innerHTML = "Loading";
		optRestartBtn.classList.add("loading");
		setTimeout(function () { if (game.boardReset) { setRestartLoading(load); } }, 50); // FROM EMPTY (THE FILL IS DRAWN FIRST)
		return;
	}
	if (load > (Number(optRestartBtn.style.getPropertyValue("--load")) || 0)) { optRestartBtn.style.setProperty("--load", load); }
}

/**
 * @description Starts the slide home. Pairs every piece of the new game with a piece of the old one, same color & type,
 * closest pairs first (a bishop stays on its square color). A square with no old piece (a taken pawn, pawns aren't in
 * the trays) fades in, an old piece with no square (a promoted piece) fades out where it is
 * @param  {[array]} fromPieces [the old game, getRestartPieces(true) before it was replaced]
 */
function startRestartSlide(fromPieces) {
	const toPieces = getRestartPieces(false); // THE NEW GAME'S START SQUARES
	let pairs = []; // EVERY OLD & NEW PIECE THAT COULD BE THE SAME PIECE
	for (let t = 0; t < toPieces.length; t++) {
		for (let f = 0; f < fromPieces.length; f++) {
			if (toPieces[t].color != fromPieces[f].color || toPieces[t].type != fromPieces[f].type) { continue; }
			let distance = Math.hypot(toPieces[t].x - fromPieces[f].x, toPieces[t].y - fromPieces[f].y);
			if (toPieces[t].type == 'b' && fromPieces[f].square && chessInst.squareColor(fromPieces[f].square) != chessInst.squareColor(toPieces[t].square)) { distance += 100; } // A BISHOP STAYS ON ITS SQUARE COLOR
			pairs[pairs.length] = { t, f, distance };
		}
	}
	pairs.sort(function (a, b) { return a.distance - b.distance; }); // CLOSEST FIRST
	let pieces = [];
	let toUsed = [];
	let fromUsed = [];
	for (let i = 0; i < pairs.length; i++) {
		if (toUsed[pairs[i].t] || fromUsed[pairs[i].f]) { continue; } // ONE OF THEM IS ALREADY PAIRED
		toUsed[pairs[i].t] = true;
		fromUsed[pairs[i].f] = true;
		pieces[pieces.length] = setSlidePiece(fromPieces[pairs[i].f], toPieces[pairs[i].t], 0);
	}
	for (let t = 0; t < toPieces.length; t++) { if (!toUsed[t]) { pieces[pieces.length] = setSlidePiece(toPieces[t], toPieces[t], 1); } } // FADES IN
	for (let f = 0; f < fromPieces.length; f++) { if (!fromUsed[f]) { pieces[pieces.length] = setSlidePiece(fromPieces[f], fromPieces[f], -1); } } // FADES OUT
	game.restartSlide = { pieces, startTime: Date.now() };
}

/**
 * @description One piece of the slide home & its images, picked once like a move: pawns face the other side, kings,
 * queens, bishops & rooks face up or down the way they go (sideways faces their start way), knights face left or right
 * the way they go (one that stays in its column faces the middle, like the start). The new game's first frame turns
 * them to their start
 * @param  {[object]} from [{ type, color, square, x, y } where it is now]
 * @param  {[object]} to [where it goes, its start square]
 * @param  {[number]} fade [0 = solid, 1 = fades in, -1 = fades out]
 * @return {[object]} { type, xFrom, yFrom, xTo, yTo, fade, imgArr }
 */
function setSlidePiece(from, to, fade) {
	let imgArr; // REFLECTION, SHADOW, PIECE
	const square = to.square || from.square; // A BISHOP'S IMAGE FOLLOWS ITS SQUARE COLOR
	if (to.type == 'p') { // PAWN
		handlePawnDirection();
		if (to.color == 'w') { imgArr = [game.wPawnRefl, game.wPawnShdw, game.wPawnImg]; } else { imgArr = [game.bPawnRefl, game.bPawnShdw, game.bPawnImg]; }
	} else if (to.type == 'n') { // KNIGHT
		const right = to.x > from.x || (to.x == from.x && to.x < 4);
		if (to.color == 'w') { imgArr = right ? [wRightKnightRefl, wRightKnightShdw, wRightKnightImg] : [wLeftKnightRefl, wLeftKnightShdw, wLeftKnightImg]; }
		else { imgArr = right ? [bRightKnightRefl, bRightKnightShdw, bRightKnightImg] : [bLeftKnightRefl, bLeftKnightShdw, bLeftKnightImg]; }
	} else { // KING, QUEEN, BISHOP OR ROOK
		const yFrom = from.y == to.y ? null : from.y; // null: SIDEWAYS (OR STAYING), FACES ITS START WAY
		const yTo = from.y == to.y ? null : to.y;
		const lightSquare = square && chessInst.squareColor(square) == 'light';
		if (to.color == 'w') {
			handlePieceDirectionW(yFrom, yTo);
			if (to.type == 'k') { imgArr = [game.wKingRefl, game.wKingShdw, game.wKingImg]; }
			else if (to.type == 'q') { imgArr = [game.wQueenRefl, game.wQueenShdw, game.wQueenImg]; }
			else if (to.type == 'b') { imgArr = [game.wBishopRefl, game.wBishopShdw, lightSquare ? game.wBishopWhiteSqImg : game.wBishopBlackSqImg]; }
			else if (to.type == 'r') { imgArr = [game.wRookRefl, game.wRookShdw, game.wRookImg]; }
		} else {
			handlePieceDirectionB(yFrom, yTo);
			if (to.type == 'k') { imgArr = [game.bKingRefl, game.bKingShdw, game.bKingImg]; }
			else if (to.type == 'q') { imgArr = [game.bQueenRefl, game.bQueenShdw, game.bQueenImg]; }
			else if (to.type == 'b') { imgArr = [game.bBishopRefl, game.bBishopShdw, lightSquare ? game.bBishopWhiteSqImg : game.bBishopBlackSqImg]; }
			else if (to.type == 'r') { imgArr = [game.bRookRefl, game.bRookShdw, game.bRookImg]; }
		}
	}
	return { type: to.type, xFrom: from.x, yFrom: from.y, xTo: to.x, yTo: to.y, fade, imgArr };
}

/**
 * @description One frame of the slide home, the render loop calls it instead of drawScreen while restartSlide is set.
 * Draws the board, then every piece part of the way home on a slow start & landing, back to front so the lower pieces
 * cover the ones above them. Knights hop like a move, their image is drawn on top while they're in the air (their reflection & shadow
 * stay in order, under the pieces in front of them). When the time is up
 * the new game takes over (its first frame turns the pieces to their start, an AI move slides in after)
 */
function drawRestartSlide() {
	const progress = Math.min((Date.now() - game.restartSlide.startTime) / RESTART_SLIDE_MS, 1); // 0 - 1 OF THE TIME
	if (progress == 1) { // HOME: THE NEW GAME TAKES OVER
		game.restartSlide = null;
		setRestartLoading(false);
		optBtn.style.display = "flex";
		game.opposingMove = chessInst.turn() != game.playerColor; // LOCKED IF THE OPPONENT GOES FIRST
		game.boardReset = false;
		game.drawScreen(); // THE NEW GAME'S FIRST FRAME, IT ALSO PUTS THE SQUARES ON tiles SO AN AI MOVE FINDS ITS PIECE
		game.refresh = true; // AN AI MOVE SLIDES IN NEXT
		return;
	}
	const eased = 0.5 - Math.cos(progress * Math.PI) / 2; // HOW FAR ALONG, SLOW START & LANDING
	let hop = Math.sin(progress * Math.PI); // KNIGHTS: 0 ON THE BOARD, 1 HALFWAY (HALF A SQUARE UP), SAME ARC AS handleKnightHop()
	if (hop < 0.001) { hop = 0; } // BACK ON THE BOARD (sin(PI) ISN'T EXACTLY 0)
	renderBoard();

	let drawPieces = []; // WHERE EACH PIECE IS THIS FRAME
	for (let i = 0; i < game.restartSlide.pieces.length; i++) {
		const piece = game.restartSlide.pieces[i];
		const moving = piece.xFrom != piece.xTo || piece.yFrom != piece.yTo;
		drawPieces[i] = {
			imgArr: piece.imgArr,
			x: piece.xFrom + (piece.xTo - piece.xFrom) * eased,
			y: piece.yFrom + (piece.yTo - piece.yFrom) * eased,
			hop: (piece.type == 'n' && moving) ? hop : 0,
			alpha: piece.fade == 1 ? progress : piece.fade == -1 ? 1 - progress : 1 // FADES IN, FADES OUT OR SOLID
		};
	}
	drawPieces.sort(function (a, b) { return a.y - b.y; }); // BACK TO FRONT BY WHERE THEY ARE ON THE BOARD (A KNIGHT IN THE AIR BY THE SQUARE UNDER IT)

	for (let i = 0; i < drawPieces.length; i++) {
		const piece = drawPieces[i];
		const x = piece.x * game.tileWidth + game.xBoardOff - game.xPieceOffset / 2;
		const y = piece.y * game.tileHeight + game.yBoardOff - game.yPieceOffset / 2;
		ctx.globalAlpha = 0.30 * piece.alpha; // REFLECTION & SHADOW STAY ON THE BOARD, SHIFTED UP TO A FIFTH OF A SQUARE LEFT AS A KNIGHT RISES
		ctx.drawImage(images[piece.imgArr[0]].image, x - (game.tileWidth / 5) * piece.hop, y, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset);
		ctx.globalAlpha = 0.75 * piece.alpha;
		ctx.drawImage(images[piece.imgArr[1]].image, x - (game.tileWidth / 5) * piece.hop, y, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset);
		ctx.globalAlpha = piece.alpha;
		if (piece.hop == 0) { ctx.drawImage(images[piece.imgArr[2]].image, x, y, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset); } // PIECE (A KNIGHT IN THE AIR IS DRAWN BELOW)
	}
	for (let i = 0; i < drawPieces.length; i++) { // KNIGHTS IN THE AIR GO OVER EVERYTHING, UP TO HALF A SQUARE UP (ONLY THE IMAGE, LIKE drawSlideBox, THEIR SHADOWS STAYED IN ORDER ABOVE)
		const piece = drawPieces[i];
		if (piece.hop == 0) { continue; }
		ctx.globalAlpha = piece.alpha;
		ctx.drawImage(images[piece.imgArr[2]].image, piece.x * game.tileWidth + game.xBoardOff - game.xPieceOffset / 2, piece.y * game.tileHeight + game.yBoardOff - game.yPieceOffset / 2 - (game.tileHeight / 2) * piece.hop, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset);
	}
	ctx.globalAlpha = 0.05
	ctx.drawImage(images[tableShdw].image, 0, 0, game.cw, game.ch); // RENDER TABLE SHDW
	ctx.globalAlpha = 1;
}

/* ---------------------------------------------------------------- */
// Forfeit / Rematch Button (Menu, friend games)
/* ---------------------------------------------------------------- */
/**
 * @description Game going: Forfeit -> "Are you sure?" -> forfeits. Game over: Rematch, starts when both players press it within 1 minute
 */
async function handleFriendBtn() {
	if (!game.gameOver) {
		if (!confirmForfeit) { // FIRST PRESS ASKS, THE QUESTION GOES AWAY AFTER 5 SECONDS
			confirmForfeit = true;
			optRestartBtn.innerHTML = "Are you sure?";
			setTimeout(function () { if (confirmForfeit && !game.gameOver) { confirmForfeit = false; optRestartBtn.innerHTML = "Forfeit"; } }, 5000);
			return;
		}
		confirmForfeit = false;
		const forfeitResponse = await forfeitGame(game.GAME_URL, game.GAME_ID);
		if (forfeitResponse?.state == "CLOSED") { return showGameOver(forfeitResponse); }
		optRestartBtn.innerHTML = "Forfeit"; // FORFEIT FAILED, KEEP PLAYING
		return;
	}
	if (rematchWaiting) { return; } // ALREADY ASKED, STILL WAITING
	const rematchResponse = await rematchGame(game.GAME_URL, game.GAME_ID);
	if (rematchResponse?.status == 409) { return optRestartBtn.innerHTML = "Can't rematch"; } // ONE OF YOU IS IN ANOTHER FRIEND GAME
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
	if (game.gameOver) { return; } // ALREADY SHOWN
	game.gameOver = true;
	game.opposingMove = true; // NO MORE MOVES
	game.menuToggled = true;
	menu.style.display = "flex"
	optResumeBtn.parentElement.style.display = 'none';
	if (result?.reason == "forfeit") { resultDisplay.innerText = result.winner == 'w' ? "Black Forfeits" : "White Forfeits" } // THE TITLE ONLY FITS ONE LINE
	else if (result?.winner == 'w') { resultDisplay.innerText = "White Wins!" }
	else if (result?.winner == 'b') { resultDisplay.innerText = "Black Wins!" }
	else { resultDisplay.innerText = "Draw" }
	if (!game.ai) { optRestartBtn.innerHTML = "Rematch"; } // FRIEND GAME
	handleRemoteMenuEnter(optRestartBtn); // TV REMOTE: SELECT RESTART / REMATCH
}

/* ---------------------------------------------------------------- */
// Load Rematch
/* ---------------------------------------------------------------- */
/**
 * @description Both players asked for a rematch: loads the new game in place (the server picked the sides). The old board
 * stays on screen & Rematch says Loading while it loads, then the pieces slide home (to the other side if the sides swapped)
 * @param  {[string]} newGameId [rematch game id, from the request or the socket]
 */
async function loadRematch(newGameId) {
	if (!newGameId || `${newGameId}` == `${game.GAME_ID}`) { return; } // ALREADY LOADED (THE REQUEST & THE SOCKET BOTH SEND IT)
	const fromPieces = getRestartPieces(true); // WHERE THE PIECES ARE NOW, THEY SLIDE HOME FROM HERE
	game.GAME_ID = newGameId;
	history.replaceState(null, "", `/play/${game.GAME_ID}`); // THE URL FOLLOWS THE REMATCH
	clearTimeout(rematchWaiting); // STOP THE 1 MINUTE WAIT
	rematchWaiting = false;
	game.boardReset = true; // STOP DRAWING, THE OLD BOARD STAYS ON SCREEN WHILE THE NEW ONE LOADS
	game.refresh = false;
	optBtn.style.display = "none"
	setRestartLoading(0.5); // "Loading" & THE FILL (THE MENU IS OPEN AFTER A GAME ENDS), "Forfeit" WHEN THE SLIDE IS DONE
	joinGame(game.GAME_ID, game.PLAYER_ID, socketHandlers); // NEW GAME'S ROOM
	await loadNewBoard(fromPieces);
}

/* ---------------------------------------------------------------- */
// Homepage Button (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description Goes to Home (/). Stops the render loop & leaves the friend game's socket room first,
 * the page load clears everything else (listeners, canvas). Home says Loading & fills up like the buttons into a game,
 * then the game stays on screen until Home is drawn & fades into it (home.html, showPage in pages/utils)
 */
function handleHomepage(e) {
	e.preventDefault();
	e.stopPropagation();

	window.clearInterval(game.drawInterval); // STOP THE RENDER LOOP
	leaveGame();
	optHomepageBtn.innerText = "Loading";
	optHomepageBtn.classList.add("loading"); // THE FILL (.loading IN nav.css), ONE PRESS
	setTimeout(function () { optHomepageBtn.style.setProperty("--load", 1); }, 50); // FROM EMPTY (THE FILL IS DRAWN FIRST)
	setTimeout(function () { window.location.href = "/"; }, 250); // HOME ONCE IT'S FULL (server/routes/pageRoutes.js)
}

/* ---------------------------------------------------------------- */
// Exit Button (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description Exits game: a signed in player logs out, a guest logs in (the server's auth routes, server/routes/api/authRoutes.js)
 */
function handleExit(e) {
	e.preventDefault();
	e.stopPropagation();
	window.location.href = game.SIGNED_IN ? "/api/auth/logout" : "/api/auth/login";
}