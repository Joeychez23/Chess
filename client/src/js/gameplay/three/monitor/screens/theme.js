/*
 *  theme.js  --  chess frontend
 *	The Meridian Terminal's Theme Window
 *	The five colour themes, one button each as wide as the window; a press picks one. Every button keeps the plain button colours: the
 *	current theme's carries the kit's box at its right end
 *	Pure: no DOM & no three.js; the tests load it in Node (client/test/monitor/terminal-screens.test.js)
 *
 */

import { btn, boxW } from "../kit.js";
import { THEME_IDS, themeFor } from "../themes.js";

const PAD = 6, PITCH = 15, BTN_H = 13, W = 158; // W: THE INSIDE OF THE DEFAULT { 80, 60, 160, 100 } WINDOW

/* ---------------------------------------------------------------- */
// Screen module
/* ---------------------------------------------------------------- */

const themeOf = (v) => (v && v.T) || themeFor();

function size(v) {
	return { w: boxW(v, W), h: PAD + THEME_IDS.length * PITCH + 4 };
}

/**
 * @description One button per theme, top to bottom; the current one is on
 * @param  {[object]} v [screen data]
 * @return {[object[]]} [{ id: "theme:<id>", x, y, w, h, label, enabled, on }], on only on the current theme's
 */
function buttons(v) {
	const current = themeOf(v).id, w = boxW(v, W) - 2 * PAD;
	return THEME_IDS.map(function (id, i) {
		const b = { id: "theme:" + id, x: PAD, y: PAD + i * PITCH, w, h: BTN_H, label: themeFor(id).label, enabled: true };
		return id === current ? { ...b, on: true } : b;
	});
}

/**
 * @description Draws the buttons: lit only when focused or hovered
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object]} v [screen data]
 */
function draw(ctx, v) {
	const T = themeOf(v);
	for (const b of buttons(v)) { btn(ctx, T, b, b.id === v.focus || b.id === v.hover); }
}

function press(id, handlers) {
	const theme = String(id).startsWith("theme:") ? id.slice(6) : null;
	if (THEME_IDS.includes(theme)) handlers.prefs({ theme });
}

function speak(v) {
	return `Theme. Current: ${themeOf(v).label}.`;
}

export { size, draw, buttons, press, speak };
