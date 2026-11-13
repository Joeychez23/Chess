/*
 *  screen.js  --  chess frontend
 *	The CRT Monitor's Screen
 *	Draws what the monitor in the library room shows (three/room.js has the monitor) on one 2D canvas, used as the glass's texture: the view the
 *	monitor's state machine gives it (three/monitor/monitor.js, setMonitorView) through its channels (three/monitor/channels), with the tab row,
 *	buttons & banner when zoomed. Without one it shows what it always has: colour bars before a game has loaded, the opponent's name & a status
 *	line, the opponent's picture through a retro filter &, in AI games, a pixel face that reacts to the moves (three/faces.js has the faces).
 *	Everything is drawn on a 160 x 120 grid & scaled up 4 times, then scanlines, phosphor stripes & a vignette go over it. It only redraws when
 *	something changes: the face steps on a timer of its own, a channel that animates & the banner's blink on another, there's no animation loop
 *
 */

import { CanvasTexture, MeshBasicMaterial, SRGBColorSpace, NearestFilter, LinearMipmapLinearFilter } from "three";
import { FACES, cellsFor, nextStep, frameMs, mainFrame } from "./faces.js";
import { HEIGHT as FONT_HEIGHT, textWidth, fitText } from "./pixelFont.js";
import { W, H, SAFE, STRIP_H, TUBE, TEXT, DIM, HOT, drawText, drawButton, drawTab, body, tabRow } from "./monitor/kit.js";
import { CHANNEL } from "./monitor/channels/index.js";
import { litTab } from "./monitor/monitor.js";

const UP = 4; // HOW MANY TIMES THE SCREEN'S GRID (kit.js) IS SCALED UP FOR THE TEXTURE
const LEVELS = 6; // COLOUR STEPS PER CHANNEL AFTER THE DITHER
const DITHER = 0.7;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]; // 4 x 4 ORDERED DITHER
const BARS_MS = 700; // A NEW OPPONENT: THE TEST CARD THIS LONG...
const INTRO_MS = 3000; // ...THEN ITS PICTURE & NAME THIS LONG, THEN THE FACE
const BLINK_MS = 500; // THE BANNER: THIS LONG ON, THIS LONG OFF
const BURST_MS = 120; // A CHANNEL SWITCH: STATIC THIS LONG, THEN THE CHANNEL
const ASSETS_ORIGIN = originOf(process.env.CHESS_ASSETS_URL);
const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)");

let screen = null; // EVERYTHING ONE createScreen() MADE, null WHEN THERE'S NO MONITOR
const pictures = new Map(); // URL -> ITS FILTERED 160 x 120 CANVAS (OR null: IT FAILED), ONCE PER IMAGE
let getView = null; // THE MONITOR'S view() (setMonitorView), null: THE SCREEN SHOWS WHAT IT DID BEFORE THE MONITOR HAD CHANNELS

function originOf(url) {
	try { return new URL(url, window.location.href).origin; } catch (e) { return null; }
}

function makeCanvas(w, h) {
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	return canvas;
}

/* ---------------------------------------------------------------- */
// Retro Picture
/* ---------------------------------------------------------------- */

// THE CSP's img-src ONLY ALLOWS THE SITE, data: & THE ASSETS DOMAIN, ANYTHING ELSE WOULD FAIL ANYWAY
function allowed(url) {
	if (url.startsWith("data:image/")) { return true; }
	const origin = originOf(url);
	return origin !== null && (origin === window.location.origin || origin === ASSETS_ORIGIN);
}

/**
 * @description The picture's first steps, once per image: crop to 4:3 & shrink to the grid, lift the shadows, raise contrast & saturation,
 * dither down to a small palette & bleed red & blue sideways. The scale up, scanlines, stripes & vignette are the same for everything (overlay)
 * @param  {[HTMLImageElement]} image [loaded with CORS, so its pixels can be read]
 * @return {[HTMLCanvasElement]} [160 x 120]
 */
