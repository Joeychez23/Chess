/*
 *  systems.js  --  chess frontend
 *	The Meridian Terminal's Systems Screen
 *	Live readings & the player's real settings: two meters, the buttons (Sound, Theme, Administration, Diagnostics), the READOUT, the
 *	Evaluation graph & the lamps. Every reading is real; no card wording in any game
 *	It lays itself out for its window's width (plan): two columns when wide, one column under that, & under SMALL only the meters &
 *	the buttons (the READOUT, the graph & the lamps are left out). Content pixels: (0, 0) is the content's top left
 *	No DOM & no three.js here, so the tests load it in Node (client/test/monitor/terminal-screens.test.js)
 *
 */

import { px, drawText, box, btn, meter, lamp, boxW } from "../kit.js";
import { DEFAULT_THEME, themeFor } from "../themes.js";
import { plies } from "../events.js";
import { fitText, textWidth } from "../../pixelFont.js";

const W = 278; // THE INSIDE OF THE DEFAULT { 20, 20, 280, 194 } WINDOW: THE TWO COLUMNS NEED IT
const SMALL = 140; // UNDER THIS WIDTH ONLY THE METERS & THE BUTTONS
const PAD = 6, COL = 119, BTN_H = 12, PITCH = 15;
const SIDE = 122; // THE READOUT'S & THE GRAPH'S WIDTH BESIDE THE LEFT COLUMN
const BUTTONS = [["sound", "Sound"], ["theme", "Theme"], ["admin", "Administration"], ["diag", "Diagnostics"]];

/* ---------------------------------------------------------------- */
// Readings
/* ---------------------------------------------------------------- */

const nowOf = (v) => Number(v.now) || 0;
const since = (v, at) => Math.max(0, nowOf(v) - (Number.isFinite(at) ? at : nowOf(v)));
const busy = (v) => Boolean(v.thinking || v.saving);

// ms as m:ss, or h:mm:ss past an hour
function clock(ms) {
	const s = Math.floor(ms / 1000), two = (n) => String(n).padStart(2, "0");
	return s >= 3600 ? `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`;
}

// Pieces each side has lost, from the FEN's board; a missing or bad FEN gives 0
function lost(fen) {
	const ranks = String(fen || "").split(" ")[0].split("/");
	if (ranks.length !== 8 || !ranks.every((r) => /^[pnbrqkPNBRQK1-8]+$/.test(r))) { return { w: 0, b: 0 }; }
	const board = ranks.join("");
	const count = (re) => (board.match(re) || []).length;
	return { w: Math.max(0, 16 - count(/[PNBRQK]/g)), b: Math.max(0, 16 - count(/[pnbrqk]/g)) };
}

// A label cut to a width; a "Lost: <who>" keeps its "Lost: " and cuts the name
function cut(label, width) {
	const at = label.indexOf(": ");
	if (at < 0) { return fitText(label, width); }
	const head = label.slice(0, at + 2);
	return head + fitText(label.slice(at + 2), width - textWidth(head) - 1);
}

/**
 * @description The READOUT's rows
 * @param {object} v screen data
 * @return {Array[]} [[label, value, tone]]: Session, Moves, Lost: <who>, Lost: unit | remote, Material, Link, Record
 */
export function readout(v) {
	const mine = v.playerColor === "b" ? "b" : "w", losses = lost(v.fen);
	return [
		["Session", clock(since(v, v.startedAt)), "ink"],
		["Moves", String(plies(v).length), "ink"],
		[`Lost: ${v.who || "GUEST"}`, String(losses[mine]), "ink"],
		[v.ai ? "Lost: unit" : "Lost: remote", String(losses[mine === "w" ? "b" : "w"]), "ink"],
		["Material", v.material ? String(v.material) : "even", "ink"],
		v.offline ? ["Link", "down", "hot"] : ["Link", "stable", "ink"],
		["Record", v.saving ? "saving" : "idle", "ink"],
	];
}

/* ---------------------------------------------------------------- */
// Evaluation
/* ---------------------------------------------------------------- */

