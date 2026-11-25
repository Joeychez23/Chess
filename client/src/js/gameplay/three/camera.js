// Owns 3D board camera and framing behavior
import { view, requestRender, fitCamera, spherical, corner, dealShift, UP, offset, setLabels, glassCentre, glassSize, glassScale, glassNormal, relayPlaques } from "./index.js";
import { monitorIdle } from "./pointer.js";
import { CARD_Y } from "./cardLayout.js";
import { PHONE_PIXEL_RATIO, SMALL_SCREEN, SMALL_FOV, FOV, MAX_TILT, MIN_DISTANCE, MAX_DISTANCE, SMALL_TILTS, FIT_NDC, PIECE_TOP, TAP_PX, BOARD_SIZE, CELL_SIZE, COLUMN_X, COLUMN_Z, DEAL_SHIFT, DEAL_NEAR, ZOOM_MS, NEAR, CAMERA_DISTANCE, CAMERA_HEIGHT, DESK_Y, ROOM_CAMERA_AIM, ROOM_CAMERA_DISTANCE, ROOM_CAMERA_HEIGHT, FLIP_MS, GLASS_CLEAR, REDUCE } from "./constants.js";
import { MathUtils } from "three";
import { easeInOut } from "../animate/timing.js";
import { turnRoom } from "./room.js";
import { zoomDistance } from "./monitor/monitor.js";
import { setLeanCamera, leanSpot, retryLean } from "./lean.js";
import { openingCamera } from "./openingCamera.js";

/* ---------------------------------------------------------------- */
// Mount
/* ---------------------------------------------------------------- */

// MATCHES THE DRAWING BUFFER & CAMERA TO THE CONTAINER (INSIDE ITS SAFE AREA PADDING, css/board3D.css #board3D), PIXEL DENSITY CAPPED
// (2, PHONES 1.5) SO 3x PHONES DON'T DRAW 9x THE PIXELS. A SMALL SCREEN ALSO GETS ITS CAMERA LIMITS FOR THE NEW SIZE
export const CARD_SETTLE_MS = 100; // A CHESS CARDS GAME'S OPENING SPOT IS SOLVED THIS LONG AFTER A WINDOW DRAG'S LAST RESIZE (UP TO 20 ms A SOLVE: NOT EVERY FRAME)

export function resize(settled) {
	const { renderer, camera, container, controls } = view;
	const style = getComputedStyle(container);
	const w = container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
	const h = container.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
	if (!(w > 0 && h > 0)) { return; } // HIDDEN: KEEP THE LAST SIZE
	unframeDeal(false); // A DEAL IS FRAMED AGAIN BELOW, FOR THE NEW SIZE: FROM ITS HOME AS THE NEW LIMITS LEAVE IT
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, view.phone ? PHONE_PIXEL_RATIO : 2));
	renderer.setSize(w, h, false); // CSS SIZES THE CANVAS
	camera.aspect = w / h;
	camera.fov = SMALL_SCREEN.matches ? SMALL_FOV : FOV;
	camera.updateProjectionMatrix();
	view.relayDue = view.relayDue || !(view.size && view.size.w === w && view.size.h === h); // A NEW SIZE: THE PLAQUES ARE LAID AGAIN ONCE THE CAMERA HAS SETTLED (index.js relayPlaques)
	view.size = { w, h };
	view.small = SMALL_SCREEN.matches ? smallScreenCamera(h) : null;
	clearTimeout(view.cardSettle);
	const settling = settled !== true && view.table && view.cardSpotFor === view.table;
	if (settling) { view.cardSettle = setTimeout(() => resize(true), CARD_SETTLE_MS); } // MID-DRAG (settled: THE ResizeObserver'S ENTRIES): THE LAST SIZE'S SPOT
	else { view.cardSpot = cardHome(0); view.cardSpotFor = view.table; }
	const card = view.cardSpot; // A CHESS CARDS GAME: THE LIMITS ALSO ALLOW ITS OPENING SPOT FOR THIS SIZE
	controls.maxPolarAngle = Math.max(view.small ? view.small.tilt : MAX_TILT, card ? card.tilt : 0); // NO TILTING OR ZOOMING OUT TO WHERE A SQUARE IS UNDER TAP_PX
	controls.maxDistance = Math.max(view.small ? Math.max(view.small.distance, MIN_DISTANCE) : MAX_DISTANCE, card ? card.distance : 0);
	view.targetRadius = Math.max(BOARD_SIZE / 2, card ? Math.hypot(card.target.x, card.target.z) : 0); // A NARROW WINDOW'S HAND VIEW LOOKS PAST THE BOARD
	controls.maxTargetRadius = view.targetRadius;
	if (monitorIdle()) { controls.update(); } // A CAMERA PAST THE NEW LIMITS (THE PHONE WAS TURNED) MOVES INSIDE THEM
	else { refitZoom(); } // AT THE MONITOR: THE GLASS FILLS THE NEW SHAPE (THE DESK SPOT IS CLAMPED WHEN IT GETS BACK, landHome)
	reframe();
	requestRender();
	if (!settling) { relayPlaques(); } // NOT MID-DRAG: THE CAMERA IS WHERE THE NEW LIMITS LEAVE IT (REVIEW N1)
}

