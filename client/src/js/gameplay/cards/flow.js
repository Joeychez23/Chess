/*
 *  flow.js  --  chess frontend
 *	Chess Cards Flow
 *	Runs a card game on the play page, in place of the chess one (startGame in gameplay/index.js, when GET /game/:gameId says mode "cards"): startCards puts the
 *	card route's answer on the board, act sends one of the player's legal actions & while Card Guy owes one (card_guy_due: its turn, a duel pick or a choice)
 *	it's asked for half a second later, like the AI's move. The server decides everything (store.js keeps its answer): the board only shows the view's pieces,
 *	chess.js holds them for the renderer & is never asked what's legal. The table (three/cardTable.js, through the renderer) shows the hands, decks & Board Effects,
 *	& the player plays from it: a card clicked (or picked with the keys) lifts, the squares select.js offers glow, the last one picked sends the action; with the mouse an active, the passive & the free discard are played by dragging the card to its place on the desk (dropCard), a prompt
 *	(#cardPrompt) chooses when several plays share the squares or need none (or asks first when a King move spends a King skull), & a move's promotions deal the
 *	room's promotion cards, as in a normal game. All or Nothing's card duel is dealt on the table & its events shown one after another (duelShow.js); the player picks a duel card
 *	by clicking or tapping it (or the keys), & the prompt asks Stop or Continue after a win
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, chessInst } = require("../state/index.js"); // THE GAME'S SHARED STATE, THE BOARD THAT'S DRAWN
const { toFen, sqIndex, sqName } = require("../../../../../cards-engine/board.js"); // THE VIEW'S BOARD AS A FEN, THE ENGINE'S OWN (NO OTHER PART OF THE ENGINE IS LOADED)
const { cards, takeResponse } = require("./store.js"); // THE CARD ROUTES' LAST ANSWER
const { sendAction, cardGuyTurn, getCardGuy } = require("./api.js"); // REQUESTS TO THE CARD ROUTES (/api/chess/cards)
const { showBot } = require("../bots/say.js"); // CARD GUY'S NAME BESIDE THE BOARD
const { showGameOver } = require("../menu/offers.js"); // THE GAME OVER SCREEN
const { showStatus, clearStatus, MESSAGE_TIME } = require("../status/index.js"); // THE MESSAGE AREA ON THE PLAY PAGE
const S = require("./select.js"); // WHAT THE TABLE LETS THE PLAYER PICK, FROM cards.legal
const { duelSteps } = require("./duelShow.js"); // WHAT AN ANSWER SHOWS OF THE CARD DUEL
const { setTable3D, onTablePick, toggleTablePile3D, tablePileOpen3D, holdTablePiece3D, dropTablePiece3D, dealDuel3D, flipDuel3D, endDuel3D } = require("../renderer/index.js"); // THE TABLE ON THE 3D BOARD
const { rarityColor } = require("../three/cardFaces.js"); // A PROMPT'S BORDER, THE COLOUR OF THE CARD THAT ASKED
const { forfeitGame } = require("../validate/index.js"); // THE OLDER-VERSION GAME'S WAY OUT

const CARD_GUY_WAIT = 500; // MS AFTER AN ANSWER BEFORE CARD GUY'S NEXT ACTION IS ASKED FOR, LIKE THE AI'S MOVE (game.aiTimer IN gameplay/moves/index.js)
const RETRY_WAIT = 5000; // NO ANSWER: ASKED AGAIN THIS MUCH LATER, LIKE THE AI (AI_RETRY_TIME IN gameplay/index.js)
let cardGuyLoop = null; // CARD GUY'S TURNS BEING ASKED FOR (A PROMISE), ONE LOOP AT A TIME
let sel = null; // THE PLAY BEING PICKED (select.js lift / pickPiece / pick), null FOR NONE
let keyFocus = null; // THE KEYBOARD'S STOP, ITS INDEX IN select.js focusList: A HAND CARD, A PIECE WITH A MOVE THAT NEEDS NO CARD, A BOARD EFFECTS PILE
let squareFocus = null; // THE KEYBOARD'S SQUARE, ITS INDEX IN THE SQUARES THAT GLOW
let sending = false; // AN ACTION IS ON ITS WAY: NOTHING ELSE IS PICKED UNTIL ITS ANSWER
let keyboard = false; // THE LAST PICK CAME FROM THE KEYS: A PROMPT TAKES THE FOCUS (NOT ONE CARD GUY'S ANSWER RAISED)
let lastPlayed = null; // THE LAST card-played EVENT'S CARD: THE FRAME OF THE CHOICE IT ASKS FOR
let lastTaken = null; // THE LAST card-taken EVENT'S CARD TAKEN FROM THE PLAYER: NAMES PICKPOCKET'S TAKE-BACK (select.js label)
let confirm = null; // A KING MOVE THAT SPENDS A KING SKULL, WAITING ON THE PROMPT'S Play (USER RULING M7)
let dragFrom = null; // THE SQUARE THE MOUSE PRESSED A PIECE ON (pressSquare): A RELEASE ONLY PLAYS THAT PIECE'S PICK
let pressedNew = false; // THIS PRESS PICKED A PIECE THAT WASN'T PICKED YET (pressSquare): ITS CLICK KEEPS IT. A CLICK ON THE PIECE ALREADY PICKED PUTS IT DOWN
let dropped = null; // THE SQUARE OF A DRAGGED PIECE LEFT OVER ITS TARGET (releaseSquare) UNTIL ITS PLAY IS ANSWERED OR GIVEN UP (settle)
let byMouse = false; // THE LAST PICK WAS THE MOUSE'S: IT PLAYS BY DRAGGING, SO ITS PROMPT HAS NO DISCARD, PLACE OR PLAY BUTTON & A CLICKED ACTIVE OR PASSIVE ONLY LIFTS TO BE READ (TASK 20e). THE KEYS & A TAP PLAY AS BEFORE
let onPlace = null; // THE CARD THE MOUSE DRAGGED TO ONE OF THE PLAYER'S PLACES (dropCard), LYING THERE WHILE ITS TARGETS ARE PICKED OR ITS PLAY IS ON ITS WAY (THE TABLE KEEPS IT THERE WHILE IT'S THE LIFTED CARD)
let promoting = null; // A MOVE'S PROMOTIONS WHILE THE ROOM'S PROMOTION CARDS ARE OUT (game.currPromotion), ONE PICKED SENDS ITS PLAY (promote)
let shownPrompt = null; // WHAT THE PROMPT SHOWS (ITS BUTTONS AS JSON), SO IT'S ONLY REBUILT WHEN THAT CHANGES
let promptStart = null; // THE PROMPT'S BUTTON THE KEYS FOCUS (select.js promptFocus), null WHILE IT'S HIDDEN
let duelShow = Promise.resolve(); // THE CARD DUEL'S STEPS OF THE ANSWERS SO FAR ON THE TABLE, ONE ANSWER'S AFTER ANOTHER'S (showDuel)
let showing = 0; // ANSWERS WHOSE DUEL STEPS AREN'T ALL SHOWN YET: NOTHING IS PICKED MEANWHILE (yourMove)

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
		if (response?.status === 409 && response.game_id) { offerForfeit(response.game_id); return false; } // A STATE FROM AN OLDER ENGINE VERSION: IT CAN'T GO ON
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
export async function act(action, again = false) {
	const response = await sendAction(game.GAME_URL, game.GAME_ID, action);
	if (!response?.view) {
		console.log(response?.message || "The action didn't go through: no answer from the server");
		showStatus("action", "That didn't go through. Try again.", MESSAGE_TIME);
		return [];
	}
	if (response.status === 409 && !response.stale && !response.result) { showStatus("action", cards.hidden ? "That move isn't allowed. The fog hides why." : "That play isn't allowed now.", MESSAGE_TIME); } // NOT LEGAL: UNDER FOG A BLIND MOVE THE SERVER REFUSED
	const events = show(response, action);
	if (response.stale && !again && action.type === "duel" && Number.isInteger(action.pick) && cards.legal.some((a) => a.type === "duel" && a.pick === action.pick)) { return act(action, true); } // CARD GUY'S PICK WAS SAVED FIRST: THE PLAYER'S, STILL LEGAL, IS SENT ONCE MORE, WITH NO MESSAGE (M3)
	await duelShow; // ITS DUEL CARDS FLIP BEFORE CARD GUY'S NEXT ACTION OR THE RESULT
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
			keyboard = false; // A PROMPT CARD GUY'S PLAY RAISES DOESN'T TAKE THE FOCUS: AN ENTER MEANT FOR SOMETHING ELSE WOULD ANSWER IT
			show(response);
			await duelShow;
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
 * board can be one chess wouldn't allow). drawBoard slides a single move in & sets anything else at once. An answer with card duel steps puts its view on the board & the table in
 * them, after its flips (showDuel: the result shows after the cards that decide it, I1)
 * @param  {[object]} response [cardsResponse, an answer without a view changes nothing]
 * @param  {[object|null]} action [the player's own action it answers, null for Card Guy's & a load]
 * @return {[array]} events [the answer's events]
 */
