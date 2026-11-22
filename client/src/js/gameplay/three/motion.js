// Owns 3D piece holding and motion behavior
import { view, requestRender, place, setYaw, storedYaw, center, fileOf, rowOf, yawSide, yawToward, squareUnder, raycaster, table, tablePoint, toCell, shadeOnGround, faceTravel, removePiece, addPiece, slotOf, homeYaw, setFacing } from "./index.js";
import { LIFT_HEIGHT, CELL_SIZE, HOP_HEIGHT, SINK_DEPTH } from "./constants.js";
import { updateShadow, setOpacity } from "./pieces.js";
import { MathUtils } from "three";
import { easeInOut, hopArc, slideDuration, slideDelay, RESTART_SLIDE_MS } from "../animate/timing.js"; // THE 2D BOARD'S TIMINGS, SO A MOVE TAKES THE SAME TIME ON BOTH

/**
 * @description Lifts the piece the player picked up, like the 2D board: clicked, it floats over its square until it's put down or moved,
 * dragged (pressed & moved past the drag threshold), it floats over the square under the pointer, the one a drop lands on (squareUnder),
 * or over the edge square nearest the pointer off the board (a drop there puts it back). No animation, the 2D lift is instant too, so reduce motion needs nothing.
 * A dropped piece that's moving slides down from where it was let go (animateMove), call this after it
 * @param  {[string|null]} square [the held piece's square, null when nothing is held (it's put back down)]
 * @param  {[boolean]} dragging [the press is still down, so moving the pointer drags it]
 */
export function setHeld(square, dragging) {
	if (!view) { return; }
	const mesh = (square && view.pieces.get(square)) || null;
	const held = view.held;
	if (held && held.mesh === mesh && held.dragging === Boolean(dragging)) { return; } // UNCHANGED: A DRAG KEEPS FOLLOWING
	if (held && held.mesh !== mesh) { putDownHeld(); }
	view.held = mesh ? { mesh, dragging: Boolean(dragging), following: false } : null;
	if (view.held) { liftHeld(); }
}

// LETS GO OF THE HELD PIECE & STANDS IT ON square AT ONCE, AS A NORMAL GAME'S DROP LANDS (A CHESS CARDS DRAG DROPPED ON ITS TARGET, USER RULINGS 2026-11-22). IT IS STILL ITS OWN SQUARE'S PIECE
// UNTIL THE SERVER ANSWERS: THE MOVE'S SLIDE THEN STARTS & ENDS THERE, setHeld() THEN putDownHeld() SENDS IT HOME
export function dropHeld(square) {
	if (!view || !view.held) { return; }
	const { mesh } = view.held;
	view.held = null;
	mesh.position.set(center(fileOf(square)), 0, center(rowOf(square)));
	updateShadow(mesh);
	requestRender();
}

// PUTS THE HELD PIECE BACK ON ITS SQUARE, UNLESS IT'S ALREADY SLIDING AWAY (A DROPPED MOVE) OR GONE (TAKEN, SYNCED AWAY)
export function putDownHeld() {
	const held = view.held;
	view.held = null;
	if (!held) { return; }
	const { mesh } = held;
	if ([...view.anims].some((anim) => anim.mesh === mesh) || view.pieces.get(mesh.userData.square) !== mesh) { requestRender(); return; }
	place(mesh, mesh.userData.square);
	setYaw(mesh, storedYaw(mesh), false); // A DRAG MAY HAVE TURNED IT
	requestRender();
}

// FLOATS THE HELD PIECE OVER ITS SQUARE, OR WHERE IT'S DRAGGED (dragPoint)
export function liftHeld() {
	const { mesh, following } = view.held;
	const at = following ? dragPoint() : null;
	const square = mesh.userData.square;
	mesh.position.set(at ? at.x : center(fileOf(square)), LIFT_HEIGHT, at ? at.z : center(rowOf(square)));
	if (mesh.userData.type === "n") { // DRAGGED OFF ITS FILE: FACES THE WAY IT'S DRAGGED (2D's drawKnight)
		const dx = at ? at.x - center(fileOf(square)) : 0;
		setYaw(mesh, Math.abs(dx) > CELL_SIZE / 2 ? yawSide(dx > 0) : storedYaw(mesh), false);
	} else { // DRAGGED OFF ITS RANK: FACES THE WAY IT'S DRAGGED (2D's drawPiece)
		const dz = at ? at.z - center(rowOf(square)) : 0;
		setYaw(mesh, Math.abs(dz) > CELL_SIZE / 2 ? yawToward(dz < 0) : storedYaw(mesh), false);
	}
	updateShadow(mesh);
	requestRender();
}

