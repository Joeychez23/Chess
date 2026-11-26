/*
 *  nav.js  --  chess frontend
 *	Menu Button
 *	Every page's menu opens & closes here. The menu button, a click away & Escape close it, the button says if it's open
 *	(aria-expanded) & its 3 lines turn into an X while it's open (nav.css). The game passes hooks for its own logic
 *	(gameplay/menu/index.js). A link on this page (#games) closes it, a link that leaves the page fills up first (menuItem.js).
 *	Keyboard: opening with a key moves focus to the first item, closing gives focus back to the button. Site wide, Delete &
 *	Backspace are Escape anywhere a letter isn't typed (deleteAsEscape). While it's open Tab, Up, Down, Left, Right, Home & End
 *	stay in its items. While it's closed Tab goes around the page's elements, never out to the browser, & Left & Right move
 *	between the page's elements (the game picks its own, arrowStops).
 *	W, A, S & D are Up, Left, Down & Right (arrowKey), except where a letter is typed. Enter with nothing focused (Escape
 *	dropped it) goes to the menu button.
 *	Guest, Home, Login, Signup & Settings pass boxKeys (boxNav.js) & so turn off the browser's own keyboard scrolling
 *	(scrollsPage): only moving the focus moves the page
 *
 */

import { disarmConfirm } from "./confirm.js"; // The question goes away when the menu closes
import { fillThenGo, isBusy } from "./menuItem.js"; // The fill on links that leave the page

const MOVE_KEYS = ["ArrowUp", "ArrowDown", "Home", "End"]; // The keys that move between the items
const SIDE_KEYS = ["ArrowLeft", "ArrowRight"]; // The keys that move between the page's elements
const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const NOT_TYPED_IN = ["button", "submit", "reset", "checkbox", "radio", "file", "color", "range"]; // Inputs without a cursor
const KEEP_SIDE_KEYS = ["radio", "range"]; // Inputs that use Left & Right themselves
const LETTER_KEYS = { w: "ArrowUp", a: "ArrowLeft", s: "ArrowDown", d: "ArrowRight" }; // The letters that stand for an arrow
// The keys the browser scrolls the page with
const SCROLL_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " "];
// Space presses or types in these, it only scrolls from anything else
const SPACE_PRESSES = "a[href], button, input, select, textarea, summary, [contenteditable]";
const ESCAPE_KEYS = ["Delete", "Backspace"]; // Escape too, outside a text box (deleteAsEscape). A Mac's delete key is Backspace

let deleteKeyOn = false; // One listener for the page, however many menus start

/* ---------------------------------------------------------------- */
// Start Nav
/* ---------------------------------------------------------------- */
/**
 * @description Pages without the game: the menu with its listeners on
 * @return {[function]} toggleNav [toggleNav(true) opens the menu, toggleNav(false) closes it]
 */
export function startNav() {
	const nav = createNav();
	nav.addListeners();
	return nav.toggleNav;
}

/**
 * @description The menu's controller, without its listeners. The game uses this so a finished game can open the menu while it loads
 * & remote-only mode can open it without the mouse
 * @param  {[object]} hooks [optional: onOpen() before it opens, onClose() when it closes, canClose() false keeps it open,
 * arrowStops() the elements Left & Right move between (every element on the page without it), boxKeys(e, key) true when it used
 * the key (Guest, Home, Login, Signup & Settings: boxNav.js, only while the menu is closed), & with it the browser's keyboard
 * scrolling is off (scrollsPage)]
 * @return {[object]} nav [toggleNav(true) opens, toggleNav(false) closes, toggleNav(false, true) closes even if canClose() says no.
 * addListeners() turns on the button, a click away & Escape]
 */
