// Owns 3D board camera and framing behavior
import {
	view, requestRender, fitCamera, spherical, corner, dealShift, UP, offset, setLabels, glassCentre, glassSize, glassScale,
	glassNormal, relayPlaques
} from "./index.js";
import { monitorIdle } from "./pointer.js";
import { CARD_Y } from "./cardLayout.js";
import {
	PHONE_PIXEL_RATIO, SMALL_SCREEN, SMALL_FOV, FOV, MAX_TILT, MIN_DISTANCE, MAX_DISTANCE, SMALL_TILTS, FIT_NDC, PIECE_TOP,
	TAP_PX, BOARD_SIZE, CELL_SIZE, COLUMN_X, COLUMN_Z, DEAL_SHIFT, DEAL_NEAR, ZOOM_MS, NEAR, CAMERA_DISTANCE, CAMERA_HEIGHT,
	DESK_Y, ROOM_CAMERA_AIM, ROOM_CAMERA_DISTANCE, ROOM_CAMERA_HEIGHT, FLIP_MS, GLASS_CLEAR, REDUCE
} from "./constants.js";
import { MathUtils } from "three";
import { easeInOut } from "../animate/timing.js";
import { turnRoom } from "./room.js";
import { zoomDistance } from "./monitor/monitor.js";
import { setLeanCamera, leanSpot, retryLean } from "./lean.js";
import { openingCamera } from "./openingCamera.js";

/* ---------------------------------------------------------------- */
// Mount
/* ---------------------------------------------------------------- */

// A Chess Cards game's opening spot is solved this long after a window drag's last resize (up to 20 ms a solve: not
// every frame)
export const CARD_SETTLE_MS = 100;
// The pixel density cap off a phone (a phone's is PHONE_PIXEL_RATIO), so 3x screens don't draw 9x the pixels
const MAX_PIXEL_RATIO = 2;

// Matches the drawing buffer and camera to the container (inside its safe area padding, css/board3D.css #board3D),
// pixel density capped so 3x phones don't draw 9x the pixels. A small screen also gets its camera limits for the new
// size
export function resize(settled) {
	const { renderer, camera, container, controls } = view;
	const style = getComputedStyle(container);
	const w = container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
	const h = container.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
	if (!(w > 0 && h > 0)) { return; } // Hidden: keep the last size
	unframeDeal(false); // A deal is framed again below, for the new size: from its home as the new limits leave it
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, view.phone ? PHONE_PIXEL_RATIO : MAX_PIXEL_RATIO));
	renderer.setSize(w, h, false); // CSS sizes the canvas
	camera.aspect = w / h;
	camera.fov = SMALL_SCREEN.matches ? SMALL_FOV : FOV;
	camera.updateProjectionMatrix();
	// A new size: the plaques are laid again once the camera has settled (index.js relayPlaques)
	view.relayDue = view.relayDue || !(view.size && view.size.w === w && view.size.h === h);
	view.size = { w, h };
	view.small = SMALL_SCREEN.matches ? smallScreenCamera(h) : null;
	clearTimeout(view.cardSettle);
	const settling = settled !== true && view.table && view.cardSpotFor === view.table;
	// Mid-drag (settled: the ResizeObserver's entries): the last size's spot
	if (settling) { view.cardSettle = setTimeout(() => resize(true), CARD_SETTLE_MS); }
	else {
		view.cardSpot = cardHome(0);
		view.cardSpotFor = view.table;
	}
	const card = view.cardSpot; // A Chess Cards game: the limits also allow its opening spot for this size
	// No tilting or zooming out to where a square is under TAP_PX
	controls.maxPolarAngle = Math.max(view.small ? view.small.tilt : MAX_TILT, card ? card.tilt : 0);
	controls.maxDistance = Math.max(view.small ? Math.max(view.small.distance, MIN_DISTANCE) : MAX_DISTANCE, card ? card.distance : 0);
	// A narrow window's hand view looks past the board
	view.targetRadius = Math.max(BOARD_SIZE / 2, card ? Math.hypot(card.target.x, card.target.z) : 0);
	controls.maxTargetRadius = view.targetRadius;
	if (monitorIdle()) { controls.update(); } // A camera past the new limits (the phone was turned) moves inside them
	else { refitZoom(); } // At the monitor: the glass fills the new shape (the desk spot is clamped when it gets back, landHome)
	reframe();
	requestRender();
	if (!settling) { relayPlaques(); } // Not mid-drag: the camera is where the new limits leave it
}

