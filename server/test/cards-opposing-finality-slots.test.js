/*
 *  cards-opposing-finality-slots.test.js  --  chess cards engine tests
 *	T25-I1: Opposing Finality's choice under the giver's Fog of War lists hidden offered pieces as "?n" slots, so the chooser always has an option to send.
 *
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { newGame, legalActions, applyAction, playerLegal, playerView, rng } = require("../../cards-engine/index.js");
const { fromFen, sqIndex } = require("../../cards-engine/board.js");

const copy = (x) => JSON.parse(JSON.stringify(x));
const ofType = (events, type) => events.filter((e) => e.type === type);
const idAt = (s, sq) => s.board.sq[sqIndex(sq)].id;
const SLOTS = (k) => Array.from({ length: k }, (_, i) => "?" + (i + 1));

/**
 * @description The ofstall.js position on this FEN: White's d4 rook under Opposing Finality, Black's queen d5 takes it (a move card), with or without Black's Fog of War; returns the state after the capture.
 */
function stall(fen, fog = true) {
	const s = newGame({ cardGuy: "b", level: 1300, seed: 5 });
	s.board = fromFen(fen);
	s.players.b.moves = [{ id: "mq", key: "move", piece: "q" }, ...s.players.b.moves.slice(1)];
	s.enchant.push({ id: "eof", key: "opposing-finality", owner: "w", pieces: [idAt(s, "d4")], data: {} });
	if (fog) s.enchant.push({ id: "efog", key: "fog-of-war", owner: "b", pieces: [], left: 6, data: {} });
	const cap = legalActions(s, "b").find((a) => a.type === "move" && a.from === "d5" && a.to === "d4");
	assert.ok(cap, "the capture is legal");
	return applyAction(s, "b", cap).state;
}

const STALL = "4k3/pppppppp/8/3q4/3R4/8/8/4K3 b - - 0 1";
const MIXED = "4k3/pppppp2/8/3q4/3R2p1/7p/8/4K3 b - - 0 1"; // g4 AND h3 ON WHITE'S HALF: SEEN THROUGH THE FOG
const PAWNS = (s) => s.board.sq.filter((p) => p && p.c === "b" && p.t === "p").map((p) => p.id);

