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
// The game's shared state (game.tiles, game.moveObj, ...), the canvas & the chess.js boards
const { game, canvas, chessInst, validateState, startFrames, requestFrame, OVERRIDE_REMOTE_ONLY } = require("./state/index.js");
const { playAi } = require("./ai/index.js"); // Asks the server for the AI's move
// What the AI's bot says about its move & the face the 3D room's monitor makes at it
const { momentFor, faceFor } = require("./bots/index.js");
const { sayLine } = require("./bots/say.js"); // & says it beside the board
const { imageProgress } = require("./images/index.js"); // How many of the game's images have loaded (0 - 1)
const { handleWindowResize } = require("./layout/index.js");
const { handleInitialData } = require("./draw/index.js");
const { setTakenPieceArr } = require("./draw/taken.js"); // The taken piece trays
const { drawRestartSlide } = require("./animate/index.js"); // One frame of the pieces sliding home after restart & rematch
const {
	handleCanvasClick, handleMouseMove, handleMouseDown, handleMouseUp,
	handleTouchStart, handleTouchMove, handleTouchEnd, handleTouchCancel, handleHandKey
} = require("./input/index.js");
const { handleKeyPress, handleCardKey } = require("./input/keys.js"); // The keyboard & remote-only mode
const { setInitialData, loadReadOnly, startSlide } = require("./moves/index.js"); // Loads the game from the server (to play, or read-only)
const { startCards } = require("./cards/flow.js"); // A Chess Cards game runs there instead
const { getCardsGame } = require("./cards/api.js"); // & loads from the card routes
const { listenersFor } = require("./input/modes.js"); // Which listeners go on: the mouse, remote-only mode or the read-only board
const {
	addMenuListeners, handleResume, handleSound, loadSound, loadView, showView, handleView, handleResetView, handleFlip, flipWhenDone,
	handleDownloadPgn, handleHint, handleTakeback, handleDeclineTakeback, handleOfferDraw, handleDeclineDraw, handleRestart,
	handleCancelRematch, handleLeave, handleExit, socketHandlers, showReadOnlyMenu
} = require("./menu/index.js"); // The menu buttons' handlers & the friend game socket's handlers
const { joinGame } = require("../socket/index.js"); // Friend games: the server pushes moves, forfeits & rematches
const { showStatus, clearStatus, MESSAGE_TIME } = require("./status/index.js"); // The message area on the play page
const { loadMoveList, addMoveListListeners } = require("./movelist/index.js");
const { addMoveBoxListeners } = require("./movebox/index.js"); // The box for typed moves
const { loadEvalBar, handleEvalBar } = require("./analysis/index.js");
const { startMonitor } = require("./monitor/index.js"); // The 3D room's monitor: its data, actions & hide rules
// Picks the 2D canvas or the 3D board, the only place that knows which is on
const { drawBoard, VIEWS, addBoardListener, stopMotion3D, whenDrawn3D, setFace, can3D } = require("./renderer/index.js");
// Switches mid-game (the 3D board is downloaded the first time, its own "three" chunk)
export { setView, currentView, VIEWS } from "./renderer/index.js";
const main = document.querySelector("#main"); // The canvas is added here
const optBtn = document.getElementById("optBtn"); // Menu button (3 lines, top right), opens the menu
const optResumeBtn = document.getElementById("optResume");
const optSoundBtn = document.getElementById("optSound");
const optFlipBtn = document.getElementById("optFlip");
const optPgnBtn = document.getElementById("optPgn");
const optRestartBtn = document.getElementById("optRestart"); // Forfeit, then restart (AI games) or rematch (friend games)
const optHomepageBtn = document.getElementById("optHome");
const optSettingsBtn = document.getElementById("optSettings");
const optExitBtn = document.getElementById("optExit");
let aiThinking = false; // True while the server picks the AI's move
const AI_RETRY_TIME = 5000; // Asks for the AI's move again after this when it didn't answer (ms)

