/*
 *  index.js  --  chess frontend
 *	Analysis
 *	The menu's Hint & the evaluation bar beside the board. Both come from the engine through the server (POST /game/:gameId/analysis), which only answers
 *	for AI games & finished games: a hint in a friend game is cheating. syncAnalysis follows each game from the server, so the bar moves after each move.
 *	Hint is for AI games that are going, the bar for those & any finished game. The bar is HTML over the canvas, renderBoard() places it (placeEvalBar)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, EVAL_BAR_ROOM } = require("../state/index.js"); // THE GAME'S SHARED STATE, THE SPACE THE BAR TAKES NEXT TO THE BOARD
const { getAnalysis } = require("../validate/index.js"); // REQUESTS TO THE CHESS SERVER (/api/chess)
const { showStatus, MESSAGE_TIME } = require("../status/index.js"); // THE MESSAGE AREA ON THE PLAY PAGE
const { setFill, stopFill } = require("../../pages/utils/menuItem.js"); // THE FILL WHILE THE SERVER THINKS
const optHintBtn = document.getElementById("optHint"); // MENU: HINT
const optEvalBarBtn = document.getElementById("optEvalBar"); // MENU: EVALUATION BAR ON / OFF
const evalBar = document.getElementById("evalBar"); // THE BAR
const evalBarFill = document.getElementById("evalBarFill"); // WHITE'S SHARE OF IT

const EVAL_BAR_KEY = "EVAL_BAR"; // localStorage: "on" WHEN THE PLAYER TURNED THE BAR ON, GUESTS TOO

let board = null; // THE LATEST BOARD FROM THE SERVER
let barAllowed = false; // AN AI GAME OR A FINISHED GAME
let barOn = false; // THE PLAYER'S BUTTON
let barBoard = null; // THE BOARD THE BAR WAS LAST ASKED ABOUT, SO EACH ONE IS ONLY ASKED ONCE
let barPlacedFor = null; // THE BOARD SIZE & SIDE THE BAR WAS LAST PLACED FOR
let hintLoading = false; // A SECOND PRESS WAITS FOR THE FIRST
let running = null; // { board, answer } THE REQUEST THE SERVER IS WORKING ON, IT ONLY TAKES ONE AT A TIME PER GAME

/* ---------------------------------------------------------------- */
// Ask The Server
/* ---------------------------------------------------------------- */
/**
 * @description Asks about a board, one request at a time: the same board shares the running request, another board waits for it
 * @param  {[string]} asked [the board]
 * @return {[object]} response [{ status, game_board, from, to, eval, mate, winChance, message }, nothing with no answer]
 */
async function analyze(asked) {
	while (running && running.board != asked) { await running.answer; }
	if (!running) {
		running = { board: asked, answer: getAnalysis(game.GAME_URL, game.GAME_ID).finally(function () { running = null; }) };
	}
	return running.answer;
}

/* ---------------------------------------------------------------- */
// Sync
/* ---------------------------------------------------------------- */
/**
 * @description Follows a game from the server: which buttons it gets, a new board ends the hint & the bar asks about it
 * @param  {[object]} response [game from the server]
 */
export function syncAnalysis(response) {
	if (!response?.game_board) { return; }
	const over = response.state == "CLOSED";
	barAllowed = Boolean(response.ai) || over;
	optHintBtn.parentElement.hidden = !response.ai || over;
	optEvalBarBtn.parentElement.hidden = !barAllowed;
	if (response.game_board != board || over) {
		game.hint = null;
		game.refresh = true;
	}
	board = response.game_board;
	showBar();
	updateBar();
}

/* ---------------------------------------------------------------- */
// Hint
/* ---------------------------------------------------------------- */
/**
 * @description Highlights a good move on the player's turn (drawHint), until the next move. Refused while the AI moves
 * @return {[boolean]} shown
 */
