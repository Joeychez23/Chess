/*
 *  boot.js  --  chess frontend
 *	The Meridian Terminal's Boot
 *	The boot lines typed out each time the terminal starts (every page load), & the fault text & the maker's screen shown before them after a
 *	dropped link: when each gives way to the next, & how each draws
 *	Everything draws on a 2D context handed in, so no DOM & no three.js here: the tests load it in Node (client/test/monitor/boot.test.js)
 *
 */

import { W, H, LINE, px, drawText } from "./kit.js";
import { fitText } from "../pixelFont.js";
import { plies } from "./events.js";

const FAULT_MS = 5000, SPLASH_MS = 3000, LINE_MS = 400, CHAR_MS = 45; // HOW LONG EACH PART HOLDS, ONE BOOT LINE & ONE TYPED LETTER OF THE FAULT
const BOOT_X = 47, BOOT_Y = 57, BOOT_W = 242, NAME_MAX = 12; // THE BOOT LINES' PLACE (INSIDE THE FRAME screen.js DRAWS) & THE LONGEST NAME THAT LEAVES THE CLEARANCE WHOLE
const FAULT = [["A fault has occurred.", 60, 44, 500], ["The session will resume shortly.", 60, 56, 2500]]; // TEXT, x, y, WHEN IT STARTS TYPING (ms)

// The phase after `phase`, `elapsed` ms after it began: fault, splash, boot (`lines` of them, LINE_MS each), then none; the fault holds for
// as long as the link is down
// A bad number never holds a phase: a bad elapsed waits out the fault (0 ms) but ends the maker's screen
function nextPhase(phase, elapsed, opts) {
	const { offline = false, lines = 0 } = opts || {};
	const n = Number.isFinite(lines) && lines > 0 ? lines : 0; // NO LINES: NO BOOT
	if (phase === "fault") { return !offline && typeof elapsed === "number" && elapsed >= FAULT_MS ? "splash" : "fault"; }
	if (phase === "splash") { return typeof elapsed === "number" && elapsed < SPLASH_MS ? "splash" : n ? "boot" : null; } // NaN AND NON-NUMBERS COUNT AS OVER
	if (phase === "boot") { return typeof elapsed === "number" && elapsed < n * LINE_MS ? "boot" : null; }
	return null;
}

// The lines the terminal types as it starts
function bootLines(d) {
	const data = d || {};
	const who = [...String(data.who || "GUEST")];
	const name = who.length > NAME_MAX ? who.slice(0, NAME_MAX - 1).join("") + "." : who.join(""); // CUT THE NAME, NEVER THE CLEARANCE
	const lines = ["Connecting to terminal 03.", ". .", "Connection established.", "Validating user.", `User: ${name} [clearance: ${data.signedIn ? "standard" : "none"}]`, "Session opened.", "All activity is recorded.", "Type help for commands."];
	const moves = plies(data).length;
	if (moves) { lines.push(`Session restored at move ${Math.floor(moves / 2) + 1}.`); }
	return lines;
}

// The boot's rows as they stand: one more line every LINE_MS, the newest typed across its own LINE_MS (whole when the next one starts)
function bootRows(lines, elapsed, reduce) {
	const all = Array.isArray(lines) ? lines : [];
	const t = typeof elapsed === "number" && elapsed > 0 ? elapsed : 0;
	const n = reduce ? all.length : Math.min(all.length, Math.floor(t / LINE_MS) + 1);
	return all.slice(0, n).map(function (line, i) {
		const chars = [...fitText(String(line), BOOT_W)];
		const part = !reduce && i === n - 1 ? chars.slice(0, Math.ceil(chars.length * Math.min(1, (t - i * LINE_MS) / LINE_MS))) : chars;
		return { text: part.join(""), x: BOOT_X, y: BOOT_Y + i * LINE };
	});
}

// The boot lines, in the dim colour. The caller draws what is round them
function drawBoot(ctx, T, lines, elapsed, reduce) {
	for (const { text, x, y } of bootRows(lines, elapsed, reduce)) { drawText(ctx, text, x, y, T.dim); }
}

// What of `text` has been typed `elapsed` ms after it started, in whole characters
function typed(text, elapsed) {
	return [...text].slice(0, Math.max(0, Math.floor(elapsed / CHAR_MS))).join("");
}

// The fault's two rows as they stand: [{ text, x, y }]
function faultRows(elapsed, reduce) {
	return FAULT.map(([text, x, y, at]) => ({ text: reduce ? text : typed(text, elapsed - at), x, y }));
}

// The fault screen: the whole grid in the background, the two lines typed out in ink
function drawFault(ctx, T, elapsed, reduce) {
	px(ctx, 0, 0, W, H, T.bg);
	for (const { text, x, y } of faultRows(elapsed, reduce)) { drawText(ctx, text, x, y, T.ink); }
}

// The maker's screen: a splash block, MERIDIAN & its version in the background colour
function drawSplash(ctx, T) {
	px(ctx, 0, 0, W, H, T.bg);
	px(ctx, 16, 4, 288, 228, T.splash);
	drawText(ctx, "MERIDIAN", 160, 102, T.bg, 0, 3);
	drawText(ctx, "VERSION 4.02", 234, 132, T.bg, 1);
}

export { FAULT_MS, SPLASH_MS, LINE_MS, CHAR_MS, nextPhase, bootLines, bootRows, drawBoot, typed, faultRows, drawFault, drawSplash };