/**
 * @description The small screen camera: the most tilted of SMALL_TILTS whose squares are TAP_PX tall at the distance
 * picked, or the steepest when none are (the biggest squares the screen allows: a phone on its side is about 8 squares
 * tall). The distance is the closest with room around the board & its pieces, or closer to make TAP_PX (edge pieces'
 * tops may go off screen), but never so close a square is off screen
 * @param  {[number]} h [the canvas's height in CSS pixels, view.camera has its new aspect & fov]
 * @return {[object]} { tilt, distance } [from straight down, from the center]
 */
function smallScreenCamera(h) {
	fitCamera.copy(view.camera);
	let fit;
	for (const tilt of SMALL_TILTS) {
		const squares = closest(tilt, () => cornersOnScreen(0, 1));
		const roomy = closest(tilt, () => cornersOnScreen(0, FIT_NDC) && cornersOnScreen(PIECE_TOP, 1));
		const tap = closest(tilt, () => smallestSquarePx(h) < TAP_PX); // Farther than this is under TAP_PX
		fit = { tilt, distance: Math.max(squares, Math.min(roomy, tap)) };
		aimFitCamera(tilt, fit.distance);
		if (smallestSquarePx(h) >= TAP_PX - 0.5) { break; } // TAP_PX, with half a pixel of slack
	}
	return fit;
}

// Puts fitCamera at tilt and distance from White's side (the board looks the same from Black's)
function aimFitCamera(tilt, distance) {
	fitCamera.position.setFromSpherical(spherical.set(distance, tilt, 0));
	fitCamera.lookAt(0, 0, 0);
	fitCamera.updateMatrixWorld();
}

// The closest distance at tilt where ok() is true (it must be true far away and false up close), found by halving 30
// times between 1 and 400
function closest(tilt, ok) {
	let near = 1;
	let far = 400;
	for (let i = 0; i < 30; i++) {
		const mid = (near + far) / 2;
		aimFitCamera(tilt, mid);
		if (ok()) { far = mid; } else { near = mid; }
	}
	return far;
}

// The board's 4 corners, y up, are inside ndc of fitCamera's screen (1 is its edge)
function cornersOnScreen(y, ndc) {
	return [-1, 1].every((x) => [-1, 1].every(function (z) {
		corner.set(x * BOARD_SIZE / 2, y, z * BOARD_SIZE / 2).project(fitCamera);
		return Math.abs(corner.x) <= ndc && Math.abs(corner.y) <= ndc;
	}));
}

// How tall the far row's squares are on fitCamera's screen in CSS pixels (the smallest: the tilt squashes the far side
// most)
function smallestSquarePx(h) {
	const back = corner.set(0, 0, -BOARD_SIZE / 2).project(fitCamera).y;
	const front = corner.set(0, 0, -BOARD_SIZE / 2 + CELL_SIZE).project(fitCamera).y;
	return Math.abs(back - front) / 2 * h;
}

/* ---------------------------------------------------------------- */
// Deal Framing
/* ---------------------------------------------------------------- */

// The promotion cards are out
function dealing() {
	return Boolean(view.cards && view.cards.dealt());
}

// The card column's 4 corners, through the room's turn, are in front of camera and inside FIT_NDC of its screen
function columnInside(camera) {
	view.room.updateMatrixWorld();
	return COLUMN_X.every((x) => COLUMN_Z.every(function (z) {
		corner.set(x, CARD_Y, z).applyMatrix4(view.room.matrixWorld).project(camera);
		return corner.z < 1 && Math.abs(corner.x) <= FIT_NDC && Math.abs(corner.y) <= FIT_NDC; // z past 1 is behind the camera
	}));
}

// The whole card column is on the player's screen
function columnOnScreen() {
	view.camera.updateMatrixWorld();
	return columnInside(view.camera);
}

/**
 * @description Where the camera frames a deal from home: looking DEAL_SHIFT toward the column (in the room's turn),
 * from the closest point along home's view direction where the board's & the column's corners are all inside FIT_NDC
 * (closest()'s halving, on fitCamera)
 * @param  {[object]} home { position, target } [where the camera was before the deal]
 * @return {[object]} { position, target, near, distance } [world space, near: the camera's near plane there, distance:
 * from the target, what controls.maxDistance must allow]
 */