function show(response, action = null) {
	if (game.gameOver && !response?.result) { return []; } // AN ANSWER SAVED BEFORE A LIVE FORFEIT BUT DELIVERED AFTER IT: THE GAME IS OVER, IT WOULD LAY THE DUEL AGAIN (N1)
	const prev = cards.view, events = takeResponse(response);
	if (!response?.view) { return events; }
	const steps = duelSteps(prev, cards.view, events, action);
	if (cards.view.result && cards.view.duel) { cards.view = { ...cards.view, duel: null }; } // A FINISHED GAME SHOWS NO DUEL (M6): ITS STEPS END IT, THE TABLE GETS THE VIEW WITHOUT ONE (ITS PILES OPEN AGAIN)
	if (!(prev && prev.duel) && cards.view.duel) { keyFocus = null; } // A DUEL STARTS: A HAND STOP ISN'T CARRIED ONTO ITS CARDS (M7)
	lastPlayed = events.filter((e) => e && e.type === "card-played" && e.card && e.card.key).map((e) => e.card).pop() || lastPlayed;
	lastTaken = events.filter((e) => e && e.type === "card-taken" && e.from === cards.you && e.card && typeof e.card === "object").map((e) => e.card).pop() || lastTaken;
	sel = null; // THE GAME MOVED ON: A PICK IN PROGRESS STARTS AGAIN
	dragFrom = null; // A PRESS STILL DOWN (A PLAY THE KEYS MADE MEANWHILE): ITS PIECE GOES DOWN WITH THE PICK (hover), ITS RELEASE MAY NEVER COME
	squareFocus = null;
	confirm = null;
	endPromotion();
	if (steps.length) { showDuel(steps); return events; }
	loadBoard(cards.view);
	refreshTable();
	return events;
}