/* ---------------------------------------------------------------- */
// Render Canvas
/* ---------------------------------------------------------------- */
/**
 * @description Starts a game: adds the canvas to main & starts the game (startGame) once the images are loaded.
 * The rest of the game is in the files next to this one (see the top of this file), the state they share is game (gameplay/state/index.js)
 * @param  {[object]} playerData [{ GAME_URL, GAME_ID, PLAYER_ID, REMOTE_ONLY_CONDITIONAL, SIGNED_IN, VIEW, READ_ONLY,
 * CARD_GAME }. REMOTE_ONLY_CONDITIONAL = remote-only mode's controls instead of the mouse. VIEW = VIEWS.THREE_D to start
 * on the 3D board (left out: the player's saved view, loadView). READ_ONLY = a board that only shows the game (a replay):
 * no piece is picked up, no move or AI request is sent & no socket is opened. CARD_GAME = a Chess Cards game's
 * { startColor }: cards/flow.js plays it, not chess.js]
 * @return {[Promise<object|false>]} [the game (game.response) once it's started, false when it couldn't be loaded]
 */
export async function renderCanvas(playerData) {
	game.GAME_URL = playerData.GAME_URL; // The game's constants
	game.PLAYER_ID = playerData.PLAYER_ID;
	game.REMOTE_ONLY_CONDITIONAL = playerData.REMOTE_ONLY_CONDITIONAL;
	game.SIGNED_IN = playerData.SIGNED_IN; // A signed in player (not a guest): restart changes the URL, exit logs out
	game.GAME_ID = playerData.GAME_ID; // Changes when an AI game restarts or a friend game rematches
	game.readOnly = Boolean(playerData.READ_ONLY); // A replay: the board only shows the game
	game.cardGame = playerData.CARD_GAME || null; // Chess Cards: the card routes & cards/flow.js, not the chess ones

	optBtn.style.display = "flex";

	canvas.id = "canvas";

	game.cw = (canvas.width = window.innerWidth); // Canvas width (CSS pixels)
	game.ch = (canvas.height = window.innerHeight); // Canvas height (CSS pixels)
	game.moveAudio = new Audio(`${process.env.CHESS_ASSETS_URL}/audio/piece-jump.mp4`); // The move sound
	loadSound(); // The player's saved sound on / off
	loadMoveList(); // The player's saved move list open / collapsed
	loadEvalBar(); // The player's saved evaluation bar on / off

	canvas.style.backgroundRepeat = "repeat-y"; // The table behind the board
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
			if (imageProgress() == 1) { // Every image preloadImages() started is in (the play page starts them before renderCanvas)
				clearInterval(startGameCheck); // Before the await, or it would start the game again every 100ms while it loads
				resolve(await startGame(playerData.VIEW || loadView())); // The player's saved view, 3D by default (2D on a phone or tablet)
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

	game.cw = 0; // Set by renderBoard()
	game.ch = 0;

	const loaded = game.readOnly ? await loadReadOnly()
		: game.cardGame ? startCards(await getCardsGame(game.GAME_URL, game.GAME_ID))
		: await setInitialData() !== false;
	if (!loaded) { // Couldn't load: no game to draw or play, only its message (setInitialData) on the table
		optBtn.style.display = "none"; // Its listener is added below, a reload starts again
		document.documentElement.classList.remove("loadingPage"); // loadingPage hides the message (play.html)
		return false;
	}
	handleInitialData();
	if (game.readOnly) { showReadOnlyMenu(game.response); } // The result & what a board that only shows the game offers
	if (!game.readOnly && !game.ai && game.response?.status == 200) { // A friend game
		joinGame(game.GAME_ID, game.PLAYER_ID, socketHandlers); // The server pushes moves, forfeits & rematches (server/socket.js)
	}
	if (!game.gameOver && !game.readOnly) { optRestartBtn.innerHTML = "Forfeit"; } // play.html says Restart, what a game that's over offers


	// Just in case
	canvas.style.backgroundRepeat = "repeat-y"; // The table behind the board
	canvas.style.backgroundImage = `url("${process.env.CHESS_ASSETS_URL}/images/board/table.webp")`;
	canvas.style.backgroundSize = "cover";
	canvas.style.backgroundPosition = "center";
	main.append(canvas);

	const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)"); // The device's reduce motion setting
	game.reduceMotion = reduceMotionQuery.matches;
	reduceMotionQuery.addEventListener("change", function (e) { // Changed during a game: the next frame uses it
		game.reduceMotion = e.matches;
		if (e.matches) { stopMotion3D(); } // A 3D camera turn or piece slide already going lands at once
	});

	if (view === VIEWS.THREE_D) { fadeInOn3D(); } // Falls back to 2D itself when 3D can't load
	startFrames(renderLoop); // The render loop: frames only come while something changes & the tab is shown
	// Shown again: a slide catches up to the time (stepSlide) & a canvas the browser may have thrown away is redrawn
	document.addEventListener("visibilitychange", function () { if (!document.hidden) { game.refresh = true; } });

	// Event listeners. addBoardListener puts the board's on the 2D canvas & the 3D board. The board's handlers are in
	// gameplay/input/index.js, handleWindowResize in gameplay/layout/index.js, the menu's in gameplay/menu/index.js
	const listeners = listenersFor({
		readOnly: game.readOnly,
		remoteOnly: game.REMOTE_ONLY_CONDITIONAL,
		override: OVERRIDE_REMOTE_ONLY,
		cards: Boolean(game.cardGame)
	});
	window.addEventListener("resize", handleWindowResize);
	if (listeners.remoteKeys) { window.addEventListener("keydown", handleKeyPress) }
	// A Chess Cards game: the arrows, Enter & Escape play from the hand (cards/flow.js)
	if (game.cardGame) { window.addEventListener("keydown", handleHandKey, true); }
	// The arrows & Enter pick a promotion card, on every device. In the capture phase, before the page's nav & handleKeyPress
	// (which calls it too, but never sees a key it handled). No removeEventListener: none of the game's window listeners have one
	if (!game.readOnly) { window.addEventListener("keydown", handleCardKey, true); }
	if (listeners.pointer) {
		addBoardListener("click", handleCanvasClick);
		addBoardListener("mousemove", handleMouseMove);
		addBoardListener("mousedown", handleMouseDown);
		addBoardListener("mouseup", handleMouseUp);
		addBoardListener("contextmenu", function (e) { e.preventDefault(); }); // The right button draws marks & arrows
		addBoardListener("touchstart", handleTouchStart, { passive: false });
		addBoardListener("touchmove", handleTouchMove, { passive: false });
		addBoardListener("touchend", handleTouchEnd, { passive: false });
		addBoardListener("touchcancel", handleTouchCancel, { passive: false });
	}
	// The menu button, a click away (the board: handleCanvasClick, read-only: the page's click) & Escape
	if (listeners.menu) { addMenuListeners(); }
	optResumeBtn.addEventListener("click", handleResume);
	optSoundBtn.addEventListener("click", handleSound);
	optFlipBtn.addEventListener("click", handleFlip);
	document.getElementById("optView").addEventListener("click", handleView);
	document.getElementById("optResetView").addEventListener("click", handleResetView);
	// Remote-only mode can't reach it, a remote-only device has nowhere to save a file
	if (listeners.pgn) { optPgnBtn.addEventListener("click", handleDownloadPgn); }
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
		document.getElementById("takebackAccept").addEventListener("click", handleTakeback); // The same press accepts
		document.getElementById("takebackDecline").addEventListener("click", handleDeclineTakeback);
		document.getElementById("drawAccept").addEventListener("click", handleOfferDraw); // The same press accepts
		document.getElementById("drawDecline").addEventListener("click", handleDeclineDraw);
	}
	optHomepageBtn.addEventListener("click", handleLeave);
	optSettingsBtn.addEventListener("click", handleLeave);
	// Leaves like Home: a rematch request is cancelled, the socket closed
	document.getElementById("optReplay").addEventListener("click", handleLeave);
	optExitBtn.addEventListener("click", handleExit);
	if (listeners.moveList) { addMoveListListeners(); } // The toggle & its keys
	// On in remote-only mode too, a keyboard can still type. Remote-only mode can't reach the menu's Type a move, it only
	// works with the / key there
	if (listeners.moveBox) { addMoveBoxListeners(); }
	// Remote-only mode too (the remote reaches the menu's Monitor item). Still before the 3D board mounts: show3D waits for
	// its chunk first
	startMonitor();
	return game.response;
}

