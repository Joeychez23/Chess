/* ---- A Chess Cards game's opening camera (table UI doc, "Desk and camera changes"): the whole hand in view, the bottom of the screen on the desk halfway between the green's near edge & the desk's,
the board as big as that allows & clear of the lifted card's preview. No three.js, no DOM (client/test/openingCamera.test.js) ---- */

import { CARD_SIZE, CARD_Y } from "./cardLayout.js";
import { HAND_Z, DUEL_STACK } from "./tableLayout.js";
import { BOARD_SIZE, PIECE_TOP, FIT_NDC, DESK_Y, MIN_DISTANCE, MAX_TILT } from "./constants.js";

export const OPENING_TILT = 43 * Math.PI / 180; // FROM STRAIGHT DOWN (TODAY'S LIBRARY VIEW IS 56.5): THE USER'S PICKED VIEW IN THE BROWSER, 2026-11-25
const DESK_EDGE = 32; // THE DESK'S NEAR EDGE (tableLayout.js; build_library.py DESK y0 -32): THE VIEW'S BOTTOM NEVER PAST IT (RULING T23-8)
const BOTTOM_Z = 21.6; // THE SCREEN'S BOTTOM ON THE LEATHER EDGE, JUST PAST THE GREEN'S NEAR EDGE (21.2): THE USER'S PICKED VIEW, 2026-11-25 (WAS 26.6)
const CEILING = 96 - 4, WALL = 115 - 4; // THE CAMERA STAYS IN THE ROOM (RULING T23-10), 4 OFF ITS CEILING (build_library.py CEIL) & ITS SOUTH WALL (ROOM y0 -115, THE PLAYER'S SIDE: THE ROOM TURNS WITH IT)
const HAND_X = -DUEL_STACK.mine.x + CARD_SIZE.w / 2; // 20.55: A FULL ROW'S OUTER EDGES. 10 OR 12 CARDS OVERLAP INTO THE SAME WIDTH (tableLayout.js HAND_FIT)
const HAND_UP = 1.5; // A LIFTED HAND CARD'S HEIGHT ABOVE CARD_Y: cardTable.js PICK_LIFT (1.1) ON 12 CARDS' LAYERS
const HAND = [-HAND_X, HAND_X].flatMap((x) => [HAND_Z - CARD_SIZE.h / 2, HAND_Z + CARD_SIZE.h / 2].flatMap((z) => [CARD_Y, CARD_Y + HAND_UP].map((y) => [x, y, z])));
const BOARD = [-1, 1].flatMap((x) => [-1, 1].flatMap((z) => [0, PIECE_TOP].map((y) => [x * BOARD_SIZE / 2, y, z * BOARD_SIZE / 2]))); // ITS EDGE PIECES' TOPS TOO
const PREVIEW = { left: 16, max: 200, share: 0.3 }; // board3D.css .cardPreview: 16px FROM THE LEFT, min(200px, 30vw) WIDE, A CARD'S SHAPE, CENTRED UP & DOWN

/**
 * @description Where a Chess Cards game's camera opens: at tilt, the hand (10 or 12 cards) & the board with its pieces inside FIT_NDC, the board clear of the lifted card's preview, the camera
 * inside the room & the middle of the screen's bottom edge on the desk (rulings T23-8 & T23-10). Pinned: the bottom at z BOTTOM_Z, the closest distance that holds them. A narrow window, where
 * the pin would look past the board's far edge or leave the room, drops the pin (T23-7): the closest the board can be, looking as near the board as that allows. Panned sideways (the
 * target's x) only as far as the preview needs. With no tilt given: OPENING_TILT, or where no camera in the room holds the hand there (a portrait window), the first shallower tilt in 1 degree
 * steps up to MAX_TILT that does (T23-11). null when none does (T23-12: aspect about 0.41 or narrower at fov 45, about 0.63 at fov 30; camera.js keeps its normal view)
 * shortcut: the preview's size reads the canvas as the window (vw), true while the 3D board fills the page; pass the window's width if it ever doesn't
 * @param {{ fov: number, width: number, height: number, angle?: number, tilt?: number }} opts fov: vertical, degrees; width & height: the canvas in CSS pixels; angle: around the board from White's side (0, Black PI); tilt: from straight down, only that tilt
 * @returns {{ position: { x, y, z }, target: { x, y, z }, distance: number, tilt: number } | null} world space, the room turned with the player's side (room.js turnRoom)
 */