// THE RENDERER DRAWS chessInst: LOADED WITH THE VIEW'S PIECES, UNCHECKED. A "?" PIECE (NEVER SENT SINCE FOG HIDES WHOLE PIECES) PRINTS AS "?", WHICH chess.js SKIPS
function loadBoard(view) {
	chessInst.load(toFen(view.board), { skipValidation: true });
	game.refresh = true;
}

/**
 * @description An answer's card duel steps (duelShow.js) on the table, after the answers' before it, with a short wait between two as between Card Guy's actions: the deal (no pile stays open),
 * each flip, the winner's gold outline, then the answer's own view on the board & the table (set) at once with the view's duel or its end (S2: set BEFORE endDuel). Nothing is picked &
 * nothing else sets the table meanwhile (showing). Then the table & the prompt are refreshed for what's legal now
 * @param  {[array]} steps [duelSteps']
 */
function showDuel(steps) {
	showing++; // FIRST: ONLY THE CHAIN'S finally BRINGS IT DOWN, ALSO WHEN A STEP THROWS (M5)
	const shown = { view: cards.view, legal: cards.legal }; // THIS ANSWER'S, FOR ITS set: A LATER ANSWER'S VIEW WAITS FOR ITS OWN STEPS
	duelShow = duelShow.then(async function () {
		for (const [i, step] of steps.entries()) {
			if (i && steps[i - 1].op !== "set") { await wait(CARD_GUY_WAIT); }
			if (step.op === "set") { loadBoard(shown.view); refreshTable(shown); }
			else if (step.op === "deal") { if (tablePileOpen3D()) { toggleTablePile3D(null); } dealDuel3D(step.duel); }
			else if (step.op === "flip") { flipDuel3D(step.player, step.index, step.card, step.won); }
			else { endDuel3D(); }
		}
	}).catch((err) => console.warn("The card duel couldn't be shown", err)).finally(function () { showing--; refreshTable(); });
}

/* ---------------------------------------------------------------- */
// Table
/* ---------------------------------------------------------------- */
onTablePick((hit) => { // THE 3D BOARD'S CLICKS & TAPS, & THE MOUSE'S PRESS & RELEASE (THE DRAG)
	if (hit.kind === "release") { releaseSquare(hit.square, Boolean(hit.dragged)); return; }
	if (hit.kind === "press") { pressSquare(hit.square); return; }
	if (hit.kind === "grab") { return landings(hit); }
	if (hit.kind === "drop") { return dropCard(hit); }
	if (hit.kind === "pile") { // A PILE TAPPED: ANOTHER PILE'S DROP BUTTONS GO, A FINGER'S TAP ON ONE OF THE OPENED PILE'S CARDS (id) OFFERS ITS OWN
		if (dropOffer()) { cancelPick(); }
		if (!hit.id) { return false; }
		keyboard = false;
		byMouse = false;
		return offerDrops(hit.pile, hit.id);
	}
	keyboard = false;
	byMouse = !hit.touch;
	if (hit.kind === "hand") { clickCard(hit.id); } else if (hit.kind === "square") { clickSquare(hit.square); } else if (hit.kind === "duel") { pickDuel(hit.index); }
});

const promptBox = document.getElementById("cardPrompt");

// THE PLAYER MAY PICK: THE GAME IS ON, NOTHING IS ON ITS WAY, NO DUEL CARD STILL FLIPPING (showDuel) & IT'S THEIR TURN (A PLAY IN legal, OR UNDER FOG NOTHING OWED BY CARD GUY: THE MOVES AREN'T LISTED)
const yourMove = () => Boolean(cards.view) && !cards.result && !game.gameOver && !sending && !showing && (cards.legal.length > 0 || (cards.hidden && !cards.cardGuyDue));

// AN ANSWER IS ASKED OF THE PLAYER: EVERY LEGAL ACTION IS A CHOICE'S OPTION, OR THE DUEL'S STOP OR CONTINUE (select.js asking)
const choosing = () => S.asking(cards.legal);

/**
 * @description Puts the view, the play being picked & the keyboard's focus on the table, & the prompt when the play needs one. While an answer's duel steps are shown only their set does (I1)
 * @param  {[object|null]} shown [showDuel's { view, legal }: that answer's own, null for the latest (cards.view)]
 */
