/*
 *  dropdown.js  --  chess frontend
 *	Dropdowns
 *	The page's <select>s drawn as a button & a list of its options, so Enter opens it (Safari can't open a native <select> from a script).
 *	The <select> stays, hidden, as the value: the page reads & sets select.value & adds <option>s as before, the button follows it.
 *	Open: Up, Down, W & S move (looping at the ends), Home & End go to the ends, Enter or Space picks, Escape, Backspace or Delete closes, Tab or a click outside closes & moves on.
 *
 */

const MOVES = ["ArrowUp", "ArrowDown", "w", "s", "W", "S", "Home", "End"];
const PICKS = ["Enter", " "];
const CLOSES = ["Escape", "Backspace", "Delete"]; // AS THE MENU (nav.js) CLOSES ON BACKSPACE & DELETE

/* ---------------------------------------------------------------- */
// Step Option
/* ---------------------------------------------------------------- */
/**
 * @description The option a key moves to in an open list, looping at the ends like the box navigation
 * @param  {[number]} count [the number of options]
 * @param  {[number]} index [the active option]
 * @param  {[string]} key [ArrowUp, ArrowDown, w, s, Home or End]
 * @return {[number]} index
 */
export function stepOption(count, index, key) {
	if (key == "Home") { return 0; }
	if (key == "End") { return count - 1; }
	const up = key == "ArrowUp" || key.toLowerCase() == "w";
	return (index + (up ? -1 : 1) + count) % count; // DOWN FROM THE LAST GOES TO THE FIRST, UP FROM THE FIRST TO THE LAST
}

/* ---------------------------------------------------------------- */
// List Action
/* ---------------------------------------------------------------- */
/**
 * @description What a key does in an open list
 * @param  {[string]} key [the keydown's key]
 * @return {[string]} action ["move", "pick", "close" or null (Tab & anything else)]
 */
export function listAction(key) {
	if (MOVES.includes(key)) { return "move"; }
	if (PICKS.includes(key)) { return "pick"; }
	if (CLOSES.includes(key)) { return "close"; }
	return null;
}

/* ---------------------------------------------------------------- */
// Start Dropdowns
/* ---------------------------------------------------------------- */
/**
 * @description Draws every <select> in root as a dropdown (a button that opens a list) & hides the <select>
 * @param  {[object]} root [where to look, the document by default]
 */
export function startDropdowns(root = document) {
	root.querySelectorAll("select").forEach(makeDropdown);
}

/* ---------------------------------------------------------------- */
// Make Dropdown
/* ---------------------------------------------------------------- */
/**
 * @description One <select>'s dropdown: the button, its list, & the keys, clicks & changes that keep them with the <select>
 * @param  {[object]} select
 */
function makeDropdown(select) {
	if (select.dataset.dropdown !== undefined) { return; } // ALREADY DRAWN
	select.dataset.dropdown = "";
	const name = select.getAttribute("aria-label") || "";
	const wrap = document.createElement("div");
	wrap.className = "dropdown";
	const button = document.createElement("button");
	button.type = "button";
	button.className = "dropdownBtn";
	button.setAttribute("aria-haspopup", "listbox");
	button.setAttribute("aria-expanded", "false");
	const text = document.createElement("span");
	text.className = "dropdownText";
	const caret = document.createElement("span");
	caret.className = "dropdownCaret";
	caret.setAttribute("aria-hidden", "true");
	button.append(text, caret);
	const list = document.createElement("ul");
	list.className = "dropdownList";
	list.id = `${select.id}List`;
	list.setAttribute("role", "listbox");
	list.setAttribute("aria-label", name);
	list.tabIndex = -1;
	list.hidden = true;
	button.setAttribute("aria-controls", list.id);
	wrap.append(button, list);
	select.after(wrap);
	select.hidden = true;

	let active = 0;
	let keyClosed = false; // SPACE PICKED: ITS KEYUP ON THE BUTTON WOULD CLICK IT OPEN AGAIN

	const refresh = function () {
		const option = select.options[select.selectedIndex];
		text.textContent = option ? option.textContent : "";
		button.setAttribute("aria-label", option ? `${name}: ${option.textContent}` : name);
		button.disabled = select.disabled;
	};

	const native = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
	Object.defineProperty(select, "value", { // THE PAGE SETS select.value FROM THE SAVED SETTINGS, NO change EVENT TELLS THE BUTTON
		configurable: true,
		get() { return native.get.call(this); },
		set(value) { native.set.call(this, value); refresh(); }
	});
	new MutationObserver(refresh).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] }); // loadLevels() ADDS THE LEVELS LATER

	const show = function (index) {
		active = index;
		const items = list.children;
		for (let i = 0; i < items.length; i++) { items[i].setAttribute("aria-selected", `${i == active}`); }
		const item = items[active];
		if (!item) { return; }
		list.setAttribute("aria-activedescendant", item.id);
		if (item.offsetTop < list.scrollTop) { list.scrollTop = item.offsetTop; } // KEEPS IT IN THE LIST'S VIEW WITHOUT SCROLLING THE PAGE
		else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) { list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight; }
	};

	const close = function (focusButton) {
		if (list.hidden) { return; }
		list.hidden = true;
		list.replaceChildren();
		list.removeAttribute("aria-activedescendant");
		button.setAttribute("aria-expanded", "false");
		if (focusButton) { button.focus({ preventScroll: true }); }
	};

	const pick = function (index) {
		const option = select.options[index];
		close(true);
		if (!option || option.value == select.value) { return; }
		select.value = option.value;
		select.dispatchEvent(new Event("input", { bubbles: true }));
		select.dispatchEvent(new Event("change", { bubbles: true }));
	};

	const open = function () {
		const options = [...select.options];
		list.replaceChildren(...options.map(function (option, i) {
			const item = document.createElement("li");
			item.id = `${select.id}Option${i}`;
			item.setAttribute("role", "option");
			item.textContent = option.textContent;
			item.addEventListener("click", function () { pick(i); });
			return item;
		}));
		list.hidden = false;
		button.setAttribute("aria-expanded", "true");
		list.focus({ preventScroll: true });
		show(Math.max(0, select.selectedIndex));
		const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		list.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" }); // AN OPEN LIST BELOW THE FOLD COMES INTO VIEW
	};

	button.addEventListener("click", function () {
		if (keyClosed) { return; }
		if (list.hidden) { open(); } else { close(true); }
	});
	list.addEventListener("keydown", function (e) {
		if (e.key == "Tab" || e.altKey || e.ctrlKey || e.metaKey) { return; } // TAB MOVES ON (focusout CLOSES), SHORTCUTS ARE THE BROWSER'S
		e.preventDefault();
		e.stopPropagation(); // THE MENU & BOX KEYS (nav.js, ON THE DOCUMENT) NEVER SEE AN OPEN LIST'S KEYS
		const action = listAction(e.key);
		if (action == "move") { show(stepOption(list.children.length, active, e.key)); }
		else if (action == "close") { close(true); }
		else if (action == "pick") {
			keyClosed = true;
			document.addEventListener("keyup", function () { setTimeout(function () { keyClosed = false; }); }, { once: true });
			pick(active);
		}
	});
	list.addEventListener("focusout", function (e) { if (!wrap.contains(e.relatedTarget)) { close(false); } });
	document.addEventListener("pointerdown", function (e) { if (!wrap.contains(e.target)) { close(false); } });
	refresh();
}
