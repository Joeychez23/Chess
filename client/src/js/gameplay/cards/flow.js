/*
 *  flow.js  --  chess frontend
 *	Chess Cards Flow
 *	Runs a card game on the play page in place of the chess one (startGame in gameplay/index.js, when GET /game/:gameId says
 *	mode "cards"). startCards puts the card route's answer on the board; act sends one of the player's legal actions; while
 *	Card Guy owes one (card_guy_due: his turn, a duel pick or a choice) it's asked for half a second later, like the AI's move.
 *
 *	The server decides everything (store.js keeps its answer). The board only shows the view's pieces: chess.js holds them for
 *	the renderer and is never asked what's legal. The table (three/cardTable/, through the renderer) shows the hands, the
 *	decks and the Board Effects, and the player plays from it:
 *	- a move card clicked lifts, the squares select.js offers glow, and the last one picked sends the action. Any card the keys
 *	  pick is picked as before; an ability card clicked is zoomed in on to be read, a tapped one is picked too;
 *	- with the mouse an active, the passive and the free discard are played by dragging the card to its place on the desk (dropCard);
 *	- a prompt (#cardPrompt) chooses when several plays share the squares or need none, or asks first when a King move spends a
 *	  King skull; a move's promotions deal the room's promotion cards, as in a normal game.
 *	All or Nothing's card duel is dealt on the table and its events shown one after another (duelShow.js), as Overwatch's shot is
 *	played on the board (boardShow.js). The player picks a duel card by clicking or tapping it (or the keys), and the prompt asks
 *	Stop or Continue after a win. An answer without a view goes to cards.network.js
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, chessInst } = require("../state/index.js");
const { toFen } = require("../../../../../cards-engine/board.js"); // the engine's own; nothing else of it is loaded
const { cards, takeResponse } = require("./store.js");
const { sendAction, cardGuyTurn, getCardGuy } = require("./api.js");
const { showBot } = require("../bots/say.js");
const { showGameOver } = require("../menu/offers.js");
const { showStatus, clearStatus, MESSAGE_TIME } = require("../status/index.js");
const cardsSelect = require("./select.js");
const { duelSteps } = require("./duelShow.js");
const { boardSteps, playSteps } = require("./boardShow.js");
const { boardStep3D } = require("../renderer/index.js");
const {
	setTable3D, onTablePick, toggleTablePile3D, tablePileOpen3D, dealDuel3D, flipDuel3D, endDuel3D,
} = require("../renderer/index.js");
const cardsNetwork = require("./cards.network.js");
const cardsState = require("./cards.state.js");
const cardsPrompts = require("./cards.prompts.js");
const { promptBox } = require("./cards.prompts.js"); // the prompt box (#cardPrompt)
const cardsDrag = require("./cards.drag.js");
export const promote = cardsPrompts.promote; // the promotion card picked, in cards.prompts.js

// ms after an answer before Card Guy's next action is asked for, like the AI's move (game.aiTimer in gameplay/moves/index.js)
const CARD_GUY_WAIT = 500;
const RETRY_WAIT = 5000; // no answer: asked again this much later, like the AI (AI_RETRY_TIME in gameplay/index.js)
// A duel card's steps get a short wait after them, as between Card Guy's actions. A board step ends with its animation, no wait
const PAUSED_STEPS = ["deal", "flip"];

let cardGuyLoop = null; // Card Guy's turns being asked for (a promise), one loop at a time
// The keyboard's stop, its index in select.js focusList: a hand card, a piece with a move that needs no card, a Board Effects pile
let keyFocus = null;
let sending = false; // an action is on its way: nothing else is picked until its answer
// The hand card the camera is zoomed in on, as the table says ({ kind: "zoom" }). Escape, a prompt button, a play and an answer
// end it (endZoom)
let zoomed = null;
// The steps of the answers so far (the card duel's on the table, Overwatch's on the board), one answer's after another's (showSteps)
let stepShow = Promise.resolve();
// The sub-files call these back (function declarations: there at load)
Object.assign(cardsState.calls, { cancelPick, endZoom, refreshTable, send, yourMove });

function wait(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---------------------------------------------------------------- */
// Start
/* ---------------------------------------------------------------- */
/**
 * @description Starts a card game from GET /cards/:gameId: the player's side, the board, Card Guy's name, the menu without what a
 * card game can't use (play.html data-chess-only), the result when it's already over, and Card Guy's actions when he owes one
 * (a reload while he was due asks again; the server plays it once)
 * @param  {[object]} response [cardsResponse]
 * @return {[boolean]} loaded [false: no game in the answer (not found, not theirs, an open game from an older version, no
 * answer), the message says so. A finished game from an older version (older, result, fen) opens read-only: true]
 */
