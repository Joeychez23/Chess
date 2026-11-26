/*
 *  turn.js  --  chess cards engine tests
 *	Shared setup for the turn tests in test/cards/turn/: game builders and action helpers
 *
 */

const { newGame, legalActions, applyAction } = require("../../../cards-engine/index.js");
const { fromFen } = require("../../../cards-engine/board.js");

const fresh = (seed = 1) => newGame({ cardGuy: "b", level: 1300, seed });
const game = (fen, seed = 1) => { const s = fresh(seed); s.board = fromFen(fen); return s; };
const card = (piece, id) => ({ id, key: "move", piece });
const first = (s, c, type) => legalActions(s, c).find((a) => a.type === type);
const play = (s, c, type) => applyAction(s, c, first(s, c, type)).state;
const types = (s, c) => [...new Set(legalActions(s, c).map((a) => a.type))].sort();
const pass = (s, c) => { const t = JSON.parse(JSON.stringify(s)); t.players[c].passive = { id: "tp" + t.ply, key: "test-passive" }; return applyAction(t, c, { type: "passive" }).state; }; // A TURN WITHOUT A MOVE

module.exports = { fresh, game, card, first, play, types, pass };
