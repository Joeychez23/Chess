// Owns the end of a game: restart, forfeit, rematch, the result title, opponent left, leave & exit
const { game, chessInst, stopFrames } = require("../state/index.js"); // THE GAME'S SHARED STATE
const { restartGame, forfeitGame, rematchGame, cancelRematch } = require("../validate/index.js"); // REQUESTS TO THE CHESS SERVER (/api/chess)
const { newCardsGame } = require("../cards/api.js"); // CHESS CARDS' RESTART IS A NEW CARD GAME (/api/chess/cards)
const { handleInitialData } = require("../draw/index.js"); // NEW drawScreen FOR THE PLAYER'S COLOR
const { getRestartPieces, startRestartSlide } = require("../animate/index.js"); // THE PIECES SLIDING HOME AFTER RESTART & REMATCH
const { setInitialData, refreshData } = require("../moves/index.js"); // LOADS THE GAME, A FRIEND'S MOVE FROM THE SOCKET, RESETS THE BOARD, TAKES BACK A MOVE THAT ISN'T FINISHED
const { InternalAuth } = require("../../auth/index.js"); // LOGOUT IS A POST TO THE SERVER (#297)
const { joinGame, leaveGame } = require("../../socket/index.js"); // FRIEND GAMES: THE SERVER PUSHES MOVES, FORFEITS & REMATCHES
const { showStatus, clearStatus, MESSAGE_TIME } = require("../status/index.js"); // THE MESSAGE AREA ON THE PLAY PAGE
const { confirmPress } = require("../../pages/utils/confirm.js"); // FORFEIT & LOGOUT NEED A SECOND PRESS
const { setUnavailable, setFill, stopFill, isBusy, fillThenGo } = require("../../pages/utils/menuItem.js"); // THE MENU ITEMS' STATES, LIKE THE OTHER PAGES
const { monitorState3D } = require("../renderer/index.js"); // 2D OR 3D, THE 3D CAMERA, THE 3D ROOM'S MONITOR (NOT gameplay/monitor: IT REQUIRES THIS FILE)
import { optRestartBtn, optBtn, nav, optResumeBtn, moveInFlight, optHomepageBtn, optHintBtn, optTypeMoveBtn, optEvalBarBtn, socketHandlers, optExitBtn } from "./index.js";
import { showGameOver, optTakebackBtn, optDrawBtn } from "./offers.js";

export const resultDisplay = document.getElementById("resultDisplay"); // MENU TITLE ("Chess" OR THE RESULT)
export const resultReason = document.getElementById("resultReason"); // THE LINE UNDER THE RESULT, HOW THE GAME ENDED
export const resultAnnouncement = document.getElementById("resultAnnouncement"); // SCREEN READERS ARE TOLD THE RESULT HERE
const optCancelRematchBtn = document.getElementById("optCancelRematch"); // MENU: CANCEL, WHILE A REMATCH REQUEST WAITS
export const optReplayBtn = document.getElementById("optReplay"); // MENU: REPLAY, ONCE A SIGNED IN PLAYER'S GAME IS OVER
const RESULT_REASONS = { // THE SERVER'S REASON -> THE LINE UNDER THE RESULT. A FORFEIT IS ALREADY IN THE TITLE
	"checkmate": "by Checkmate",
	"stalemate": "by Stalemate",
	"insufficient material": "by insufficient material",
	"fifty-move rule": "by the fifty-move rule",
	"threefold repetition": "by threefold repetition",
	"agreement": "by agreement",
	"timeout": "on time",
};
let rematchWaiting = false; // TIMER WHILE THE REMATCH REQUEST WAITS ON THE OPPONENT'S PRESS
let rematchOpponent = null; // THE NAME THE REQUEST IS WAITING FOR

/* ---------------------------------------------------------------- */
// Restart Button (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description A game that's still going: the button is Forfeit (handleForfeit). Once it's over, friend games: Rematch. AI games: Restart, a new game starts.
 * The old board stays on screen under the menu & Restart says Loading & fills up while it loads, then the pieces slide home (startRestartSlide)
 */
