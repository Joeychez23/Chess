/* ---- A Chess Cards game's opening camera (table UI doc, "Desk and camera changes"): the whole hand in view, the bottom
of the screen on the desk halfway between the green's near edge and the desk's, the board as big as that allows and clear
of the lifted card's preview. No three.js, no DOM (client/test/openingCamera.test.js) ---- */

/* ---- How the search works
What it looks for: a camera pose at a given tilt from straight down that holds the hand's eight corners and the board's
eight corners (its edge pieces' tops too) inside FIT_NDC of the screen, keeps the board clear of the lifted card's
preview at the left, and stays inside the room. Of the poses that do, the closest one: the board as big as it can be.

What it tries, in order:
1. The pinned pose. The middle of the screen's bottom edge sits on the desk at z BOTTOM_Z, which fixes where the camera
   looks for any distance. The distance is found by halving between MIN_DISTANCE and 400, 40 times.
2. When no pinned pose fits, or it would leave the room or look past the board's far edge (a narrow window), the pin
   is dropped (unpinned below). The distance from the board's centre grows in steps of 1 until some target fits, then
   is halved 12 times; at each distance the target slides toward and away from the board, within the room and the
   desk's edge, and the one nearest the board wins.
3. With no tilt given: OPENING_TILT first, then each shallower tilt in 1 degree steps up to MAX_TILT. A steeper camera
   sits higher, so in a portrait window the ceiling stops it first.

When it stops: at the first tilt that has a pose. null when none up to MAX_TILT does; camera.js then keeps its normal
view. ---- */

import { CARD_SIZE, CARD_Y } from "./cardLayout.js";
import { HAND_Z, DUEL_STACK } from "./tableLayout.js";
import { BOARD_SIZE, PIECE_TOP, FIT_NDC, DESK_Y, MIN_DISTANCE, MAX_TILT } from "./constants.js";

// From straight down (the library's usual view is 56.5): the view the owner picked in the browser, 2026-11-25
export const OPENING_TILT = 43 * Math.PI / 180;
// The desk's near edge (tableLayout.js; build_library.py DESK y0 -32): the view's bottom never goes past it
const DESK_EDGE = 32;
// The screen's bottom on the leather edge, just past the green's near edge (21.2): the owner's picked view, 2026-11-25
// (was 26.6)
const BOTTOM_Z = 21.6;
// The camera stays in the room, 4 off its ceiling (build_library.py CEIL) and its south wall (the room's y0 -115, the
// player's side: the room turns with it)
const CEILING = 96 - 4;
const WALL = 115 - 4;
// 20.55: a full row's outer edges. 10 or 12 cards overlap into the same width (tableLayout.js HAND_FIT)
const HAND_X = -DUEL_STACK.mine.x + CARD_SIZE.w / 2;
// A lifted hand card's height above CARD_Y: cardTable.js PICK_LIFT (1.1) on 12 cards' layers
const HAND_UP = 1.5;
// The hand's eight corners: its left and right outer edges (x), each with the cards' near and far edges (z), each flat
// on the desk and lifted (y)
const HAND_CORNERS = [-HAND_X, HAND_X].flatMap((x) =>
	[HAND_Z - CARD_SIZE.h / 2, HAND_Z + CARD_SIZE.h / 2].flatMap((z) =>
		[CARD_Y, CARD_Y + HAND_UP].map((y) => [x, y, z])));
// The board's eight corners: left and right (x), each near and far (z), each on the board and at its edge pieces' tops (y)
const BOARD_CORNERS = [-1, 1].flatMap((x) =>
	[-1, 1].flatMap((z) =>
		[0, PIECE_TOP].map((y) => [x * BOARD_SIZE / 2, y, z * BOARD_SIZE / 2])));
// board3D.css .cardPreview: 16px from the left, min(200px, 30vw) wide, a card's shape, centred up and down
const PREVIEW = { left: 16, max: 200, share: 0.3 };

/**
 * @description Where a Chess Cards game's camera opens: at tilt, the hand (10 or 12 cards) and the board with its
 * pieces inside FIT_NDC, the board clear of the lifted card's preview, the camera inside the room and the middle of the
 * screen's bottom edge on the desk. Pinned: the bottom at z BOTTOM_Z, the closest distance that holds them. A narrow
 * window, where the pin would look past the board's far edge or leave the room, drops the pin: the closest the board
 * can be, looking as near the board as that allows. Panned sideways (the target's x) only as far as the preview needs.
 * With no tilt given: OPENING_TILT, or where no camera in the room holds the hand there (a portrait window), the first
 * shallower tilt in 1 degree steps up to MAX_TILT that does. null when none does (aspect about 0.41 or narrower at
 * fov 45, about 0.63 at fov 30; camera.js keeps its normal view)
 * shortcut: the preview's size reads the canvas as the window (vw), true while the 3D board fills the page; pass the
 * window's width if it ever doesn't
 * @param {{ fov: number, width: number, height: number, angle?: number, tilt?: number }} opts fov: vertical, degrees;
 * width & height: the canvas in CSS pixels; angle: around the board from White's side (0, Black PI); tilt: from
 * straight down, only that tilt
 * @returns {{ position: { x, y, z }, target: { x, y, z }, distance: number, tilt: number } | null} world space, the room
 * turned with the player's side (room.js turnRoom)
 */
