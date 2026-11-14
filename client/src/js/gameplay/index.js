/*
 *  index.js  --  chess frontend
 *	Gameplay
 *	Starts a game on the play page: renderCanvas() sets up the canvas & starts the game once its images are in, startGame()
 *	loads it, joins a friend game's socket room, starts the render loop & adds the listeners & renderLoop() draws a frame when
 *	something changed (or asks the server for the AI's move). The rest of the game is in the files next to this one:
 *	state (the shared game object), images & sprites (loading & image numbers), layout (board size), draw (each frame),
 *	animate (knight hop, slide home), input (mouse, touch, remote-only mode), moves (server moves & the socket's), menu (menu & game over),
 *	status (the message area for refused moves & connection problems), movelist (the panel of the game's moves), movebox (typed moves),
 *	analysis (the hint & the evaluation bar), monitor (the 3D room's monitor: its data, actions & what it hides).
 *	Moves are checked locally with chess.js, then saved by the chess server (validate/index.js)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, canvas, chessInst, validateState, startFrames, requestFrame, OVERRIDE_REMOTE_ONLY } = require("./state/index.js"); // THE GAME'S SHARED STATE (game.tiles, game.moveObj, ...), THE CANVAS & THE chess.js BOARDS
const { playAi } = require("./ai/index.js"); // ASKS THE SERVER FOR THE AI'S MOVE
const { momentFor, faceFor } = require("./bots/index.js"); // WHAT THE AI'S BOT SAYS ABOUT ITS MOVE (#76) & THE FACE THE 3D ROOM'S MONITOR MAKES AT IT
const { sayLine } = require("./bots/say.js"); // & SAYS IT BESIDE THE BOARD
const { imageProgress } = require("./images/index.js"); // HOW MANY OF THE GAME'S IMAGES HAVE LOADED (0 - 1)
const { handleWindowResize } = require("./layout/index.js"); // REDRAWS THE GAME WHEN THE WINDOW IS RESIZED
const { handleInitialData, setTakenPieceArr } = require("./draw/index.js"); // DRAWS EACH FRAME (drawScreen), THE TAKEN PIECE TRAYS
const { drawRestartSlide } = require("./animate/index.js"); // ONE FRAME OF THE PIECES SLIDING HOME AFTER RESTART & REMATCH
const { handleKeyPress, handleCanvasClick, handleMouseMove, handleMouseDown, handleMouseUp, handleTouchStart, handleTouchMove, handleTouchEnd, handleTouchCancel } = require("./input/index.js"); // MOUSE, TOUCH & REMOTE-ONLY MODE HANDLERS (ADDED IN startGame)
const { setInitialData, loadReadOnly, startSlide } = require("./moves/index.js"); // LOADS THE GAME FROM THE SERVER (TO PLAY, OR READ-ONLY)
const { listenersFor } = require("./input/modes.js"); // WHICH LISTENERS GO ON: THE MOUSE, REMOTE-ONLY MODE OR THE READ-ONLY BOARD
const { addMenuListeners, handleResume, handleSound, loadSound, loadView, showView, handleView, handleResetView, handleFlip, flipWhenDone, handleDownloadPgn, handleHint, handleTakeback, handleDeclineTakeback, handleOfferDraw, handleDeclineDraw, handleRestart, handleCancelRematch, handleLeave, handleExit, socketHandlers, showReadOnlyMenu } = require("./menu/index.js"); // MENU BUTTON HANDLERS (ADDED IN startGame), THE FRIEND GAME SOCKET'S HANDLERS
const { joinGame } = require("../socket/index.js"); // FRIEND GAMES: THE SERVER PUSHES MOVES, FORFEITS & REMATCHES
const { showStatus, clearStatus, MESSAGE_TIME } = require("./status/index.js"); // THE MESSAGE AREA ON THE PLAY PAGE
const { loadMoveList, addMoveListListeners } = require("./movelist/index.js"); // THE MOVE LIST PANEL
const { addMoveBoxListeners } = require("./movebox/index.js"); // THE BOX FOR TYPED MOVES
const { loadEvalBar, handleEvalBar } = require("./analysis/index.js"); // THE EVALUATION BAR
const { startMonitor } = require("./monitor/index.js"); // THE 3D ROOM'S MONITOR: ITS DATA, ACTIONS & HIDE RULES
const { drawBoard, VIEWS, addBoardListener, stopMotion3D, whenDrawn3D, setFace } = require("./renderer/index.js"); // PICKS THE 2D CANVAS OR THE 3D BOARD, THE ONLY PLACE THAT KNOWS WHICH IS ON
export { setView, currentView, VIEWS } from "./renderer/index.js"; // SWITCHES MID-GAME (THE 3D BOARD IS DOWNLOADED THE FIRST TIME, ITS OWN "three" CHUNK)
const main = document.querySelector("#main"); // THE CANVAS IS ADDED HERE
const optBtn = document.getElementById("optBtn"); // MENU BUTTON (3 LINES, TOP RIGHT), OPENS THE MENU
const optResumeBtn = document.getElementById("optResume"); // MENU: RESUME
const optSoundBtn = document.getElementById("optSound"); // MENU: SOUND ON / OFF
const optFlipBtn = document.getElementById("optFlip"); // MENU: FLIP BOARD
const optPgnBtn = document.getElementById("optPgn"); // MENU: DOWNLOAD PGN
const optRestartBtn = document.getElementById("optRestart"); // MENU: FORFEIT, THEN RESTART (AI GAMES) OR REMATCH (FRIEND GAMES)
const optHomepageBtn = document.getElementById("optHome"); // MENU: HOMEPAGE
const optSettingsBtn = document.getElementById("optSettings"); // MENU: SETTINGS
const optExitBtn = document.getElementById("optExit"); // MENU: EXIT
let aiThinking = false; // TRUE WHILE THE SERVER PICKS THE AI'S MOVE
const AI_RETRY_TIME = 5000; // ASKS FOR THE AI'S MOVE AGAIN AFTER THIS WHEN IT DIDN'T ANSWER (ms)

/* ---------------------------------------------------------------- */
// Render Canvas
/* ---------------------------------------------------------------- */
/**
 * @description Starts a game: adds the canvas to main & starts the game (startGame) once the images are loaded.
 * The rest of the game is in the files next to this one (see the top of this file), the state they share is game (gameplay/state/index.js)
 * @param  {[object]} playerData [{ GAME_URL, GAME_ID, PLAYER_ID, REMOTE_ONLY_CONDITIONAL, SIGNED_IN, VIEW, READ_ONLY }, REMOTE_ONLY_CONDITIONAL = REMOTE-ONLY MODE CONTROLS INSTEAD OF THE MOUSE,
 * VIEW = VIEWS.THREE_D TO START ON THE 3D BOARD (LEFT OUT: THE PLAYER'S SAVED VIEW, loadView), READ_ONLY = A BOARD THAT ONLY SHOWS THE GAME (A REPLAY, #100):
 * NO PIECE IS PICKED UP, NO MOVE OR AI REQUEST IS SENT & NO SOCKET IS OPENED
 * @return {[Promise<object|false>]} [the game (game.response) once it's started, false when it couldn't be loaded]
 */
