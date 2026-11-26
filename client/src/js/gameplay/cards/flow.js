/*
 *  flow.js  --  chess frontend
 *	Chess Cards Flow
 *	Runs a card game on the play page in place of the chess one (startGame in gameplay/index.js, when GET /game/:gameId says
 *	mode "cards"). startCards puts the card route's answer on the board; act sends one of the player's legal actions; while
 *	Card Guy owes one (card_guy_due: his turn, a duel pick or a choice) it's asked for half a second later, like the AI's move.
 *
 *	The server decides everything (store.js keeps its answer). The board only shows the view's pieces: chess.js holds them for
 *	the renderer and is never asked what's legal. The table (three/cardTable.js, through the renderer) shows the hands, the
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
const { toFen, sqIndex, sqName } = require("../../../../../cards-engine/board.js"); // the engine's own; nothing else of it is loaded
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
	setTable3D, onTablePick, toggleTablePile3D, tablePileOpen3D, holdTablePiece3D, dropTablePiece3D,
	dealDuel3D, flipDuel3D, endDuel3D, showTableButtons3D, focusTableButton3D, pressTableButton3D,
} = require("../renderer/index.js");
const { plaqueAnchor } = require("../three/tableLayout.js");
const { rarityColor } = require("../three/cardFaces.js");
const cardsNetwork = require("./cards.network.js");

// ms after an answer before Card Guy's next action is asked for, like the AI's move (game.aiTimer in gameplay/moves/index.js)
const CARD_GUY_WAIT = 500;
const RETRY_WAIT = 5000; // no answer: asked again this much later, like the AI (AI_RETRY_TIME in gameplay/index.js)
// A duel card's steps get a short wait after them, as between Card Guy's actions. A board step ends with its animation, no wait
const PAUSED_STEPS = ["deal", "flip"];

const promptBox = document.getElementById("cardPrompt");
let cardGuyLoop = null; // Card Guy's turns being asked for (a promise), one loop at a time
let sel = null; // the play being picked (select.js lift / pickPiece / pick), null for none
// The keyboard's stop, its index in select.js focusList: a hand card, a piece with a move that needs no card, a Board Effects pile
let keyFocus = null;
let squareFocus = null; // the keyboard's square, its index in the squares that glow
let sending = false; // an action is on its way: nothing else is picked until its answer
let keyboard = false; // the last pick came from the keys, so a prompt takes the focus (not one that Card Guy's answer raised)
let lastPlayed = null; // the last card-played event's card: the frame of the choice it asks for
let lastTaken = null; // the last card-taken event's card taken from the player: names Pickpocket's take-back (select.js label)
let confirm = null; // a King move that spends a King skull, waiting on the prompt's Play
let dragFrom = null; // the square the mouse pressed a piece on (pressSquare): a release only plays that piece's pick
// This press picked a piece that wasn't picked yet (pressSquare), so its click keeps it. A click on the piece already picked puts it down
let pressedNew = false;
// The square of a dragged piece left over its target (releaseSquare), until its play is answered or given up (settle)
let dropped = null;
// The last pick was the mouse's. It plays by dragging, so its prompt has no discard, place or play button, and a clicked active or
// passive is only zoomed in on to be read. The keys and a tap play as before
let byMouse = false;
// The card the mouse dragged to one of the player's places (dropCard), lying there while its targets are picked or its play is on
// its way. The table keeps it there while it's the lifted card
let onPlace = null;
// The ability card a click or tap picked last (select.js handRead): never lifted, no readable copy. The keys' pick and the drop's
// target pick lift as before (select.js liftedCard)
let readCard = null;
// The hand card the camera is zoomed in on, as the table says ({ kind: "zoom" }). Escape, a prompt button, a play and an answer
// end it (endZoom)
let zoomed = null;
// A move's promotions while the room's promotion cards are out (game.currPromotion); the one picked sends its play (promote)
let promoting = null;
let shownPrompt = null; // what the prompt shows (its buttons as JSON), so it's only rebuilt when that changes
let promptStart = null; // the prompt's button the keys focus (select.js promptFocus), null while it's hidden
// The steps of the answers so far (the card duel's on the table, Overwatch's on the board), one answer's after another's (showSteps)
let stepShow = Promise.resolve();
let showing = 0; // answers whose steps aren't all shown yet: nothing is picked meanwhile (yourMove)

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
	if (showing || cards.result) { endZoom(); }
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
		keyboard = false; // a prompt Card Guy's play raises doesn't take the focus: an Enter meant for something else would answer it
		try {
			show(response);
			if (showing || cards.result) { endZoom(); } // as in act: Card Guy's stepless answers don't close a card being read on his turn
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
	lastPlayed = events
		.filter((event) => event && event.type === "card-played" && event.card && event.card.key)
		.map((event) => event.card)
		.pop() || lastPlayed;
	lastTaken = events
		.filter((event) => event && event.type === "card-taken" && event.from === cards.you && event.card && typeof event.card === "object")
		.map((event) => event.card)
		.pop() || lastTaken;
	// A lost turn (Hunger, Double Time, Unjust Retribution) is told once: each answer is shown once and a re-read has no events
	for (const event of events) {
		if (event && event.type === "turn-skipped") {
			showStatus("action", event.player === cards.you ? "You lose this turn." : "Card Guy loses this turn.", MESSAGE_TIME);
		}
	}
	sel = null; // the game moved on: a pick in progress starts again
	// A press still down (the keys played meanwhile): its piece goes down with the pick (hover), its release may never come
	dragFrom = null;
	squareFocus = null;
	confirm = null;
	endPromotion();
	if (steps.length || showing) {
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
 * legal now. A new kind of step is one more case in showStep (a board step's: in three/motion.js playBoardStep, through boardStep3D)
 * @param  {[array]} steps [duelSteps' or boardSteps', or [{ op: "set" }] for an answer without steps]
 */
