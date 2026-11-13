/*
 *  boxNav.js  --  chess frontend
 *	Box Navigation
 *	The keyboard navigation between the boxes of Home, Login, Signup & Settings.
 *	The row helpers: the page's elements grouped into rows by where they are on screen, & the steps between them.
 *	boxKeys() is the page's keys, passed to the menu (nav.js): arrows move between the boxes (the hero & .box elements) & the menu button, Enter goes into a box, Escape comes back out.
 *	A text box or dropdown has two states: moving (data-moving: the arrows move past it, typing is blocked) & using (typing, its own arrows). Going to one starts it moving, Enter or Escape in a dropdown & Enter in a text box switch it.
 *	A text box in using still leaves with the arrow keys (not W, A, S & D, which type): Up & Down always, Left & Right with the cursor at that end.
 *
 */

import { createNav, isMoving, typedIn, pageElements, canLeave } from "./nav.js";

const ARROWS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
const TOP_STOPS = ".hero, .box"; // THE BOXES THE ARROWS MOVE BETWEEN

/**
 * @description The elements grouped into the rows they are drawn in, each row left to right
 * @param  {[array]} elements [anything the rectangle of can be read]
 * @param  {[function]} rectOf [element => {top, bottom, left, right}]
 * @return {[array]} rows [arrays of elements, top to bottom]
 */
export function rowsOf(elements, rectOf) {
	const sorted = [...elements].sort((a, b) => rectOf(a).top - rectOf(b).top || rectOf(a).left - rectOf(b).left);
	const rows = [];
	let rowTop = 0;
	let rowBottom = 0;
	for (const element of sorted) {
		const rect = rectOf(element);
		const centre = (rect.top + rect.bottom) / 2;
		if (rows.length && centre >= rowTop && centre <= rowBottom) { // THE CENTRE IS IN THE ROW'S BAND, SO IT SITS BESIDE THE OTHERS
			rows[rows.length - 1].push(element);
			rowTop = Math.min(rowTop, rect.top);
			rowBottom = Math.max(rowBottom, rect.bottom);
		} else {
			rows.push([element]);
			rowTop = rect.top;
			rowBottom = rect.bottom;
		}
	}
	return rows.map((row) => row.sort((a, b) => rectOf(a).left - rectOf(b).left));
}

/**
 * @description The element Up or Down moves to: the same share of the next row (floor(i * m / n)), looping at the ends
 * @param  {[array]} rows [rowsOf()]
 * @param  {[object]} current [the element it moves from]
 * @param  {[string]} key [ArrowUp or ArrowDown]
 * @return {[object]} element [undefined when current is in no row]
 */
export function rowStep(rows, current, key) {
	const r = rows.findIndex((row) => row.includes(current));
	if (r == -1) { return undefined; }
	const next = rows[(r + (key == "ArrowDown" ? 1 : -1) + rows.length) % rows.length]; // LOOPS
	return next[Math.floor(rows[r].indexOf(current) * next.length / rows[r].length)];
}

/**
 * @description The element Left or Right moves to inside its row, looping at the ends
 * @param  {[array]} row [one row of rowsOf()]
 * @param  {[object]} current [the element it moves from]
 * @param  {[string]} key [ArrowLeft or ArrowRight]
 * @return {[object]} element
 */
export function sideStep(row, current, key) {
	return row[(row.indexOf(current) + (key == "ArrowRight" ? 1 : -1) + row.length) % row.length]; // LOOPS
}

/**
 * @description The row the menu button joins: the one beside it, the in-view row whose on-screen part is closest to the button's middle, up or down
 * @param  {[array]} rows [rowsOf()]
 * @param  {[function]} rectOf [element => {top, bottom, left, right}]
 * @param  {[object]} button [the menu button's {top, bottom}]
 * @param  {[number]} viewHeight [the window's height]
 * @return {[number]} index [of the row, the first one on a tie, -1 with no rows]
 */
export function menuRow(rows, rectOf, button, viewHeight) {
	const middle = (button.top + button.bottom) / 2;
	const gaps = rows.map((row) => {
		const rects = row.map(rectOf);
		const top = Math.max(0, Math.min(...rects.map((rect) => rect.top))); // ONLY THE PART ON SCREEN
		const bottom = Math.min(viewHeight, Math.max(...rects.map((rect) => rect.bottom)));
		if (bottom <= top) { return Infinity; } // OUT OF VIEW, PICKED ONLY IF EVERY ROW IS
		return Math.max(0, top - middle, middle - bottom);
	});
	return gaps.indexOf(Math.min(...gaps)); // indexOf GIVES THE FIRST
}

