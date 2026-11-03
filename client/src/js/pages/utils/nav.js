/*
 *  nav.js  --  chess frontend
 *	Menu Button
 *	Every page's menu opens & closes here. The menu button, a click away & Escape close it, the button says if it's open (aria-expanded)
 *	& its 3 lines turn into an X while it's open (nav.css). The game passes hooks for its own logic (gameplay/menu/index.js).
 *	A link on this page (#games) closes it, a link that leaves the page fills up first (menuItem.js).
 *	Keyboard: opening with a key moves focus to the first item, closing gives focus back to the button & Delete or Backspace close it like Escape. While it's open Tab, Up, Down, Left, Right, Home & End stay in its items.
 *	While it's closed Tab goes around the page's elements, never out to the browser, & Left & Right move between the page's elements (the game picks its own, arrowStops)
 *
 */

import { disarmConfirm } from "./confirm.js"; // THE QUESTION GOES AWAY WHEN THE MENU CLOSES
import { fillThenGo, isBusy } from "./menuItem.js"; // THE FILL ON LINKS THAT LEAVE THE PAGE

const MOVE_KEYS = ["ArrowUp", "ArrowDown", "Home", "End"]; // THE KEYS THAT MOVE BETWEEN THE ITEMS
const SIDE_KEYS = ["ArrowLeft", "ArrowRight"]; // THE KEYS THAT MOVE BETWEEN THE PAGE'S ELEMENTS
const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const NOT_TYPED_IN = ["button", "submit", "reset", "checkbox", "radio", "file", "color", "range"]; // INPUTS WITHOUT A CURSOR
const KEEP_SIDE_KEYS = ["radio", "range"]; // INPUTS THAT USE LEFT & RIGHT THEMSELVES

/**
 * @description The menu's items in the order on screen, read from the page so a new item needs no list of its own. Hidden items (menuItem.js) & turned off buttons are skipped
 * @return {[array]} items [the links & buttons that can take focus]
 */
export function menuItems() {
	const items = document.getElementById("menuContainer").querySelectorAll("a[href], button:not([disabled])");
	return [...items].filter((item) => !item.closest("[hidden]"));
}

/**
 * @description The item a key moves to. It stops at the ends, from outside the list Down starts at the top & Up at the bottom
 * @param  {[array]} items [menuItems(), or the part of it a TV remote can press]
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
 * @description The elements on the page the Tab key can reach, in the order on screen. A closed menu or anything else not drawn is skipped
 * @return {[array]} elements
 */
export function pageElements() {
	return [...document.querySelectorAll(TABBABLE)].filter((element) => element.getClientRects().length > 0 && !element.closest("[inert]"));
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
 * @description The element Left or Right moves to, going around at the ends. From outside the list Right starts at the first & Left at the last
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
 * @description The item Left or Right moves to in the open menu. A short screen shows the menu in columns (nav.css): the closest item in the next column that way, it stops at the edge.
 * In one column there's nothing to the side, so Right goes down the list & Left goes up
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
	const gaps = rects.map((rect) => (right ? rect.left - from.right : from.left - rect.right)); // HOW FAR TO THE SIDE, BELOW 0 IS NOT THAT WAY
	const columns = rects.some((rect) => rect.left >= from.right || rect.right <= from.left);
	if (!columns) { return items[index + (right ? 1 : -1)]; }
	const nextColumn = Math.min(...gaps.filter((gap) => gap >= 0));
	let best;
	let bestDistance = Infinity;
	gaps.forEach(function (gap, i) {
		const distance = Math.abs(rects[i].top - from.top);
		if (gap == nextColumn && distance < bestDistance) { best = items[i]; bestDistance = distance; }
	});
	return best;
}

function typedIn(element) {
	if (element?.isContentEditable || element?.tagName == "TEXTAREA") { return true; }
	return element?.tagName == "INPUT" && !NOT_TYPED_IN.includes(element.type);
}

/**
 * @description Can Left or Right leave this element? A dropdown, radio button or slider uses them itself & a text box only lets go with the cursor at that end
 * @param  {[object]} element [what has focus]
 * @param  {[string]} key [ArrowLeft or ArrowRight]
 * @return {[boolean]} can leave
 */
export function canLeave(element, key) {
	if (element?.tagName == "SELECT" || (element?.tagName == "INPUT" && KEEP_SIDE_KEYS.includes(element.type))) { return false; }
	if (!typedIn(element) || element.isContentEditable) { return !element?.isContentEditable; }
	const { selectionStart: start, selectionEnd: end, value } = element;
	if (start == null) { return !value; } // AN EMAIL BOX DOESN'T SAY WHERE ITS CURSOR IS
	return start == end && (key == "ArrowLeft" ? start == 0 : end == value.length);
}