export function openingCamera({ fov, width, height, angle = 0, tilt }) {
	// OPENING_TILT, else the first shallower tilt that fits (a steeper camera sits higher and the ceiling binds first)
	if (tilt === undefined) {
		for (let deg = Math.round(OPENING_TILT * 180 / Math.PI); deg * Math.PI / 180 <= MAX_TILT + 1e-9; deg++) {
			const pose = openingCamera({ fov, width, height, angle, tilt: deg * Math.PI / 180 });
			if (pose) { return pose; }
		}
		return null;
	}
	// t: the tangent of half the vertical fov; c and s: the tilt's cosine and sine
	const t = Math.tan(fov * Math.PI / 360);
	const aspect = width / height;
	const c = Math.cos(tilt);
	const s = Math.sin(tilt);
	// The preview's width in pixels, its right edge in screen units (-1 to 1) and its half height in the same units
	const pw = Math.min(PREVIEW.max, PREVIEW.share * width);
	const right = -1 + 2 * (PREVIEW.left + pw) / width;
	const band = pw * (CARD_SIZE.h / CARD_SIZE.w) / height;
	// White's side: the camera in the plane x = tx, forward (0, -c, -s), up (0, s, -c), d back from the target (tx, 0, tz)
	function fits(d, tz) {
		const y = d * c;
		const z = tz + d * s;
		let lo = -Infinity;
		let hi = Infinity;
		let ok = true;
		let low = Infinity;
		let high = -Infinity;
		function look([px, py, pz], board) {
			const vy = py - y;
			const vz = pz - z;
			const depth = -c * vy - s * vz;
			const ny = (s * vy - c * vz) / (depth * t);
			const k = depth * t * aspect; // ndc x = (px - tx) / k
			if (depth <= 0 || Math.abs(ny) > FIT_NDC) { ok = false; }
			lo = Math.max(lo, px - FIT_NDC * k);
			hi = Math.min(hi, px + FIT_NDC * k);
			if (board) {
				low = Math.min(low, ny);
				high = Math.max(high, ny);
			}
			return k;
		}
		HAND_CORNERS.forEach((p) => look(p, false));
		const ks = BOARD_CORNERS.map((p) => look(p, true));
		// Across the preview's height: every corner right of it (a sideways pan, x - tx grows)
		if (low <= band && high >= -band) {
			BOARD_CORNERS.forEach(([px], i) => { hi = Math.min(hi, px - right * ks[i]); });
		}
		return ok && lo <= hi ? { tx: Math.min(Math.max(0, lo), hi), y, z, tz, d } : null;
	}
	// The bottom edge's ray (forward - t up) meets the desk (y_cam - DESK_Y) * shade before the camera's z
	const shade = (s - t * c) / (c + t * s);
	function inRoom(pose) {
		return pose && pose.y <= CEILING && pose.z <= WALL;
	}
	// The bottom at BOTTOM_Z fixes the target's z for a distance
	function aim(d) {
		return fits(d, BOTTOM_Z - d * s + (d * c - DESK_Y) * shade);
	}
	// The closest that fits, by halving (camera.js closest)
	let near = MIN_DISTANCE;
	let far = 400;
	for (let i = 0; i < 40; i++) {
		const mid = (near + far) / 2;
		if (aim(mid)) { far = mid; } else { near = mid; }
	}
	let pose = aim(far);
	if (!(inRoom(pose) && pose.tz >= -BOARD_SIZE / 2)) { pose = unpinned(); }
	if (!pose) { return null; }
	// Round the board's centre, as Vector3.applyAxisAngle(UP, angle)
	function turn(x, y, z) {
		return { x: x * Math.cos(angle) + z * Math.sin(angle), y, z: -x * Math.sin(angle) + z * Math.cos(angle) };
	}
	return { position: turn(pose.tx, pose.y, pose.z), target: turn(pose.tx, 0, pose.tz), distance: pose.d, tilt };

	// The pin dropped. The board's centre at depth D, the target anywhere the room and the desk's edge allow
	// (y = (D - s tz) c under the ceiling, z = tz c^2 + D s off the wall), the smallest D with a tz that holds it all
	// (a step of 1, then halved), the tz nearest the board at it. null when no D in the room does
	function unpinned() {
		// How far the target is past the board
		function off(tz) {
			return Math.max(0, -BOARD_SIZE / 2 - tz, tz - BOARD_SIZE / 2);
		}
		function at(D, step) {
			let best = null;
			// The bottom, tz c / (c + t s) + (D t - DESK_Y (s - t c)) / (c + t s), inside the desk's edge
			for (let tz = (D - CEILING / c) / s;
				tz <= Math.min((WALL - D * s) / (c * c), ((DESK_EDGE - DESK_Y * shade) * (c + t * s) - D * t) / c);
				tz += step) {
				const fit = fits(D - s * tz, tz);
				if (fit && (!best || off(tz) < off(best.tz))) { best = fit; }
			}
			return best;
		}
		// The furthest the board's centre can be from a camera in the room
		const top = c * CEILING + s * WALL;
		// No nearer: the hand's outer corners, nearer than the board's centre, would be off the sides
		let lo = Math.max(MIN_DISTANCE, HAND_X / (FIT_NDC * t * aspect));
		let hi = lo;
		while (hi <= top && !at(hi, 0.25)) {
			lo = hi;
			hi += 1;
		}
		if (hi > top) { return null; }
		for (let i = 0; i < 12; i++) {
			const mid = (lo + hi) / 2;
			if (at(mid, 0.05)) { hi = mid; } else { lo = mid; }
		}
		return at(hi, 0.05) || at(hi, 0.25);
	}
}