/**
 * @description The game's evaluation as the graph's steps, newest last, from the player's side
 * @param  {[object]} v [screen data; v.eval { allowed, scores (White's win chance by ply, 0 - 100, null where none came), failed }]
 * @param  {[number]} n [how many steps fit]
 * @return {[Array]} [the last n: a number from -1 (lost) to 1 (won), or null]
 */
export function evalSteps(v, n) {
	const scores = v.eval && Array.isArray(v.eval.scores) ? v.eval.scores : [];
	const sign = v.playerColor === "b" ? -1 : 1;
	return scores.slice(-Math.max(0, n)).map((s) => (typeof s === "number" ? Math.max(-1, Math.min(1, (sign * (s - 50)) / 50)) : null));
}

// The graph in its box: the name, the player's chance now, a dotted middle line & one 5 px step per ply
function drawEval(ctx, T, v, g) {
	box(ctx, g.x, g.y, g.w, g.h, T.dim);
	drawText(ctx, "Evaluation", g.x + 5, g.y + 4, T.dim);
	const e = v.eval || {}, steps = evalSteps(v, Math.floor((g.w - 10) / 5)), mid = g.y + 25;
	const last = steps.filter((a) => a !== null).pop();
	if (!e.allowed || last === undefined) {
		drawText(ctx, fitText(!e.allowed ? "Not available." : e.failed ? "No signal." : "Standing by.", g.w - 10), g.x + 5, mid - 3, T.dim);
		return;
	}
	drawText(ctx, `${Math.round(50 + last * 50)}%`, g.x + g.w - 5, g.y + 4, T.ink, 1);
	for (let x = g.x + 4; x < g.x + g.w - 4; x += 4) { px(ctx, x, mid, 2, 1, T.dim); }
	let before = null;
	steps.forEach(function (a, i) {
		if (a === null) { before = null; return; }
		const x = g.x + 6 + i * 5, y = mid - Math.round(a * 11), from = before === null ? y : before;
		px(ctx, x, y, 5, 1, T.ink);
		px(ctx, x, Math.min(y, from), 1, Math.abs(y - from) + 1, T.ink);
		before = y;
	});
}

/* ---------------------------------------------------------------- */
// Layout
/* ---------------------------------------------------------------- */

/**
 * @description Where everything goes for the window's width
 * @param  {[object]} v [screen data, v.box the view]
 * @return {[object]} { w, h, cells (per meter), buttons ([{ id, x, y, w, h }]), readout, graph, lamps ({ x, y, w, h } or null) }
 */
export function plan(v) {
	const w = boxW(v, W);
	if (w >= W) { // TWO COLUMNS
		const x = w - SIDE - 5;
		const buttons = BUTTONS.map(([id], i) => (id === "diag" ? { id, x: PAD, y: 162, w: 84, h: BTN_H } : { id, x: PAD, y: 60 + i * PITCH, w: COL, h: BTN_H }));
		return { w, h: 180, cells: 24, buttons, readout: { x, y: 4, w: SIDE, h: 100 }, graph: { x, y: 108, w: SIDE, h: 42 }, lamps: { x: x - 4, y: 166 } };
	}
	const col = w - 2 * PAD;
	const buttons = BUTTONS.map(([id], i) => ({ id, x: PAD, y: 56 + i * PITCH, w: col, h: BTN_H }));
	const one = { w, cells: Math.min(24, Math.floor((col + 1) / 5)), buttons };
	if (w < SMALL) { return { ...one, h: 119, readout: null, graph: null, lamps: null }; }
	return { ...one, h: 282, readout: { x: PAD, y: 119, w: col, h: 100 }, graph: { x: PAD, y: 223, w: col, h: 42 }, lamps: { x: PAD, y: 271 } };
}

/* ---------------------------------------------------------------- */
// Screen module
/* ---------------------------------------------------------------- */

/**
 * @description The content's size for the window's width
 * @param  {[object]} v [screen data]
 * @return {object} { w, h } in grid pixels
 */
export function size(v) {
	const { w, h } = plan(v || {});
	return { w, h };
}

