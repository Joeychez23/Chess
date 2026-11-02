/*
 *  index.js  --  chess frontend
 *	Menu
 *	The in game menu (the 3 line button, Resume, Sound, Flip Board, Download PGN, Offer Draw, Restart / Forfeit / Rematch, Home & Exit), loading a new board in place
 *	for Restart & Rematch (the pieces slide home, gameplay/animate/index.js) & the game over screen. Also the friend game
 *	socket's handlers (socketHandlers: a move, a forfeit, a draw offer or a rematch), startGame & loadRematch join with them
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, stopFrames } = require("../state/index.js"); // THE GAME'S SHARED STATE
const { restartGame, forfeitGame, offerDraw, declineDraw, rematchGame, cancelRematch, getPgn } = require("../validate/index.js"); // REQUESTS TO THE CHESS SERVER (/api/chess)
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
const resultReason = document.getElementById("resultReason"); // THE LINE UNDER THE RESULT, HOW THE GAME ENDED
const optCancelRematchBtn = document.getElementById("optCancelRematch"); // MENU: CANCEL, WHILE A REMATCH REQUEST WAITS
const optDrawBtn = document.getElementById("optDraw"); // MENU: OFFER DRAW, WHILE THE GAME IS GOING
const drawPrompt = document.getElementById("drawPrompt"); // ACCEPT & DECLINE, WHILE THE OPPONENT'S OFFER STANDS

const SOUND_KEY = "SOUND"; // localStorage: "off" WHEN THE PLAYER TURNED SOUND OFF, GUESTS TOO
const RESULT_REASONS = { // THE SERVER'S REASON -> THE LINE UNDER THE RESULT. A FORFEIT IS ALREADY IN THE TITLE
	"checkmate": "by Checkmate",
	"stalemate": "by Stalemate",
	"insufficient material": "by insufficient material",
	"fifty-move rule": "by the fifty-move rule",
	"threefold repetition": "by threefold repetition",
	"agreement": "by agreement",
};
let confirmForfeit = false; // FORFEIT NEEDS A SECOND PRESS
let pgnLoading = false; // A SECOND PRESS WHILE THE PGN LOADS WOULD SAVE TWO FILES
let rematchWaiting = false; // TIMER WHILE THE REMATCH REQUEST WAITS ON THE OPPONENT'S PRESS
let rematchOpponent = null; // THE NAME THE REQUEST IS WAITING FOR
let drawBoard = null; // THE BOARD drawSent & drawIncoming ARE ABOUT, A MOVE ENDS THEM
let drawSent = false; // THIS PLAYER USED THEIR OFFER FOR THIS MOVE
let drawIncoming = false; // THE OPPONENT'S OFFER IS STANDING
let drawLoading = false; // THE AI CAN TAKE A FEW SECONDS TO ANSWER
let drawOpponent = "Your opponent"; // THE NAME THE MESSAGES USE
export const socketHandlers = { // SOCKET EVENT -> HANDLER
	move: checkOpponentMove,
	gameOver: showGameOver,
	drawOffer: handleDrawEvent,
	rematch: loadRematch,
	opponentLeft: showOpponentLeft,
	opponentBack: function () { clearStatus("rematch"); },
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
// Flip Board Button (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description Is a piece sliding? Its tile's place in tiles is held by the code finishing the move, so the board can't flip until it lands
 */
function slideInFlight() {
	return game.currSlide || game.tiles.some(function (tile) { return tile.isSliding; });
}

/**
 * @description Draws the board from the other side. refreshData rebuilds the tiles, they're in screen order
 */
function flipBoard() {
	game.flipPending = false;
	game.viewColor = game.viewColor == 'w' ? 'b' : 'w';
	handleInitialData();
	refreshData(game.response);
}

/**
 * @description Flips the board, the menu stays open. During a slide it flips when the slide is done (a second press cancels it)
 */
export function handleFlip(e) {
	e.preventDefault();
	e.stopPropagation();
	if (game.boardReset) { return; } // A NEW BOARD IS LOADING, IT STARTS FROM THE PLAYER'S SIDE
	if (slideInFlight()) { game.flipPending = !game.flipPending; return; }
	flipBoard();
}

