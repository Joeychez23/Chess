// The camera's glide (a deal's or an opened pile's frame, Auto Lean's lean and its way back) and its near plane
import { view, requestRender } from "../index.js";
import { ZOOM_MS } from "../constants.js";

// The promotion cards are out
export function dealing() {
	return Boolean(view.cards && view.cards.dealt());
}

// Moves the camera, what it looks at and its near plane to `to` { position, target, near } over ZOOM_MS, slow start
// and landing, or at once. done() runs as it lands. view.dealEase is the move running: a newer one takes over from
// wherever it is, its update(1) lands it (landDealEase)
export function moveDealCamera(to, animate, done) {
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

export function setNear(near) {
	if (view.camera.near === near) { return; }
	view.camera.near = near;
	view.camera.updateProjectionMatrix();
}