function retro(image) {
	const canvas = makeCanvas(W, H);
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	const cw = Math.min(image.naturalWidth, image.naturalHeight * 4 / 3), ch = cw * 3 / 4; // CENTRE CROP
	ctx.drawImage(image, (image.naturalWidth - cw) / 2, (image.naturalHeight - ch) / 2, cw, ch, 0, 0, W, H);
	const pixels = ctx.getImageData(0, 0, W, H);
	const d = pixels.data;
	const v = new Float32Array(W * H * 3);
	for (let i = 0; i < W * H; i++) {
		const rgb = [0, 1, 2].map((c) => Math.min(1, Math.max(0, ((d[i * 4 + c] / 255) ** 0.8 - 0.5) * 1.1 + 0.5))); // SHADOWS UP, CONTRAST
		const grey = (rgb[0] + rgb[1] + rgb[2]) / 3;
		const bayer = BAYER[(Math.floor(i / W) % 4) * 4 + (i % W) % 4] / 16 - 0.5;
		for (let c = 0; c < 3; c++) {
			const s = Math.min(1, Math.max(0, grey + (rgb[c] - grey) * 1.2)); // SATURATION
			v[i * 3 + c] = Math.min(1, Math.max(0, Math.round(s * (LEVELS - 1) + bayer * DITHER) / (LEVELS - 1)));
		}
	}
	for (let i = 0; i < W * H; i++) {
		const x = i % W;
		const r = x > 0 ? (v[(i - 1) * 3] + v[i * 3]) / 2 : v[i * 3]; // RED SMEARS RIGHT...
		const b = x < W - 1 ? (v[(i + 1) * 3 + 2] + v[i * 3 + 2]) / 2 : v[i * 3 + 2]; // ...BLUE LEFT
		d[i * 4] = 255 * Math.min(1, r * 1.18); // BRIGHTER: THE SCANLINES & STRIPES TAKE IT BACK
		d[i * 4 + 1] = 255 * Math.min(1, v[i * 3 + 1] * 1.18);
		d[i * 4 + 2] = 255 * Math.min(1, b * 1.18);
		d[i * 4 + 3] = 255;
	}
	ctx.putImageData(pixels, 0, 0);
	return canvas;
}

// STARTS LOADING url'S PICTURE (ONCE), THE SCREEN REDRAWS WHEN IT'S IN OR HAS FAILED
function loadPicture(url) {
	if (pictures.has(url)) { return; }
	pictures.set(url, undefined); // LOADING
	if (!allowed(url)) { pictures.set(url, null); return; }
	const image = new Image();
	image.crossOrigin = "anonymous"; // A CANVAS WITH A CROSS-ORIGIN IMAGE ON IT CAN'T BE READ OR USED AS A TEXTURE OTHERWISE
	image.onload = function () {
		try { pictures.set(url, retro(image)); } catch (e) { pictures.set(url, null); } // TAINTED (NO CORS HEADERS): TEXT ONLY
		draw();
	};
	image.onerror = function () {
		pictures.set(url, null);
		draw();
	};
	image.src = url;
}

/* ---------------------------------------------------------------- */
// Drawing
/* ---------------------------------------------------------------- */

// SCANLINES, PHOSPHOR STRIPES, A VIGNETTE & A SLIGHT GREEN TINT AS ONE LAYER MULTIPLIED OVER THE SCALED UP PICTURE. MADE ONCE
function makeOverlay() {
	const canvas = makeCanvas(W * UP, H * UP);
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = "rgb(247, 255, 250)"; // GREENISH PHOSPHOR
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.globalCompositeOperation = "multiply";
	const stripes = ["rgb(255, 224, 224)", "rgb(224, 255, 224)", "rgb(224, 224, 255)"]; // EVERY THIRD COLUMN FAVOURS RED, GREEN OR BLUE
	for (let x = 0; x < canvas.width; x++) {
		ctx.fillStyle = stripes[x % 3];
		ctx.fillRect(x, 0, 1, canvas.height);
	}
	ctx.fillStyle = "rgb(178, 178, 178)"; // THE BOTTOM ROW OF EACH SCALED UP PIXEL, DARKENED TO 0.7
	for (let y = UP - 1; y < canvas.height; y += UP) { ctx.fillRect(0, y, canvas.width, 1); }
	const vignette = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.25, canvas.width / 2, canvas.height / 2, canvas.width * 0.72);
	vignette.addColorStop(0, "rgb(255, 255, 255)");
	vignette.addColorStop(1, "rgb(120, 120, 120)");
	ctx.fillStyle = vignette;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	return canvas;
}

