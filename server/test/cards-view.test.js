/*
 *  cards-view.test.js  --  chess cards engine tests
 *	What each player may see (cards-engine/view.js): playerView, playerEvents, fromView, toFen
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { newGame, legalActions, applyAction, playerView, playerEvents, fromView, toFen, rng, board } = require("../../cards-engine/index.js");
const hand = require("../../cards-engine/hand.js");
const { register, reset } = require("../../cards-engine/cards/index.js");
const { inCheck } = require("../../cards-engine/rules.js");

const other = (c) => (c === "w" ? "b" : "w");
const handOf = (p) => [...p.moves, ...p.actives, ...(p.passive ? [p.passive] : []), ...p.curses];
const fogBy = (s, c) => s.enchant.some((e) => e.key === "fog-of-war" && e.owner === c);
const fresh = (seed = 1) => newGame({ vesper: "b", level: 1300, seed });
const noSquares = (json) => json.replace(/"(square|from|to|ep)":"[a-h][1-8]"/g, ""); // SQUARES c1..c8 LOOK LIKE CARD IDS

/**
 * @description Test-only: add owner's enchant entry with this key through ctx.enchant, or remove it when owner already has one.
 */
function toggle(ctx, owner, key, data, left) {
	const s = ctx.state, i = s.enchant.findIndex((e) => e.key === key && e.owner === owner);
	if (i >= 0) s.enchant.splice(i, 1);
	else ctx.enchant(owner, key, [], left, data);
}

// TEST-ONLY CARDS THAT PUT THE HIDING AND REVEALING SHAPES INTO RANDOM GAMES, IN AN EMPTIED REGISTRY (mirage KEEPS ITS REAL KEY: THE VIEW KEYS ON THAT STRING)
reset();
const active = (key, play) => register({ key, kind: "active", name: key, rarity: "common", text: "", targets: () => [null], play });
active("t-cloud", (ctx, player) => toggle(ctx, player, "fog-of-war", {}, 1));
active("t-pit", (ctx, player) => {
	const empty = ctx.state.board.sq.map((p, i) => (p ? -1 : i)).filter((i) => i >= 0);
	const square = board.sqName(ctx.rng.pick(empty));
	toggle(ctx, player, "trapdoor", { square }, null);
	ctx.emit({ type: "enchant", player, card: { id: "x" + ctx.state.nextId++, key: "trapdoor" }, target: { square }, square }); // HOW A REAL PLACEMENT EVENT MIGHT CARRY IT
});
active("t-illusion", (ctx, player) => {
	const s = ctx.state, o = s.players[other(player)];
	if (o.curses.length >= 2) return;
	const card = { id: "c" + s.nextId++, key: "mirage", piece: ctx.rng.pick(["p", "n", "b", "r", "q"]) };
	o.curses.push(card);
	ctx.emit({ type: "curse-given", player, card });
});
active("t-peek", (ctx, player) => {
	const s = ctx.state, ids = ctx.rng.shuffle(handOf(s.players[other(player)]).map((c) => c.id));
	s.players[player].seen = { ids: ids.slice(0, Math.ceil(ids.length / 2)), fake: [{ id: "c" + s.nextId++, key: "t-pocket" }] };
});
active("t-faceup", (ctx, player) => {
	const c = hand.drawMove(ctx, player), held = c && ctx.state.players[player].moves.find((m) => m.id === c.id);
	if (held) held.faceUp = true;
});
active("t-pocket", () => {}); // A HIDDEN KEY THAT MUST NEVER SHOW
register({ key: "t-hidden-passive", kind: "passive", name: "x", rarity: "common", text: "" });
register({ key: "mirage", kind: "curse", name: "Mirage", rarity: "common", text: "" });

/**
 * @description Oracle: true when viewer may see this card of the opponent's (face up, a curse, the opponent fogged, or revealed by viewer's seen).
 */
function visibleTo(s, viewer, card) {
	const o = s.players[other(viewer)], seen = s.players[viewer].seen;
	return !!card.faceUp || fogBy(s, other(viewer)) || o.curses.some((c) => c.id === card.id) || !!(seen && seen.ids.includes(card.id));
}

