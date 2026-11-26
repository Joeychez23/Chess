/*
 *  passiveCapture.js  --  chess cards engine tests
 *	Shared setup for the capture & check passive tests (test/cards/passiveCapture/): the registry reset to only the cards these tests register,
 *  a game on a FEN with empty hands, placing a passive, a no-op turn, White's e4xd5 and the event helpers
 *
 */

const { newGame, legalActions, applyAction } = require("../../../cards-engine/index.js");
const { fromFen, sqIndex } = require("../../../cards-engine/board.js");
const { register, reset } = require("../../../cards-engine/cards/index.js");


reset(); // THE ENGINE ENTRY REGISTERS EVERY CARD: THESE TESTS DRAW FROM ONLY THE CARDS THEY REGISTER

const KEYS = ["last-rites", "unjust-retribution", "reinforcements", "retaliation", "bleeding-hand", "hex", "spite", "bounty", "bad-omen", "overwatch", "escape-artist", "grace"];
for (const key of KEYS) register(require("../../../cards-engine/cards/passive/" + key + ".js"));
for (const key of ["t-pass", "t-pass2"]) register({ key, kind: "active", name: key, rarity: "common", text: "", targets: () => [null], play: () => {} });
register({ key: "t-curse", kind: "curse", name: "t-curse", rarity: "common", text: "" });
register({ key: "t-kingguard", kind: "passive", name: "t-kingguard", rarity: "common", text: "", rules: { canCapture: (s, a, t, src) => !(t.t === "k" && t.c === src.owner) } }); // ONLY THE OWNER'S KING SHIELDED: CASTLING PAST A WATCHED SQUARE
register({ key: "t-guard", kind: "passive", name: "t-guard", rarity: "common", text: "", rules: { canCapture: (s, a, t, src) => t.c !== src.owner } }); // A CAPTURE RULE (LIKE HEAVY CAVALRY'S), NOT A STATUS

let n = 0;
const ofType = (events, type) => events.filter((e) => e.type === type);
const id = (s, sq) => s.board.sq[sqIndex(sq)].id;
const mv = (piece, cid) => ({ id: cid, key: "move", piece });
const fired = (events, key) => events.some((e) => e.type === "passive-fired" && e.card.key === key);
const waits = (s, key) => s.effects.some((e) => e.card.key === key);
const cardless = (s, c) => legalActions(s, c).filter((a) => a.type === "move" && a.card === null);

/**
 * @description A game on this FEN with empty hands (King cards kept).
 */
function game(fen) {
	const s = newGame({ cardGuy: "b", level: 1300, seed: 1 });
	s.board = fromFen(fen);
	for (const c of ["w", "b"]) Object.assign(s.players[c], { moves: [], actives: [], passive: null });
	return s;
}

/**
 * @description Place passive key for owner in Board Effects; returns its entry.
 */
function place(s, key, owner) {
	const cid = "c" + (800 + ++n), e = { id: cid, owner, card: { id: cid, key }, placedAt: s.ply };
	s.effects.push(e);
	return e;
}

/**
 * @description color spends its turn on a no-op active; returns { state, events }.
 */
function pass(s, color) {
	const card = { id: "c" + (900 + ++n), key: "t-pass" };
	s.players[color].actives = [card];
	return applyAction(s, color, { type: "active", card: card.id });
}

/**
 * @description White's pawn card t1 takes e4xd5 on this FEN, with the passive key placed for owner; returns { s, state, events }.
 */
function takeD5(fen, key, owner, setup) {
	const s = game(fen);
	s.players.w.moves = [mv("p", "t1")];
	if (key) place(s, key, owner);
	if (setup) setup(s);
	return { s, ...applyAction(s, "w", { type: "move", card: "t1", from: "e4", to: "d5" }) };
}

const PAWN = "4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1";
const QUEEN = "4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1";

module.exports = { ofType, id, mv, fired, waits, cardless, game, place, pass, takeD5, PAWN, QUEEN };
