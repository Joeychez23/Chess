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
const { game, canvas, chessInst, validateState, frameRate, OVERRIDE_TV } = require("./state/index.js"); // THE GAME'S SHARED STATE (game.tiles, game.moveObj, ...), THE CANVAS & THE chess.js BOARDS
const { restartGame, forfeitGame, rematchGame } = require("./validate/index.js"); // REQUESTS TO THE CHESS SERVER (/api/chess)
const { playAi } = require("./ai/index.js"); // ASKS THE SERVER FOR THE AI'S MOVE
const { imageProgress } = require("./images/index.js"); // HOW MANY OF THE GAME'S IMAGES HAVE LOADED (0 - 1)
const { handleWindowResize } = require("./layout/index.js"); // REDRAWS THE GAME WHEN THE WINDOW IS RESIZED
const { handleInitialData, setTakenPieceArr } = require("./draw/index.js"); // DRAWS EACH FRAME (drawScreen), THE TAKEN PIECE TRAYS
const { getRestartPieces, startRestartSlide, drawRestartSlide } = require("./animate/index.js"); // THE PIECES SLIDING HOME AFTER RESTART & REMATCH
const { handleKeyPress, handleCanvasClick, handleMouseMove, handleMouseDown, handleMouseUp, handleTouchStart, handleTouchMove, handleTouchEnd, handleTouchCancel, handleRemoteMenuEnter } = require("./input/index.js"); // MOUSE, TOUCH & TV REMOTE HANDLERS (ADDED IN startGame), THE TV REMOTE'S MENU HIGHLIGHT
const { setInitialData, checkOpponentMove, refreshData } = require("./moves/index.js"); // LOADS THE GAME, A FRIEND'S MOVE FROM THE SOCKET, RESETS THE BOARD TO A SERVER GAME
const { joinGame, leaveGame } = require("../socket/index.js"); // FRIEND GAMES: THE SERVER PUSHES MOVES, FORFEITS & REMATCHES
const main = document.querySelector("#main"); // THE CANVAS IS ADDED HERE
const optBtn = document.getElementById("optBtn"); // MENU BUTTON (3 LINES, TOP RIGHT), OPENS THE MENU
const menu = document.getElementById("menuContainer"); // IN GAME MENU
const optResumeBtn = document.getElementById("optResume"); // MENU: RESUME
const optRestartBtn = document.getElementById("optRestart"); // MENU: RESTART (AI GAMES) / FORFEIT & REMATCH (FRIEND GAMES)
const optHomepageBtn = document.getElementById("optSettings"); // MENU: HOMEPAGE
const optExitBtn = document.getElementById("optExit"); // MENU: EXIT
const resultDisplay = document.getElementById("resultDisplay"); // MENU TITLE ("Chess" OR THE RESULT)

/* ---------------------------------------------------------------- */
// Game Variables
/* ---------------------------------------------------------------- */
// USED BY THE FUNCTIONS BELOW ONLY (THE STATE OTHER FILES SHARE IS game, gameplay/state/index.js)
let confirmForfeit = false; // FORFEIT NEEDS A SECOND PRESS
let rematchWaiting = false; // TIMER WHILE WAITING 1 MINUTE ON THE OPPONENT'S REMATCH PRESS

const socketHandlers = { move: checkOpponentMove, gameOver: showGameOver, rematch: loadRematch }; // SOCKET EVENT -> HANDLER

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
	game.moveAudio = new Audio(`${process.env.CHESS_ASSESTS_URL}/audio/piece-jump.mp4`); // MOVE SOUND

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
 * to main, runs renderLoop() every frameRate ms & adds the event listeners (the board's handlers are in gameplay/input/index.js)
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

	// EVENT LISTENERS (THE BOARD'S HANDLERS ARE IN gameplay/input/index.js, handleWindowResize IN gameplay/layout/index.js, THE MENU'S IN EVENT LISTENERS BELOW)
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
// EVENT LISTENERS
/* ################################################################ */
/* ################################################################ */
// THE MENU'S HANDLERS. THE addEventListener LINES ARE AT THE END OF startGame(), THE BOARD'S HANDLERS (MOUSE, TOUCH & TV REMOTE) ARE IN
// gameplay/input/index.js & THE RESIZE HANDLER IS handleWindowResize (gameplay/layout/index.js)


/* ---------------------------------------------------------------- */
// Options (Menu) Button
/* ---------------------------------------------------------------- */
/**
 * @description Toggles menu based on menu state. The menu button (3 lines) opens or closes the menu
 */
export function handleMenuBtn(e) { // EXPORTED FOR gameplay/input/index.js
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
export function handleResume(e) { // EXPORTED FOR gameplay/input/index.js
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
export async function handleRestart(e) { // EXPORTED FOR gameplay/input/index.js
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
// Restart Loading (Restart & Rematch)
/* ---------------------------------------------------------------- */
/**
 * @description Restart (Rematch in friend games) says Loading & fills up from the left while the new board loads
 * (.loading IN nav.css), like the Home button. false puts the button back
 * @param  {[number]} load [how full, 0 - 1, it only fills up. false = done or failed]
 */
export function setRestartLoading(load) { // EXPORTED FOR gameplay/animate/index.js (THE SLIDE HOME PUTS THE BUTTON BACK)
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
export function showGameOver(result) { // EXPORTED FOR gameplay/moves/index.js
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
export function handleHomepage(e) { // EXPORTED FOR gameplay/input/index.js
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
export function handleExit(e) { // EXPORTED FOR gameplay/input/index.js
	e.preventDefault();
	e.stopPropagation();
	window.location.href = game.SIGNED_IN ? "/api/auth/logout" : "/api/auth/login";
}