/**
 * @description Card keys viewer may legitimately see in this view (own hand, shown, Board Effects, used, enchantments).
 */
function allowedKeys(v, viewer) {
	const vo = v.players[other(viewer)];
	return new Set([...handOf(v.players[viewer]).map((c) => c.key), ...vo.hand.shown.map((c) => c.key), ...v.effects.map((e) => e.card.key),
		...v.players.w.used, ...v.players.b.used, ...v.enchant.map((e) => e.key)]);
}

/**
 * @description Every rng field and every array of 8 integers (the generator key's shape) anywhere in x.
 */
function keyLike(x, found = []) {
	if (Array.isArray(x) && x.length === 8 && x.every(Number.isInteger)) found.push(x);
	if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { if (k === "rng") found.push(k); keyLike(v, found); }
	return found;
}

/**
 * @description Every hiding rule of playerView for viewer on state s.
 */
function checkView(s, viewer) {
	const v = playerView(s, viewer), json = JSON.stringify(v), opp = other(viewer), o = s.players[opp], vo = v.players[opp];
	assert.ok(!json.includes("\"rng\""), "seed in view");
	assert.deepEqual(keyLike(v), [], "generator key in view");
	assert.equal(v.you, viewer);
	assert.equal(vo.hand.count, handOf(o).length);
	for (const k of ["moves", "actives", "passive", "curses", "seen"]) assert.ok(!(k in vo), "opponent " + k + " in view");
	assert.ok(!("seen" in v.players[viewer]), "own seen in view (it tells the fakes apart)");
	const shown = vo.hand.shown.map((c) => c.id), seen = s.players[viewer].seen, allowed = allowedKeys(v, viewer);
	if (seen) for (const f of seen.fake) assert.ok(shown.includes(f.id), "fake card not shown");
	for (const c of handOf(o)) {
		if (visibleTo(s, viewer, c)) { assert.ok(shown.includes(c.id), "visible card " + c.id + " not in shown"); continue; }
		assert.ok(!noSquares(json).includes("\"" + c.id + "\""), "hidden card id " + c.id + " in view");
		if (!allowed.has(c.key)) assert.ok(!json.includes("\"" + c.key + "\""), "hidden key " + c.key + " in view");
	}
	for (const e of v.enchant) if (e.key === "trapdoor") assert.equal("square" in e.data, e.owner === viewer, "trapdoor square");
	if (fogBy(s, opp)) {
		const letters = opp === "w" ? /[PNBRQK]/g : /[pnbrqk]/g, rank = opp === "w" ? "3" : "6";
		const { sq, castling, ep, history, half, ...rest } = v.board, real = s.board;
		sq.forEach((p, i) => assert.deepEqual(p, real.sq[i] && real.sq[i].c === opp ? { ...real.sq[i], t: "?" } : real.sq[i], "fogged square " + i));
		assert.ok(vo.captured.every((t) => t === "?"), "fogged captured list");
		assert.deepEqual(history, [], "fogged history"); // ITS CASTLING AND EN PASSANT TOKENS NAME THE FOGGED KING, ROOKS AND PAWNS
		assert.equal(half, 0, "fogged half-move counter"); // A RESET COUNTER NAMES A PAWN MOVE
		assert.equal(castling, real.castling.replace(letters, "") || "-", "fogged castling");
		assert.equal(ep, real.ep && real.ep[1] === rank ? null : real.ep, "fogged en passant");
		const { sq: _s, castling: _c, ep: _e, history: _h, half: _f, ...realRest } = real;
		assert.deepEqual(rest, realRest, "other board fields");
	} else assert.deepEqual(v.board, s.board);
	const mine = s.players[viewer].curses.filter((c) => c.key === "mirage");
	const gave = o.curses.some((c) => c.key === "mirage"); // A HOLDER WHO ALSO GAVE ONE SEES THAT ONE IN shown
	if (mine.length) assert.ok(!JSON.stringify(gave ? v.players[viewer] : v).includes("mirage"), "mirage in its holder's view");
	for (const m of mine) assert.ok(v.players[viewer].moves.some((c) => c.id === m.id && c.key === "move" && c.piece === m.piece), "mirage not a move card");
	for (const m of o.curses.filter((c) => c.key === "mirage")) assert.ok(vo.hand.shown.some((c) => c.id === m.id && c.key === "mirage"), "giver can't see mirage");
	return v;
}

