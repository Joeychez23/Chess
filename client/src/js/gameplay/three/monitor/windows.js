/*
 *  windows.js  --  chess frontend
 *	The Meridian Desktop's Window Geometry
 *	The seven windows' records & every rect the desktop needs from one: where it sits, its title bar & close box,
 *	the view its content shows in, its scroll bars & thumbs, its resize grip. A list of windows runs back to front
 *	Pure: no DOM, no three.js, no storage, no time; every function returns new objects. Tested in client/test/monitor/windows.test.js
 *
 */

const IDS = ["session", "log", "mail", "systems", "diag", "theme", "admin"];
const TABBED = ["session", "log", "mail", "systems"]; // THE ONES WITH A FOOTER TAB
const TITLES = { session: "SESSION", log: "LOG", mail: "MAIL", systems: "SYSTEMS", diag: "DIAGNOSTICS", theme: "THEME", admin: "ADMIN CONTROL" };
const DESK = { x: 8, y: 16, w: 304, h: 202 }; // BETWEEN THE TOP BAR & THE FOOTER, & IN FROM THE SIDES: THE BEZEL HIDES THE GRID'S OUTER 8 px
const MIN_W = 60, MIN_H = 40;
const TITLE_H = 13;
const BAR = 7; // A SCROLL BAR'S THICKNESS
const GRIP = 7;
const THUMB_MIN = 6;

const LOG_WIN = { x: 20, y: 20, w: 280, h: 194 };
const START = [ // BACK TO FRONT
	{ id: "admin", x: 56, y: 62, w: 208, h: 106, open: false },
	{ id: "systems", ...LOG_WIN, open: false },
	{ id: "log", ...LOG_WIN, open: false },
	{ id: "diag", x: 26, y: 70, w: 268, h: 80, open: false },
	{ id: "theme", x: 80, y: 60, w: 160, h: 100, open: false },
	{ id: "mail", ...LOG_WIN, open: true },
	{ id: "session", x: 40, y: 38, w: 252, h: 172, open: true },
];

/* ---------------------------------------------------------------- */
// Records
/* ---------------------------------------------------------------- */

/**
 * @description The start layout: all seven windows, back to front, Mail & Session open
 * @return {[Array]} [fresh { id, x, y, w, h, open, min } records]
 */
function defaults() {
	return START.map((win) => ({ ...win, min: false }));
}

const fit = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const num = (v, def) => Math.round(Number.isFinite(v) ? v : def);

/**
 * @description A window kept on the desk: at least MIN_W x MIN_H, no larger than the desk, whole numbers
 * @param  {[Object]} win [a window record; a non-finite number falls back to that id's default]
 * @return {[Object]}
 */
function clamp(win) {
	const def = START.find((s) => s.id === win.id) || DESK;
	const w = fit(num(win.w, def.w), MIN_W, DESK.w), h = fit(num(win.h, def.h), MIN_H, DESK.h);
	return { ...win, w, h, x: fit(num(win.x, def.x), DESK.x, DESK.x + DESK.w - w), y: fit(num(win.y, def.y), DESK.y, DESK.y + DESK.h - h) };
}

/**
 * @description A valid window list from anything (kept state from storage): each known id once, the first wins & keeps its place,
 * missing ids added at the back at their defaults. Never throws
 * @param  {[any]} raw
 * @return {[Array]}
 */
function clean(raw) {
	const out = [];
	for (const item of Array.isArray(raw) ? raw : []) {
		try {
			if (!item || typeof item !== "object" || !IDS.includes(item.id) || out.some((x) => x.id === item.id)) continue;
			const open = item.open === true;
			out.push(clamp({ id: item.id, x: item.x, y: item.y, w: item.w, h: item.h, open, min: false })); // NOTHING MINIMIZES ANY MORE: min STAYS IN THE RECORD, ALWAYS false
		} catch { /* A RECORD THAT THROWS IS DROPPED */ }
	}
	return [...defaults().filter((d) => !out.some((x) => x.id === d.id)), ...out];
}

/* ---------------------------------------------------------------- */
// Stacking
/* ---------------------------------------------------------------- */

// THE LIST WITH ONE WINDOW CHANGED, & MOVED TO THE FRONT WHEN toFront
function change(wins, id, patch, toFront) {
	const out = wins.map((x) => (x.id === id ? { ...x, ...patch } : { ...x }));
	const i = out.findIndex((x) => x.id === id);
	if (toFront && i >= 0) out.push(out.splice(i, 1)[0]);
	return out;
}

/** @description Opens a window (un-minimized) at the front */
const open = (wins, id) => change(wins, id, { open: true, min: false }, true);
/** @description Brings a window to the front, nothing else changed */
const raise = (wins, id) => change(wins, id, {}, true);
/** @description Closes a window, order kept */
const close = (wins, id) => change(wins, id, { open: false, min: false }, false);

/** @description The windows showing (open, not minimized), back to front */
const shown = (wins) => wins.filter((x) => x.open && !x.min).map((x) => ({ ...x }));
/** @description The front window showing, or null */
const front = (wins) => shown(wins).pop() || null;
/** @description The topmost window showing whose frame holds the grid pixel (x, y), or null */
const at = (wins, x, y) => shown(wins).reverse().find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) || null;

/* ---------------------------------------------------------------- */
// Dragging
/* ---------------------------------------------------------------- */

/**
 * @description A window dragged by its title bar, kept on the desk
 * @param  {[Object]} win
 * @param  {[number]} dx [grid pixels]
 * @param  {[number]} dy
 * @return {[Object]}
 */
function move(win, dx, dy) {
	return clamp({ ...win, x: win.x + (+dx || 0), y: win.y + (+dy || 0) });
}