export function startCards(response) {
	if (!response?.view && response?.older && response.result) {
		// A finished game from an older version: its sides, its last board and its result. No table, no forfeit, no Card Guy
		setSides(response);
		// No stored board (cardsController.js olderResponse sends null): the result alone
		if (response.fen) { chessInst.load(response.fen, { skipValidation: true }); }
		game.refresh = true;
		showGameOver(response.result, true);
		return true;
	}
	if (!response?.view) {
		console.log(response?.message || "The card game didn't load");
		if (response?.status === 409 && response.game_id) {
			// A state from an older engine version: it can't go on
			cardsNetwork.offerForfeit(promptBox, response.game_id);
			return false;
		}
		showStatus("server", "The game couldn't be loaded. Reload the page to try again.");
		return false;
	}
	setSides(response);
	show(response);
	// Not awaited: the game doesn't wait for the name. No answer, no name
	getCardGuy(game.GAME_URL).then((bot) => { if (bot?.name) { showBot(game.GAME_URL, response, bot); } });
	if (cards.result) { showGameOver(cards.result, true); } // already over when it loaded
	else if (cards.cardGuyDue) { playCardGuy(); }
	return true;
}

/**
 * @description The sides and the menu of a card game. The chess parts that read game.response find no game_board (syncAnalysis):
 * no hint or eval bar. The board is seen from the player's side. Card Guy is the AI: Restart, not Rematch, and no socket. Nothing
 * on the board is picked up (the pointer's listeners aren't on either, input/modes.js). The chess-only menu items (hint, takeback,
 * offer draw, type a move, view, eval bar, PGN and replay) are hidden, and the monitor's actions follow the menu
 * @param  {[object]} response [cardsResponse]
 */
function setSides(response) {
	game.response = response;
	game.playerColor = response.you;
	game.viewColor = response.you;
	game.opponentColor = response.you === "w" ? "b" : "w";
	game.ai = true;
	game.opposingMove = true;
	document.querySelectorAll("[data-chess-only]").forEach((item) => { item.hidden = true; });
}

/* ---------------------------------------------------------------- */
// Act
/* ---------------------------------------------------------------- */
/**
 * @description Plays one of the player's legal actions: sends it, shows the answer, then Card Guy's actions while he owes one.
 * A refused action (409: not legal now, the game is over, or stale: true, another save landed first) carries the game as it is
 * now, so the board is drawn again from it. No answer: the game is read again (it may have been saved) and goes on from that;
 * a final refusal with no view (an older version, gone, not theirs) stops with its message. An answer that throws while it's
 * shown still goes on to Card Guy
 * @param  {[object]} action [one of cards.legal]
 * @param  {[boolean]} again [the duel pick is being sent a second time]
 * @return {[array]} events [the action's events, [] when it didn't go through]
 */
export async function act(action, again = false) {
	let response = await sendAction(game.GAME_URL, game.GAME_ID, action);
	if (!response?.view) {
		console.log(response?.message || "The action didn't go through: no answer from the server");
		if (cardsNetwork.refused(response, promptBox)) { return []; }
		response = await cardsNetwork.readAfterLostAnswer();
		if (!response?.view) {
			cardsNetwork.refused(response, promptBox);
			return [];
		}
		action = null; // the re-read answers no action: no events, nothing to send again
	}
	if (response.status === 409 && !response.stale && !response.result) {
		// Not legal. Under fog, a blind move the server refused
		showStatus("action", cards.hidden ? "That move isn't allowed. The fog hides why." : "That play isn't allowed now.", MESSAGE_TIME);
	}
	let events = [];
	try { events = show(response, action); }
	catch (err) {
		// The answer is kept (takeResponse ran), so Card Guy is still asked below when he's owed
		console.warn("The answer couldn't be shown", err);
		showStatus("action", "That play couldn't be shown. Reload the page if the board looks wrong.", MESSAGE_TIME);
		redraw();
	}
	// Its steps never play while the camera frames a hand card. A stepless answer leaves a card being read alone
	if (cardsState.state.showing || cards.result) { endZoom(); }
	// Card Guy's pick was saved first: the player's, still legal, is sent once more, with no message
	const resendDuelPick = response.stale && !again && action?.type === "duel" && Number.isInteger(action.pick)
		&& cards.legal.some((legal) => legal.type === "duel" && legal.pick === action.pick);
	if (resendDuelPick) { return act(action, true); }
	await stepShow; // its duel cards flip (its board steps play) before Card Guy's next action or the result
	if (cards.result) { showGameOver(cards.result); }
	else if (cards.cardGuyDue) { playCardGuy(); }
	return events;
}

