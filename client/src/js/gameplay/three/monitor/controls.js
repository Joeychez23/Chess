/*
 *  controls.js  --  chess frontend
 *	The Meridian Terminal's Controls
 *	Pure helpers for the zoomed terminal: the footer tabs, hit testing, focus, keys, zoom maths & the screen reader text (no state)
 *	No DOM & no three.js here: the tests load it in Node (client/test/monitor/controls.test.js)
 *
 */

import { W, H, FOOT, TAB_NAMES, sentence } from "./kit.js";
import { drawable } from "../pixelFont.js";

const SCREENS = Object.keys(TAB_NAMES); // SESSION, LOG, MAIL, SYSTEMS: THE FOOTER'S ORDER & THE KEYS 1 TO 4
const KEYS = { w: "up", a: "left", s: "down", d: "right" };
const ARROWS = { ArrowUp: "up", ArrowLeft: "left", ArrowDown: "down", ArrowRight: "right" };
// Each direction as [axis, sign]; axis 0 is x and 1 is y.
const AXES = { up: [1, -1], down: [1, 1], left: [0, -1], right: [0, 1] };

/* ---------------------------------------------------------------- */
// Geometry
/* ---------------------------------------------------------------- */

/**
 * @description The grid pixel under a point on the glass
 * @param  {[number]} u [0 to 1, left to right]
 * @param  {[number]} v [0 to 1, top to bottom: the glass's UVs start at the top]
 * @return {[object]} { x, y } clamped to the grid
 */
export function uvToGrid(u, v) {
	const clamp = (n, max) => Math.min(max - 1, Math.max(0, Math.floor(n)));
	return { x: clamp(u * W, W), y: clamp(v * H, H) };
}

/**
 * @description The camera distance at which a glass fills part of the view in its tighter dimension
 * @param  {[number]} w [the glass's width]
 * @param  {[number]} h [the glass's height]
 * @param  {[number]} fovDeg [the camera's vertical field of view]
 * @param  {[number]} aspect [the view's width over its height]
 * @param  {[number]} fill [the part of the view to fill]
 * @return {[number]} distance
 */
export function zoomDistance(w, h, fovDeg, aspect, fill = 0.8) {
	const tan = Math.tan((fovDeg * Math.PI) / 360);
	// The farther of the two distances keeps both sides in view.
	return Math.max(h / (2 * tan * fill), w / (2 * tan * aspect * fill));
}

/**
 * @description Whether a press & its release were a tap rather than a drag
 * @param  {[object]} press [{ x, y } in screen pixels]
 * @param  {[object]} release [{ x, y }]
 * @param  {[string]} type [the pointer type: mouse, pen or touch]
 * @return {[boolean]}
 */
export function isTap(press, release, type) {
	// Fingers wobble more than a mouse or a pen, so touch gets a wider margin.
	return Math.hypot(release.x - press.x, release.y - press.y) < (type === "touch" ? 10 : 4);
}

/* ---------------------------------------------------------------- */
// Buttons
/* ---------------------------------------------------------------- */

/**
 * @description The footer's four screen tabs (kit.js footer draws them at the same places)
 * @param  {[string]} [active] [the showing screen; unused, the footer marks it when it draws]
 * @return {[object[]]} buttons, { id: "tab:<screen>", x, y, w, h, label, enabled: true }
 */
// eslint-disable-next-line no-unused-vars -- KEPT IN THE SIGNATURE THE PLAN PINS
export function tabButtons(active) {
	return SCREENS.map((id, i) => ({ id: `tab:${id}`, x: FOOT.x + i * FOOT.pitch, y: FOOT.y, w: FOOT.tabW, h: FOOT.h, label: TAB_NAMES[id], enabled: true }));
}

// How far a point is from a button's box (Chebyshev distance), 0 inside it.
function distance(b, x, y) {
	return Math.max(b.x - x, 0, x - (b.x + b.w), b.y - y, y - (b.y + b.h));
}

/**
 * @description The button under a point, or the only one within reach of it
 * @param  {[object[]]} buttons
 * @param  {[number]} x [grid pixels]
 * @param  {[number]} y
 * @param  {[number]} slop [how far a near miss may be]
 * @return {[object|null]} the enabled button containing the point, else the nearest enabled one within slop, else null
 * (two equally near is a miss)
 */
