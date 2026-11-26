/*
 *  index.js  --  chess frontend
 *	Renderer
 *	The one place that picks the board the player sees: the 2D canvas or the 3D board (three/). The rest of the game calls
 *	drawBoard() and setView() and never checks which one is on.
 *	On 3D the 2D canvas keeps drawing, laid clear over the 3D board with only its trays showing: its frames still run the game
 *	(tiles, slides, trays). Then the 3D board is set to match chessInst, game.viewColor (the camera's side) and the 2D highlights.
 *	A 3D board that can't load or mount (no WebGL, offline) leaves the player on 2D. One that loses its WebGL context (iPhones do
 *	when the page is backgrounded) is put up again when the browser gives it back, or falls back to 2D when it keeps losing it.
 *	Input (gameplay/input) only asks here for the square under the pointer; its handlers are the same on both boards
 *	(addBoardListener).
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, canvas, chessInst, requestFrame } = require("../state/index.js");
const statusPref = require("../cards/statusPref.js"); // How a Chess Cards piece's statuses show: effects or badges (three/statusFx)
statusPref.onChange(handleStatusPrefChange);
// What moved out, answered from here by the same names. The lifecycle goes first: it loads the draw and the table, so every module
// is first loaded in the order it was when this was one file
export { VIEWS, setView, can3D, onViewChange } from "./renderer.lifecycle.js";
export { drawBoard } from "./renderer.draw.js";
export {
	onCardPick, onTablePick, holdTablePiece3D, dropTablePiece3D, setTable3D, dealDuel3D, flipDuel3D, endDuel3D, boardStep3D, toggleTablePile3D,
	tablePileOpen3D, showTableButtons3D, focusTableButton3D, pressTableButton3D,
} from "./renderer.table.js";
const rendererState = require("./renderer.state.js");
const { VIEWS, boardListeners } = require("./renderer.lifecycle.js");
const { syncTaken3D } = require("./renderer.draw.js");
Object.assign(rendererState.calls, { syncTaken3D, currentView }); // Before anything can run: both are only called after load

// The next frame swaps the statuses. init() calls no listener: drawBoard reads current()
function handleStatusPrefChange() {
	game.refresh = true;
	requestFrame();
}

/* ---------------------------------------------------------------- */
// Monitor
/* ---------------------------------------------------------------- */
/**
 * @description What the 3D room's monitor works with, from gameplay/monitor (it can't be required here: it requires the menu,
 * which requires this file). Every 3D board put up from now on gets them
 * @param  {[object]} hooks [{ handlers, announce(text), onChange({ ready, state }) } (three/index.js mount()'s monitor option)
 * and data(): the channels' data]
 */
export function setMonitorHooks(hooks) {
	rendererState.state.monitorHooks = hooks;
}

/**
 * @description Zooms in to the 3D room's monitor (the menu's Monitor item)
 * @return {[boolean]} [false on 2D, with no monitor or before it has the game's data]
 */
export function enterMonitor3D() {
	return rendererState.state.board3D ? rendererState.state.board3D.enterMonitor() : false;
}

/**
 * @description Back to the desk from the monitor
 * @return {[Promise<void>]} [resolves once it's on the desk, at once on 2D or when it already is]
 */
export function leaveMonitor3D() {
	return rendererState.state.board3D ? rendererState.state.board3D.leaveMonitor() : Promise.resolve();
}

/**
 * @description The 3D room's monitor's state
 * @return {[string|null]} ["idle", "zooming", "zoomed" or "leaving", null on 2D or with no monitor]
 */
export function monitorState3D() {
	return rendererState.state.board3D ? rendererState.state.board3D.monitorState() : null;
}

/**
 * @description The keyboard's focus came to the 3D room's monitor or left it (gameplay/monitor's stop). Does nothing on 2D
 * @param  {[boolean]} on
 */
export function focusMonitor3D(on) {
	if (rendererState.state.board3D) { rendererState.state.board3D.focusMonitor(on); }
}