describe("T25-I1: Opposing Finality under the giver's Fog of War", () => {
	test("the stall position offers 8 slots, the chooser is told them, the view shows them and no hidden id is stored", () => {
		const s = stall(STALL), hidden = PAWNS(s);
		assert.deepEqual([s.pending.player, s.pending.kind, s.pending.options], ["w", "opposing-finality", SLOTS(8)]);
		assert.deepEqual(playerLegal(s, "w"), SLOTS(8).map((option) => ({ type: "choice", option })));
		assert.deepEqual(playerView(s, "w").pending.options, SLOTS(8));
		const json = JSON.stringify(s.pending);
		for (const id of hidden) assert.ok(!json.includes('"' + id + '"'), id + " in the pending");
	});

	test("a slot hands over one of the hidden offered pieces", () => {
		const s = stall(STALL), hidden = PAWNS(s);
		const { state, events } = applyAction(copy(s), "w", { type: "choice", option: "?3" });
		const ho = ofType(events, "handover");
		assert.equal(ho.length, 1);
		assert.equal(ho[0].player, "w");
		assert.ok(hidden.includes(ho[0].piece));
		assert.equal(state.board.sq.find((p) => p && p.id === ho[0].piece).c, "w");
		assert.equal(state.pending, null);
	});

	test("mixed: the visible offered ids, then one slot per hidden one; a slot never picks a listed piece", () => {
		const s = stall(MIXED), g4 = idAt(s, "g4"), h3 = idAt(s, "h3");
		assert.deepEqual(s.pending.options, [g4, h3, ...SLOTS(6)]);
		assert.deepEqual(playerView(s, "w").pending.options, [g4, h3, ...SLOTS(6)]);
		const byId = applyAction(copy(s), "w", { type: "choice", option: h3 });
		assert.deepEqual(ofType(byId.events, "handover").map((e) => e.piece), [h3]);
		const got = new Set();
		for (let seed = 1; seed <= 24; seed++) for (const slot of SLOTS(6)) { // F1-review Minor 2: MANY RNG STATES, NOT ONE SAMPLE
			const t = copy(s);
			t.rng = rng.seed(seed);
			const ho = ofType(applyAction(t, "w", { type: "choice", option: slot }).events, "handover");
			assert.equal(ho.length, 1);
			assert.ok(![g4, h3].includes(ho[0].piece), slot + " picked a listed piece (seed " + seed + ")");
			got.add(ho[0].piece);
		}
		assert.ok(got.size > 1, "slots over different rng states reach more than one hidden piece");
	});

	test("F1-review Important 1: under the owner's fog the giver's pending does not tell a captured knight from a captured pawn", () => {
		const views = ["N", "P"].map((t) => {
			const s = newGame({ cardGuy: "w", level: 1300, seed: 5 });
			s.board = fromFen("4k3/pppp4/8/q7/8/8/3" + t + "4/4K3 b - - 0 1");
			s.players.b.moves = [{ id: "mq", key: "move", piece: "q" }, ...s.players.b.moves.slice(1)];
			s.enchant.push({ id: "eof", key: "opposing-finality", owner: "w", pieces: [idAt(s, "d2")], data: {} });
			s.enchant.push({ id: "efog", key: "fog-of-war", owner: "w", pieces: [], left: 6, data: {} });
			const cap = legalActions(s, "b").find((a) => a.type === "move" && a.from === "a5" && a.to === "d2");
			assert.ok(cap, "the capture is legal");
			const { state } = applyAction(s, "b", cap);
			assert.equal(state.pending.player, "b");
			const ho = ofType(applyAction(copy(state), "b", { type: "choice", option: state.pending.options[0] }).events, "handover");
			assert.equal(ho.length, 1, "the resolve still hands over a pawn");
			return playerView(state, "b").pending;
		});
		assert.deepEqual(views[0], views[1]);
	});

	test("no fog: the options are the offered ids, as before", () => {
		const s = stall(STALL, false);
		assert.deepEqual(s.pending.options, PAWNS(s));
		assert.deepEqual(playerLegal(s, "w").map((a) => a.option), PAWNS(s));
	});

	test("the fog ends between ask and resolve: the slots stay and still hand over an unlisted piece", () => {
		const s = stall(MIXED), listed = s.pending.options.filter((o) => o[0] !== "?");
		s.enchant = s.enchant.filter((e) => e.key !== "fog-of-war");
		assert.deepEqual(playerLegal(s, "w").map((a) => a.option), s.pending.options);
		const ho = ofType(applyAction(copy(s), "w", { type: "choice", option: "?2" }).events, "handover");
		assert.equal(ho.length, 1);
		assert.ok(!listed.includes(ho[0].piece));
	});

	test("playerLegal tells every option and applyAction takes each", () => {
		for (const fen of [STALL, MIXED]) {
			const s = stall(fen);
			assert.deepEqual(playerLegal(s, "w").map((a) => a.option), s.pending.options);
			for (const option of s.pending.options) {
				const r = applyAction(copy(s), "w", { type: "choice", option });
				assert.equal(ofType(r.events, "handover").length, 1, option);
			}
		}
	});

	test("fuzz: with Opposing Finality on every piece and both Fogs of War up, no pending choice ever leaves its player nothing to send", () => {
		let a = 0x9e3779b9; // mulberry32: THE PICKER'S OWN SEEDED STREAM
		const rand = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
		const pick = (xs) => xs[Math.floor(rand() * xs.length)];
		let choices = 0, slotted = 0;
		for (let seed = 1; seed <= 12; seed++) {
			let s = newGame({ cardGuy: "b", level: 1300, seed });
			if (seed % 2) s.board.sq.forEach((p, i) => { if (p && "nb".includes(p.t)) s.board.sq[i] = null; }); // NO MINOR PIECES: A TAKEN ROOK'S OWNER PICKS AMONG PAWNS, MOST OF THEM FOGGED
			s.board.sq.forEach((p, i) => { if (p && p.t !== "k") s.enchant.push({ id: "eo" + i, key: "opposing-finality", owner: p.c, pieces: [p.id], data: {} }); });
			for (const c of ["w", "b"]) s.enchant.push({ id: "ef" + c, key: "fog-of-war", owner: c, pieces: [], left: 999, data: {} });
			for (let ply = 0; ply < 150 && !s.result; ply++) {
				if (s.pending && s.pending.kind === "opposing-finality") {
					choices++;
					if (s.pending.options.some((o) => o[0] === "?")) slotted++;
					assert.ok(playerLegal(s, s.pending.player).length > 0, "seed " + seed + " ply " + ply + ": nothing to send");
					const v = playerView(s, s.pending.player), listed = s.pending.options.filter((o) => o[0] !== "?"); // F1-review Minor 3: hiddenFrom AGREES WITH view.js
					assert.deepEqual(v.pending.options, s.pending.options, "seed " + seed + " ply " + ply + ": the view strips a listed id");
					for (const id of listed) assert.ok(v.board.sq.some((p) => p && p.id === id), id + " listed but not on the view's board");
					assert.ok(s.pending.options.length - listed.length <= (v.board.hidden || 0), "more slots than hidden pieces");
				}
				const actors = ["w", "b"].filter((c) => legalActions(s, c).length);
				if (!actors.length) break;
				const who = pick(actors);
				s = applyAction(s, who, pick(legalActions(s, who))).state;
			}
		}
		assert.ok(slotted > 0, "the fuzz reached a slotted choice (" + choices + " choices)");
	});
});