export async function showHint() {
	if (hintLoading || !game.ai || game.gameOver || game.boardReset) { return false; }
	if (game.opposingMove || game.aiTurn) {
		showStatus("action", "Wait for the AI's move to finish.", MESSAGE_TIME);
		return false;
	}
	hintLoading = true;
	optHintBtn.innerText = "Thinking";
	setFill(optHintBtn);
	const asked = board;
	const response = await analyze(asked);
	hintLoading = false;
	optHintBtn.innerText = "Hint";
	stopFill(optHintBtn);
	if (board != asked) { return false; } // A TAKEBACK OR RESTART LANDED FIRST
	if (response?.status != 200 || response.game_board != asked || !response.from) {
		console.log(response?.message || "Hint failed: no answer from the server");
		showStatus("action", "No hint right now. Try again.", MESSAGE_TIME);
		return false;
	}
	game.hint = [response.from, response.to];
	game.refresh = true;
	return true;
}

/* ---------------------------------------------------------------- */
// Evaluation Bar
/* ---------------------------------------------------------------- */
/**
 * @description Reads the saved setting when the game starts & sets the button's words
 */
export function loadEvalBar() {
	try { barOn = localStorage.getItem(EVAL_BAR_KEY) == "on"; } catch { barOn = false; } // STORAGE BLOCKED (PRIVATE MODE)
	setBarWords();
}

/**
 * @description The words say what a press will do
 */
function setBarWords() {
	optEvalBarBtn.innerText = barOn ? "Turn Eval Bar: Off" : "Turn Eval Bar: On";
}

/**
 * @description Turns the bar on or off & saves it, the menu stays open
 */
export function handleEvalBar(e) {
	e.preventDefault();
	e.stopPropagation();
	barOn = !barOn;
	barBoard = null; // TURNED BACK ON: IT ASKS AGAIN, THE BOARD MAY HAVE CHANGED
	setBarWords();
	try { localStorage.setItem(EVAL_BAR_KEY, barOn ? "on" : "off"); } catch { } // NOT SAVED (PRIVATE MODE) -> ONLY UNTIL THE PAGE RELOADS
	showBar();
	updateBar();
}

/**
 * @description Shows or hides the bar. The move list makes room for it, so the next frame places that again
 */
function showBar() {
	const shown = barOn && barAllowed;
	evalBar.hidden = !shown;
	if (shown != game.evalBarShown) {
		game.evalBarShown = shown;
		game.refresh = true;
	}
}

/**
 * @description Asks about the latest board. The bar keeps its last answer until the new one comes. An answer for an old board is dropped, the new board asked for itself
 */
async function updateBar() {
	if (!barOn || !barAllowed || board == barBoard) { return; }
	const asked = board;
	barBoard = asked;
	const response = await analyze(asked);
	if (board != asked || !barOn) { return; }
	if (response?.status != 200 || response.game_board != asked || typeof response.winChance != "number") {
		console.log(response?.message || "Evaluation failed: no answer from the server");
		showStatus("action", "The evaluation isn't available right now.", MESSAGE_TIME);
		return;
	}
	const whiteChance = Math.round(response.winChance);
	evalBarFill.style.height = `${whiteChance}%`; // winChance IS FROM WHITE'S SIDE, placeEvalBar PUTS WHITE'S END ON WHITE'S SIDE OF THE BOARD
	evalBar.setAttribute("aria-label", `Evaluation: White's win chance is ${whiteChance}%`);
}

/**
 * @description Puts the bar beside the board, renderBoard() calls this every frame so it only does the work when something changed.
 * White's share fills from White's side of the board: the bottom, or the top when black is at the bottom
 * @param  {[number]} xBoardStart [left of the board image]
 * @param  {[number]} yBoardStart [top of the board image]
 * @param  {[number]} boardHeight [height of the board image]
 */
export function placeEvalBar(xBoardStart, yBoardStart, boardHeight) {
	const place = `${xBoardStart},${yBoardStart},${boardHeight},${game.viewColor}`;
	if (place == barPlacedFor) { return; }
	barPlacedFor = place;
	evalBar.classList.toggle("flipped", game.viewColor == 'b');
	evalBar.style.left = `${Math.max(xBoardStart - EVAL_BAR_ROOM, 2)}px`;
	evalBar.style.top = `${yBoardStart}px`;
	evalBar.style.height = `${boardHeight}px`;
}
