// AUTO LEAN (TASK 20E, SEGMENT C2). pointer.js TELLS IT WHEN THE POINTER ENTERS OR LEAVES THE BOARD; THE CAMERA GLIDE IS BUILT HERE & IN camera.js.
// NO IMPORTS: THE MENU (THE PLAY BUNDLE) & THE 3D CHUNK SHARE THIS ONE MODULE, & THE TESTS LOAD IT WITHOUT three.js

export const LEAN_TILT = Math.PI / 6; // THE LEAN'S TILT FROM STRAIGHT DOWN (THE OPENING VIEW IS ABOUT 56 DEGREES)
export const LEAN_FIT = 1; // HOW MUCH OF THE SCREEN THE BOARD FILLS LEANED IN (1 IS EDGE TO EDGE, THE HAND NEED NOT STAY IN VIEW)
export const LEAN_BACK_MS = 400; // HOW LONG THE POINTER IS OFF THE BOARD BEFORE THE CAMERA GOES BACK

let enabled = false; // THE MENU'S OPTION, OFF UNTIL setAutoLean()
let camera = null; // { lean(), back() }, camera.js'S
let timer = null; // THE WAIT BEFORE THE WAY BACK
let over = false; // THE POINTER IS ON THE BOARD'S TILES (THE LAST boardHover)

// THE WAY BACK. camera.js'S back() ANSWERS false WHILE A PIECE IS DRAGGED: ASKED AGAIN EVERY LEAN_BACK_MS UNTIL IT'S DROPPED (OR THE POINTER IS BACK ON THE BOARD)
function goBack() {
	if (camera.back() === false) { timer = setTimeout(goBack, LEAN_BACK_MS); }
}

/**
 * @description camera.js hands over the two camera moves: lean() glides in (nothing when it may not or is already there), back() glides to where the player had the camera
 * @param {{ lean: () => void, back: () => void }} moves
 */
export function setLeanCamera(moves) { camera = moves; }

/**
 * @description The menu's Auto Lean option. Turning it on moves nothing until the pointer next goes onto the board, turning it off takes a leaned camera back at once
 * @param {boolean} on
 */
export function setAutoLean(on) {
	enabled = Boolean(on);
	clearTimeout(timer);
	if (!enabled && camera) { goBack(); }
}

/**
 * @description Told by pointer.js each time the pointer goes onto the board's tiles (true) or off them (false; also when it leaves the canvas).
 * @param {boolean} on - Whether the pointer is over a board tile
 */
export function boardHover(on) {
	clearTimeout(timer);
	over = Boolean(on);
	if (!enabled || !camera) { return; }
	if (on) { camera.lean(); }
	else { timer = setTimeout(goBack, LEAN_BACK_MS); }
}

/**
 * @description camera.js calls it when something that kept the camera from leaning ends (a Flip Board turn, the promotion cards, the monitor, Reset View, a framed pile):
 * with the pointer still on the board the lean is asked for again. After the camera code that called it has finished, & only then: never every frame, a camera the player moved stays theirs
 */
export function retryLean() {
	setTimeout(function () { if (enabled && camera && over) { camera.lean(); } }, 0);
}

/**
 * @description Where the camera leans to: LEAN_TILT from straight down, on the side of the board the player had it (home's angle around what it
 * looked at), aimed at the board's centre, at the closest distance where the whole board is inside LEAN_FIT of the screen (square on: its near edge fills the height, or the width on
 * a screen narrower than the board; from a diagonal it backs off for the near corner), kept inside the zoom limits
 * @param {{ home: { position: object, target: object }, fov: number, aspect: number, board: number, min: number, max: number }} view home: where the player had the camera ({ x, y, z } each), fov: degrees, top to bottom, board: its side in world units, min & max: the zoom limits
 * @returns {{ position: { x: number, y: number, z: number }, target: { x: number, y: number, z: number } }} world space
 */
export function leanSpot({ home, fov, aspect, board, min, max }) {
	const angle = Math.atan2(home.position.x - home.target.x, home.position.z - home.target.z);
	const half = board / 2, tan = Math.tan(fov * Math.PI / 360) * LEAN_FIT;
	const sin = Math.sin(LEAN_TILT), cos = Math.cos(LEAN_TILT), sa = Math.sin(angle), ca = Math.cos(angle);
	let fit = 0; // THE CLOSEST DISTANCE THAT KEEPS EVERY CORNER ON SCREEN, FROM ANY ANGLE AROUND THE BOARD (A DIAGONAL CAMERA HAS A CORNER NEAREST)
	for (const [x, z] of [[half, half], [half, -half], [-half, half], [-half, -half]]) {
		const toward = x * sa + z * ca, across = Math.abs(x * ca - z * sa); // THE CORNER'S OFFSET TOWARD THE CAMERA'S SIDE & ACROSS ITS VIEW
		fit = Math.max(fit, toward * sin + Math.abs(toward) * cos / tan, toward * sin + across / (tan * aspect)); // ITS DEPTH IS distance - toward * sin: INSIDE THE SCREEN'S HEIGHT, & ITS WIDTH
	}
	const distance = Math.min(Math.max(fit, min), max);
	return { position: { x: distance * sin * sa, y: distance * cos, z: distance * sin * ca }, target: { x: 0, y: 0, z: 0 } };
}
