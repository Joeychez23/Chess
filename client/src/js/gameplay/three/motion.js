// Owns 3D piece holding and motion behavior
import {
	view, requestRender, place, setYaw, storedYaw, center, fileOf, rowOf, yawSide, yawToward, squareUnder, raycaster, table, tablePoint,
	toCell, shadeOnGround, faceTravel, removePiece, addPiece, slotOf, homeYaw, setFacing
} from "./index.js";
import { LIFT_HEIGHT, CELL_SIZE, HOP_HEIGHT, SINK_DEPTH } from "./constants.js";
import { updateShadow, setOpacity } from "./pieces.js";
import { MathUtils } from "three";
// The 2D board's timings, so a move takes the same time on both boards.
import { easeInOut, hopArc, slideDuration, slideDelay, RESTART_SLIDE_MS } from "../animate/timing.js";

/**
 * @description Lifts the piece the player picked up, like the 2D board: clicked, it floats over its square until it's put down or moved,
 * dragged (pressed & moved past the drag threshold), it floats over the square under the pointer, the one a drop lands on (squareUnder),
 * or over the edge square nearest the pointer off the board (a drop there puts it back).
 * No animation, the 2D lift is instant too, so reduce motion needs nothing.
 * A dropped piece that's moving slides down from where it was let go (animateMove), call this after it
 * @param  {[string|null]} square [the held piece's square, null when nothing is held (it's put back down)]
 * @param  {[boolean]} dragging [the press is still down, so moving the pointer drags it]
 */
export function setHeld(square, dragging) {
	if (!view) { return; }
	const mesh = (square && view.pieces.get(square)) || null;
	const held = view.held;
	// Nothing changed: a drag in progress keeps following the pointer.
	if (held && held.mesh === mesh && held.dragging === Boolean(dragging)) { return; }
	if (held && held.mesh !== mesh) { putDownHeld(); }
	view.held = mesh ? { mesh, dragging: Boolean(dragging), following: false } : null;
	if (view.held) { liftHeld(); }
}

// Lets go of the held piece and stands it on `square` at once, the way a normal game's drop lands (a Chess Cards drag
// dropped on its target does the same). It is still its own square's piece until the server answers: the move's slide
// then starts and ends there, and if the move is refused, setHeld() then putDownHeld() sends it home.
export function dropHeld(square) {
	if (!view || !view.held) { return; }
	const { mesh } = view.held;
	view.held = null;
	mesh.position.set(center(fileOf(square)), 0, center(rowOf(square)));
	updateShadow(mesh);
	requestRender();
}

// Puts the held piece back on its square, unless it is already sliding away (a dropped move) or gone (taken, or synced away).
export function putDownHeld() {
	const held = view.held;
	view.held = null;
	if (!held) { return; }
	const { mesh } = held;
	if ([...view.anims].some((anim) => anim.mesh === mesh) || view.pieces.get(mesh.userData.square) !== mesh) { requestRender(); return; }
	place(mesh, mesh.userData.square);
	// A drag may have turned it.
	setYaw(mesh, storedYaw(mesh), false);
	requestRender();
}

// Floats the held piece over its square, or over the point it is dragged to (dragPoint).
export function liftHeld() {
	const { mesh, following } = view.held;
	const at = following ? dragPoint() : null;
	const square = mesh.userData.square;
	mesh.position.set(at ? at.x : center(fileOf(square)), LIFT_HEIGHT, at ? at.z : center(rowOf(square)));
	// A piece dragged more than half a square off its line faces the way it is dragged, as on the 2D board:
	// a knight sideways off its file (2D drawKnight), any other piece forward or back off its rank (2D drawPiece).
	if (mesh.userData.type === "n") {
		const dx = at ? at.x - center(fileOf(square)) : 0;
		setYaw(mesh, Math.abs(dx) > CELL_SIZE / 2 ? yawSide(dx > 0) : storedYaw(mesh), false);
	} else {
		const dz = at ? at.z - center(rowOf(square)) : 0;
		setYaw(mesh, Math.abs(dz) > CELL_SIZE / 2 ? yawToward(dz < 0) : storedYaw(mesh), false);
	}
	updateShadow(mesh);
	requestRender();
}