/**
 * @description The render loop calls this before each frame, it does the flip that waited for a slide
 */
export function flipWhenDone() {
	if (game.flipPending && !slideInFlight()) { flipBoard(); }
}

/* ---------------------------------------------------------------- */
// Download PGN Button (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description Saves the game as a .pgn file, the menu stays open. The server writes it (GET /game/:gameId/pgn), so it has every saved move
 */
export async function handleDownloadPgn(e) {
	e.preventDefault();
	e.stopPropagation();
	if (pgnLoading) { return; }
	pgnLoading = true;
	const response = await getPgn(game.GAME_URL, game.GAME_ID);
	pgnLoading = false;
	if (response?.status != 200) { return showStatus("action", "Couldn't download the PGN. Try again.", MESSAGE_TIME); }

	const url = URL.createObjectURL(new Blob([response.pgn], { type: "application/x-chess-pgn" }));
	const link = document.createElement("a"); // NOT ADDED TO THE PAGE, ITS CLICK WOULD REACH handleClickAway & CLOSE THE MENU
	link.href = url;
	link.download = response.filename;
	link.click();
	setTimeout(function () { URL.revokeObjectURL(url); }, 1000); // THE DOWNLOAD HAS ITS OWN COPY BY THEN
}

/* ---------------------------------------------------------------- */
// Draw Offers (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description Sets the words on Offer Draw & shows Accept / Decline while the opponent's offer stands
 */
function showDrawButtons() {
	drawPrompt.hidden = !drawIncoming;
	if (drawLoading) { optDrawBtn.innerText = "Offering"; }
	else if (drawIncoming) { optDrawBtn.innerText = "Accept Draw"; } // THE SAME PRESS ACCEPTS, THE TV REMOTE CAN ONLY REACH THE MENU
	else { optDrawBtn.innerText = drawSent ? "Draw Offered" : "Offer Draw"; }
}

/**
 * @description Brings the draw offer up to date with a game from the server. A new board means a move was made, which ends any offer & gives both players theirs back.
 * On the same board this only adds what it finds, a read can be from before the offer the socket just told about
 * @param  {[object]} response [game from the server]
 */
export function syncDrawOffer(response) {
	if (!response?.game_board) { return; }
	optDrawBtn.parentElement.hidden = response.state != "OPEN";
	if (response.opponent_name) { drawOpponent = response.opponent_name; }
	if (response.game_board != drawBoard) {
		drawBoard = response.game_board;
		drawSent = false;
		drawIncoming = false;
		clearStatus("draw");
	}
	if (response.draw_offer == game.playerColor) { drawSent = true; }
	else if (response.draw_offer) { showIncomingDraw(); }
	showDrawButtons();
}

/**
 * @description The opponent's offer is standing, the message area reads it out
 */
function showIncomingDraw() {
	drawIncoming = true;
	showStatus("draw", `${drawOpponent} offers a draw`);
}

/**
 * @description The socket's "draw-offer", another tab of this player's counts too
 * @param  {[object]} event [{ state: "offered" | "declined", mine: this player did it }]
 */
function handleDrawEvent({ state, mine }) {
	if (state == "offered" && mine) { drawSent = true; }
	else if (state == "offered") { showIncomingDraw(); }
	else if (mine) { drawIncoming = false; clearStatus("draw"); }
	else {
		drawSent = true;
		showStatus("draw", `${drawOpponent} declined the draw.`, MESSAGE_TIME);
	}
	showDrawButtons();
}

/**
 * @description Offer Draw, or Accept while the opponent's offer stands (the server tells them apart). The menu stays open
 */