function framedSpot(home) {
	view.room.updateMatrixWorld();
	const target = dealShift.set(1, 0, 0).transformDirection(view.room.matrixWorld).multiplyScalar(DEAL_SHIFT).add(home.target).clone();
	const along = home.position.clone().sub(home.target).normalize();
	fitCamera.copy(view.camera);
	let near = 1;
	let far = 400;
	for (let i = 0; i < 30; i++) {
		const mid = (near + far) / 2;
		fitCamera.position.copy(target).addScaledVector(along, mid);
		fitCamera.lookAt(target);
		fitCamera.updateMatrixWorld();
		if (cornersOnScreen(0, FIT_NDC) && columnInside(fitCamera)) { far = mid; } else { near = mid; }
	}
	return { position: target.clone().addScaledVector(along, far), target, near: DEAL_NEAR, distance: far };
}

// Moves the camera, what it looks at and its near plane to `to` { position, target, near } over ZOOM_MS, slow start
// and landing, or at once. done() runs as it lands. view.dealEase is the move running: a newer one takes over from
// wherever it is, its update(1) lands it (landDealEase)
function moveDealCamera(to, animate, done) {
	const { camera, controls } = view;
	const fromPosition = camera.position.clone();
	const fromTarget = controls.target.clone();
	const fromNear = camera.near;
	const ease = {
		duration: ZOOM_MS,
		update(k) {
			if (view.dealEase !== ease) { return; } // A newer move took over
			// The player took the camera mid lean (a drag, or a wheel: leanMoved without cameraGesture): it stays where
			// they put it
			if (to.lean && k < 1 && (view.cameraGesture || view.leanMoved)) {
				view.dealEase = null;
				view.leanHome = null;
				return;
			}
			// Exactly there, not a rounding error off it: the way back lands where the player had it
			if (k === 1) {
				camera.position.copy(to.position);
				controls.target.copy(to.target);
				setNear(to.near);
			} else {
				camera.position.lerpVectors(fromPosition, to.position, k);
				controls.target.lerpVectors(fromTarget, to.target, k);
				setNear(fromNear + (to.near - fromNear) * k);
			}
			camera.lookAt(controls.target);
			if (k === 1) {
				view.dealEase = null;
				done();
			}
		}
	};
	view.dealEase = ease;
	if (animate) { view.animations.add(ease); } else { ease.update(1); }
	requestRender();
}

// A deal's camera move in progress lands at once
export function landDealEase() {
	if (view.dealEase) { view.dealEase.update(1); }
}

// Moves the camera to frame the deal from view.dealHome, its zoom limit raised so it can stay there
function aimDeal(animate) {
	const spot = view.pileBox ? pileSpot(view.dealHome, view.pileBox) : framedSpot(view.dealHome);
	view.controls.maxDistance = Math.max(view.dealHome.maxDistance, spot.distance);
	moveDealCamera(spot, animate, () => {});
}

/**
 * @description Frames a deal: when the card column isn't on screen (a phone's camera is fitted to the board) the camera
 * eases back & over until the board & the column both are, remembering where it was (view.dealHome). Nothing at the
 * monitor or with the column already on screen. A deal while the camera is still going back from the last one turns it
 * round to the frame, with the same home
 * @param  {[boolean]} animate [false cuts there (reduce motion)]
 */
export function frameDeal(animate) {
	if (!view.room || !monitorIdle()) { return; }
	const home = view.dealHome;
	if (home && !home.back && !view.pileBox) { return; } // Already framed, or on its way
	// An opened pile had the frame: it closes, the deal is framed from the same home
	if (view.pileBox) {
		view.pileBox = null;
		view.controls.maxTargetRadius = view.targetRadius;
		view.table.togglePile(null);
	}
	landTurn(); // Flip Board would take the camera elsewhere: the frame is worked out from where its turn ends
	if (home) { home.back = false; }
	else {
		const lean = takeLean(); // Leaned in (Auto Lean): the deal is framed from where the player had the camera, not the lean
		if (lean ? columnFrom(lean) : columnOnScreen()) {
			// The cards are in view from there: just back
			if (lean) { moveDealCamera({ position: lean.position, target: lean.target, near: NEAR }, animate, () => {}); }
			return;
		}
		const { camera, controls } = view;
		view.dealHome = {
			position: lean ? lean.position : camera.position.clone(),
			target: lean ? lean.target : controls.target.clone(),
			maxDistance: controls.maxDistance,
			back: false // back: on its way there (unframeDeal)
		};
	}
	aimDeal(animate);
}

