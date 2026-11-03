/*
 *  openings.js  --  chess server
 *	Opening Names
 *  Finds a position's opening in the Lichess data set (data/openings/). Each line is replayed once when the server starts & kept by its
 *  position, so a game that gets there in another move order still matches. Kept on the server so the data stays out of the client bundle
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const fs = require("fs");
const path = require("path");
const { Chess } = require("chess.js");

const OPENINGS_DIR = path.join(__dirname, "..", "data", "openings");
const OPENING_FILES = ["a.tsv", "b.tsv", "c.tsv", "d.tsv", "e.tsv"];

const openings = loadOpenings(); // POSITION -> { eco, name }

/* ---------------------------------------------------------------- */
// Lookup
/* ---------------------------------------------------------------- */
/**
 * @description The part of a FEN that says what position it is, without the halfmove & fullmove counters
 * @param  {[string]} fen
 * @return {[string]} position
 */
function positionKey(fen) {
	return fen.split(" ").slice(0, 4).join(" ");
}

/**
 * @description The opening with this position
 * @param  {[string]} fen [a board chess.js wrote, it only names an en passant square when the capture is legal]
 * @return {[object]} opening [{ eco, name }, null when the position isn't in the data set]
 */
function findOpening(fen) {
	return openings.get(positionKey(fen)) || null;
}

/**
 * @description The latest opening a game's moves reached, what's saved on a game after those moves (a takeback rebuilds it)
 * @param  {[array]} moves [the game's SAN moves]
 * @param  {[string]} startFen [the set position they start from, left out = the standard position]
 * @return {[object]} opening [{ eco, name }, null when none of the positions are in the data set]
 */
function latestOpening(moves, startFen) {
	const chess = new Chess(startFen || undefined);
	let opening = null;
	for (const san of moves) {
		chess.move(san);
		opening = findOpening(chess.fen()) || opening;
	}
	return opening;
}

/* ---------------------------------------------------------------- */
// Load
/* ---------------------------------------------------------------- */
/**
 * @description Replays every line of the data set. A line that can't be replayed throws, so a bad update stops the server starting
 * @return {[Map]} openings [position -> { eco, name }]
 */
function loadOpenings() {
	const positions = new Map();
	for (const file of OPENING_FILES) {
		const [, ...lines] = fs.readFileSync(path.join(OPENINGS_DIR, file), "utf8").trim().split("\n"); // THE FIRST LINE IS THE HEADER
		for (const line of lines) {
			const [eco, name, pgn] = line.split("\t");
			const chess = new Chess();
			pgn.replace(/\d+\./g, " ").trim().split(/\s+/).forEach((san) => chess.move(san));
			positions.set(positionKey(chess.fen()), { eco, name });
		}
	}
	return positions;
}


module.exports = { findOpening, latestOpening };