function refreshTable(shown = null) {
	if (!cards.view || (showing && !shown)) { return; } // NOT AN ARROW OR ANOTHER ANSWER MID-FLIPS: THE TABLE WOULD SHOW THE RESULT BEFORE ITS CARDS FLIP
	const view = shown ? shown.view : cards.view, legal = shown ? shown.legal : cards.legal;
	if (onPlace !== null && !sending && !(sel && sel.card === onPlace)) { onPlace = null; } // ITS PLAY WAS ANSWERED OR GIVEN UP: IT GOES WHERE THE VIEW HAS IT
	if (!sel && choosing() && yourMove()) { sel = S.lift(cards.legal, cards.view, null); } // A CHOICE IS PICKED AT ONCE: ITS PIECES GLOW, ITS OPTIONS ARE BUTTONS
	const { glow, ready } = sel ? S.options(sel, view.board) : { glow: [], ready: [] };
	const stops = S.focusList(legal, view, cards.hidden);
	if (keyFocus !== null) { keyFocus = stops.length ? Math.min(keyFocus, stops.length - 1) : null; }
	if (squareFocus !== null && squareFocus >= glow.length) { squareFocus = null; }
	const stop = keyFocus === null ? null : stops[keyFocus];
	const picking = !promoting && !choosing(); // AS pressSquare: ONLY THEN IS A PIECE PICKED UP
	setTable3D(view, legal, {
		pickable: yourMove() ? view.board.sq.map((p, i) => (picking && p && p.c === cards.you && S.pickPiece(legal, view, sqName(i), cards.hidden) ? sqName(i) : null)).filter(Boolean) : null, // THE 3D HOVER FADES WHAT COVERS THESE & THE GLOWING SQUARES, NOTHING (null) OFF THE PLAYER'S TURN (USER RULING R1, TASK 20E)
		catalog: cards.catalog, focus: stop?.kind === "hand" ? stop.id : null, focusPile: stop?.kind === "pile" ? stop.pile : null, focusDuel: stop?.kind === "duel" ? stop.index : null, dim: S.dimmed(legal, view, cards.hidden),
		lifted: sel ? sel.card : onPlace, glow, glowFocus: squareFocus !== null ? glow[squareFocus] : !glow.length && stop?.kind === "square" ? stop.square : null,
	});
	showPrompt(ready, glow);
	hover();
}

// THE PICKED PIECE FLOATS OVER ITS SQUARE WHILE IT'S PICKED, AS A NORMAL GAME'S CLICKED PIECE DOES (USER RULING 2026-11-22), & COMES DOWN WITH THE PICK. NOT WHILE THE MOUSE DRAGS ONE OR A DROPPED ONE WAITS
function hover() {
	if (dragFrom || dropped) { return; }
	const square = sel && sel.picks.length ? sel.picks[0] : null, p = square && cards.view.board.sq[sqIndex(square)];
	holdTablePiece3D(p && p.c === cards.you ? square : null, false);
}

/**
 * @description The card a prompt is for: the lifted one, the one whose choice it is (the last card played when it's that card, else the pending choice's own card), or the move card a promotion spends
 * @return {[object]} { name, rarity }
 */
function askingCard() {
	const catalog = cards.catalog, faceOf = (c) => (!c ? null : c.key === "move" ? { name: `${S.PIECE_NAMES[c.piece] || "Move"} card`, rarity: null } : c.id === "king" ? { name: "King card", rarity: null } : catalog[c.key] ? { name: catalog[c.key].name, rarity: catalog[c.key].rarity } : null);
	const hand = S.handCards(cards.view);
	if (sel && sel.card !== null) { return faceOf(hand.find((c) => c.id === sel.card)) || { name: "", rarity: null }; }
	if (choosing()) {
		const asked = catalog[S.askedBy(cards.view)]; // IN A DUEL ITS OWN CARD, KNIGHT OR BISHOP TOO (M1: ALSO AFTER A RELOAD)
		const played = lastPlayed && catalog[lastPlayed.key];
		if (played && (!asked || played.name === asked.name)) { return { name: played.name, rarity: played.rarity }; } // A VERSION: THE SAME NAME, ITS OWN RARITY
		return asked ? { name: asked.name, rarity: asked.rarity } : { name: "Choose", rarity: null };
	}
	if (dropOffer()) { return { name: "Your placed cards", rarity: null }; }
	const spent = sel && sel.actions[0] && hand.find((c) => c.id === sel.actions[0].card);
	return faceOf(spent) || { name: "", rarity: null };
}

/**
 * @description The prompt: one button per play the squares can't tell apart (several ready, or ready with none picked: no target, a passive, a curse's clear, a discard), every option of a choice,
 * & Cancel (not for a choice, it must be answered). Or: a King move that spends a King skull asks first (Play). Hidden when there's nothing to press, & while the promotion cards are
 * out: they pick, Escape or a click or tap on the table cancels (user ruling 2026-11-21). Its border is the asking card's rarity colour (brief ruling 9)
 * @param  {[array]} ready [select.js options().ready]
 * @param  {[array]} glow [the squares that glow: while there are some the keys walk them, so the prompt doesn't take the focus]
 */