/**
 * @description Ends a framed deal: the camera goes back exactly to where it was before it, & its zoom limit with it (an
 * orbit or zoom by hand while the cards were out is let go: the frame was the deal's). At the monitor it's where the
 * monitor hands the camera back to
 * @param  {[boolean]} animate [false cuts there]
 */
export function unframeDeal(animate) {
	const home = view.dealHome;
	if (!home) { // The promotion cards went back without a frame: Auto Lean may lean again
		retryLean();
		return;
	}
	const restore = function () {
		view.controls.maxDistance = home.maxDistance;
		view.controls.maxTargetRadius = view.targetRadius; // As resize set it: an opened pile's frame lifted it (framePile)
		view.dealHome = null;
		retryLean(); // The deal's or the opened pile's frame is over
	};
	if (!monitorIdle()) { // landHome() puts it there
		if (view.home) {
			view.home.position.copy(home.position);
			view.home.target.copy(home.target);
		}
		restore();
		return;
	}
	landTurn();
	home.back = true;
	moveDealCamera({ position: home.position, target: home.target, near: NEAR }, animate, restore);
}

/* ---------------------------------------------------------------- */
// Pile Framing
/* ---------------------------------------------------------------- */

/**
 * @description Where the camera reads an opened pile's column from (Chess Cards): looking at the column's middle from
 * the closest point along home's view direction where its 4 corners are inside FIT_NDC, never closer than the zoom limit
 * @param  {[object]} home { position, target } [where the camera was before the pile opened]
 * @param  {[object]} box { x0, x1, z0, z1 } [the column on the desk, room space (tableLayout.js columnBox)]
 * @return {[object]} { position, target, near, distance } [as framedSpot]
 */
function pileSpot(home, box) {
	view.room.updateMatrixWorld();
	const corners = [box.x0, box.x1].flatMap((x) =>
		[box.z0, box.z1].map((z) => corner.clone().set(x, DESK_Y, z).applyMatrix4(view.room.matrixWorld)));
	const target = corners[0].clone().add(corners[3]).multiplyScalar(0.5);
	const along = home.position.clone().sub(home.target).normalize();
	fitCamera.copy(view.camera);
	let near = view.controls.minDistance;
	let far = 400;
	for (let i = 0; i < 30; i++) {
		const mid = (near + far) / 2;
		fitCamera.position.copy(target).addScaledVector(along, mid);
		fitCamera.lookAt(target);
		fitCamera.updateMatrixWorld();
		const inside = corners.every(function (p) {
			corner.copy(p).project(fitCamera);
			return corner.z < 1 && Math.abs(corner.x) <= FIT_NDC && Math.abs(corner.y) <= FIT_NDC;
		});
		if (inside) { far = mid; } else { near = mid; }
	}
	return { position: target.clone().addScaledVector(along, far), target, near: DEAL_NEAR, distance: far };
}

/**
 * @description Frames an opened pile's column, or a hand card zoomed in on (cardTable.js zoom), as a deal is framed,
 * with the same home (view.dealHome): the camera glides there, & back exactly where the player had it when the pile
 * closes or the zoom ends (unframeDeal). While it's framed Auto Lean stands down (leanIn: view.dealHome). Nothing at the
 * monitor or while the promotion cards are out
 * @param  {[object|null]} box [the column (tableLayout.js columnBox) or the card's footprint, again when it changed;
 * null: the pile closed]
 * @param  {[boolean]} animate [false cuts there (reduce motion)]
 */