/* ---------------------------------------------------------------- */
// Box Keys
/* ---------------------------------------------------------------- */

/**
 * @description Where an element is on screen
 * @param  {[object]} element
 * @return {[object]} rect [getBoundingClientRect()]
 */
function rectOf(element) {
	return element.getBoundingClientRect();
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
 * @description The boxes on screen: hidden ones (a box with nothing to show, runtime hidden) are skipped
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
	if (menu == -1) { return [[optBtn]]; } // NO BOXES ON SCREEN
	rows[menu].push(optBtn);
	return rows;
}

/**
 * @description Focuses an element & scrolls it into view: a field starts moving, the hero scrolls to the top, a box taller than the screen to its top, else the least that shows it.
 * The menu button is left where it is
 * @param  {[object]} element
 * @param  {[object]} optBtn [the menu button]
 */
function goTo(element, optBtn) {
	if (isField(element)) { element.dataset.moving = ""; }
	element.focus({ preventScroll: true }); // THE SCROLL BELOW IS THE PAGE'S OWN
	if (element == optBtn) { return; }
	const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
	if (element.classList.contains("hero")) { return window.scrollTo({ top: 0, behavior }); }
	const rect = rectOf(element);
	element.scrollIntoView({ block: rect.bottom - rect.top > window.innerHeight ? "start" : "nearest", behavior });
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
	const row = rows.find((r) => r.includes(current));
	return row && sideStep(row, current, key);
}

/**
 * @description Would the browser edit or change a moving field with this key & a modifier? Enter (submits), Backspace & Delete with any modifier, a printable key with Alt, Ctrl or Cmd with V or X (paste & cut),
 * & any key with Shift but Tab (Shift+Home on a dropdown). Option+letter types on macOS. Other Ctrl, Cmd & Alt shortcuts (reload, copy, select all) & Shift+Tab are the browser's
 * @param  {[object]} e [the keydown]
 * @return {[boolean]} blocked
 */
function editsMoving(e) {
	const modified = e.altKey || e.ctrlKey || e.metaKey || e.shiftKey;
	if (e.key == "Enter" || e.key == "Backspace" || e.key == "Delete") { return modified; } // Enter WITHOUT A MODIFIER SWITCHES TO USING, boxKeys DOES THAT
	if (e.ctrlKey || e.metaKey) { return e.key.length == 1 && "vx".includes(e.key.toLowerCase()); }
	if (e.altKey) { return e.key.length == 1; }
	return e.shiftKey && e.key != "Tab";
}

/**
 * @description The page's keys while the menu is closed (nav.js calls it before its own). Any modifier leaves the key alone (the browser's shortcuts), except on a moving field (editsMoving())
 * where the keys that would edit or submit it are blocked. Otherwise: nothing focused, an arrow or Enter goes to the menu button; on the menu button or a box the arrows move among the boxes,
 * Enter goes in & Escape drops the focus; in a box the arrows move among its items & Escape goes back to the box; a field is moving (the keys move past it) or using (it types)
 * @param  {[object]} e [the keydown, it's prevented here when the key is taken]
 * @param  {[string]} key [arrowKey(e): W, A, S & D come as arrows]
 * @param  {[object]} optBtn [the menu button]
 * @return {[boolean]} taken [true: used the key & prevented it, false: left it alone]
 */
