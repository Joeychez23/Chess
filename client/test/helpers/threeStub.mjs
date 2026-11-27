// THE NAMES three/board/motion.js IMPORTS FROM three/index.js & three/board/pieces.js, FOR client/test/cards/boardStep.test.js (ITS RESOLVE HOOK SWAPS BOTH FOR THIS FILE): NO WebGL, A PIECE IS A PLAIN
// OBJECT. fileOf, rowOf, center, place, setYaw, faceTravel AS IN three/index.js; addPiece TURNS A PIECE AS createPiece DOES & GIVES IT A FOOT 0.34 PIECE UNITS WIDE (THE PAWN'S, pieces.js)
import { BOARD_SIZE, CELL_SIZE, FILES, PIECE_SIZE } from "../../src/js/gameplay/three/constants.js";

export let view = null;
export const scene = new Set(); // THE PIECES ADDED & NOT YET REMOVED
export function setView(v) { view = v; scene.clear(); }
export function requestRender() {}

export const fileOf = (square) => FILES.indexOf(square[0]);
export const rowOf = (square) => 8 - Number(square[1]);
export const center = (i) => -BOARD_SIZE / 2 + CELL_SIZE * (i + 0.5);
export const toCell = (v) => Math.max(0, Math.min(7, Math.floor((v + BOARD_SIZE / 2) / CELL_SIZE)));

export function place(mesh, square) {
	view.pieces.set(square, mesh);
	mesh.userData.square = square;
	mesh.position.set(center(fileOf(square)), 0, center(rowOf(square)));
}

const TURNS = /[kqbrn]/;
export const yawToward = (rankUp) => (rankUp ? Math.PI : 0);
export const yawSide = (towardH) => (towardH ? 0 : Math.PI);
export const homeYaw = (type, color) => (color === "w" ? Math.PI : 0) - (type === "n" ? Math.PI / 2 : 0);
export const storedYaw = (mesh) => mesh.userData.yaw ?? homeYaw(mesh.userData.type, mesh.userData.color);
export function setYaw(mesh, yaw, store) {
	if (!TURNS.test(mesh.userData.type)) { return; }
	if (store) { mesh.userData.yaw = yaw; }
	mesh.rotation.y = yaw;
}
export function faceTravel(mesh, from, to) {
	if (mesh.userData.type === "n") { setYaw(mesh, yawSide(fileOf(to) > fileOf(from)), true); }
	else if (from[1] !== to[1]) { setYaw(mesh, yawToward(Number(to[1]) > Number(from[1])), true); }
}

export function addPiece(type, color) {
	const mesh = {
		userData: { type, color, opacity: 1 },
		position: { x: 0, y: 0, z: 0, set(x, y, z) { Object.assign(this, { x, y, z }); } },
		rotation: { x: 0, y: homeYaw(type, color), z: 0, order: "XYZ" },
		scale: { y: PIECE_SIZE },
		geometry: { boundingBox: { min: { x: -0.34, y: 0, z: -0.34 }, max: { x: 0.34, y: 0.83, z: 0.34 } } },
	};
	scene.add(mesh);
	return mesh;
}
export function removePiece(mesh) { scene.delete(mesh); }

export function updateShadow() {}
export function shadeOnGround() {}
export function setOpacity(mesh, opacity) { mesh.userData.opacity = opacity; }
export function setFacing() {}
export const slotOf = (key) => Number(String(key).replace(/\D/g, ""));
export const squareUnder = () => null, raycaster = { ray: { intersectPlane: () => null } }, table = null, tablePoint = null;
