/*
 *  hint.js  --  chess frontend
 *	3D Controls Hint
 *	The first time a player opens 3D, a small bar at the bottom of the screen says how to move the camera (mouse or touch
 *	version). It goes on "Got it" or the first camera move & is remembered in localStorage, so it shows once. Part of the "three" chunk
 *
 */

const HINT_KEY = "CONTROLS_HINT"; // localStorage: "seen" ONCE THE PLAYER DISMISSED IT OR MOVED THE CAMERA
const MOUSE_CONTROLS = [["Left-drag", "Move piece / pan"], ["Right-drag", "Rotate"], ["Scroll", "Zoom"]];
const TOUCH_CONTROLS = [["Drag", "Move piece"], ["Two fingers", "Rotate"], ["Pinch", "Zoom"]];
const READ_ONLY_MOUSE = [["Left-drag", "Pan"], ["Right-drag", "Rotate"], ["Scroll", "Zoom"]]; // A REPLAY'S BOARD (/replay/:gameId): NO PIECE MOVES
const READ_ONLY_TOUCH = [["Two fingers", "Rotate"], ["Pinch", "Zoom"]];

let bar = null; // THE SHOWING BAR, null WHEN NONE
let seenThisPage = false; // STORAGE BLOCKED: STILL ONLY ONCE UNTIL THE PAGE RELOADS

function seen() {
	try { return localStorage.getItem(HINT_KEY) === "seen"; } catch { return false; } // STORAGE BLOCKED (PRIVATE MODE)
}

/**
 * @description Shows the controls bar unless the player has seen it. Touch screens get the touch version
 */
export function showHint() {
	if (bar || seenThisPage || seen()) { return; }
	const touch = window.matchMedia("(pointer: coarse)").matches;
	bar = document.createElement("div");
	bar.id = "controlsHint";
	bar.setAttribute("role", "region");
	bar.setAttribute("aria-label", "Camera controls");
	const list = document.createElement("ul");
	const readOnly = window.location.pathname.startsWith("/replay/");
	const controls = readOnly ? (touch ? READ_ONLY_TOUCH : READ_ONLY_MOUSE) : (touch ? TOUCH_CONTROLS : MOUSE_CONTROLS);
	for (const [keys, action] of controls) {
		const item = document.createElement("li");
		const kbd = document.createElement("kbd");
		kbd.textContent = keys;
		const span = document.createElement("span");
		span.textContent = action;
		item.append(kbd, span);
		list.append(item);
	}
	const button = document.createElement("button");
	button.type = "button";
	button.textContent = "Got it";
	button.addEventListener("click", dismissHint);
	bar.append(list, button);
	document.body.append(bar);
}

/**
 * @description Takes the bar down for good (Got it, or the first camera move). Does nothing when it isn't showing
 */
export function dismissHint() {
	if (!bar) { return; }
	seenThisPage = true;
	try { localStorage.setItem(HINT_KEY, "seen"); } catch { } // NOT SAVED (PRIVATE MODE) -> ONLY UNTIL THE PAGE RELOADS
	removeHint();
}

/**
 * @description Takes the bar down without remembering it (3D turned off before the player saw it through), it shows again next time
 */
export function removeHint() {
	if (!bar) { return; }
	bar.remove();
	bar = null;
}