/**
 * @description The small screen camera: the most tilted of SMALL_TILTS whose squares are TAP_PX tall at the distance picked, or the
 * steepest when none are (the biggest squares the screen allows: a phone on its side is about 8 squares tall). The distance is the
 * closest with room around the board & its pieces, or closer to make TAP_PX (edge pieces' tops may go off screen), but never so
 * close a square is off screen
 * @param  {[number]} h [the canvas's height in CSS pixels, view.camera has its new aspect & fov]
 * @return {[object]} { tilt, distance } [from straight down, from the center]
 */
function smallScreenCamera(h) {
	fitCamera.copy(view.camera);
	let fit;
	for (const tilt of SMALL_TILTS) {
		const squares = closest(tilt, () => cornersOnScreen(0, 1));
		const roomy = closest(tilt, () => cornersOnScreen(0, FIT_NDC) && cornersOnScreen(PIECE_TOP, 1));
		const tap = closest(tilt, () => smallestSquarePx(h) < TAP_PX); // FARTHER THAN THIS IS UNDER TAP_PX
		fit = { tilt, distance: Math.max(squares, Math.min(roomy, tap)) };
		aimFitCamera(tilt, fit.distance);
		if (smallestSquarePx(h) >= TAP_PX - 0.5) { break; }
	}
	return fit;
}

// PUTS fitCamera AT tilt & distance FROM WHITE'S SIDE (THE BOARD LOOKS THE SAME FROM BLACK'S)
function aimFitCamera(tilt, distance) {
	fitCamera.position.setFromSpherical(spherical.set(distance, tilt, 0));
	fitCamera.lookAt(0, 0, 0);
	fitCamera.updateMatrixWorld();
}

// THE CLOSEST DISTANCE AT tilt WHERE ok() IS TRUE (IT MUST BE TRUE FAR AWAY & FALSE UP CLOSE), FOUND BY HALVING
function closest(tilt, ok) {
	let near = 1, far = 400;
	for (let i = 0; i < 30; i++) {
		const mid = (near + far) / 2;
		aimFitCamera(tilt, mid);
		if (ok()) { far = mid; } else { near = mid; }
	}
	return far;
}

// THE BOARD'S 4 CORNERS, y UP, ARE INSIDE ndc OF fitCamera'S SCREEN (1 IS ITS EDGE)
function cornersOnScreen(y, ndc) {
	return [-1, 1].every((x) => [-1, 1].every(function (z) {
		corner.set(x * BOARD_SIZE / 2, y, z * BOARD_SIZE / 2).project(fitCamera);
		return Math.abs(corner.x) <= ndc && Math.abs(corner.y) <= ndc;
	}));
}

// HOW TALL THE FAR ROW'S SQUARES ARE ON fitCamera'S SCREEN IN CSS PIXELS (THE SMALLEST, THE TILT SQUASHES THE FAR SIDE MOST)
function smallestSquarePx(h) {
	const back = corner.set(0, 0, -BOARD_SIZE / 2).project(fitCamera).y;
	const front = corner.set(0, 0, -BOARD_SIZE / 2 + CELL_SIZE).project(fitCamera).y;
	return Math.abs(back - front) / 2 * h;
}

/* ---------------------------------------------------------------- */
// Deal Framing
/* ---------------------------------------------------------------- */

const dealing = () => Boolean(view.cards && view.cards.dealt()); // THE PROMOTION CARDS ARE OUT

// THE CARD COLUMN'S 4 CORNERS, THROUGH THE ROOM'S TURN, ARE IN FRONT OF camera & INSIDE FIT_NDC OF ITS SCREEN
function columnInside(camera) {
	view.room.updateMatrixWorld();
	return COLUMN_X.every((x) => COLUMN_Z.every(function (z) {
		corner.set(x, CARD_Y, z).applyMatrix4(view.room.matrixWorld).project(camera);
		return corner.z < 1 && Math.abs(corner.x) <= FIT_NDC && Math.abs(corner.y) <= FIT_NDC; // z PAST 1 IS BEHIND THE CAMERA
	}));
}

