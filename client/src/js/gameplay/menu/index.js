/*
 *  index.js  --  chess frontend
 *	Menu
 *	The in game menu (the 3 line button, Resume, Hint, Takeback, Offer Draw, Type a Move, Sound, Flip Board, Eval Bar, Download PGN, Forfeit / Restart / Rematch, Home & Exit), loading a new board in place
 *	for Restart, Rematch & Takeback (the pieces slide home, gameplay/animate/index.js) & the game over screen. Also the friend game
 *	socket's handlers (socketHandlers: a move, a forfeit, a draw offer, a takeback or a rematch), startGame & loadRematch join with them
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, chessInst, stopFrames } = require("../state/index.js"); // THE GAME'S SHARED STATE
const { validate, restartGame, forfeitGame, takeback, declineTakeback, offerDraw, declineDraw, rematchGame, cancelRematch, getPgn } = require("../validate/index.js"); // REQUESTS TO THE CHESS SERVER (/api/chess)
const { handleInitialData } = require("../draw/index.js"); // NEW drawScreen FOR THE PLAYER'S COLOR
const { getRestartPieces, startRestartSlide } = require("../animate/index.js"); // THE PIECES SLIDING HOME AFTER RESTART & REMATCH
const { handleRemoteMenuEnter, clearRemoteSelection, clearTouch } = require("../input/index.js"); // TV REMOTE: SELECTS A MENU BUTTON, LETS GO OF A TOUCH
const { setInitialData, checkOpponentMove, refreshData, revertUnfinishedMove } = require("../moves/index.js"); // LOADS THE GAME, A FRIEND'S MOVE FROM THE SOCKET, RESETS THE BOARD, TAKES BACK A MOVE THAT ISN'T FINISHED
const { InternalAuth } = require("../../auth/index.js"); // LOGOUT IS A POST TO THE SERVER (#297)
const { joinGame, leaveGame } = require("../../socket/index.js"); // FRIEND GAMES: THE SERVER PUSHES MOVES, FORFEITS & REMATCHES
const { showStatus, clearStatus, MESSAGE_TIME } = require("../status/index.js"); // THE MESSAGE AREA ON THE PLAY PAGE
const { showHint, syncAnalysis } = require("../analysis/index.js"); // THE HINT, WHAT A GAME FROM THE SERVER MEANS FOR THE HINT & THE EVALUATION BAR
const { confirmPress, disarmConfirm } = require("../../pages/utils/confirm.js"); // FORFEIT & LOGOUT NEED A SECOND PRESS
const { createNav } = require("../../pages/utils/nav.js"); // OPENS & CLOSES THE MENU, LIKE THE OTHER PAGES
const { setUnavailable, setFill, stopFill, isBusy, fillThenGo } = require("../../pages/utils/menuItem.js"); // THE MENU ITEMS' STATES, LIKE THE OTHER PAGES
const { timeLeftText } = require("../../pages/utils/timeLeft.js"); // A TIME LIMIT'S TIME LEFT
const optBtn = document.getElementById("optBtn"); // MENU BUTTON (3 LINES, TOP RIGHT), OPENS THE MENU
const optResumeBtn = document.getElementById("optResume"); // MENU: RESUME
const optPgnBtn = document.getElementById("optPgn"); // MENU: DOWNLOAD PGN
const optSoundBtn = document.getElementById("optSound"); // MENU: SOUND ON / OFF
const optRestartBtn = document.getElementById("optRestart"); // MENU: FORFEIT, THEN RESTART (AI GAMES) OR REMATCH (FRIEND GAMES)
const optHomepageBtn = document.getElementById("optHome"); // MENU: HOMEPAGE
const optExitBtn = document.getElementById("optExit"); // MENU: LOGOUT (SIGNED IN) / LOGIN/SIGNUP (GUESTS)
const resultDisplay = document.getElementById("resultDisplay"); // MENU TITLE ("Chess" OR THE RESULT)
const resultReason = document.getElementById("resultReason"); // THE LINE UNDER THE RESULT, HOW THE GAME ENDED
const resultAnnouncement = document.getElementById("resultAnnouncement"); // SCREEN READERS ARE TOLD THE RESULT HERE
const optCancelRematchBtn = document.getElementById("optCancelRematch"); // MENU: CANCEL, WHILE A REMATCH REQUEST WAITS
const optTakebackBtn = document.getElementById("optTakeback"); // MENU: TAKEBACK, WHILE THE GAME IS GOING
const optDrawBtn = document.getElementById("optDraw"); // MENU: OFFER DRAW, WHILE THE GAME IS GOING
const drawPrompt = document.getElementById("drawPrompt"); // ACCEPT & DECLINE, WHILE THE OPPONENT'S OFFER STANDS
const takebackPrompt = document.getElementById("takebackPrompt"); // ACCEPT & DECLINE, WHILE THE OPPONENT'S TAKEBACK REQUEST STANDS

const SOUND_KEY = "SOUND"; // localStorage: "off" WHEN THE PLAYER TURNED SOUND OFF, GUESTS TOO
const RESULT_REASONS = { // THE SERVER'S REASON -> THE LINE UNDER THE RESULT. A FORFEIT IS ALREADY IN THE TITLE
	"checkmate": "by Checkmate",
	"stalemate": "by Stalemate",
	"insufficient material": "by insufficient material",
	"fifty-move rule": "by the fifty-move rule",
	"threefold repetition": "by threefold repetition",
	"agreement": "by agreement",
	"timeout": "on time",
};
const DEADLINE_TICK = 30 * 1000; // HOW OFTEN THE TIME LEFT IS REDRAWN (ms)
const moveDeadlineText = document.getElementById("moveDeadline");
let deadlineTimer = null; // REDRAWS THE TIME LEFT WHILE A GAME WITH A TIME LIMIT IS GOING
let pgnLoading = false; // A SECOND PRESS WHILE THE PGN LOADS WOULD SAVE TWO FILES
let rematchWaiting = false; // TIMER WHILE THE REMATCH REQUEST WAITS ON THE OPPONENT'S PRESS
let rematchOpponent = null; // THE NAME THE REQUEST IS WAITING FOR
let drawBoard = null; // THE BOARD drawSent & drawIncoming ARE ABOUT, A MOVE ENDS THEM
let drawSent = false; // THIS PLAYER USED THEIR OFFER FOR THIS MOVE
let drawIncoming = false; // THE OPPONENT'S OFFER IS STANDING
let drawLoading = false; // THE AI CAN TAKE A FEW SECONDS TO ANSWER
let drawOpponent = "Your opponent"; // THE NAME THE MESSAGES USE
let takebackBoard = null; // THE BOARD takebackSent & takebackIncoming ARE ABOUT, A MOVE ENDS THEM
let takebackSent = false; // FRIEND GAMES: THIS PLAYER ASKED FOR THIS MOVE
let takebackIncoming = false; // THE OPPONENT'S REQUEST IS STANDING
let takebackLoading = false; // THE REQUEST IS SAVING
let takebacksLeft = null; // FRIEND GAMES' TAKEBACKS LEFT, AI GAMES HAVE NO LIMIT: null
const TAKEBACK_RETRY_TIME = 500; // LOADS THE EARLIER BOARD AGAIN AFTER THIS WHEN IT WASN'T READY (ms)
const TAKEBACK_RETRIES = 6;
export const socketHandlers = { // SOCKET EVENT -> HANDLER
	move: checkOpponentMove,
	gameOver: showGameOver,
	drawOffer: handleDrawEvent,
	takeback: handleTakebackEvent,
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
const nav = createNav({
	/**
	 * @description Every way the menu opens comes through here. A move that isn't finished goes back (revertUnfinishedMove) &
	 * no piece stays hovered, so pieces can't be touched until the menu closes
	 */
	onOpen() {
		clearTouch();
		revertUnfinishedMove();
		for (let i = 0; i < game.tiles.length; i++) { game.tiles[i].isHovering = false; }
		game.menuToggled = true;
		game.refresh = true;
	},
	onClose() { game.menuToggled = false; clearRemoteSelection(); },
	canClose() { return !game.boardReset; }, // THE MENU STAYS OPEN WHILE A NEW BOARD LOADS, THE OLD BOARD UNDER IT IS LOCKED
	arrowStops() { // LEFT & RIGHT GO THAT WAY ON SCREEN (THE BOX CAN BE DRAGGED), THE ONES NOT ON SCREEN ARE SKIPPED
		const stops = ["optBtn", "moveBoxInput", "moveListToggle"].map((id) => document.getElementById(id));
		return stops.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
	},
});