/**
 * @description Every hiding rule of playerEvents for viewer, on the events of one action and the state after it; also that neither input changes.
 */
function checkEvents(next, events, viewer) {
	const rawEvents = JSON.stringify(events), rawState = JSON.stringify(next), opp = other(viewer);
	const ev = playerEvents(next, events, viewer), json = JSON.stringify(ev);
	assert.equal(JSON.stringify(events), rawEvents, "events mutated");
	assert.equal(JSON.stringify(next), rawState, "state mutated");
	assert.equal(ev.length, events.length);
	assert.ok(!json.includes("\"rng\""));
	const allowed = allowedKeys(playerView(next, viewer), viewer), fog = fogBy(next, opp);
	for (const e of events) if (e.type === "card-played" || e.type === "passive-placed") allowed.add(e.card.key); // PLAYED CARDS ARE PUBLIC
	events.forEach((e, i) => {
		const one = JSON.stringify(ev[i]);
		if (e.player === opp && (e.type === "draw" || e.type === "discard") && !visibleTo(next, viewer, e.card)) {
			assert.ok(!noSquares(json).includes("\"" + e.card.id + "\""), "hidden card id " + e.card.id + " in events");
			if (!allowed.has(e.card.key)) assert.ok(!json.includes("\"" + e.card.key + "\""), "hidden key " + e.card.key + " in events");
		}
		if (e.card && e.card.key === "mirage" && next.players[viewer].curses.some((c) => c.id === e.card.id)) {
			assert.ok(!one.includes("mirage"), "mirage in its holder's events");
			if (e.type === "curse-given") assert.equal(ev[i].type, "draw");
		}
		if (e.player === opp && e.card && e.card.key === "trapdoor") assert.ok(!("square" in ev[i]) && !("target" in ev[i]), "trapdoor square in events");
		if (fog && e.type === "move" && e.player === opp) assert.ok(!("card" in ev[i]) && !("castle" in ev[i]), "fogged move card");
		if (fog && (e.type === "capture" || e.type === "promote") && e.piece[0] === opp) assert.equal(ev[i].t, "?", "fogged " + e.type);
	});
}

/**
 * @description Play a seeded random game for at most plies actions (actives played half the time they're offered); onStep(next, events, i) after each.
 */
function randomGame(seed, plies, onStep) {
	let s = fresh(seed);
	const R = { rng: rng.seed(seed) };
	for (let i = 0; i < plies && !s.result; i++) {
		const c = s.board.turn, acts = legalActions(s, c);
		if (!acts.length) break;
		const actives = acts.filter((a) => a.type === "active");
		const a = actives.length && rng.next(R) < 0.5 ? rng.pick(R, actives) : rng.pick(R, acts);
		const { state, events } = applyAction(s, c, a);
		onStep(state, events, i);
		s = state;
	}
	return s;
}

test("the view never contains the seed or the opponent's hidden cards", { timeout: 30000 }, () => {
	const hits = { fog: 0, trapdoor: 0, mirage: 0, seen: 0, faceUp: 0 };
	for (let g = 1; g <= 200; g++) {
		randomGame(g, 30, (s, events, i) => {
			for (const viewer of ["w", "b"]) {
				const v = checkView(s, viewer);
				checkEvents(s, events, viewer);
				if (i % 10 === 0) assert.ok(Array.isArray(legalActions(fromView(v, g), s.board.turn)));
			}
			if (s.enchant.some((e) => e.key === "fog-of-war")) hits.fog++;
			if (s.enchant.some((e) => e.key === "trapdoor")) hits.trapdoor++;
			if (s.players.w.curses.length + s.players.b.curses.length) hits.mirage++;
			if (s.players.w.seen || s.players.b.seen) hits.seen++;
			if (handOf(s.players.w).some((c) => c.faceUp) || handOf(s.players.b).some((c) => c.faceUp)) hits.faceUp++;
		});
	}
	for (const [k, n] of Object.entries(hits)) assert.ok(n > 100, k + " seen in only " + n + " plies");
});