export async function handleRestart(e) {
	e.preventDefault();
	e.stopPropagation();
	if (game.boardReset || isBusy(optRestartBtn)) { return; } // ALREADY LOADING A NEW BOARD OR WAITING ON THE SERVER (A SECOND PRESS, REMOTE-ONLY MODE'S ENTER)
	if (!game.gameOver) { return await handleForfeit(); }
	if (game.cardGame) { return await restartCards(); }
	if (!game.ai) { return await handleRematch(); }
	const fromPieces = getRestartPieces(true); // WHERE THE PIECES ARE NOW, THEY SLIDE HOME FROM HERE
	game.boardReset = true; // STOP DRAWING, THE OLD BOARD STAYS ON SCREEN UNDER THE MENU WHILE THE NEW ONE LOADS
	game.refresh = false;
	optBtn.style.display = "none"
	setRestartLoading(0.15); // "Loading" & THE FILL
	const restartResponse = await restartGame(game.GAME_URL, game.GAME_ID); // A NEW GAME WITH THE SAME START SETTINGS (LEVEL & COLOR)
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
 * @description Chess Cards' Restart: a new card game at the same level & color (replace_current, so the server never answers 409 for this one), then its page opens.
 * The restart route refuses card games (server/controllers/chessController.js). Restart says Loading & fills while the new game is made, like an AI game's
 */
async function restartCards() {
	setRestartLoading(0.15);
	const response = await newCardsGame(game.GAME_URL, game.cardGame.startColor, game.response.ai_level, true);
	if (response?.status !== 200 || !response.game_id) { // NOT STARTED, THIS GAME STAYS (THE MENU STAYS OPEN)
		setRestartLoading(false);
		console.log(response?.message || "Restart failed: no answer from the server");
		showStatus("action", "A new game couldn't be started. Try again.", MESSAGE_TIME);
		return;
	}
	stopFrames(); // NOTHING MORE TO DRAW, THE NEW GAME'S PAGE LOADS
	fillThenGo(optRestartBtn, `/play/${encodeURIComponent(response.game_id)}`); // A NEW PAGE BOOTS IT BY ITS MODE (pages/play/index.js)
}

/**
 * @description Loads GAME_ID's board in place (restart, rematch & takeback), the canvas, listeners & render loop stay the same.
 * The old board stays on screen while it loads, then the menu closes & the pieces slide home (startRestartSlide)
 * @param  {[array]} fromPieces [where the old game's pieces were, getRestartPieces(true)]
 * @param  {[object]} loaded [a takeback: the game from its answer, setInitialData doesn't read it again & Restart doesn't fill]
 */
export async function loadNewBoard(fromPieces, loaded) {
	clearStatus("move"); // ABOUT THE OLD GAME
	clearStatus("server");
	clearStatus("ai");
	game.gameOver = false;
	game.drawScreen = function () { return }; // DRAW NOTHING UNTIL THE NEW BOARD IS IN (THE OLD ONE STAYS ON THE CANVAS)
	await setInitialData(loaded); // GETS THE NEW BOARD & PLAYER COLOR FROM THE DATABASE
	handleInitialData(); // NEW drawScreen FOR THE (MAYBE NEW) PLAYER COLOR
	if (!loaded) {
		setRestartLoading(1); // FULL
		await new Promise(function (resolve) { setTimeout(resolve, 200); }); // THE FILL REACHES THE END
	}
	nav.toggleNav(false, true); // THE NEW BOARD IS IN
	optResumeBtn.parentElement.hidden = false; // RESUME COMES BACK (IT'S HIDDEN WHEN A GAME IS OVER)
	optReplayBtn.parentElement.hidden = true; // ONLY ONCE THE NEW GAME IS OVER
	placeEndGroup(false);
	resultDisplay.innerText = "Chess"
	resultReason.hidden = true;
	resultAnnouncement.textContent = "";
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
		stopFill(optRestartBtn);
		optRestartBtn.innerHTML = game.ai && game.gameOver ? "Restart" : "Forfeit"; // RESTART FAILED: THE GAME IS STILL OVER
		return;
	}
	optRestartBtn.innerHTML = "Loading";
	setFill(optRestartBtn, load);
}