/**
 * @description Turns on the menu button, a click away & Escape. Clicks on the board are handled by handleCanvasClick (input/index.js), it stops them before they get to the page
 */
export const addMenuListeners = nav.addListeners;

export function openMenu() { nav.toggleNav(true); }

/**
 * @description Back to the game or, when it's over, a look at the final position (reopening the menu still shows the result)
 */
export function closeMenu() { nav.toggleNav(false); }

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
 * @description Is a piece sliding or the player's move saving? Its tile's place in tiles is held by the code finishing the move
 * & game.response doesn't have a move that's saving, so the board can't flip until it's done
 */
function moveInFlight() {
	return game.moveSaving || game.currSlide || game.tiles.some(function (tile) { return tile.isSliding; });
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
 * @description Flips the board, the menu stays open. During a slide or a move's save it flips when that's done (a second press cancels it)
 */
export function handleFlip(e) {
	e.preventDefault();
	e.stopPropagation();
	if (game.boardReset) { return; } // A NEW BOARD IS LOADING, IT STARTS FROM THE PLAYER'S SIDE
	if (moveInFlight()) { game.flipPending = !game.flipPending; return; }
	flipBoard();
}

/**
 * @description The render loop calls this before each frame, it does the flip that waited for a slide
 */
export function flipWhenDone() {
	if (game.flipPending && !moveInFlight()) { flipBoard(); }
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
	optPgnBtn.innerText = "Downloading";
	setFill(optPgnBtn);
	const response = await getPgn(game.GAME_URL, game.GAME_ID);
	pgnLoading = false;
	optPgnBtn.innerText = "Download PGN";
	stopFill(optPgnBtn);
	if (response?.status != 200) { return showStatus("action", "Couldn't download the PGN. Try again.", MESSAGE_TIME); }

	const url = URL.createObjectURL(new Blob([response.pgn], { type: "application/x-chess-pgn" }));
	const link = document.createElement("a"); // NOT ADDED TO THE PAGE, ITS CLICK WOULD REACH THE PAGE & CLOSE THE MENU
	link.href = url;
	link.download = response.filename;
	link.click();
	setTimeout(function () { URL.revokeObjectURL(url); }, 1000); // THE DOWNLOAD HAS ITS OWN COPY BY THEN
}

/* ---------------------------------------------------------------- */
// Hint Button (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description Asks for a hint, the menu closes when it's on the board so the player can see it. It stays open with a message when there's none
 */
export async function handleHint(e) {
	e.preventDefault();
	e.stopPropagation();
	if (await showHint()) { closeMenu(); }
}

/* ---------------------------------------------------------------- */
// Takeback Button (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description AI games: takes back the player's last move & the AI's reply, the server works out how many. Friend games: asks the opponent (askTakeback), or
 * accepts their request. Refused while a move is in flight (asked for or sliding in). The old board stays on screen until the answer, then the pieces slide to the
 * earlier position. Between the player's move & asking for the AI's there's no request yet, so its timer is stopped & started again if this fails
 */
export async function handleTakeback(e) {
	e.preventDefault();
	e.stopPropagation();
	if (game.boardReset || game.gameOver) { return; }
	if (!game.ai && !takebackIncoming) { return await askTakeback(); }
	if (game.aiTurn || moveInFlight()) { return showStatus("action", game.ai ? "Wait for the AI's move to finish." : "Wait for the move to finish.", MESSAGE_TIME); }
	const fromPieces = getRestartPieces(true); // WHERE THE PIECES ARE NOW, THEY SLIDE BACK FROM HERE
	clearTimeout(game.aiTimer);
	game.boardReset = true; // STOP DRAWING, THE BOARD STAYS ON SCREEN UNDER THE MENU
	game.refresh = false;
	optBtn.style.display = "none";
	takebackLoading = true;
	showTakebackButtons();
	const response = await takeback(game.GAME_URL, game.GAME_ID);
	takebackLoading = false;
	if (response?.status == 409 && !game.ai) { // THE REQUEST ENDED, A MOVE LANDED FIRST
		takebackIncoming = false;
		clearStatus("takeback");
	}
	showTakebackButtons();
	if (response?.status != 200 || !response.game_board) { // THE GAME GOES ON AS IT WAS (THE MENU STAYS OPEN)
		game.boardReset = false;
		optBtn.style.display = "flex";
		game.refresh = true;
		if (game.ai && chessInst.turn() != game.playerColor) { game.aiTurn = true; } // THE TIMER STOPPED ABOVE WOULD HAVE ASKED FOR THE AI'S MOVE
		console.log(response?.message || "Takeback failed: no answer from the server");
		showStatus("action", response?.status == 409 ? response.message : "The takeback didn't go through. Try again.", MESSAGE_TIME);
		return;
	}
	await loadNewBoard(fromPieces, response);
}

/**
 * @description Friend games: asks the opponent for a takeback, the menu stays open. Their answer comes over the socket. The server refuses a second request at the same move
 */
async function askTakeback() {
	if (takebackLoading || takebackSent) { return; }
	if (moveInFlight()) { return showStatus("action", "Wait for the move to finish.", MESSAGE_TIME); }
	takebackLoading = true;
	showTakebackButtons();
	const response = await takeback(game.GAME_URL, game.GAME_ID);
	takebackLoading = false;
	if (response?.game_board) { return await loadTakeback(response); } // THE OPPONENT'S REQUEST LANDED FIRST, THIS PRESS ACCEPTED IT
	if (response?.requested) {
		takebackSent = true;
		showTakebackButtons();
		showStatus("takeback", `Takeback asked of ${response.opponent_name || drawOpponent}.`, MESSAGE_TIME);
		return;
	}
	showTakebackButtons();
	console.log(response?.message || "Takeback request failed: no answer from the server");
	showStatus("action", response?.status == 409 ? response.message : "The takeback request didn't go through. Try again.", MESSAGE_TIME);
}

/**
 * @description Decline: the game goes on & the opponent is told. When it fails the request stands, a move turns it down too
 */
export async function handleDeclineTakeback(e) {
	e.preventDefault();
	e.stopPropagation();
	if (!takebackIncoming) { return; }
	const response = await declineTakeback(game.GAME_URL, game.GAME_ID);
	if (response?.status == 200 || response?.status == 409) { // 409: IT ALREADY ENDED
		takebackIncoming = false;
		clearStatus("takeback");
		showTakebackButtons();
		return;
	}
	console.log(response?.message || "Takeback decline failed: no answer from the server");
	showStatus("action", "The takeback couldn't be declined. Try again.", MESSAGE_TIME);
}

/**
 * @description Sets the words & state on Takeback & shows Accept / Decline while the opponent's request stands. Asked already: nothing to press until a move
 */
function showTakebackButtons() {
	takebackPrompt.hidden = !takebackIncoming;
	setUnavailable(optTakebackBtn, takebackSent && !takebackIncoming && !takebackLoading);
	if (takebackLoading) { setFill(optTakebackBtn); }
	else { stopFill(optTakebackBtn); }
	if (takebackLoading) { optTakebackBtn.innerText = game.ai || takebackIncoming ? "Taking Back" : "Asking"; }
	else if (takebackIncoming) { optTakebackBtn.innerText = "Accept Takeback"; } // THE SAME PRESS ACCEPTS, THE TV REMOTE CAN ONLY REACH THE MENU
	else if (takebackSent) { optTakebackBtn.innerText = "Takeback Asked"; }
	else { optTakebackBtn.innerText = takebacksLeft === null ? "Takeback" : `Takeback (${takebacksLeft} left)`; }
}

/**
 * @description Shows the time left in a friend game with a time limit, redrawn while the game goes on. Once it runs out, loading the game
 * closes it on the server, & the socket's "game-over" opens the menu on both boards
 * @param  {[object]} response [game from the server, null when the game ended]
 */
function syncDeadline(response) {
	clearInterval(deadlineTimer);
	deadlineTimer = null;
	moveDeadlineText.textContent = "";
	const deadline = response?.state == "OPEN" ? response.move_deadline : null;
	if (!deadline) { return; }
	const whose = response.game_board.split(" ")[1] == game.playerColor ? "Your move" : "Their move";
	const draw = () => { moveDeadlineText.textContent = `${whose} // ${timeLeftText(deadline)}`; };
	draw();
	deadlineTimer = setInterval(() => { // ONLY ON A TICK: THIS LOAD SYNCS AGAIN, A CLOCK AHEAD OF THE SERVER WOULD ASK NON-STOP
		draw();
		if (deadline * 1000 <= Date.now()) { checkOpponentMove(); }
	}, DEADLINE_TICK);
}

/**
 * @description Brings the takeback request up to date with a game from the server. A new board means a move or a takeback, which ends any request.
 * On the same board this only adds what it finds, a read can be from before the request the socket just told about
 * @param  {[object]} response [game from the server]
 */
function syncTakeback(response) {
	syncDeadline(response);
	takebacksLeft = response.ai ? null : response.takebacks_left ?? null;
	optTakebackBtn.parentElement.hidden = response.state != "OPEN" || takebacksLeft === 0;
	if (response.game_board != takebackBoard) {
		takebackBoard = response.game_board;
		takebackSent = false;
		takebackIncoming = false;
		clearStatus("takeback");
	}
	if (response.takeback_request == game.playerColor) { takebackSent = true; }
	else if (response.takeback_request) { showIncomingTakeback(); }
	showTakebackButtons();
}

/**
 * @description The opponent's request is standing, the message area reads it out
 */
function showIncomingTakeback() {
	takebackIncoming = true;
	showStatus("takeback", `${drawOpponent} asks for a takeback`);
}

/**
 * @description The socket's "takeback", another tab of this player's counts too
 * @param  {[object]} event [{ state: "requested" | "declined" | "accepted", mine: this player did it, board: the earlier position when accepted }]
 */
function handleTakebackEvent({ state, mine, board }) {
	if (state == "accepted") { return loadTakeback(undefined, board); }
	if (state == "requested" && mine) { takebackSent = true; }
	else if (state == "requested") { showIncomingTakeback(); }
	else if (mine) { takebackIncoming = false; clearStatus("takeback"); }
	else {
		takebackSent = true;
		showStatus("takeback", `${drawOpponent} declined the takeback.`, MESSAGE_TIME);
	}
	showTakebackButtons();
}

/**
 * @description Friend games: an accepted takeback, the pieces slide to the earlier position. Waits for a move in flight (the server refused it or it's being put back).
 * A read right after the save can return the old board, so it reads again until it has the one the socket said
 * @param  {[object]} read [the game when it's already been read, left out = reads it]
 * @param  {[string]} board [the earlier position from the socket, already on it = this tab accepted]
 * @param  {[number]} tries [reads so far]
 */
export async function loadTakeback(read, board, tries = 0) {
	const again = function () { setTimeout(function () { loadTakeback(undefined, board, tries + 1); }, TAKEBACK_RETRY_TIME); };
	if (game.gameOver || game.boardReset) { return; }
	if (board && board == game.response?.game_board) { return; }
	if (moveInFlight()) { setTimeout(function () { loadTakeback(undefined, board, tries); }, TAKEBACK_RETRY_TIME); return; }
	const response = read || await validate(game.GAME_URL, game.GAME_ID, game.PLAYER_ID, false, false, false);
	if (game.gameOver || game.boardReset) { return; }
	if (moveInFlight()) { setTimeout(function () { loadTakeback(undefined, board, tries); }, TAKEBACK_RETRY_TIME); return; }
	if (response?.status != 200 || !response.game_board) {
		if (tries < TAKEBACK_RETRIES) { return again(); }
		console.log(response?.message || "Takeback failed to load: no answer from the server");
		return showStatus("server", "The game couldn't be loaded. Reload the page to try again.");
	}
	if (board && response.game_board != board && tries < TAKEBACK_RETRIES) { return again(); } // NOT THERE YET, AFTER THE LAST TRY A NEW MOVE MOVED IT ON
	clearTouch();
	revertUnfinishedMove();
	const fromPieces = getRestartPieces(true); // WHERE THE PIECES ARE NOW, THEY SLIDE BACK FROM HERE
	game.boardReset = true; // STOP DRAWING, THE BOARD STAYS ON SCREEN WHILE IT LOADS
	game.refresh = false;
	optBtn.style.display = "none";
	await loadNewBoard(fromPieces, response);
}

/* ---------------------------------------------------------------- */
// Draw Offers (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description Sets the words & state on Offer Draw & shows Accept / Decline while the opponent's offer stands. Offered already: nothing to press until a move
 */
function showDrawButtons() {
	drawPrompt.hidden = !drawIncoming;
	setUnavailable(optDrawBtn, drawSent && !drawIncoming && !drawLoading);
	if (drawLoading) { setFill(optDrawBtn); }
	else { stopFill(optDrawBtn); }
	if (drawLoading) { optDrawBtn.innerText = "Offering"; }
	else if (drawIncoming) { optDrawBtn.innerText = "Accept Draw"; } // THE SAME PRESS ACCEPTS, THE TV REMOTE CAN ONLY REACH THE MENU
	else { optDrawBtn.innerText = drawSent ? "Draw Offered" : "Offer Draw"; }
}

/**
 * @description Brings the draw offer & the takeback request up to date with a game from the server. A new board means a move was made, which ends any offer & gives both players theirs back.
 * On the same board this only adds what it finds, a read can be from before the offer the socket just told about
 * @param  {[object]} response [game from the server]
 */
export function syncDrawOffer(response) {
	if (!response?.game_board) { return; }
	optDrawBtn.parentElement.hidden = response.state != "OPEN";
	syncTakeback(response);
	syncAnalysis(response);
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
 * @description A game that's still going: the button is Forfeit (handleForfeit). Once it's over, friend games: Rematch. AI games: Restart, a new game starts.
 * The old board stays on screen under the menu & Restart says Loading & fills up while it loads, then the pieces slide home (startRestartSlide)
 */
export async function handleRestart(e) {
	e.preventDefault();
	e.stopPropagation();
	if (game.boardReset || isBusy(optRestartBtn)) { return; } // ALREADY LOADING A NEW BOARD OR WAITING ON THE SERVER (A SECOND PRESS, THE TV REMOTE'S ENTER)
	if (!game.gameOver) { return await handleForfeit(); }
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
 * @description Loads GAME_ID's board in place (restart, rematch & takeback), the canvas, listeners & render loop stay the same.
 * The old board stays on screen while it loads, then the menu closes & the pieces slide home (startRestartSlide)
 * @param  {[array]} fromPieces [where the old game's pieces were, getRestartPieces(true)]
 * @param  {[object]} loaded [a takeback: the game from its answer, setInitialData doesn't read it again & Restart doesn't fill]
 */
async function loadNewBoard(fromPieces, loaded) {
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
function showOpponentLeft() {
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
function placeEndGroup(top) {
	const group = optRestartBtn.closest("ul");
	const focused = document.activeElement;
	if (top) { group.parentElement.prepend(group); }
	else { group.parentElement.insertBefore(group, optHomepageBtn.closest("ul")); }
	if (group.contains(focused)) { focused.focus(); }
}

/**
 * @description Locks the board & opens the menu with the server's result. AI games offer Restart, friend games offer Rematch
 * @param  {[object]} result [{ winner: "w" | "b" | "draw", reason }]
 */
export function showGameOver(result) {
	if (game.gameOver) { return; } // ALREADY SHOWN
	game.gameOver = true;
	syncDeadline(null);
	disarmConfirm(); // THE GAME THE QUESTION WAS ABOUT ENDED, BEFORE THE BUTTON BECOMES REMATCH
	stopFill(optRestartBtn); // A FORFEIT WAS WAITING ON THE SERVER, IT'S ANSWERED OR THE GAME ENDED ANOTHER WAY
	openMenu();
	game.opposingMove = true; // NO MORE MOVES (AFTER openMenu, GOING BACK UNLOCKS THE BOARD)
	optResumeBtn.parentElement.hidden = true;
	placeEndGroup(true);
	optDrawBtn.parentElement.hidden = true;
	optTakebackBtn.parentElement.hidden = true;
	syncAnalysis({ ...game.response, state: "CLOSED" }); // A FORFEIT COMES OVER THE SOCKET WITHOUT A GAME
	drawSent = false;
	drawIncoming = false;
	clearStatus("draw");
	showDrawButtons();
	takebackSent = false;
	takebackIncoming = false;
	clearStatus("takeback");
	showTakebackButtons();
	if (result?.reason == "forfeit") { resultDisplay.innerText = result.winner == 'w' ? "Black Forfeits" : "White Forfeits" } // THE TITLE ONLY FITS ONE LINE
	else if (result?.winner == 'w') { resultDisplay.innerText = "White Wins!" }
	else if (result?.winner == 'b') { resultDisplay.innerText = "Black Wins!" }
	else { resultDisplay.innerText = "Draw" }
	resultReason.innerText = RESULT_REASONS[result?.reason] || "";
	resultReason.hidden = !resultReason.innerText;
	optRestartBtn.innerHTML = game.ai ? "Restart" : "Rematch";
	handleRemoteMenuEnter(optRestartBtn); // TV REMOTE: SELECT RESTART / REMATCH
	if (!game.TV_BOOL) { optRestartBtn.focus(); } // KEYBOARD: THE NEXT THING TO PRESS
	resultAnnouncement.textContent = `${resultDisplay.innerText} ${resultReason.innerText}`.trim(); // AFTER THE FOCUS MOVES, A SCREEN READER READS THE BUTTON THEN THIS
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
	if (optExitBtn.disabled || !confirmPress(optExitBtn)) { return; } // FIRST PRESS ASKS (THE TV REMOTE'S ENTER ISN'T STOPPED BY disabled)
	optExitBtn.disabled = true;
	optExitBtn.innerText = "Logging Out";
	setFill(optExitBtn);
	if (rematchWaiting) { await cancelRematch(game.GAME_URL, game.GAME_ID); }
	await new InternalAuth().logout();
}
