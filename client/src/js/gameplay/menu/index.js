/*
 *  index.js  --  chess frontend
 *	Menu
 *	The in game menu (the 3 line button, Resume, Sound, Restart / Forfeit / Rematch, Home & Exit), loading a new board in place
 *	for Restart & Rematch (the pieces slide home, gameplay/animate/index.js) & the game over screen. Also the friend game
 *	socket's handlers (socketHandlers: a move, a forfeit or a rematch), startGame & loadRematch join with them
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, stopFrames } = require("../state/index.js"); // THE GAME'S SHARED STATE
const { restartGame, forfeitGame, rematchGame } = require("../validate/index.js"); // REQUESTS TO THE CHESS SERVER (/api/chess)
const { handleInitialData } = require("../draw/index.js"); // NEW drawScreen FOR THE PLAYER'S COLOR
const { getRestartPieces, startRestartSlide } = require("../animate/index.js"); // THE PIECES SLIDING HOME AFTER RESTART & REMATCH
const { handleRemoteMenuEnter, clearTouch } = require("../input/index.js"); // TV REMOTE: SELECTS A MENU BUTTON, LETS GO OF A TOUCH
const { setInitialData, checkOpponentMove, refreshData, revertUnfinishedMove } = require("../moves/index.js"); // LOADS THE GAME, A FRIEND'S MOVE FROM THE SOCKET, RESETS THE BOARD, TAKES BACK A MOVE THAT ISN'T FINISHED
const { InternalAuth } = require("../../auth/index.js"); // LOGOUT IS A POST TO THE SERVER (#297)
const { joinGame, leaveGame } = require("../../socket/index.js"); // FRIEND GAMES: THE SERVER PUSHES MOVES, FORFEITS & REMATCHES
const { showStatus, clearStatus, MESSAGE_TIME } = require("../status/index.js"); // THE MESSAGE AREA ON THE PLAY PAGE
const optBtn = document.getElementById("optBtn"); // MENU BUTTON (3 LINES, TOP RIGHT), OPENS THE MENU
const menu = document.getElementById("menuContainer"); // IN GAME MENU
const optResumeBtn = document.getElementById("optResume"); // MENU: RESUME
const optSoundBtn = document.getElementById("optSound"); // MENU: SOUND ON / OFF
const optRestartBtn = document.getElementById("optRestart"); // MENU: RESTART (AI GAMES) / FORFEIT & REMATCH (FRIEND GAMES)
const optHomepageBtn = document.getElementById("optSettings"); // MENU: HOMEPAGE
const resultDisplay = document.getElementById("resultDisplay"); // MENU TITLE ("Chess" OR THE RESULT)

const SOUND_KEY = "SOUND"; // localStorage: "off" WHEN THE PLAYER TURNED SOUND OFF, GUESTS TOO
let confirmForfeit = false; // FORFEIT NEEDS A SECOND PRESS
let rematchWaiting = false; // TIMER WHILE WAITING 1 MINUTE ON THE OPPONENT'S REMATCH PRESS
export const socketHandlers = { // SOCKET EVENT -> HANDLER
	move: checkOpponentMove,
	gameOver: showGameOver,
	rematch: loadRematch,
	connectionLost: function () { showStatus("connection", "Connection lost. Reconnecting…"); },
	reconnected: function () { showStatus("connection", "Reconnected", 3000); },
	connectionFailed: function () { showStatus("connection", "Connection lost. Reload the page to reconnect."); },
};

/* ---------------------------------------------------------------- */
// Open & Close
/* ---------------------------------------------------------------- */
/**
 * @description Every way the menu opens comes through here. A move that isn't finished goes back (revertUnfinishedMove) &
 * no piece stays hovered, so pieces can't be touched until the menu closes
 */
export function openMenu() {
	clearTouch();
	revertUnfinishedMove();
	for (let i = 0; i < game.tiles.length; i++) { game.tiles[i].isHovering = false; }
	game.menuToggled = true;
	game.refresh = true;
	menu.style.display = "flex";
}

/**
 * @description Back to the game (Resume or a click away from the menu). The menu stays open while a new board loads
 * (the old board under it is locked) & when the game is over (Resume is hidden, there's no game to go back to)
 */
export function closeMenu() {
	if (game.boardReset || optResumeBtn.parentElement.style.display == "none") { return; }
	game.menuToggled = false;
	menu.style.display = "none";
}

/**
 * @description A click outside the board, the menu & the menu button closes the menu. Clicks on the board are handled by
 * handleCanvasClick (input/index.js), it stops them before they get here
 */
export function handleClickAway(e) {
	if (!game.menuToggled || menu.contains(e.target) || optBtn.contains(e.target)) { return; }
	closeMenu();
}

/* ---------------------------------------------------------------- */
// Options (Menu) Button
/* ---------------------------------------------------------------- */
/**
 * @description Toggles menu based on menu state. The menu button (3 lines) opens or closes the menu
 */
export function handleMenuBtn(e) {
	e.preventDefault();
	e.stopPropagation();
	if (game.menuToggled) {
		game.menuToggled = false;
		menu.style.display = "none";
	} else { openMenu(); }
}