/* ---------------------------------------------------------------- */
// Forfeit Button (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description Forfeit -> "Are you sure?" -> forfeits & opens the game over screen. In an AI game it waits for a move in flight, the AI's move
 * could otherwise save or slide in after the game ended. Its timer stops so the AI isn't asked while the forfeit saves, & starts again if it fails
 */
async function handleForfeit() {
	if (!confirmPress(optRestartBtn)) { return; } // FIRST PRESS ASKS
	if (game.ai && (game.aiTurn || moveInFlight())) { return showStatus("action", "Wait for the AI's move to finish.", MESSAGE_TIME); }
	if (game.ai) { clearTimeout(game.aiTimer); }
	setFill(optRestartBtn);
	const forfeitResponse = await forfeitGame(game.GAME_URL, game.GAME_ID);
	if (forfeitResponse?.state == "CLOSED") { return showGameOver(forfeitResponse); }
	if (!game.gameOver) { stopFill(optRestartBtn); } // showGameOver ALREADY TOOK IT OFF, THE BUTTON MAY BE BUSY WITH A REMATCH
	if (game.ai && !game.gameOver && chessInst.turn() != game.playerColor) { // THE TIMER STOPPED ABOVE WOULD HAVE ASKED FOR THE AI'S MOVE
		game.aiTurn = true;
		game.refresh = true;
	}
	console.log(forfeitResponse?.message || "Forfeit failed: no answer from the server");
	showStatus("action", "The forfeit didn't go through. Try again.", MESSAGE_TIME);
}

/* ---------------------------------------------------------------- */
// Rematch Button (Menu, friend games)
/* ---------------------------------------------------------------- */
/**
 * @description Game over: Rematch, starts when both players press it within 5 minutes
 */
async function handleRematch() {
	if (rematchWaiting) { return; } // ALREADY ASKED, STILL WAITING
	setFill(optRestartBtn);
	const rematchResponse = await rematchGame(game.GAME_URL, game.GAME_ID);
	if (rematchResponse?.new_game_id) { return await loadRematch(rematchResponse.new_game_id); } // OPPONENT WAS ALREADY WAITING, THE FILL GOES ON WHILE IT LOADS
	if (game.boardReset) { return; } // THE SOCKET'S "rematch" LANDED FIRST, THE FILL IS THE NEW BOARD'S
	stopFill(optRestartBtn);
	if (rematchResponse?.status == 409) { return optRestartBtn.innerHTML = "Can't rematch"; } // ONE OF YOU IS IN ANOTHER FRIEND GAME, OR THE REMATCH EXPIRED
	if (rematchResponse?.waiting) { // WAIT FOR THE OPPONENT UNTIL THE REQUEST RUNS OUT
		clearTimeout(rematchWaiting);
		rematchOpponent = rematchResponse.opponent_name || "your opponent";
		optRestartBtn.innerText = `Waiting for ${rematchOpponent}`; // innerText, THE NAME IS NEVER READ AS HTML
		setUnavailable(optRestartBtn, true); // ONLY CANCEL CAN ACT UNTIL THE OPPONENT ANSWERS
		optCancelRematchBtn.parentElement.hidden = false;
		rematchWaiting = setTimeout(function () {
			endRematchWait();
			optRestartBtn.innerHTML = "Rematch";
			showStatus("action", "The rematch request ran out.", MESSAGE_TIME);
		}, rematchResponse.expires_in);
		if (rematchResponse.opponent_here === false) { showOpponentLeft(); } // THEY LEFT BEFORE THE PRESS, NO "player-left" IS COMING
		return;
	}
	console.log(rematchResponse?.message || "Rematch failed: no answer from the server");
	showStatus("action", "The rematch request didn't go through. Try again.", MESSAGE_TIME);
}

/**
 * @description The request isn't waiting any more (it started, ran out or was cancelled): stops the timer, Cancel & the "left the game" note go away
 */