/* ---------------------------------------------------------------- */
// Card Guy
/* ---------------------------------------------------------------- */
/**
 * @description While Card Guy owes an action, asks the server for it half a second after the last answer and shows each one.
 * No answer: says so and asks again after RETRY_WAIT. Ends when he owes nothing or the game is over (a forfeit too).
 * A second call while it runs joins it
 * @return {[Promise]} loop [done when Card Guy owes nothing]
 */
function playCardGuy() {
	if (!cardGuyLoop) { cardGuyLoop = runCardGuyLoop().finally(function () { cardGuyLoop = null; }); }
	return cardGuyLoop;
}

// Card Guy's turns, one answer at a time. A final refusal stops it: asking again would get the same
async function runCardGuyLoop() {
	while (cards.cardGuyDue && !cards.result && !game.gameOver) {
		await wait(CARD_GUY_WAIT);
		if (game.gameOver) { break; } // forfeited while it waited
		const response = await cardGuyTurn(game.GAME_URL, game.GAME_ID);
		if (!response?.view) {
			console.log(response?.message || "Card Guy's turn: no answer from the server");
			if (cardsNetwork.refused(response, promptBox, true)) { break; }
			showStatus("ai", "Card Guy isn't answering. Trying again…");
			await wait(RETRY_WAIT);
			continue;
		}
		clearStatus("ai");
		cardsState.state.keyboard = false; // a prompt Card Guy's play raises doesn't take the focus: an Enter meant for something else would answer it
		try {
			show(response);
			if (cardsState.state.showing || cards.result) { endZoom(); } // as in act: Card Guy's stepless answers don't close a card being read on his turn
			await stepShow;
		} catch (err) {
			// The answer is kept (takeResponse ran): the loop goes on from it, it isn't stopped for good. No "trying again":
			// the turn may have come back, and the loop then ends
			console.warn("Card Guy's answer couldn't be shown", err);
			showStatus("ai", "Card Guy's play couldn't be shown. Reload the page if the board looks wrong.", MESSAGE_TIME);
			redraw();
			await wait(RETRY_WAIT);
		}
	}
	if (cards.result) { showGameOver(cards.result); } // does nothing when it's already shown
}

/* ---------------------------------------------------------------- */
// Show
/* ---------------------------------------------------------------- */
/**
 * @description Keeps a card route's answer (store.js) and puts its view's pieces on the board. The renderer draws chessInst, so
 * it's loaded with them, unchecked (a card game's board can be one chess wouldn't allow). drawBoard slides a single move in and
 * sets anything else at once. An answer with steps puts its view on the board and the table in them, after its flips or its
 * board steps (showSteps), so the result shows after the cards that decide it. The steps are its card duel's (duelShow.js), or
 * else what it plays on the board (boardShow.js: Overwatch's shot, a removal's topple, Opposing Finality's handover; a duel
 * answer has no move). So does an answer without any while an earlier one's are still shown: one order, it never lands before them
 * @param  {[object]} response [cardsResponse, an answer without a view changes nothing]
 * @param  {[object|null]} action [the player's own action it answers, null for Card Guy's and a load]
 * @return {[array]} events [the answer's events]
 */
