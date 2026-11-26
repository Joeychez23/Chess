/*
 *  boxNav.js  --  chess frontend
 *	Box Navigation
 *	The keyboard navigation between the boxes of Guest, Home, Login, Signup & Settings.
 *	The row helpers: the page's elements grouped into rows by where they are on screen, & the steps between them.
 *	boxKeys() is the page's keys, passed to the menu (nav.js): arrows move between the boxes (the hero & .box elements)
 *	& the menu button, Enter goes into a box, Escape comes back out.
 *	A text box or dropdown has two states: moving (data-moving: the arrows move past it, typing is blocked) & using
 *	(typing, its own arrows). Going to one starts it moving, Enter or Escape in a dropdown & Enter in a text box switch it.
 *	A text box in using still leaves with the arrow keys (not W, A, S & D, which type): Up & Down always, Left & Right
 *	with the cursor at that end.
 *
 */

import { createNav, isMoving, typedIn, pageElements, canLeave } from "./nav.js";

const ARROWS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
const TOP_STOPS = ".hero, .box"; // The boxes the arrows move between

/* ---------------------------------------------------------------- */
// Start Box Nav
/* ---------------------------------------------------------------- */
/**
 * @description Guest, Home, Login, Signup & Settings: the menu (nav.js) with the page's keys. The boxes can take focus (not Tab),
 * & a field stops moving when it loses focus
 * @return {[function]} toggleNav [toggleNav(true) opens the menu, toggleNav(false) closes it]
 */
export function startBoxNav() {
	const optBtn = document.getElementById("optBtn");
	document.querySelectorAll(TOP_STOPS).forEach((stop) => stop.setAttribute("tabindex", "-1")); // Focused by the keys, never by Tab
	watchMoving();
	const nav = createNav({ boxKeys: (e, key) => boxKeys(e, key, optBtn) });
	nav.addListeners();
	return nav.toggleNav;
}

/* ---------------------------------------------------------------- */
// Watch Moving
/* ---------------------------------------------------------------- */
/**
 * @description What ends or stops a field's moving state besides the keys: leaving it (focusout, but not the window losing focus),
 * a click on it or its label (it types, the same as Tab), & text getting in some other way (AltGr, dead keys, IME, the context
 * menu's paste, a drop)
 */
export function watchMoving() {
	// A window losing focus keeps its field, so the state stays too
	document.addEventListener("focusout", function (e) { if (document.activeElement != e.target) { delete e.target.dataset?.moving; } });
	document.addEventListener("pointerdown", function (e) {
		const field = document.activeElement;
		// A click on a focused field or its label moves no focus, so focusout never comes
		if (isMoving(field) && (field.contains(e.target) || e.target.closest?.("label")?.control == field)) { delete field.dataset.moving; }
	});
	document.addEventListener("beforeinput", function (e) { if (isMoving(e.target)) { e.preventDefault(); } });
}

/* ---------------------------------------------------------------- */
// Box Keys
/* ---------------------------------------------------------------- */
/**
 * @description The page's keys while the menu is closed (nav.js calls it before its own). Any modifier leaves the key alone
 * (the browser's shortcuts), except on a moving field (editsMoving()) where the keys that would edit or submit it are blocked.
 * Otherwise: nothing focused, an arrow or Enter goes to the menu button; on the menu button or a box the arrows move among the boxes,
 * Enter goes in & Escape drops the focus; in a box the arrows move among its items & Escape goes back to the box; a field is moving
 * (the keys move past it) or using (it types)
 * @param  {[object]} e [the keydown, it's prevented here when the key is taken]
 * @param  {[string]} key [arrowKey(e): W, A, S & D come as arrows]
 * @param  {[object]} optBtn [the menu button]
 * @return {[boolean]} taken [true: used the key & prevented it, false: left it alone]
 */
export function boxKeys(e, key, optBtn) {
	const focused = document.activeElement;
	if (isMoving(focused) && editsMoving(e)) { return takeKey(e); }
	if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) { return false; }
	if (!focused || focused == document.body) { return nothingFocusedKeys(e, key, optBtn); }
	const stops = topStops();
	if (focused == optBtn || stops.includes(focused)) { return topLevelKeys(e, key, focused, stops, optBtn); }
	// contains, not pageElements: a button turned off mid-request can't take focus any more but is still in its box
	const box = stops.find((stop) => stop.contains(focused));
	if (!isField(focused)) { return boxItemKeys(e, key, focused, box, optBtn); }
	if (!isMoving(focused)) { return usingFieldKeys(e, key, focused, box, optBtn); }
	return movingFieldKeys(e, key, focused, box, optBtn);
}