/* ################################################################ */
/* ################################################################ */
// Core Render Loop
/* ################################################################ */
/* ################################################################ */

/**
 * @description Asks the server for the AI's move & starts its slide. No frames are drawn while the server picks the move
 */
async function startAiSlide() {
	aiThinking = true;
	try {
		game.revert = game.response; // Go back to this if the AI's move fails
		game.moveObj = await playAi(game.GAME_URL, game.GAME_ID); // The server picks & saves the AI's move

		validateState.load(game.response.game_board); // Check the move on the scratch board (throws if it's not legal)
		const played = validateState.move(game.moveObj);
		sayLine(momentFor(played, validateState, game.playerColor == "w" ? "b" : "w")); // A capture, check or mate
		setFace(faceFor(played, validateState, game.playerColor == "w" ? "b" : "w")); // The monitor's face is pleased with it (3D only)
		clearStatus("ai");
		startSlide(game.moveObj.from, game.moveObj.to); // Stops any other slide
		game.aiTurn = false;
	} catch (err) {
		console.log(err);
		game.aiTurn = false; // playAi already tried again: wait before asking again, not a new request every frame
		showStatus("ai", "The AI isn't answering. Trying again…");
		game.aiTimer = setTimeout(function () {
			if (game.ai && !game.gameOver && chessInst.turn() != game.playerColor) { // Still its turn (not restarted since)
				game.aiTurn = true;
				game.refresh = true;
			}
		}, AI_RETRY_TIME);
	} finally { aiThinking = false; }
}