function show(response, action = null) {
	// An answer saved before a live forfeit but delivered after it: the game is over, it would lay the duel again
	if (game.gameOver && !response?.result) { return []; }
	const prev = cards.view;
	const events = takeResponse(response);
	if (!response?.view) { return events; }
	const duelStepList = duelSteps(prev, cards.view, events, action);
	const steps = duelStepList.length ? duelStepList : boardSteps(prev, cards.view, events);
	// A finished game shows no duel: its steps end it, and the table gets the view without one (its piles open again)
	if (cards.view.result && cards.view.duel) { cards.view = { ...cards.view, duel: null }; }
	if (!(prev && prev.duel) && cards.view.duel) { keyFocus = null; } // a duel starts: a hand stop isn't carried onto its cards
	cardsState.state.lastPlayed = events
		.filter((event) => event && event.type === "card-played" && event.card && event.card.key)
		.map((event) => event.card)
		.pop() || cardsState.state.lastPlayed;
	cardsState.state.lastTaken = events
		.filter((event) => event && event.type === "card-taken" && event.from === cards.you && event.card && typeof event.card === "object")
		.map((event) => event.card)
		.pop() || cardsState.state.lastTaken;
	// A lost turn (Hunger, Double Time, Unjust Retribution) is told once: each answer is shown once and a re-read has no events
	for (const event of events) {
		if (event && event.type === "turn-skipped") {
			showStatus("action", event.player === cards.you ? "You lose this turn." : "Card Guy loses this turn.", MESSAGE_TIME);
		}
	}
	cardsState.state.sel = null; // the game moved on: a pick in progress starts again
	// A press still down (the keys played meanwhile): its piece goes down with the pick (hover), its release may never come
	cardsState.state.dragFrom = null;
	cardsState.state.squareFocus = null;
	cardsState.state.confirm = null;
	cardsPrompts.endPromotion();
	if (steps.length || cardsState.state.showing) {
		showSteps(steps.length ? steps : [{ op: "set" }]);
		return events;
	}
	loadBoard(cards.view);
	refreshTable();
	return events;
}

// An answer's show threw part way: the board and the table once more from the view it left, so a turn that came back isn't
// played on a stale board. Still throwing: the reload hint stands
function redraw() {
	try {
		loadBoard(cards.view);
		refreshTable();
	} catch (err) { console.warn("The board couldn't be drawn again", err); }
}

// The renderer draws chessInst: loaded with the view's pieces, unchecked. A "?" piece (never sent, since fog hides whole pieces)
// prints as "?", which chess.js skips
function loadBoard(view) {
	chessInst.load(toFen(view.board), { skipValidation: true });
	game.refresh = true;
}

/**
 * @description An answer's steps on the table and the board, after the answers' before it, each once the one before has ended
 * (boardShow.js playSteps). Either its card duel's (duelShow.js), with a short wait after each card as between Card Guy's actions
 * (the deal: no pile stays open; each flip; the winner's gold outline), or its board steps (boardShow.js), each animation played
 * to its end (the take is never cut short). Then the answer's own view goes on the board and the table at once (set), with the
 * view's duel or its end (set comes before endDuel). A step that throws skips to the set, which still runs with what follows it.
 * Nothing is picked and nothing else sets the table meanwhile (showing). Then the table and the prompt are refreshed for what's
 * legal now. A new kind of step is one more case in showStep (a board step's: in three/board/motion.js playBoardStep, through boardStep3D)
 * @param  {[array]} steps [duelSteps' or boardSteps', or [{ op: "set" }] for an answer without steps]
 */
function showSteps(steps) {
	cardsState.state.showing++; // first: only the chain's finally brings it down, also when a step throws
	const shown = { view: cards.view, legal: cards.legal }; // this answer's, for its set: a later answer's view waits for its own steps
	stepShow = stepShow
		.then(() => playSteps(steps, (step, i) => showStep(step, steps[i - 1], shown)))
		.catch(function (err) {
			// A step threw: playSteps still ran this answer's set and its duel's deal or end
			console.warn("The answer's steps couldn't all be shown", err);
		})
		.finally(function () {
			cardsState.state.showing--;
			// The latest view's board, whatever the chain did: a step that threw before its set, or an answer without steps that
			// came meanwhile
			if (!cardsState.state.showing) { loadBoard(cards.view); }
			refreshTable();
		});
}

/**
 * @description One of an answer's steps (showSteps)
 * @param  {[object]} step [a duelSteps or boardSteps step]
 * @param  {[object|undefined]} previous [the step before it, none for the first]
 * @param  {[object]} shown [the answer's own { view, legal }]
 */
