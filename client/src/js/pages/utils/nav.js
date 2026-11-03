/*
 *  nav.js  --  chess frontend
 *	Menu Button
 *	Every page's menu opens & closes here. The menu button, a click away & Escape close it, the button says if it's open (aria-expanded)
 *	& its 3 lines turn into an X while it's open (nav.css). The game passes hooks for its own logic (gameplay/menu/index.js).
 *	A link on this page (#games) closes it, a link that leaves the page fills up first (menuItem.js)
 *
 */

import { disarmConfirm } from "./confirm.js"; // THE QUESTION GOES AWAY WHEN THE MENU CLOSES
import { fillThenGo, isBusy } from "./menuItem.js"; // THE FILL ON LINKS THAT LEAVE THE PAGE

/**
 * @description The menu's controller, without its listeners. The game uses this so a finished game can open the menu while it loads & a TV remote can open it without the mouse
 * @param  {[object]} hooks [optional: onOpen() before it opens, onClose() when it closes, canClose() false keeps it open]
 * @return {[object]} nav [toggleNav(true) opens, toggleNav(false) closes, toggleNav(false, true) closes even if canClose() says no. addListeners() turns on the button, a click away & Escape]
 */
export function createNav({ onOpen, onClose, canClose } = {}) {
	const optBtn = document.getElementById("optBtn"); // MENU BUTTON (3 LINES)
	const menu = document.getElementById("menuContainer");

	function toggleNav(open, force) { // TRUE OPENS THE MENU, FALSE CLOSES IT
		if (open) { onOpen?.(); }
		else {
			if (!force && canClose && !canClose()) { return; }
			onClose?.();
			disarmConfirm();
		}
		menu.style.display = open ? "flex" : "none";
		optBtn.setAttribute("aria-expanded", open);
	}

	function addListeners() {
		optBtn.addEventListener("click", function (e) {
			e.preventDefault();
			e.stopPropagation();
			toggleNav(menu.style.display != "flex");
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
		document.addEventListener("keydown", function (e) { if (e.key == "Escape") { toggleNav(false); } });
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
