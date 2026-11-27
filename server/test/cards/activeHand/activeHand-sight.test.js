/*
 *  activeHand-sight.test.js  --  chess cards engine tests
 *	Actives that act on information (cards-engine/cards/active/): Foresight and Fog of War
 *
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { legalActions, applyAction, playerView, playerEvents, fromView, fromFen, hand, CARDS, baseKey, fresh, ofType, ids, byId, holding, play, step, movesOf, varied, notInCheck, sqIndex, at, moveCard, moveFrom } = require("../../helpers/activeHand.js");

describe("Foresight", () => {
	test("shows a random half (rounded up) of the opponent's hidden hand, drawn from state.rng", () => {
		for (const seed of [1, 2, 3, 4, 5]) {
			const { s, id } = holding("foresight", "w", seed);
			s.players.b.passive = hand.newCard(s, "t-none");
			s.players.b.curses = [hand.newCard(s, "t-curse")]; // SHOWN ANYWAY: NOT PART OF THE HALF
			const hidden = ids([...s.players.b.moves, ...s.players.b.actives, s.players.b.passive]); // 5 + 1 + 1 = 7: ROUNDED UP TO 4
			const r = play(s, "w", id), seen = r.state.players.w.seen;
			assert.equal(seen.ids.length, 4);
			assert.equal(new Set(seen.ids).size, 4);
			for (const x of seen.ids) assert.ok(hidden.includes(x), "seen id not a hidden card: " + x);
			assert.deepEqual(seen.fake, []);
			assert.deepEqual(play(s, "w", id).state.players.w.seen, seen); // SAME STATE, SAME RNG, SAME PICK
			const v = playerView(r.state, "w");
			assert.deepEqual(ids(v.players.b.hand.shown), [...seen.ids, ...ids(s.players.b.curses)].sort(byId));
			assert.ok(!("seen" in v.players.w));
			assert.ok(!("rng" in v));
		}
		const picks = new Set();
		for (let seed = 1; seed <= 20; seed++) { const { s, id } = holding("foresight", "w", seed); picks.add(play(s, "w", id).state.players.w.seen.ids.join()); }
		assert.ok(picks.size > 1, "the half is not random");
	});

	test("lasts until the end of the player's next turn", () => {
		const { s, id } = holding("foresight");
		const r = play(s, "w", id);
		assert.ok(r.state.players.w.seen);
		assert.deepEqual(ofType(r.events, "enchant").map((e) => e.key), ["foresight"]);
		let t = step(r.state, "b"); // BLACK'S TURN
		assert.ok(t.players.w.seen, "gone on the opponent's turn");
		assert.equal(t.board.turn, "w");
		const last = applyAction(t, "w", legalActions(t, "w").find((a) => a.type === "move")); // WHITE'S NEXT TURN ENDS
		assert.equal(last.state.players.w.seen, null);
		assert.ok(!last.state.enchant.some((e) => e.key === "foresight"));
		assert.equal(ofType(last.events, "enchant-ended").length, 1);
		assert.equal(playerView(last.state, "w").players.b.hand.shown.length, 0);
	});

	test("rare and epic versions: the opponent's whole hand, live (a card drawn later shows too), until the end of the player's next turn (rare) or for 3 of the player's turns (epic)", () => {
		for (const [key, turns] of [["foresight-rare", 1], ["foresight-epic", 3]]) {
			const { s, id } = holding(key);
			s.players.b.passive = hand.newCard(s, "t-none");
			s.players.b.moves.pop(); // BLACK'S END-OF-TURN REFILL DRAWS A NEW MOVE CARD
			const whole = (st) => ids([...st.players.b.moves, ...st.players.b.actives, st.players.b.passive, ...st.players.b.curses]).sort(byId);
			const r = play(s, "w", id);
			assert.deepEqual(ofType(r.events, "enchant").map((e) => e.key), ["foresight"]);
			assert.deepEqual(ids(playerView(r.state, "w").players.b.hand.shown), whole(r.state), key);
			let st = r.state, n = 0;
			for (let i = 0; st.players.w.seen && i < 20; i++) {
				const b = applyAction(st, "b", movesOf(st, "b")[(i * 7 + 3) % movesOf(st, "b").length]);
				st = b.state;
				const drawn = ofType(b.events, "draw").filter((e) => e.player === "b");
				if (i === 0) assert.ok(drawn.length > 0);
				assert.deepEqual(ids(playerView(st, "w").players.b.hand.shown), whole(st), key + ": not the whole hand on turn " + n);
				assert.ok(playerEvents(st, b.events, "w").filter((e) => e.type === "draw" && e.player === "b").every((e) => e.card), key + ": a draw hidden");
				st = varied(st, "w", i);
				n++;
			}
			assert.equal(st.result, null);
			assert.equal(n, turns, key);
			assert.equal(st.players.w.seen, null);
			assert.equal(playerView(st, "w").players.b.hand.shown.length, 0);
		}
		assert.deepEqual(["foresight-rare", "foresight-epic"].map((k) => [CARDS[k].name, CARDS[k].rarity, CARDS[k].skulls]), [["Foresight", "rare", 0], ["Foresight", "epic", 0]]);
	});

	test("not playable in check", () => notInCheck("foresight", true));

	test("a rare Foresight ending while a later base one lasts leaves only the base card's half", () => {
		const { s, id } = holding("foresight-rare");
		let st = varied(play(s, "w", id).state, "b", 0);
		const base = hand.newCard(st, "foresight");
		st.players.w.actives = [base];
		st = play(st, "w", base.id).state; // THE RARE ENTRY ENDS AT THE END OF THIS TURN, THE BASE ONE A TURN LATER
		assert.deepEqual(st.enchant.filter((e) => e.key === "foresight").map((e) => !!(e.data && e.data.all)), [false]);
		assert.equal(st.players.w.seen.all, false);
		const half = st.players.w.seen.ids;
		assert.ok(half.length > 0 && half.length < st.players.b.moves.length + st.players.b.actives.length);
		assert.deepEqual(ids(playerView(st, "w").players.b.hand.shown).sort(byId), half.filter((x) => [...st.players.b.moves, ...st.players.b.actives].some((c) => c.id === x)).sort(byId));
	});

	test("a base Foresight played while the epic one lasts keeps the whole-hand sight for the epic's turns", () => {
		const { s, id } = holding("foresight-epic");
		const whole = (st) => ids([...st.players.b.moves, ...st.players.b.actives, ...(st.players.b.passive ? [st.players.b.passive] : []), ...st.players.b.curses]).sort(byId);
		let st = varied(play(s, "w", id).state, "b", 0);
		const base = hand.newCard(st, "foresight");
		st.players.w.actives = [base];
		st = play(st, "w", base.id).state;
		assert.deepEqual(st.enchant.filter((e) => e.key === "foresight").map((e) => e.left).sort(), [1, 2]);
		for (let i = 1; st.enchant.some((e) => e.key === "foresight" && e.data && e.data.all); i++) {
			assert.deepEqual(ids(playerView(st, "w").players.b.hand.shown).sort(byId), whole(st), "turn " + i);
			st = varied(st, "b", i);
			if (st.enchant.some((e) => e.key === "foresight")) assert.deepEqual(ids(playerView(st, "w").players.b.hand.shown).sort(byId), whole(st), "after Black's move " + i);
			st = varied(st, "w", i);
		}
		assert.equal(st.players.w.seen, null);
	});
});

describe("Fog of War", () => {
	const FOGS = { "fog-of-war": { turns: 3, hand: true }, "fog-of-war-rare": { turns: 3, hand: false }, "fog-of-war-epic": { turns: 5, hand: false } };
	const fogUp = (s) => s.enchant.some((e) => e.owner === "w" && baseKey(e.key) === "fog-of-war");

	test("puts a fog-of-war enchantment up: the opponent sees none of the player's pieces on the player's half; the hand shows for the base card only", () => {
		for (const [key, { turns, hand: open }] of Object.entries(FOGS)) {
			const { s, id } = holding(key);
			s.players.w.moves.pop(); // THE END-OF-TURN REFILL DRAWS A MOVE CARD
			const r = play(s, "w", id);
			const fog = r.state.enchant.filter((e) => baseKey(e.key) === "fog-of-war");
			assert.equal(fog.length, 1);
			const { fresh: f, ...entry } = fog[0];
			assert.deepEqual(entry, { id: entry.id, key, owner: "w", pieces: [], left: turns, data: {} });
			assert.deepEqual(ofType(r.events, "enchant").map((e) => [e.player, e.key]), [["w", key]]);
			const v = playerView(r.state, "b");
			assert.ok(v.board.sq.filter(Boolean).every((p) => p.c === "b"), key); // EVERY WHITE PIECE STARTS ON WHITE'S HALF: NONE IN THE VIEW
			assert.equal(v.board.hidden, 16, key);
			assert.deepEqual(v.board.history, []);
			assert.equal(v.board.half, 0);
			const w = r.state.players.w, all = ids([...w.moves, ...w.actives, ...(w.passive ? [w.passive] : []), ...w.curses]).sort(byId);
			assert.deepEqual(ids(v.players.w.hand.shown), open ? all : [], key);
			const draws = playerEvents(r.state, r.events, "b").filter((e) => e.type === "draw" && e.player === "w");
			assert.ok(draws.length > 0);
			assert.ok(draws.every((e) => !!e.card === open), key + ": the fogged player's draws");
			assert.equal(playerView(r.state, "w").board.sq.filter(Boolean).length, 32);
			assert.ok(!("hidden" in playerView(r.state, "w").board));
		}
		assert.deepEqual(["fog-of-war", "fog-of-war-rare", "fog-of-war-epic"].map((k) => [CARDS[k].name, CARDS[k].rarity, CARDS[k].skulls]),
			[["Fog of War", "uncommon", 2], ["Fog of War", "rare", 0], ["Fog of War", "epic", 0]]);
		assert.equal(CARDS["fog-of-war"].text, "For 3 turns the opponent can't see your pieces on your half of the board and isn't shown their legal moves. Debuff: your hand is visible to the opponent while the fog lasts.");
	});

	test("lasts 3 of the player's turns (the epic version 5), the hand open (base card) or hidden (versions) throughout", () => {
		for (const [key, { turns, hand: open }] of Object.entries(FOGS)) {
			const { s, id } = holding(key);
			let st = play(s, "w", id).state, n = 0;
			for (let i = 0; fogUp(st) && i < 20; i++) {
				st = varied(st, "b", i);
				assert.ok(fogUp(st), key + ": fog ended before the player's turn");
				assert.ok(playerView(st, "b").board.hidden > 0, key);
				assert.equal(playerView(st, "b").players.w.hand.shown.length > 0, open, key);
				const r = applyAction(st, "w", movesOf(st, "w")[i % movesOf(st, "w").length]);
				st = r.state;
				n++;
				if (!fogUp(st)) assert.deepEqual(ofType(r.events, "enchant-ended").map((e) => e.key), [key]);
			}
			assert.equal(st.result, null);
			assert.equal(n, turns, key);
			assert.ok(!("hidden" in playerView(st, "b").board));
			assert.deepEqual(playerView(st, "b").board, st.board);
			assert.equal(playerView(st, "b").players.w.hand.shown.length, 0);
		}
	});

	test("a piece that leaves the player's half is shown, one that comes back is hidden; the opponent's events never name a hidden type", () => {
		const { s, id } = holding("fog-of-war", "w", 1, "4k3/8/8/8/R7/8/8/4K3 w - - 0 1"); // THE ROOK ON a4 STANDS ON WHITE'S HALF
		const rook = at(s, "a4").id;
		s.players.w.moves = [moveCard(s, "r"), moveCard(s, "r")];
		const r = play(s, "w", id), seen = (st, sq) => playerView(st, "b").board.sq[sqIndex(sq)];
		assert.equal(seen(r.state, "a4"), null);
		assert.equal(seen(r.state, "e1"), null);
		assert.ok(!JSON.stringify(playerView(r.state, "b")).includes("\"" + rook + "\""));
		const up = applyAction(step(r.state, "b"), "w", moveFrom(step(r.state, "b"), "w", "a4", "a5"));
		assert.deepEqual(seen(up.state, "a5"), { id: rook, c: "w", t: "r" }); // ON BLACK'S HALF: SHOWN
		assert.equal(seen(up.state, "e1"), null);
		assert.deepEqual(playerEvents(up.state, up.events, "b").filter((e) => e.type === "move"), [{ type: "move", player: "w", piece: rook, to: "a5" }]); // WHERE IT STOOD IN THE FOG ISN'T TOLD
		const t = step(up.state, "b"), back = applyAction(t, "w", moveFrom(t, "w", "a5", "a4"));
		assert.ok(fogUp(back.state));
		assert.equal(seen(back.state, "a4"), null); // BACK ON WHITE'S HALF: HIDDEN
		assert.deepEqual(playerEvents(back.state, back.events, "b").filter((e) => e.type === "move"), [{ type: "move", player: "w" }]); // A HIDDEN PIECE'S MOVE: NO PIECE, NO SQUARES
		assert.ok(!JSON.stringify(playerEvents(back.state, back.events, "b")).includes("\"" + rook + "\""));
		const v = playerView(back.state, "b");
		assert.deepEqual([v.board.history, v.board.half, v.board.castling, v.players.w.captured], [[], 0, "-", []]);
		const cap = [{ type: "capture", player: "b", piece: rook, t: "r", c: "w", by: "b5", sq: "a4" }];
		const gone = JSON.parse(JSON.stringify(back.state));
		gone.board.sq[sqIndex("a4")] = null; // TAKEN: OFF THE BOARD
		assert.deepEqual(playerEvents(gone, cap, "b"), [{ type: "capture", player: "b", t: "?", c: "w", by: "b5", sq: "a4" }]); // NEITHER ITS TYPE NOR ITS ID
	});

	test("a visible king on the opponent's half: fromView gives the fogged side no second king", () => {
		const s = fresh(5);
		s.board = fromFen("8/8/4k3/1K6/8/8/PPPP4/RNBQ4 b - - 0 1"); // WHITE'S KING ON b5: BLACK'S HALF, SO SHOWN
		s.enchant.push({ id: "e1", key: "fog-of-war", owner: "w", pieces: [], left: 3, data: {} });
		const v = playerView(s, "b");
		assert.equal(v.board.sq[sqIndex("b5")].t, "k");
		for (let seed = 1; seed <= 20; seed++) {
			const f = fromView(v, seed);
			assert.equal(f.board.sq.filter((p) => p && p.c === "w" && p.t === "k").length, 1, "seed " + seed);
			assert.ok(f.board.sq.every((p) => !p || "pnbrqk".includes(p.t)));
		}
	});

	test("not playable in check", () => notInCheck("fog-of-war", false));
});