function showPrompt(ready, glow) {
	const live = Boolean(sel) && yourMove(), mode = live && confirm ? "skull" : null;
	const pick = !live || mode || promoting ? [] : choosing() ? sel.actions : S.promptPlays(sel.picks.length === 0 || ready.length > 1 ? ready : [], { mouse: byMouse, picks: sel.picks.length, placed: sel.card !== null && sel.card === onPlace });
	const key = JSON.stringify([mode, confirm, pick]);
	if (key === shownPrompt) { return; }
	shownPrompt = key;
	if (!promptBox) { return; }
	if (!mode && !pick.length) { promptBox.hidden = true; promptBox.replaceChildren(); promptStart = null; return; }
	const asker = askingCard(), title = document.createElement("p");
	const button = function (text, onClick) { const b = document.createElement("button"); b.type = "button"; b.textContent = text; b.addEventListener("click", onClick); return b; };
	const note = (text) => { const p = document.createElement("p"); p.textContent = text; return p; };
	title.textContent = asker.name;
	promptBox.style.borderColor = rarityColor(asker.rarity);
	promptBox.setAttribute("aria-label", asker.name || "Card choice");
	const lines = [title], play = confirm;
	if (mode === "skull") { lines.push(note(`This move costs a King skull (${cards.view.players[cards.you]?.kingSkulls ?? 0} left).`)); }
	const buttons = mode === "skull" ? [button("Play", () => send(play))] : pick.map((action) => button(S.label(action, cards.view, cards.catalog, lastTaken), () => choose(action)));
	if (mode || !choosing()) { buttons.push(button("Cancel", cancelPick)); }
	promptBox.replaceChildren(...lines, ...buttons);
	promptBox.hidden = false;
	promptStart = buttons[S.promptFocus(pick)];
	if (keyboard && !glow.length) { promptStart.focus(); } // THE KEYS PICKED IT: ENTER PRESSES IT (THE FIRST, OR CANCEL BEFORE A DISCARD: N2), TAB WALKS THE REST. NOT WHILE THE KEYS WALK SQUARES
}

/**
 * @description Plays a picked play: one that spends a King skull asks first (the prompt's Play sends it), the rest are sent
 * @param  {[object]} action [one of cards.legal, or under fog a blind one]
 */
function choose(action) {
	if (S.costsSkull(action, cards.view)) { confirm = action; refreshTable(); return; }
	send(action);
}

// THE ROOM'S PROMOTION CARDS COME OUT FOR A MOVE'S PROMOTIONS: THE RENDERER DEALS THEM (syncCards3D), A PICK (gameplay/input choosePromotion) COMES TO promote
function startPromotion(ready) {
	promoting = ready;
	game.currPromotion = true;
	game.refresh = true;
	refreshTable();
}

// THE PROMOTION CARDS GO BACK
function endPromotion() {
	if (!promoting) { return; }
	promoting = null;
	game.currPromotion = false;
	game.refresh = true;
}

/**
 * @description A promotion card picked (gameplay/input choosePromotion, the mouse or the keys): its play is sent. Under fog, a move with & without a card: the prompt chooses
 * @param  {[string]} type ["q", "r", "b" or "n"]
 */
export function promote(type) {
	const ready = (promoting || []).filter((a) => a.promotion === type);
	endPromotion();
	if (!ready.length || !sel) { cancelPick(); return; }
	if (ready.length === 1) { choose(ready[0]); return; }
	sel = { ...sel, actions: ready };
	refreshTable();
}

/**
 * @description A hand card clicked: it lifts (its plays' squares glow), or, lifted already, an active with no target is played & anything else is put back down
 * @param  {[string]} id [the card's id, "king" for the King card]
 */
function clickCard(id) {
	if (!yourMove() || choosing() || cards.view.duel) { return; } // A DUEL IS ON: NO HAND CARD LIFTS
	settle();
	confirm = null; // A CLICK ELSEWHERE: THE SKULL'S QUESTION & THE PROMOTION CARDS GO
	endPromotion();
	if (sel && sel.card === id) {
		const { glow, ready } = S.options(sel, cards.view.board), play = ready.filter((a) => a.type === "active" && !a.target);
		if (!byMouse && !glow.length && play.length === 1) { choose(play[0]); return; } // ONE MORE TAP OR ENTER CONFIRMS (TABLE UI DOC), ALSO WITH ITS DISCARD ON THE PROMPT. THE MOUSE DRAGS IT TO THE ACTIVE SPOT INSTEAD
		cancelPick();
		return;
	}
	const next = S.lift(cards.legal, cards.view, id, cards.hidden), kind = S.handCards(cards.view).find((c) => c.id === id)?.kind;
	sel = byMouse && (kind === "active" || kind === "passive") ? { card: id, actions: [], picks: [] } : next.actions.length ? next : null; // THE MOUSE'S CLICK ONLY LIFTS AN ACTIVE OR THE PASSIVE TO BE READ: IT'S PLAYED BY DRAGGING (dropCard)
	if (!sel) { showStatus("action", "That card can't be played now.", MESSAGE_TIME); }
	squareFocus = null;
	refreshTable();
}