// THE WHOLE CARD COLUMN IS ON THE PLAYER'S SCREEN
function columnOnScreen() {
	view.camera.updateMatrixWorld();
	return columnInside(view.camera);
}

/**
 * @description Where the camera frames a deal from home: looking DEAL_SHIFT toward the column (in the room's turn), from the closest point
 * along home's view direction where the board's & the column's corners are all inside FIT_NDC (closest()'s halving, on fitCamera)
 * @param  {[object]} home { position, target } [where the camera was before the deal]
 * @return {[object]} { position, target, near, distance } [world space, near: the camera's near plane there, distance: from the target, what controls.maxDistance must allow]
 */
function framedSpot(home) {
	view.room.updateMatrixWorld();
	const target = dealShift.set(1, 0, 0).transformDirection(view.room.matrixWorld).multiplyScalar(DEAL_SHIFT).add(home.target).clone();
	const along = home.position.clone().sub(home.target).normalize();
	fitCamera.copy(view.camera);
	let near = 1, far = 400;
	for (let i = 0; i < 30; i++) {
		const mid = (near + far) / 2;
		fitCamera.position.copy(target).addScaledVector(along, mid);
		fitCamera.lookAt(target);
		fitCamera.updateMatrixWorld();
		if (cornersOnScreen(0, FIT_NDC) && columnInside(fitCamera)) { far = mid; } else { near = mid; }
	}
	return { position: target.clone().addScaledVector(along, far), target, near: DEAL_NEAR, distance: far };
}

// MOVES THE CAMERA, WHAT IT LOOKS AT & ITS NEAR PLANE TO to { position, target, near } OVER ZOOM_MS, SLOW START & LANDING, OR AT ONCE. done() RUNS AS IT LANDS.
// view.dealEase IS THE MOVE RUNNING: A NEWER ONE TAKES OVER FROM WHEREVER IT IS, ITS update(1) LANDS IT (landDealEase)
function moveDealCamera(to, animate, done) {
	const { camera, controls } = view;
	const fromPosition = camera.position.clone(), fromTarget = controls.target.clone(), fromNear = camera.near;
	const ease = {
		duration: ZOOM_MS,
		update(k) {
			if (view.dealEase !== ease) { return; } // A NEWER MOVE TOOK OVER
			if (to.lean && k < 1 && (view.cameraGesture || view.leanMoved)) { view.dealEase = null; view.leanHome = null; return; } // THE PLAYER TOOK THE CAMERA MID LEAN (A DRAG, OR A WHEEL: leanMoved WITHOUT cameraGesture, F8-M1): IT STAYS WHERE THEY PUT IT
			if (k === 1) { // EXACTLY THERE, NOT A ROUNDING ERROR OFF IT: THE WAY BACK LANDS WHERE THE PLAYER HAD IT
				camera.position.copy(to.position);
				controls.target.copy(to.target);
				setNear(to.near);
			} else {
				camera.position.lerpVectors(fromPosition, to.position, k);
				controls.target.lerpVectors(fromTarget, to.target, k);
				setNear(fromNear + (to.near - fromNear) * k);
			}
			camera.lookAt(controls.target);
			if (k === 1) { view.dealEase = null; done(); }
		}
	};
	view.dealEase = ease;
	if (animate) { view.tweens.add(ease); } else { ease.update(1); }
	requestRender();
}

// A DEAL'S CAMERA MOVE IN PROGRESS LANDS AT ONCE
export function landDealEase() {
	if (view.dealEase) { view.dealEase.update(1); }
}

// MOVES THE CAMERA TO FRAME THE DEAL FROM view.dealHome, ITS ZOOM LIMIT RAISED SO IT CAN STAY THERE
function aimDeal(animate) {
	const spot = view.pileBox ? pileSpot(view.dealHome, view.pileBox) : framedSpot(view.dealHome);
	view.controls.maxDistance = Math.max(view.dealHome.maxDistance, spot.distance);
	moveDealCamera(spot, animate, () => {});
}

/**
 * @description Frames a deal: when the card column isn't on screen (a phone's camera is fitted to the board) the camera eases back & over
 * until the board & the column both are, remembering where it was (view.dealHome). Nothing at the monitor or with the column already on
 * screen. A deal while the camera is still going back from the last one turns it round to the frame, with the same home
 * @param  {[boolean]} animate [false cuts there (reduce motion)]
 */