// WHERE A DRAGGED PIECE FLOATS: THE CENTER OF THE SQUARE UNDER THE POINTER (2D SNAPS IT TO SQUARES TOO), OFF THE BOARD THE EDGE SQUARE
// NEAREST THE POINT UNDER THE POINTER ON THE TABLE, SO IT STAYS ON THE BOARD. null WHEN THE POINTER ISN'T OVER THE TABLE (AT THE HORIZON)
function dragPoint() {
	const pointerEvent = { clientX: view.pointerAt.x, clientY: view.pointerAt.y };
	const square = squareUnder(pointerEvent);
	if (square) { return { x: center(fileOf(square)), z: center(rowOf(square)) }; }
	if (!raycaster.ray.intersectPlane(table, tablePoint)) { return null; } // squareUnder() JUST AIMED THE RAY AT THE POINTER
	return { x: center(toCell(tablePoint.x)), z: center(toCell(tablePoint.z)) };
}

/* ---------------------------------------------------------------- */
// Animation
/* ---------------------------------------------------------------- */

// PUTS A MOVING PIECE WHERE THE TIME SAYS (now = Infinity FINISHES IT), ENDING IT AT progress 1. THE CLOCK STARTS ON ITS FIRST FRAME
// PLUS ITS delay (A KNIGHT'S STOP), ease IS THE RESTART SLIDE'S SLOW START & LANDING, fade 1 FADES IN & -1 FADES OUT & DROPS
export function stepAnim(anim, now) {
	if (anim.start === null) { anim.start = now + anim.delay; }
	const t = now === Infinity || !anim.duration ? 1 : MathUtils.clamp((now - anim.start) / anim.duration, 0, 1);
	const along = anim.ease ? easeInOut(t) : t;
	const { mesh, x0, z0, x1, z1, y0, y1 } = anim;
	let y = y0 + (y1 - y0) * along + (anim.hop ? hopArc(t) * HOP_HEIGHT : 0) + anim.arc * hopArc(t);
	if (anim.fade < 0) { y -= t * SINK_DEPTH; }
	mesh.position.set(x0 + (x1 - x0) * along, y, z0 + (z1 - z0) * along);
	if (anim.fade) { setOpacity(mesh, anim.fade > 0 ? t : 1 - t); } // ALSO PUTS THE SHADOW UNDER IT
	else { updateShadow(mesh); }
	if (y0 !== 0 || y1 !== 0) { // TO OR FROM A PILE: THE SHADOW FOLLOWS THE SURFACE THE PIECE IS GOING TO OR LEAVING
		mesh.userData.ground = y0 + (y1 - y0) * along;
		shadeOnGround(mesh);
	}
	if (t < 1) { return; }
	view.anims.delete(anim);
	if (anim.onEnd) { anim.onEnd(); } // NOW, NOT IN A .then(): A syncFromBoard() OR unmount() RIGHT AFTER SEES THE FINAL PIECES
	anim.done();
}

export function finishAnims() {
	for (const anim of [...view.anims]) { stepAnim(anim, Infinity); }
}

// STARTS AN ANIMATION OF mesh FROM WHERE IT'S DRAWN NOW TO (x1, z1) AT HEIGHT y1 (THE BOARD'S, 0, IF NOT GIVEN), RESOLVES WHEN IT ENDS.
// arc IS HOW MUCH HIGHER IT IS HALFWAY THERE, A PILE'S FLIGHT
export function animate(mesh, x1, z1, { hop = false, ease = false, fade = 0, delay = 0, duration, onEnd, y1 = 0, arc = 0 }) {
	const x0 = mesh.position.x, y0 = mesh.position.y, z0 = mesh.position.z;
	if (fade > 0) { setOpacity(mesh, 0); } // UNSEEN UNTIL ITS FIRST FRAME
	return new Promise(function (done) {
		view.anims.add({ mesh, x0, y0, z0, x1, y1, z1, hop, arc, ease, fade, delay, duration, onEnd, start: null, done });
		requestRender();
	});
}