/**
 * @description The monitor's face reacts to a move or the result (AI games, gameplay/bots faceFor and endFaceFor). Does nothing
 * on 2D, but a result's face is remembered for a 3D board put up later
 * @param  {[string]} name ["happy" | "sad" | "angry" | "won" | "lost" | "neutral" | null (no change)]
 */
export function setFace(name) {
	if (!name || name === rendererState.state.heldFace) { return; } // The mating move already showed the result: game over doesn't start it again
	rendererState.state.heldFace = name === "won" || name === "lost" ? name : null;
	if (rendererState.state.board3D) { rendererState.state.board3D.setFace(name); }
}

/* ---------------------------------------------------------------- */
// Pieces
/* ---------------------------------------------------------------- */
/**
 * @description The next position the 3D board is given is set at once, not slid (a replay's jump, a held key). Does nothing on 2D
 */
export function skipNextAnimation3D() {
	if (rendererState.state.board3D) { rendererState.state.skipAnimation = true; }
}

/**
 * @description Restart and Rematch on 3D: the pieces glide home to chessInst (already the new game) in the 2D slide's time,
 * pieces with no match fade in or out. With reduce motion on they're just set. Does nothing on 2D
 */
export function glideHome3D() {
	if (!rendererState.state.board3D) { return; }
	rendererState.state.shownFen = chessInst.fen(); // So drawBoard doesn't set them at once when the new game takes over
	if (game.reduceMotion) { rendererState.state.board3D.syncFromBoard(chessInst); }
	else { rendererState.state.board3D.glideHome(chessInst); }
}

/**
 * @description Reduce motion was just turned on: 3D's camera turn and piece slides in progress land at once. Reduce motion keeps
 * 3D (it doesn't switch to 2D), it only takes the motion out: Flip Board and Reset View set the camera, moves and restarts set the
 * pieces (drawBoard, glideHome3D). Only the player's own camera drags still move it. Does nothing on 2D
 */
export function stopMotion3D() {
	if (rendererState.state.board3D) { rendererState.state.board3D.stopMotion(); }
}

/**
 * @description Resolves once the 3D board has drawn a frame with its squares in (the page fades in on it). At once on 2D
 * @return {[Promise<void>]}
 */
export function whenDrawn3D() {
	return rendererState.state.board3D ? rendererState.state.board3D.whenDrawn() : Promise.resolve();
}

/* ---------------------------------------------------------------- */
// Camera
/* ---------------------------------------------------------------- */
/**
 * @description Which board is on
 * @return {[string]} [VIEWS.TWO_D or VIEWS.THREE_D]
 */
export function currentView() {
	return rendererState.state.board3D ? VIEWS.THREE_D : VIEWS.TWO_D;
}

/**
 * @description Reset View: the 3D camera back to its default for the side the player looks from. Does nothing on 2D
 */
export function resetCamera() {
	if (rendererState.state.board3D) { rendererState.state.board3D.resetCamera(game.viewColor); }
}

/* ---------------------------------------------------------------- */
// Input
/* ---------------------------------------------------------------- */
/**
 * @description Listens on the board the player sees: the 2D canvas now and every 3D board put up later (its container goes away
 * with it)
 * @param  {[string]} type ["click", "touchstart", ...]
 * @param  {[function]} handler [the same handler for both boards]
 * @param  {[object]} options [addEventListener options]
 */
export function addBoardListener(type, handler, options) {
	boardListeners.push([type, handler, options]);
	canvas.addEventListener(type, handler, options);
	if (rendererState.state.container) { rendererState.state.container.addEventListener(type, handler, options); }
}

/**
 * @description The square under a pointer on the 3D board
 * @param  {[MouseEvent|object]} e [anything with clientX and clientY]
 * @return {[string|null]} ["e4", null off the board or on 2D]
 */
export function squareUnder3D(e) {
	return rendererState.state.board3D ? rendererState.state.board3D.squareUnder(e) : null;
}

/**
 * @description A camera gesture (orbit, zoom) is in progress on the 3D board, so pointer input must not touch the pieces
 * @return {[boolean]}
 */
export function isCameraGesture() {
	return Boolean(rendererState.state.board3D && rendererState.state.board3D.isCameraGesture());
}