// Where a dragged piece floats: the center of the square under the pointer (the 2D board snaps it to squares too). Off the board, the
// edge square nearest the point under the pointer on the table, so it stays on the board. Null when the pointer isn't over the table
// (it points at the horizon).
function dragPoint() {
	const pointerEvent = { clientX: view.pointerAt.x, clientY: view.pointerAt.y };
	const square = squareUnder(pointerEvent);
	if (square) { return { x: center(fileOf(square)), z: center(rowOf(square)) }; }
	// squareUnder() has just aimed the raycaster at the pointer, so its ray is reused here.
	if (!raycaster.ray.intersectPlane(table, tablePoint)) { return null; }
	return { x: center(toCell(tablePoint.x)), z: center(toCell(tablePoint.z)) };
}

/* ---------------------------------------------------------------- */
// Animation
/* ---------------------------------------------------------------- */

// A toppling piece (playBoardStep) takes this long to fall onto its side...
const TOPPLE_MS = 600;
// ...and then lies there this long before it fades out.
const TOPPLE_REST_MS = 300;

// Puts a moving piece where the clock says, and ends the animation once it reaches progress 1 (now = Infinity finishes it at once).
// The clock starts on the animation's first frame plus its `delay` (a knight's pause before it hops).
// - `ease`: the restart slide's slow start and landing.
// - `fade`: 1 fades it in; -1 fades it out and sinks it into the board.
// - `tip`: -1 or 1 topples it toward the a-file or the h-file (it needs rotation order "ZYX", see playBoardStep): slowly at first,
//   like a faint, and a quarter turn by the end.
export function stepAnim(anim, now) {
	if (anim.start === null) { anim.start = now + anim.delay; }
	const t = now === Infinity || !anim.duration ? 1 : MathUtils.clamp((now - anim.start) / anim.duration, 0, 1);
	const along = anim.ease ? easeInOut(t) : t;
	const { mesh, x0, z0, x1, z1, y0, y1 } = anim;
	let y = y0 + (y1 - y0) * along + (anim.hop ? hopArc(t) * HOP_HEIGHT : 0) + anim.arc * hopArc(t);
	if (anim.fade < 0) { y -= t * SINK_DEPTH; }
	mesh.position.set(x0 + (x1 - x0) * along, y, z0 + (z1 - z0) * along);
	// It turns about the edge of its foot on the board. r is the piece's widest reach from its axis,
	// so no part of it goes through the board.
	if (anim.tip) {
		const a = (Math.PI / 2) * t * t, { min, max } = mesh.geometry.boundingBox, r = mesh.scale.y * Math.max(-min.x, max.x, -min.z, max.z);
		mesh.rotation.z = -anim.tip * a;
		mesh.position.x += anim.tip * r * (1 - Math.cos(a));
		mesh.position.y += r * Math.sin(a);
	}
	// setOpacity() also puts the shadow under the piece.
	if (anim.fade) { setOpacity(mesh, anim.fade > 0 ? t : 1 - t); }
	else { updateShadow(mesh); }
	// To or from a taken-pieces pile: the shadow follows the surface the piece is going to or leaving.
	if (y0 !== 0 || y1 !== 0) {
		mesh.userData.ground = y0 + (y1 - y0) * along;
		shadeOnGround(mesh);
	}
	if (t < 1) { return; }
	view.anims.delete(anim);
	// Called now rather than in a .then(), so a syncFromBoard() or unmount() right after it sees the final pieces.
	if (anim.onEnd) { anim.onEnd(); }
	anim.done();
}

// Ends every running animation at once. It loops until none is left, because ending one can start another (a topple starts its fade),
// and a board that can't draw must not be left with any.
export function finishAnims() {
	while (view.anims.size) { for (const anim of [...view.anims]) { stepAnim(anim, Infinity); } }
}

// Starts an animation of `mesh` from where it is drawn now to (x1, z1) at height y1 (the board's, 0, if not given),
// and resolves when it ends.
// `arc` is how much higher it is halfway there: a flight to or from a pile.
export function animate(mesh, x1, z1, { hop = false, ease = false, fade = 0, delay = 0, duration, onEnd, y1 = 0, arc = 0, tip = 0 }) {
	const x0 = mesh.position.x, y0 = mesh.position.y, z0 = mesh.position.z;
	// Unseen until its first frame.
	if (fade > 0) { setOpacity(mesh, 0); }
	return new Promise(function (done) {
		view.anims.add({ mesh, x0, y0, z0, x1, y1, z1, hop, arc, ease, fade, delay, duration, onEnd, tip, start: null, done });
		requestRender();
	});
}

