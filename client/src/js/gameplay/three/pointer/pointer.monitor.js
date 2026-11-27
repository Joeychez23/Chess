// The monitor's side of 3D input: whether it is on the desk, its data,
// the camera following its state, the glass under a pointer
import { view, requestRender, pointer, raycaster, forward, offset } from "../index.js";
import { zoomTo, setCameraAt, zoomSpot, landHome, landTurn, landDealEase } from "../camera/index.js";
import { redrawScreen } from "../monitor/screen.js";
import { uvToGrid } from "../monitor/controls.js";
import { Vector3 } from "three";

const corner = new Vector3(); // glassRect()'s scratch point

/* ---------------------------------------------------------------- */
// Monitor
/* ---------------------------------------------------------------- */

// The monitor is on the desk (or there is none): the board and the camera controls are the player's
export function monitorIdle() {
	return !view.monitor || view.monitor.state === "idle";
}

// The data the monitor gets: setMonitor()'s, as it is
export function monitorInput(data) {
	return data;
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
	if (state !== "zoomed") { glassUp(); setCursor(""); } // Left in the middle of a drag (Escape): the drag ends and the cursor is back
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

// The cursor over the 3D view. On the canvas too: the camera controls give it a cursor of its own ("auto"), which would show
// over the container's
export function setCursor(cursor) {
	for (const element of [view.container, view.renderer.domElement]) {
		if (element.style.cursor !== cursor) { element.style.cursor = cursor; }
	}
}

// A mouse over the glass: the monitor's hover. On the desk a hand cursor; zoomed, the system's cursor is hidden and the
// terminal draws its own
// Zoomed, the terminal's own pointer stops at the glass's edge and waits there (glassNear) while the system's cursor
// goes on over the room, so the menu button and a click off the glass still work. While a press is held on the glass
// (glassDragging) the system's cursor stays hidden wherever it is, until the release
export function hoverGlass(e) {
	if (!view.monitor) { return; }
	const zoomed = view.monitor.state === "zoomed";
	const at = glassHit(e);
	const near = at || (zoomed ? glassNear(e) : null);
	if (near) { view.monitor.pointer("move", near.x, near.y); }
	else { view.monitor.pointer("out"); }
	setCursor(glassDragging || (at && zoomed) ? "none" : at ? "pointer" : "");
}

// The glass's box on the page, from its corners through the camera. null with no glass
function glassRect() {
	const glass = view.glass;
	if (!glass) { return null; }
	if (!glass.geometry.boundingBox) { glass.geometry.computeBoundingBox(); }
	const { min, max } = glass.geometry.boundingBox;
	const canvas = view.renderer.domElement.getBoundingClientRect();
	const rect = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
	for (const x of [min.x, max.x]) {
		for (const y of [min.y, max.y]) {
			for (const z of [min.z, max.z]) {
				corner.set(x, y, z).applyMatrix4(glass.matrixWorld).project(view.camera);
				const px = canvas.left + (corner.x + 1) / 2 * canvas.width, py = canvas.top + (1 - corner.y) / 2 * canvas.height;
				rect.left = Math.min(rect.left, px);
				rect.right = Math.max(rect.right, px);
				rect.top = Math.min(rect.top, py);
				rect.bottom = Math.max(rect.bottom, py);
			}
		}
	}
	return Number.isFinite(rect.left + rect.right + rect.top + rect.bottom) ? rect : null;
}

// The grid pixel on the glass nearest a pointer that is off it: the pointer pulled back to the glass's box on the page,
// then a little toward its middle until the glass is under it (its corners are round). null when the glass can't be found
export function glassNear(e) {
	const at = glassHit(e);
	if (at) { return at; }
	const rect = glassRect();
	if (!rect) { return null; }
	let x = Math.min(Math.max(e.clientX, rect.left), rect.right), y = Math.min(Math.max(e.clientY, rect.top), rect.bottom);
	const cx = (rect.left + rect.right) / 2, cy = (rect.top + rect.bottom) / 2;
	for (let i = 0; i < 12; i++) {
		const hit = glassHit({ clientX: x, clientY: y });
		if (hit) { return hit; }
		x += (cx - x) * 0.08;
		y += (cy - y) * 0.08;
	}
	return null;
}

/* ---------------------------------------------------------------- */
// Dragging & the Wheel on the Glass
/* ---------------------------------------------------------------- */

let glassDragging = false; // A PRESS THAT WENT DOWN ON THE ZOOMED GLASS IS STILL HELD: ITS MOVES ARE THE MONITOR'S (A WINDOW MOVED OR RESIZED, A SCROLL THUMB)
let glassPointer = null; // THAT PRESS'S POINTER ID, CAPTURED BY THE CANVAS SO ITS MOVES KEEP COMING (& THE CURSOR STAYS HIDDEN) OFF THE GLASS & OFF THE PAGE

// A press is held on the zoomed glass: nothing else in the room hovers or changes the cursor until it is let go
export function glassHeld() {
	return glassDragging;
}

// A press went down: zoomed and on the glass it is the terminal's (it brings the window under it to the front and may start a drag)
export function glassDown(e) {
	if (!view.monitor || view.monitor.state !== "zoomed") { return; }
	const at = glassHit(e);
	if (!at) { return; }
	glassDragging = true;
	glassPointer = e.pointerId;
	try { view.renderer.domElement.setPointerCapture(e.pointerId); } catch { /* A pointer that is already gone: the drag works without the capture */ }
	setCursor("none");
	view.monitor.pointer("down", at.x, at.y);
}

// The held press moved. Off the glass the drag goes on from the nearest point on it, and the system's cursor stays hidden
export function glassDrag(e) {
	if (!glassDragging || !view.monitor) { return; }
	setCursor("none");
	const at = glassNear(e);
	if (at) { view.monitor.pointer("drag", at.x, at.y); }
}

// The press was let go, anywhere (or the camera left the monitor under it)
export function glassUp() {
	if (!glassDragging) { return; }
	glassDragging = false;
	if (view) {
		try { view.renderer.domElement.releasePointerCapture(glassPointer); } catch { /* Already released with the pointer */ }
		if (view.monitor) { view.monitor.pointer("up"); }
	}
	glassPointer = null;
}

// The wheel over the zoomed glass scrolls the window under the pointer, in grid pixels (a line is the terminal's 9 px pitch)
export function glassWheel(e) {
	if (!view || !view.monitor || view.monitor.state !== "zoomed") { return; }
	const at = glassHit(e);
	if (!at) { return; }
	e.preventDefault();
	const unit = e.deltaMode === 1 ? 9 : 0.25; // LINES, ELSE CSS PIXELS (THE GLASS IS SHOWN AT ABOUT 4 TIMES ITS GRID)
	view.monitor.pointer("wheel", at.x, at.y, { dx: Math.round(e.deltaX * unit), dy: Math.round(e.deltaY * unit) });
}
