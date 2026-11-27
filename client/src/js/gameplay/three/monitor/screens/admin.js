/*
 *  admin.js  --  chess frontend
 *	The Meridian Terminal's Administrative Control Window
 *	Two requests, one answer each: REQUEST asks for a reversal (a takeback) & shows what came of it, OVERRIDE ends the session (a resignation)
 *	on its second press. Each is one button as wide as the window; a narrow window drops the posts beside the answer
 *	Pure: no DOM & no three.js; the tests load it in Node (client/test/monitor/terminal-screens.test.js)
 *
 */

import { px, box, drawText, boxW } from "../kit.js";
import { fitText } from "../../pixelFont.js";

const W = 206, PAD = 6, PANEL_H = 36, PITCH = 44; // W: THE INSIDE OF THE DEFAULT { 56, 62, 208, 106 } WINDOW
const SMALL = 120; // UNDER THIS WIDTH THE POSTS GO
const BLINK = 700; // ms, THE OVERRIDE'S QUESTION
const GRANTED = "Reversal granted. Noted."; // events.js's line

/* ---------------------------------------------------------------- */
// Answers
/* ---------------------------------------------------------------- */

const action = (v, id) => (Array.isArray(v.actions) ? v.actions : []).find((a) => a && a.id === id);
const lastLog = (v) => { const log = (v.term && Array.isArray(v.term.log) && v.term.log) || []; return log.length ? String((log[log.length - 1] || [])[1] ?? "") : ""; };

/**
 * @description The REQUEST panel: what stands with the player's reversal
 * @param  {[object]} v [screen data]
 * @return {[object]} { line, enabled, granted }
 */
function request(v) {
	const offer = (v.offers || {}).takeback, a = action(v, "takeback");
	if (offer === "sent") { return { line: "Reversal - under review", enabled: false, granted: false }; }
	if (offer === "incoming") { return { line: "Reversal - answer in Mail", enabled: false, granted: false }; }
	const enabled = Boolean(a && a.shown && a.enabled);
	if (lastLog(v) === GRANTED) { return { line: "Reversal - granted. Noted.", enabled, granted: true }; } // NOTHING HAPPENED SINCE
	return { line: enabled ? "Reversal - press to request" : "Reversal - not permitted", enabled, granted: false };
}

/**
 * @description The OVERRIDE panel: ending the session, asked once more first
 * @param  {[object]} v [screen data]
 * @return {[object]} { line, enabled, asking }
 */
function override(v) {
	if (v.over) { return { line: "Session closed.", enabled: false, asking: false }; }
	const asking = Boolean(v.ui && v.ui.confirm);
	return { line: asking ? "End session - confirm?" : "End session", enabled: true, asking };
}

/* ---------------------------------------------------------------- */
// Screen module
/* ---------------------------------------------------------------- */

function size(v) {
	return { w: boxW(v, W), h: PAD + PITCH + PANEL_H + PAD };
}

/**
 * @description The two panels as buttons, REQUEST then OVERRIDE
 * @param  {[object]} v [screen data]
 * @return {[object[]]} [{ id, x, y, w, h, label, enabled }]
 */
function buttons(v) {
	const w = boxW(v, W) - 2 * PAD, r = request(v), o = override(v);
	return [
		{ id: "request", x: PAD, y: PAD, w, h: PANEL_H, label: `Request: ${r.line}`, enabled: r.enabled },
		{ id: "override", x: PAD, y: PAD + PITCH, w, h: PANEL_H, label: `Override: ${o.line}`, enabled: o.enabled },
	];
}

function press(id, handlers, v) {
	const b = buttons(v).find((x) => x.id === id);
	if (!b || !b.enabled) { return; }
	if (id === "request") { handlers.takeback(); return; }
	if (override(v).asking) { handlers.ui({ confirm: false }); handlers.forfeit(); } else { handlers.ui({ confirm: true }); }
}

function speak(v) {
	return `${request(v).line}. ${override(v).line}`.replace(/\.\./g, ".");
}

function tick(v) {
	return override(v).asking && !v.reduce ? BLINK : null;
}

/**
 * @description Draws the two panels: a double frame, a header bar with the panel's name & its lamp (lit when granted), the answer centred
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object]} v [screen data]
 */
function draw(ctx, v) {
	const T = v.T, r = request(v), o = override(v), posts = boxW(v, W) >= SMALL;
	const blink = o.asking && !v.reduce && Math.floor((Number(v.now) || 0) / BLINK) % 2 === 1;
	const rows = [["REQUEST", r.line, r.granted, r.enabled ? T.ink : T.dim], ["OVERRIDE", o.line, false, blink || !o.enabled ? T.dim : T.ink]];
	buttons(v).forEach(function ({ id, x, y, w, h }, i) {
		const [name, line, lampOn, color] = rows[i];
		box(ctx, x, y, w, h, id === v.focus || id === v.hover ? T.hot : T.ink);
		box(ctx, x + 2, y + 2, w - 4, h - 4, T.dim);
		px(ctx, x + 4, y + 4, w - 8, 13, T.ink);
		drawText(ctx, fitText(name, w - 34), x + 8, y + 7, T.bg);
		px(ctx, x + w - 22, y + 7, 14, 7, lampOn ? T.hot : T.bg);
		if (posts) { px(ctx, x + 6, y + 21, 4, 9, T.ink); px(ctx, x + w - 10, y + 21, 4, 9, T.ink); }
		drawText(ctx, fitText(line, w - (posts ? 28 : 8)), x + w / 2, y + 22, color, 0);
	});
}

export { size, draw, buttons, press, speak, tick, request, override };
