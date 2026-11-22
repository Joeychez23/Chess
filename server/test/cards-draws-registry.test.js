/*
 *  cards-draws-registry.test.js  --  chess cards engine tests
 *	The rarity climb (Task 20e, segment A) on the real card registry: its own file, because cards-draws.test.js empties the registry.
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { newGame } = require("../../cards-engine/index.js");
const { makeCtx } = require("../../cards-engine/ctx.js");
const hand = require("../../cards-engine/hand.js");
const { CARDS, RARITY_WEIGHTS } = require("../../cards-engine/cards/index.js");

const TABLE = { common: 26, uncommon: 23, rare: 20, epic: 17, legendary: 14 }, TIERS = Object.keys(TABLE);
const total = (o) => Object.values(o).reduce((n, x) => n + x, 0);
const pct = (x) => (x * 100).toFixed(1) + "%";

for (const kind of ["active", "passive"]) {
	test(`the real ${kind}s at turn 30: every tier with a card is drawn at its table share, at turn 1 at its base share`, () => {
		const s = newGame({ cardGuy: "b", level: 1300, seed: 9 }), ctx = makeCtx(s), p = s.players.w, n = 20000;
		const shares = (full) => {
			const got = {};
			s.board.full = full;
			for (let i = 0; i < n; i++) {
				p.actives = [];
				p.passive = null;
				p.used = [];
				const r = CARDS[hand.drawCard(ctx, "w", kind).key].rarity;
				got[r] = (got[r] || 0) + 1 / n;
			}
			return got;
		};
		p.actives = [];
		p.passive = null;
		p.used = [];
		const pool = hand.drawable(s, "w", kind), start = {}, table = {};
		for (const k of pool) start[CARDS[k].rarity] = (start[CARDS[k].rarity] || 0) + RARITY_WEIGHTS[CARDS[k].rarity];
		for (const r of Object.keys(start)) table[r] = TABLE[r];
		const top = (o) => ((o.epic || 0) + (o.legendary || 0)) / total(o);
		assert.ok(top(start) < top(table), `the real ${kind}s climb: epic or legendary ${pct(top(start))} by the base weights, ${pct(top(table))} by the table`);
		const first = shares(1), last = shares(30);
		for (const r of TIERS) {
			assert.ok(Math.abs((first[r] || 0) - (start[r] || 0) / total(start)) < 0.015, `turn 1, ${r}: ${pct(first[r] || 0)}, ${pct((start[r] || 0) / total(start))} expected`);
			assert.ok(Math.abs((last[r] || 0) - (table[r] || 0) / total(table)) < 0.015, `turn 30, ${r}: ${pct(last[r] || 0)}, ${pct((table[r] || 0) / total(table))} expected`);
			if (start[r]) assert.ok(last[r] > 0.1, `${r} has a card to draw and is drawn`);
		}
	});
}