// Moves a mesh to `square` and slides (or hops) it there from where it is drawn now.
// `options` are animate()'s; the duration defaults to a move's.
function slide(mesh, square, options) {
	const x0 = mesh.position.x, z0 = mesh.position.z;
	// Only if it is still that square's piece: another piece may already have slid in there.
	if (view.pieces.get(mesh.userData.square) === mesh) { view.pieces.delete(mesh.userData.square); }
	place(mesh, square);
	const x1 = mesh.position.x, z1 = mesh.position.z;
	const squares = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0)) / CELL_SIZE;
	// place() jumped it to the square: put it back where it was for the first frame.
	mesh.position.set(x0, 0, z0);
	updateShadow(mesh);
	return animate(mesh, x1, z1, { duration: slideDuration(squares, options.hop), ...options });
}

/**
 * @description Moves the piece on from to to, sliding (knights hop). Handles captures, castling's rook, en passant & promotion from
 * the pieces on the board, so call it before the next syncFromBoard(). Nothing on from: resolves at once
 * @param  {[string]} from ["e2"]
 * @param  {[string]} to ["e4"]
 * @param  {[string]} promotion ["q", "r", "b" or "n" when a pawn promotes, the pawn turns into it on arrival]
 * @param  {[string|null]} taken [a Chess Cards board step's: the square of the piece the move takes as the engine told it,
 * null for none, so nothing is guessed (a fog-hidden piece taken isn't on the board);
 * not given: from the pieces on the board, en passant the pawn beside it]
 * @return {[Promise<void>]} [resolves when every piece has stopped]
 */
export function animateMove(from, to, promotion, taken) {
	if (!view || !view.pieces.has(from)) { return Promise.resolve(); }
	finishAnims();
	const mesh = view.pieces.get(from);
	const { type, color } = mesh.userData;
	const fileStep = fileOf(to) - fileOf(from);
	let captured = view.pieces.get(taken === undefined ? to : taken);
	// En passant: the pawn taken stands beside the destination.
	if (taken === undefined && type === "p" && fileStep !== 0 && !captured) { captured = view.pieces.get(to[0] + from[1]); }
	const knight = type === "n";
	// A Chess Cards drop already stands on `to` (dropHeld): no hop in place, and no wait for one.
	const landed = mesh.position.y === 0 && mesh.position.x === center(fileOf(to)) && mesh.position.z === center(rowOf(to));
	// It turns as it starts sliding, like the 2D board.
	faceTravel(mesh, from, to);
	const moves = [slide(mesh, to, { hop: knight && !landed, delay: landed ? 0 : slideDelay(knight), onEnd: function () {
		if (promotion && type === "p") {
			removePiece(mesh);
			place(addPiece(promotion, color), to);
		}
	} })];
	// The captured piece leaves the board's map at once; setTaken() then flies it to its pile. One that is never told to is removed by
	// the next syncFromBoard().
	if (captured) {
		// Only if it is still that square's piece, not the piece that just slid in there.
		if (view.pieces.get(captured.userData.square) === captured) { view.pieces.delete(captured.userData.square); }
		captured.userData.flight = {
			delay: slideDelay(knight),
			duration: slideDuration(Math.max(Math.abs(fileStep), Math.abs(rowOf(to) - rowOf(from))), knight)
		};
		view.arriving.add(captured);
		// It may be see-through because the pointer is over it (tileHover.js): it leaves the board solid.
		if (captured.userData.opacity < 1) { setOpacity(captured, 1); }
	}
	// Castling: the rook jumps over the king.
	if (type === "k" && Math.abs(fileStep) === 2) {
		const rook = view.pieces.get((fileStep > 0 ? "h" : "a") + from[1]);
		if (rook) { moves.push(slide(rook, (fileStep > 0 ? "f" : "d") + from[1], {})); }
	}
	return Promise.all(moves).then(() => {});
}

/**
 * @description One of a Chess Cards answer's board steps (gameplay/cards/boardShow.js boardSteps), resolving when it has ended:
 * - a move slides or hops as a drawn one does (animateMove: its own capture, the one taken named, castling's rook, a promotion);
 * - a swap slides the pieces on a & b to each other's square together without turning (Swap: neither is taken);
 * - a take sinks the piece on its square as it fades out (as a piece with no square leaves on a restart, glideHome);
 * - out slides the piece on from to to without turning (piece: a hidden one is put on from first) & back slides it home again
 *   (piece: then it's removed);
 * - a topple tips the piece on its square over onto its side toward its nearer side of the board (a forfeit: All or Nothing's lost hand),
 *   it lies there a moment, then leaves as a take does;
 * - a handover slides the piece on from to to without turning & it turns to its new colour c as it lands (Opposing Finality; one
 *   already c's is another piece than the one handed over: it stays).
 * Nothing there, or a board that can't draw: at once. A new kind of step is one more case here
 * @param  {[object]} step [{ op: "move", from, to, taken, promotion } | { op: "swap", a, b } | { op: "take" | "topple", square }
 * | { op: "out" | "back", from, to, piece } | { op: "handover", from, to, c }]
 * @return {[Promise<void>]} [resolves when it has ended]
 */