/**
 * @description Takes the key: the browser does nothing more with it
 * @param  {[object]} e [the keydown]
 * @return {[boolean]} taken [always true]
 */
function takeKey(e) {
	e.preventDefault();
	return true;
}

/**
 * @description Would the browser edit or change a moving field with this key & a modifier? Enter (submits), Backspace & Delete with
 * any modifier, a printable key with Alt, Ctrl or Cmd with V or X (paste & cut), & any key with Shift but Tab (Shift+Home on a
 * dropdown). Option+letter types on macOS. Other Ctrl, Cmd & Alt shortcuts (reload, copy, select all) & Shift+Tab are the browser's
 * @param  {[object]} e [the keydown]
 * @return {[boolean]} blocked
 */
function editsMoving(e) {
	const modified = e.altKey || e.ctrlKey || e.metaKey || e.shiftKey;
	// Enter alone switches to using, boxKeys does that
	if (e.key == "Enter" || e.key == "Backspace" || e.key == "Delete") { return modified; }
	if (e.ctrlKey || e.metaKey) { return e.key.length == 1 && "vx".includes(e.key.toLowerCase()); }
	if (e.altKey) { return e.key.length == 1; }
	return e.shiftKey && e.key != "Tab";
}

/**
 * @description Nothing has the focus (Escape dropped it): an arrow or Enter goes to the menu button
 * @param  {[object]} e [the keydown]
 * @param  {[string]} key [arrowKey(e)]
 * @param  {[object]} optBtn [the menu button]
 * @return {[boolean]} taken
 */
function nothingFocusedKeys(e, key, optBtn) {
	if (!ARROWS.includes(key) && key != "Enter") { return false; }
	optBtn.focus();
	return takeKey(e);
}

/**
 * @description The top level, the menu button or a box: the arrows move among the boxes, Enter goes into a box & Escape drops the focus.
 * Enter on the menu button is left to it, it opens the menu
 * @param  {[object]} e [the keydown]
 * @param  {[string]} key [arrowKey(e)]
 * @param  {[object]} focused [the menu button or a box]
 * @param  {[array]} stops [topStops()]
 * @param  {[object]} optBtn [the menu button]
 * @return {[boolean]} taken
 */
function topLevelKeys(e, key, focused, stops, optBtn) {
	if (key == "Escape") {
		focused.blur();
		return takeKey(e);
	}
	if (ARROWS.includes(key)) {
		const next = stepIn(topRows(stops, optBtn), focused, key);
		if (next) { goTo(next, optBtn); }
		return takeKey(e);
	}
	if (key != "Enter" || focused == optBtn) { return false; }
	// An info box or a hero with no links (Home's) has none, the focus stays
	const first = rowsOf(pageElements(focused), rectOf)[0]?.[0];
	if (first) { goTo(first, optBtn); }
	return takeKey(e);
}

/**
 * @description A button or link in a box: the arrows move among the box's items & Escape goes back to the box.
 * Its native press (Enter, Space) is left to it
 * @param  {[object]} e [the keydown]
 * @param  {[string]} key [arrowKey(e)]
 * @param  {[object]} focused [the button or link]
 * @param  {[object]} box [the box it's in, undefined when it's in none]
 * @param  {[object]} optBtn [the menu button]
 * @return {[boolean]} taken
 */
function boxItemKeys(e, key, focused, box, optBtn) {
	const arrow = ARROWS.includes(key);
	if (!box || (!arrow && key != "Escape")) { return false; }
	if (key == "Escape") {
		goTo(box, optBtn);
		return takeKey(e);
	}
	const next = stepIn(rowsOf(pageElements(box), rectOf), focused, key);
	if (next) { goTo(next, optBtn); }
	return takeKey(e);
}

/**
 * @description A field in use keeps its own keys, except the way back to moving (Escape, & Enter on a dropdown) & the arrows out of
 * a text box. arrowKey() keeps W, A, S & D as letters here, so an arrow is a real arrow key
 * @param  {[object]} e [the keydown]
 * @param  {[string]} key [arrowKey(e)]
 * @param  {[object]} focused [the field]
 * @param  {[object]} box [the box it's in]
 * @param  {[object]} optBtn [the menu button]
 * @return {[boolean]} taken
 */