export function boxKeys(e, key, optBtn) {
	const focused = document.activeElement;
	const taken = function () { e.preventDefault(); return true; };
	const arrow = ARROWS.includes(key);
	if (isMoving(focused) && editsMoving(e)) { return taken(); }
	if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) { return false; }

	if (!focused || focused == document.body) { // NOTHING HAS THE FOCUS
		if (!arrow && key != "Enter") { return false; }
		optBtn.focus();
		return taken();
	}

	const stops = topStops();
	if (focused == optBtn || stops.includes(focused)) { // THE TOP LEVEL
		if (key == "Escape") { focused.blur(); return taken(); }
		if (arrow) {
			const next = stepIn(topRows(stops, optBtn), focused, key);
			if (next) { goTo(next, optBtn); }
			return taken();
		}
		if (key != "Enter" || focused == optBtn) { return false; } // THE BUTTON OPENS THE MENU
		if (!focused.classList.contains("hero")) {
			const first = rowsOf(pageElements(focused), rectOf)[0]?.[0];
			if (first) { goTo(first, optBtn); }
		}
		return taken();
	}

	const box = stops.find((stop) => stop.contains(focused)); // contains, NOT pageElements: A BUTTON DISABLED MID-REQUEST IS NO LONGER TABBABLE
	if (!isField(focused)) { // A BUTTON OR LINK IN A BOX: THE NATIVE PRESS IS LEFT TO IT
		if (!box || (!arrow && key != "Escape")) { return false; }
		if (key == "Escape") { goTo(box, optBtn); return taken(); }
		const next = stepIn(rowsOf(pageElements(box), rectOf), focused, key);
		if (next) { goTo(next, optBtn); }
		return taken();
	}

	if (!isMoving(focused)) { // USING: ITS OWN KEYS, EXCEPT THE WAY BACK TO MOVING & THE ARROWS OUT OF A TEXT BOX
		if (key == "Escape" || (key == "Enter" && focused.tagName == "SELECT")) { focused.dataset.moving = ""; return taken(); }
		if (!arrow || !box || !typedIn(focused)) { return false; } // arrowKey() KEEPS W, A, S & D AS LETTERS HERE, SO arrow IS A REAL ARROW KEY
		if ((key == "ArrowLeft" || key == "ArrowRight") && !canLeave(focused, key)) { return false; } // LEFT & RIGHT MOVE THE CURSOR UNTIL IT'S AT THAT END
		const next = stepIn(rowsOf(pageElements(box), rectOf), focused, key);
		if (next && next != focused) { goTo(next, optBtn); } // ALONE IN ITS ROW IT STAYS, STILL USING
		return taken();
	}
	if (key == "Enter") { delete focused.dataset.moving; return taken(); } // USING, WITHOUT SUBMITTING
	if (arrow) {
		const next = box && stepIn(rowsOf(pageElements(box), rectOf), focused, key);
		if (next) { goTo(next, optBtn); }
		return taken();
	}
	if (key == "Escape") { if (box) { goTo(box, optBtn); } return taken(); }
	return key == "Tab" ? false : taken(); // A MOVING FIELD TAKES NO OTHER KEY (TYPING, Home & End ON A DROPDOWN), TAB STILL LEAVES
}

/* ---------------------------------------------------------------- */
// Start Box Nav
/* ---------------------------------------------------------------- */

/* ---------------------------------------------------------------- */
// Watch Moving
/* ---------------------------------------------------------------- */

/**
 * @description What ends or stops a field's moving state besides the keys: leaving it (focusout, but not the window losing focus), a click on it or its label (it types, the same as Tab), & text getting in
 * some other way (AltGr, dead keys, IME, the context menu's paste, a drop)
 */
export function watchMoving() {
	document.addEventListener("focusout", function (e) { if (document.activeElement != e.target) { delete e.target.dataset?.moving; } }); // A WINDOW LOSING FOCUS KEEPS ITS FIELD, SO THE STATE STAYS TOO
	document.addEventListener("pointerdown", function (e) {
		const field = document.activeElement;
		if (isMoving(field) && (field.contains(e.target) || e.target.closest?.("label")?.control == field)) { delete field.dataset.moving; } // A CLICK ON A FOCUSED FIELD MOVES NO FOCUS
	});
	document.addEventListener("beforeinput", function (e) { if (isMoving(e.target)) { e.preventDefault(); } });
}

/**
 * @description Home, Login, Signup & Settings: the menu (nav.js) with the page's keys. The boxes can take focus (not Tab), & a field stops moving when it loses focus
 * @return {[function]} toggleNav [toggleNav(true) opens the menu, toggleNav(false) closes it]
 */
export function startBoxNav() {
	const optBtn = document.getElementById("optBtn");
	document.querySelectorAll(TOP_STOPS).forEach((stop) => stop.setAttribute("tabindex", "-1")); // FOCUSED BY THE KEYS, NEVER BY TAB
	watchMoving();
	const nav = createNav({ boxKeys: (e, key) => boxKeys(e, key, optBtn) });
	nav.addListeners();
	return nav.toggleNav;
}