test("a view never holds the generator key: no rng field, no 8-integer array, no key word, at any ply", () => {
	const hex = (g) => Array.from({ length: 32 }, (_, i) => ((g * 37 + i * 101 + 1) & 255).toString(16).padStart(2, "0")).join(""); // THE SERVER'S SEED SHAPE
	for (let g = 1; g <= 20; g++) {
		const start = fresh(hex(g)), words = start.rng.key.map(String);
		const clean = (x) => {
			assert.deepEqual(keyLike(x), [], "key-shaped data");
			const json = JSON.stringify(x);
			for (const w of words) assert.ok(!json.includes(w), "key word " + w);
		};
		for (const viewer of ["w", "b"]) clean(playerView(start, viewer));
		randomGame(hex(g), 30, (s, events) => {
			for (const viewer of ["w", "b"]) { clean(playerView(s, viewer)); clean(playerEvents(s, events, viewer)); }
		});
	}
});

test("Trapdoor's square shows only to its owner", () => {
	const s = fresh();
	s.enchant.push({ id: "e1", key: "trapdoor", owner: "w", pieces: [], left: null, data: { square: "e3" } });
	assert.equal(playerView(s, "w").enchant[0].data.square, "e3");
	const b = playerView(s, "b");
	assert.deepEqual(b.enchant[0], { id: "e1", key: "trapdoor", owner: "w", pieces: [], left: null, data: {} });
	assert.equal(s.enchant[0].data.square, "e3"); // THE INPUT KEEPS IT
	const ev = [{ type: "card-played", player: "w", card: { id: "c90", key: "trapdoor" }, target: { square: "e3" } }];
	assert.ok(!JSON.stringify(playerEvents(s, ev, "b")).includes("e3"));
	assert.deepEqual(playerEvents(s, ev, "w"), ev);
	assert.equal(ev[0].target.square, "e3");
});

test("Mirage shows as a move card to its holder, and the key mirage is nowhere in their view", () => {
	const s = fresh(), m = { id: "c99", key: "mirage", piece: "n" };
	s.players.b.curses.push(m);
	const v = playerView(s, "b");
	assert.ok(!JSON.stringify(v).includes("mirage"));
	assert.deepEqual(v.players.b.moves.at(-1), { id: "c99", key: "move", piece: "n" });
	assert.equal(v.players.b.moves.length, 7);
	assert.deepEqual(v.players.b.curses, []);
	const g = playerView(s, "w");
	assert.ok(g.players.b.hand.shown.some((c) => c.id === "c99" && c.key === "mirage"));
	assert.equal(g.players.b.hand.count, 8);
	const given = [{ type: "curse-given", player: "w", card: m }];
	assert.deepEqual(playerEvents(s, given, "b"), [{ type: "draw", player: "b", card: { id: "c99", key: "move", piece: "n" } }]);
	assert.deepEqual(playerEvents(s, given, "w"), given);
	const spent = [{ type: "move", player: "b", card: m, piece: "b2", from: "g8", to: "f6" }];
	assert.ok(!JSON.stringify(playerEvents(s, spent, "b")).includes("mirage"));
});

test("under Fog of War the opponent's view has t '?' and no piece type for the caster's pieces", () => {
	const s = fresh();
	s.enchant.push({ id: "e1", key: "fog-of-war", owner: "b", pieces: [], left: 1, data: {} });
	s.players.b.captured = ["p", "n"];
	s.board.half = 3;
	const v = playerView(s, "w");
	for (const p of v.board.sq.filter(Boolean)) assert.equal(p.t === "?", p.c === "b");
	assert.deepEqual(v.players.b.captured, ["?", "?"]);
	assert.deepEqual(v.board.history, []);
	assert.equal(v.board.half, 0);
	assert.equal(s.board.history.length, 1); // THE STATE KEEPS BOTH FOR REPETITION AND THE FIFTY-MOVE RULE
	assert.equal(s.board.half, 3);
	assert.equal(v.board.castling, "KQ");
	assert.deepEqual(v.players.b.hand.shown.map((c) => c.id).sort(), handOf(s.players.b).map((c) => c.id).sort());
	assert.equal(toFen(v), "????????/????????/8/8/8/8/PPPPPPPP/RNBQKBNR w KQ - 0 1");
	assert.equal(toFen(s), board.toFen(s.board));
	assert.deepEqual(playerView(s, "b").board, s.board); // THE CASTER SEES ITS OWN PIECES, THE HISTORY AND THE COUNTER
	const id = s.board.sq.find((p) => p && p.c === "b").id;
	const ev = [
		{ type: "move", player: "b", card: { id: "c3", key: "move", piece: "k" }, piece: id, from: "e8", to: "g8", castle: "k" },
		{ type: "capture", player: "w", piece: id, t: "q" },
		{ type: "promote", player: "b", piece: id, t: "q" },
	];
	const w = playerEvents(s, ev, "w");
	assert.deepEqual(w[0], { type: "move", player: "b", piece: id, from: "e8", to: "g8" });
	assert.equal(w[1].t, "?");
	assert.equal(w[2].t, "?");
	assert.deepEqual(playerEvents(s, ev, "b"), ev);
});

