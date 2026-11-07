/*
 *  board.js  --  chess frontend
 *	3D Board Surroundings
 *	A walnut frame with gold inlay & a-h / 1-8 labels, on a green baize table. Proportions follow the 2D board (gameplay/layout):
 *	labels sit COORD_BORDER_RATIO squares out from the playing area, in the band between the frame's two gold lines
 *
 */

import { Shape, Path, Mesh, ShapeGeometry, CanvasTexture, SRGBColorSpace, Group, BoxGeometry, PlaneGeometry, MeshBasicMaterial } from "three";
import { frameWood, gold, baize } from "./materials.js";

const COORD_BORDER_RATIO = 0.285;
const BORDER = 0.75; // FRAME WIDTH, IN SQUARES
const INLAYS = [[0.04, 0.08], [0.49, 0.53]]; // GOLD LINES, [inner, outer] DISTANCE FROM THE BOARD EDGE, IN SQUARES
const FRAME_DEPTH = 0.25; // FRAME THICKNESS BELOW THE BOARD SURFACE, IN SQUARES
const LABEL_COLOR = "#d9b27a"; // THE 2D BOARD'S COORDINATE GOLD

// A SQUARE FRAME OUTLINE (OUTER SQUARE MINUS INNER SQUARE) LYING FLAT AT HEIGHT y
function squareRing(inner, outer, material, y) {
	const shape = new Shape().moveTo(-outer, -outer).lineTo(outer, -outer).lineTo(outer, outer).lineTo(-outer, outer);
	shape.holes.push(new Path().moveTo(-inner, -inner).lineTo(-inner, inner).lineTo(inner, inner).lineTo(inner, -inner));
	const mesh = new Mesh(new ShapeGeometry(shape), material);
	mesh.rotation.x = -0.5 * Math.PI;
	mesh.position.y = y;
	return mesh;
}

// ONE LABEL'S TEXTURE: GOLD TEXT ON TRANSPARENT, DRAWN LIKE THE 2D BOARD'S drawCoordinates()
function labelTexture(text) {
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = 64;
	const ctx = canvas.getContext("2d");
	ctx.font = "600 44px Archivo, \"Helvetica Neue\", Arial, sans-serif";
	ctx.fillStyle = LABEL_COLOR;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(text, 32, 34);
	const texture = new CanvasTexture(canvas);
	texture.colorSpace = SRGBColorSpace;
	return texture;
}

/**
 * @description Builds the frame, labels (White's view) & table around a board of boardSize world units centered on the origin, top at y = 0
 * @param  {[number]} boardSize [world units per board side]
 * @return {[Group]}
 */
export function createSurroundings(boardSize) {
	const cell = boardSize / 8;
	const half = boardSize / 2;
	const group = new Group();
	const depth = FRAME_DEPTH * cell;
	const frame = new Mesh(new BoxGeometry(boardSize + 2 * BORDER * cell, depth, boardSize + 2 * BORDER * cell), frameWood);
	frame.position.y = -depth / 2 - 0.005; // A HAIR BELOW y = 0 SO THE BOARD PLANE WINS
	group.add(frame);
	for (const [a, b] of INLAYS) { group.add(squareRing(half + a * cell, half + b * cell, gold, 0.004)); }
	const table = new Mesh(new PlaneGeometry(400, 400), baize); // WIDE ENOUGH TO FILL THE VIEW, FOG FADES ITS FAR EDGE
	table.rotation.x = -0.5 * Math.PI;
	table.position.y = -depth - 0.01;
	group.add(table);
	const labelGeometry = new PlaneGeometry(cell * 0.4, cell * 0.4);
	const band = half + COORD_BORDER_RATIO * cell; // FILES ALONG WHITE'S NEAR EDGE, RANKS UP WHITE'S LEFT
	for (let i = 0; i < 8; i++) {
		const along = -half + cell * (i + 0.5);
		for (const [text, x, z] of [["abcdefgh"[i], along, band], [String(8 - i), -band, along]]) {
			const label = new Mesh(labelGeometry, new MeshBasicMaterial({ map: labelTexture(text), transparent: true, depthWrite: false }));
			label.position.set(x, 0.006, z);
			label.rotation.x = -0.5 * Math.PI;
			group.add(label);
		}
	}
	return group;
}