async function showStep(step, previous, shown) {
	if (previous && PAUSED_STEPS.includes(previous.op)) { await wait(CARD_GUY_WAIT); }
	if (step.op === "set") {
		loadBoard(shown.view);
		refreshTable(shown);
	}
	else if (step.op === "deal") {
		if (tablePileOpen3D()) { toggleTablePile3D(null); }
		dealDuel3D(step.duel);
	}
	else if (step.op === "flip") { flipDuel3D(step.player, step.index, step.card, step.won); }
	else if (step.op === "end") { endDuel3D(); }
	else { await boardStep3D(step); } // move, swap, take, out, back, topple, handover
}

/* ---------------------------------------------------------------- */
// Table
/* ---------------------------------------------------------------- */
// The 3D board's clicks and taps, and the mouse's press and release (the drag)
onTablePick((hit) => {
	if (hit.kind === "zoom") { zoomed = hit.id; return; } // the table's zoom began or ended (three/cardTable/ frameOpen)
	// The table came up (its room loaded), a new 3D board went up, or Flip Board turned the room (renderer tableUp): the prompt
	// lays its plaques again, or shows its 2D buttons
	if (hit.kind === "table") { refreshTable(); return; }
	// A plaque clicked or tapped presses its 2D button, the same play (showPrompt)
	if (hit.kind === "button") { promptBox?.querySelector(`[data-plaque="${hit.id}"]`)?.click(); return; }
	if (hit.kind === "release") { cardsDrag.releaseSquare(hit.square, Boolean(hit.dragged)); return; }
	if (hit.kind === "press") { cardsDrag.pressSquare(hit.square); return; }
	if (hit.kind === "grab") { return cardsDrag.landings(hit); }
	if (hit.kind === "drop") { return cardsDrag.dropCard(hit); }
	if (hit.kind === "pile") {
		// A pile tapped: another pile's drop buttons go, and a finger's tap on one of the opened pile's cards (id) offers its own
		if (cardsPrompts.dropOffer()) { cancelPick(); }
		if (!hit.id) { return false; }
		cardsState.state.keyboard = false;
		cardsState.state.byMouse = false;
		return cardsDrag.offerDrops(hit.pile, hit.id);
	}
	// The bare desk tapped while the promotion cards are out (three/pointer/index.js pickTable): they go back, as a square's tap does
	if (hit.kind === "desk") {
		if (yourMove() && cardsState.state.promoting) { cancelPick(); }
		return;
	}
	cardsState.state.keyboard = false;
	cardsState.state.byMouse = !hit.touch;
	if (hit.kind === "hand") { return cardsDrag.clickCard(hit.id); } // true: an ability card, the camera zooms in on it (three/pointer/index.js pickTable)
	if (hit.kind === "square") { cardsDrag.clickSquare(hit.square); }
	else if (hit.kind === "duel") { pickDuel(hit.index); }
});

// The player may pick: the game is on, nothing is on its way, no duel card is still flipping nor a board step playing (showSteps),
// and it's their turn (a play in legal, or under fog nothing owed by Card Guy: the moves aren't listed)
function yourMove() {
	return Boolean(cards.view) && !cards.result && !game.gameOver && !sending && !cardsState.state.showing
		&& (cards.legal.length > 0 || (cards.hidden && !cards.cardGuyDue));
}

/**
 * @description Puts the view, the play being picked and the keyboard's focus on the table, and the prompt when the play needs
 * one. While an answer's duel steps are shown only their set does: the table would show the result before its cards flip
 * @param  {[object|null]} shown [showSteps' { view, legal }: that answer's own, null for the latest (cards.view)]
 */
