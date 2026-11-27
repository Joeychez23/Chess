/*
 *  screen.js  --  chess frontend
 *	The CRT Monitor's Screen
 *	Draws the terminal ("Meridian") the monitor in the library room shows (three/room/room.js has the monitor) on one 2D canvas, used as the
 *	glass's texture: the wall, the top bar & the footer's tabs, then the desktop's windows back to front (windows.js has their geometry, kit.js
 *	their frames, three/monitor/screens their contents, each clipped to its window's inside & scrolled) or, after a fault, the fault text
 *	& the maker's screen (boot.js). What to draw comes from the monitor's state machine
 *	(three/monitor/monitor.js view(), handed over by setMonitorView).
 *	Everything is drawn on a 320 x 240 grid & scaled up 2 times. Lit pixels get a soft glow (a blurred copy mixed in at 20%, plain source-over:
 *	solid colours stay exactly as set) &, while the camera is at the monitor, scanlines at 10% with the material's brightness raised by what
 *	they take away. It only redraws when something changes, at most once a frame; one timer steps what moves (the cursor, a phase, a meter)
 *
 */

import { CanvasTexture, MeshBasicMaterial, SRGBColorSpace, NearestFilter, LinearMipmapLinearFilter } from "three";
import { W, H, wall, station, footer, chrome, grip, win, box, drawPointer } from "./kit.js";
import { tabButtons } from "./controls.js";
import { themeFor } from "./themes.js";
import { drawFault, drawSplash, drawBoot } from "./boot.js";
import { SCREEN } from "./screens/index.js";

const UP = 2; // HOW MANY TIMES THE SCREEN'S GRID (kit.js) IS SCALED UP FOR THE TEXTURE
const STATION = "TERMINAL 03 - READING ROOM"; // THE TOP BAR
const BLINK_MS = 500; // THE CURSOR: THIS LONG ON, THIS LONG OFF
const PHASE_MS = 50; // A FAULT, THE MAKER'S SCREEN & THE BOOT LINES STEP THIS OFTEN
const BOOT_WIN = { x: 40, y: 38, w: 252, h: 172 }; // THE FRAME THE BOOT LINES TYPE INTO, BEFORE THE DESKTOP COMES UP
const GLOW = 0.2; // HOW MUCH OF THE BLURRED COPY IS MIXED OVER THE SHARP PICTURE
const SCAN = 0.1; // HOW DARK A SCANLINE IS. EVERY OTHER TEXTURE ROW, SO THE PICTURE LOSES HALF OF IT
const LIFT = 1 / (1 - SCAN / 2); // THE MATERIAL'S BRIGHTNESS WHILE THE SCANLINES SHOW: WHAT THEY TAKE AWAY, PUT BACK
const EDGE = { x: 15, y: 3, w: 290, h: 230 }; // THE DESK'S BORDER (THE KEYBOARD'S FOCUS, THE POINTER ON THE GLASS): JUST OUTSIDE THE TOP BAR & THE FOOTER, INSIDE WHAT THE BEZEL HIDES
const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)");

let screen = null; // EVERYTHING ONE createScreen() MADE, null WHEN THERE'S NO MONITOR
let getView = null; // THE MONITOR'S view() (setMonitorView), null: THE BARE TERMINAL (WALL, TOP BAR & FOOTER)

function makeCanvas(w, h) {
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	return canvas;
}

/* ---------------------------------------------------------------- */
// Drawing
/* ---------------------------------------------------------------- */

// THE SCANLINES AS ONE LAYER OVER THE SCALED UP PICTURE: EVERY OTHER TEXTURE ROW, 10% BLACK. MADE ONCE. NO VIGNETTE, NO STRIPES, NO TINT
function makeScanlines() {
	const canvas = makeCanvas(W * UP, H * UP);
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = `rgba(0, 0, 0, ${SCAN})`;
	for (let y = 1; y < canvas.height; y += 2) { ctx.fillRect(0, y, canvas.width, 1); }
	return canvas;
}

// A 1 px BORDER JUST OUTSIDE A BUTTON: THE KEYBOARD'S FOCUS & THE POINTER'S HOVER SHOW ON EVERY BUTTON, A CLOSE BOX & A TAB TOO
function ring(ctx, T, button) {
	box(ctx, button.x - 1, button.y - 1, button.w + 2, button.h + 2, T.hot);
}