export async function renderCanvas(playerData) {
	game.GAME_URL = playerData.GAME_URL; // SETS CONSTANT GAME VARIABLES
	game.PLAYER_ID = playerData.PLAYER_ID;
	game.REMOTE_ONLY_CONDITIONAL = playerData.REMOTE_ONLY_CONDITIONAL;
	game.SIGNED_IN = playerData.SIGNED_IN; // A SIGNED IN PLAYER (NOT A GUEST): RESTART CHANGES THE URL, EXIT LOGS OUT
	game.GAME_ID = playerData.GAME_ID; // CHANGES WHEN AN AI GAME RESTARTS OR A FRIEND GAME REMATCHES
	game.readOnly = Boolean(playerData.READ_ONLY); // A REPLAY: THE BOARD ONLY SHOWS THE GAME

	optBtn.style.display = "flex"; // SHOW THE MENU BUTTON

	canvas.id = "canvas";

	game.cw = (canvas.width = window.innerWidth); // CANVAS WIDTH (CSS PIXELS)
	game.ch = (canvas.height = window.innerHeight); // CANVAS HEIGHT (CSS PIXELS)
	game.moveAudio = new Audio(`${process.env.CHESS_ASSETS_URL}/audio/piece-jump.mp4`); // MOVE SOUND
	loadSound(); // THE PLAYER'S SAVED SOUND ON / OFF
	loadMoveList(); // THE PLAYER'S SAVED MOVE LIST OPEN / COLLAPSED
	loadEvalBar(); // THE PLAYER'S SAVED EVALUATION BAR ON / OFF

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
	return new Promise(function (resolve) {
		const startGameCheck = setInterval(async function () {
			if (imageProgress() == 1) { // EVERY IMAGE preloadImages() STARTED IS IN (THE PLAY PAGE STARTS THEM BEFORE renderCanvas)
				clearInterval(startGameCheck); // BEFORE THE AWAIT, OR IT WOULD START THE GAME AGAIN EVERY 100MS WHILE IT LOADS
				resolve(await startGame(playerData.VIEW || loadView())); // THE PLAYER'S SAVED VIEW, 3D BY DEFAULT (2D ON A PHONE OR TABLET)
			}
		}, 100);
	});
}