/**
 * @description A window resized by its grip: x & y stay, it grows right & down, stopping at the minimum & the desk's edges
 * @param  {[Object]} win
 * @param  {[number]} dw [grid pixels]
 * @param  {[number]} dh
 * @return {[Object]}
 */
function resize(win, dw, dh) {
	const c = clamp(win);
	return clamp({ ...c, w: Math.min(c.w + (+dw || 0), DESK.x + DESK.w - c.x), h: Math.min(c.h + (+dh || 0), DESK.y + DESK.h - c.y) });
}

/* ---------------------------------------------------------------- */
// Parts & scrolling
/* ---------------------------------------------------------------- */

// A THUMB'S START & LENGTH ALONG A BAR OF len PIXELS
function thumb(len, view, content, s, max) {
	const size = Math.min(len, Math.max(THUMB_MIN, Math.round((len * view) / content)));
	return { at: max > 0 ? Math.round(((len - size) * s) / max) : 0, size };
}

/**
 * @description Every rect of a window, in grid pixels; a part that is not there is null
 * @param  {[Object]} win
 * @param  {[Object]} content [{ w, h }: the content's size; missing or bad counts as the view's own size]
 * @param  {[Object]} scroll [{ x, y }, clamped to 0 .. max in the result]
 * @return {[Object]} [{ frame, title, close, view, grip, vbar, hbar, vthumb, hthumb, max, scroll }]
 */
function parts(win, content, scroll = { x: 0, y: 0 }) {
	const { x, y, w, h } = win;
	const ix = x + 1, iy = y + TITLE_H, iw = w - 2, ih = h - TITLE_H - 1; // THE INSIDE, IN FROM THE BORDER
	const c = content && typeof content === "object" ? content : {};
	const cw = Number.isFinite(c.w) ? c.w : iw, ch = Number.isFinite(c.h) ? c.h : ih;
	let vb = ch > ih;
	const hb = cw > iw - (vb ? BAR : 0);
	vb = vb || ch > ih - (hb ? BAR : 0); // THE SECOND PASS: A HORIZONTAL BAR CAN MAKE THE VERTICAL ONE NEEDED
	const view = { x: ix, y: iy, w: iw - (vb ? BAR : 0), h: ih - (hb ? BAR : 0) };
	const max = { x: Math.max(0, Math.round(cw - view.w)), y: Math.max(0, Math.round(ch - view.h)) };
	const s = scroll && typeof scroll === "object" ? scroll : {};
	const sc = { x: fit(num(s.x, 0), 0, max.x), y: fit(num(s.y, 0), 0, max.y) };
	// A LONE BAR STOPS SHORT OF THE CORNER, WHICH IS THE GRIP'S; WITH BOTH, THE GRIP IS THE SQUARE WHERE THEY MEET
	const vbar = vb ? { x: ix + view.w, y: iy, w: BAR, h: view.h - (hb ? 0 : GRIP) } : null;
	const hbar = hb ? { x: ix, y: iy + view.h, w: view.w - (vb ? 0 : GRIP), h: BAR } : null;
	const vt = vb && thumb(vbar.h, view.h, ch, sc.y, max.y), ht = hb && thumb(hbar.w, view.w, cw, sc.x, max.x);
	return {
		frame: { x, y, w, h },
		title: { x, y, w, h: TITLE_H },
		close: { x: x + w - 13, y: y + 2, w: 10, h: 10 },
		view,
		grip: { x: x + w - 1 - GRIP, y: y + h - 1 - GRIP, w: GRIP, h: GRIP },
		vbar,
		hbar,
		vthumb: vb ? { x: vbar.x, y: vbar.y + vt.at, w: BAR, h: vt.size } : null,
		hthumb: hb ? { x: hbar.x + ht.at, y: hbar.y, w: ht.size, h: BAR } : null,
		max,
		scroll: sc,
	};
}

/** @description How far a window's content scrolls: { x, y } */
const scrollMax = (win, content) => parts(win, content).max;

/**
 * @description The scroll value that puts a thumb's leading edge at a grid pixel (the inverse of parts' thumb, to within a pixel)
 * @param  {[Object]} win
 * @param  {[Object]} content
 * @param  {[string]} axis ["x" | "y"]
 * @param  {[number]} pos [grid pixels]
 * @return {[number]} [clamped to 0 .. max; 0 with no bar]
 */
function thumbTo(win, content, axis, pos) {
	const p = parts(win, content);
	const bar = axis === "x" ? p.hbar : p.vbar, th = axis === "x" ? p.hthumb : p.vthumb;
	if (!bar) return 0;
	const len = axis === "x" ? "w" : "h";
	const travel = bar[len] - th[len];
	return travel > 0 ? fit(Math.round(((pos - bar[axis]) * p.max[axis]) / travel), 0, p.max[axis]) : 0;
}

/**
 * @description The scroll value one view length further along an axis, clamped
 * @param  {[Object]} win
 * @param  {[Object]} content
 * @param  {[Object]} scroll [{ x, y }]
 * @param  {[string]} axis ["x" | "y"]
 * @param  {[number]} dir [-1 | 1]
 * @return {[number]}
 */
function page(win, content, scroll, axis, dir) {
	const p = parts(win, content, scroll);
	const next = { ...p.scroll, [axis]: p.scroll[axis] + dir * p.view[axis === "x" ? "w" : "h"] };
	return parts(win, content, next).scroll[axis];
}

export { IDS, TABBED, TITLES, DESK, MIN_W, MIN_H, TITLE_H, BAR, GRIP, defaults, clean, clamp, open, raise, close, shown, front, at, move, resize, parts, scrollMax, thumbTo, page };
