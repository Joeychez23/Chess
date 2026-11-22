// Owns the 3D board's tile picking & hover rules (Task 20e, segment C1). No three.js here: tileHover.js draws what these decide

export const REST_MS = 150; // HOW LONG THE POINTER RESTS BEFORE THE PIECES COVERING IT FADE: A SWEEP ACROSS THE BOARD FADES NOTHING
export const FADE_OPACITY = 0.25; // A PIECE THAT COVERS THE POINTER
export const FADE_OUT_MS = 380; // IT TURNS SEE-THROUGH SLOWLY...
export const FADE_IN_MS = 240; // ...& COMES BACK A LITTLE FASTER

const FILES = "abcdefgh";
const cell = (v, size) => Math.min(7, Math.max(0, Math.floor((v + size / 2) / (size / 8))));

/**
 * @description The tile a point on the board's surface is in. The board is picked by tile, never through a piece's body
 * @param  {[number]} x [world x, the a-file at -size / 2]
 * @param  {[number]} z [world z, rank 8 at -size / 2]
 * @param  {[number]} size [the board's side, world units]
 * @return {[string]} ["e4"]
 */
export function tileAt(x, z, size) {
	return FILES[cell(x, size)] + (8 - cell(z, size));
}

/**
 * @description Whether a tile is one the player can act on: only while they can act at all (their turn, the game going), a marked target of the piece or card in hand or a piece they can pick up
 * @param  {[object]} tile { acting: the player can act (setPickable got a list), marked: a legal, capture or cards mark is on it, pickable: its piece is one they can pick up }
 * @return {[boolean]}
 */
export function canAct({ acting, marked, pickable }) {
	return Boolean(acting) && (Boolean(marked) || Boolean(pickable));
}

/**
 * @description A normal game's squares the player can pick a piece up from: their own colour's (not the camera's side: Flip Board changes that), on their turn while the board takes their moves
 * @param  {[object]} game { board: chess.js board(), player: their colour, turn: the colour to move, open: the board takes their moves (not over, a replay, locked for a move sent, or promoting) }
 * @return {[string[]|null]} [the squares, null when they can't act]
 */
export function pickable({ board, player, turn, open }) {
	if (!open || turn !== player) { return null; }
	return board.flat().filter((p) => p && p.color === player).map((p) => p.square);
}

/**
 * @description Whether the board has the mouse's hover. A press on an empty tile starts the camera controls but is no camera gesture until it moves past DRAG_PX, so it keeps the hover
 * @param  {[object]} at { pointer: the mouse is on the canvas, gesture: a camera gesture has it, covered: the glass, a hand card, a pile or a promotion card is under it }
 * @return {[boolean]}
 */
export function hoverOn({ pointer, gesture, covered }) {
	return Boolean(pointer) && !gesture && !covered;
}

/**
 * @description The pieces that turn see-through: those whose body covers the pointer, once it has rested on a tile the player can act on
 * @param  {[object]} hover { tile: the hovered tile or null, rested, actionable, bodies: the squares of the pieces under the pointer, held: the square of the piece in hand or null }
 * @return {[string[]]} [their squares]
 */
export function fadeList({ tile, rested, actionable, bodies, held }) {
	if (!tile || !rested || !actionable) { return []; }
	return bodies.filter((square) => square !== tile && square !== held);
}

/**
 * @description How long a fade from one opacity to another takes: a part of the way takes that part of the time, so one turned round midway keeps its pace
 * @param  {[number]} from [opacity now]
 * @param  {[number]} to [FADE_OPACITY or 1]
 * @param  {[boolean]} reduce [reduced motion: at once]
 * @return {[number]} [ms]
 */
export function fadeMs(from, to, reduce) {
	if (reduce) { return 0; }
	return (to < from ? FADE_OUT_MS : FADE_IN_MS) * Math.abs(to - from) / (1 - FADE_OPACITY);
}