export function frameDeal(animate) {
	if (!view.room || !monitorIdle()) { return; }
	const home = view.dealHome;
	if (home && !home.back && !view.pileBox) { return; } // ALREADY FRAMED, OR ON ITS WAY
	if (view.pileBox) { view.pileBox = null; view.controls.maxTargetRadius = view.targetRadius; view.table.togglePile(null); } // AN OPENED PILE HAD THE FRAME: IT CLOSES, THE DEAL IS FRAMED FROM THE SAME HOME
	landTurn(); // FLIP BOARD WOULD TAKE THE CAMERA ELSEWHERE: THE FRAME IS WORKED OUT FROM WHERE ITS TURN ENDS
	if (home) { home.back = false; }
	else {
		const lean = takeLean(); // LEANED IN (AUTO LEAN): THE DEAL IS FRAMED FROM WHERE THE PLAYER HAD THE CAMERA, NOT FROM THE LEAN
		if (lean ? columnFrom(lean) : columnOnScreen()) {
			if (lean) { moveDealCamera({ position: lean.position, target: lean.target, near: NEAR }, animate, () => {}); } // THE CARDS ARE IN VIEW FROM THERE: JUST BACK
			return;
		}
		const { camera, controls } = view;
		view.dealHome = { position: lean ? lean.position : camera.position.clone(), target: lean ? lean.target : controls.target.clone(), maxDistance: controls.maxDistance, back: false }; // back: ON ITS WAY THERE (unframeDeal)
	}
	aimDeal(animate);
}

/**
 * @description Ends a framed deal: the camera goes back exactly to where it was before it, & its zoom limit with it (an orbit or zoom by
 * hand while the cards were out is let go: the frame was the deal's). At the monitor it's where the monitor hands the camera back to
 * @param  {[boolean]} animate [false cuts there]
 */