/**
 * @description The mouse went down on one of the player's cards (three/pointer.js onPointerDown), the drag's start: the places of theirs it can be let go on (select.js dropPlay), which the table frames
 * while it's dragged. A hand card with none is still dragged, & slides back wherever it's let go
 * @param  {[object]} hit [{ from: "hand" | "pile" (a card of an opened pile), id }]
 * @return {[array|null]} places ["spot", "passive", "discard"; null: it isn't picked up (not the player's turn, a choice asked, the promotion cards out, a placed card the game doesn't let them drop)]
 */
function landings({ from, id }) {
	if (!yourMove() || promoting || choosing() || cards.view.duel) { return null; } // A DUEL IS ON: NO CARD IS DRAGGED
	const places = ["spot", "passive", "discard"].filter((place) => S.dropPlay(cards.legal, cards.view, { from, id }, { side: "mine", place }, cards.hidden));
	return from === "pile" && !places.length ? null : places;
}

/**
 * @description The mouse let go of a dragged card (three/pointer.js releaseCard), what select.js dropPlay says: on the discard pile its free discard (a placed card: its drop), an active on the
 * active spot is played, or lies there while its targets are picked (the board lights them; dragged off again, or a click on a square that isn't one, it goes back to the hand), the passive on
 * the passive pile is placed. Anywhere else, or a play the game doesn't offer: the card goes back
 * @param  {[object]} hit [{ from, id, place: three/tableLayout.js placeAt's, null for nowhere }]
 * @return {[boolean]} taken [the card stays on the place: its play was sent or is being picked]
 */
function dropCard({ from, id, place }) {
	if (!yourMove() || promoting || choosing()) { return false; }
	const play = S.dropPlay(cards.legal, cards.view, { from, id }, place, cards.hidden);
	keyboard = false;
	byMouse = true;
	settle();
	confirm = null;
	if (!play) { if (sel && sel.card !== null && (sel.card === id || sel.card === onPlace)) { cancelPick(); } return false; } // ITS OWN PICK GOES DOWN WITH IT: DRAGGED BACK BEFORE THE LAST TARGET. THE PICK OF A CARD LYING ON THE ACTIVE SPOT TOO: THE TABLE SENDS THAT CARD BACK WHEN ANOTHER'S DROP IS REFUSED (REVIEW M1)
	onPlace = id;
	if (play.pick) { sel = play.pick; squareFocus = null; refreshTable(); return true; }
	choose(play.action);
	return true;
}

// THE PICK IS THE DROP BUTTONS OF AN OPENED PILE (offerDrops)
const dropOffer = () => Boolean(sel) && sel.actions.length > 0 && sel.actions.every((a) => a.type === "drop");

/**
 * @description The keys' & a tap's way to drop a placed card (the mouse drags it to the discard pile): with one of the player's own piles opened, Enter on it offers a prompt button per card of it
 * the game lets them drop, a tap on one of its cards that card's (select.js pileDrops). Cancel has the keys' focus (select.js promptFocus)
 * @param  {[string]} pile [the opened pile]
 * @param  {[string|null]} id [the card tapped, null: every card of the pile]
 * @return {[boolean]} offered [false: nothing to drop there now]
 */
function offerDrops(pile, id = null) {
	if (!yourMove() || promoting || choosing()) { return false; }
	const drops = S.pileDrops(cards.legal, cards.view, pile, id);
	if (!drops.length) { return false; }
	settle();
	confirm = null;
	sel = { card: null, actions: drops, picks: [] };
	squareFocus = null;
	refreshTable();
	return true;
}

/**
 * @description A square clicked: the next square of the play being picked, another piece for the lifted card, or a piece picked directly (shortcutFor). The last square of a play sends it;
 * several plays on the same squares go to the prompt. A square that leads nowhere puts the pick down
 * @param  {[string]} square ["e4"]
 */
function clickSquare(square, drop = false) {
	if (!yourMove()) { return; }
	if (!drop) { settle(); } // A CLICK ELSEWHERE GIVES THE DROPPED PIECE'S PLAY UP
	if (promoting) { cancelPick(); return; } // A CLICK AWAY FROM THE PROMOTION CARDS PUTS THE MOVE DOWN
	const again = !drop && !pressedNew && !choosing() && sel && sel.picks.length === 1 && sel.picks[0] === square;
	pressedNew = false;
	if (again) { cancelPick(); return; } // THE PICKED PIECE CLICKED AGAIN: IT & ITS CARD GO DOWN, AS A NORMAL GAME'S (USER RULING 2026-11-22)
	confirm = null;
	const board = cards.view.board;
	let next = sel && S.pick(sel, board, square);
	if (!next && sel && sel.card !== null && sel.picks.length) { next = S.pick({ ...sel, picks: [] }, board, square); } // ANOTHER OF THE LIFTED CARD'S PIECES
	if (!next && !choosing()) { next = S.pickPiece(cards.legal, cards.view, square, cards.hidden); } // A PIECE PICKED DIRECTLY, A CARD OF ITS TYPE SPENT
	if (!next) { if (sel && !choosing()) { cancelPick(); } return; }
	sel = next;
	squareFocus = null;
	const { ready } = S.options(sel, board);
	if (sel.picks.length && S.promotionPick(ready)) { startPromotion(ready); return; }
	if (ready.length === 1 && sel.picks.length) { choose(ready[0]); return; }
	refreshTable();
}