/* ---------------------------------------------------------------- */
// Start Game
/* ---------------------------------------------------------------- */
/**
 * @description Starts the render loop. Loads the game, joins a friend game's socket room, adds the canvas
 * to main, draws with renderLoop() when something changes & adds the event listeners (their handlers are in gameplay/input & gameplay/menu)
 * @param  {[string]} view [VIEWS.THREE_D puts up the 3D board once the game is in, anything else stays on the 2D canvas]
 * @return {[object|false]} [the game (game.response), false when it couldn't be loaded]
 */
async function startGame(view) {
	game.wTakenPieces = setTakenPieceArr("b");
	game.bTakenPieces = setTakenPieceArr("w");

	game.cw = 0; // SET BY renderBoard()
	game.ch = 0;

	const loaded = game.readOnly ? await loadReadOnly() : await setInitialData() !== false;
	if (!loaded) { // COULDN'T LOAD: NO GAME TO DRAW OR PLAY, ONLY ITS MESSAGE (setInitialData) ON THE TABLE
		optBtn.style.display = "none"; // ITS LISTENER IS ADDED BELOW, A RELOAD STARTS AGAIN
		document.documentElement.classList.remove("loadingPage"); // loadingPage HIDES THE MESSAGE (play.html)
		return false;
	}
	handleInitialData(); // HANDLES INITIAL DATA
	if (game.readOnly) { showReadOnlyMenu(game.response); } // THE RESULT & WHAT A BOARD THAT ONLY SHOWS THE GAME OFFERS
	if (!game.readOnly && !game.ai && game.response?.status == 200) { // FRIEND GAME
		joinGame(game.GAME_ID, game.PLAYER_ID, socketHandlers); // THE SERVER PUSHES MOVES, FORFEITS & REMATCHES (server/socket.js)
	}
	if (!game.gameOver && !game.readOnly) { optRestartBtn.innerHTML = "Forfeit"; } // play.html SAYS RESTART, WHAT A GAME THAT'S OVER OFFERS

	
	// JUST IN CASE
	canvas.style.backgroundRepeat = "repeat-y"; // THE TABLE BEHIND THE BOARD
	canvas.style.backgroundImage = `url("${process.env.CHESS_ASSETS_URL}/images/board/table.webp")`;
	canvas.style.backgroundSize = "cover";
	canvas.style.backgroundPosition = "center";
	main.append(canvas);
	//

	const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)"); // THE DEVICE'S REDUCE MOTION SETTING
	game.reduceMotion = reduceMotionQuery.matches;
	reduceMotionQuery.addEventListener("change", function (e) { // CHANGED DURING A GAME: THE NEXT FRAME USES IT
		game.reduceMotion = e.matches;
		if (e.matches) { stopMotion3D(); } // A 3D CAMERA TURN OR PIECE SLIDE ALREADY GOING LANDS AT ONCE (#432)
	});

	if (view === VIEWS.THREE_D) { fadeInOn3D(); } // FALLS BACK TO 2D ITSELF WHEN 3D CAN'T LOAD
	startFrames(renderLoop); // THE RENDER LOOP, FRAMES ONLY COME WHILE SOMETHING CHANGES & THE TAB IS SHOWN
	document.addEventListener("visibilitychange", function () { if (!document.hidden) { game.refresh = true; } }); // SHOWN AGAIN: A SLIDE CATCHES UP TO THE TIME (stepSlide), REDRAWS A CANVAS THE BROWSER MAY HAVE THROWN AWAY

	// EVENT LISTENERS (addBoardListener PUTS THE BOARD'S ON THE 2D CANVAS & THE 3D BOARD, THE BOARD'S HANDLERS ARE IN gameplay/input/index.js, handleWindowResize IN gameplay/layout/index.js, THE MENU'S IN gameplay/menu/index.js)
	const listeners = listenersFor({ readOnly: game.readOnly, remoteOnly: game.REMOTE_ONLY_CONDITIONAL, override: OVERRIDE_REMOTE_ONLY }); // gameplay/input/modes.js
	window.addEventListener("resize", handleWindowResize);
	if (listeners.remoteKeys) { window.addEventListener("keydown", handleKeyPress) }
	if (listeners.pointer) {
		addBoardListener("click", handleCanvasClick);
		addBoardListener("mousemove", handleMouseMove);
		addBoardListener("mousedown", handleMouseDown);
		addBoardListener("mouseup", handleMouseUp);
		addBoardListener("contextmenu", function (e) { e.preventDefault(); }); // THE RIGHT BUTTON DRAWS MARKS & ARROWS
		addBoardListener("touchstart", handleTouchStart, { passive: false });
		addBoardListener("touchmove", handleTouchMove, { passive: false });
		addBoardListener("touchend", handleTouchEnd, { passive: false });
		addBoardListener("touchcancel", handleTouchCancel, { passive: false });
	}
	if (listeners.menu) { addMenuListeners(); } // THE MENU BUTTON, A CLICK AWAY (THE BOARD: handleCanvasClick, READ-ONLY: THE PAGE'S CLICK) & ESCAPE
	optResumeBtn.addEventListener("click", handleResume);
	optSoundBtn.addEventListener("click", handleSound);
	optFlipBtn.addEventListener("click", handleFlip);
	document.getElementById("optView").addEventListener("click", handleView);
	document.getElementById("optResetView").addEventListener("click", handleResetView);
	if (listeners.pgn) { optPgnBtn.addEventListener("click", handleDownloadPgn); } // REMOTE-ONLY MODE CAN'T REACH IT, A REMOTE-ONLY DEVICE HAS NOWHERE TO SAVE A FILE
	else { optPgnBtn.parentElement.hidden = true; }
	if (listeners.gameActions) {
		document.getElementById("optHint").addEventListener("click", handleHint);
		document.getElementById("optEvalBar").addEventListener("click", handleEvalBar);
		document.getElementById("optTakeback").addEventListener("click", handleTakeback);
		document.getElementById("optDraw").addEventListener("click", handleOfferDraw);
		optRestartBtn.addEventListener("click", handleRestart);
		document.getElementById("optCancelRematch").addEventListener("click", handleCancelRematch);
	}
	if (listeners.prompts) {
		document.getElementById("takebackAccept").addEventListener("click", handleTakeback); // THE SAME PRESS ACCEPTS
		document.getElementById("takebackDecline").addEventListener("click", handleDeclineTakeback);
		document.getElementById("drawAccept").addEventListener("click", handleOfferDraw); // THE SAME PRESS ACCEPTS
		document.getElementById("drawDecline").addEventListener("click", handleDeclineDraw);
	}
	optHomepageBtn.addEventListener("click", handleLeave);
	optSettingsBtn.addEventListener("click", handleLeave);
	document.getElementById("optReplay").addEventListener("click", handleLeave); // LEAVES LIKE HOME: A REMATCH REQUEST IS CANCELLED, THE SOCKET CLOSED
	optExitBtn.addEventListener("click", handleExit);
	if (listeners.moveList) { addMoveListListeners(); } // THE TOGGLE & ITS KEYS
	if (listeners.moveBox) { addMoveBoxListeners(); } // ON IN REMOTE-ONLY MODE TOO, A KEYBOARD CAN STILL TYPE. REMOTE-ONLY MODE CAN'T REACH THE MENU'S TYPE A MOVE, IT ONLY WORKS WITH THE / KEY THERE
	startMonitor(); // REMOTE-ONLY MODE TOO (THE REMOTE REACHES THE MENU'S MONITOR ITEM). STILL BEFORE THE 3D BOARD MOUNTS: show3D WAITS FOR ITS CHUNK FIRST
	return game.response;
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
		const played = validateState.move(game.moveObj);
		sayLine(momentFor(played, validateState, game.playerColor == "w" ? "b" : "w")); // A CAPTURE, CHECK OR MATE
		setFace(faceFor(played, validateState, game.playerColor == "w" ? "b" : "w")); // THE MONITOR'S FACE IS PLEASED WITH IT (3D ONLY)
		clearStatus("ai");
		startSlide(game.moveObj.from, game.moveObj.to); // STOPS ANY OTHER SLIDE
		game.aiTurn = false;
	} catch (err) {
		console.log(err);
		game.aiTurn = false; // playAi ALREADY TRIED AGAIN: WAITS BEFORE ASKING AGAIN, NOT A NEW REQUEST EVERY FRAME
		showStatus("ai", "The AI isn't answering. Trying again…");
		game.aiTimer = setTimeout(function () {
			if (game.ai && !game.gameOver && chessInst.turn() != game.playerColor) { game.aiTurn = true; game.refresh = true; } // STILL ITS TURN (NOT RESTARTED SINCE)
		}, AI_RETRY_TIME);
	} finally { aiThinking = false; }
}

