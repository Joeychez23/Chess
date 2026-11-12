/*
 *  screen.js  --  chess frontend
 *	The CRT Monitor's Screen
 *	Draws what the monitor in the library room shows (three/room.js has the monitor) on one 2D canvas, used as the glass's texture: colour bars
 *	before a game has loaded, the opponent's name & a status line, the opponent's picture through a retro filter &, in AI games, a pixel face
 *	that reacts to the moves (three/faces.js has the faces). Everything is drawn on a 160 x 120 grid & scaled up 4 times, then scanlines,
 *	phosphor stripes & a vignette go over it. It only redraws when something changes: the face steps on a timer of its own, there's no animation loop
 *
 */

import { CanvasTexture, MeshBasicMaterial, SRGBColorSpace, NearestFilter, LinearMipmapLinearFilter } from "three";
import { FACES, cellsFor, nextStep, frameMs, mainFrame } from "./faces.js";
import { HEIGHT as FONT_HEIGHT, textWidth, textCells, fitText } from "./pixelFont.js";

const W = 160, H = 120, UP = 4; // THE SCREEN'S GRID & HOW MANY TIMES IT'S SCALED UP FOR THE TEXTURE
const FACE_PX = 4; // ONE FACE PIXEL ON THE GRID
const STRIP_H = 24; // THE NAME & STATUS STRIP ALONG THE BOTTOM, IN GRID PIXELS
const TUBE = "#050806"; // AN UNLIT TUBE, NEVER PURE BLACK
const TEXT = "#d8f0e0";
const DIM = "#7fa890";
const BARS = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"]; // THE IDLE TEST CARD
const LEVELS = 6; // COLOUR STEPS PER CHANNEL AFTER THE DITHER
const DITHER = 0.7;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]; // 4 x 4 ORDERED DITHER
const BARS_MS = 700; // A NEW OPPONENT: THE TEST CARD THIS LONG...
const INTRO_MS = 3000; // ...THEN ITS PICTURE & NAME THIS LONG, THEN THE FACE
const ASSETS_ORIGIN = originOf(process.env.CHESS_ASSETS_URL);
const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)");

let screen = null; // EVERYTHING ONE createScreen() MADE, null WHEN THERE'S NO MONITOR
const pictures = new Map(); // URL -> ITS FILTERED 160 x 120 CANVAS (OR null: IT FAILED), ONCE PER IMAGE

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

function fillCells(ctx, cells, x, y, size, color) {
	ctx.fillStyle = color;
	for (const [cx, cy] of cells) { ctx.fillRect(x + cx * size, y + cy * size, size, size); }
}

// A LINE OF PIXEL TEXT, align -1 FROM x RIGHTWARD, 0 CENTERED ON x, 1 ENDING AT x
function drawText(ctx, text, x, y, color, align = -1, size = 1) {
	const width = textWidth(text) * size;
	fillCells(ctx, textCells(text), Math.round(align < 0 ? x : align > 0 ? x - width : x - width / 2), y, size, color);
}

function drawBars(ctx) {
	const bw = W / BARS.length;
	BARS.forEach(function (color, i) {
		ctx.fillStyle = color;
		ctx.fillRect(Math.round(i * bw), 0, Math.ceil(bw), 80);
		ctx.fillStyle = BARS[BARS.length - 1 - i]; // THE NARROW BAND UNDER THEM, THE COLOURS THE OTHER WAY ROUND
		ctx.fillRect(Math.round(i * bw), 80, Math.ceil(bw), 10);
	});
	["#101010", "#f0f0f0", "#202060", "#101010", "#303030"].forEach(function (color, i) {
		ctx.fillStyle = color;
		ctx.fillRect(i * W / 5, 90, W / 5, H - 90);
	});
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

/**
 * @description Redraws the screen's canvas from its state & asks the board for a frame
 */
function draw() {
	if (!screen) { return; }
	const { small, canvas, strip, overlay } = screen;
	const sctx = small.getContext("2d");
	const ctx = canvas.getContext("2d");
	const showing = mode();
	sctx.fillStyle = TUBE;
	sctx.fillRect(0, 0, W, H);
	if (showing === "bars") { drawBars(sctx); }
	else if (showing === "picture") { sctx.drawImage(pictures.get(screen.image), 0, 0); }
	else if (showing === "face") {
		const frame = screen.reduce ? mainFrame(screen.face.name) : FACES[screen.face.name].frames[screen.face.index];
		fillCells(sctx, cellsFor(frame), 0, 0, FACE_PX, FACES[screen.face.name].colour);
	} else {
		const big = textWidth(screen.name) * 2 <= W - 12; // THE NAME, DOUBLE SIZE WHEN IT FITS
		drawText(sctx, big ? screen.name : fitText(screen.name, W - 12), W / 2, big ? 34 : 40, TEXT, 0, big ? 2 : 1);
		if (screen.status) { drawText(sctx, screen.status, W / 2, 62, DIM, 0); }
	}
	ctx.globalCompositeOperation = "source-over";
	ctx.globalAlpha = 1;
	ctx.imageSmoothingEnabled = false; // CHUNKY PIXELS
	ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
	if (showing === "face") { // A SOFT GLOW: THE LIT PIXELS AGAIN, SMOOTHED & ADDED, SO THEY READ AS LIGHT ON A TUBE
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
	if (showing === "picture" || showing === "face") {
		ctx.imageSmoothingEnabled = false;
		ctx.drawImage(strip, 0, (H - STRIP_H) * UP, W * UP, STRIP_H * UP);
	}
	screen.texture.needsUpdate = true;
	screen.requestRender();
}

/* ---------------------------------------------------------------- */
// Face Timer
/* ---------------------------------------------------------------- */

// ONE TIMER FOR THE FACE'S NEXT STEP. NOTHING WHILE THE TAB IS HIDDEN, THE CONTEXT IS LOST (pauseScreen) OR NO FACE SHOWS.
// REDUCED MOTION: A REACTION HOLDS ITS MAIN FRAME FOR ITS WHOLE LENGTH THEN GIVES WAY, AN IDLE FACE JUST HOLDS
function schedule() {
	clearTimeout(screen.timer);
	screen.timer = null;
	if (screen.paused || mode() !== "face") { return; }
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
 * @description Stops the face's timer (the tab is hidden, the WebGL context is lost) or picks it back up
 * @param  {[boolean]} paused
 */
export function pauseScreen(paused) {
	if (!screen) { return; }
	screen.paused = paused;
	if (!paused) { draw(); }
	schedule();
}

/**
 * @description Stops the timers & lets go of the canvas. The texture & material are freed with the scene (three/index.js unmount)
 */
export function disposeScreen() {
	if (!screen) { return; }
	clearTimeout(screen.timer);
	clearTimeout(screen.bootTimer);
	REDUCE.removeEventListener("change", onReduce);
	screen = null;
}