export function framePile(box, animate) {
	if (!view || !view.room) { return; }
	if (!box) {
		if (view.pileBox) {
			view.pileBox = null;
			unframeDeal(animate);
		}
		return;
	}
	// shortcut: a pile opened by the keys meanwhile lies open unframed, open it again to frame it
	if (!monitorIdle() || dealing()) { return; }
	view.pileBox = box;
	// The column is off the board: the controls would pull the target back onto it at the first zoom or orbit (three
	// 0.187 OrbitControls.update clamps it). Back in unframeDeal
	view.controls.maxTargetRadius = Infinity;
	landTurn();
	if (view.dealHome) { view.dealHome.back = false; }
	else {
		const lean = takeLean(); // Leaned in (Auto Lean): home is where the player had the camera, as frameDeal
		const { camera, controls } = view;
		view.dealHome = {
			position: lean ? lean.position : camera.position.clone(),
			target: lean ? lean.target : controls.target.clone(),
			maxDistance: controls.maxDistance,
			back: false
		};
	}
	aimDeal(animate);
}

// After unframeDeal(false) for a new size, side or default spot: what was framed (a deal, or an opened pile) is framed
// again from there
function reframe() {
	if (dealing()) { frameDeal(false); }
	else if (view.pileBox) { framePile(view.pileBox, false); }
}

/* ---------------------------------------------------------------- */
// Auto Lean
/* ---------------------------------------------------------------- */

// The pointer went onto the board (lean.js, the menu's option on): the camera glides to leanSpot(), remembering where
// the player had it (view.leanHome). Nothing while the player moves the camera, at the monitor, during a Flip Board
// turn, while the promotion cards are out or a deal or an opened pile is framed (view.dealHome: the frame wins). Where
// one of those ends retryLean() asks again, for a pointer still on the board (lean.js)
function leanIn() {
	const home = view && view.leanHome;
	if (!view || view.lost || (home && !home.back)) { return; } // Already leaned, or on its way
	if (isCameraGesture() || view.zoom || view.cameraTurn || view.dealHome || dealing()) { return; }
	const { camera, controls } = view;
	// Back on the board mid way back: the same home
	const from = home || { position: camera.position.clone(), target: controls.target.clone() };
	from.back = false; // back: on its way home (leanBack)
	// pointer.js sets it when the player really moves the camera from here on (a drag, two fingers, a wheel zoom)
	view.leanMoved = false;
	from.spot = leanSpot({
		home: from,
		fov: camera.fov,
		aspect: camera.aspect,
		board: BOARD_SIZE,
		min: controls.minDistance,
		max: controls.maxDistance
	});
	view.leanHome = from;
	moveDealCamera({ position: from.spot.position, target: from.spot.target, near: NEAR, lean: true }, !REDUCE.matches, () => {});
}

// The pointer has been off the board a while (or the option was turned off, or Flip Board and Reset View need the
// camera): back to where the player had it. A camera the player moved while leaned in stays where they put it. At the
// monitor landHome() puts it back (leanToHome)
function leanBack(animate) {
	const home = view && view.leanHome;
	if (!home || !monitorIdle()) { return; }
	if (home.back) { // Already on its way
		if (!animate) { landDealEase(); }
		return;
	}
	// A real gesture, not a click's 1 px wobble of pan
	if (!view.dealEase && view.leanMoved) {
		view.leanHome = null;
		return;
	}
	const leanedView = view;
	home.back = true;
	moveDealCamera({ position: home.position, target: home.target, near: NEAR, lean: true }, animate, () => { leanedView.leanHome = null; });
}

// Ends a lean without moving the camera (its glide too): where the player had it, for whatever takes the camera next.
// null when not leaned
function takeLean() {
	const home = view.leanHome;
	if (home) {
		view.leanHome = null;
		view.dealEase = null;
	}
	return home;
}

// The camera went to the monitor leaned in: the desk spot it comes back to (view.home) is where the player had it, not
// the lean
function leanToHome() {
	const lean = takeLean();
	if (lean && view.home) {
		view.home.position.copy(lean.position);
		view.home.target.copy(lean.target);
	}
}

// The card column is on screen from spot { position, target } (columnOnScreen() for a camera that isn't there)
function columnFrom(spot) {
	fitCamera.copy(view.camera);
	fitCamera.position.copy(spot.position);
	fitCamera.lookAt(spot.target);
	fitCamera.updateMatrixWorld();
	return columnInside(fitCamera);
}

setLeanCamera({
	lean: leanIn,
	back() {
		// A piece is dragged off the board: the camera waits for the drop (lean.js asks again)
		if (view && view.held && view.held.following) { return false; }
		leanBack(!REDUCE.matches);
	}
});