// ONE WINDOW: ITS FRAME, THEN ITS CONTENT, DRAWN IN ITS OWN PIXELS FROM ITS TOP LEFT, MOVED TO THE WINDOW'S INSIDE LESS THE SCROLL & CLIPPED TO IT
function drawWindow(ctx, T, w, extra) {
	const p = w.p, screen = SCREEN[w.id];
	chrome(ctx, T, w.title, p, { front: w.front });
	if (!screen || !p.view || p.view.w <= 0 || p.view.h <= 0) { return; }
	ctx.save();
	ctx.beginPath();
	ctx.rect(p.view.x, p.view.y, p.view.w, p.view.h);
	ctx.clip();
	ctx.translate(p.view.x - p.scroll.x, p.view.y - p.scroll.y);
	screen.draw(ctx, { ...w.v, ...extra });
	ctx.restore();
	if (!p.vbar && !p.hbar) { grip(ctx, T, p.grip); } // NO BAR: THE GRIP IS OVER THE CONTENT'S CORNER, SO IT GOES ON AGAIN AFTER IT
}

/**
 * @description The terminal on the 320 x 240 grid, from the monitor's view
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object|null]} view [monitor.js view(), null before there's a monitor]
 * @param  {[object]} extra [what only the screen knows, added to every window's data: cursorOn, now & reduce]
 * @param  {[object]} T [the theme]
 */
function drawGrid(ctx, view, extra, T) {
	const tabs = view ? view.tabs : tabButtons();
	const zoomed = Boolean(view && view.zoomed);
	wall(ctx, T);
	station(ctx, T, STATION);
	footer(ctx, T, tabs);
	if (!view) { return; }
	if (view.phase === "fault") { drawFault(ctx, T, view.elapsed, extra.reduce); }
	else if (view.phase === "splash") { drawSplash(ctx, T); }
	else if (view.phase === "boot") {
		win(ctx, T, BOOT_WIN, "MERIDIAN");
		drawBoot(ctx, T, view.lines, view.elapsed, extra.reduce);
	}
	else { for (const w of view.wins || []) { drawWindow(ctx, T, w, extra); } }
	if (!zoomed) {
		if (view.deskFocus) { box(ctx, EDGE.x, EDGE.y, EDGE.w, EDGE.h, T.hot); }
		return; // NO POINTER & NO FOCUS RINGS ON THE DESK
	}
	if (!view.phase) {
		const all = [...tabs, ...(view.buttons || []).filter((b) => !b.hidden)]; // A BUTTON SCROLLED OUT OF ITS WINDOW HAS NO RING
		for (const id of new Set([view.keys === false ? null : view.focus, view.hover])) { // A FOCUS A POINTER PRESS LEFT BEHIND HAS NO RING
			const button = id && id !== "console" && all.find((b) => b.id === id); // THE CONSOLE'S FOCUS IS ITS CURSOR
			if (button) { ring(ctx, T, button); }
		}
	}
	if (view.pointer) { drawPointer(ctx, view.pointer.x, view.pointer.y); }
}

/**
 * @description Redraws the screen's canvas from the monitor's view, asks the board for a frame & reschedules the tick
 */