/**
 * @description The screen's buttons, in the keyboard's order
 * @param {object} v screen data
 * @return {object[]} [{ id, x, y, w, h, label, enabled, on }]: sound (on: the sound is on), theme, admin, diag
 */
export function buttons(v) {
	return plan(v).buttons.map(function (b, i) {
		const out = { ...b, label: BUTTONS[i][1], enabled: true };
		return b.id === "sound" ? { ...out, on: Boolean(v.sound) } : out;
	});
}

/**
 * @description A press on one of the screen's buttons
 * @param {string} id button id
 * @param {object} handlers
 */
export function press(id, handlers) {
	if (id === "sound") { handlers.sound(); }
	else if (id === "theme" || id === "admin" || id === "diag") { handlers.screen(id); }
}

/**
 * @description What a screen reader says for the screen
 * @param {object} v screen data
 * @return {string}
 */
export function speak(v) {
	const rows = Object.fromEntries(readout(v).map(([label, value]) => [label, value]));
	return `Link ${rows.Link}, ${rows.Moves} moves played, material ${rows.Material}.`;
}

/**
 * @description How soon the screen wants redrawing
 * @param {object} v screen data
 * @return {number|null} ms; null under reduced motion
 */
export function tick(v) {
	if (v.reduce) { return null; }
	return busy(v) ? 250 : 1000;
}

/**
 * @description Draws the SYSTEMS content (no frame: the desktop draws the window)
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} v screen data
 */
export function draw(ctx, v) {
	const T = v.T || themeFor(DEFAULT_THEME), now = nowOf(v), p = plan(v);
	const lit = (id) => v.focus === id || v.hover === id;
	const right = PAD + p.cells * 5 - 1; // THE METERS' RIGHT EDGE

	// METERS: CORE LOAD MOVES WITH now WHILE BUSY (STILL UNDER reduce), MOVE TIME 1 CELL PER 2.5 S
	const core = busy(v) ? (v.reduce ? 18 : 14 + (Math.floor(now / 250) * 5) % 9) : 2;
	const moved = since(v, v.movedAt);
	[["Core load", busy(v) ? "busy" : "idle", core], ["Move time", clock(moved), Math.floor(moved / 2500)]].forEach(([label, value, filled], i) => {
		drawText(ctx, fitText(label, right - PAD - textWidth(value) - 4), PAD, 6 + i * 22, T.dim);
		drawText(ctx, value, right, 6 + i * 22, T.ink, 1);
		meter(ctx, T, PAD, 15 + i * 22, p.cells, Math.min(p.cells, Math.round((filled * p.cells) / 24)));
	});

	for (const b of buttons(v)) { btn(ctx, T, b, lit(b.id)); }

	// READOUT: EACH LABEL CUT TO THE ROOM ITS VALUE LEAVES
	if (p.readout) {
		const r = p.readout, end = r.x + r.w - 4, room = r.w - 9;
		box(ctx, r.x, r.y, r.w, r.h, T.dim);
		px(ctx, r.x + 1, r.y + 1, r.w - 2, 11, T.dim);
		drawText(ctx, "READOUT", r.x + 5, r.y + 3, T.bg);
		readout(v).forEach(([label, value, tone], i) => {
			const shown = fitText(value, room), y = r.y + 16 + i * 10;
			drawText(ctx, cut(label, room - textWidth(shown) - 6), r.x + 5, y, T.dim);
			drawText(ctx, shown, end, y, T[tone] || T.ink, 1);
		});
	}
	if (p.graph) { drawEval(ctx, T, v, p.graph); }

	// THE LAMPS (REC BLINKS WHILE SAVING, UNLESS reduce)
	if (p.lamps) {
		[["LINK", !v.offline], ["REC", Boolean(v.saving) && (v.reduce || Math.floor(now / 500) % 2 === 0)], ["CHECK", Boolean(v.check)]].forEach(([label, on], i) => {
			const x = p.lamps.x + i * 42;
			lamp(ctx, T, x, p.lamps.y, on);
			drawText(ctx, label, x + 9, p.lamps.y - 1, T.dim);
		});
	}
}