function refreshTable(shown = null) {
	if (!cards.view || (cardsState.state.showing && !shown)) { return; }
	const view = shown ? shown.view : cards.view;
	const legal = shown ? shown.legal : cards.legal;
	// Its play was answered or given up: it goes where the view has it
	if (cardsState.state.onPlace !== null && !sending && !(cardsState.state.sel && cardsState.state.sel.card === cardsState.state.onPlace)) { cardsState.state.onPlace = null; }
	// A choice is picked at once: its pieces glow, its options are buttons
	if (!cardsState.state.sel && cardsPrompts.choosing() && yourMove()) { cardsState.state.sel = cardsSelect.lift(cards.legal, cards.view, null); }
	const { glow, ready } = cardsState.state.sel ? cardsSelect.options(cardsState.state.sel, view.board) : { glow: [], ready: [] };
	const stops = cardsSelect.focusList(legal, view, cards.hidden);
	if (keyFocus !== null) { keyFocus = stops.length ? Math.min(keyFocus, stops.length - 1) : null; }
	if (cardsState.state.squareFocus !== null && cardsState.state.squareFocus >= glow.length) { cardsState.state.squareFocus = null; }
	const stop = keyFocus === null ? null : stops[keyFocus];
	const picking = !cardsState.state.promoting && !cardsPrompts.choosing(); // as pressSquare: only then is a piece picked up
	setTable3D(view, legal, {
		// The 3D hover fades what covers these and the glowing squares; nothing (null) off the player's turn
		pickable: yourMove() ? cardsDrag.pickablePieces(view, legal, picking) : null,
		catalog: cards.catalog,
		focus: stop?.kind === "hand" ? stop.id : null,
		focusPile: stop?.kind === "pile" ? stop.pile : null,
		focusDuel: stop?.kind === "duel" ? stop.index : null,
		dim: cardsSelect.dimmed(legal, view, cards.hidden),
		lifted: cardsSelect.liftedCard(cardsState.state.sel, cardsState.state.onPlace, cardsState.state.readCard),
		glow,
		glowFocus: cardsState.state.squareFocus !== null ? glow[cardsState.state.squareFocus] : !glow.length && stop?.kind === "square" ? stop.square : null,
	});
	cardsPrompts.showPrompt(ready, glow);
	cardsDrag.hover();
}

/* ---------------------------------------------------------------- */
// Duel pick, zoom and putting a pick down
/* ---------------------------------------------------------------- */

// A duel card picked (a click, a tap, Enter on the keys' one): its pick is sent when legal has it. One Grace Bars is hit on the
// table but isn't legal: nothing happens
function pickDuel(index) {
	const action = yourMove() && cards.legal.find((legal) => legal.type === "duel" && legal.pick === index);
	if (action) { send(action); }
}

// The camera comes back from the hand card it's zoomed in on (cardTable.piles.js togglePile ends it: no pile is open while one is)
function endZoom() {
	if (zoomed) { toggleTablePile3D(null); }
}

// Puts the pick down, with the skull's question and the promotion cards
function cancelPick() {
	cardsDrag.settle();
	cardsState.state.sel = null;
	cardsState.state.squareFocus = null;
	cardsState.state.confirm = null;
	cardsPrompts.endPromotion();
	refreshTable();
}

/**
 * @description The menu is opening (moves/index.js revertUnfinishedMove): the card being played goes down. Also when the game is
 * over (showGameOver opens the menu, or at the 3D monitor calls revertUnfinishedMove): a duel still on (a forfeit, the chess
 * route's) ends on the table, after any steps still being shown, and frees the hands and the piles
 */
export function putDown() {
	if (game.gameOver && cards.view?.duel) {
		cards.view = { ...cards.view, duel: null };
		showSteps([{ op: "set" }, { op: "end" }]);
	}
	if (cardsState.state.sel || cardsState.state.confirm || cardsState.state.promoting) { cancelPick(); }
}

/* ---------------------------------------------------------------- */
// Sending the action
/* ---------------------------------------------------------------- */

/**
 * @description Sends a play (act), once: nothing else is picked until its answer is on the table
 * @param  {[object]} action [one of cards.legal, or under fog a blind move]
 */
async function send(action) {
	if (sending) { return; }
	sending = true;
	cardsState.state.sel = null;
	cardsState.state.squareFocus = null;
	cardsState.state.confirm = null;
	cardsPrompts.endPromotion();
	endZoom(); // a play (the keys', a button's, a drop's): its answer's steps never play while the camera frames a hand card
	refreshTable();
	const was = cardsDrag.droppedPieceId();
	try { await act(action); }
	finally {
		sending = false;
		if (cardsState.state.dropped && cardsDrag.droppedPieceId() === was) { cardsDrag.settle(); } // still on its square: the play wasn't made
		cardsState.state.dropped = null;
		refreshTable();
	}
}

