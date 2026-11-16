// The monitor's pure helpers: tab row, hit testing, focus, keys, zoom maths, screen reader text (no state)
import { W, H, NAMES, SHORT, tabRow, sentence } from "./kit.js";
import { CHANNELS } from "./prefs.js";
import { textWidth } from "../pixelFont.js";

export const ORDER = [...CHANNELS]; // CHANNEL IDS, IN TAB ORDER; A COPY SO NOTHING HERE CAN CHANGE PREFS.JS'S LIST
const TAB = { pad: 2, maxGap: 3 }; // A TAB IS ITS LABEL PLUS A 1 px BORDER EACH SIDE. THE ROW'S SPARE WIDTH GOES BETWEEN TABS, UP TO maxGap, SO TWO LIT TABS DON'T MERGE; ALL SIX & ◀ FIT THE SAFE AREA'S 144 px WITH NONE TO SPARE
const BACK = "◀ BACK";
const BACK_SHORT = "◀";
export const YOUR_MOVE = "▶ YOUR MOVE";
const KEYS = { w: "up", a: "left", s: "down", d: "right" };
const ARROWS = { ArrowUp: "up", ArrowLeft: "left", ArrowDown: "down", ArrowRight: "right" };
const AXES = { up: [1, -1], down: [1, 1], left: [0, -1], right: [0, 1] }; // [AXIS (0 X, 1 Y), SIGN]

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
	return Math.max(h / (2 * tan * fill), w / (2 * tan * aspect * fill)); // THE FARTHER ONE KEEPS BOTH SIDES IN VIEW
}

/**
 * @description Whether a press & its release were a tap rather than a drag
 * @param  {[object]} press [{ x, y } in screen pixels]
 * @param  {[object]} release [{ x, y }]
 * @param  {[string]} type [the pointer type: mouse, pen or touch]
 * @return {[boolean]}
 */
export function isTap(press, release, type) {
	return Math.hypot(release.x - press.x, release.y - press.y) < (type === "touch" ? 10 : 4); // FINGERS WOBBLE MORE
}

/* ---------------------------------------------------------------- */
// Channels
/* ---------------------------------------------------------------- */

/**
 * @description The channels this game & these settings offer, in tab order
 * @param  {[object]} data [the game's data]
 * @param  {[object]} prefs [the settings]
 * @return {[string[]]} ids
 */
export function available(data, prefs) {
	return ORDER.filter(function (id) {
		if (id === "setup") { return true; } // ALWAYS A WAY BACK TO THE SETTINGS
		if (id === "opponent" && data.offline) { return true; } // A LOST CONNECTION SHOWS ON IT, EVEN WHEN SWITCHED OFF
		if (!prefs.enabled.includes(id)) { return false; }
		if (id === "face") { return !!data.ai; }
		return true;
	});
}

/**
 * @description The channel the monitor shows on the desk
 * @param  {[object]} data [the game's data]
 * @param  {[object]} prefs [the settings]
 * @return {[string]} id
 */
export function idleChannel(data, prefs) {
	const offered = available(data, prefs);
	if (data.offline && !data.over) { return "opponent"; } // RECONNECTING UNTIL IT DOES
	if (prefs.defaultChannel && offered.includes(prefs.defaultChannel)) { return prefs.defaultChannel; }
	if (data.ai && offered.includes("face")) { return "face"; }
	return offered.includes("opponent") ? "opponent" : "setup";
}

/* ---------------------------------------------------------------- */
// Buttons
/* ---------------------------------------------------------------- */

/**
 * @description The tab row: BACK, then one tab per channel, centred in the safe area's top row (kit.js tabRow)
 * @param  {[string[]]} ids [the channels, in order]
 * @param  {[string]} [active] [the showing channel, whose tab is marked selected]
 * @return {[object[]]} buttons
 */
export function tabButtons(ids, active) {
	const tabW = (label) => textWidth(label) + TAB.pad;
	const row = (back) => tabW(back) + ids.reduce((sum, id) => sum + tabW(SHORT[id]), 0);
	const area = tabRow();
	const back = row(BACK) <= area.w ? BACK : BACK_SHORT; // THE SHORT ARROW WHEN THE WORD WON'T FIT
	const room = ids.length ? Math.min(TAB.maxGap, Math.floor((area.w - row(back)) / ids.length)) : 0; // ONE GAP AFTER BACK & EACH TAB BUT THE LAST
	const gap = room > 0 && room % 2 === 0 ? room - 1 : room; // ODD, SO NO COLUMN IN A GAP IS EQUALLY NEAR BOTH TABS (hit() WOULD CALL IT A MISS)
	let x = area.x + Math.floor((area.w - row(back) - gap * ids.length) / 2);
	const list = [];
	for (const [id, label] of [["back", back], ...ids.map((c) => [`tab:${c}`, SHORT[c]])]) {
		const w = tabW(label);
		const button = { id, x, y: area.y, w, h: area.h, label, enabled: true };
		if (id === `tab:${active}`) { button.selected = true; }
		list.push(button);
		x += w + gap;
	}
	return list;
}