/**
 * @description The menu's controller, without its listeners. The game uses this so a finished game can open the menu while it loads & a TV remote can open it without the mouse
 * @param  {[object]} hooks [optional: onOpen() before it opens, onClose() when it closes, canClose() false keeps it open, arrowStops() the elements Left & Right move between (every element on the page without it)]
 * @return {[object]} nav [toggleNav(true) opens, toggleNav(false) closes, toggleNav(false, true) closes even if canClose() says no. addListeners() turns on the button, a click away & Escape]
 */
export function createNav({ onOpen, onClose, canClose, arrowStops = pageElements } = {}) {
	const optBtn = document.getElementById("optBtn"); // MENU BUTTON (3 LINES)
	const menu = document.getElementById("menuContainer");

	function toggleNav(open, force) { // TRUE OPENS THE MENU, FALSE CLOSES IT
		if (open) { onOpen?.(); }
		else {
			if (!force && canClose && !canClose()) { return; }
			onClose?.();
			disarmConfirm();
			if (menu.contains(document.activeElement)) { optBtn.focus(); } // BEFORE IT'S HIDDEN, THAT WOULD DROP FOCUS TO THE PAGE
		}
		menu.style.display = open ? "flex" : "none";
		optBtn.setAttribute("aria-expanded", open);
	}

	function moveFocus(e) {
		if (menu.style.display != "flex" || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) { return; }
		const focused = document.activeElement;
		if (!menu.contains(focused) && focused != optBtn && focused != document.body) { return; } // THE ARROWS STAY WITH A TEXT BOX OR DROPDOWN ON THE PAGE
		e.preventDefault();
		itemForKey(menuItems(), focused, e.key)?.focus();
	}

	function closeWithDelete(e) {
		if (menu.style.display != "flex" || typedIn(document.activeElement)) { return; } // A TEXT BOX KEEPS ITS DELETE
		e.preventDefault();
		toggleNav(false);
	}

	function moveTab(e) {
		if (e.altKey || e.ctrlKey || e.metaKey) { return; }
		const focused = document.activeElement;
		if (menu.style.display == "flex") { // AROUND THE ITEMS, NOTHING BEHIND THE MENU
			e.preventDefault();
			const items = menuItems();
			const index = items.indexOf(focused);
			if (index == -1) { return (e.shiftKey ? items[items.length - 1] : items[0])?.focus(); }
			return items[(index + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
		}
		const next = wrapTab(pageElements(), focused, e.shiftKey);
		if (next) { e.preventDefault(); next.focus(); }
	}

	function moveSide(e) {
		if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) { return; }
		const focused = document.activeElement;
		if (menu.style.display == "flex") {
			if (typedIn(focused)) { return; }
			e.preventDefault();
			const items = menuItems();
			return sideItem(items, items.map((item) => item.getBoundingClientRect()), focused, e.key)?.focus();
		}
		if (!canLeave(focused, e.key)) { return; }
		e.preventDefault();
		nextStop(arrowStops().filter((stop) => stop.getClientRects().length > 0), focused, e.key)?.focus();
	}

	function addListeners() {
		optBtn.addEventListener("click", function (e) {
			e.preventDefault();
			e.stopPropagation();
			const opening = menu.style.display != "flex";
			toggleNav(opening);
			if (opening && e.detail === 0) { menuItems()[0]?.focus(); } // A KEY PRESSED IT (A MOUSE OR FINGER'S CLICK COUNTS FROM 1)
		});
		menu.addEventListener("click", function (e) {
			const link = e.target.closest("a");
			if (!link) { return; }
			const newTab = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey; // THIS PAGE STAYS
			if (newTab || link.getAttribute("href").startsWith("#")) { return toggleNav(false); } // A LINK ON THIS PAGE (#games) CLOSES IT TOO
			e.preventDefault();
			if (!isBusy(link)) { fillThenGo(link, link.href); } // .loading ONLY STOPS CLICKS, A KEYBOARD CAN STILL PRESS IT
		});
		document.addEventListener("click", function (e) { if (!menu.contains(e.target)) { toggleNav(false); } }); // CLICK OUTSIDE
		document.addEventListener("keydown", function (e) {
			if (e.key == "Escape") { toggleNav(false); }
			else if (e.key == "Delete" || e.key == "Backspace") { closeWithDelete(e); }
			else if (e.key == "Tab") { moveTab(e); }
			else if (MOVE_KEYS.includes(e.key)) { moveFocus(e); }
			else if (SIDE_KEYS.includes(e.key)) { moveSide(e); }
		});
	}

	optBtn.setAttribute("aria-expanded", false);
	return { toggleNav, addListeners };
}

/**
 * @description Pages without the game: the menu with its listeners on
 * @return {[function]} toggleNav [toggleNav(true) opens the menu, toggleNav(false) closes it]
 */
export function startNav() {
	const nav = createNav();
	nav.addListeners();
	return nav.toggleNav;
}