/**
 * @description A left mouse press on a square (three/pointer.js onPointerDown), the drag's start (user ruling 2026-11-22): on the player's turn, with no promotion cards out & no choice asked,
 * one of the player's pieces that select.js pressPick gives a pick for is picked as a click on it would (its squares glow) & held: past the drag threshold it follows the pointer.
 * A piece with nothing to play isn't held, with no message. The click that follows a press that didn't drag picks the same again (clickSquare): one pick
 * @param  {[string]} square ["e2"]
 */
function pressSquare(square) {
	if (!yourMove() || promoting || choosing()) { return; }
	const next = S.pressPick(sel, cards.legal, cards.view, square, cards.hidden);
	if (!next) { return; }
	pressedNew = !(sel && sel.picks.length === 1 && sel.picks[0] === square);
	settle();
	keyboard = false;
	byMouse = true;
	confirm = null; // AS A CLICK ELSEWHERE: THE SKULL'S QUESTION GOES
	sel = next;
	squareFocus = null;
	dragFrom = square;
	holdTablePiece3D(square, true);
	refreshTable();
}

/**
 * @description The mouse let go of a held piece (three/pointer.js onPointerUp): it goes back to its square. Dragged onto one of its pick's squares, that is a click on the square
 * (clickSquare: one ready play is sent, a skull move asks first, a promotion deals the cards, two forms of a square go to the prompt). Anywhere else a drag puts the piece & its card down (a click on a square that isn't a target does too, clickSquare); a press that never dragged keeps the pick
 * @param  {[string|null]} square [the square a drag was let go on, null for none (off the board, on the glass or a card) or a press that never dragged: its click follows]
 * @param  {[boolean]} dragged [the piece followed the pointer]
 */
function releaseSquare(square, dragged = false) {
	const from = dragFrom;
	dragFrom = null;
	if (!(square && sel && sel.picks.length === 1 && sel.picks[0] === from && yourMove() && !promoting && S.pick(sel, cards.view.board, square))) { // sel.picks: NOT A PICK THE KEYS MADE MEANWHILE
		if (dragged && from) { pressedNew = false; cancelPick(); } else { hover(); } // DRAGGED & LET GO OFF ITS TARGETS, ITS OWN SQUARE TOO: THE PIECE & ITS CARD GO DOWN (USER RULINGS 2026-11-22). A PRESS THAT NEVER DRAGGED KEEPS THE PICK, FLOATING: ITS CLICK FOLLOWS
		return;
	}
	dropTablePiece3D(square); // IT LANDS ON THE TARGET AT ONCE (USER RULINGS 2026-11-22)
	keyboard = false;
	dropped = from; // send'S ANSWER OR A PICK GIVEN UP SENDS IT HOME (settle)
	clickSquare(square, true);
}

// A DUEL CARD PICKED (A CLICK, A TAP, ENTER ON THE KEYS' ONE): ITS PICK IS SENT WHEN legal HAS IT. ONE GRACE BARS IS HIT ON THE TABLE BUT ISN'T LEGAL: NOTHING HAPPENS
function pickDuel(index) {
	const action = yourMove() && cards.legal.find((a) => a.type === "duel" && a.pick === index);
	if (action) { send(action); }
}

// A DROPPED PIECE WHOSE PLAY WASN'T MADE GOES BACK TO ITS SQUARE (GIVEN UP, REFUSED, NO ANSWER). A MADE MOVE LEFT ITS SQUARE: NOTHING THERE TO PUT DOWN, ITS SLIDE ENDS IT
function settle() {
	if (!dropped) { return; }
	holdTablePiece3D(dropped, false);
	holdTablePiece3D(null);
	dropped = null;
}

// PUTS THE PICK DOWN, THE SKULL'S QUESTION & THE PROMOTION CARDS WITH IT
function cancelPick() {
	settle();
	sel = null;
	squareFocus = null;
	confirm = null;
	endPromotion();
	refreshTable();
}

/**
 * @description The menu is opening (moves/index.js revertUnfinishedMove): the card being played goes down. Also when the game is over (showGameOver opens the menu, or at the 3D monitor
 * calls revertUnfinishedMove): a duel still on (a forfeit, the chess route's) ends on the table, after any steps still being shown, & frees the hands & the piles (M6)
 */
export function putDown() {
	if (game.gameOver && cards.view?.duel) { cards.view = { ...cards.view, duel: null }; showDuel([{ op: "set" }, { op: "end" }]); }
	if (sel || confirm || promoting) { cancelPick(); }
}

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
	refreshTable();
	const piece = () => dropped && cards.view?.board.sq[sqIndex(dropped)]?.id, was = piece();
	try { await act(action); }
	finally {
		sending = false;
		if (dropped && piece() === was) { settle(); } // STILL ON ITS SQUARE: THE PLAY WASN'T MADE
		dropped = null;
		refreshTable();
	}
}