export function playBoardStep(step) {
	// A lost WebGL context draws no frames, so an animation started now would never end.
	if (!view || view.lost) { return Promise.resolve(); }
	// No `taken` means the engine told of no capture, so none is guessed.
	if (step.op === "move") { return animateMove(step.from, step.to, step.promotion, step.taken || null); }
	// slide() moves each piece in view.pieces: the first overwrites the second's square, and the second then takes the first's.
	if (step.op === "swap") {
		const a = view.pieces.get(step.a), b = view.pieces.get(step.b);
		return Promise.all([a && slide(a, step.b, {}), b && slide(b, step.a, {})]).then(() => {});
	}
	// A piece hidden in the fog (the bishop) shows for its shot.
	if (step.op === "out" && step.piece && !view.pieces.has(step.from)) { place(addPiece(step.piece.t, step.piece.c), step.from); }
	const mesh = view.pieces.get(step.square || step.from);
	if (!mesh) { return Promise.resolve(); }
	// y1 is where it starts: a toppled piece lies above the board, and sinks from there as far as a take does.
	const leave = (delay) => animate(mesh, mesh.position.x, mesh.position.z, {
		fade: -1, delay, duration: RESTART_SLIDE_MS, y1: mesh.position.y, onEnd: () => removePiece(mesh)
	});
	if (step.op === "take" || step.op === "topple") { view.pieces.delete(step.square); }
	if (step.op === "take") { return leave(0); }
	if (step.op === "topple") {
		// The tip turns it about the board's axis after its yaw (setYaw), which stays as it was.
		mesh.rotation.order = "ZYX";
		// The fade starts in onEnd rather than in a .then(), so finishAnims() ends the fade too.
		return new Promise((done) => animate(mesh, mesh.position.x, mesh.position.z, {
			tip: fileOf(step.square) < 4 ? -1 : 1, duration: TOPPLE_MS, onEnd: () => leave(TOPPLE_REST_MS).then(done)
		}));
	}
	if (step.op === "handover") {
		if (mesh.userData.color === step.c) { return Promise.resolve(); }
		// It changes colour on arrival, the way a promotion turns its pawn.
		return slide(mesh, step.to, { onEnd: function () { removePiece(mesh); place(addPiece(mesh.userData.type, step.c), step.to); } });
	}
	// "back" with a piece: the hidden one goes back into the fog when it lands.
	const hide = step.op === "back" && step.piece;
	return slide(mesh, step.to, {
		onEnd: hide ? function () { if (view.pieces.get(step.to) === mesh) { view.pieces.delete(step.to); } removePiece(mesh); } : undefined
	});
}

/**
 * @description Takes a move back, the reverse of animateMove (a replay's step back): the piece on to slides back to from without turning
 * (a knight hops backwards, setFacing has its facing from before the move), a promoted piece turns back into its pawn first, castling's
 * rook goes home & a taken piece is put back once the piece has landed (en passant: beside it). Call it before the next syncFromBoard()
 * @param  {[object]} move [{ from, to, promotion, piece, color, captured, flags } (gameplay/utils stepBetween), flags: chess.js's,
 * k / q castles, e en passant]
 * @param  {[object]} facings [the facings of the position before the move, as setFacing takes them, for the piece that comes back]
 * @return {[Promise<void>]} [resolves when the piece has landed, nothing on to: at once]
 */
