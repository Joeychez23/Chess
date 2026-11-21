/*
 *  flow.js  --  chess frontend
 *	Chess Cards Flow
 *	Runs a card game on the play page, in place of the chess one (startGame in gameplay/index.js, when GET /game/:gameId says mode "cards"): startCards puts the
 *	card route's answer on the board, act sends one of the player's legal actions & while Card Guy owes one (card_guy_due: its turn, a duel pick or a choice)
 *	it's asked for half a second later, like the AI's move. The server decides everything (store.js keeps its answer): the board only shows the view's pieces,
 *	chess.js holds them for the renderer & is never asked what's legal. The table (three/cardTable.js, through the renderer) shows the hands, decks & Board Effects,
 *	& the player plays from it: a card clicked (or picked with the keys) lifts, the squares select.js offers glow, the last one picked sends the action, a prompt
 *	(#cardPrompt) chooses when several plays share the squares or need none (or asks first when a King move spends a King skull), & a move's promotions deal the
 *	room's promotion cards, as in a normal game
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
const S = require("./select.js"); // WHAT THE TABLE LETS THE PLAYER PICK, FROM cards.legal
const { setTable3D, onTablePick, toggleTablePile3D } = require("../renderer/index.js"); // THE TABLE ON THE 3D BOARD
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
let promoting = null; // A MOVE'S PROMOTIONS WHILE THE ROOM'S PROMOTION CARDS ARE OUT (game.currPromotion), ONE PICKED SENDS ITS PLAY (promote)
let shownPrompt = null; // WHAT THE PROMPT SHOWS (ITS BUTTONS AS JSON), SO IT'S ONLY REBUILT WHEN THAT CHANGES
let promptStart = null; // THE PROMPT'S BUTTON THE KEYS FOCUS (select.js promptFocus), null WHILE IT'S HIDDEN

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
export async function act(action) {
	const response = await sendAction(game.GAME_URL, game.GAME_ID, action);
	if (!response?.view) {
		console.log(response?.message || "The action didn't go through: no answer from the server");
		showStatus("action", "That didn't go through. Try again.", MESSAGE_TIME);
		return [];
	}
	if (response.status === 409 && !response.stale && !response.result) { showStatus("action", cards.hidden ? "That move isn't allowed. The fog hides why." : "That play isn't allowed now.", MESSAGE_TIME); } // NOT LEGAL: UNDER FOG A BLIND MOVE THE SERVER REFUSED
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
			keyboard = false; // A PROMPT CARD GUY'S PLAY RAISES DOESN'T TAKE THE FOCUS: AN ENTER MEANT FOR SOMETHING ELSE WOULD ANSWER IT
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
	chessInst.load(toFen(cards.view.board), { skipValidation: true }); // A "?" PIECE (NEVER SENT SINCE FOG HIDES WHOLE PIECES) PRINTS AS "?", WHICH chess.js SKIPS
	game.refresh = true;
	lastPlayed = events.filter((e) => e && e.type === "card-played" && e.card && e.card.key).map((e) => e.card).pop() || lastPlayed;
	lastTaken = events.filter((e) => e && e.type === "card-taken" && e.from === cards.you && e.card && typeof e.card === "object").map((e) => e.card).pop() || lastTaken;
	sel = null; // THE GAME MOVED ON: A PICK IN PROGRESS STARTS AGAIN
	squareFocus = null;
	confirm = null;
	endPromotion();
	refreshTable();
	return events;
}

/* ---------------------------------------------------------------- */
// Table
/* ---------------------------------------------------------------- */
onTablePick((hit) => { keyboard = false; if (hit.kind === "hand") { clickCard(hit.id); } else if (hit.kind === "square") { clickSquare(hit.square); } }); // THE 3D BOARD'S CLICKS & TAPS

const promptBox = document.getElementById("cardPrompt");

// THE PLAYER MAY PICK: THE GAME IS ON, NOTHING IS ON ITS WAY & IT'S THEIR TURN (A PLAY IN legal, OR UNDER FOG NOTHING OWED BY CARD GUY: THE MOVES AREN'T LISTED)
const yourMove = () => Boolean(cards.view) && !cards.result && !game.gameOver && !sending && (cards.legal.length > 0 || (cards.hidden && !cards.cardGuyDue));

// A CHOICE IS ASKED OF THE PLAYER: EVERY LEGAL ACTION IS AN OPTION OF IT
const choosing = () => cards.legal.length > 0 && cards.legal.every((a) => a.type === "choice");

/**
 * @description Puts the view, the play being picked & the keyboard's focus on the table, & the prompt when the play needs one
 */