/* ---------------------------------------------------------------- */
// Resume Button (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description Closes the menu. Resume is only seen while the menu is open
 */
export function handleResume(e) {
	e.preventDefault();
	e.stopPropagation();
	closeMenu();
}

/* ---------------------------------------------------------------- */
// Sound Button (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description Reads the saved sound setting when the game starts & sets the button's words
 */
export function loadSound() {
	try { game.soundOn = localStorage.getItem(SOUND_KEY) != "off"; } catch { game.soundOn = true; } // STORAGE BLOCKED (PRIVATE MODE)
	optSoundBtn.innerText = game.soundOn ? "Turn Sound: Off" : "Turn Sound: On"; // THE WORDS SAY WHAT A PRESS WILL DO
}

/**
 * @description Turns the move sound on or off & saves it, the menu stays open. unlockAudio() (input/index.js) still runs
 * with sound off, so turning it back on works on iOS
 */
export function handleSound(e) {
	e.preventDefault();
	e.stopPropagation();
	game.soundOn = !game.soundOn;
	optSoundBtn.innerText = game.soundOn ? "Turn Sound: Off" : "Turn Sound: On"; // THE WORDS SAY WHAT A PRESS WILL DO
	try { localStorage.setItem(SOUND_KEY, game.soundOn ? "on" : "off"); } catch { } // NOT SAVED (PRIVATE MODE) -> ONLY UNTIL THE PAGE RELOADS
}

/* ---------------------------------------------------------------- */
// Restart Button (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description AI games: a game that's still going is forfeited, then a new game starts. The old board stays on screen
 * under the menu & Restart says Loading & fills up while it loads, then the pieces slide home (startRestartSlide).
 * Friend games: the same button is Forfeit, then Rematch once the game is over
 */
export async function handleRestart(e) {
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
		console.log(restartResponse?.message || "Restart failed: no answer from the server");
		showStatus("action", "A new game couldn't be started. Try again.", MESSAGE_TIME);
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
	clearStatus("move"); // ABOUT THE OLD GAME
	clearStatus("server");
	clearStatus("ai");
	game.gameOver = false;
	game.drawScreen = function () { return }; // DRAW NOTHING UNTIL THE NEW BOARD IS IN (THE OLD ONE STAYS ON THE CANVAS)
	await setInitialData(); // GETS THE NEW BOARD & PLAYER COLOR FROM THE DATABASE
	handleInitialData(); // NEW drawScreen FOR THE (MAYBE NEW) PLAYER COLOR
	setRestartLoading(1); // FULL
	await new Promise(function (resolve) { setTimeout(resolve, 200); }); // THE FILL REACHES THE END
	menu.style.display = "none"
	optResumeBtn.parentElement.style.display = 'flex'; // RESUME COMES BACK (IT'S HIDDEN WHEN A GAME IS OVER)
	resultDisplay.innerText = "Chess"
	game.menuToggled = false;
	await refreshData(game.response);
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
export function setRestartLoading(load) {
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
		console.log(forfeitResponse?.message || "Forfeit failed: no answer from the server");
		showStatus("action", "The forfeit didn't go through. Try again.", MESSAGE_TIME);
		return;
	}
	if (rematchWaiting) { return; } // ALREADY ASKED, STILL WAITING
	const rematchResponse = await rematchGame(game.GAME_URL, game.GAME_ID);
	if (rematchResponse?.status == 409) { return optRestartBtn.innerHTML = "Can't rematch"; } // ONE OF YOU IS IN ANOTHER FRIEND GAME, OR THE REMATCH EXPIRED
	if (rematchResponse?.new_game_id) { return await loadRematch(rematchResponse.new_game_id); } // OPPONENT WAS ALREADY WAITING
	if (rematchResponse?.waiting) { // WAIT 1 MINUTE FOR THE OPPONENT
		optRestartBtn.innerHTML = "Waiting...";
		rematchWaiting = setTimeout(function () { rematchWaiting = false; optRestartBtn.innerHTML = "Rematch"; }, rematchResponse.expires_in);
		return;
	}
	console.log(rematchResponse?.message || "Rematch failed: no answer from the server");
	showStatus("action", "The rematch request didn't go through. Try again.", MESSAGE_TIME);
}

/* ---------------------------------------------------------------- */
// Game Over
/* ---------------------------------------------------------------- */
/**
 * @description Locks the board & opens the menu with the server's result. AI games offer Restart, friend games offer Rematch
 * @param  {[object]} result [{ winner: "w" | "b" | "draw", reason }]
 */
export function showGameOver(result) {
	if (game.gameOver) { return; } // ALREADY SHOWN
	game.gameOver = true;
	openMenu();
	game.opposingMove = true; // NO MORE MOVES (AFTER openMenu, GOING BACK UNLOCKS THE BOARD)
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
	clearStatus("connection"); // THE NEW SOCKET REPORTS ITS OWN
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
export function handleHomepage(e) {
	e.preventDefault();
	e.stopPropagation();

	stopFrames(); // STOP THE RENDER LOOP
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
export function handleExit(e) {
	e.preventDefault();
	e.stopPropagation();
	if (game.SIGNED_IN) { return new InternalAuth().logout(); }
	new InternalAuth().login();
}