export function openingCamera({ fov, width, height, angle = 0, tilt }) {
	if (tilt === undefined) { // RULING T23-11: OPENING_TILT, ELSE THE FIRST SHALLOWER TILT THAT FITS (A STEEPER CAMERA SITS HIGHER & THE CEILING BINDS FIRST)
		for (let deg = Math.round(OPENING_TILT * 180 / Math.PI); deg * Math.PI / 180 <= MAX_TILT + 1e-9; deg++) {
			const a = openingCamera({ fov, width, height, angle, tilt: deg * Math.PI / 180 });
			if (a) { return a; }
		}
		return null;
	}
	const t = Math.tan(fov * Math.PI / 360), aspect = width / height, c = Math.cos(tilt), s = Math.sin(tilt);
	const pw = Math.min(PREVIEW.max, PREVIEW.share * width), right = -1 + 2 * (PREVIEW.left + pw) / width, band = pw * (CARD_SIZE.h / CARD_SIZE.w) / height;
	// WHITE'S SIDE: THE CAMERA IN THE PLANE x = tx, FORWARD (0, -c, -s), UP (0, s, -c), d BACK FROM THE TARGET (tx, 0, tz)
	function fits(d, tz) {
		const y = d * c, z = tz + d * s;
		let lo = -Infinity, hi = Infinity, ok = true, low = Infinity, high = -Infinity;
		const look = ([px, py, pz], board) => {
			const vy = py - y, vz = pz - z, depth = -c * vy - s * vz, ny = (s * vy - c * vz) / (depth * t), k = depth * t * aspect; // ndc x = (px - tx) / k
			if (depth <= 0 || Math.abs(ny) > FIT_NDC) { ok = false; }
			lo = Math.max(lo, px - FIT_NDC * k);
			hi = Math.min(hi, px + FIT_NDC * k);
			if (board) { low = Math.min(low, ny); high = Math.max(high, ny); }
			return k;
		};
		HAND.forEach((p) => look(p, false));
		const ks = BOARD.map((p) => look(p, true));
		if (low <= band && high >= -band) { BOARD.forEach(([px], i) => { hi = Math.min(hi, px - right * ks[i]); }); } // ACROSS THE PREVIEW'S HEIGHT: EVERY CORNER RIGHT OF IT (A SIDEWAYS PAN, x - tx GROWS)
		return ok && lo <= hi ? { tx: Math.min(Math.max(0, lo), hi), y, z, tz, d } : null;
	}
	// THE BOTTOM EDGE'S RAY (FORWARD - t UP) MEETS THE DESK (y_cam - DESK_Y) * shade BEFORE THE CAMERA'S z
	const shade = (s - t * c) / (c + t * s);
	const inRoom = (a) => a && a.y <= CEILING && a.z <= WALL;
	const aim = (d) => fits(d, BOTTOM_Z - d * s + (d * c - DESK_Y) * shade); // THE BOTTOM AT BOTTOM_Z FIXES THE TARGET'S z FOR A DISTANCE
	let near = MIN_DISTANCE, far = 400;
	for (let i = 0; i < 40; i++) { const mid = (near + far) / 2; if (aim(mid)) { far = mid; } else { near = mid; } } // THE CLOSEST THAT FITS, BY HALVING (camera.js closest)
	let a = aim(far);
	if (!(inRoom(a) && a.tz >= -BOARD_SIZE / 2)) { a = unpinned(); }
	if (!a) { return null; }
	const turn = (x, y, z) => ({ x: x * Math.cos(angle) + z * Math.sin(angle), y, z: -x * Math.sin(angle) + z * Math.cos(angle) }); // ROUND THE BOARD'S CENTRE AS Vector3.applyAxisAngle(UP, angle)
	return { position: turn(a.tx, a.y, a.z), target: turn(a.tx, 0, a.tz), distance: a.d, tilt };

	// RULING T23-7: THE PIN DROPPED. THE BOARD'S CENTRE AT DEPTH D, THE TARGET ANYWHERE THE ROOM & THE DESK'S EDGE ALLOW (y = (D - s tz) c UNDER THE CEILING, z = tz c^2 + D s OFF THE WALL),
	// THE SMALLEST D WITH A tz THAT HOLDS IT ALL (A STEP OF 1, THEN HALVED), THE tz NEAREST THE BOARD AT IT. null WHEN NO D IN THE ROOM DOES
	function unpinned() {
		const off = (tz) => Math.max(0, -BOARD_SIZE / 2 - tz, tz - BOARD_SIZE / 2); // HOW FAR THE TARGET IS PAST THE BOARD
		const at = (D, step) => {
			let best = null;
			for (let tz = (D - CEILING / c) / s; tz <= Math.min((WALL - D * s) / (c * c), ((DESK_EDGE - DESK_Y * shade) * (c + t * s) - D * t) / c); tz += step) { // THE BOTTOM, tz c / (c + t s) + (D t - DESK_Y (s - t c)) / (c + t s), INSIDE THE DESK'S EDGE
				const b = fits(D - s * tz, tz);
				if (b && (!best || off(tz) < off(best.tz))) { best = b; }
			}
			return best;
		};
		const top = c * CEILING + s * WALL; // THE FURTHEST THE BOARD'S CENTRE CAN BE FROM A CAMERA IN THE ROOM
		let lo = Math.max(MIN_DISTANCE, HAND_X / (FIT_NDC * t * aspect)), hi = lo; // NO NEARER: THE HAND'S OUTER CORNERS, NEARER THAN THE BOARD'S CENTRE, WOULD BE OFF THE SIDES
		while (hi <= top && !at(hi, 0.25)) { lo = hi; hi += 1; }
		if (hi > top) { return null; }
		for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (at(mid, 0.05)) { hi = mid; } else { lo = mid; } }
		return at(hi, 0.05) || at(hi, 0.25);
	}
}
