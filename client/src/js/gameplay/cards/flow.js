/*
 *  flow.js  --  chess frontend
 *	Chess Cards Flow
 *	Runs a card game on the play page, in place of the chess one (startGame in gameplay/index.js, when GET /game/:gameId says mode "cards"): startCards puts the
 *	card route's answer on the board, act sends one of the player's legal actions & while Card Guy owes one (card_guy_due: its turn, a duel pick or a choice)
 *	it's asked for half a second later, like the AI's move. The server decides everything (store.js keeps its answer): the board only shows the view's pieces,
 *	chess.js holds them for the renderer & is never asked what's legal. The table (hands, decks, card faces) shows the rest of the view & the events
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, chessInst } = require("../state/index.js"); // THE GAME'S SHARED STATE, THE BOARD THAT'S DRAWN
const { toFen } = require("../../../../../cards-engine/board.js"); // THE VIEW'S BOARD AS A FEN, THE ENGINE'S OWN (NO OTHER PART OF THE ENGINE IS LOADED)
const { cards, takeResponse } = require("./store.js"); // THE CARD ROUTES' LAST ANSWER
const { sendAction, cardGuyTurn, getCardGuy } = require("./api.js"); // REQUESTS TO THE CARD ROUTES (/api/chess/cards)
const { showBot } = require("../bots/say.js"); // CARD GUY'S NAME BESIDE THE BOARD
const { showGameOver } = require("../menu/offers.js"); // THE GAME OVER SCREEN
const { showStatus, clearStatus, MESSAGE_TIME } = require("../status/index.js"); // THE MESSAGE AREA ON THE PLAY PAGE

const CARD_GUY_WAIT = 500; // MS AFTER AN ANSWER BEFORE CARD GUY'S NEXT ACTION IS ASKED FOR, LIKE THE AI'S MOVE (game.aiTimer IN gameplay/moves/index.js)
const RETRY_WAIT = 5000; // NO ANSWER: ASKED AGAIN THIS MUCH LATER, LIKE THE AI (AI_RETRY_TIME IN gameplay/index.js)
let cardGuyLoop = null; // CARD GUY'S TURNS BEING ASKED FOR (A PROMISE), ONE LOOP AT A TIME

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------------------------------------------------------------- */
// Start
/* ---------------------------------------------------------------- */
/**
 * @description Starts a card game from GET /cards/:gameId: the player's side, the board, Card Guy's name, the menu without what a card game can't use (play.html data-chess-only),
 * the result when it's already over & Card Guy's actions when it owes one (a reload while it was due asks again, the server plays it once)
 * @param  {[object]} response [cardsResponse]
 * @return {[boolean]} loaded [false: no game in the answer (not found, not theirs, from an older version, no answer), the message says so]
 */
export function startCards(response) {
	if (!response?.view) {
		console.log(response?.message || "The card game didn't load");
		showStatus("server", "The game couldn't be loaded. Reload the page to try again.");
		return false;
	}
	game.response = response; // THE CHESS PARTS THAT READ IT FIND NO game_board (syncAnalysis): NO HINT OR EVAL BAR
	game.playerColor = response.you;
	game.viewColor = response.you; // FROM THE PLAYER'S SIDE
	game.opponentColor = response.you === "w" ? "b" : "w";
	game.ai = true; // CARD GUY IS THE AI: RESTART, NOT REMATCH, & NO SOCKET
	game.opposingMove = true; // NOTHING ON THE BOARD IS PICKED UP (THE POINTER'S LISTENERS AREN'T ON EITHER, input/modes.js)
	document.querySelectorAll("[data-chess-only]").forEach((item) => { item.hidden = true; }); // HINT, TAKEBACK, OFFER DRAW, TYPE A MOVE, VIEW, EVAL BAR, PGN & REPLAY: THE MONITOR'S ACTIONS FOLLOW THE MENU
	show(response);
	getCardGuy(game.GAME_URL).then((bot) => { if (bot?.name) { showBot(game.GAME_URL, response, bot); } }); // NOT AWAITED, THE GAME DOESN'T WAIT FOR THE NAME. NO ANSWER: NO NAME
	if (cards.result) { showGameOver(cards.result, true); } // ALREADY OVER WHEN IT LOADED
	else if (cards.cardGuyDue) { playCardGuy(); }
	return true;
}

/* ---------------------------------------------------------------- */
// Act
/* ---------------------------------------------------------------- */
/**
 * @description Plays one of the player's legal actions: sends it, shows the answer, then Card Guy's actions while it owes one. A refused action (409: not legal now, the game is over,
 * or stale: true, another save landed first) carries the game as it is now, so the board is drawn again from it
 * @param  {[object]} action [one of cards.legal]
 * @return {[array]} events [the action's events, [] when it didn't go through]
 */
export async function act(action) {
	const response = await sendAction(game.GAME_URL, game.GAME_ID, action);
	if (!response?.view) {
		console.log(response?.message || "The action didn't go through: no answer from the server");
		showStatus("action", "That didn't go through. Try again.", MESSAGE_TIME);
		return [];
	}
	const events = show(response);
	if (cards.result) { showGameOver(cards.result); }
	else if (cards.cardGuyDue) { playCardGuy(); }
	return events;
}

/* ---------------------------------------------------------------- */
// Card Guy
/* ---------------------------------------------------------------- */
/**
 * @description While Card Guy owes an action, asks the server for it half a second after the last answer & shows each one. No answer: says so & asks again after RETRY_WAIT.
 * Ends when it owes nothing or the game is over (a forfeit too). A second call while it runs joins it
 * @return {[Promise]} loop [done when Card Guy owes nothing]
 */
function playCardGuy() {
	cardGuyLoop ||= (async function () {
		while (cards.cardGuyDue && !cards.result && !game.gameOver) {
			await wait(CARD_GUY_WAIT);
			if (game.gameOver) { break; } // FORFEITED WHILE IT WAITED
			const response = await cardGuyTurn(game.GAME_URL, game.GAME_ID);
			if (!response?.view) {
				console.log(response?.message || "Card Guy's turn: no answer from the server");
				showStatus("ai", "Card Guy isn't answering. Trying again…");
				await wait(RETRY_WAIT);
				continue;
			}
			clearStatus("ai");
			show(response);
		}
		if (cards.result) { showGameOver(cards.result); } // DOES NOTHING WHEN IT'S ALREADY SHOWN
	})().finally(function () { cardGuyLoop = null; });
	return cardGuyLoop;
}

/* ---------------------------------------------------------------- */
// Show
/* ---------------------------------------------------------------- */
/**
 * @description Keeps a card route's answer (store.js) & puts its view's pieces on the board: the renderer draws chessInst, so it's loaded with them, unchecked (a card game's
 * board can be one chess wouldn't allow). drawBoard slides a single move in & sets anything else at once
 * @param  {[object]} response [cardsResponse, an answer without a view changes nothing]
 * @return {[array]} events [the answer's events]
 */
function show(response) {
	const events = takeResponse(response);
	if (!response?.view) { return events; }
	chessInst.load(toFen(cards.view.board), { skipValidation: true });
	game.refresh = true;
	return events;
}
