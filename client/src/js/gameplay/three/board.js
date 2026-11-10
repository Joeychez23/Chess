/*
 *  board.js  --  chess frontend
 *	3D Board Surroundings
 *	A walnut frame with gold inlay & a-h / 1-8 labels, on a green baize table. Proportions follow the 2D board (gameplay/layout):
 *	labels sit COORD_BORDER_RATIO squares out from the playing area, in the band between the frame's two gold lines
 *
 */

import { Shape, Path, Mesh, ShapeGeometry, CanvasTexture, SRGBColorSpace, Group, BoxGeometry, PlaneGeometry, MeshBasicMaterial } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { frameWood, gold, baize } from "./materials.js";

const COORD_BORDER_RATIO = 0.285;
const BORDER = 0.75; // FRAME WIDTH, IN SQUARES
const INLAYS = [[0.04, 0.08], [0.49, 0.53]]; // GOLD LINES, [inner, outer] DISTANCE FROM THE BOARD EDGE, IN SQUARES
const FRAME_DEPTH = 0.25; // FRAME THICKNESS BELOW THE BOARD SURFACE, IN SQUARES
const LABEL_COLOR = "#d9b27a"; // THE 2D BOARD'S COORDINATE GOLD
const GLYPHS = "abcdefgh87654321"; // THE LABEL ATLAS, LEFT TO RIGHT: FILES, THEN RANKS FROM THE TOP (8 - i)
const GLYPH_PX = 64;

// A SQUARE FRAME OUTLINE (OUTER SQUARE MINUS INNER SQUARE) LYING FLAT AT HEIGHT y
function squareRing(inner, outer, material, y) {
	const shape = new Shape().moveTo(-outer, -outer).lineTo(outer, -outer).lineTo(outer, outer).lineTo(-outer, outer);
	shape.holes.push(new Path().moveTo(-inner, -inner).lineTo(-inner, inner).lineTo(inner, inner).lineTo(inner, -inner));
	const mesh = new Mesh(new ShapeGeometry(shape), material);
	mesh.rotation.x = -0.5 * Math.PI;
	mesh.position.y = y;
	return mesh;
}

// EVERY LABEL'S GLYPH IN ONE TEXTURE (GLYPHS ORDER, GLYPH_PX SQUARE EACH): GOLD TEXT ON TRANSPARENT, DRAWN LIKE THE 2D BOARD'S drawCoordinates()
function labelAtlas() {
	const canvas = document.createElement("canvas");
	canvas.width = GLYPH_PX * GLYPHS.length;
	canvas.height = GLYPH_PX;
	const ctx = canvas.getContext("2d");
	ctx.font = "600 44px Archivo, \"Helvetica Neue\", Arial, sans-serif";
	ctx.fillStyle = LABEL_COLOR;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	[...GLYPHS].forEach((text, k) => ctx.fillText(text, GLYPH_PX * (k + 0.5), 34));
	const texture = new CanvasTexture(canvas);
	texture.colorSpace = SRGBColorSpace;
	return texture;
}

// ALL 16 LABELS READ FROM color'S SIDE AS ONE MESH (ONE DRAW CALL), WHERE THE 2D BOARD HAS THEM: FILES ALONG ITS NEAR EDGE, RANKS UP ITS LEFT
function labelsFor(color, cell, half, material) {
	const s = color === "b" ? -1 : 1; // BLACK'S NEAR EDGE IS -Z, ITS LEFT IS +X
	const band = half + COORD_BORDER_RATIO * cell;
	const parts = [...GLYPHS].map(function (text, k) {
		const along = -half + cell * ((k % 8) + 0.5);
		const g = new PlaneGeometry(cell * 0.4, cell * 0.4);
		const uv = g.attributes.uv;
		for (let i = 0; i < uv.count; i++) { uv.setX(i, (k + uv.getX(i)) / GLYPHS.length); } // ITS SLOT IN THE ATLAS
		g.rotateZ(color === "b" ? Math.PI : 0).rotateX(-0.5 * Math.PI); // UPRIGHT TO THAT SIDE, LYING FLAT
		return k < 8 ? g.translate(along, 0.006, s * band) : g.translate(-s * band, 0.006, along);
	});
	return new Mesh(mergeGeometries(parts), material);
}

/**
 * @description Builds the frame, labels (White's view, turn them with orientLabels) & table around a board of boardSize world units
 * centered on the origin, top at y = 0
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
	const labelMaterial = new MeshBasicMaterial({ map: labelAtlas(), transparent: true, depthWrite: false });
	const labels = { w: labelsFor("w", cell, half, labelMaterial), b: labelsFor("b", cell, half, labelMaterial) };
	group.add(labels.w, labels.b);
	group.userData.labels = labels;
	orientLabels(group, "w");
	return group;
}

/**
 * @description Shows the labels that read from a side, where the 2D board has them: files along its near edge, ranks up its left
 * @param  {[Group]} group [from createSurroundings]
 * @param  {[string]} color ['w' | 'b', the side the player looks from]
 */
export function orientLabels(group, color) {
	const { w, b } = group.userData.labels;
	w.visible = color !== "b";
	b.visible = color === "b";
}
