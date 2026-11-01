/*
 *  index.js  --  chess frontend
 *	Gameplay
 *	Starts a game on the play page: renderCanvas() sets up the canvas & starts the game once its images are in, startGame()
 *	loads it, joins a friend game's socket room, starts the render loop & adds the listeners & renderLoop() draws a frame when
 *	something changed (or asks the server for the AI's move). The rest of the game is in the files next to this one:
 *	state (the shared game object), images & sprites (loading & image numbers), layout (board size), draw (each frame),
 *	animate (knight hop, slide home), input (mouse, touch, TV remote), moves (server moves & the socket's), menu (menu & game over),
 *	status (the message area for refused moves & connection problems).
 *	Moves are checked locally with chess.js, then saved by the chess server (validate/index.js)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, canvas, chessInst, validateState, startFrames, requestFrame, OVERRIDE_TV } = require("./state/index.js"); // THE GAME'S SHARED STATE (game.tiles, game.moveObj, ...), THE CANVAS & THE chess.js BOARDS
const { playAi } = require("./ai/index.js"); // ASKS THE SERVER FOR THE AI'S MOVE
const { imageProgress } = require("./images/index.js"); // HOW MANY OF THE GAME'S IMAGES HAVE LOADED (0 - 1)
const { handleWindowResize } = require("./layout/index.js"); // REDRAWS THE GAME WHEN THE WINDOW IS RESIZED
const { handleInitialData, setTakenPieceArr } = require("./draw/index.js"); // DRAWS EACH FRAME (drawScreen), THE TAKEN PIECE TRAYS
const { drawRestartSlide } = require("./animate/index.js"); // ONE FRAME OF THE PIECES SLIDING HOME AFTER RESTART & REMATCH
const { handleKeyPress, handleCanvasClick, handleMouseMove, handleMouseDown, handleMouseUp, handleTouchStart, handleTouchMove, handleTouchEnd, handleTouchCancel } = require("./input/index.js"); // MOUSE, TOUCH & TV REMOTE HANDLERS (ADDED IN startGame)
const { setInitialData } = require("./moves/index.js"); // LOADS THE GAME FROM THE SERVER
const { handleMenuBtn, handleResume, handleClickAway, handleSound, loadSound, handleRestart, handleHomepage, handleExit, socketHandlers } = require("./menu/index.js"); // MENU BUTTON HANDLERS (ADDED IN startGame), THE FRIEND GAME SOCKET'S HANDLERS
const { joinGame } = require("../socket/index.js"); // FRIEND GAMES: THE SERVER PUSHES MOVES, FORFEITS & REMATCHES
const { showStatus, clearStatus } = require("./status/index.js"); // THE MESSAGE AREA ON THE PLAY PAGE
const main = document.querySelector("#main"); // THE CANVAS IS ADDED HERE
const optBtn = document.getElementById("optBtn"); // MENU BUTTON (3 LINES, TOP RIGHT), OPENS THE MENU
const optResumeBtn = document.getElementById("optResume"); // MENU: RESUME
const optSoundBtn = document.getElementById("optSound"); // MENU: SOUND ON / OFF
const optRestartBtn = document.getElementById("optRestart"); // MENU: RESTART (AI GAMES) / FORFEIT & REMATCH (FRIEND GAMES)
const optHomepageBtn = document.getElementById("optSettings"); // MENU: HOMEPAGE
const optExitBtn = document.getElementById("optExit"); // MENU: EXIT
let aiThinking = false; // TRUE WHILE THE SERVER PICKS THE AI'S MOVE
const AI_RETRY_TIME = 5000; // ASKS FOR THE AI'S MOVE AGAIN AFTER THIS WHEN IT DIDN'T ANSWER (ms)

/* ---------------------------------------------------------------- */
// Render Canvas
/* ---------------------------------------------------------------- */
/**
 * @description Starts a game: adds the canvas to main & starts the game (startGame) once the images are loaded.
 * The rest of the game is in the files next to this one (see the top of this file), the state they share is game (gameplay/state/index.js)
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
	game.moveAudio = new Audio(`${process.env.CHESS_ASSETS_URL}/audio/piece-jump.mp4`); // MOVE SOUND
	loadSound(); // THE PLAYER'S SAVED SOUND ON / OFF

	canvas.style.backgroundRepeat = "repeat-y"; // THE TABLE BEHIND THE BOARD
	canvas.style.backgroundImage = `url("${process.env.CHESS_ASSETS_URL}/images/board/table.webp")`;
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
 * @description Starts the render loop. Loads the game, joins a friend game's socket room, adds the canvas
 * to main, draws with renderLoop() when something changes & adds the event listeners (their handlers are in gameplay/input & gameplay/menu)
 */