export async function handleOfferDraw(e) {
	e.preventDefault();
	e.stopPropagation();
	if (drawLoading || game.gameOver || (drawSent && !drawIncoming)) { return; }
	drawLoading = true;
	showDrawButtons();
	const response = await offerDraw(game.GAME_URL, game.GAME_ID);
	drawLoading = false;
	if (response?.state == "CLOSED") { return showGameOver(response); }
	if (response?.offered || response?.declined) {
		drawSent = true;
		showDrawButtons();
		const name = response.opponent_name || drawOpponent;
		showStatus("draw", response.declined ? "The AI declined the draw." : `Draw offered to ${name}.`, MESSAGE_TIME);
		return;
	}
	showDrawButtons();
	console.log(response?.message || "Draw offer failed: no answer from the server");
	showStatus("action", response?.status == 409 ? response.message : "The draw offer didn't go through. Try again.", MESSAGE_TIME);
}

/**
 * @description Decline: the game goes on & the opponent is told. When it fails the offer stands, a move turns it down too
 */
export async function handleDeclineDraw(e) {
	e.preventDefault();
	e.stopPropagation();
	if (!drawIncoming) { return; }
	const response = await declineDraw(game.GAME_URL, game.GAME_ID);
	if (response?.status == 200 || response?.status == 409) { // 409: IT ALREADY ENDED
		drawIncoming = false;
		clearStatus("draw");
		showDrawButtons();
		return;
	}
	console.log(response?.message || "Draw decline failed: no answer from the server");
	showStatus("action", "The draw couldn't be declined. Try again.", MESSAGE_TIME);
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
	resultReason.hidden = true;
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
 * @description Game going: Forfeit -> "Are you sure?" -> forfeits. Game over: Rematch, starts when both players press it within 5 minutes
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
	if (rematchResponse?.waiting) { // WAIT FOR THE OPPONENT UNTIL THE REQUEST RUNS OUT
		clearTimeout(rematchWaiting);
		rematchOpponent = rematchResponse.opponent_name || "your opponent";
		optRestartBtn.innerText = `Waiting for ${rematchOpponent}`; // innerText, THE NAME IS NEVER READ AS HTML
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
	optCancelRematchBtn.parentElement.hidden = true;
	clearStatus("rematch");
}

/**
 * @description Tells the player waiting on a rematch that the opponent isn't on the game page. The request stays open, they can come back
 */
function showOpponentLeft() {
	if (rematchWaiting) { showStatus("rematch", `${rematchOpponent} left the game. You can keep waiting or cancel.`); }
}

/**
 * @description Cancel: takes back the rematch request. Too late when the opponent just pressed, the socket's "rematch" brings the new game
 */
export async function handleCancelRematch(e) {
	e.preventDefault();
	e.stopPropagation();
	if (!rematchWaiting) { return; }
	const response = await cancelRematch(game.GAME_URL, game.GAME_ID);
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
 * @description Locks the board & opens the menu with the server's result. AI games offer Restart, friend games offer Rematch
 * @param  {[object]} result [{ winner: "w" | "b" | "draw", reason }]
 */
export function showGameOver(result) {
	if (game.gameOver) { return; } // ALREADY SHOWN
	game.gameOver = true;
	openMenu();
	game.opposingMove = true; // NO MORE MOVES (AFTER openMenu, GOING BACK UNLOCKS THE BOARD)
	optResumeBtn.parentElement.style.display = 'none';
	optDrawBtn.parentElement.hidden = true;
	drawSent = false;
	drawIncoming = false;
	clearStatus("draw");
	showDrawButtons();
	if (result?.reason == "forfeit") { resultDisplay.innerText = result.winner == 'w' ? "Black Forfeits" : "White Forfeits" } // THE TITLE ONLY FITS ONE LINE
	else if (result?.winner == 'w') { resultDisplay.innerText = "White Wins!" }
	else if (result?.winner == 'b') { resultDisplay.innerText = "Black Wins!" }
	else { resultDisplay.innerText = "Draw" }
	resultReason.innerText = RESULT_REASONS[result?.reason] || "";
	resultReason.hidden = !resultReason.innerText;
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
	if (rematchWaiting) { cancelRematch(game.GAME_URL, game.GAME_ID); } // THE REQUEST ONLY STANDS WHILE THEY'RE HERE, A LATE PRESS WOULD START A GAME WITHOUT THEM
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