// The camera's near plane on the desk: a framed deal's is farther (DEAL_NEAR)
function deskNear() {
	return (view.dealHome && !view.dealHome.back ? DEAL_NEAR : NEAR);
}

// Flip Board during a framed deal: its home turns round the board's center as turnCamera() turns the camera, to angle
// around what it looks at
function turnDealHome(angle) {
	const { position, target } = view.dealHome;
	const by = angle - Math.atan2(position.x - target.x, position.z - target.z);
	position.applyAxisAngle(UP, by);
	target.applyAxisAngle(UP, by);
}

// A Chess Cards game's opening spot angle radians around the board, for the canvas's size (openingCamera.js); null in
// any other game, before the first size, or before the room has its table (no hand to show, and the baize stage's fog
// would swallow a board that far off)
function cardHome(angle) {
	return (view.table && view.size ? openingCamera({ fov: view.camera.fov, width: view.size.w, height: view.size.h, angle }) : null);
}

// Puts the camera at its default spot angle radians around the board from White's side (0 White, PI Black), looking at
// the board (the library's view: a little past its center). A small screen's is steeper and fits the board to it
// (smallScreenCamera). A Chess Cards game's shows the whole hand (cardHome): at a narrow window it can look past the
// board's far edge (resize's targetRadius)
export function placeCamera(angle) {
	const card = cardHome(angle);
	view.controls.target.set(0, 0, 0); // Undoes any pan
	if (card) {
		view.controls.target.copy(card.target);
		view.camera.position.copy(card.position);
	} else if (view.small) {
		view.camera.position.setFromSpherical(spherical.set(view.small.distance, view.small.tilt, angle));
	} else if (view.phone) {
		view.camera.position.set(CAMERA_DISTANCE * Math.sin(angle), CAMERA_HEIGHT, CAMERA_DISTANCE * Math.cos(angle));
	} else { // The library's view: the monitor across the board is in it
		view.controls.target.set(-ROOM_CAMERA_AIM * Math.sin(angle), 0, -ROOM_CAMERA_AIM * Math.cos(angle));
		view.camera.position.set(ROOM_CAMERA_DISTANCE * Math.sin(angle), ROOM_CAMERA_HEIGHT, ROOM_CAMERA_DISTANCE * Math.cos(angle));
	}
	view.controls.update(); // Looks at the target
}

// The camera's angle around what it looks at (0 White's side, PI Black's), wherever the player turned it
function cameraAzimuth() {
	offset.copy(view.camera.position).sub(view.controls.target);
	return Math.atan2(offset.x, offset.z);
}

// Turns the camera around what it looks at to angle, keeping the player's zoom, tilt and pan. turn (Flip Board's) also
// carries what it looks at round the board's center by the same angle: the library's view looks past the center, and
// from the other side that point is on the other side too
function turnCamera(angle, turn) {
	const { camera, controls } = view;
	spherical.setFromVector3(offset.copy(camera.position).sub(controls.target));
	spherical.theta = angle;
	if (turn) { controls.target.copy(turn.target).applyAxisAngle(UP, angle - turn.from); }
	camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
	camera.lookAt(controls.target);
}

// Turns the camera part of the way to its side (setSide), slow start and landing
export function stepCamera(now) {
	const turn = view.cameraTurn;
	if (turn.start === null) { turn.start = now; }
	const t = MathUtils.clamp((now - turn.start) / FLIP_MS, 0, 1);
	turnCamera(turn.from + (turn.to - turn.from) * easeInOut(t), turn);
	// The room comes round with the camera: the board looks to turn on the desk
	if (view.room) { turnRoom(view.room, turn.roomFrom + (turn.roomTo - turn.roomFrom) * easeInOut(t)); }
	if (t >= 0.5) { setLabels(view.side); } // Side on to the board: the labels swap unseen
	if (t === 1) {
		view.cameraTurn = null;
		retryLean();
		// A deal framed from an orbited camera: the room turned by a different angle, frame it again
		if (view.dealHome && !view.dealHome.back) { aimDeal(true); }
		view.relayDue = true;
		// The prompt was laid as the turn began: an orbited camera lands elsewhere relative to the room
		relayPlaques();
	}
}