// THE NAME (LEFT) & STATUS (RIGHT) ON THEIR OWN STRIP CANVAS, PUT ON LAST SO NO SCANLINE CROSSES THE TEXT
function drawStrip() {
	const { strip, name, status } = screen;
	const ctx = strip.getContext("2d");
	ctx.clearRect(0, 0, W, STRIP_H);
	ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
	ctx.fillRect(0, 0, W, STRIP_H);
	ctx.fillStyle = DIM;
	ctx.fillRect(0, 0, W, 1);
	const y = Math.floor((STRIP_H - FONT_HEIGHT) / 2) + 1;
	const statusWidth = status ? textWidth(status) + 8 : 0;
	drawText(ctx, fitText(name, W - 8 - statusWidth), 4, y, TEXT);
	if (status) { drawText(ctx, status, W - 4, y, DIM, 1); }
}

// WHAT THE SCREEN SHOWS NOW: THE TEST CARD BEFORE A GAME (& AS A NEW OPPONENT COMES ON), THE FACE IN AN AI GAME ONCE ITS PICTURE HAS HAD ITS
// TIME, ELSE THE PICTURE, ELSE TEXT
function mode() {
	if (!screen.name || screen.booting) { return "bars"; }
	if (screen.ai && !screen.intro) { return "face"; }
	return screen.image && pictures.get(screen.image) ? "picture" : "text";
}

// THE VIEW TO DRAW: THE MONITOR'S ONCE IT HAS A GAME'S DATA, ELSE TODAY'S SCREEN (THE FACE WHEN IT SHOWS, ELSE THE OPPONENT'S CARD) ON THE DESK.
// ONE CALL PER DRAW: view() HANDS OUT ITS burst ONLY ONCE
function currentView() {
	const view = getView ? getView() : null;
	if (view && view.data && CHANNEL[view.channel]) { return view; }
	return { channel: mode() === "face" ? "face" : "opponent", zoomed: false, tabs: [], buttons: [], focus: null, hover: null, banner: null, burst: false, data: null };
}

// WHAT A VIEW DRAWS, TO TELL WHETHER redrawScreen() HAS ANYTHING NEW (THE PICTURE ISN'T IN IT, A LOADED ONE DRAWS BY ITSELF). burst IS LEFT
// OUT: IT'S TRUE ONCE, SO THE NEXT VIEW WOULD NEVER MATCH
function keyOf(view) {
	return JSON.stringify({ ...view, burst: false });
}

// WHERE THE POINTER IS ON THE DESK, { x, y } IN GRID PIXELS, OR null
function deskPointer(view) {
	const hover = view.hover;
	return !view.zoomed && hover && typeof hover === "object" && Number.isFinite(hover.x) ? hover : null;
}

// THE FACE'S CELLS & COLOUR NOW. ON THE DESK ITS EYES FOLLOW THE POINTER BY THIRDS OF THE GRID, UNLESS MOTION IS REDUCED
function faceNow(view) {
	const { name, index } = screen.face;
	let frame = screen.reduce ? mainFrame(name) : FACES[name].frames[index];
	const pointer = view.channel === "face" && !screen.reduce ? deskPointer(view) : null;
	if (pointer) { frame = { ...frame, look: pointer.x < W / 3 ? -1 : pointer.x >= W * 2 / 3 ? 1 : 0 }; }
	return { cells: cellsFor(frame), colour: FACES[name].colour };
}

// THE CHANNELS' DATA: THE MONITOR'S, WITH WHAT THE SCREEN KNOWS ADDED. THE FACE CHANNEL GETS THE PICTURE ONLY DURING THE AI'S INTRO
function channelData(view) {
	const showing = mode();
	const loaded = (screen.image && pictures.get(screen.image)) || null;
	const picture = showing === "bars" || (view.channel === "face" && !screen.intro) ? null : loaded; // NO PICTURE (& SO NO STRIP) OVER THE TEST CARD
	return {
		...(view.data || {}),
		screen: { name: screen.name, status: screen.status, picture, bars: showing === "bars", face: faceNow(view) },
		frame: screen.reduce ? 0 : screen.frame, reduce: screen.reduce, zoomed: view.zoomed,
	};
}