export function unframeDeal(animate) {
	const home = view.dealHome;
	if (!home) { retryLean(); return; } // THE PROMOTION CARDS WENT BACK WITHOUT A FRAME: AUTO LEAN MAY LEAN AGAIN
	const restore = function () {
		view.controls.maxDistance = home.maxDistance;
		view.controls.maxTargetRadius = view.targetRadius; // AS resize SET IT: AN OPENED PILE'S FRAME LIFTED IT (framePile)
		view.dealHome = null;
		retryLean(); // THE DEAL'S OR THE OPENED PILE'S FRAME IS OVER
	};
	if (!monitorIdle()) { // landHome() PUTS IT THERE
		if (view.home) { view.home.position.copy(home.position); view.home.target.copy(home.target); }
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
 * @description Where the camera reads an opened pile's column from (Chess Cards): looking at the column's middle from the closest point along home's view direction
 * where its 4 corners are inside FIT_NDC, never closer than the zoom limit
 * @param  {[object]} home { position, target } [where the camera was before the pile opened]
 * @param  {[object]} box { x0, x1, z0, z1 } [the column on the desk, room space (tableLayout.js columnBox)]
 * @return {[object]} { position, target, near, distance } [as framedSpot]
 */
function pileSpot(home, box) {
	view.room.updateMatrixWorld();
	const corners = [box.x0, box.x1].flatMap((x) => [box.z0, box.z1].map((z) => corner.clone().set(x, DESK_Y, z).applyMatrix4(view.room.matrixWorld)));
	const target = corners[0].clone().add(corners[3]).multiplyScalar(0.5);
	const along = home.position.clone().sub(home.target).normalize();
	fitCamera.copy(view.camera);
	let near = view.controls.minDistance, far = 400;
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
 * @description Frames an opened pile's column, or a hand card zoomed in on (cardTable.js zoom), as a deal is framed, with the same home (view.dealHome): the camera glides there, & back exactly where the player had it when
 * the pile closes or the zoom ends (unframeDeal). While it's framed Auto Lean stands down (leanIn: view.dealHome). Nothing at the monitor or while the promotion cards are out
 * @param  {[object|null]} box [the column (tableLayout.js columnBox) or the card's footprint, again when it changed; null: the pile closed]
 * @param  {[boolean]} animate [false cuts there (reduce motion)]
 */
export function framePile(box, animate) {
	if (!view || !view.room) { return; }
	if (!box) {
		if (view.pileBox) { view.pileBox = null; unframeDeal(animate); }
		return;
	}
	if (!monitorIdle() || dealing()) { return; } // shortcut: A PILE OPENED BY THE KEYS MEANWHILE LIES OPEN UNFRAMED, OPEN IT AGAIN TO FRAME IT
	view.pileBox = box;
	view.controls.maxTargetRadius = Infinity; // THE COLUMN IS OFF THE BOARD: THE CONTROLS WOULD PULL THE TARGET BACK ONTO IT AT THE FIRST ZOOM OR ORBIT (three 0.187 OrbitControls.update CLAMPS IT). BACK IN unframeDeal
	landTurn();
	if (view.dealHome) { view.dealHome.back = false; }
	else {
		const lean = takeLean(), { camera, controls } = view; // LEANED IN (AUTO LEAN): HOME IS WHERE THE PLAYER HAD THE CAMERA, AS frameDeal
		view.dealHome = { position: lean ? lean.position : camera.position.clone(), target: lean ? lean.target : controls.target.clone(), maxDistance: controls.maxDistance, back: false };
	}
	aimDeal(animate);
}

// AFTER unframeDeal(false) FOR A NEW SIZE, SIDE OR DEFAULT SPOT: WHAT WAS FRAMED (A DEAL, OR AN OPENED PILE) IS FRAMED AGAIN FROM THERE
function reframe() {
	if (dealing()) { frameDeal(false); }
	else if (view.pileBox) { framePile(view.pileBox, false); }
}

/* ---------------------------------------------------------------- */
// Auto Lean
/* ---------------------------------------------------------------- */

// THE POINTER WENT ONTO THE BOARD (lean.js, THE MENU'S OPTION ON): THE CAMERA GLIDES TO leanSpot(), REMEMBERING WHERE THE PLAYER HAD IT (view.leanHome).
// NOTHING WHILE THE PLAYER MOVES THE CAMERA, AT THE MONITOR, DURING A FLIP BOARD TURN, WHILE THE PROMOTION CARDS ARE OUT OR A DEAL OR AN OPENED PILE IS FRAMED (view.dealHome:
// THE FRAME WINS). WHERE ONE OF THOSE ENDS retryLean() ASKS AGAIN, FOR A POINTER STILL ON THE BOARD (lean.js)
function leanIn() {
	const home = view && view.leanHome;
	if (!view || view.lost || (home && !home.back)) { return; } // ALREADY LEANED, OR ON ITS WAY
	if (isCameraGesture() || view.zoom || view.cameraTurn || view.dealHome || dealing()) { return; }
	const { camera, controls } = view;
	const from = home || { position: camera.position.clone(), target: controls.target.clone() }; // BACK ON THE BOARD MID WAY BACK: THE SAME HOME
	from.back = false; // back: ON ITS WAY HOME (leanBack)
	view.leanMoved = false; // pointer.js SETS IT WHEN THE PLAYER REALLY MOVES THE CAMERA FROM HERE ON (A DRAG, TWO FINGERS, A WHEEL ZOOM)
	from.spot = leanSpot({ home: from, fov: camera.fov, aspect: camera.aspect, board: BOARD_SIZE, min: controls.minDistance, max: controls.maxDistance });
	view.leanHome = from;
	moveDealCamera({ position: from.spot.position, target: from.spot.target, near: NEAR, lean: true }, !REDUCE.matches, () => {});
}

// THE POINTER HAS BEEN OFF THE BOARD A WHILE (OR THE OPTION WAS TURNED OFF, OR FLIP BOARD & RESET VIEW NEED THE CAMERA): BACK TO WHERE THE PLAYER HAD IT.
// A CAMERA THE PLAYER MOVED WHILE LEANED IN STAYS WHERE THEY PUT IT. AT THE MONITOR landHome() PUTS IT BACK (leanToHome)
function leanBack(animate) {
	const home = view && view.leanHome;
	if (!home || !monitorIdle()) { return; }
	if (home.back) { if (!animate) { landDealEase(); } return; } // ALREADY ON ITS WAY
	if (!view.dealEase && view.leanMoved) { view.leanHome = null; return; } // A REAL GESTURE, NOT A CLICK'S 1 px WOBBLE OF PAN (RB-I1)
	const v = view;
	home.back = true;
	moveDealCamera({ position: home.position, target: home.target, near: NEAR, lean: true }, animate, () => { v.leanHome = null; });
}

// ENDS A LEAN WITHOUT MOVING THE CAMERA (ITS GLIDE TOO): WHERE THE PLAYER HAD IT, FOR WHATEVER TAKES THE CAMERA NEXT. null WHEN NOT LEANED
function takeLean() {
	const home = view.leanHome;
	if (home) { view.leanHome = null; view.dealEase = null; }
	return home;
}

// THE CAMERA WENT TO THE MONITOR LEANED IN: THE DESK SPOT IT COMES BACK TO (view.home) IS WHERE THE PLAYER HAD IT, NOT THE LEAN
function leanToHome() {
	const lean = takeLean();
	if (lean && view.home) { view.home.position.copy(lean.position); view.home.target.copy(lean.target); }
}

// THE CARD COLUMN IS ON SCREEN FROM spot { position, target } (columnOnScreen() FOR A CAMERA THAT ISN'T THERE)
function columnFrom(spot) {
	fitCamera.copy(view.camera);
	fitCamera.position.copy(spot.position);
	fitCamera.lookAt(spot.target);
	fitCamera.updateMatrixWorld();
	return columnInside(fitCamera);
}

setLeanCamera({ lean: leanIn, back() {
	if (view && view.held && view.held.following) { return false; } // A PIECE IS DRAGGED OFF THE BOARD: THE CAMERA WAITS FOR THE DROP (lean.js ASKS AGAIN)
	leanBack(!REDUCE.matches);
} });

// THE CAMERA'S NEAR PLANE ON THE DESK: A FRAMED DEAL'S IS FARTHER (DEAL_NEAR)
const deskNear = () => (view.dealHome && !view.dealHome.back ? DEAL_NEAR : NEAR);

// FLIP BOARD DURING A FRAMED DEAL: ITS HOME TURNS ROUND THE BOARD'S CENTER AS turnCamera() TURNS THE CAMERA, TO angle AROUND WHAT IT LOOKS AT
function turnDealHome(angle) {
	const { position, target } = view.dealHome;
	const by = angle - Math.atan2(position.x - target.x, position.z - target.z);
	position.applyAxisAngle(UP, by);
	target.applyAxisAngle(UP, by);
}

// A CHESS CARDS GAME'S OPENING SPOT angle RADIANS AROUND THE BOARD, FOR THE CANVAS'S SIZE (openingCamera.js); null IN ANY OTHER GAME, BEFORE THE FIRST SIZE, OR BEFORE THE ROOM
// HAS ITS TABLE (NO HAND TO SHOW, & THE BAIZE STAGE'S FOG WOULD SWALLOW A BOARD THAT FAR OFF)
const cardHome = (angle) => (view.table && view.size ? openingCamera({ fov: view.camera.fov, width: view.size.w, height: view.size.h, angle }) : null);

// PUTS THE CAMERA AT ITS DEFAULT SPOT angle RADIANS AROUND THE BOARD FROM WHITE'S SIDE (0 WHITE, PI BLACK), LOOKING AT THE BOARD (THE LIBRARY'S VIEW: A LITTLE PAST ITS CENTER).
// A SMALL SCREEN'S IS STEEPER & FITS THE BOARD TO IT (smallScreenCamera). A CHESS CARDS GAME'S SHOWS THE WHOLE HAND (cardHome): AT A NARROW WINDOW IT CAN LOOK PAST THE BOARD'S FAR EDGE (resize'S targetRadius)
export function placeCamera(angle) {
	const card = cardHome(angle);
	view.controls.target.set(0, 0, 0); // UNDOES ANY PAN
	if (card) {
		view.controls.target.copy(card.target);
		view.camera.position.copy(card.position);
	} else if (view.small) { view.camera.position.setFromSpherical(spherical.set(view.small.distance, view.small.tilt, angle)); }
	else if (view.phone) { view.camera.position.set(CAMERA_DISTANCE * Math.sin(angle), CAMERA_HEIGHT, CAMERA_DISTANCE * Math.cos(angle)); }
	else { // THE LIBRARY'S VIEW: THE MONITOR ACROSS THE BOARD IS IN IT
		view.controls.target.set(-ROOM_CAMERA_AIM * Math.sin(angle), 0, -ROOM_CAMERA_AIM * Math.cos(angle));
		view.camera.position.set(ROOM_CAMERA_DISTANCE * Math.sin(angle), ROOM_CAMERA_HEIGHT, ROOM_CAMERA_DISTANCE * Math.cos(angle));
	}
	view.controls.update(); // LOOKS AT THE TARGET
}

// THE CAMERA'S ANGLE AROUND WHAT IT LOOKS AT (0 WHITE'S SIDE, PI BLACK'S), WHEREVER THE PLAYER TURNED IT
function cameraAzimuth() {
	offset.copy(view.camera.position).sub(view.controls.target);
	return Math.atan2(offset.x, offset.z);
}

// TURNS THE CAMERA AROUND WHAT IT LOOKS AT TO angle, KEEPING THE PLAYER'S ZOOM, TILT & PAN. turn (FLIP BOARD'S) ALSO CARRIES WHAT IT LOOKS AT
// ROUND THE BOARD'S CENTER BY THE SAME ANGLE: THE LIBRARY'S VIEW LOOKS PAST THE CENTER, & FROM THE OTHER SIDE THAT POINT IS ON THE OTHER SIDE TOO
function turnCamera(angle, turn) {
	const { camera, controls } = view;
	spherical.setFromVector3(offset.copy(camera.position).sub(controls.target));
	spherical.theta = angle;
	if (turn) { controls.target.copy(turn.target).applyAxisAngle(UP, angle - turn.from); }
	camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
	camera.lookAt(controls.target);
}

// TURNS THE CAMERA PART OF THE WAY TO ITS SIDE (setSide), SLOW START & LANDING
export function stepCamera(now) {
	const turn = view.cameraTurn;
	if (turn.start === null) { turn.start = now; }
	const t = MathUtils.clamp((now - turn.start) / FLIP_MS, 0, 1);
	turnCamera(turn.from + (turn.to - turn.from) * easeInOut(t), turn);
	if (view.room) { turnRoom(view.room, turn.roomFrom + (turn.roomTo - turn.roomFrom) * easeInOut(t)); } // THE ROOM COMES ROUND WITH THE CAMERA: THE BOARD LOOKS TO TURN ON THE DESK
	if (t >= 0.5) { setLabels(view.side); } // SIDE ON TO THE BOARD: THE LABELS SWAP UNSEEN
	if (t === 1) {
		view.cameraTurn = null;
		retryLean();
		if (view.dealHome && !view.dealHome.back) { aimDeal(true); } // A DEAL FRAMED FROM AN ORBITED CAMERA: THE ROOM TURNED BY A DIFFERENT ANGLE, FRAME IT AGAIN
		view.relayDue = true;
		relayPlaques(); // THE PROMPT WAS LAID AS THE TURN BEGAN: AN ORBITED CAMERA LANDS ELSEWHERE RELATIVE TO THE ROOM (REVIEW R2-1)
	}
}

// A FLIP BOARD TURN IN PROGRESS LANDS AT ONCE
export function landTurn() {
	if (!view.cameraTurn) { return; }
	turnCamera(view.cameraTurn.to, view.cameraTurn);
	setLabels(view.side);
	setRoomSide(view.side);
	view.cameraTurn = null;
	view.relayDue = true;
	relayPlaques(); // AS stepCamera'S LANDING
}

export const sideAngle = (color) => (color === "b" ? Math.PI : 0); // AROUND THE BOARD FROM WHITE'S SIDE

// THE ROOM TURNS WITH THE PLAYER'S SIDE, SO THE MONITOR IS ALWAYS ACROSS THE BOARD FROM THEM
export function setRoomSide(color) {
	if (view.room) { turnRoom(view.room, sideAngle(color)); }
}

/**
 * @description Where the camera sits to read the glass: square on to it, along its outward normal, far enough back that it fills
 * zoomDistance()'s share of the view. From the mesh's world matrix, so it follows the room as it turns with the player's side
 * @return {[object]} { position, centre, near } [world space, near: the near plane that clips what's between the camera & the glass]
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
	const thin = sizes.indexOf(Math.min(...sizes)); // THE .glb HAS NO NORMALS: THE GLASS'S THINNEST AXIS IS ITS FACING
	const [w, h] = sizes.filter((_, i) => i !== thin).sort((a, b) => b - a); // A 4:3 SCREEN, WIDER THAN TALL
	glassNormal.set(0, 0, 0).setComponent(thin, 1).transformDirection(glass.matrixWorld);
	if (glassNormal.x * glassCentre.x + glassNormal.z * glassCentre.z > 0) { glassNormal.negate(); } // OUTWARD IS TOWARD THE BOARD (THE ORIGIN), ACROSS FROM THE PLAYER
	const distance = zoomDistance(w, h, camera.fov, camera.aspect);
	return { position: glassCentre.clone().addScaledVector(glassNormal, distance), centre: glassCentre.clone(), near: Math.max(NEAR, distance - GLASS_CLEAR) };
}

// PUTS THE CAMERA AT A SPOT, LOOKING AT ITS CENTRE
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

// STARTS THE CAMERA'S MOVE TO THE GLASS, OR BACK TO THE DESK (FROM WHEREVER IT IS, A ZOOM CAN TURN BACK HALFWAY)
export function zoomTo(back) {
	leanToHome();
	const to = back ? { position: view.home.position, centre: view.home.target, near: deskNear() } : zoomSpot();
	view.zoom = { from: view.camera.position.clone(), fromLook: view.zoomLook.clone(), fromNear: view.camera.near, to: to.position.clone(), toLook: to.centre.clone(), toNear: to.near, start: null, back };
}

// MOVES THE CAMERA PART OF THE WAY (now = Infinity LANDS IT), SLOW START & LANDING, & TELLS THE MONITOR WHEN IT ARRIVES
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
	if (zoom.back) { view.monitor.left(); } // IDLE: onMonitorShow() HANDS THE CAMERA BACK (landHome)
	else { view.monitor.arrived(); }
}

// THE VIEW CHANGED SHAPE AT THE MONITOR: THE GLASS FILLS THE NEW ONE
function refitZoom() {
	if (view.zoom && !view.zoom.back) {
		const spot = zoomSpot();
		view.zoom.to.copy(spot.position);
		view.zoom.toLook.copy(spot.centre);
		view.zoom.toNear = spot.near;
	} else if (!view.zoom && view.monitor.state === "zoomed") { setCameraAt(zoomSpot()); }
}

// BACK ON THE DESK: THE CAMERA WHERE IT WAS (A CUT WHEN THE MONITOR WENT STRAIGHT TO IDLE), THE CONTROLS ON, leaveMonitor()'S PROMISES RESOLVED
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
	controls.update(); // LOOKS AT THE TARGET AGAIN, INSIDE ANY NEW LIMITS
	retryLean();
	if (dealing() && !view.dealHome) { frameDeal(!REDUCE.matches); } // CARDS DEALT WHILE THE MONITOR WAS UP (frameDeal WAITED FOR THE DESK): FRAME THEM NOW
	view.leaving.splice(0).forEach((resolve) => resolve());
}

// STRAIGHT BACK TO THE DESK, NO MOVE (FLIP BOARD & RESET VIEW START FROM THERE)
function landAtDesk() {
	if (!monitorIdle()) { view.monitor.reset(); }
}

/**
 * @description A camera gesture is in progress (true from its start until after the click its release fires), piece input ignores the pointer meanwhile
 * @return {[boolean]}
 */
export function isCameraGesture() {
	return Boolean(view && (view.cameraGesture || !monitorIdle())); // AT THE MONITOR THE POINTER BELONGS TO IT, NOT TO THE PIECES
}

/**
 * @description Puts the camera on a side of the board (Flip Board), turning it the short way around what it looks at (keeping the
 * player's zoom, tilt & pan) or setting it at its default at once. Pressing again mid-turn turns back from where it is
 * @param  {[string]} color ['w' | 'b', the side the player looks from]
 * @param  {[boolean]} animate [false sets it at once (mount, reduce motion)]
 */
export function setSide(color, animate) {
	if (!view || view.side === color) { return; }
	landAtDesk(); // FROM THE DESK'S SPOT, NOT THE MONITOR'S
	leanBack(false); // NOT AUTO LEAN'S EITHER
	landDealEase(); // & FROM WHERE A DEAL'S CAMERA MOVE ENDS
	view.side = color;
	const angle = color === "b" ? Math.PI : 0;
	if (!animate) {
		view.cameraTurn = null;
		unframeDeal(false); // THE SIDE'S DEFAULT SPOT IS A DEAL'S NEW HOME
		placeCamera(angle);
		setLabels(color);
		setRoomSide(color);
		reframe();
		retryLean();
		return;
	}
	const from = cameraAzimuth();
	const roomFrom = view.room ? view.room.rotation.y : sideAngle(color === "b" ? "w" : "b"); // PRESSED AGAIN MID-TURN: THE ROOM TURNS BACK FROM WHERE IT IS
	view.cameraTurn = { from, to: from + Math.atan2(Math.sin(angle - from), Math.cos(angle - from)), start: null, roomFrom, roomTo: angle, target: view.controls.target.clone() }; // target: WHAT THE CAMERA LOOKED AT AS THE TURN BEGAN
	if (view.dealHome) { turnDealHome(angle); } // A FRAMED DEAL GOES BACK TO THE NEW SIDE
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
	unframeDeal(false); // THE DEFAULT SPOT IS A DEAL'S NEW HOME
	view.side = color;
	placeCamera(color === "b" ? Math.PI : 0);
	setLabels(color);
	setRoomSide(color);
	reframe();
	retryLean();
	requestRender();
}

/**
 * @description A Chess Cards game's table was made (index.js setCardTable): the limits for its opening spot, & the camera there. At the monitor (ruling T23-6) the camera stays,
 * & the opening spot is where it comes back to when it leaves (T23-9)
 */
export function openCardCamera() {
	resize();
	if (monitorIdle()) { resetCamera(view.side); return; }
	const card = cardHome(sideAngle(view.side));
	leanToHome(); // A LEAN'S HOME WOULD TAKE ITS PLACE ON THE WAY BACK (landHome)
	if (card && view.home) { view.home.position.copy(card.position); view.home.target.copy(card.target); }
}
