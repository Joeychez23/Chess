/*
 * facing.js -- piece facing rules shared by 2D, the slide home and the board picture
 */

/* ---------------------------------------------------------------- */
// Parsed response lists
/* ---------------------------------------------------------------- */
const parsedLists = new Map();

/** Parse a response list once until its raw value changes. */
function parseList(name, raw) {
	const cached = parsedLists.get(name);
	if (cached && cached.raw === raw) return cached.parsed;
	const parsed = JSON.parse(raw);
	parsedLists.set(name, { raw, parsed });
	return parsed;
}

/* ---------------------------------------------------------------- */
// Sliding piece facing
/* ---------------------------------------------------------------- */
function pieceRow(square, viewColor) {
	const rank = square.split("")[1];
	if (viewColor === 'w') return 8 - rank;
	if (viewColor === 'b') return rank - 1;
	return undefined;
}

/** Return row facing information for a king, queen, bishop, or rook. */
function pieceFacing(list, square, { viewColor, slide, landed }) {
	for (let n = 0; n < list.length; n++) {
		if (slide && slide.from[1] != slide.to[1]) {
			return { yFrom: pieceRow(slide.from, viewColor), yTo: pieceRow(slide.to, viewColor) };
		}
		if (list[n].from && list[n].to == square) {
			return { yFrom: pieceRow(list[n].from, viewColor), yTo: pieceRow(list[n].to, viewColor) };
		}
		if (list[n].from == null && list[n].to == square) return { yFrom: null, yTo: null };
		if (landed && square == landed.from && list[n].to == landed.to) {
			if (list[n].from) return { yFrom: pieceRow(list[n].from, viewColor), yTo: pieceRow(list[n].to, viewColor) };
			return { yFrom: undefined, yTo: undefined };
		}
	}
	return null;
}

/* ---------------------------------------------------------------- */
// Knight facing
/* ---------------------------------------------------------------- */
function knightFacing(list, square, { slide, landed }) {
	for (let n = 0; n < list.length; n++) {
		if (slide) return { kind: "dir", from: slide.from, to: slide.to };
		if (list[n].from && list[n].to == square) return { kind: "dir", from: list[n].from, to: list[n].to };
		if (list[n].from == null && list[n].to == square) return { kind: "side" };
		if (landed && square == landed.from && list[n].from && list[n].to == landed.to) {
			return { kind: "dir", from: list[n].from, to: list[n].to };
		}
	}
	return null;
}

function awayFromRows(yFrom, yTo, color, viewColor) {
	if (yFrom > yTo) return true;
	if (yFrom < yTo) return false;
	return color === viewColor;
}

function rightFromFiles(from, to, viewColor) {
	if (from[0] === to[0]) return false;
	return viewColor === "w" ? from[0] < to[0] : from[0] > to[0];
}

function startsRight(square, viewColor) {
	return (square[0] < "e") === (viewColor === "w");
}

function facesAway(list, square, color, options) {
	const facing = pieceFacing(list, square, options);
	return facing ? awayFromRows(facing.yFrom, facing.yTo, color, options.viewColor) : null;
}

function knightFacesRight(list, square, color, options) {
	const facing = knightFacing(list, square, options);
	if (!facing) return null;
	if (facing.kind === "side") return startsRight(square, options.viewColor);
	if (facing.from[0] === facing.to[0]) return color === "b";
	return rightFromFiles(facing.from, facing.to, options.viewColor);
}

module.exports = { parseList, awayFromRows, rightFromFiles, startsRight, facesAway, knightFacesRight };