// ONE FRAME OF STATIC OVER THE BODY, AS A CHANNEL SWITCH CUTS IN
function drawStatic(ctx, zoomed) {
	const area = body({ zoomed });
	const pixels = ctx.createImageData(area.w, area.h);
	const d = pixels.data;
	for (let i = 0; i < d.length; i += 4) {
		const v = Math.floor(Math.random() * 200) + 20;
		d[i] = d[i + 1] = d[i + 2] = v;
		d[i + 3] = 255;
	}
	ctx.putImageData(pixels, area.x, area.y);
}

// THE ZOOMED SCREEN'S CHROME OVER THE CHANNEL: THE TAB ROW (THE SHOWING CHANNEL'S TAB LIT), THE CHANNEL'S BUTTONS (THE FOCUSED ONE LIT) & THE
// YOUR MOVE BANNER ON ITS OWN DARK PLATE IN THE BODY'S TOP RIGHT CORNER (IT COVERS WHAT IS UNDER IT CLEANLY), BLINKING UNLESS MOTION IS REDUCED
function drawChrome(ctx, view) {
	const row = tabRow(), area = body({ zoomed: true });
	ctx.fillStyle = TUBE;
	ctx.fillRect(0, 0, W, row.y + row.h); // EVERYTHING ABOVE THE BODY, UNDER THE BEZEL TOO
	ctx.fillStyle = DIM;
	ctx.fillRect(row.x, row.y + row.h - 1, row.w, 1); // A RULE UNDER THE TABS, IN PLACE OF THEIR BOXES
	const lit = litTab(view.tabs, view.focus, view.channel); // ONE TAB ONLY: THE FOCUSED ONE ON THE ROW, ELSE THE SHOWING CHANNEL'S
	view.tabs.forEach(function (tab, i) { // A TICK UP FROM THE RULE BETWEEN TABS, UNDER THE LETTERS, IN THE GAP'S MIDDLE, SO NEIGHBOURING LABELS DON'T RUN TOGETHER
		if (!i) { return; }
		const end = view.tabs[i - 1].x + view.tabs[i - 1].w;
		ctx.fillRect(end + Math.floor((tab.x - end - 1) / 2), row.y + row.h - 3, 1, 2);
	});
	for (const tab of view.tabs) { drawTab(ctx, tab, tab.id === lit); }
	for (const button of view.buttons) { drawButton(ctx, button, button.id === view.focus); }
	if (view.banner && view.channel !== "setup" && (screen.reduce || screen.blinkOn)) { drawBanner(ctx, fitText(view.banner, area.w - 4), area); } // NOT ON SETUP: THE PLATE WOULD COVER THE FACE ROW'S BUTTONS, "YOUR MOVE" IS STILL ANNOUNCED
}

// THE BANNER: A 1 px HOT OUTLINE ROUND A TUBE PLATE, 1 px OF PADDING, HOT TEXT, IN THE BODY'S TOP RIGHT CORNER
function drawBanner(ctx, text, area) {
	const w = textWidth(text) + 4, h = FONT_HEIGHT + 4;
	const x = area.x + area.w - w, y = area.y;
	ctx.fillStyle = HOT;
	ctx.fillRect(x, y, w, h);
	ctx.fillStyle = TUBE;
	ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
	drawText(ctx, text, x + 2, y + 2, HOT);
}

// A 1 px BORDER WHILE THE POINTER IS ON THE GLASS (THE FACE LOOKS AT IT INSTEAD), ROUND THE SAFE AREA: THE BEZEL HIDES THE GRID'S EDGE. IT STOPS
// ABOVE THE NAME STRIP WHEN THAT SHOWS
function drawHover(ctx, strip) {
	const x = SAFE.left, y = SAFE.top, w = W - SAFE.left - SAFE.right;
	const h = (strip ? H - STRIP_H : H - SAFE.bottom) - y;
	ctx.fillStyle = HOT;
	ctx.fillRect(x, y, w, 1);
	ctx.fillRect(x, y + h - 1, w, 1);
	ctx.fillRect(x, y + 1, 1, h - 2);
	ctx.fillRect(x + w - 1, y + 1, 1, h - 2);
}

/**
 * @description Redraws the screen's canvas from the view & the screen's state, asks the board for a frame & reschedules the tick
 * @param  {[object]} view [from currentView(), taken once per draw]
 */
