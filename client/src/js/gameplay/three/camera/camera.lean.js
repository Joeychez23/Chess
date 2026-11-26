// Auto Lean: the camera leans in when the pointer goes onto the board and back when it leaves (lean.js)
import { view } from "../index.js";
import { monitorIdle } from "../pointer/index.js";
import { BOARD_SIZE, NEAR, REDUCE } from "../constants.js";
import { setLeanCamera, leanSpot } from "./autoLean.js";
import { dealing, moveDealCamera, landDealEase } from "./camera.glide.js";

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
	// pointer/index.js sets it when the player really moves the camera from here on (a drag, two fingers, a wheel zoom)
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
export function leanBack(animate) {
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
export function takeLean() {
	const home = view.leanHome;
	if (home) {
		view.leanHome = null;
		view.dealEase = null;
	}
	return home;
}

// The camera went to the monitor leaned in: the desk spot it comes back to (view.home) is where the player had it, not
// the lean
export function leanToHome() {
	const lean = takeLean();
	if (lean && view.home) {
		view.home.position.copy(lean.position);
		view.home.target.copy(lean.target);
	}
}

setLeanCamera({
	lean: leanIn,
	back() {
		// A piece is dragged off the board: the camera waits for the drop (lean.js asks again)
		if (view && view.held && view.held.following) { return false; }
		leanBack(!REDUCE.matches);
	}
});

/**
 * @description A camera gesture is in progress (true from its start until after the click its release fires), piece
 * input ignores the pointer meanwhile
 * @return {[boolean]}
 */
export function isCameraGesture() {
	return Boolean(view && (view.cameraGesture || !monitorIdle())); // At the monitor the pointer belongs to it, not to the pieces
}