/**
 * @description A game that opens on 3D: the page stays hidden (loadingPage) until the 3D board is up & its first frame with the
 * squares is drawn, so it fades in on a whole board, never an empty one (#433). 3D that can't start shows 2D at once (setView
 * falls back). 3D still not drawn after FADE_WAIT_MS of the page being seen: the page fades in on 2D & says why, the next load tries 3D again
 */
const FADE_WAIT_MS = 8000; // LIKE THE HOME PAGE'S WAIT (showPageWhenDrawn)
let holdFade = false; // TRUE WHILE fadeInOn3D WAITS, renderLoop DOESN'T FADE IN
function fadeInOn3D() {
	holdFade = true;
	let timer = null;
	const release = function () {
		if (!holdFade) { return; }
		holdFade = false;
		clearTimeout(timer);
		document.removeEventListener("visibilitychange", startTimer);
		game.refresh = true; // THE NEXT FRAME FADES IN (renderLoop)
		requestFrame();
	};
	function startTimer() { // ONLY COUNTS WHILE THE PAGE IS SEEN: A TAB OPENED IN THE BACKGROUND DRAWS NOTHING
		if (document.hidden) { document.addEventListener("visibilitychange", startTimer, { once: true }); return; }
		timer = setTimeout(function () {
			if (!holdFade) { return; }
			showStatus("view", "3D board took too long to load. Showing 2D.", MESSAGE_TIME);
			showView(VIEWS.TWO_D); // AFTER THE 3D SWITCH STILL GOING: A BOARD THAT COMES UP LATE IS TAKEN DOWN BEFORE IT'S SEEN
			release(); // NOTHING ON 3D YET: THE 2D CANVAS IS THE BOARD THAT'S DRAWN
		}, FADE_WAIT_MS);
	}
	startTimer();
	showView(VIEWS.THREE_D).then((on) => on === VIEWS.THREE_D ? whenDrawn3D() : null).then(release, release);
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
			if (game.ai && !game.readOnly && chessInst.turn() != game.playerColor && game.aiTurn) { // IF AI (NEVER ON A READ-ONLY BOARD)
				await startAiSlide();
			} else {
				flipWhenDone(); // FLIP BOARD WAS PRESSED DURING THE SLIDE OR SAVE THAT JUST ENDED
				drawBoard(); // DRAW ONE FRAME (2D OR 3D)
				if (!holdFade) { document.documentElement.classList.remove("loadingPage"); } // THE FIRST FRAME IS DRAWN: FADE INTO THE GAME (play.html), DOES NOTHING AFTER THAT. 3D AT LOAD: fadeInOn3D
				game.refresh = false;
			}
		}
	} catch (err) { console.log(err); }
	if (game.restartSlide || ((game.refresh || game.currSlide) && !game.boardReset)) { requestFrame(); }
}