function refreshTable() {
	if (!cards.view) { return; }
	if (!sel && choosing() && yourMove()) { sel = S.lift(cards.legal, cards.view, null); } // A CHOICE IS PICKED AT ONCE: ITS PIECES GLOW, ITS OPTIONS ARE BUTTONS
	const { glow, ready } = sel ? S.options(sel, cards.view.board) : { glow: [], ready: [] };
	const stops = S.focusList(cards.legal, cards.view, cards.hidden);
	if (keyFocus !== null) { keyFocus = stops.length ? Math.min(keyFocus, stops.length - 1) : null; }
	if (squareFocus !== null && squareFocus >= glow.length) { squareFocus = null; }
	const stop = keyFocus === null ? null : stops[keyFocus];
	setTable3D(cards.view, cards.legal, {
		catalog: cards.catalog, focus: stop?.kind === "hand" ? stop.id : null, focusPile: stop?.kind === "pile" ? stop.pile : null, dim: S.dimmed(cards.legal, cards.view, cards.hidden),
		lifted: sel ? sel.card : null, glow, glowFocus: squareFocus !== null ? glow[squareFocus] : !glow.length && stop?.kind === "square" ? stop.square : null,
	});
	showPrompt(ready, glow);
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
		const asked = cards.view.pending && catalog[cards.view.pending.card];
		const played = lastPlayed && catalog[lastPlayed.key];
		if (played && (!asked || played.name === asked.name)) { return { name: played.name, rarity: played.rarity }; } // A VERSION: THE SAME NAME, ITS OWN RARITY
		return asked ? { name: asked.name, rarity: asked.rarity } : { name: "Choose", rarity: null };
	}
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
	const pick = !live || mode || promoting ? [] : choosing() ? sel.actions : sel.picks.length === 0 || ready.length > 1 ? ready : [];
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
	if (!yourMove() || choosing()) { return; }
	confirm = null; // A CLICK ELSEWHERE: THE SKULL'S QUESTION & THE PROMOTION CARDS GO
	endPromotion();
	if (sel && sel.card === id) {
		const { glow, ready } = S.options(sel, cards.view.board), play = ready.filter((a) => a.type === "active" && !a.target);
		if (!glow.length && play.length === 1) { choose(play[0]); return; } // ONE MORE CLICK CONFIRMS (TABLE UI DOC), ALSO WITH ITS DISCARD ON THE PROMPT
		cancelPick();
		return;
	}
	const next = S.lift(cards.legal, cards.view, id, cards.hidden);
	sel = next.actions.length ? next : null;
	if (!sel) { showStatus("action", "That card can't be played now.", MESSAGE_TIME); }
	squareFocus = null;
	refreshTable();
}

/**
 * @description A square clicked: the next square of the play being picked, another piece for the lifted card, or a piece picked directly (shortcutFor). The last square of a play sends it;
 * several plays on the same squares go to the prompt. A square that leads nowhere puts the pick down
 * @param  {[string]} square ["e4"]
 */
function clickSquare(square) {
	if (!yourMove()) { return; }
	if (promoting) { cancelPick(); return; } // A CLICK AWAY FROM THE PROMOTION CARDS PUTS THE MOVE DOWN
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

// PUTS THE PICK DOWN, THE SKULL'S QUESTION & THE PROMOTION CARDS WITH IT
function cancelPick() {
	sel = null;
	squareFocus = null;
	confirm = null;
	endPromotion();
	refreshTable();
}

/**
 * @description The menu is opening (moves/index.js revertUnfinishedMove): the card being played goes down
 */
export function putDown() {
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
	try { await act(action); }
	finally { sending = false; refreshTable(); }
}

/**
 * @description A Chess Cards game's key (gameplay/input handleHandKey), what it does decided by select.js keyPlan. While the game is on the arrows & Enter stay off the page's nav: off the
 * player's turn the arrows step through select.js focusList & Enter does nothing (N1). On it the arrows step through focusList (the hand, the pieces with a move that needs no card, the
 * Board Effects piles), or while a play's squares glow through them; Enter lifts the focused card, picks the focused piece or square, or opens the focused pile (with none focused yet:
 * focuses the first); Escape puts the pick down. A prompt with nothing glowing takes the first key's focus (one Card Guy's play raised doesn't have it). A focused button keeps Enter, an
 * arrow takes the focus off it first. While the promotion cards are out only Escape is the hand's (handleCardKey has the rest). A held key (repeat) does nothing more
 * @param  {[string]} key [a KeyboardEvent.key: an arrow, "Enter" or "Escape"]
 * @param  {[boolean]} repeat [KeyboardEvent.repeat]
 * @param  {[boolean]} button [a button or link has the focus]
 * @return {[boolean]} [the key was used or stopped: the page doesn't get it]
 */
export function handKey(key, repeat = false, button = false) {
	const on = Boolean(cards.view) && !cards.result && !game.gameOver, yours = on && yourMove();
	const plan = S.keyPlan({ key, repeat, on, yours, button, promoting: Boolean(promoting), picked: Boolean(sel) && !choosing() });
	if (plan === "page" || plan === "stop") { return plan === "stop"; }
	if (plan === "blur") { document.activeElement?.blur(); } // AN ARROW: THE BUTTON LETS GO OF THE FOCUS, SO A LATER ENTER IS THE HAND'S (N1)
	if (!yours) { keyFocus = S.stepFocus(S.focusList(cards.legal, cards.view, cards.hidden).length, keyFocus, key); refreshTable(); return true; } // CARD GUY'S TURN, AN ACTION ON ITS WAY: ONLY AN ARROW GETS HERE
	keyboard = true;
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
	else { toggleTablePile3D(stop.pile); }
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
