/*
 *  index.js  --  chess frontend
 *	Analysis
 *	The menu's Hint & the evaluation bar beside the board. Both come from the engine through the server (POST /game/:gameId/analysis), which only answers
 *	for AI games & finished games: a hint in a friend game is cheating. syncAnalysis follows each game from the server, so the bar moves after each move.
 *	Hint is for AI games that are going, the bar for those & any finished game. The bar is HTML over the canvas, renderBoard() places it (placeEvalBar).
 *	The 3D room's monitor has an eval channel too (gameplay/monitor): while it shows (watchEval) the board is asked about with the bar off, & every answer is kept by ply for its graph (evalState)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, EVAL_BAR_ROOM } = require("../state/index.js"); // THE GAME'S SHARED STATE, THE SPACE THE BAR TAKES NEXT TO THE BOARD
const { getAnalysis } = require("../validate/index.js"); // REQUESTS TO THE CHESS SERVER (/api/chess)
const { showStatus, MESSAGE_TIME } = require("../status/index.js"); // THE MESSAGE AREA ON THE PLAY PAGE
const { setFill, stopFill } = require("../../pages/utils/menuItem.js"); // THE FILL WHILE THE SERVER THINKS
const { plyOf, startPlyFor, trimScores } = require("../monitor/data.js"); // A BOARD'S PLY, THE GAME'S START PLY, THE SCORES UP TO IT
const optHintBtn = document.getElementById("optHint"); // MENU: HINT
const optEvalBarBtn = document.getElementById("optEvalBar"); // MENU: EVALUATION BAR ON / OFF
const evalBar = document.getElementById("evalBar"); // THE BAR
const evalBarFill = document.getElementById("evalBarFill"); // WHITE'S SHARE OF IT

const EVAL_BAR_KEY = "EVAL_BAR"; // localStorage: "on" WHEN THE PLAYER TURNED THE BAR ON, GUESTS TOO

let board = null; // THE LATEST BOARD FROM THE SERVER
let barAllowed = false; // AN AI GAME OR A FINISHED GAME
let barOn = false; // THE PLAYER'S BUTTON
let barHidden = false; // THE 3D ROOM'S MONITOR SHOWS THE EVAL INSTEAD (hideEvalBar): A BAR SAVED ON COUNTS AS OFF, THE SAVED SETTING STAYS
let barBoard = null; // THE BOARD THE BAR WAS LAST ASKED ABOUT, SO EACH ONE IS ONLY ASKED ONCE
let barPlacedFor = null; // THE BOARD SIZE & SIDE THE BAR WAS LAST PLACED FOR
let hintLoading = false; // A SECOND PRESS WAITS FOR THE FIRST
let running = null; // { board, answer } THE REQUEST THE SERVER IS WORKING ON, IT ONLY TAKES ONE AT A TIME PER GAME
let watched = false; // THE MONITOR'S EVAL CHANNEL IS SHOWING: IT ASKS LIKE THE BAR DOES
let scores = []; // WHITE'S WIN CHANCE BY PLY (INDEX 0 = THE START), ONLY THE ANSWERS RECEIVED
let scoresFor = null; // THE GAME THEY'RE FOR, A NEW ONE (RESTART, REMATCH) STARTS THEM OVER
let startPly = 0; // THE GAME'S START POSITION'S PLY (A SET POSITION'S IS PAST 0)
let failed = false; // THE LAST ANSWER WAS BAD, THE MONITOR SHOWS "NO SIGNAL" UNTIL A GOOD ONE

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
	if (game.GAME_ID != scoresFor) {
		scoresFor = game.GAME_ID;
		scores = [];
		failed = false;
		startPly = 0;
	}
	startPly = startPlyFor(startPly, response); // ONLY GET /game SENDS start_params, A MOVE'S ANSWER KEEPS THE ONE WE HAVE
	scores = trimScores(scores, boardPly(board)); // A TAKEBACK DROPS THE SCORES PAST THE NEW BOARD
	showBar();
	updateBar();
}

/* ---------------------------------------------------------------- */
// Ply
/* ---------------------------------------------------------------- */
/**
 * @description How many moves the game has on a board, counted from its start position: the scores' index
 * @param  {[string]} fen [the board]
 * @return {[number]} ply [0 at the game's start]
 */
