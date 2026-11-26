// The monitor's side of 3D input: whether it is on the desk, its data,
// the camera following its state, the glass under a pointer
import { view, requestRender, pointer, raycaster, forward, offset } from "../index.js";
import { zoomTo, setCameraAt, zoomSpot, landHome, landTurn, landDealEase } from "../camera/index.js";
import { redrawScreen } from "../monitor/screen.js";
import { uvToGrid } from "../monitor/monitor.js";

/* ---------------------------------------------------------------- */
// Monitor
/* ---------------------------------------------------------------- */

// The monitor is on the desk (or there is none): the board and the camera controls are the player's
export function monitorIdle() {
	return !view.monitor || view.monitor.state === "idle";
}

// The data the monitor gets: setMonitor()'s, and the opponent's name and status (setScreen) for the screen reader
export function monitorInput(data) {
	const state = view.screenState || {};
	return { ...data, screen: { name: state.name || "", status: state.status || "" } };
}

// The monitor's show(): redraws the glass, then moves the camera for a new state. monitor.js changes state by itself
// too (back, escape), so the camera follows its state, not this file's calls
export function onMonitorShow(mountedView) {
	redrawScreen();
	if (view !== mountedView || !mountedView.monitor) { return; }
	const state = mountedView.monitor.state;
	const was = mountedView.monitorSeen;
	if (state === was) { return; }
	mountedView.monitorSeen = state;
	if (was === "idle") { leaveDesk(); }
	if (state === "zooming") { zoomTo(false); }
	// Reduced motion: straight from the desk (a finished zoom is already there)
	else if (state === "zoomed" && was !== "zooming") { setCameraAt(zoomSpot()); }
	else if (state === "leaving") { zoomTo(true); }
	else if (state === "idle") { landHome(); }
	requestRender();
	mountedView.monitorOptions.onChange({ ready: true, state });
}

// The camera leaves the desk: remembers where it was and takes it from the controls. A Flip Board turn and a deal's
// camera move land first
function leaveDesk() {
	const { camera, controls } = view;
	landTurn();
	landDealEase();
	view.home = { position: camera.position.clone(), target: controls.target.clone() };
	view.zoomLook.copy(controls.target);
	controls.enabled = false;
}

// The grid pixel under a pointer event on the glass, null when the board's tiles are in front of it or it isn't under
// it. A piece's body off the tiles is ignored: the board is picked by tile, so a body standing out past the board's
// edge in front of the glass would be a spot where nothing answers
export function glassHit(e) {
	if (!view.glass) { return null; }
	const rect = view.renderer.domElement.getBoundingClientRect();
	pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
	raycaster.setFromCamera(pointer, view.camera);
	view.camera.getWorldDirection(forward);
	// The near plane clips by depth along the view, not distance along the ray
	function depthOf(candidate) {
		return offset.copy(candidate.point).sub(view.camera.position).dot(forward);
	}
	// What the near plane clips isn't drawn, so it can't be in the way
	const hit = raycaster.intersectObjects([view.glass, view.plane], false)
		.find((candidate) => depthOf(candidate) >= view.camera.near);
	return hit && hit.object === view.glass && hit.uv ? uvToGrid(hit.uv.x, hit.uv.y) : null;
}

// A mouse over the glass: the monitor's hover (the face's eyes on the desk, a button zoomed) and a hand cursor
export function hoverGlass(e) {
	if (!view.monitor) { return; }
	const at = glassHit(e);
	if (at) { view.monitor.pointer("move", at.x, at.y); }
	else { view.monitor.pointer("out"); }
	const cursor = at ? "pointer" : "";
	if (view.container.style.cursor !== cursor) { view.container.style.cursor = cursor; }
}