export function hit(buttons, x, y, slop = 4) {
	const live = buttons.filter((b) => b.enabled);
	const inside = live.find((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
	if (inside) { return inside; }
	const near = live.filter((b) => distance(b, x, y) <= slop);
	const best = Math.min(...near.map((b) => distance(b, x, y)));
	const nearest = near.filter((b) => distance(b, x, y) === best);
	// A press in the gap between two tabs goes to the closer one.
	return nearest.length === 1 ? nearest[0] : null;
}

// A button's centre as [x, y].
function middle(b) {
	return [b.x + b.w / 2, b.y + b.h / 2];
}

/**
 * @description Where focus goes from a button in a direction, so it never sticks
 * @param  {[object[]]} buttons
 * @param  {[string]} fromId [the focused button]
 * @param  {[string]} dir [up, down, left or right]
 * @return {[string|null]} the nearest enabled button that way (primary distance plus twice the cross distance),
 *                          else the farthest the other way (ties nearest on the cross axis),
 *                          else fromId; the first enabled button when fromId is unknown
 */
export function nextFocus(buttons, fromId, dir) {
	const live = buttons.filter((b) => b.enabled);
	const from = buttons.find((b) => b.id === fromId);
	if (!from) { return live.length ? live[0].id : null; }
	const [axis, sign] = AXES[dir];
	const at = middle(from);
	const others = live.filter((b) => b !== from).map(function (b) {
		const c = middle(b);
		return { id: b.id, along: (c[axis] - at[axis]) * sign, across: Math.abs(c[1 - axis] - at[1 - axis]) };
	});
	const ahead = others.filter((o) => o.along > 0);
	if (ahead.length) { return ahead.reduce((best, o) => (o.along + 2 * o.across < best.along + 2 * best.across ? o : best)).id; }
	const behind = others.filter((o) => o.along < 0);
	// Nothing that way: wrap around to the farthest button the other way.
	if (behind.length) {
		return behind.reduce((best, o) => (o.along < best.along || (o.along === best.along && o.across < best.across) ? o : best)).id;
	}
	return fromId;
}

/**
 * @description What a key does on the zoomed terminal
 * @param  {[string]} key [KeyboardEvent.key]
 * @param  {[boolean]} typing [whether the console's input has the keys]
 * @return {[object|null]} { type: "leave" } on Escape always. Typing: run (Enter), erase (Backspace), cancel ("Cancel": Control + C), move up or down
 * (the up & down arrows, Tab as down), char (a single letter the font draws, space included). Not typing: move (W, A, S, D
 * & the arrows), press (Enter or space), tab (1 to 4, { id } a screen). Else null, so the browser keeps the key
 */
export function keyAction(key, typing) {
	if (typeof key !== "string") { return null; }
	if (key === "Escape") { return { type: "leave" }; }
	if (typing) {
		if (key === "Enter") { return { type: "run" }; }
		if (key === "Backspace") { return { type: "erase" }; }
		if (key === "Cancel") { return { type: "cancel" }; } // CONTROL + C, AS ../pointer SENDS IT
		if (key === "ArrowUp" || key === "ArrowDown") { return { type: "move", dir: ARROWS[key] }; }
		if (key === "Tab") { return { type: "move", dir: "down" }; }
		return key.length === 1 && drawable(key) ? { type: "char", char: key } : null;
	}
	if (key.length === 1 && KEYS[key.toLowerCase()]) { return { type: "move", dir: KEYS[key.toLowerCase()] }; }
	if (ARROWS[key]) { return { type: "move", dir: ARROWS[key] }; }
	if (key === "Enter" || key === " ") { return { type: "press" }; }
	return /^[1-4]$/.test(key) ? { type: "tab", id: SCREENS[key - 1] } : null;
}

/**
 * @description What the screen reader says for a button
 * @param  {[object]} button
 * @param  {[object[]]} buttons [the footer tabs & the screen's buttons it is among]
 * @return {[string]} e.g. "Takeback, button, 2 of 4" or "Mail, tab, 3 of 4", with ", selected" when the button says so
 * & ", unavailable" when disabled
 */
export function describe(button, buttons) {
	const isTab = button.id.startsWith("tab:");
	let text;
	if (button.id === "back") { text = "Back, button"; }
	else if (isTab) {
		const tabs = buttons.filter((b) => b.id.startsWith("tab:"));
		text = `${sentence(button.label)}, tab, ${tabs.findIndex((b) => b.id === button.id) + 1} of ${tabs.length}`;
		if (button.selected) { text += ", selected"; }
	} else {
		const own = buttons.filter((b) => b.id !== "back" && !b.id.startsWith("tab:"));
		text = `${sentence(button.label)}, button, ${own.findIndex((b) => b.id === button.id) + 1} of ${own.length}`;
	}
	return button.enabled ? text : `${text}, unavailable`;
}