function draw() {
	if (!screen) { return; }
	cancelAnimationFrame(screen.raf);
	screen.raf = null;
	const { small, half, canvas, lines, material } = screen;
	const view = getView ? getView() : null;
	const now = Date.now();
	const reduce = REDUCE.matches;
	const extra = { now, reduce, cursorOn: reduce || Math.floor(now / BLINK_MS) % 2 === 0 };
	const T = (view && view.v && view.v.T) || themeFor();
	const zoomed = Boolean(view && view.zoomed);
	drawGrid(small.getContext("2d"), view, extra, T);
	const ctx = canvas.getContext("2d");
	ctx.globalCompositeOperation = "source-over";
	ctx.globalAlpha = 1;
	ctx.imageSmoothingEnabled = false; // SHARP PIXELS
	ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
	if (T.glow) { // A SOFT HALO ROUND LIT PIXELS: THE PICTURE DRAWN DOWN TO HALF SIZE & BACK UP, SMOOTHED, MIXED OVER THE SHARP ONE. A PLAIN MIX, SO A SOLID COLOUR STAYS ITSELF
		const hctx = half.getContext("2d");
		hctx.imageSmoothingEnabled = true;
		hctx.drawImage(small, 0, 0, half.width, half.height);
		ctx.imageSmoothingEnabled = true;
		ctx.globalAlpha = GLOW;
		ctx.drawImage(half, 0, 0, canvas.width, canvas.height);
		ctx.globalAlpha = 1;
	}
	if (zoomed) { ctx.drawImage(lines, 0, 0); } // FINE LINES SHIMMER FROM THE DESK, SO ONLY AT THE MONITOR
	material.color.setScalar(zoomed ? LIFT : 1);
	screen.texture.needsUpdate = true;
	screen.requestRender();
	clearTimeout(screen.timer);
	screen.timer = null;
	if (screen.paused || !view) { return; }
	const ticks = view.phase ? [PHASE_MS] : (view.wins || []).map((w) => (SCREEN[w.id] && typeof SCREEN[w.id].tick === "function" ? SCREEN[w.id].tick({ ...w.v, ...extra }) : null)); // THE SOONEST OF THE SHOWN WINDOWS'
	const ms = Math.min(...ticks.filter((t) => typeof t === "number"));
	if (Number.isFinite(ms)) { screen.timer = setTimeout(draw, ms); }
}

/* ---------------------------------------------------------------- */
// Screen
/* ---------------------------------------------------------------- */

/**
 * @description Puts the screen on the monitor's glass, showing the bare terminal until setMonitorView() hands it the monitor's view
 * @param  {[Mesh]} mesh [the monitor's glass (room.js), its UVs fill 0 - 1]
 * @param  {[function]} requestRender [asks the board for a frame, the scene only draws on demand]
 */
export function createScreen(mesh, requestRender) {
	disposeScreen();
	const canvas = makeCanvas(W * UP, H * UP);
	const texture = new CanvasTexture(canvas);
	texture.colorSpace = SRGBColorSpace;
	texture.flipY = false; // THE GLASS'S UVs ARE glTF's: THEY START AT THE IMAGE'S TOP
	texture.magFilter = NearestFilter; // SHARP UP CLOSE...
	texture.minFilter = LinearMipmapLinearFilter; // ...& MIPMAPS FAR AWAY: SMALL TEXT SHIMMERS INTO MOIRE WITHOUT THEM
	const material = new MeshBasicMaterial({ map: texture, toneMapped: false }); // UNLIT, IT GLOWS; ITS COLOURS ARE THE THEME'S, UNTOUCHED
	mesh.material = material;
	screen = { canvas, texture, material, requestRender, small: makeCanvas(W, H), half: makeCanvas(W / 2, H / 2), lines: makeScanlines(), timer: null, raf: null, paused: false };
	REDUCE.addEventListener("change", redrawScreen);
	draw();
}

/**
 * @description Hands the screen the monitor's view() to draw from (monitor/monitor.js); null goes back to the bare terminal
 * @param  {[function|null]} view [returns { state, zoomed, phase, elapsed, tabs, wins, buttons, focus, hover, pointer, deskFocus, input, v }]
 */
export function setMonitorView(view) {
	getView = typeof view === "function" ? view : null;
	if (screen) { draw(); }
}

/**
 * @description The monitor's show(): redraws on the next animation frame, once however often it's asked (a moving pointer asks on every event)
 */
export function redrawScreen() {
	if (!screen || screen.raf !== null) { return; }
	screen.raf = requestAnimationFrame(draw);
}

/**
 * @description Stops the screen's timer (the tab is hidden, the WebGL context is lost) or picks it back up
 * @param  {[boolean]} paused
 */
export function pauseScreen(paused) {
	if (!screen) { return; }
	screen.paused = paused;
	clearTimeout(screen.timer);
	screen.timer = null;
	if (!paused) { draw(); }
}

/**
 * @description Stops the timer & lets go of the canvas. The texture & material are freed with the scene (three/index.js unmount)
 */
export function disposeScreen() {
	if (!screen) { return; }
	clearTimeout(screen.timer);
	cancelAnimationFrame(screen.raf);
	getView = null; // THE NEXT createScreen() NEVER ASKS A GONE MONITOR FOR ITS VIEW
	REDUCE.removeEventListener("change", redrawScreen);
	screen = null;
}