test("Foresight shows the seen cards and the fakes, and no seen field", () => {
	const s = fresh(), ids = s.players.b.moves.slice(0, 2).map((c) => c.id), fake = { id: "c80", key: "t-pocket" };
	s.players.w.seen = { ids, fake: [fake] };
	s.barred = "{\"card\":\"" + s.players.w.moves[0].id + "\"}";
	const v = playerView(s, "w");
	assert.deepEqual(v.players.b.hand.shown.map((c) => c.id), [...ids, "c80"]);
	assert.ok(!("seen" in v.players.w) && !("seen" in v.players.b));
	assert.equal(playerView(s, "b").barred, s.barred); // THE BARRED ACTION WAS PLAYED AND UNDONE IN FRONT OF BOTH PLAYERS
	assert.equal(v.barred, s.barred);
});

test("fromView keeps everything the view shows", () => {
	const s = randomGame(7, 12, () => {}), me = s.board.turn, opp = other(me);
	assert.ok(!s.enchant.some((e) => e.key === "fog-of-war"), "the game this part needs has no fog up"); // THE FOGGED CASE IS BELOW
	const v = playerView(s, me), f = fromView(v, 7);
	assert.deepEqual(f.board, s.board);
	assert.deepEqual(f.players[me], { ...v.players[me], seen: null }); // OWN seen IS NOT IN THE VIEW; A MIRAGE STAYS A MOVE CARD
	assert.equal(handOf(f.players[opp]).length, v.players[opp].hand.count);
	assert.deepEqual(f.rng, { key: rng.seed(7).key, n: f.rng.n });
	assert.ok(Number.isInteger(f.rng.n));
	assert.deepEqual(fromView(v, 7), f);
	assert.deepEqual(JSON.parse(JSON.stringify(v)), playerView(s, me)); // fromView LEAVES THE VIEW ALONE
	const acts = legalActions(f, me);
	assert.ok(acts.length);
	assert.doesNotThrow(() => applyAction(f, me, acts[0]));
	// UNDER FOG: EVERY "?" FILLED, ONE KING EACH, THE SIDE NOT TO MOVE NOT IN CHECK
	const g = fresh(5);
	g.enchant.push({ id: "e1", key: "fog-of-war", owner: "b", pieces: [], left: 1, data: {} });
	const h = fromView(playerView(g, "w"), 11);
	assert.ok(h.board.sq.every((p) => !p || "pnbrqk".includes(p.t)));
	assert.equal(h.board.sq.filter((p) => p && p.c === "b" && p.t === "k").length, 1);
	assert.ok(h.board.sq.every((p, i) => !p || p.t !== "p" || (i >= 8 && i < 56)));
	assert.deepEqual(fromView(playerView(g, "w"), 11), h);
	const a = legalActions(h, "w").find((x) => x.type === "move");
	const after = applyAction(h, "w", a).state;
	assert.ok(legalActions(after, "b").length);
	assert.ok(!toFen(h).includes("?"));
});