/* ---------------------------------------------------------------- */
// Keys
/* ---------------------------------------------------------------- */
/**
 * @description A Chess Cards game's key (gameplay/input handleHandKey), what it does decided by select.js keyPlan. While the game
 * is on, the arrows and Enter stay off the page's nav.
 * - Off the player's turn the arrows step through select.js focusList and Enter does nothing.
 * - On it the arrows step through focusList (the hand, the pieces with a move that needs no card, the Board Effects piles), or
 *   through a play's squares while they glow. Enter lifts the focused card, picks the focused piece or square, or opens the
 *   focused pile (with none focused yet it focuses the first; on the player's own opened pile it offers its drop buttons,
 *   offerDrops).
 * - Escape puts the pick down, then closes an opened pile, off the turn too.
 * A prompt with nothing glowing takes the first key's focus (one Card Guy's play raised doesn't have it). A focused button keeps
 * Enter; an arrow takes the focus off it first. While the promotion cards are out only Escape is the hand's (handleCardKey has
 * the rest). A held key (repeat) does nothing more
 * @param  {[string]} key [a KeyboardEvent.key: an arrow, "Enter" or "Escape"]
 * @param  {[boolean]} repeat [KeyboardEvent.repeat]
 * @param  {[boolean]} button [a button or link has the focus]
 * @return {[boolean]} [the key was used or stopped: the page doesn't get it]
 */
export function handKey(key, repeat = false, button = false) {
	const on = Boolean(cards.view) && !cards.result && !game.gameOver;
	const yours = on && yourMove();
	const picked = Boolean(cardsState.state.sel) && !cardsPrompts.choosing();
	const pile = tablePileOpen3D();
	const plan = cardsSelect.keyPlan({
		key, repeat, on, yours, button, promoting: Boolean(cardsState.state.promoting), picked, pile: Boolean(pile), zoomed: Boolean(zoomed),
	});
	if (plan === "page" || plan === "stop") { return plan === "stop"; }
	if (plan === "blur") { document.activeElement?.blur(); } // an arrow: the button lets go of the focus, so a later Enter is the hand's
	if (key === "Escape" && !(yours && picked)) {
		// No pick to put down: the opened pile closes, or the zoom ends, on the turn or off it (keyPlan gives the menu its Escape
		// when neither is)
		toggleTablePile3D(null);
		return true;
	}
	if (!yours) {
		// Card Guy's turn, or an action on its way: only an arrow gets here
		keyFocus = cardsSelect.stepFocus(cardsSelect.focusList(cards.legal, cards.view, cards.hidden).length, keyFocus, key);
		refreshTable();
		return true;
	}
	cardsDrag.settle(); // the keys take over: a dropped piece goes home
	cardsState.state.keyboard = true;
	cardsState.state.byMouse = false;
	if (key === "Escape") {
		cancelPick();
		return true;
	}
	const { glow } = cardsState.state.sel ? cardsSelect.options(cardsState.state.sel, cards.view.board) : { glow: [] };
	if (cardsState.state.promptStart && !glow.length) { cardsState.state.promptStart.focus(); return true; } // its buttons are the way on
	if (glow.length) {
		// A play's squares
		if (key !== "Enter") {
			cardsState.state.squareFocus = cardsSelect.stepFocus(glow.length, cardsState.state.squareFocus, key);
			refreshTable();
			return true;
		}
		if (cardsState.state.squareFocus === null) {
			cardsState.state.squareFocus = 0;
			refreshTable();
			return true;
		}
		cardsDrag.clickSquare(glow[cardsState.state.squareFocus]);
		return true;
	}
	const stops = cardsSelect.focusList(cards.legal, cards.view, cards.hidden);
	if (key !== "Enter") {
		keyFocus = cardsSelect.stepFocus(stops.length, keyFocus, key);
		refreshTable();
		return true;
	}
	if (keyFocus === null) {
		keyFocus = stops.length ? 0 : null;
		refreshTable();
		return true;
	}
	const stop = stops[keyFocus];
	if (stop.kind === "hand") { cardsDrag.clickCard(stop.id); }
	else if (stop.kind === "square") { cardsDrag.clickSquare(stop.square); }
	else if (stop.kind === "duel") { pickDuel(stop.index); }
	// Enter on the player's own opened pile: its drop buttons when the game lists one, else it closes
	else if (!(pile === stop.pile && cardsDrag.offerDrops(stop.pile))) { toggleTablePile3D(stop.pile); }
	return true;
}