function draw(view = currentView()) {
	if (!screen) { return; }
	const { small, canvas, strip, overlay } = screen;
	const sctx = small.getContext("2d");
	const ctx = canvas.getContext("2d");
	const channel = CHANNEL[view.channel];
	const data = channelData(view);
	const changed = view.channel !== screen.channel;
	if (changed) { // A NEW CHANNEL STARTS ITS ANIMATION OVER
		screen.channel = view.channel;
		screen.frame = 0;
		screen.frameAt = null;
		screen.blinkAt = null; // THE OLD CHANNEL'S BLINK DEADLINE ISN'T THIS ONE'S
		screen.blinkOn = true;
		data.frame = 0;
	}
	screen.lastKey = keyOf(view);
	if (view.burst) {
		clearTimeout(screen.burstTimer);
		screen.burstTimer = setTimeout(function () { if (screen) { screen.burstTimer = null; draw(); } }, BURST_MS);
	}
	const bursting = view.burst || screen.burstTimer !== null;
	const lit = view.channel === "face" && !data.screen.bars && !data.screen.picture; // THE FACE'S CELLS SHOW
	const named = !view.zoomed && !bursting && !data.screen.bars && (data.screen.picture || lit); // THE DESK'S FACE & OPPONENT CARD: THE NAME STRIP GOES ON AFTER THE SCANLINES
	sctx.fillStyle = TUBE;
	sctx.fillRect(0, 0, W, H);
	if (bursting) { drawStatic(sctx, view.zoomed); } // ANY DRAW INSIDE THE BURST'S 120 ms STAYS STATIC
	else { channel.draw(sctx, data); }
	if (view.zoomed) { drawChrome(sctx, view); }
	else if (view.channel !== "face" && deskPointer(view)) { drawHover(sctx, named); }
	ctx.globalCompositeOperation = "source-over";
	ctx.globalAlpha = 1;
	ctx.imageSmoothingEnabled = false; // CHUNKY PIXELS
	ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
	if (lit && !bursting && !view.zoomed) { // ZOOMED: THE TABS, BUTTONS & BANNER WOULD GLOW TOO. A SOFT GLOW: THE LIT PIXELS AGAIN, SMOOTHED & ADDED, SO THEY READ AS LIGHT ON A TUBE
		ctx.globalCompositeOperation = "lighter";
		ctx.imageSmoothingEnabled = true;
		ctx.globalAlpha = 0.35;
		for (const spread of [6, 14]) { ctx.drawImage(small, -spread, -spread, canvas.width + 2 * spread, canvas.height + 2 * spread); }
		ctx.globalAlpha = 1;
	}
	ctx.globalCompositeOperation = "multiply";
	ctx.drawImage(overlay, 0, 0);
	ctx.globalCompositeOperation = "lighter"; // THE BLACK LIFT
	ctx.fillStyle = "rgb(6, 7, 6)";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.globalCompositeOperation = "source-over";
	if (named) {
		ctx.imageSmoothingEnabled = false;
		ctx.drawImage(strip, 0, (H - STRIP_H) * UP, W * UP, STRIP_H * UP);
	}
	screen.texture.needsUpdate = true;
	screen.requestRender();
	screen.tickMs = bursting || typeof channel.tick !== "function" ? null : channel.tick(data);
	screen.blinking = Boolean(view.zoomed && view.banner && !screen.reduce);
	if (!screen.blinking) { screen.blinkOn = true; } // THE NEXT BANNER STARTS LIT
	scheduleTick();
	if (changed) { schedule(); } // THE FACE'S TIMER RUNS ONLY WHILE ITS CHANNEL SHOWS
}

/* ---------------------------------------------------------------- */
// Face Timer
/* ---------------------------------------------------------------- */

// ONE TIMER FOR THE FACE'S NEXT STEP. NOTHING WHILE THE TAB IS HIDDEN, THE CONTEXT IS LOST (pauseScreen) OR NO FACE SHOWS (NOT YET, OR ANOTHER CHANNEL).
// REDUCED MOTION: A REACTION HOLDS ITS MAIN FRAME FOR ITS WHOLE LENGTH THEN GIVES WAY, AN IDLE FACE JUST HOLDS
function schedule() {
	clearTimeout(screen.timer);
	screen.timer = null;
	if (screen.paused || mode() !== "face" || screen.channel !== "face") { return; }
	const face = FACES[screen.face.name];
	if (screen.reduce) {
		if (face.loop) { return; }
		screen.timer = setTimeout(step, face.frames.reduce((ms, frame) => ms + frameMs(frame), 0), face.frames.length - 1);
		return;
	}
	screen.timer = setTimeout(step, frameMs(face.frames[screen.face.index]), screen.face.index);
}