function usingFieldKeys(e, key, focused, box, optBtn) {
	if (key == "Escape" || (key == "Enter" && focused.tagName == "SELECT")) {
		focused.dataset.moving = "";
		return takeKey(e);
	}
	if (!ARROWS.includes(key) || !box || !typedIn(focused)) { return false; }
	// Left & Right move the cursor until it's at that end
	if ((key == "ArrowLeft" || key == "ArrowRight") && !canLeave(focused, key)) { return false; }
	const next = stepIn(rowsOf(pageElements(box), rectOf), focused, key);
	if (next && next != focused) { goTo(next, optBtn); } // Alone in its row it stays, still in use
	return takeKey(e);
}

/**
 * @description A moving field: Enter starts using it (without submitting), the arrows move past it, Escape goes back to the box.
 * It takes every other key (typing, Home & End on a dropdown), only Tab still leaves
 * @param  {[object]} e [the keydown]
 * @param  {[string]} key [arrowKey(e)]
 * @param  {[object]} focused [the field]
 * @param  {[object]} box [the box it's in]
 * @param  {[object]} optBtn [the menu button]
 * @return {[boolean]} taken
 */
function movingFieldKeys(e, key, focused, box, optBtn) {
	if (key == "Enter") {
		delete focused.dataset.moving;
		return takeKey(e);
	}
	if (ARROWS.includes(key)) {
		const next = box && stepIn(rowsOf(pageElements(box), rectOf), focused, key);
		if (next) { goTo(next, optBtn); }
		return takeKey(e);
	}
	if (key == "Escape") {
		if (box) { goTo(box, optBtn); }
		return takeKey(e);
	}
	return key == "Tab" ? false : takeKey(e);
}

/**
 * @description Is this a field (text box, moving text box or dropdown) rather than a button or link?
 * @param  {[object]} element
 * @return {[boolean]} field
 */
function isField(element) {
	return typedIn(element) || isMoving(element) || element.tagName == "SELECT";
}

/**
 * @description The boxes on screen: hidden ones (a box with nothing to show, hidden while the page runs) are skipped
 * @return {[array]} stops [the .hero & .box elements]
 */
function topStops() {
	return [...document.querySelectorAll(TOP_STOPS)].filter((stop) => stop.getClientRects().length > 0 && !stop.closest("[hidden]"));
}

/**
 * @description The rows of the top level, read from the screen as it is now: the boxes in rows, the menu button last in the row beside it
 * @param  {[array]} stops [topStops()]
 * @param  {[object]} optBtn [the menu button]
 * @return {[array]} rows
 */
function topRows(stops, optBtn) {
	const rows = rowsOf(stops, rectOf);
	const menu = menuRow(rows, rectOf, rectOf(optBtn), window.innerHeight);
	if (menu == -1) { return [[optBtn]]; } // No boxes on screen
	rows[menu].push(optBtn);
	return rows;
}

/**
 * @description Moves among rows: Up & Down to the same share of the next row, Left & Right around the row
 * @param  {[array]} rows [rowsOf()]
 * @param  {[object]} current [what has focus]
 * @param  {[string]} key [an arrow]
 * @return {[object]} element [undefined when current is in no row]
 */
function stepIn(rows, current, key) {
	if (key == "ArrowUp" || key == "ArrowDown") { return rowStep(rows, current, key); }
	const row = rows.find((candidate) => candidate.includes(current));
	return row && sideStep(row, current, key);
}

/**
 * @description Focuses an element & scrolls it into view: a field starts moving, the hero scrolls to the top, a box taller than
 * the screen to its top, else the least that shows it. The menu button is left where it is
 * @param  {[object]} element
 * @param  {[object]} optBtn [the menu button]
 */
function goTo(element, optBtn) {
	if (isField(element)) { element.dataset.moving = ""; }
	element.focus({ preventScroll: true }); // The scroll below is the page's own
	if (element == optBtn) { return; }
	const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
	if (element.classList.contains("hero")) { return window.scrollTo({ top: 0, behavior }); }
	const rect = rectOf(element);
	element.scrollIntoView({ block: rect.bottom - rect.top > window.innerHeight ? "start" : "nearest", behavior });
}