// MOVES A MESH TO square & SLIDES (OR HOPS) IT THERE FROM WHERE IT'S DRAWN NOW. options: animate()'s, duration DEFAULTS TO A MOVE'S
function slide(mesh, square, options) {
	const x0 = mesh.position.x, z0 = mesh.position.z;
	if (view.pieces.get(mesh.userData.square) === mesh) { view.pieces.delete(mesh.userData.square); } // NOT A PIECE THAT ALREADY SLID IN THERE
	place(mesh, square);
	const x1 = mesh.position.x, z1 = mesh.position.z;
	const squares = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0)) / CELL_SIZE;
	mesh.position.set(x0, 0, z0); // place() JUMPED IT, PUT IT BACK FOR THE FIRST FRAME
	updateShadow(mesh);
	return animate(mesh, x1, z1, { duration: slideDuration(squares, options.hop), ...options });
}

/**
 * @description Moves the piece on from to to, sliding (knights hop). Handles captures, castling's rook, en passant & promotion from
 * the pieces on the board, so call it before the next syncFromBoard(). Nothing on from: resolves at once
 * @param  {[string]} from ["e2"]
 * @param  {[string]} to ["e4"]
 * @param  {[string]} promotion ["q", "r", "b" or "n" when a pawn promotes, the pawn turns into it on arrival]
 * @return {[Promise<void>]} [resolves when every piece has stopped]
 */
export function animateMove(from, to, promotion) {
	if (!view || !view.pieces.has(from)) { return Promise.resolve(); }
	finishAnims();
	const mesh = view.pieces.get(from);
	const { type, color } = mesh.userData;
	const fileStep = fileOf(to) - fileOf(from);
	let captured = view.pieces.get(to);
	if (type === "p" && fileStep !== 0 && !captured) { captured = view.pieces.get(to[0] + from[1]); } // EN PASSANT: THE PAWN BESIDE IT
	const knight = type === "n";
	const landed = mesh.position.y === 0 && mesh.position.x === center(fileOf(to)) && mesh.position.z === center(rowOf(to)); // A CHESS CARDS DROP ALREADY STANDS ON to (dropHeld): NO HOP IN PLACE, NO WAIT FOR ONE
	faceTravel(mesh, from, to); // TURNS AS IT STARTS SLIDING, LIKE 2D
	const moves = [slide(mesh, to, { hop: knight && !landed, delay: landed ? 0 : slideDelay(knight), onEnd: function () {
		if (promotion && type === "p") {
			removePiece(mesh);
			place(addPiece(promotion, color), to);
		}
	} })];
	if (captured) { // OFF THE BOARD AT ONCE, setTaken() FLIES IT TO ITS PILE (ONE THAT NEVER GETS TOLD IS REMOVED BY THE NEXT syncFromBoard)
		if (view.pieces.get(captured.userData.square) === captured) { view.pieces.delete(captured.userData.square); } // NOT THE PIECE THAT JUST SLID IN THERE
		captured.userData.flight = { delay: slideDelay(knight), duration: slideDuration(Math.max(Math.abs(fileStep), Math.abs(rowOf(to) - rowOf(from))), knight) };
		view.arriving.add(captured);
		if (captured.userData.opacity < 1) { setOpacity(captured, 1); } // SEE-THROUGH FOR THE POINTER (tileHover.js): IT LEAVES THE BOARD SOLID
	}
	if (type === "k" && Math.abs(fileStep) === 2) { // CASTLING: THE ROOK JUMPS OVER THE KING
		const rook = view.pieces.get((fileStep > 0 ? "h" : "a") + from[1]);
		if (rook) { moves.push(slide(rook, (fileStep > 0 ? "f" : "d") + from[1], {})); }
	}
	return Promise.all(moves).then(() => {});
}

/**
 * @description Takes a move back, the reverse of animateMove (a replay's step back): the piece on to slides back to from without turning
 * (a knight hops backwards, setFacing has its facing from before the move), a promoted piece turns back into its pawn first, castling's
 * rook goes home & a taken piece is put back once the piece has landed (en passant: beside it). Call it before the next syncFromBoard()
 * @param  {[object]} move [{ from, to, promotion, piece, color, captured, flags } (gameplay/utils stepBetween), flags: chess.js's, k / q castles, e en passant]
 * @param  {[object]} facings [the facings of the position before the move, as setFacing takes them, for the piece that comes back]
 * @return {[Promise<void>]} [resolves when the piece has landed, nothing on to: at once]
 */
