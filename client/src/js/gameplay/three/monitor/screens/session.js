/*
 *  session.js  --  chess frontend
 *	The Terminal's Session Screen
 *	The console: the last printed lines that fit its box in their tones, then the prompt & its cursor. It reflows to the box & never scrolls
 *	Pure: draws on a 2D context handed in, so no DOM & no three.js here (client/test/monitor/screens-session.test.js)
 *
 */

import { LINE, px, drawText } from "../kit.js";
import { textWidth, fitText } from "../../pixelFont.js";

const DEFAULT_BOX = { w: 250, h: 158 }; // THE INSIDE OF THE DEFAULT SESSION WINDOW { 40, 38, 252, 172 } UNDER ITS 13 px TITLE BAR & 1 px BORDER
const MARGIN = 6; // LEFT, RIGHT & TOP, IN CONTENT PIXELS
const BLINK = 500; // ms

/**
 * @description The content's size: the box itself, so Session never scrolls
 * @param  {[object]} v [screen data]
 * @return {[object]} { w, h }
 */
function size(v) {
	return v.box || DEFAULT_BOX;
}

/**
 * @description The rows of text the screen draws: the last lines that fit in their tones, then the prompt in hot
 * @param  {[object]} v [screen data]
 * @return {[array]} [{ text, x, y, color }]
 */
function rows(v) {
	const T = v.T || {}, { w, h } = size(v);
	const fit = Math.floor((h - 2 * MARGIN + LINE - 7) / LINE); // THE ROWS THAT FIT ABOVE A 6 px BOTTOM MARGIN (THE LAST ROW NEEDS ONLY ITS 7 px), THE LAST ONE THE PROMPT'S
	if (fit < 1) { return []; }
	const all = (v.term && v.term.lines) || [], shown = fit > 1 ? all.slice(-(fit - 1)) : [];
	const out = shown.map(([text, tone], i) => ({ text: fitText(String(text ?? ""), w - 2 * MARGIN), x: MARGIN, y: MARGIN + i * LINE, color: (tone === "dim" || tone === "hot") ? T[tone] : T.ink })); // ONLY THE THREE TONES ARE COLOURS
	out.push({ text: fitText(`> ${v.input || ""}`, w - 2 * MARGIN - 6), x: MARGIN, y: MARGIN + shown.length * LINE, color: T.hot }); // ROOM LEFT FOR THE CURSOR
	return out;
}

/**
 * @description Draws the lines, the prompt & the cursor in content pixels
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object]} v [screen data]
 */
function draw(ctx, v) {
	const T = v.T || {}, r = rows(v);
	if (!r.length) { return; }
	for (const { text, x, y, color } of r) { drawText(ctx, text, x, y, color); }
	if (v.cursorOn && v.focus === "console") {
		const prompt = r[r.length - 1];
		px(ctx, prompt.x + textWidth(prompt.text) + 1, prompt.y, 5, 7, T.hot);
	}
}

/**
 * @description The screen's one button: the console, the whole box
 * @param  {[object]} v [screen data]
 * @return {[array]}
 */
function buttons(v) {
	const { w, h } = size(v);
	return [{ id: "console", x: 0, y: 0, w, h, label: "Console", enabled: true }];
}

/**
 * @description A press: the console starts typing
 * @param  {[string]} id
 * @param  {[object]} handlers
 * @param  {[object]} v [screen data]
 */
function press(id, handlers, v) { // eslint-disable-line no-unused-vars
	if (id === "console") { handlers.ui({ typing: true }); }
}

/**
 * @description What a screen reader says: the last printed line
 * @param  {[object]} v [screen data]
 * @return {[string]}
 */
function speak(v) {
	const all = (v.term && v.term.lines) || [];
	return all.length ? String(all[all.length - 1][0] ?? "") : "No output yet.";
}

/**
 * @description How often to redraw for the cursor's blink: only at the monitor & with motion allowed
 * @param  {[object]} v [screen data]
 * @return {[number|null]} [ms]
 */
function tick(v) {
	return v.zoomed && !v.reduce ? BLINK : null;
}

export { size, rows, draw, buttons, press, speak, tick };
