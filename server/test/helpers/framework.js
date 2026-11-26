/*
 *  framework.js  --  chess cards engine tests
 *	Shared setup for the card framework tests in test/cards/framework/: game builders, test-card registration and action finders
 *
 */

const { newGame, legalActions } = require("../../../cards-engine/index.js");
const { fromFen, sqIndex } = require("../../../cards-engine/board.js");
const { register } = require("../../../cards-engine/cards/index.js");

const other = (c) => (c === "w" ? "b" : "w");
const fresh = (seed = 1) => newGame({ cardGuy: "b", level: 1300, seed });
const game = (fen, seed = 1) => { const s = fresh(seed); s.board = fromFen(fen); return s; };
const card = (piece, id) => ({ id, key: "move", piece });
const placed = (id, key, owner, placedAt) => ({ id, owner, card: { id, key }, placedAt });
const passive = (key, extra) => register({ key, kind: "passive", name: key, rarity: "common", text: "", ...extra });
const curse = (key, extra) => register({ key, kind: "curse", name: key, rarity: "common", text: "", ...extra });
const active = (key, play, extra) => register({ key, kind: "active", name: key, rarity: "common", text: "", targets: () => [null], play, ...extra });
const ofType = (events, type) => events.filter((e) => e.type === type);
const at = (s, sq) => s.board.sq[sqIndex(sq)];

const kingMove = (s, c, to) => legalActions(s, c).find((a) => a.card === "king" && a.to === to);
const rookMove = (s, c, from, to) => legalActions(s, c).find((a) => a.type === "move" && a.from === from && a.to === to && a.card !== "king");

module.exports = { other, fresh, game, card, placed, passive, curse, active, ofType, at, kingMove, rookMove };