async function startGame() {
	game.wTakenPieces = setTakenPieceArr("b");
	game.bTakenPieces = setTakenPieceArr("w");

	game.cw = 0; // SET BY renderBoard()
	game.ch = 0;

	if (await setInitialData() === false) { // COULDN'T LOAD: NO GAME TO DRAW OR PLAY, ONLY ITS MESSAGE (setInitialData) ON THE TABLE
		optBtn.style.display = "none"; // ITS LISTENER IS ADDED BELOW, A RELOAD STARTS AGAIN
		document.documentElement.classList.remove("loadingPage"); // loadingPage HIDES THE MESSAGE (play.html)
		return;
	}
	handleInitialData(); // HANDLES INITIAL DATA
	if (!game.ai && game.response?.status == 200) { // FRIEND GAME
		joinGame(game.GAME_ID, game.PLAYER_ID, socketHandlers); // THE SERVER PUSHES MOVES, FORFEITS & REMATCHES (server/socket.js)
		if (!game.gameOver) { optRestartBtn.innerHTML = "Forfeit"; } // RESTART IS FORFEIT IN FRIEND GAMES
	}

	
	// JUST IN CASE
	canvas.style.backgroundRepeat = "repeat-y"; // THE TABLE BEHIND THE BOARD
	canvas.style.backgroundImage = `url("${process.env.CHESS_ASSETS_URL}/images/board/table.webp")`;
	canvas.style.backgroundSize = "cover";
	canvas.style.backgroundPosition = "center";
	main.append(canvas);
	//

	const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)"); // THE DEVICE'S REDUCE MOTION SETTING
	game.reduceMotion = reduceMotionQuery.matches;
	reduceMotionQuery.addEventListener("change", function (e) { game.reduceMotion = e.matches; }); // CHANGED DURING A GAME: THE NEXT FRAME USES IT

	startFrames(renderLoop); // THE RENDER LOOP, FRAMES ONLY COME WHILE SOMETHING CHANGES & THE TAB IS SHOWN
	document.addEventListener("visibilitychange", function () { if (!document.hidden) { game.refresh = true; } }); // SHOWN AGAIN: A SLIDE CATCHES UP TO THE TIME (stepSlide), REDRAWS A CANVAS THE BROWSER MAY HAVE THROWN AWAY

	// EVENT LISTENERS (THE BOARD'S HANDLERS ARE IN gameplay/input/index.js, handleWindowResize IN gameplay/layout/index.js, THE MENU'S IN gameplay/menu/index.js)
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
	if (!game.TV_BOOL || OVERRIDE_TV) { document.addEventListener("click", handleClickAway); } // THE REST OF THE PAGE CLOSES THE MENU (THE BOARD: handleCanvasClick)
	if (!game.TV_BOOL || OVERRIDE_TV) { optSoundBtn.addEventListener("click", handleSound); }
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
 * @description Asks the server for the AI's move & starts its slide. No frames are drawn while the server picks the move
 */
async function startAiSlide() {
	aiThinking = true;
	try {
		game.revert = game.response; // GO BACK TO THIS IF THE AI MOVE FAILS
		game.moveObj = await playAi(game.GAME_URL, game.GAME_ID); // THE SERVER PICKS & SAVES THE AI MOVE

		validateState.load(game.response.game_board); // CHECK THE MOVE ON THE SCRATCH BOARD (THROWS IF IT'S NOT LEGAL)
		validateState.move(game.moveObj);
		clearStatus("ai");
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
				game.tiles[i].slideStartTime = null; // ITS CLOCK STARTS ON ITS FIRST FRAME (stepSlide)
			} else if (game.tiles[i].isSliding) { // STOP ANY OTHER SLIDE
				game.tiles[i].isSliding = false;
				game.tiles[i].xDiff = 0;
				game.tiles[i].yDiff = 0;
			}
		}
		game.aiTurn = false;
		game.currSlide = true;
	} catch (err) {
		console.log(err);
		game.aiTurn = false; // playAi ALREADY TRIED AGAIN: WAITS BEFORE ASKING AGAIN, NOT A NEW REQUEST EVERY FRAME
		showStatus("ai", "The AI isn't answering. Trying again…");
		setTimeout(function () {
			if (game.ai && !game.gameOver && chessInst.turn() != game.playerColor) { game.aiTurn = true; game.refresh = true; } // STILL ITS TURN (NOT RESTARTED SINCE)
		}, AI_RETRY_TIME);
	} finally { aiThinking = false; }
}

/**
 * @description Runs for each frame the browser gives it (requestFrame). On the AI's turn it asks the server for the AI's move
 * & starts its slide, otherwise it draws a frame when something changed (refresh) or a piece is sliding (currSlide).
 * Asks for the next frame only while there's more to draw, setting refresh, currSlide or restartSlide starts it again
 */
async function renderLoop() {
	if (aiThinking) { return; } // startAiSlide ASKS FOR THE NEXT FRAME BELOW WHEN IT'S DONE
	try {
		if (game.restartSlide) { // RESTART & REMATCH: THE PIECES SLIDE HOME
			drawRestartSlide();
		} else if ((game.refresh || game.currSlide) && !game.boardReset) {
			if (game.ai && chessInst.turn() != game.playerColor && game.aiTurn) { // IF AI
				await startAiSlide();
			} else {
				game.drawScreen(); // DRAW ONE FRAME
				document.documentElement.classList.remove("loadingPage"); // THE FIRST FRAME IS DRAWN: FADE INTO THE GAME (play.html), DOES NOTHING AFTER THAT
				game.refresh = false;
			}
		}
	} catch (err) { console.log(err); }
	if (game.restartSlide || ((game.refresh || game.currSlide) && !game.boardReset)) { requestFrame(); }
}