/**
 * @description A Chess Cards game's key (gameplay/input handleHandKey), what it does decided by select.js keyPlan. While the game is on the arrows & Enter stay off the page's nav: off the
 * player's turn the arrows step through select.js focusList & Enter does nothing (N1). On it the arrows step through focusList (the hand, the pieces with a move that needs no card, the
 * Board Effects piles), or while a play's squares glow through them; Enter lifts the focused card, picks the focused piece or square, or opens the focused pile (with none focused yet:
 * focuses the first; on the player's own opened pile it offers its drop buttons, offerDrops); Escape puts the pick down, then closes an opened pile, off the turn too. A prompt with nothing glowing takes the first key's focus (one Card Guy's play raised doesn't have it). A focused button keeps Enter, an
 * arrow takes the focus off it first. While the promotion cards are out only Escape is the hand's (handleCardKey has the rest). A held key (repeat) does nothing more
 * @param  {[string]} key [a KeyboardEvent.key: an arrow, "Enter" or "Escape"]
 * @param  {[boolean]} repeat [KeyboardEvent.repeat]
 * @param  {[boolean]} button [a button or link has the focus]
 * @return {[boolean]} [the key was used or stopped: the page doesn't get it]
 */
export function handKey(key, repeat = false, button = false) {
	const on = Boolean(cards.view) && !cards.result && !game.gameOver, yours = on && yourMove(), picked = Boolean(sel) && !choosing(), pile = tablePileOpen3D();
	const plan = S.keyPlan({ key, repeat, on, yours, button, promoting: Boolean(promoting), picked, pile: Boolean(pile) });
	if (plan === "page" || plan === "stop") { return plan === "stop"; }
	if (plan === "blur") { document.activeElement?.blur(); } // AN ARROW: THE BUTTON LETS GO OF THE FOCUS, SO A LATER ENTER IS THE HAND'S (N1)
	if (key === "Escape" && !(yours && picked)) { toggleTablePile3D(null); return true; } // NO PICK TO PUT DOWN: THE OPENED PILE CLOSES, ON THE TURN OR OFF IT (keyPlan GIVES THE MENU ITS ESCAPE WHEN NONE IS OPEN)
	if (!yours) { keyFocus = S.stepFocus(S.focusList(cards.legal, cards.view, cards.hidden).length, keyFocus, key); refreshTable(); return true; } // CARD GUY'S TURN, AN ACTION ON ITS WAY: ONLY AN ARROW GETS HERE
	settle(); // THE KEYS TAKE OVER: A DROPPED PIECE GOES HOME
	keyboard = true;
	byMouse = false;
	if (key === "Escape") { cancelPick(); return true; }
	const { glow } = sel ? S.options(sel, cards.view.board) : { glow: [] };
	if (promptStart && !glow.length) { promptStart.focus(); return true; } // ITS BUTTONS ARE THE WAY ON
	if (glow.length) { // A PLAY'S SQUARES
		if (key !== "Enter") { squareFocus = S.stepFocus(glow.length, squareFocus, key); refreshTable(); return true; }
		if (squareFocus === null) { squareFocus = 0; refreshTable(); return true; }
		clickSquare(glow[squareFocus]);
		return true;
	}
	const stops = S.focusList(cards.legal, cards.view, cards.hidden);
	if (key !== "Enter") { keyFocus = S.stepFocus(stops.length, keyFocus, key); refreshTable(); return true; }
	if (keyFocus === null) { keyFocus = stops.length ? 0 : null; refreshTable(); return true; }
	const stop = stops[keyFocus];
	if (stop.kind === "hand") { clickCard(stop.id); }
	else if (stop.kind === "square") { clickSquare(stop.square); }
	else if (stop.kind === "duel") { pickDuel(stop.index); }
	else if (!(pile === stop.pile && offerDrops(stop.pile))) { toggleTablePile3D(stop.pile); } // ENTER ON THE PLAYER'S OWN OPENED PILE: ITS DROP BUTTONS WHEN THE GAME LISTS ONE, ELSE IT CLOSES
	return true;
}

/**
 * @description A game saved by an older engine version can't go on: the message says so & the prompt offers to forfeit it (the forfeit route), then Home
 * @param  {[string]} gameId
 */
function offerForfeit(gameId) {
	showStatus("server", "This Chess Cards game is from an older version and can't go on.");
	if (!promptBox) { return; }
	const title = document.createElement("p"), forfeit = document.createElement("button");
	title.textContent = "Older version";
	forfeit.type = "button";
	forfeit.textContent = "Forfeit it & go Home";
	forfeit.addEventListener("click", async function () {
		forfeit.disabled = true;
		const done = await forfeitGame(game.GAME_URL, gameId);
		if (done?.status === 200) { window.location.assign("/"); return; }
		forfeit.disabled = false;
		showStatus("action", "The forfeit didn't go through. Try again.", MESSAGE_TIME);
	});
	promptBox.replaceChildren(title, forfeit);
	promptBox.hidden = false;
}