test("the opponent's player shows only the fields the view is meant to show", () => {
	const s = fresh();
	s.players.b.secret = "x";
	s.players.w.secret = "y";
	const w = playerView(s, "w");
	assert.ok(!("secret" in w.players.b));
	assert.deepEqual(Object.keys(w.players.b).sort(), ["captured", "curseWait", "hand", "king", "kingSkulls", "lostTurns", "refillLock", "skips", "used"]);
	assert.equal(w.players.w.secret, "y"); // THE VIEWER'S OWN PLAYER KEEPS EVERY FIELD BUT seen
	assert.equal(playerView(s, "b").players.b.secret, "x");
});

test("fromView leaves the side not to move out of check when the fogged side is to move", { timeout: 30000 }, () => {
	// THE REVIEWER'S PROBE: 12 FIXED-PATTERN MOVES, THEN A FOG FOR THE SIDE TO MOVE (BEFORE THE FIX, SOME OF THESE LEFT THE VIEWER IN CHECK)
	let opened = 0;
	for (let seed = 1; seed <= 300; seed++) {
		let s = fresh(seed);
		for (let i = 0; i < 12 && !s.result; i++) {
			const acts = legalActions(s, s.board.turn).filter((a) => a.type === "move");
			if (!acts.length) break;
			s = applyAction(s, s.board.turn, acts[(seed * 7 + i * 13) % acts.length]).state;
		}
		if (s.result) continue;
		opened++;
		const toMove = s.board.turn, viewer = other(toMove);
		s.enchant.push({ id: "e1", key: "fog-of-war", owner: toMove, pieces: [], left: 1, data: {} });
		const f = fromView(playerView(s, viewer), seed);
		assert.ok(f.board.sq.every((p) => !p || "pnbrqk".includes(p.t)), "seed " + seed + " unfilled");
		assert.ok(!inCheck(f, viewer), "seed " + seed + ": the side not to move is in check");
	}
	assert.ok(opened > 250, String(opened));
});

test("a pending choice shows in full only to the player choosing; the other sees whose it is and its kind; a queued one shows to nobody", () => {
	const s = fresh(), next = [{ card: "t-pocket", player: "w", kind: "later", options: ["zz9"], turn: "w" }];
	const pending = { card: "t-pocket", n: 3, player: "b", kind: "pick", options: [{ id: "c42" }, { id: "c43" }], turn: "w", next };
	s.pending = pending;
	const { next: _n, ...current } = pending;
	assert.deepEqual(playerView(s, "b").pending, current);
	assert.deepEqual(playerView(s, "w").pending, { player: "b", kind: "pick" });
	assert.ok(!JSON.stringify(playerView(s, "w")).includes("c42"));
	for (const c of ["w", "b"]) assert.ok(!JSON.stringify(playerView(s, c)).includes("zz9"), "queued choice in " + c + "'s view");
	assert.equal(s.pending, pending); // THE STATE KEEPS IT
	assert.deepEqual(s.pending.next, next);
	assert.equal(playerView(fresh(), "w").pending, null);
});

test("a piece's colour comes from the board, never its id: a white piece with a b id is fogged as White's", () => {
	const s = fresh(), q = s.board.sq.find((p) => p && p.c === "w" && p.t === "q"), r = s.board.sq.find((p) => p && p.c === "w" && p.t === "r");
	q.id = "b77";
	r.id = "b78";
	s.enchant.push({ id: "e1", key: "fog-of-war", owner: "w", pieces: ["b78"], left: 1, data: {} });
	s.statuses = { b78: [{ s: "frozen", left: 1, by: "b" }] };
	const v = playerView(s, "b");
	assert.equal(v.board.sq.find((p) => p && p.id === "b77").t, "?");
	const ev = [{ type: "promote", player: "w", piece: "b77", t: "q" }, { type: "capture", player: "b", piece: "b79", t: "n", c: "w", by: "b5" }];
	const out = playerEvents(s, ev, "b");
	assert.deepEqual(out.map((e) => e.t), ["?", "?"]);
	assert.deepEqual(playerEvents(s, ev, "w").map((e) => e.t), ["q", "n"]);
	const ctx = require("../../cards-engine/ctx.js").makeCtx(s);
	require("../../cards-engine/statuses.js").tick(ctx, "w"); // THE b78 ROOK IS WHITE'S: WHITE'S TICK ENDS ITS STATUS
	assert.equal(s.statuses.b78, undefined);
});
