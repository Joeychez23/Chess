/*
 *  cards.prompts.js  --  chess frontend
 *	Chess Cards Prompts
 *	The prompt box (#cardPrompt) and the promotion cards: what the prompt asks and its buttons (showPrompt), a picked play sent
 *	or asked about first (choose), the promotion cards dealt and picked (promote), and the parts the prompt reads
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game } = require("../state/index.js");
const { cards } = require("./store.js");
const cardsSelect = require("./select.js");
const { showTableButtons3D, focusTableButton3D, pressTableButton3D } = require("../renderer/index.js");
const { plaqueAnchor } = require("../three/cardTable/tableLayout.js");
const { rarityColor } = require("../three/cardTable/cardFaces.js");
const cardsState = require("./cards.state.js");

export const promptBox = document.getElementById("cardPrompt");
let shownPrompt = null; // what the prompt shows (its buttons as JSON), so it's only rebuilt when that changes

/**
 * @description The card a prompt is for: the lifted one, the one whose choice it is (the last card played when it's that card,
 * else the pending choice's own card), or the move card a promotion spends
 * @return {[object]} { name, rarity }
 */
function askingCard() {
	const catalog = cards.catalog;
	const hand = cardsSelect.handCards(cards.view);
	if (cardsState.state.sel && cardsState.state.sel.card !== null) { return cardFace(hand.find((card) => card.id === cardsState.state.sel.card), catalog) || { name: "", rarity: null }; }
	if (choosing()) {
		const asked = catalog[cardsSelect.askedBy(cards.view)]; // in a duel its own card, Knight or Bishop too, also after a reload
		const played = cardsState.state.lastPlayed && catalog[cardsState.state.lastPlayed.key];
		// A version: the same name, its own rarity
		if (played && (!asked || played.name === asked.name)) { return { name: played.name, rarity: played.rarity }; }
		return asked ? { name: asked.name, rarity: asked.rarity } : { name: "Choose", rarity: null };
	}
	if (dropOffer()) { return { name: "Your placed cards", rarity: null }; }
	const spent = cardsState.state.sel && cardsState.state.sel.actions[0] && hand.find((card) => card.id === cardsState.state.sel.actions[0].card);
	return cardFace(spent, catalog) || { name: "", rarity: null };
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
export function showPrompt(ready, glow) {
	const live = Boolean(cardsState.state.sel) && cardsState.calls.yourMove();
	const mode = live && cardsState.state.confirm ? "skull" : null;
	let pick = [];
	if (live && !mode && !cardsState.state.promoting) {
		const shared = cardsState.state.sel.picks.length === 0 || ready.length > 1 ? ready : [];
		const placed = cardsState.state.sel.card !== null && cardsState.state.sel.card === cardsState.state.onPlace;
		pick = choosing() ? cardsState.state.sel.actions : cardsSelect.promptPlays(shared, { mouse: cardsState.state.byMouse, picks: cardsState.state.sel.picks.length, placed });
	}
	const ask = { skull: mode ? cardsState.state.confirm : null, pick, choosing: choosing() };
	const at = live && (mode || pick.length)
		? cardsSelect.plaquePrompt({ ...ask, duel: Boolean(cards.view.duel), card: cardsState.state.sel.card, hidden: cards.hidden })
		: null;
	const key = JSON.stringify([mode, cardsState.state.confirm, pick, at]);
	const list = cardsSelect.promptButtons(ask, cards.view, cards.catalog, cardsState.state.lastTaken);
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
		cardsState.state.promptStart = null;
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
		b.addEventListener("click", () => { cardsState.calls.endZoom(); pressTableButton3D(id); onClick(); });
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
	cardsState.state.promptStart = buttons[cardsSelect.promptFocus(pick)];
	// The keys picked it: Enter presses it (the first, or Cancel before a discard), Tab walks the rest. Not while the keys walk squares
	if (cardsState.state.keyboard && !glow.length) { cardsState.state.promptStart.focus(); }
}

// What a prompt button does: Cancel (no action) puts the pick down, the skull's Play sends the King move asked, any other chooses its play
function promptAnswer(item, mode) {
	if (item.action === null) { return cardsState.calls.cancelPick; }
	if (mode) { return () => cardsState.calls.send(item.action); }
	return () => choose(item.action);
}

/**
 * @description Plays a picked play: one that spends a King skull asks first (the prompt's Play sends it), the rest are sent
 * @param  {[object]} action [one of cards.legal, or under fog a blind one]
 */
export function choose(action) {
	if (cardsSelect.costsSkull(action, cards.view)) {
		cardsState.state.confirm = action;
		cardsState.calls.refreshTable();
		return;
	}
	cardsState.calls.send(action);
}

/* ---------------------------------------------------------------- */
// Promotion
/* ---------------------------------------------------------------- */

// The room's promotion cards come out for a move's promotions: the renderer deals them (syncCards3D), and a pick
// (gameplay/input choosePromotion) comes to promote
export function startPromotion(ready) {
	cardsState.state.promoting = ready;
	game.currPromotion = true;
	game.refresh = true;
	cardsState.calls.refreshTable();
}

// The promotion cards go back
export function endPromotion() {
	if (!cardsState.state.promoting) { return; }
	cardsState.state.promoting = null;
	game.currPromotion = false;
	game.refresh = true;
}

/**
 * @description A promotion card picked (gameplay/input choosePromotion, the mouse or the keys): its play is sent. Under fog, a
 * move with and without a card: the prompt chooses
 * @param  {[string]} type ["q", "r", "b" or "n"]
 */
export function promote(type) {
	const ready = (cardsState.state.promoting || []).filter((action) => action.promotion === type);
	endPromotion();
	if (!ready.length || !cardsState.state.sel) {
		cardsState.calls.cancelPick();
		return;
	}
	if (ready.length === 1) {
		choose(ready[0]);
		return;
	}
	cardsState.state.sel = { ...cardsState.state.sel, actions: ready };
	cardsState.calls.refreshTable();
}

/* ---------------------------------------------------------------- */
// The prompt's parts
/* ---------------------------------------------------------------- */
// The pick is the drop buttons of an opened pile (offerDrops)
export function dropOffer() {
	return Boolean(cardsState.state.sel) && cardsState.state.sel.actions.length > 0 && cardsState.state.sel.actions.every((action) => action.type === "drop");
}

// An answer is asked of the player: every legal action is a choice's option, or the duel's Stop or Continue (select.js asking)
export function choosing() {
	return cardsSelect.asking(cards.legal);
}

// A hand card's name and rarity for a prompt's title, null when the catalog doesn't know it
function cardFace(card, catalog) {
	if (!card) { return null; }
	if (card.key === "move") { return { name: `${cardsSelect.PIECE_NAMES[card.piece] || "Move"} card`, rarity: null }; }
	if (card.id === "king") { return { name: "King card", rarity: null }; }
	const entry = catalog[card.key];
	return entry ? { name: entry.name, rarity: entry.rarity } : null;
}

// A line of text under the prompt's title
function promptNote(text) {
	const note = document.createElement("p");
	note.textContent = text;
	return note;
}