export function animateUndo(move, facings) {
	if (!view || !view.pieces.has(move.to)) { return Promise.resolve(); }
	finishAnims();
	let mesh = view.pieces.get(move.to);
	// Back to the pawn that promoted.
	if (move.promotion) {
		removePiece(mesh);
		mesh = addPiece("p", move.color);
		place(mesh, move.to);
	}
	const knight = mesh.userData.type === "n";
	// Where the taken piece stood; en passant, that is the pawn beside the destination.
	const square = move.flags?.includes("e") ? move.to[0] + move.from[1] : move.to;
	const takenColor = move.color === "w" ? "b" : "w";
	const land = function (taken) {
		// Not faded in: this runs inside finishAnims() when a jump cuts the slide short, and a new animation would outlive the sync.
		place(taken, square);
		if (facings) { setFacing(facings); }
		requestRender();
	};
	// The pile's top piece of the taken kind; it flies back to its square.
	let back = null;
	if (move.captured) {
		for (const [key, m] of view.taken) {
			if (m.userData.type === move.captured && m.userData.color === takenColor && (!back || slotOf(key) > slotOf(back.userData.spot))) {
				back = m;
			}
		}
	}
	// The taken piece comes back once the moving piece has landed, if the pile had none of its kind to fly back.
	const restore = function () {
		if (move.captured && !back) { land(addPiece(move.captured, takenColor)); }
	};
	const moves = [slide(mesh, move.from, { hop: knight, delay: slideDelay(knight), onEnd: restore })];
	if (back) {
		const tx = center(fileOf(square)), tz = center(rowOf(square));
		// The undone move's length, so the piece flies back in the time it flew out.
		const squares = Math.max(Math.abs(fileOf(move.to) - fileOf(move.from)), Math.abs(rowOf(move.to) - rowOf(move.from)));
		view.taken.delete(back.userData.spot);
		back.userData.spot = undefined;
		back.rotation.y = homeYaw(back.userData.type, back.userData.color);
		const flying = back;
		moves.push(animate(flying, tx, tz, {
			y1: 0,
			arc: CELL_SIZE * 1.5,
			delay: slideDelay(knight),
			duration: slideDuration(squares, knight),
			onEnd: function () { flying.userData.ground = undefined; land(flying); }
		}));
	}
	// Castling: the rook goes home too.
	if (move.flags?.includes("k") || move.flags?.includes("q")) {
		const kingSide = move.flags.includes("k");
		const rook = view.pieces.get((kingSide ? "f" : "d") + move.from[1]);
		if (rook) { moves.push(slide(rook, (kingSide ? "h" : "a") + move.from[1], {})); }
	}
	return Promise.all(moves).then(() => {});
}

/**
 * @description Restart & Rematch: every piece glides home to the new position in the 2D slide's time (RESTART_SLIDE_MS) on a slow start
 * & landing, pairing each square with a piece of the same color & type, closest first (a bishop stays on its square color).
 * Knights that move hop. A square with no piece left for it fades in, a piece with no square fades out where it is
 * @param  {[Chess]} chessInst [the new game, only its board() is read]
 * @return {[Promise<void>]} [resolves when every piece is home]
 */
export function glideHome(chessInst) {
	if (!view) { return Promise.resolve(); }
	finishAnims();
	// Each target is { square, type, color }.
	const targets = chessInst.board().flat().filter(Boolean);
	const meshes = [...view.pieces.values()];
	const light = (square) => (fileOf(square) + rowOf(square)) % 2 === 0;
	const pairs = [];
	targets.forEach(function (p, t) {
		meshes.forEach(function (mesh, m) {
			if (mesh.userData.type !== p.type || mesh.userData.color !== p.color) { return; }
			const from = mesh.userData.square;
			let distance = Math.hypot(fileOf(p.square) - fileOf(from), rowOf(p.square) - rowOf(from));
			// A bishop stays on its square colour: a pairing across colours is pushed behind every same-colour one.
			if (p.type === "b" && light(from) !== light(p.square)) { distance += 100; }
			pairs.push({ t, m, distance });
		});
	});
	pairs.sort((a, b) => a.distance - b.distance);
	// Mesh index -> target index.
	const target = new Map();
	// Target indexes that have a piece.
	const filled = new Set();
	for (const { t, m } of pairs) {
		if (target.has(m) || filled.has(t)) { continue; }
		target.set(m, t);
		filled.add(t);
	}
	view.pieces.clear();
	const glides = [];
	meshes.forEach(function (mesh, m) {
		// No square for it: it fades out where it is.
		if (!target.has(m)) {
			const { x, z } = mesh.position;
			glides.push(animate(mesh, x, z, { fade: -1, duration: RESTART_SLIDE_MS, onEnd: () => removePiece(mesh) }));
			return;
		}
		const square = targets[target.get(m)].square;
		const moves = square !== mesh.userData.square;
		glides.push(slide(mesh, square, { hop: moves && mesh.userData.type === "n", ease: true, duration: RESTART_SLIDE_MS }));
	});
	targets.forEach(function (p, t) {
		if (filled.has(t)) { return; }
		// No piece was left for this square: a new one fades in on it.
		const mesh = addPiece(p.type, p.color);
		place(mesh, p.square);
		glides.push(animate(mesh, mesh.position.x, mesh.position.z, { fade: 1, duration: RESTART_SLIDE_MS }));
	});
	return Promise.all(glides).then(() => {});
}
