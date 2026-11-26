// Which way a 3D piece faces: kings, queens, bishops and rooks up or down the board, knights left or right, as in 2D
import { view, fileOf, requestRender } from "./three.mount.js";

// King, queen, bishop and rook face the way they last moved up or down the board, as in 2D (draw/facing.js
// awayFromRows): toward rank 8 (-Z) is rotation.y PI (model fronts face +Z), toward rank 1 is 0. One that hasn't moved
// faces the other side (createPiece). World sides, so a flip changes nothing.
// Knights face the way they last moved left or right (draw/facing.js rightFromFiles): the nose is +X, so toward the
// h-file is 0, toward the a-file PI. One that hasn't moved faces the middle (a - d face the h-file, e - h the a-file), as
// 2D's start (draw/facing.js startsRight). Pawns never turn
const FACING_PIECES = /[kqbrn]/;

export function yawToward(rankUp) {
	return (rankUp ? Math.PI : 0);
}

export function yawSide(towardH) {
	return (towardH ? 0 : Math.PI);
}

export function startYaw(mesh) {
	return (mesh.userData.type === "n" ? yawSide(fileOf(mesh.userData.square) < 4) : yawToward(mesh.userData.color === "w"));
}

export function storedYaw(mesh) {
	return mesh.userData.yaw ?? startYaw(mesh);
}

export function setYaw(mesh, yaw, store) {
	if (!FACING_PIECES.test(mesh.userData.type)) { return; }
	if (store) { mesh.userData.yaw = yaw; }
	mesh.rotation.y = yaw;
}

// Turns a king, queen, bishop or rook the way a move goes up or down, a sideways move keeps its facing. A knight turns
// left or right
export function faceTravel(mesh, from, to) {
	if (mesh.userData.type === "n") { setYaw(mesh, yawSide(fileOf(to) > fileOf(from)), true); }
	else if (from[1] !== to[1]) { setYaw(mesh, yawToward(Number(to[1]) > Number(from[1])), true); }
}

/**
 * @description Turns the kings, queens, bishops, rooks & knights the way the 2D board's lists say (w_piece / b_piece,
 * w_knight / b_knight). A piece on a square its color's list doesn't name keeps its facing (a move the list hasn't
 * caught up with yet already turned it, animateMove)
 * @param  {[object]} facings [{ w: { square: "up" | "down" | "left" | "right" | null }, b: { ... } }, "up" toward rank 8,
 * "right" toward the h-file, null hasn't moved]
 */
export function setFacing(facings) {
	if (!view) { return; }
	for (const [square, mesh] of view.pieces) {
		const list = facings[mesh.userData.color] || {};
		if (!(square in list)) { continue; }
		const dir = list[square];
		mesh.userData.yaw = !dir ? undefined : dir === "left" || dir === "right" ? yawSide(dir === "right") : yawToward(dir === "up");
		if (!view.held || view.held.mesh !== mesh || !view.held.following) { setYaw(mesh, storedYaw(mesh), false); }
	}
	requestRender();
}