function endRematchWait() {
	clearTimeout(rematchWaiting);
	rematchWaiting = false;
	rematchOpponent = null;
	setUnavailable(optRestartBtn, false);
	optCancelRematchBtn.parentElement.hidden = true;
	clearStatus("rematch");
}

/**
 * @description Tells the player waiting on a rematch that the opponent isn't on the game page. The request stays open, they can come back
 */
export function showOpponentLeft() {
	if (rematchWaiting) { showStatus("rematch", `${rematchOpponent} left the game. You can keep waiting or cancel.`); }
}

/**
 * @description Cancel: takes back the rematch request. Too late when the opponent just pressed, the socket's "rematch" brings the new game
 */
export async function handleCancelRematch(e) {
	e.preventDefault();
	e.stopPropagation();
	if (!rematchWaiting || isBusy(optCancelRematchBtn)) { return; }
	setFill(optCancelRematchBtn);
	const response = await cancelRematch(game.GAME_URL, game.GAME_ID);
	stopFill(optCancelRematchBtn);
	if (!rematchWaiting) { return; } // IT STARTED OR RAN OUT MEANWHILE
	if (response?.cancelled) {
		endRematchWait();
		optRestartBtn.innerHTML = "Rematch";
		return;
	}
	if (response?.status == 200) { return; } // THE OPPONENT PRESSED FIRST
	console.log(response?.message || "Cancel failed: no answer from the server");
	showStatus("action", "The rematch request couldn't be cancelled. Try again.", MESSAGE_TIME);
}

/* ---------------------------------------------------------------- */
// Game Over
/* ---------------------------------------------------------------- */
/**
 * @description Forfeit, Restart or Rematch's group: at the top under the result when the game is over, otherwise above Home.
 * It's moved in the page, not with CSS, so the Tab key & screen readers follow the order on screen. Moving a button takes its focus away, so it's given back
 * @param  {[boolean]} top [true: under the result]
 */
export function placeEndGroup(top) {
	const group = optRestartBtn.closest("ul");
	const focused = document.activeElement;
	if (top) { group.parentElement.prepend(group); }
	else { group.parentElement.insertBefore(group, optHomepageBtn.closest("ul")); }
	if (group.contains(focused)) { focused.focus(); }
}

/**
 * @description The camera is going to or is at the 3D room's monitor. Not while leaving: a game that ends then opens the menu as on the desk
 * @return {[boolean]}
 */
export function monitorHoldsMenu() {
	const state = monitorState3D();
	return state === "zooming" || state === "zoomed";
}

/**
 * @description The result in the menu's title & the line under it (how the game ended)
 * @param  {[object]} result [{ winner: "w" | "b" | "draw", reason }]
 */
export function showResult(result) {
	if (result?.reason == "forfeit") { resultDisplay.innerText = result.winner == 'w' ? "Black Forfeits" : "White Forfeits" } // THE TITLE ONLY FITS ONE LINE
	else if (result?.winner == 'w') { resultDisplay.innerText = "White Wins!" }
	else if (result?.winner == 'b') { resultDisplay.innerText = "Black Wins!" }
	else { resultDisplay.innerText = "Draw" }
	resultReason.innerText = RESULT_REASONS[result?.reason] || "";
	resultReason.hidden = !resultReason.innerText;
}

/* ---------------------------------------------------------------- */
// Read-Only Menu
/* ---------------------------------------------------------------- */
/**
 * @description The menu of a board that only shows the game (a replay, #100): the result (a finished game) & what still works there,
 * Sound, Flip Board, View, Download PGN, Home, Settings & Exit. Nothing that plays: Resume, Hint, Takeback, Offer Draw, Type a Move,
 * the eval bar (it scores the saved board, not the one shown) & Restart. It doesn't open by itself, the board is what's looked at
 * @param  {[object]} response [game from the server]
 */