function showSteps(steps) {
	showing++; // first: only the chain's finally brings it down, also when a step throws
	const shown = { view: cards.view, legal: cards.legal }; // this answer's, for its set: a later answer's view waits for its own steps
	stepShow = stepShow
		.then(() => playSteps(steps, (step, i) => showStep(step, steps[i - 1], shown)))
		.catch(function (err) {
			// A step threw: playSteps still ran this answer's set and its duel's deal or end
			console.warn("The answer's steps couldn't all be shown", err);
		})
		.finally(function () {
			showing--;
			// The latest view's board, whatever the chain did: a step that threw before its set, or an answer without steps that
			// came meanwhile
			if (!showing) { loadBoard(cards.view); }
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
	if (hit.kind === "zoom") { zoomed = hit.id; return; } // the table's zoom began or ended (three/cardTable.js frameOpen)
	// The table came up (its room loaded), a new 3D board went up, or Flip Board turned the room (renderer tableUp): the prompt
	// lays its plaques again, or shows its 2D buttons
	if (hit.kind === "table") { refreshTable(); return; }
	// A plaque clicked or tapped presses its 2D button, the same play (showPrompt)
	if (hit.kind === "button") { promptBox?.querySelector(`[data-plaque="${hit.id}"]`)?.click(); return; }
	if (hit.kind === "release") { releaseSquare(hit.square, Boolean(hit.dragged)); return; }
	if (hit.kind === "press") { pressSquare(hit.square); return; }
	if (hit.kind === "grab") { return landings(hit); }
	if (hit.kind === "drop") { return dropCard(hit); }
	if (hit.kind === "pile") {
		// A pile tapped: another pile's drop buttons go, and a finger's tap on one of the opened pile's cards (id) offers its own
		if (dropOffer()) { cancelPick(); }
		if (!hit.id) { return false; }
		keyboard = false;
		byMouse = false;
		return offerDrops(hit.pile, hit.id);
	}
	// The bare desk tapped while the promotion cards are out (three/pointer.js pickTable): they go back, as a square's tap does
	if (hit.kind === "desk") {
		if (yourMove() && promoting) { cancelPick(); }
		return;
	}
	keyboard = false;
	byMouse = !hit.touch;
	if (hit.kind === "hand") { return clickCard(hit.id); } // true: an ability card, the camera zooms in on it (three/pointer.js pickTable)
	if (hit.kind === "square") { clickSquare(hit.square); }
	else if (hit.kind === "duel") { pickDuel(hit.index); }
});

// The player may pick: the game is on, nothing is on its way, no duel card is still flipping nor a board step playing (showSteps),
// and it's their turn (a play in legal, or under fog nothing owed by Card Guy: the moves aren't listed)
function yourMove() {
	return Boolean(cards.view) && !cards.result && !game.gameOver && !sending && !showing
		&& (cards.legal.length > 0 || (cards.hidden && !cards.cardGuyDue));
}

// An answer is asked of the player: every legal action is a choice's option, or the duel's Stop or Continue (select.js asking)
function choosing() {
	return cardsSelect.asking(cards.legal);
}

/**
 * @description Puts the view, the play being picked and the keyboard's focus on the table, and the prompt when the play needs
 * one. While an answer's duel steps are shown only their set does: the table would show the result before its cards flip
 * @param  {[object|null]} shown [showSteps' { view, legal }: that answer's own, null for the latest (cards.view)]
 */
function refreshTable(shown = null) {
	if (!cards.view || (showing && !shown)) { return; }
	const view = shown ? shown.view : cards.view;
	const legal = shown ? shown.legal : cards.legal;
	// Its play was answered or given up: it goes where the view has it
	if (onPlace !== null && !sending && !(sel && sel.card === onPlace)) { onPlace = null; }
	// A choice is picked at once: its pieces glow, its options are buttons
	if (!sel && choosing() && yourMove()) { sel = cardsSelect.lift(cards.legal, cards.view, null); }
	const { glow, ready } = sel ? cardsSelect.options(sel, view.board) : { glow: [], ready: [] };
	const stops = cardsSelect.focusList(legal, view, cards.hidden);
	if (keyFocus !== null) { keyFocus = stops.length ? Math.min(keyFocus, stops.length - 1) : null; }
	if (squareFocus !== null && squareFocus >= glow.length) { squareFocus = null; }
	const stop = keyFocus === null ? null : stops[keyFocus];
	const picking = !promoting && !choosing(); // as pressSquare: only then is a piece picked up
	setTable3D(view, legal, {
		// The 3D hover fades what covers these and the glowing squares; nothing (null) off the player's turn
		pickable: yourMove() ? pickablePieces(view, legal, picking) : null,
		catalog: cards.catalog,
		focus: stop?.kind === "hand" ? stop.id : null,
		focusPile: stop?.kind === "pile" ? stop.pile : null,
		focusDuel: stop?.kind === "duel" ? stop.index : null,
		dim: cardsSelect.dimmed(legal, view, cards.hidden),
		lifted: cardsSelect.liftedCard(sel, onPlace, readCard),
		glow,
		glowFocus: squareFocus !== null ? glow[squareFocus] : !glow.length && stop?.kind === "square" ? stop.square : null,
	});
	showPrompt(ready, glow);
	hover();
}

// The squares of the player's pieces that can be picked up now
function pickablePieces(view, legal, picking) {
	const squares = [];
	for (const [i, piece] of view.board.sq.entries()) {
		if (picking && piece && piece.c === cards.you && cardsSelect.pickPiece(legal, view, sqName(i), cards.hidden)) {
			squares.push(sqName(i));
		}
	}
	return squares;
}

// The picked piece floats over its square while it's picked, as a normal game's clicked piece does, and
// comes down with the pick. Not while the mouse drags one or a dropped one waits
function hover() {
	if (dragFrom || dropped) { return; }
	const square = sel && sel.picks.length ? sel.picks[0] : null;
	const piece = square && cards.view.board.sq[sqIndex(square)];
	holdTablePiece3D(piece && piece.c === cards.you ? square : null, false);
}

/**
 * @description The card a prompt is for: the lifted one, the one whose choice it is (the last card played when it's that card,
 * else the pending choice's own card), or the move card a promotion spends
 * @return {[object]} { name, rarity }
 */
function askingCard() {
	const catalog = cards.catalog;
	const hand = cardsSelect.handCards(cards.view);
	if (sel && sel.card !== null) { return cardFace(hand.find((card) => card.id === sel.card), catalog) || { name: "", rarity: null }; }
	if (choosing()) {
		const asked = catalog[cardsSelect.askedBy(cards.view)]; // in a duel its own card, Knight or Bishop too, also after a reload
		const played = lastPlayed && catalog[lastPlayed.key];
		// A version: the same name, its own rarity
		if (played && (!asked || played.name === asked.name)) { return { name: played.name, rarity: played.rarity }; }
		return asked ? { name: asked.name, rarity: asked.rarity } : { name: "Choose", rarity: null };
	}
	if (dropOffer()) { return { name: "Your placed cards", rarity: null }; }
	const spent = sel && sel.actions[0] && hand.find((card) => card.id === sel.actions[0].card);
	return cardFace(spent, catalog) || { name: "", rarity: null };
}

// A hand card's name and rarity for a prompt's title, null when the catalog doesn't know it
function cardFace(card, catalog) {
	if (!card) { return null; }
	if (card.key === "move") { return { name: `${cardsSelect.PIECE_NAMES[card.piece] || "Move"} card`, rarity: null }; }
	if (card.id === "king") { return { name: "King card", rarity: null }; }
	const entry = catalog[card.key];
	return entry ? { name: entry.name, rarity: entry.rarity } : null;
}

/* ---------------------------------------------------------------- */
// The prompt box
/* ---------------------------------------------------------------- */

/**
 * @description The prompt: one button per play the squares can't tell apart (several ready, or ready with none picked: no
 * target, a passive, a curse's clear, a discard), every option of a choice, and Cancel (not for a choice, it must be answered).
 * Or: a King move that spends a King skull asks first (Play). Hidden when there's nothing to press, and while the promotion
 * cards are out: they pick, and Escape or a click or tap on the table cancels. Its border is the asking
 * card's rarity colour.
 * On 3D the four table prompts are laid as plaques on every call, the same prompt too: a table that came up, a new board (its
 * room loading: none) or a turned room ({ kind: "table" }). Any other prompt, or none, takes them away ([]). The 2D buttons are
 * hidden only while their plaques are up; the title and its note stay readable above the board, the plaques have none
 * @param  {[array]} ready [select.js options().ready]
 * @param  {[array]} glow [the squares that glow: while there are some the keys walk them, so the prompt doesn't take the focus]
 */
function showPrompt(ready, glow) {
	const live = Boolean(sel) && yourMove();
	const mode = live && confirm ? "skull" : null;
	let pick = [];
	if (live && !mode && !promoting) {
		const shared = sel.picks.length === 0 || ready.length > 1 ? ready : [];
		const placed = sel.card !== null && sel.card === onPlace;
		pick = choosing() ? sel.actions : cardsSelect.promptPlays(shared, { mouse: byMouse, picks: sel.picks.length, placed });
	}
	const ask = { skull: mode ? confirm : null, pick, choosing: choosing() };
	const at = live && (mode || pick.length)
		? cardsSelect.plaquePrompt({ ...ask, duel: Boolean(cards.view.duel), card: sel.card, hidden: cards.hidden })
		: null;
	const key = JSON.stringify([mode, confirm, pick, at]);
	const list = cardsSelect.promptButtons(ask, cards.view, cards.catalog, lastTaken);
	const plaques = showTableButtons3D(at ? list.map(({ id, label }) => ({ id, label })) : [], at && plaqueAnchor(at, cards.view, game.viewColor === "b")) && Boolean(at);
	promptBox?.toggleAttribute("data-plaques", plaques);
	// Plaques laid on a new table under a focused 2D button: its ring
	if (plaques && promptBox.contains(document.activeElement)) { focusTableButton3D([...promptBox.querySelectorAll("button")].indexOf(document.activeElement)); }
	if (key === shownPrompt) { return; }
	shownPrompt = key;
	if (!promptBox) { return; }
	if (!mode && !pick.length) {
		// Its plaques went with it (at is null)
		promptBox.hidden = true;
		promptBox.replaceChildren();
		promptStart = null;
		return;
	}
	const asker = askingCard();
	const title = document.createElement("p");
	// A plaque (its id) presses this button, and its focus is the plaque's: the keys and a screen reader keep the 2D buttons,
	// hidden on 3D (style.css). A click ends a zoom; a button taken away takes its prompt's plaques with it
	function createButton({ id, label }, i, onClick) {
		const b = document.createElement("button");
		b.type = "button";
		b.textContent = label;
		b.dataset.plaque = id;
		b.addEventListener("click", () => { endZoom(); pressTableButton3D(id); onClick(); });
		b.addEventListener("focus", () => focusTableButton3D(i));
		b.addEventListener("blur", () => { if (b.isConnected) { focusTableButton3D(null); } });
		return b;
	}
	title.textContent = asker.name;
	promptBox.style.borderColor = rarityColor(asker.rarity);
	promptBox.setAttribute("aria-label", asker.name || "Card choice");
	const lines = [title];
	if (mode === "skull") {
		lines.push(promptNote(`This move costs a King skull (${cards.view.players[cards.you]?.kingSkulls ?? 0} left).`));
	}
	const buttons = list.map((item, i) => createButton(item, i, promptAnswer(item, mode)));
	promptBox.replaceChildren(...lines, ...buttons);
	promptBox.hidden = false;
	promptStart = buttons[cardsSelect.promptFocus(pick)];
	// The keys picked it: Enter presses it (the first, or Cancel before a discard), Tab walks the rest. Not while the keys walk squares
	if (keyboard && !glow.length) { promptStart.focus(); }
}

// A line of text under the prompt's title
function promptNote(text) {
	const note = document.createElement("p");
	note.textContent = text;
	return note;
}

// What a prompt button does: Cancel (no action) puts the pick down, the skull's Play sends the King move asked, any other chooses its play
function promptAnswer(item, mode) {
	if (item.action === null) { return cancelPick; }
	if (mode) { return () => send(item.action); }
	return () => choose(item.action);
}

/**
 * @description Plays a picked play: one that spends a King skull asks first (the prompt's Play sends it), the rest are sent
 * @param  {[object]} action [one of cards.legal, or under fog a blind one]
 */
function choose(action) {
	if (cardsSelect.costsSkull(action, cards.view)) {
		confirm = action;
		refreshTable();
		return;
	}
	send(action);
}

/* ---------------------------------------------------------------- */
// Promotion
/* ---------------------------------------------------------------- */

// The room's promotion cards come out for a move's promotions: the renderer deals them (syncCards3D), and a pick
// (gameplay/input choosePromotion) comes to promote
function startPromotion(ready) {
	promoting = ready;
	game.currPromotion = true;
	game.refresh = true;
	refreshTable();
}

// The promotion cards go back
function endPromotion() {
	if (!promoting) { return; }
	promoting = null;
	game.currPromotion = false;
	game.refresh = true;
}

/**
 * @description A promotion card picked (gameplay/input choosePromotion, the mouse or the keys): its play is sent. Under fog, a
 * move with and without a card: the prompt chooses
 * @param  {[string]} type ["q", "r", "b" or "n"]
 */
export function promote(type) {
	const ready = (promoting || []).filter((action) => action.promotion === type);
	endPromotion();
	if (!ready.length || !sel) {
		cancelPick();
		return;
	}
	if (ready.length === 1) {
		choose(ready[0]);
		return;
	}
	sel = { ...sel, actions: ready };
	refreshTable();
}

/* ---------------------------------------------------------------- */
// Picking and dropping cards
/* ---------------------------------------------------------------- */

/**
 * @description A hand card clicked: a move card lifts (its plays' squares glow). An ability card (select.js zooms) clicked or
 * tapped is zoomed in on to be read and isn't lifted. The mouse's click does only that, as the mouse plays it by dragging
 * (dropCard; a curse keeps its clear's button); a tap's is picked as before too (its targets glow, its buttons). Off the turn
 * it's still zoomed in on, but not while steps play, a duel is on or the promotion cards are out (select.js handRead). The keys
 * pick it as before, lifted with its readable copy, no zoom. Picked already: an active with no target is played and anything
 * else is put back down
 * @param  {[string]} id [the card's id, "king" for the King card]
 * @return {[boolean]} zoom [the camera zooms in on it (three/pointer.js pickTable)]
 */
function clickCard(id) {
	const kind = cards.view && cardsSelect.handCards(cards.view).find((card) => card.id === id)?.kind;
	// Before endPromotion: the click that puts the promotion cards away doesn't zoom, the camera couldn't frame it
	const { read, zoom } = cardsSelect.handRead({
		kind, keys: keyboard, showing: showing > 0, duel: Boolean(cards.view?.duel), promoting: Boolean(promoting),
	});
	// Nothing is picked (a duel is on: no hand card lifts nor zooms). An ability card is still read, off the turn too
	if (!yourMove() || choosing() || cards.view.duel) { return zoom; }
	settle();
	confirm = null; // a click elsewhere: the skull's question and the promotion cards go
	endPromotion();
	if (sel && sel.card === id) {
		const { glow, ready } = cardsSelect.options(sel, cards.view.board);
		const play = ready.filter((action) => action.type === "active" && !action.target);
		// One more tap or Enter confirms, also with its discard on the prompt. The mouse drags it to the active spot instead
		if (!byMouse && !glow.length && play.length === 1) {
			choose(play[0]);
			return;
		}
		cancelPick();
		return;
	}
	const next = cardsSelect.lift(cards.legal, cards.view, id, cards.hidden);
	readCard = read ? id : null;
	// The mouse's click only zooms an active or the passive: it's played by dragging (dropCard). The pick before it goes down
	sel = byMouse && (kind === "active" || kind === "passive") ? null : next.actions.length ? next : null;
	if (!sel && !read) { showStatus("action", "That card can't be played now.", MESSAGE_TIME); } // not for a card being read
	squareFocus = null;
	refreshTable();
	return zoom;
}

/**
 * @description The mouse went down on one of the player's cards (three/pointer.js onPointerDown), the drag's start: the places
 * of theirs it can be let go on (select.js dropPlay), which the table frames while it's dragged. A hand card with none is still
 * dragged, and slides back wherever it's let go
 * @param  {[object]} hit [{ from: "hand" | "pile" (a card of an opened pile), id }]
 * @return {[array|null]} places ["spot", "passive", "discard"; null: it isn't picked up (not the player's turn, a choice asked,
 * the promotion cards out, a placed card the game doesn't let them drop)]
 */
function landings({ from, id }) {
	if (!yourMove() || promoting || choosing() || cards.view.duel) { return null; } // a duel is on: no card is dragged
	const places = ["spot", "passive", "discard"]
		.filter((place) => cardsSelect.dropPlay(cards.legal, cards.view, { from, id }, { side: "mine", place }, cards.hidden));
	return from === "pile" && !places.length ? null : places;
}

/**
 * @description The mouse let go of a dragged card (three/pointer.js releaseCard), and select.js dropPlay says what it does: on
 * the discard pile its free discard (a placed card: its drop); an active on the active spot is played, or lies there while its
 * targets are picked (the board lights them; dragged off again, or a click on a square that isn't one, it goes back to the
 * hand); the passive on the passive pile is placed. Anywhere else, or a play the game doesn't offer: the card goes back
 * @param  {[object]} hit [{ from, id, place: three/tableLayout.js placeAt's, null for nowhere }]
 * @return {[boolean]} taken [the card stays on the place: its play was sent or is being picked]
 */
function dropCard({ from, id, place }) {
	if (!yourMove() || promoting || choosing()) { return false; }
	const play = cardsSelect.dropPlay(cards.legal, cards.view, { from, id }, place, cards.hidden);
	keyboard = false;
	byMouse = true;
	settle();
	confirm = null;
	if (!play) {
		// Its own pick goes down with it: dragged back before the last target. So does the pick of a card lying on the active
		// spot: the table sends that card back when another's drop is refused
		if (sel && sel.card !== null && (sel.card === id || sel.card === onPlace)) { cancelPick(); }
		return false;
	}
	onPlace = id;
	if (play.pick) {
		sel = play.pick;
		squareFocus = null;
		refreshTable();
		return true;
	}
	choose(play.action);
	return true;
}

// The pick is the drop buttons of an opened pile (offerDrops)
function dropOffer() {
	return Boolean(sel) && sel.actions.length > 0 && sel.actions.every((action) => action.type === "drop");
}

/**
 * @description The keys' and a tap's way to drop a placed card (the mouse drags it to the discard pile). With one of the
 * player's own piles opened, Enter on it offers a prompt button per card of it the game lets them drop, and a tap on one of its
 * cards offers that card's (select.js pileDrops). Cancel has the keys' focus (select.js promptFocus)
 * @param  {[string]} pile [the opened pile]
 * @param  {[string|null]} id [the card tapped, null: every card of the pile]
 * @return {[boolean]} offered [false: nothing to drop there now]
 */
function offerDrops(pile, id = null) {
	if (!yourMove() || promoting || choosing()) { return false; }
	const drops = cardsSelect.pileDrops(cards.legal, cards.view, pile, id);
	if (!drops.length) { return false; }
	settle();
	confirm = null;
	sel = { card: null, actions: drops, picks: [] };
	squareFocus = null;
	refreshTable();
	return true;
}

/* ---------------------------------------------------------------- */
// Board squares
/* ---------------------------------------------------------------- */

/**
 * @description A square clicked: the next square of the play being picked, another piece for the lifted card, or a piece
 * picked directly (shortcutFor). The last square of a play sends it; several plays on the same squares go to the prompt.
 * A square that leads nowhere puts the pick down
 * @param  {[string]} square ["e4"]
 * @param  {[boolean]} drop [a dragged piece let go on its target (releaseSquare)]
 */
function clickSquare(square, drop = false) {
	if (!yourMove()) { return; }
	if (!drop) { settle(); } // a click elsewhere gives the dropped piece's play up
	if (promoting) { cancelPick(); return; } // a click away from the promotion cards puts the move down
	const again = !drop && !pressedNew && !choosing() && sel && sel.picks.length === 1 && sel.picks[0] === square;
	pressedNew = false;
	// The picked piece clicked again: it and its card go down, as in a normal game
	if (again) { cancelPick(); return; }
	confirm = null;
	const board = cards.view.board;
	let next = sel && cardsSelect.pick(sel, board, square);
	// Another of the lifted card's pieces
	if (!next && sel && sel.card !== null && sel.picks.length) { next = cardsSelect.pick({ ...sel, picks: [] }, board, square); }
	// A piece picked directly, a card of its type spent
	if (!next && !choosing()) { next = cardsSelect.pickPiece(cards.legal, cards.view, square, cards.hidden); }
	if (!next) {
		if (sel && !choosing()) { cancelPick(); }
		return;
	}
	sel = next;
	squareFocus = null;
	const { ready } = cardsSelect.options(sel, board);
	if (sel.picks.length && cardsSelect.promotionPick(ready)) { startPromotion(ready); return; }
	if (ready.length === 1 && sel.picks.length) { choose(ready[0]); return; }
	refreshTable();
}

/**
 * @description A left mouse press on a square (three/pointer.js onPointerDown), the drag's start. On
 * the player's turn, with no promotion cards out and no choice asked, one of the player's pieces that select.js pressPick gives
 * a pick for is picked as a click on it would be (its squares glow) and held: past the drag threshold it follows the pointer.
 * A piece with nothing to play isn't held, with no message. The click that follows a press that didn't drag picks the same
 * again (clickSquare): one pick
 * @param  {[string]} square ["e2"]
 */
function pressSquare(square) {
	if (!yourMove() || promoting || choosing()) { return; }
	const next = cardsSelect.pressPick(sel, cards.legal, cards.view, square, cards.hidden);
	if (!next) { return; }
	pressedNew = !(sel && sel.picks.length === 1 && sel.picks[0] === square);
	settle();
	keyboard = false;
	byMouse = true;
	confirm = null; // as a click elsewhere: the skull's question goes
	sel = next;
	squareFocus = null;
	dragFrom = square;
	holdTablePiece3D(square, true);
	refreshTable();
}

/**
 * @description The mouse let go of a held piece (three/pointer.js onPointerUp): it goes back to its square. Dragged onto one of
 * its pick's squares, that is a click on the square (clickSquare: one ready play is sent, a skull move asks first, a promotion
 * deals the cards, two forms of a square go to the prompt). Anywhere else a drag puts the piece and its card down (a click on a
 * square that isn't a target does too, clickSquare); a press that never dragged keeps the pick
 * @param  {[string|null]} square [the square a drag was let go on, null for none (off the board, on the glass or a card) or a
 * press that never dragged: its click follows]
 * @param  {[boolean]} dragged [the piece followed the pointer]
 */
function releaseSquare(square, dragged = false) {
	const from = dragFrom;
	dragFrom = null;
	// sel.picks: not a pick the keys made meanwhile
	const onTarget = square && sel && sel.picks.length === 1 && sel.picks[0] === from && yourMove() && !promoting
		&& cardsSelect.pick(sel, cards.view.board, square);
	if (!onTarget) {
		// Dragged and let go off its targets, its own square too: the piece and its card go down.
		// A press that never dragged keeps the pick, floating: its click follows
		if (dragged && from) {
			pressedNew = false;
			cancelPick();
		}
		else { hover(); }
		return;
	}
	dropTablePiece3D(square); // it lands on the target at once
	keyboard = false;
	dropped = from; // send's answer, or a pick given up, sends it home (settle)
	clickSquare(square, true);
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

// A dropped piece whose play wasn't made goes back to its square (given up, refused, no answer). A made move left its square:
// nothing there to put down, its slide ends it
function settle() {
	if (!dropped) { return; }
	holdTablePiece3D(dropped, false);
	holdTablePiece3D(null);
	dropped = null;
}

// The camera comes back from the hand card it's zoomed in on (cardTable.js togglePile ends it: no pile is open while one is)
function endZoom() {
	if (zoomed) { toggleTablePile3D(null); }
}

// Puts the pick down, with the skull's question and the promotion cards
function cancelPick() {
	settle();
	sel = null;
	squareFocus = null;
	confirm = null;
	endPromotion();
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
	if (sel || confirm || promoting) { cancelPick(); }
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
	sel = null;
	squareFocus = null;
	confirm = null;
	endPromotion();
	endZoom(); // a play (the keys', a button's, a drop's): its answer's steps never play while the camera frames a hand card
	refreshTable();
	const was = droppedPieceId();
	try { await act(action); }
	finally {
		sending = false;
		if (dropped && droppedPieceId() === was) { settle(); } // still on its square: the play wasn't made
		dropped = null;
		refreshTable();
	}
}

// The id of the piece on the dropped piece's square
function droppedPieceId() {
	return dropped && cards.view?.board.sq[sqIndex(dropped)]?.id;
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
	const picked = Boolean(sel) && !choosing();
	const pile = tablePileOpen3D();
	const plan = cardsSelect.keyPlan({
		key, repeat, on, yours, button, promoting: Boolean(promoting), picked, pile: Boolean(pile), zoomed: Boolean(zoomed),
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
	settle(); // the keys take over: a dropped piece goes home
	keyboard = true;
	byMouse = false;
	if (key === "Escape") {
		cancelPick();
		return true;
	}
	const { glow } = sel ? cardsSelect.options(sel, cards.view.board) : { glow: [] };
	if (promptStart && !glow.length) { promptStart.focus(); return true; } // its buttons are the way on
	if (glow.length) {
		// A play's squares
		if (key !== "Enter") {
			squareFocus = cardsSelect.stepFocus(glow.length, squareFocus, key);
			refreshTable();
			return true;
		}
		if (squareFocus === null) {
			squareFocus = 0;
			refreshTable();
			return true;
		}
		clickSquare(glow[squareFocus]);
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
	if (stop.kind === "hand") { clickCard(stop.id); }
	else if (stop.kind === "square") { clickSquare(stop.square); }
	else if (stop.kind === "duel") { pickDuel(stop.index); }
	// Enter on the player's own opened pile: its drop buttons when the game lists one, else it closes
	else if (!(pile === stop.pile && offerDrops(stop.pile))) { toggleTablePile3D(stop.pile); }
	return true;
}