export function createNav({ onOpen, onClose, canClose, arrowStops = pageElements, boxKeys } = {}) {
	const optBtn = document.getElementById("optBtn"); // Menu button (3 lines)
	const menu = document.getElementById("menuContainer");

	function toggleNav(open, force) { // True opens the menu, false closes it
		if (open) { onOpen?.(); }
		else {
			if (!force && canClose && !canClose()) { return; }
			onClose?.();
			disarmConfirm();
			if (menu.contains(document.activeElement)) { optBtn.focus(); } // Before it's hidden, that would drop focus to the page
		}
		menu.style.display = open ? "flex" : "none";
		optBtn.setAttribute("aria-expanded", open);
	}

	function moveFocus(e, key) {
		if (menu.style.display != "flex" || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) { return; }
		const focused = document.activeElement;
		// The arrows stay with a text box or dropdown on the page
		if (!menu.contains(focused) && focused != optBtn && focused != document.body) { return; }
		e.preventDefault();
		itemForKey(menuItems(), focused, key)?.focus();
	}

	function closeWithDelete(e) {
		if (menu.style.display != "flex" || typedIn(document.activeElement)) { return; } // A text box keeps its Delete
		e.preventDefault();
		toggleNav(false);
	}

	function moveTab(e) {
		if (e.altKey || e.ctrlKey || e.metaKey) { return; }
		const focused = document.activeElement;
		if (menu.style.display == "flex") { // Around the items, nothing behind the menu
			e.preventDefault();
			const items = menuItems();
			const index = items.indexOf(focused);
			if (index == -1) { return (e.shiftKey ? items[items.length - 1] : items[0])?.focus(); }
			return items[(index + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
		}
		const next = wrapTab(pageElements(), focused, e.shiftKey);
		if (next) {
			e.preventDefault();
			next.focus();
		}
	}

	function moveSide(e, key) {
		if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) { return; }
		const focused = document.activeElement;
		if (menu.style.display == "flex") {
			if (typedIn(focused)) { return; }
			e.preventDefault();
			const items = menuItems();
			return sideItem(items, items.map((item) => item.getBoundingClientRect()), focused, key)?.focus();
		}
		if (!canLeave(focused, key)) { return; }
		e.preventDefault();
		nextStop(arrowStops().filter((stop) => stop.getClientRects().length > 0), focused, key)?.focus();
	}

	function addListeners() {
		// Capture on the window: before the game's & the 3D monitor's own keys
		if (!deleteKeyOn && typeof window != "undefined" && window.addEventListener) {
			window.addEventListener("keydown", deleteAsEscape, true);
			deleteKeyOn = true;
		}
		optBtn.addEventListener("click", function (e) {
			e.preventDefault();
			e.stopPropagation();
			const opening = menu.style.display != "flex";
			toggleNav(opening);
			if (opening && e.detail === 0) { menuItems()[0]?.focus(); } // A key pressed it (a mouse or finger's click counts from 1)
		});
		menu.addEventListener("click", function (e) {
			const link = e.target.closest("a");
			if (!link) { return; }
			const newTab = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey; // This page stays
			// A link on this page (#games) closes it too
			if (newTab || link.getAttribute("href").startsWith("#")) { return toggleNav(false); }
			e.preventDefault();
			if (!isBusy(link)) { fillThenGo(link, link.href); } // .loading only stops clicks, a keyboard can still press it
		});
		document.addEventListener("click", function (e) { if (!menu.contains(e.target)) { toggleNav(false); } }); // Click outside
		document.addEventListener("keydown", function (e) {
			const key = arrowKey(e); // W, A, S & D are the arrows
			// The page's boxes take the key, an open menu keeps its own
			if (boxKeys && menu.style.display != "flex" && boxKeys(e, key)) { return; }
			if (e.key == "Escape") { toggleNav(false); }
			else if (e.key == "Delete" || e.key == "Backspace") { closeWithDelete(e); }
			else if (e.key == "Tab") { moveTab(e); }
			else if (MOVE_KEYS.includes(key)) { moveFocus(e, key); }
			else if (SIDE_KEYS.includes(key)) { moveSide(e, key); }
			else if (e.key == "Enter" && menu.style.display != "flex" && document.body && document.activeElement == document.body) {
				// Nothing has the focus (Escape dropped it): the menu button first, the next Enter opens it
				e.preventDefault();
				optBtn.focus();
			}
			if (boxKeys && scrollsPage(e)) { e.preventDefault(); } // After the moves above: only the focus moves the page
		});
	}

	optBtn.setAttribute("aria-expanded", false);
	return { toggleNav, addListeners };
}

/* ---------------------------------------------------------------- */
// Menu Items
/* ---------------------------------------------------------------- */
/**
 * @description The menu's items in the order on screen, read from the page so a new item needs no list of its own. Hidden items
 * (menuItem.js), the ones moved to the 3D room's monitor & turned off buttons are skipped
 * @return {[array]} items [the links & buttons that can take focus]
 */
export function menuItems() {
	const items = document.getElementById("menuContainer").querySelectorAll("a[href], button:not([disabled])");
	// data-on-monitor: shown on the 3D room's monitor instead (gameplay/monitor)
	return [...items].filter((item) => !item.closest("[hidden], [data-on-monitor]"));
}

/**
 * @description The item a key moves to. It stops at the ends, from outside the list Down starts at the top & Up at the bottom
 * @param  {[array]} items [menuItems(), or the part of it remote-only mode can press]
 * @param  {[object]} current [the item it moves from]
 * @param  {[string]} key [ArrowUp, ArrowDown, Home or End]
 * @return {[object]} item [undefined at the ends]
 */
export function itemForKey(items, current, key) {
	const last = items[items.length - 1];
	if (key == "Home") { return items[0]; }
	if (key == "End") { return last; }
	const index = items.indexOf(current);
	if (index == -1) { return key == "ArrowDown" ? items[0] : last; }
	return items[index + (key == "ArrowDown" ? 1 : -1)];
}

/**
 * @description The item Left or Right moves to in the open menu. A short screen shows the menu in columns (nav.css): the closest
 * item in the next column that way, it stops at the edge. In one column there's nothing to the side, so Right goes down the list
 * & Left goes up
 * @param  {[array]} items [menuItems()]
 * @param  {[array]} rects [where each item is on screen, getBoundingClientRect()]
 * @param  {[object]} current [what has focus]
 * @param  {[string]} key [ArrowLeft or ArrowRight]
 * @return {[object]} item [undefined when there's none that way]
 */
export function sideItem(items, rects, current, key) {
	const right = key == "ArrowRight";
	const index = items.indexOf(current);
	if (index == -1) { return right ? items[0] : items[items.length - 1]; }
	const from = rects[index];
	// How far to the side, below 0 is not that way
	const gaps = rects.map((rect) => (right ? rect.left - from.right : from.left - rect.right));
	const columns = rects.some((rect) => rect.left >= from.right || rect.right <= from.left);
	if (!columns) { return items[index + (right ? 1 : -1)]; }
	const nextColumn = Math.min(...gaps.filter((gap) => gap >= 0));
	let best;
	let bestDistance = Infinity;
	gaps.forEach(function (gap, gapIndex) {
		const distance = Math.abs(rects[gapIndex].top - from.top);
		if (gap == nextColumn && distance < bestDistance) {
			best = items[gapIndex];
			bestDistance = distance;
		}
	});
	return best;
}

/* ---------------------------------------------------------------- */
// Page Elements
/* ---------------------------------------------------------------- */
/**
 * @description The elements in the root the Tab key can reach, in the order on screen. A closed menu or anything else not drawn is skipped
 * @param  {[object]} root [optional: where to look, the whole page without it]
 * @return {[array]} elements
 */
export function pageElements(root = document) {
	return [...root.querySelectorAll(TABBABLE)].filter((element) => element.getClientRects().length > 0 && !element.closest("[inert]"));
}

/**
 * @description Where the Tab key goes in a closed menu's page when it would leave for the browser: around to the other end
 * @param  {[array]} elements [pageElements()]
 * @param  {[object]} focused [what has focus]
 * @param  {[boolean]} back [Shift is down]
 * @return {[object]} element [null when the browser's own Tab stays on the page]
 */
export function wrapTab(elements, focused, back) {
	const side = back ? 2 : 4; // Node.DOCUMENT_POSITION_PRECEDING : FOLLOWING
	if (elements.some((element) => focused.compareDocumentPosition(element) & side)) { return null; }
	return (back ? elements[elements.length - 1] : elements[0]) || null;
}

/**
 * @description The element Left or Right moves to, going around at the ends. From outside the list Right starts at the first
 * & Left at the last
 * @param  {[array]} stops [the elements]
 * @param  {[object]} current [what has focus]
 * @param  {[string]} key [ArrowLeft or ArrowRight]
 * @return {[object]} element
 */
export function nextStop(stops, current, key) {
	const step = key == "ArrowRight" ? 1 : -1;
	const index = stops.indexOf(current);
	if (index == -1) { return step == 1 ? stops[0] : stops[stops.length - 1]; }
	return stops[(index + step + stops.length) % stops.length];
}

/**
 * @description A list of stops with one more put directly before another, for a stop with no place of its own on screen
 * (the 3D room's monitor, before the leftmost stop)
 * @param  {[array]} stops [the elements, in order]
 * @param  {[object]} stop [the one to add, nothing is added without it]
 * @param  {[object]} anchor [the one it goes before, nothing is added when it isn't in the list]
 * @return {[array]} stops [a new list]
 */
export function placeBefore(stops, stop, anchor) {
	const index = stops.indexOf(anchor);
	if (!stop || index == -1) { return [...stops]; }
	return [...stops.slice(0, index), stop, ...stops.slice(index)];
}

/**
 * @description Can Left or Right leave this element? A dropdown, radio button or slider uses them itself & a text box only lets go
 * with the cursor at that end
 * @param  {[object]} element [what has focus]
 * @param  {[string]} key [ArrowLeft or ArrowRight]
 * @return {[boolean]} can leave
 */
export function canLeave(element, key) {
	if (element?.tagName == "SELECT" || (element?.tagName == "INPUT" && KEEP_SIDE_KEYS.includes(element.type))) { return false; }
	if (!typedIn(element) || element.isContentEditable) { return !element?.isContentEditable; }
	const { selectionStart: start, selectionEnd: end, value } = element;
	if (start == null) { return !value; } // An email box doesn't say where its cursor is
	return start == end && (key == "ArrowLeft" ? start == 0 : end == value.length);
}

/* ---------------------------------------------------------------- */
// Keys
/* ---------------------------------------------------------------- */
/**
 * @description The key a press stands for: W, A, S & D are Up, Left, Down & Right. They stay letters where one is typed
 * (a text box, a dropdown jumps to an option) & with Alt, Ctrl or Cmd down (the browser's shortcuts)
 * @param  {[object]} e [the keydown]
 * @return {[string]} key [ArrowUp, ArrowLeft, ArrowDown or ArrowRight for the letters, else e.key]
 */
export function arrowKey(e) {
	const arrow = typeof e.key == "string" && e.key.length == 1 ? LETTER_KEYS[e.key.toLowerCase()] : undefined;
	if (!arrow || e.altKey || e.ctrlKey || e.metaKey) { return e.key; }
	const focused = document.activeElement;
	return !isMoving(focused) && (typedIn(focused) || focused?.tagName == "SELECT") ? e.key : arrow;
}

/**
 * @description Is this element in the moving state (boxNav.js: a field the keys move past, not type in)?
 * @param  {[object]} element [what has focus]
 * @return {[boolean]} moving [true: data-moving is set]
 */
export function isMoving(element) {
	return element?.dataset?.moving !== undefined;
}

/**
 * @description Does this element take typing? A field in the moving state doesn't, the keys move past it
 * @param  {[object]} element [what has focus]
 * @return {[boolean]} typed [true: a text box, text area or editable element that is not moving]
 */
export function typedIn(element) {
	if (isMoving(element)) { return false; }
	if (element?.isContentEditable || element?.tagName == "TEXTAREA") { return true; }
	return element?.tagName == "INPUT" && !NOT_TYPED_IN.includes(element.type);
}

/**
 * @description Would the browser scroll the page for this key? Arrows, Page Up & Down, Home, End & Space, except where the focused
 * element uses them itself (a text box's cursor, a dropdown, radio buttons, a slider, Space on a button). Alt, Ctrl & Cmd are the
 * browser's shortcuts & stay
 * @param  {[object]} e [the keydown]
 * @return {[boolean]} scrolls [true: boxKeys pages stop it]
 */
export function scrollsPage(e) {
	if (!SCROLL_KEYS.includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) { return false; }
	const focused = document.activeElement;
	const usesKeys = typedIn(focused) || focused?.tagName == "SELECT"
		|| (focused?.tagName == "INPUT" && KEEP_SIDE_KEYS.includes(focused.type));
	if (usesKeys) { return false; }
	if (e.key == " ") { return !focused?.closest?.(SPACE_PRESSES); } // Space presses a button or link, it only scrolls from the page itself
	return true;
}

/* ---------------------------------------------------------------- */
// Delete As Escape
/* ---------------------------------------------------------------- */
/**
 * @description Delete & Backspace do what Escape does wherever a letter isn't typed: the menu, the boxes, a dropdown, a moving text
 * box, the game & the 3D monitor. The key is swapped for an Escape at the same element, so every Escape listener runs as it is.
 * A text box in use keeps its Delete & a modifier leaves the key alone
 * @param  {[object]} e [the keydown, on the window in the capture phase]
 * @return {[boolean]} swapped
 */
export function deleteAsEscape(e) {
	if (!ESCAPE_KEYS.includes(e.key) || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) { return false; }
	if (typedIn(e.target)) { return false; } // A text box in use keeps its Delete
	e.preventDefault();
	e.stopImmediatePropagation(); // No other listener sees the Delete, only the Escape
	const escape = { key: "Escape", code: "Escape", bubbles: true, cancelable: true, composed: true, repeat: e.repeat };
	e.target.dispatchEvent(new KeyboardEvent("keydown", escape));
	return true;
}