export function animateUndo(move, facings) {
	if (!view || !view.pieces.has(move.to)) { return Promise.resolve(); }
	finishAnims();
	let mesh = view.pieces.get(move.to);
	if (move.promotion) { // BACK TO THE PAWN THAT PROMOTED
		removePiece(mesh);
		mesh = addPiece("p", move.color);
		place(mesh, move.to);
	}
	const knight = mesh.userData.type === "n";
	const square = move.flags?.includes("e") ? move.to[0] + move.from[1] : move.to; // WHERE THE TAKEN PIECE WAS: EN PASSANT, THE PAWN BESIDE IT
	const takenColor = move.color === "w" ? "b" : "w";
	const land = function (taken) {
		place(taken, square); // NOT FADED IN: THIS RUNS INSIDE finishAnims() WHEN A JUMP CUTS THE SLIDE SHORT, A NEW ANIMATION WOULD OUTLIVE THE SYNC
		if (facings) { setFacing(facings); }
		requestRender();
	};
	let back = null; // THE PILE'S TOP PIECE OF THE TAKEN KIND, IT FLIES BACK TO ITS SQUARE
	if (move.captured) {
		for (const [key, m] of view.taken) {
			if (m.userData.type === move.captured && m.userData.color === takenColor && (!back || slotOf(key) > slotOf(back.userData.spot))) { back = m; }
		}
	}
	const restore = function () { // THE TAKEN PIECE COMES BACK ONCE IT HAS LANDED, ONE THE PILE HAD NONE OF
		if (move.captured && !back) { land(addPiece(move.captured, takenColor)); }
	};
	const moves = [slide(mesh, move.from, { hop: knight, delay: slideDelay(knight), onEnd: restore })];
	if (back) {
		const tx = center(fileOf(square)), tz = center(rowOf(square));
		const squares = Math.max(Math.abs(fileOf(move.to) - fileOf(move.from)), Math.abs(rowOf(move.to) - rowOf(move.from))); // THE UNDONE MOVE'S LENGTH, SO IT FLIES BACK IN THE TIME IT FLEW OUT
		view.taken.delete(back.userData.spot);
		back.userData.spot = undefined;
		back.rotation.y = homeYaw(back.userData.type, back.userData.color);
		const flying = back;
		moves.push(animate(flying, tx, tz, { y1: 0, arc: CELL_SIZE * 1.5, delay: slideDelay(knight), duration: slideDuration(squares, knight), onEnd: function () { flying.userData.ground = undefined; land(flying); } }));
	}
	if (move.flags?.includes("k") || move.flags?.includes("q")) { // CASTLING: THE ROOK GOES HOME TOO
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
	const targets = chessInst.board().flat().filter(Boolean); // { square, type, color }
	const meshes = [...view.pieces.values()];
	const light = (square) => (fileOf(square) + rowOf(square)) % 2 === 0;
	const pairs = [];
	targets.forEach(function (p, t) {
		meshes.forEach(function (mesh, m) {
			if (mesh.userData.type !== p.type || mesh.userData.color !== p.color) { return; }
			const from = mesh.userData.square;
			let distance = Math.hypot(fileOf(p.square) - fileOf(from), rowOf(p.square) - rowOf(from));
			if (p.type === "b" && light(from) !== light(p.square)) { distance += 100; } // A BISHOP STAYS ON ITS SQUARE COLOR
			pairs.push({ t, m, distance });
		});
	});
	pairs.sort((a, b) => a.distance - b.distance); // CLOSEST FIRST
	const target = new Map(); // MESH INDEX -> TARGET INDEX
	const filled = new Set(); // TARGET INDEXES WITH A PIECE
	for (const { t, m } of pairs) {
		if (target.has(m) || filled.has(t)) { continue; }
		target.set(m, t);
		filled.add(t);
	}
	view.pieces.clear();
	const glides = [];
	meshes.forEach(function (mesh, m) {
		if (!target.has(m)) { // NO SQUARE: FADES OUT WHERE IT IS
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
		const mesh = addPiece(p.type, p.color); // NO PIECE LEFT FOR IT: FADES IN ON ITS SQUARE
		place(mesh, p.square);
		glides.push(animate(mesh, mesh.position.x, mesh.position.z, { fade: 1, duration: RESTART_SLIDE_MS }));
	});
	return Promise.all(glides).then(() => {});
}
