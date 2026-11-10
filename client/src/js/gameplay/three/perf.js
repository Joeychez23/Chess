/*
 *  perf.js  --  chess frontend
 *	3D Perf Readout (#430)
 *	For testing on real phones: open the play page with ?perf=1 & a box in the bottom right shows how the 3D board is doing
 *	(the 3D chunk's download time, fps during the last move, lost WebGL contexts, the smallest square on screen, the GPU).
 *	Off without ?perf, then every call here does nothing. Only index.js uses it, so it's in the "three" chunk
 *
 */

import { Vector3 } from "three";

let perfOn = false; // THE PAGE OPENED WITH ?perf, FROM load.js (A NEW GAME'S URL DROPS IT BEFORE THIS CHUNK MAY LOAD)

const UPDATE_MS = 500; // HOW OFTEN THE BOX IS REDRAWN
const files = "abcdefgh";
const point = new Vector3();

let loadMs = null; // THE 3D CHUNK'S DOWNLOAD, null: ALREADY CACHED THIS PAGE LOAD
let lost = 0; // WEBGL CONTEXTS LOST THIS PAGE LOAD (A REBUILT BOARD KEEPS COUNTING)
let started = null; // WHEN THIS BOARD WENT UP
const frames = []; // THE LAST SECOND'S FRAME TIMES
let burst = []; // FRAME TIMES OF THE MOVE (OR CAMERA TURN) BEING DRAWN NOW
let lastMove = null; // { fps, worstMs } OF THE LAST ONE THAT ENDED
let calls = 0, triangles = 0; // THE LAST FRAME'S DRAW CALLS & TRIANGLES
let box = null;
let timer = null;
let board = null; // { renderer, camera, squareCorners } FROM perfStart()

/**
 * @description The 3D chunk's download time & whether the readout is on, from load.js
 * @param  {[number]} ms
 * @param  {[boolean]} on [the page opened with ?perf]
 */
export function perfLoaded(ms, on) {
	loadMs = Math.round(ms);
	perfOn = on;
}

/**
 * @description Shows the box for a board that just went up
 * @param  {[object]} b [{ renderer, camera, squareCorners: (square) => [Vector3 x4] }]
 */
export function perfStart(b) {
	if (!perfOn) { return; }
	board = b;
	started = performance.now();
	box = document.createElement("pre");
	box.id = "perf3D";
	document.body.appendChild(box);
	timer = setInterval(update, UPDATE_MS);
	update();
}

/**
 * @description Takes the box down with the board
 */
export function perfStop() {
	if (!box) { return; }
	clearInterval(timer);
	box.remove();
	box = board = null;
}

/**
 * @description One frame was drawn
 * @param  {[number]} now [the frame's time]
 */
export function perfFrame(now) {
	if (!box) { return; }
	frames.push(now);
	while (frames[0] < now - 1000) { frames.shift(); }
	calls = board.renderer.info.render.calls;
	triangles = board.renderer.info.render.triangles;
}

/**
 * @description Marks a frame of a move or camera turn, ending the move's count when moving is false after one
 * @param  {[number]} now [the frame's time]
 * @param  {[boolean]} moving
 */
export function perfMoving(now, moving) {
	if (!box) { return; }
	if (moving) { burst.push(now); return; }
	if (burst.length < 2) { burst = []; return; }
	let worst = 0;
	for (let i = 1; i < burst.length; i++) { worst = Math.max(worst, burst[i] - burst[i - 1]); }
	lastMove = { fps: Math.round((burst.length - 1) / (burst[burst.length - 1] - burst[0]) * 1000), worstMs: Math.round(worst) };
	burst = [];
}

/**
 * @description The WebGL context was lost
 */
export function perfLost() {
	lost++;
}

// THE SHORTEST SQUARE ON SCREEN, CSS PIXELS TALL, WHEREVER THE PLAYER PUT THE CAMERA (null: NONE ON SCREEN)
function smallestSquare() {
	const { camera, renderer } = board;
	const h = renderer.domElement.clientHeight;
	let smallest = Infinity;
	for (const file of files) {
		for (let rank = 1; rank <= 8; rank++) {
			const ys = board.squareCorners(file + rank).map((c) => point.copy(c).project(camera).y);
			smallest = Math.min(smallest, (Math.max(...ys) - Math.min(...ys)) / 2 * h);
		}
	}
	return Number.isFinite(smallest) ? Math.round(smallest) : null;
}

function gpu() {
	const gl = board.renderer.getContext();
	const info = gl.getExtension("WEBGL_debug_renderer_info");
	return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unknown";
}

function update() {
	if (!box) { return; }
	const up = Math.round((performance.now() - started) / 1000);
	box.textContent = [
		`3D chunk   ${loadMs === null ? "cached" : `${loadMs} ms`}`,
		`last move  ${lastMove ? `${lastMove.fps} fps, worst frame ${lastMove.worstMs} ms` : "-"}`,
		`now        ${frames.length} fps (idle draws 0)`,
		`draws      ${calls} calls, ${triangles} tris`,
		`square     ${smallestSquare() ?? "-"} px min`,
		`pixels     ${board.renderer.getPixelRatio()}x, ${board.renderer.domElement.width}x${board.renderer.domElement.height}`,
		`lost ctx   ${lost}`,
		`gpu        ${gpu()}`,
		`up         ${Math.floor(up / 60)}:${String(up % 60).padStart(2, "0")}`,
	].join("\n");
}
