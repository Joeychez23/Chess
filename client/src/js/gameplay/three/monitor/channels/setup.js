/*
 *  setup.js  --  chess frontend
 *	The CRT Monitor's Setup Channel
 *	One row per channel (its name, ON or OFF, DEF to make it the one that opens first & a marker on the one that does) & a row for what the monitor shows when idle.
 *	The face & this channel can't be turned off. Every change goes out as a prefs patch; nothing is kept here
 *
 */

import { TEXT, DIM, HOT, NAMES, drawText, body } from "../kit.js";
import { CHANNELS, LOCKED, IDLES } from "../prefs.js";

const ROW = 12; // ONE ROW'S HEIGHT, 7 CHANNELS & THE IDLE ROW FILL THE BODY
const BTN_H = 11; // A 7 px LABEL WITH 1 px CLEAR ABOVE & BELOW INSIDE ITS BORDER, 1 px BETWEEN ROWS
// WHERE THINGS GO ACROSS A ROW, FROM THE BODY'S LEFT EDGE. THE ZOOMED BODY IS 144 px (THE BEZEL'S SAFE AREA), SO ITS DEFAULT MARKER IS AN ARROW AT THE DEF BUTTON
const DESK = { name: 2, toggle: { x: 62, w: 22 }, def: { x: 88, w: 22 }, mark: { x: 114, text: "DEFAULT" }, idle: { xs: [40, 78, 116], w: 32 } };
const ZOOMED = { name: 2, toggle: { x: 64, w: 22 }, def: { x: 88, w: 22 }, mark: { x: 113, text: "◀" }, idle: { xs: [32, 71, 110], w: 33 } }; // EVALUATION ENDS AT 61. THE SIX PIXELS BEFORE EACH IDLE BUTTON ARE FOR THE MARKER

// THE ROW LAYOUT FOR THE DATA
function layout(data) {
	return data.zoomed ? ZOOMED : DESK;
}

// A ROW'S TOP EDGE
function rowY(data, r) {
	return body(data).y + 2 + r * ROW;
}

/* ---------------------------------------------------------------- */
// Channel
/* ---------------------------------------------------------------- */

/**
 * @description Draws the channel: the names, the default marker & the idle picture's marker
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object]} data [the channels' data]
 */
export function draw(ctx, data) {
	const { prefs } = data;
	const x0 = body(data).x, at = layout(data);
	CHANNELS.forEach(function (id, r) {
		const y = rowY(data, r) + 2;
		drawText(ctx, NAMES[id], x0 + at.name, y, prefs.enabled.includes(id) ? TEXT : DIM);
		if (prefs.defaultChannel === id) { drawText(ctx, at.mark.text, x0 + at.mark.x, y, HOT); }
	});
	const y = rowY(data, CHANNELS.length) + 2;
	drawText(ctx, "IDLE", x0 + at.name, y, TEXT);
	IDLES.forEach(function (name, i) {
		if (prefs.idle === name) { drawText(ctx, "▶", x0 + at.idle.xs[i] - 6, y, HOT); }
	});
}

/**
 * @description The channel's buttons when zoomed: a toggle per channel, DEF per enabled channel, one per idle picture; none on the desk
 * @param  {[object]} data [the channels' data]
 * @return {[object[]]} buttons
 */
export function buttons(data) {
	if (!data.zoomed) { return []; }
	const { prefs } = data;
	const x0 = body(data).x, at = layout(data);
	const list = [];
	CHANNELS.forEach(function (id, r) {
		const y = rowY(data, r) + 1;
		const on = prefs.enabled.includes(id);
		list.push({ id: `toggle:${id}`, x: x0 + at.toggle.x, y, w: at.toggle.w, h: BTN_H, label: on ? "ON" : "OFF", enabled: !LOCKED.includes(id) });
		if (on) { list.push({ id: `default:${id}`, x: x0 + at.def.x, y, w: at.def.w, h: BTN_H, label: "DEF", enabled: true }); }
	});
	const y = rowY(data, CHANNELS.length) + 1;
	IDLES.forEach((name, i) => list.push({ id: `idle:${name}`, x: x0 + at.idle.xs[i], y, w: at.idle.w, h: BTN_H, label: name.toUpperCase(), enabled: true }));
	return list;
}

/**
 * @description Changes a setting
 * @param  {[string]} id [toggle:<channel>, default:<channel> or idle:<name>]
 * @param  {[object]} handlers [prefs(patch)]
 * @param  {[object]} data [the channels' data]
 */
export function press(id, handlers, data) {
	const [kind, value] = id.split(":");
	const { prefs } = data;
	if (kind === "toggle") {
		if (LOCKED.includes(value) || !CHANNELS.includes(value)) { return; }
		handlers.prefs({ enabled: CHANNELS.filter((c) => (c === value ? !prefs.enabled.includes(c) : prefs.enabled.includes(c))) }); // CHANNELS ORDER
	} else if (kind === "default" && CHANNELS.includes(value)) {
		handlers.prefs({ defaultChannel: prefs.defaultChannel === value ? null : value });
	} else if (kind === "idle" && IDLES.includes(value)) {
		handlers.prefs({ idle: value });
	}
}