export function showReadOnlyMenu(response) {
	for (const btn of [optResumeBtn, optHintBtn, optTakebackBtn, optDrawBtn, optTypeMoveBtn, optEvalBarBtn, optRestartBtn, optCancelRematchBtn, optReplayBtn]) {
		btn.parentElement.hidden = true;
	}
	if (response?.state == "CLOSED") { showResult(response); }
}

/* ---------------------------------------------------------------- */
// Load Rematch
/* ---------------------------------------------------------------- */
/**
 * @description Both players asked for a rematch: loads the new game in place (the server picked the sides). The old board
 * stays on screen & Rematch says Loading while it loads, then the pieces slide home (to the other side if the sides swapped)
 * @param  {[string]} newGameId [rematch game id, from the request or the socket]
 */
export async function loadRematch(newGameId) {
	if (!newGameId || `${newGameId}` == `${game.GAME_ID}`) { return; } // ALREADY LOADED (THE REQUEST & THE SOCKET BOTH SEND IT)
	const fromPieces = getRestartPieces(true); // WHERE THE PIECES ARE NOW, THEY SLIDE HOME FROM HERE
	game.GAME_ID = newGameId;
	history.replaceState(null, "", `/play/${game.GAME_ID}`); // THE URL FOLLOWS THE REMATCH
	endRematchWait();
	game.boardReset = true; // STOP DRAWING, THE OLD BOARD STAYS ON SCREEN WHILE THE NEW ONE LOADS
	game.refresh = false;
	optBtn.style.display = "none"
	setRestartLoading(0.5); // "Loading" & THE FILL (THE MENU IS OPEN AFTER A GAME ENDS), "Forfeit" WHEN THE SLIDE IS DONE
	clearStatus("connection"); // THE NEW SOCKET REPORTS ITS OWN
	joinGame(game.GAME_ID, game.PLAYER_ID, socketHandlers); // NEW GAME'S ROOM
	await loadNewBoard(fromPieces);
}

/* ---------------------------------------------------------------- */
// Home & Settings Links (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description Goes to the link's page. Stops the render loop & leaves the friend game's socket room first,
 * the page load clears everything else (listeners, canvas). It says Loading & fills up like the buttons into a game,
 * then the game stays on screen until the page is drawn & fades into it (home.html, showPage in pages/utils).
 * A click that opens a new tab leaves the game running, the menu's listener closes the menu (createNav in pages/utils/nav.js)
 */
export function handleLeave(e) {
	if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) { return; } // THIS PAGE STAYS
	e.preventDefault();
	e.stopPropagation();
	const link = e.currentTarget;
	if (isBusy(link)) { return; } // .loading ONLY STOPS CLICKS, A KEYBOARD CAN STILL PRESS IT

	stopFrames(); // STOP THE RENDER LOOP
	leaveGame();
	if (rematchWaiting) { cancelRematch(game.GAME_URL, game.GAME_ID); } // THE REQUEST ONLY STANDS WHILE THEY'RE HERE, A LATE PRESS WOULD START A GAME WITHOUT THEM
	fillThenGo(link, link.href); // THE PAGE ONCE IT'S FULL (server/routes/pageRoutes.js)
}

/* ---------------------------------------------------------------- */
// Exit Button (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description Exits game: a guest logs in, a signed in player logs out after a second press (the server's auth routes, server/routes/api/authRoutes.js).
 * One logout per press. A waiting rematch is cancelled first, the cancel needs the session & a late press would start a game without them
 */
export async function handleExit(e) {
	e.preventDefault();
	e.stopPropagation();
	if (!game.SIGNED_IN) {
		optExitBtn.innerText = "Loading";
		setFill(optExitBtn, 1);
		return new InternalAuth().login();
	}
	if (optExitBtn.disabled || !confirmPress(optExitBtn)) { return; } // FIRST PRESS ASKS (REMOTE-ONLY MODE'S ENTER ISN'T STOPPED BY disabled)
	optExitBtn.disabled = true;
	optExitBtn.innerText = "Logging Out";
	setFill(optExitBtn);
	if (rematchWaiting) { await cancelRematch(game.GAME_URL, game.GAME_ID); }
	await new InternalAuth().logout();
}