// A Flip Board turn in progress lands at once
export function landTurn() {
	if (!view.cameraTurn) { return; }
	turnCamera(view.cameraTurn.to, view.cameraTurn);
	setLabels(view.side);
	setRoomSide(view.side);
	view.cameraTurn = null;
	view.relayDue = true;
	relayPlaques(); // As stepCamera's landing
}

// Around the board from White's side
export function sideAngle(color) {
	return (color === "b" ? Math.PI : 0);
}

// The room turns with the player's side, so the monitor is always across the board from them
export function setRoomSide(color) {
	if (view.room) { turnRoom(view.room, sideAngle(color)); }
}

/**
 * @description Where the camera sits to read the glass: square on to it, along its outward normal, far enough back
 * that it fills zoomDistance()'s share of the view. From the mesh's world matrix, so it follows the room as it turns
 * with the player's side
 * @return {[object]} { position, centre, near } [world space, near: the near plane that clips what's between the
 * camera & the glass]
 */
export function zoomSpot() {
	const { glass, camera } = view;
	glass.updateWorldMatrix(true, false);
	if (!glass.geometry.boundingBox) { glass.geometry.computeBoundingBox(); }
	const box = glass.geometry.boundingBox;
	box.getCenter(glassCentre);
	glass.localToWorld(glassCentre);
	box.getSize(glassSize);
	glass.getWorldScale(glassScale);
	const sizes = [0, 1, 2].map((i) => glassSize.getComponent(i) * Math.abs(glassScale.getComponent(i)));
	const thin = sizes.indexOf(Math.min(...sizes)); // The .glb has no normals: the glass's thinnest axis is its facing
	const [w, h] = sizes.filter((_, i) => i !== thin).sort((a, b) => b - a); // A 4:3 screen, wider than tall
	glassNormal.set(0, 0, 0).setComponent(thin, 1).transformDirection(glass.matrixWorld);
	// Outward is toward the board (the origin), across from the player
	if (glassNormal.x * glassCentre.x + glassNormal.z * glassCentre.z > 0) { glassNormal.negate(); }
	const distance = zoomDistance(w, h, camera.fov, camera.aspect);
	return {
		position: glassCentre.clone().addScaledVector(glassNormal, distance),
		centre: glassCentre.clone(),
		near: Math.max(NEAR, distance - GLASS_CLEAR)
	};
}

// Puts the camera at a spot, looking at its centre
export function setCameraAt({ position, centre, near }) {
	view.camera.position.copy(position);
	view.zoomLook.copy(centre);
	view.camera.lookAt(centre);
	setNear(near);
}

function setNear(near) {
	if (view.camera.near === near) { return; }
	view.camera.near = near;
	view.camera.updateProjectionMatrix();
}

// Starts the camera's move to the glass, or back to the desk (from wherever it is: a zoom can turn back halfway)
export function zoomTo(back) {
	leanToHome();
	const to = back ? { position: view.home.position, centre: view.home.target, near: deskNear() } : zoomSpot();
	view.zoom = {
		from: view.camera.position.clone(),
		fromLook: view.zoomLook.clone(),
		fromNear: view.camera.near,
		to: to.position.clone(),
		toLook: to.centre.clone(),
		toNear: to.near,
		start: null,
		back
	};
}

// Moves the camera part of the way (now = Infinity lands it), slow start and landing, and tells the monitor when it
// arrives
export function stepZoom(now) {
	const zoom = view.zoom;
	if (zoom.start === null) { zoom.start = now; }
	const t = now === Infinity ? 1 : MathUtils.clamp((now - zoom.start) / ZOOM_MS, 0, 1);
	const along = MathUtils.smoothstep(t, 0, 1);
	view.camera.position.lerpVectors(zoom.from, zoom.to, along);
	view.zoomLook.lerpVectors(zoom.fromLook, zoom.toLook, along);
	view.camera.lookAt(view.zoomLook);
	setNear(zoom.fromNear + (zoom.toNear - zoom.fromNear) * along);
	if (t < 1) { return; }
	view.zoom = null;
	if (zoom.back) { view.monitor.left(); } // Idle: onMonitorShow() hands the camera back (landHome)
	else { view.monitor.arrived(); }
}

