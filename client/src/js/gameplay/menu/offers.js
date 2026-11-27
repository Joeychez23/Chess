// Owns takeback & draw offers (their flags, buttons, prompts & socket events) and showGameOver, which clears those flags
const { game, chessInst } = require("../state/index.js"); // THE GAME'S SHARED STATE
const { validate, takeback, declineTakeback, offerDraw, declineDraw } = require("../validate/index.js"); // REQUESTS TO THE CHESS SERVER (/api/chess)
const { getRestartPieces } = require("../animate/index.js"); // THE PIECES SLIDING HOME AFTER RESTART & REMATCH
const { clearTouch } = require("../input/index.js"); // REMOTE-ONLY MODE: SELECTS A MENU BUTTON, LETS GO OF A TOUCH
const { handleRemoteMenuEnter } = require("../input/keys.js"); // REMOTE-ONLY MODE: SELECTS A MENU BUTTON
const { revertUnfinishedMove } = require("../moves/index.js"); // LOADS THE GAME, A FRIEND'S MOVE FROM THE SOCKET, RESETS THE BOARD, TAKES BACK A MOVE THAT ISN'T FINISHED
const { showStatus, clearStatus, MESSAGE_TIME } = require("../status/index.js"); // THE MESSAGE AREA ON THE PLAY PAGE
const { syncAnalysis } = require("../analysis/index.js"); // THE HINT, WHAT A GAME FROM THE SERVER MEANS FOR THE HINT & THE EVALUATION BAR
const { disarmConfirm } = require("../../pages/utils/confirm.js"); // FORFEIT & LOGOUT NEED A SECOND PRESS
const { setUnavailable, setFill, stopFill } = require("../../pages/utils/menuItem.js"); // THE MENU ITEMS' STATES, LIKE THE OTHER PAGES
const { offerFrom } = require("../monitor/data.js"); // PURE, NO DOM
const { endMomentFor } = require("../bots/index.js"); // WHAT THE AI'S BOT SAYS WHEN THE GAME ENDS (#76)
const { sayLine } = require("../bots/say.js"); // & SAYS IT BESIDE THE BOARD
import { moveInFlight, optBtn, syncDeadline, optRestartBtn, optResumeBtn, openMenu } from "./index.js";
import { loadNewBoard, monitorHoldsMenu, placeEndGroup, showResult, optReplayBtn, resultAnnouncement, resultDisplay, resultReason } from "./endGame.js";

export const optTakebackBtn = document.getElementById("optTakeback"); // MENU: TAKEBACK, WHILE THE GAME IS GOING
export const optDrawBtn = document.getElementById("optDraw"); // MENU: OFFER DRAW, WHILE THE GAME IS GOING
const drawPrompt = document.getElementById("drawPrompt"); // ACCEPT & DECLINE, WHILE THE OPPONENT'S OFFER STANDS
const takebackPrompt = document.getElementById("takebackPrompt"); // ACCEPT & DECLINE, WHILE THE OPPONENT'S TAKEBACK REQUEST STANDS
/**
 * @description The draw offer as the 3D monitor's terminal reads it
 * @return {[string|null]} ["sent" | "incoming" | null]
 */
export function drawOffer() {
	return offerFrom(drawSent, drawIncoming);
}

/**
 * @description The takeback request as the 3D monitor's terminal reads it
 * @return {[string|null]} ["sent" | "incoming" | null]
 */
export function takebackOffer() {
	return offerFrom(takebackSent, takebackIncoming);
}

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
	else if (takebackIncoming) { optTakebackBtn.innerText = "Accept Takeback"; } // THE SAME PRESS ACCEPTS, REMOTE-ONLY MODE CAN ONLY REACH THE MENU
	else if (takebackSent) { optTakebackBtn.innerText = "Takeback Asked"; }
	else { optTakebackBtn.innerText = takebacksLeft === null ? "Takeback" : `Takeback (${takebacksLeft} left)`; }
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
export function handleTakebackEvent({ state, mine, board }) {
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
	else if (drawIncoming) { optDrawBtn.innerText = "Accept Draw"; } // THE SAME PRESS ACCEPTS, REMOTE-ONLY MODE CAN ONLY REACH THE MENU
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
export function handleDrawEvent({ state, mine }) {
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

/**
 * @description Locks the board & opens the menu with the server's result (not while the player is at the 3D room's monitor, it shows the result). AI games offer Restart, friend games offer Rematch
 * @param  {[object]} result [{ winner: "w" | "b" | "draw", reason }]
 * @param  {[boolean]} onLoad [true: the game was already over when it loaded, the bot doesn't speak about it again]
 */
export function showGameOver(result, onLoad) {
	if (game.gameOver) { return; } // ALREADY SHOWN
	game.gameOver = true;
	game.result = result; // THE 3D ROOM'S MONITOR SHOWS IT (gameplay/renderer)
	if (game.ai && !onLoad) { sayLine(endMomentFor(result, game.playerColor == "w" ? "b" : "w")); } // THE BOT WON OR LOST, A DRAW SAYS NOTHING
	syncDeadline(null);
	disarmConfirm(); // THE GAME THE QUESTION WAS ABOUT ENDED, BEFORE THE BUTTON BECOMES REMATCH
	stopFill(optRestartBtn); // A FORFEIT WAS WAITING ON THE SERVER, IT'S ANSWERED OR THE GAME ENDED ANOTHER WAY
	const zoomed = monitorHoldsMenu(); // THE PLAYER IS AT THE 3D ROOM'S MONITOR: IT SHOWS THE RESULT, THE MENU STAYS SHUT UNTIL THEY OPEN IT
	if (!zoomed) { openMenu(); }
	else { // WHAT OPENING THE MENU DOES (onOpen): A HELD PIECE OR OPEN PROMOTION PICKER GOES BACK NOW, NOT AT THE NEXT OPEN (IT WOULD UNLOCK THE BOARD)
		clearTouch();
		revertUnfinishedMove();
	}
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
	showResult(result);
	optRestartBtn.innerHTML = game.ai ? "Restart" : "Rematch";
	optReplayBtn.href = `/replay/${encodeURIComponent(game.GAME_ID)}`; // STEP THROUGH THE GAME THAT JUST ENDED (#78)
	optReplayBtn.parentElement.hidden = !game.SIGNED_IN || game.readOnly || Boolean(game.cardGame); // THE REPLAY PAGE IS FOR SIGNED IN PLAYERS & DOESN'T KNOW THE CARDS
	if (!zoomed) {
		handleRemoteMenuEnter(optRestartBtn); // REMOTE-ONLY MODE: SELECT RESTART / REMATCH
		if (!game.REMOTE_ONLY_CONDITIONAL) { optRestartBtn.focus(); } // KEYBOARD: THE NEXT THING TO PRESS
	}
	resultAnnouncement.textContent = `${resultDisplay.innerText} ${resultReason.innerText}`.trim(); // AFTER THE FOCUS MOVES, A SCREEN READER READS THE BUTTON THEN THIS
}