/**
 * @description A game that opens on 3D: the page stays hidden (loadingPage) until the 3D board is up & its first frame with the
 * squares is drawn, so it fades in on a whole board, never an empty one. 3D that can't start shows 2D at once (setView
 * falls back). 3D still not drawn after FADE_WAIT_MS of the page being seen: the page fades in on 2D & says why, the next
 * load tries 3D again
 */
const FADE_WAIT_MS = 8000; // Like the home page's wait (showPageWhenDrawn)
let holdFade = false; // True while fadeInOn3D waits, renderLoop doesn't fade in
function fadeInOn3D() {
	holdFade = true;
	let timer = null;
	const release = function () {
		if (!holdFade) { return; }
		holdFade = false;
		clearTimeout(timer);
		document.removeEventListener("visibilitychange", startTimer);
		game.refresh = true; // The next frame fades in (renderLoop)
		requestFrame();
	};
	function startTimer() { // Only counts while the page is seen: a tab opened in the background draws nothing
		if (document.hidden) {
			document.addEventListener("visibilitychange", startTimer, { once: true });
			return;
		}
		timer = setTimeout(function () {
			if (!holdFade) { return; }
			// A card game has no 2D table (hands, piles, prompts): it waits for 3D, with the page shown meanwhile
			if (game.cardGame) {
				showStatus("view", "The 3D board is still loading.");
				return release();
			}
			showStatus("view", "3D board took too long to load. Showing 2D.", MESSAGE_TIME);
			showView(VIEWS.TWO_D); // After the 3D switch still going: a board that comes up late is taken down before it's seen
			release(); // Nothing on 3D yet: the 2D canvas is the board that's drawn
		}, FADE_WAIT_MS);
	}
	startTimer();
	showView(VIEWS.THREE_D).then(function (on) {
		// A touch-first device (Home's start is off there too): said, not a board that can't be played. Any other failure
		// (no WebGL, a download) keeps the renderer's own line
		if (on !== VIEWS.THREE_D && game.cardGame && !can3D()) {
			showStatus("view", "Chess Cards needs 3D, which this device can't show.");
		}
		// Drawn: the "still loading" line goes
		return on === VIEWS.THREE_D ? whenDrawn3D().then(function () { if (game.cardGame) { clearStatus("view"); } }) : null;
	}).then(release, release);
}

/**
 * @description Runs for each frame the browser gives it (requestFrame). On the AI's turn it asks the server for the AI's move
 * & starts its slide, otherwise it draws a frame when something changed (refresh) or a piece is sliding (currSlide).
 * Asks for the next frame only while there's more to draw, setting refresh, currSlide or restartSlide starts it again
 */
async function renderLoop() {
	if (aiThinking) { return; } // startAiSlide asks for the next frame below when it's done
	try {
		if (game.restartSlide) { // Restart & rematch: the pieces slide home
			drawRestartSlide();
		} else if ((game.refresh || game.currSlide) && !game.boardReset) {
			// The AI's turn (never on a read-only board, & Card Guy's turns are cards/flow.js's)
			if (game.ai && !game.readOnly && !game.cardGame && chessInst.turn() != game.playerColor && game.aiTurn) {
				await startAiSlide();
			} else {
				flipWhenDone(); // Flip board was pressed during the slide or save that just ended
				drawBoard(); // One frame (2D or 3D)
				// The first frame is drawn: fade into the game (play.html), does nothing after that. 3D at load: fadeInOn3D
				if (!holdFade) { document.documentElement.classList.remove("loadingPage"); }
				game.refresh = false;
			}
		}
	} catch (err) { console.log(err); }
	if (game.restartSlide || ((game.refresh || game.currSlide) && !game.boardReset)) { requestFrame(); }
}