function boardPly(fen) {
	return Math.max(0, plyOf(fen) - startPly);
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

// THE BAR COUNTS AS ON: THE PLAYER TURNED IT ON & THE MONITOR ISN'T SHOWING THE EVAL INSTEAD
function barUsed() {
	return barOn && !barHidden;
}

/**
 * @description Shows or hides the bar. The move list makes room for it, so the next frame places that again
 */
function showBar() {
	const shown = barUsed() && barAllowed;
	evalBar.hidden = !shown;
	if (shown != game.evalBarShown) {
		game.evalBarShown = shown;
		game.refresh = true;
	}
}

/**
 * @description Asks about the latest board while the bar is on or the monitor's eval channel shows. The bar keeps its last answer until the new one comes.
 * An answer for an old board is dropped, the new board asked for itself. A good one is kept by ply, a bad one sets failed (the next good one clears it)
 */
async function updateBar() {
	if (!(barUsed() || watched) || !barAllowed || board == barBoard) { return; }
	const asked = board;
	barBoard = asked;
	const response = await analyze(asked);
	if (board != asked || !(barUsed() || watched)) { return; }
	if (response?.status != 200 || response.game_board != asked || typeof response.winChance != "number") {
		console.log(response?.message || "Evaluation failed: no answer from the server");
		failed = true;
		game.refresh = true; // THE MONITOR SHOWS IT
		if (barUsed()) { showStatus("action", "The evaluation isn't available right now.", MESSAGE_TIME); } // THE MONITOR SAYS "NO SIGNAL" INSTEAD
		return;
	}
	const whiteChance = Math.round(response.winChance);
	scores[boardPly(asked)] = whiteChance; // A GAP BEFORE IT IS null IN evalState()
	failed = false;
	game.refresh = true; // THE MONITOR SHOWS IT
	evalBarFill.style.height = `${whiteChance}%`; // winChance IS FROM WHITE'S SIDE, placeEvalBar PUTS WHITE'S END ON WHITE'S SIDE OF THE BOARD
	evalBar.setAttribute("aria-label", `Evaluation: White's win chance is ${whiteChance}%`);
}

/* ---------------------------------------------------------------- */
// Monitor
/* ---------------------------------------------------------------- */
/**
 * @description The monitor's eval channel is showing (true) or not: while it shows the board is asked about with the bar off. Turned on, it asks again
 * @param  {[boolean]} on
 */
export function watchEval(on) {
	watched = Boolean(on);
	if (!watched) { return; }
	barBoard = null; // ASKS AGAIN, THE ANSWER MAY HAVE BEEN DROPPED WHILE NOBODY WATCHED
	updateBar();
}

/**
 * @description The 3D room's monitor took the bar's place (true) or gave it back: while it's hidden a bar saved on counts as off (no request
 * unless the eval channel shows, no message). Given back, it asks about the current board. The saved setting doesn't change
 * @param  {[boolean]} hidden
 */
export function hideEvalBar(hidden) {
	if (barHidden === Boolean(hidden)) { return; }
	barHidden = Boolean(hidden);
	if (!barHidden) { barBoard = null; } // ASKS AGAIN, THE BOARD MAY HAVE CHANGED
	showBar();
	updateBar();
}

/**
 * @description What the monitor's eval channel shows
 * @return {[object]} { allowed, scores, failed } [allowed: an AI game or a finished one, scores: White's win chance by ply up to the latest board (null where none came)]
 */
export function evalState() {
	return { allowed: barAllowed, scores: trimScores(scores, board ? boardPly(board) : 0), failed };
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