function step(index) {
	if (!screen) { return; }
	screen.face = nextStep(screen.face.name, index, screen.idle);
	draw();
	schedule();
}

function showFace(name) {
	screen.face = { name, index: 0 };
	draw();
	schedule();
}

// A NEW OPPONENT COMES ON: THE TEST CARD, THEN (AI GAMES) ITS PICTURE & NAME BEFORE THE FACE TAKES OVER
function boot() {
	clearTimeout(screen.bootTimer);
	screen.booting = true;
	screen.intro = screen.ai;
	draw();
	screen.bootTimer = setTimeout(function () {
		if (!screen) { return; }
		screen.booting = false;
		draw();
		if (!screen.ai) { return; }
		screen.bootTimer = setTimeout(function () {
			if (!screen) { return; }
			screen.intro = false;
			const face = FACES[screen.face.name];
			showFace(face.loop ? screen.face.name : face.then ?? screen.idle); // A RESULT THAT CAME MEANWHILE SHOWS ITS HELD FACE, A REACTION IS OLD NEWS
		}, INTRO_MS);
	}, BARS_MS);
}

/* ---------------------------------------------------------------- */
// Tick
/* ---------------------------------------------------------------- */

// THE OTHER TIMER: THE SHOWING CHANNEL'S NEXT FRAME (ITS tick() SAYS WHEN, null: IT STANDS STILL) & THE BANNER'S BLINK, WHICHEVER IS DUE FIRST.
// EACH KEEPS ITS OWN DEADLINE SO A DRAW IN BETWEEN DOESN'T PUT EITHER OFF. NOTHING WHILE PAUSED
function scheduleTick() {
	clearTimeout(screen.tickTimer);
	screen.tickTimer = null;
	if (screen.paused) {
		screen.frameAt = null;
		screen.blinkAt = null;
		return;
	}
	const now = performance.now();
	if (typeof screen.tickMs !== "number") { screen.frameAt = null; }
	else if (screen.frameAt === null) { screen.frameAt = now + screen.tickMs; }
	if (!screen.blinking) { screen.blinkAt = null; }
	else if (screen.blinkAt === null) { screen.blinkAt = now + BLINK_MS; }
	const due = [screen.frameAt, screen.blinkAt].filter((at) => at !== null);
	if (due.length) { screen.tickTimer = setTimeout(onTick, Math.max(0, Math.min(...due) - now)); }
}

function onTick() {
	if (!screen) { return; }
	screen.tickTimer = null;
	const now = performance.now();
	if (screen.frameAt !== null && now >= screen.frameAt) {
		screen.frame++;
		screen.frameAt = null;
	}
	if (screen.blinkAt !== null && now >= screen.blinkAt) {
		screen.blinkOn = !screen.blinkOn;
		screen.blinkAt = null;
	}
	draw(); // RESCHEDULES
}

function onReduce() {
	if (!screen) { return; }
	screen.reduce = REDUCE.matches;
	draw();
	schedule();
}

/* ---------------------------------------------------------------- */
// Screen
/* ---------------------------------------------------------------- */

/**
 * @description Puts the screen on the monitor's glass, showing the test card until setScreen() says what to show
 * @param  {[Mesh]} mesh [the monitor's glass (room.js), its UVs fill 0 - 1]
 * @param  {[function]} requestRender [asks the board for a frame, the scene only draws on demand]
 */