/* ---------------------------------------------------------------- */
// litTab
/* ---------------------------------------------------------------- */

/**
 * @description The one tab to light: the focused one while the focus is on the tab row, else the showing channel's (never two at once, they'd read as one)
 * @param  {[object[]]} tabs [from tabButtons]
 * @param  {[string|null]} focus [the focused button's id]
 * @param  {[string]} channel [the showing channel]
 * @return {[string]} id
 */
export function litTab(tabs, focus, channel) {
	return tabs.some((b) => b.id === focus) ? focus : `tab:${channel}`;
}

// HOW FAR A POINT IS FROM A BUTTON'S BOX, 0 INSIDE (CHEBYSHEV)
function distance(b, x, y) {
	return Math.max(b.x - x, 0, x - (b.x + b.w), b.y - y, y - (b.y + b.h));
}

/**
 * @description The button under a point, or the only one within reach of it
 * @param  {[object[]]} buttons
 * @param  {[number]} x [grid pixels]
 * @param  {[number]} y
 * @param  {[number]} slop [how far a near miss may be]
 * @return {[object|null]} the enabled button containing the point, else the nearest enabled one within slop, else null (two equally near is a miss)
 */
export function hit(buttons, x, y, slop = 4) {
	const live = buttons.filter((b) => b.enabled);
	const inside = live.find((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
	if (inside) { return inside; }
	const near = live.filter((b) => distance(b, x, y) <= slop);
	const best = Math.min(...near.map((b) => distance(b, x, y)));
	const nearest = near.filter((b) => distance(b, x, y) === best);
	return nearest.length === 1 ? nearest[0] : null; // A PRESS IN THE GAP BETWEEN TABS GOES TO THE CLOSER ONE
}

// A BUTTON'S CENTRE AS [X, Y]
function middle(b) {
	return [b.x + b.w / 2, b.y + b.h / 2];
}

/**
 * @description Where focus goes from a button in a direction, so it never sticks
 * @param  {[object[]]} buttons
 * @param  {[string]} fromId [the focused button]
 * @param  {[string]} dir [up, down, left or right]
 * @return {[string|null]} the nearest enabled button that way (primary distance plus twice the cross distance), else the farthest the other way (ties nearest on the cross axis),
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
	if (behind.length) { return behind.reduce((best, o) => (o.along < best.along || (o.along === best.along && o.across < best.across) ? o : best)).id; } // WRAP
	return fromId;
}

/**
 * @description What a key does on the zoomed monitor
 * @param  {[string]} key [KeyboardEvent.key: W, A, S, D or an arrow moves, Enter or Space presses, Escape leaves]
 * @return {[string|null]} up, down, left, right, press, leave or null
 */
export function keyAction(key) {
	if (typeof key !== "string") { return null; }
	if (KEYS[key.toLowerCase()] && key.length === 1) { return KEYS[key.toLowerCase()]; }
	if (ARROWS[key]) { return ARROWS[key]; }
	if (key === "Enter" || key === " ") { return "press"; }
	if (key === "Escape") { return "leave"; }
	return null;
}

/**
 * @description What the screen reader says for a button
 * @param  {[object]} button
 * @param  {[object[]]} buttons [the tab row & the channel's buttons it is among]
 * @return {[string]} e.g. "Takeback, button, 2 of 4" or "Moves, tab, 3 of 6, selected", with ", unavailable" when disabled
 */
export function describe(button, buttons) {
	const isTab = button.id.startsWith("tab:");
	let text;
	if (button.id === "back") { text = "Back, button"; }
	else if (isTab) {
		const tabs = buttons.filter((b) => b.id.startsWith("tab:"));
		text = `${NAMES[button.id.slice(4)]}, tab, ${tabs.findIndex((b) => b.id === button.id) + 1} of ${tabs.length}`;
		if (button.selected) { text += ", selected"; }
	} else {
		const own = buttons.filter((b) => b.id !== "back" && !b.id.startsWith("tab:"));
		text = `${sentence(button.label)}, button, ${own.findIndex((b) => b.id === button.id) + 1} of ${own.length}`;
	}
	return button.enabled ? text : `${text}, unavailable`;
}