// The view changed shape at the monitor: the glass fills the new one
function refitZoom() {
	if (view.zoom && !view.zoom.back) {
		const spot = zoomSpot();
		view.zoom.to.copy(spot.position);
		view.zoom.toLook.copy(spot.centre);
		view.zoom.toNear = spot.near;
	} else if (!view.zoom && view.monitor.state === "zoomed") { setCameraAt(zoomSpot()); }
}

// Back on the desk: the camera where it was (a cut when the monitor went straight to idle), the controls on,
// leaveMonitor()'s promises resolved
export function landHome() {
	const { camera, controls } = view;
	view.zoom = null;
	leanToHome();
	if (view.home) {
		camera.position.copy(view.home.position);
		controls.target.copy(view.home.target);
		view.home = null;
	}
	setNear(deskNear());
	controls.enabled = true;
	controls.update(); // Looks at the target again, inside any new limits
	retryLean();
	// Cards dealt while the monitor was up (frameDeal waited for the desk): frame them now
	if (dealing() && !view.dealHome) { frameDeal(!REDUCE.matches); }
	view.leaving.splice(0).forEach((resolve) => resolve());
}

// Straight back to the desk, no move (Flip Board and Reset View start from there)
function landAtDesk() {
	if (!monitorIdle()) { view.monitor.reset(); }
}

/**
 * @description A camera gesture is in progress (true from its start until after the click its release fires), piece
 * input ignores the pointer meanwhile
 * @return {[boolean]}
 */
export function isCameraGesture() {
	return Boolean(view && (view.cameraGesture || !monitorIdle())); // At the monitor the pointer belongs to it, not to the pieces
}

/**
 * @description Puts the camera on a side of the board (Flip Board), turning it the short way around what it looks at
 * (keeping the player's zoom, tilt & pan) or setting it at its default at once. Pressing again mid-turn turns back from
 * where it is
 * @param  {[string]} color ['w' | 'b', the side the player looks from]
 * @param  {[boolean]} animate [false sets it at once (mount, reduce motion)]
 */
export function setSide(color, animate) {
	if (!view || view.side === color) { return; }
	landAtDesk(); // From the desk's spot, not the monitor's
	leanBack(false); // Not Auto Lean's either
	landDealEase(); // And from where a deal's camera move ends
	view.side = color;
	const angle = color === "b" ? Math.PI : 0;
	if (!animate) {
		view.cameraTurn = null;
		unframeDeal(false); // The side's default spot is a deal's new home
		placeCamera(angle);
		setLabels(color);
		setRoomSide(color);
		reframe();
		retryLean();
		return;
	}
	const from = cameraAzimuth();
	// Pressed again mid-turn: the room turns back from where it is
	const roomFrom = view.room ? view.room.rotation.y : sideAngle(color === "b" ? "w" : "b");
	view.cameraTurn = {
		from,
		to: from + Math.atan2(Math.sin(angle - from), Math.cos(angle - from)),
		start: null,
		roomFrom,
		roomTo: angle,
		target: view.controls.target.clone() // target: what the camera looked at as the turn began
	};
	if (view.dealHome) { turnDealHome(angle); } // A framed deal goes back to the new side
	requestRender();
}

/**
 * @description Puts the camera back at its default spot for a side at once (Reset View)
 * @param  {[string]} color ['w' | 'b', the side the player looks from]
 */
export function resetCamera(color) {
	if (!view) { return; }
	landAtDesk();
	leanBack(false);
	landDealEase();
	view.cameraTurn = null;
	unframeDeal(false); // The default spot is a deal's new home
	view.side = color;
	placeCamera(color === "b" ? Math.PI : 0);
	setLabels(color);
	setRoomSide(color);
	reframe();
	retryLean();
	requestRender();
}

/**
 * @description A Chess Cards game's table was made (index.js setCardTable): the limits for its opening spot, & the
 * camera there. At the monitor the camera stays, & the opening spot is where it comes back to when it leaves
 */
export function openCardCamera() {
	resize();
	if (monitorIdle()) {
		resetCamera(view.side);
		return;
	}
	const card = cardHome(sideAngle(view.side));
	leanToHome(); // A lean's home would take its place on the way back (landHome)
	if (card && view.home) {
		view.home.position.copy(card.position);
		view.home.target.copy(card.target);
	}
}