export function createScreen(mesh, requestRender) {
	disposeScreen();
	const canvas = makeCanvas(W * UP, H * UP);
	const texture = new CanvasTexture(canvas);
	texture.colorSpace = SRGBColorSpace;
	texture.flipY = false; // THE GLASS'S UVs ARE glTF's: THEY START AT THE IMAGE'S TOP
	texture.magFilter = NearestFilter; // CHUNKY UP CLOSE...
	texture.minFilter = LinearMipmapLinearFilter; // ...& MIPMAPS FAR AWAY: SCANLINES & STRIPES SHIMMER INTO MOIRE WITHOUT THEM
	mesh.material = new MeshBasicMaterial({ map: texture }); // UNLIT, IT GLOWS
	screen = {
		canvas, texture, requestRender, small: makeCanvas(W, H), strip: makeCanvas(W, STRIP_H), overlay: makeOverlay(),
		name: "", status: "", image: null, ai: false, idle: "neutral", face: { name: "neutral", index: 0 },
		booting: false, intro: false, timer: null, bootTimer: null, paused: false, reduce: REDUCE.matches,
		channel: null, frame: 0, frameAt: null, tickMs: null, tickTimer: null, blinkOn: true, blinkAt: null, blinking: false, burstTimer: null, lastKey: null,
	};
	REDUCE.addEventListener("change", onReduce);
	drawStrip();
	draw();
}

/**
 * @description What the monitor shows: the opponent & what they're doing. A new opponent comes on through the test card
 * @param  {[object]} state { name (the opponent's, "" before a game has loaded: the test card), status ("your move", ...), image (its picture's
 * URL or null), ai (an AI game: the face shows once the picture has had its time), thinking (the AI is picking its move: the idle face looks about) }
 */
export function setScreen({ name = "", status = "", image = null, ai = false, thinking = false }) {
	if (!screen) { return; }
	const fresh = name !== screen.name || ai !== screen.ai;
	const idle = thinking ? "thinking" : "neutral";
	Object.assign(screen, { name, status, image: image || null, ai });
	if (screen.image) { loadPicture(screen.image); }
	drawStrip();
	if (screen.idle !== idle) {
		screen.idle = idle;
		if (FACES[screen.face.name].loop && (screen.face.name === "neutral" || screen.face.name === "thinking")) { screen.face = { name: idle, index: 0 }; } // A REACTION PLAYS OUT FIRST, A RESULT'S FACE STAYS
	}
	if (fresh && name) { screen.face = { name: idle, index: 0 }; boot(); }
	else { draw(); }
	schedule();
}

/**
 * @description The monitor's face reacts (AI games). A newer face replaces the one playing at once
 * @param  {[string]} name [a face in faces.js: "happy", "sad", "angry", "won", "lost" or "neutral" (a new game)]
 */
export function setFace(name) {
	if (!screen || !FACES[name]) { return; }
	showFace(name === "neutral" ? screen.idle : name);
}

/**
 * @description Hands the screen the monitor's view() to draw from (monitor/monitor.js); null goes back to the screen on its own: the opponent & the face
 * @param  {[function|null]} view [returns { channel, zoomed, tabs, buttons, focus, hover, banner, burst, data }]
 */
export function setMonitorView(view) {
	getView = typeof view === "function" ? view : null;
	if (!screen) { return; }
	draw();
	schedule();
}

/**
 * @description The monitor's show(): redraws when its view changed since the last draw & reschedules the tick
 */
export function redrawScreen() {
	if (!screen) { return; }
	const view = currentView();
	if (!view.burst && keyOf(view) === screen.lastKey) { return; }
	draw(view);
}

/**
 * @description Stops the face's & the channel's timers (the tab is hidden, the WebGL context is lost) or picks them back up
 * @param  {[boolean]} paused
 */
export function pauseScreen(paused) {
	if (!screen) { return; }
	screen.paused = paused;
	if (!paused) { draw(); }
	else {
		clearTimeout(screen.burstTimer); // A BURST CUT OFF BY A PAUSE: THE CHANNEL SHOWS ON RESUME
		screen.burstTimer = null;
		scheduleTick(); // STOPS IT
	}
	schedule();
}

/**
 * @description Stops the timers & lets go of the canvas. The texture & material are freed with the scene (three/index.js unmount)
 */
export function disposeScreen() {
	if (!screen) { return; }
	clearTimeout(screen.timer);
	clearTimeout(screen.bootTimer);
	clearTimeout(screen.tickTimer);
	clearTimeout(screen.burstTimer);
	getView = null; // THE NEXT createScreen() NEVER ASKS A GONE MONITOR FOR ITS VIEW
	REDUCE.removeEventListener("change", onReduce);
	screen = null;
}