/**
 * @description Where an element is on screen
 * @param  {[object]} element
 * @return {[object]} rect [getBoundingClientRect()]
 */
function rectOf(element) {
	return element.getBoundingClientRect();
}

/* ---------------------------------------------------------------- */
// Rows
/* ---------------------------------------------------------------- */
/**
 * @description The elements grouped into the rows they are drawn in, each row left to right
 * @param  {[array]} elements [anything the rectangle of can be read]
 * @param  {[function]} rectOf [element => {top, bottom, left, right}]
 * @return {[array]} rows [arrays of elements, top to bottom]
 */
export function rowsOf(elements, rectOf) {
	const sorted = [...elements].sort(
		(first, second) => rectOf(first).top - rectOf(second).top || rectOf(first).left - rectOf(second).left
	);
	const rows = [];
	let rowTop = 0;
	let rowBottom = 0;
	for (const element of sorted) {
		const rect = rectOf(element);
		const centre = (rect.top + rect.bottom) / 2;
		if (rows.length && centre >= rowTop && centre <= rowBottom) { // The centre is in the row's band, so it sits beside the others
			rows[rows.length - 1].push(element);
			rowTop = Math.min(rowTop, rect.top);
			rowBottom = Math.max(rowBottom, rect.bottom);
		} else {
			rows.push([element]);
			rowTop = rect.top;
			rowBottom = rect.bottom;
		}
	}
	return rows.map((row) => row.sort((first, second) => rectOf(first).left - rectOf(second).left));
}

/**
 * @description The element Up or Down moves to: the same share of the next row (floor(i * m / n)), looping at the ends
 * @param  {[array]} rows [rowsOf()]
 * @param  {[object]} current [the element it moves from]
 * @param  {[string]} key [ArrowUp or ArrowDown]
 * @return {[object]} element [undefined when current is in no row]
 */
export function rowStep(rows, current, key) {
	const rowIndex = rows.findIndex((row) => row.includes(current));
	if (rowIndex == -1) { return undefined; }
	const row = rows[rowIndex];
	const next = rows[(rowIndex + (key == "ArrowDown" ? 1 : -1) + rows.length) % rows.length]; // Loops
	return next[Math.floor(row.indexOf(current) * next.length / row.length)];
}

/**
 * @description The element Left or Right moves to inside its row, looping at the ends
 * @param  {[array]} row [one row of rowsOf()]
 * @param  {[object]} current [the element it moves from]
 * @param  {[string]} key [ArrowLeft or ArrowRight]
 * @return {[object]} element
 */
export function sideStep(row, current, key) {
	return row[(row.indexOf(current) + (key == "ArrowRight" ? 1 : -1) + row.length) % row.length]; // Loops
}

/**
 * @description The row the menu button joins: the one beside it, the in-view row whose on-screen part is closest to the button's
 * middle, up or down
 * @param  {[array]} rows [rowsOf()]
 * @param  {[function]} rectOf [element => {top, bottom, left, right}]
 * @param  {[object]} button [the menu button's {top, bottom}]
 * @param  {[number]} viewHeight [the window's height]
 * @return {[number]} index [of the row, the first one on a tie, -1 with no rows]
 */
export function menuRow(rows, rectOf, button, viewHeight) {
	const middle = (button.top + button.bottom) / 2;
	const gaps = rows.map((row) => rowGap(row, rectOf, middle, viewHeight));
	return gaps.indexOf(Math.min(...gaps)); // indexOf gives the first
}

/**
 * @description How far a row's on-screen part is from the menu button's middle, 0 when the middle is inside it
 * @param  {[array]} row [one row of rowsOf()]
 * @param  {[function]} rectOf [element => {top, bottom, left, right}]
 * @param  {[number]} middle [the menu button's middle]
 * @param  {[number]} viewHeight [the window's height]
 * @return {[number]} gap [Infinity when the row is out of view, so it's picked only if every row is]
 */
function rowGap(row, rectOf, middle, viewHeight) {
	const rects = row.map(rectOf);
	const top = Math.max(0, Math.min(...rects.map((rect) => rect.top))); // Only the part on screen
	const bottom = Math.min(viewHeight, Math.max(...rects.map((rect) => rect.bottom)));
	if (bottom <= top) { return Infinity; }
	return Math.max(0, top - middle, middle - bottom);
}
