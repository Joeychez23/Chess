/*
 *  cardGuy-scoringAndFog.test.js  --  chess server tests
 *	Card Guy, the card-game bot (server/utils/card-guy): candidates and scoring, the engine calls, and playing under the player's Fog of War. The engine is stubbed: no test reaches Stockfish.
 *
 */

require("../helpers/env.js");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { engine, newGame, legalActions, applyAction, playerView, actionKey, toFen, fromFen, hand, makeCtx, cardGuy, cardGuyTurn, scoreTurn, MAX_EVALS, candidates, staticScore, cardScore, WEIGHTS, bestOf, material, firstOf, down, opts, isLegal, owes, fogUp, place, notChess, position, ask, play } = require("../helpers/cardGuy.js");
const FOGGED_SWAP = JSON.parse('{"v":2,"rng":{"key":[1003,0,0,0,0,0,0,0],"n":276},"board":{"sq":[{"id":"b10","c":"b","t":"r"},{"id":"b8","c":"b","t":"n"},null,null,null,{"id":"w3","c":"w","t":"n"},null,null,{"id":"b3","c":"b","t":"p"},null,null,{"id":"b9","c":"b","t":"q"},{"id":"b13","c":"b","t":"n"},null,null,null,null,null,null,null,null,{"id":"b7","c":"b","t":"p"},null,{"id":"b2","c":"b","t":"r"},null,{"id":"w11","c":"w","t":"p"},{"id":"b12","c":"b","t":"k"},null,{"id":"w8","c":"w","t":"k"},{"id":"w12","c":"w","t":"p"},null,null,null,null,null,null,null,null,null,{"id":"b11","c":"b","t":"p"},null,null,null,{"id":"w1","c":"w","t":"p"},{"id":"b15","c":"b","t":"p"},{"id":"w16","c":"w","t":"p"},null,null,{"id":"w14","c":"w","t":"r"},null,null,null,null,null,{"id":"w15","c":"w","t":"p"},{"id":"w13","c":"w","t":"p"},null,{"id":"w2","c":"w","t":"n"},{"id":"w4","c":"w","t":"b"},{"id":"w10","c":"w","t":"q"},{"id":"b16","c":"b","t":"b"},{"id":"w6","c":"w","t":"b"},null,{"id":"w7","c":"w","t":"r"}],"turn":"w","castling":"-","ep":null,"half":0,"full":28,"history":[]},"cardGuy":"w","level":1300,"ply":54,"nextId":98,"players":{"w":{"king":true,"moves":[{"id":"c68","key":"move","piece":"p"},{"id":"c69","key":"move","piece":"p"},{"id":"c77","key":"move","piece":"m"},{"id":"c80","key":"move","piece":"p"},{"id":"c83","key":"move","piece":"m"},{"id":"c85","key":"move","piece":"m"}],"actives":[{"id":"c97","key":"swap-epic"}],"passive":null,"curses":[],"used":[],"skips":0,"refillLock":0,"curseWait":0,"lostTurns":0,"kingSkulls":3,"captured":["p","p"],"seen":null},"b":{"king":true,"moves":[{"id":"c12","key":"move","piece":"p"},{"id":"c46","key":"move","piece":"p"},{"id":"c88","key":"move","piece":"p"},{"id":"c92","key":"move","piece":"p"},{"id":"c94","key":"move","piece":"p"},{"id":"c96","key":"move","piece":"p"}],"actives":[{"id":"c61","key":"pickpocket-epic"}],"passive":{"id":"c39","key":"reinforcements"},"curses":[],"used":[],"skips":0,"refillLock":0,"curseWait":0,"lostTurns":0,"kingSkulls":3,"captured":["p","p","p","b","b"],"seen":null}},"statuses":{"w7":[{"s":"warded","left":null,"by":"w"}],"b3":[{"s":"frozen","left":1,"by":"b","veiled":true}]},"effects":[{"id":"c43","owner":"w","card":{"id":"c43","key":"phalanx","denied":false},"placedAt":52}],"enchant":[{"id":"e30","key":"fog-of-war-rare","owner":"b","pieces":[],"left":36,"data":{}},{"id":"e52","key":"stronghold-common","owner":"w","pieces":["w7"],"left":null,"data":{}}],"duel":null,"pending":null,"multi":null,"barred":null,"result":null}'); // A REVIEW FUZZ STATE (tremor, GAME 3, ACTION 66; ITS HISTORY CUT): CARD GUY WHITE, LEVEL 1300, AN EPIC SWAP IN HAND UNDER BLACK'S FOG: 115 CANDIDATES

test("candidates keep bestPlain and the top 5 plain moves by static score, and every card action but the free discard", () => {
	const s = position("4k3/8/8/r2Q4/8/8/8/4K3 b - - 0 1");
	Object.assign(s.players.b, { moves: [hand.newCard(s, "move", { piece: "r" }), hand.newCard(s, "move", { piece: "r" })], actives: [hand.newCard(s, "fog-of-war")], passive: hand.newCard(s, "patience") });
	const quiet = { from: "a5", to: "a8" }, all = legalActions(s, "b"), list = candidates(s, "b", { bestPlain: quiet });
	const plain = list.filter((a) => a.type === "move");
	assert.deepEqual([plain[0].from, plain[0].to], ["a5", "a8"]); // bestPlain FIRST
	assert.deepEqual([plain[1].from, plain[1].to], ["a5", "d5"]); // THEN THE BEST STATIC SCORE
	assert.equal(plain.length, 6);
	assert.equal(new Set(plain.map((a) => a.from + a.to)).size, 6); // TWO ROOK CARDS: ONE CANDIDATE A MOVE
	assert.deepEqual(list.filter((a) => a.type !== "move"), all.filter((a) => a.type !== "move" && a.type !== "discard"));
	assert.ok(all.some((a) => a.type === "discard") && !list.some((a) => a.type === "discard"));
	assert.ok(staticScore(s, { from: "a5", to: "d5" }) > staticScore(s, { from: "a5", to: "a1" })); // A CAPTURE OVER A CHECK
	assert.ok(staticScore(s, { from: "a5", to: "a1" }) > staticScore(s, quiet)); // A CHECK OVER A QUIET MOVE
	const promo = position("4k3/8/8/8/8/8/p7/4K3 b - - 0 1");
	assert.ok(staticScore(promo, { from: "a2", to: "a1", promotion: "q" }) > staticScore(promo, { from: "a2", to: "a1", promotion: "n" }));
	assert.equal(legalActions(s, "b").filter((a) => a.to === "d5").length, 2); // ONE PER ROOK CARD
	assert.equal(candidates(s, "b", { refused: [actionKey(plain[1])] }).filter((a) => a.to === "d5").length, 0); // A REFUSED MOVE ISN'T OFFERED AGAIN UNDER THE OTHER ROOK CARD
	assert.equal(staticScore(s, { from: "a5", to: "d5" }), 900 - 500 / 10); // THE VICTIM LESS A TENTH OF THE ATTACKER
	assert.ok(!candidates(s, "b", { refused: [actionKey({ type: "passive" })] }).some((a) => a.type === "passive"));
});

test("the card score weighs what the engine can't see", () => {
	const s = newGame({ cardGuy: "w", level: 2400, seed: 1 }), after = JSON.parse(JSON.stringify(s));
	assert.equal(cardScore(s, s, "w"), 0);
	const mine = s.board.sq.find((q) => q && q.c === "w" && q.t === "p").id, theirs = s.board.sq.filter((q) => q && q.c === "b").map((q) => q.id);
	after.statuses = { [mine]: [{ s: "warded", left: 3 }, { s: "marked", left: 3 }], [theirs[0]]: [{ s: "frozen", left: 3 }], [theirs[1]]: [{ s: "shaken", left: 3 }] };
	assert.equal(cardScore(s, after, "w"), WEIGHTS.warded + WEIGHTS.markedOwn + WEIGHTS.frozenEnemy + WEIGHTS.shakenEnemy);
	assert.equal(cardScore(s, after, "b"), 0); // FROM THE OTHER SIDE NONE OF THESE HAS A WEIGHT
	const b = JSON.parse(JSON.stringify(s));
	b.players.b.curses.push({ id: "c90", key: "rust" });
	b.players.w.curses.push({ id: "c91", key: "debt" });
	b.players.w.moves.pop();
	b.players.w.moves.pop();
	b.players.w.lostTurns = 1;
	b.ply++; // THE TURN ENDED: BOTH CARDS ARE GONE FOR GOOD
	b.effects.push({ id: "c92", owner: "w", card: { id: "c92", key: "patience" }, placedAt: 0 });
	assert.equal(cardScore(s, b, "w"), WEIGHTS.curseGiven + WEIGHTS.curseHeld + 2 * WEIGHTS.cardLost + WEIGHTS.turnSkipped + WEIGHTS.passiveWaiting);
	const c = JSON.parse(JSON.stringify(s));
	c.players.w.moves.push({ id: "c93", key: "move", piece: "p" });
	c.players.w.skips = 1; // AN OLD STATE'S SKIP COUNT: NO LONGER SCORED
	assert.equal(cardScore(s, c, "w", [{ type: "passive-cancelled", player: "b" }, { type: "passive-cancelled", player: "w" }]), WEIGHTS.cardGained + WEIGHTS.enemyPassiveCancelled);
	const open = JSON.parse(JSON.stringify(s));
	open.players.w.actives.pop(); // AN ACTIVE THAT LEAVES THE TURN OPEN: ITS SLOT REFILLS WHEN THE TURN ENDS
	assert.equal(cardScore(s, open, "w"), 0);
	open.ply++;
	assert.equal(cardScore(s, open, "w"), WEIGHTS.cardLost);
	assert.deepEqual(WEIGHTS, { warded: 120, frozenEnemy: 90, shakenEnemy: 60, markedOwn: -40, curseGiven: 150, curseHeld: -150, cardLost: -35, cardGained: 35, passiveWaiting: 80, turnSkipped: -200, enemyPassiveCancelled: 80 });
});

test("bestOf asks the engine for the best of the given moves only, and throws when it can't answer", async (t) => {
	const bodies = [], real = globalThis.fetch;
	t.after(() => { globalThis.fetch = real; });
	globalThis.fetch = async (url, init) => { bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ type: "bestmove", from: "e2", to: "e4" }), { status: 200 }); };
	const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
	assert.deepEqual(await bestOf(fen, ["e2e4", "d2d4"]), { from: "e2", to: "e4", promotion: undefined });
	assert.equal(bodies[0].searchmoves, "e2e4 d2d4");
	assert.equal(bodies[0].fen, fen);
	globalThis.fetch = async () => new Response(JSON.stringify({ type: "info", text: "busy" }), { status: 503 });
	await assert.rejects(bestOf(fen, ["e2e4"]), /busy/);
});

test("the production evaluate turns an analysis into centipawns from White's side", async (t) => {
	const real = globalThis.fetch, fen = "4k3/8/8/8/8/8/8/R3K3 w - - 0 1";
	t.after(() => { globalThis.fetch = real; require("../../utils/ai.js").clearAnalyses(); });
	const answer = (body) => { require("../../utils/ai.js").clearAnalyses(); globalThis.fetch = async () => new Response(JSON.stringify({ type: "bestmove", from: "a1", to: "a8", winChance: 90, ...body }), { status: 200 }); };
	answer({ eval: 4.5 });
	assert.equal(await cardGuy.evaluate(fen), 450);
	answer({ eval: 99, mate: 3 });
	assert.equal(await cardGuy.evaluate(fen), 10000);
	answer({ eval: -99, mate: -2 });
	assert.equal(await cardGuy.evaluate(fen), -10000);
	answer({});
	await assert.rejects(cardGuy.evaluate(fen));
});

test("Card Guy plays on from a view with a Hollow Crown (King card held or lost) or a waiting Mirage, on either side", async () => {
	for (const kind of [0, 1, 2, 3]) {
		const s = newGame({ cardGuy: "b", level: 1300, seed: 20 + kind }), ctx = makeCtx(s);
		ctx.trigger = () => {};
		if (kind < 2) assert.ok(ctx.giveCurse("b", "hollow-crown", "w")); // CARD GUY HOLDS IT
		if (kind === 1) s.players.b.king = false;
		if (kind >= 2) assert.ok(ctx.giveCurse(kind === 2 ? "w" : "b", "mirage", kind === 2 ? "b" : "w"));
		const r = await play(s, 24, { seed: kind });
		assert.ok(r.refused <= 2 * r.foggy, r.refused + " refusals over " + r.foggy + " turns under a fog"); // ask FAILS ON ONE WITH NO FOG UP. WAS refused === 0 UNTIL THE RANDOM DRAW-BACK (2026-11-22) CHANGED THESE GAMES: ONE NOW PLAYS A FOG OF WAR
		assert.ok(r.actions === 24 || r.state.result);
	}
});

test("in check Card Guy never plays the entered Mirage he holds: the block goes under the real card (the game lists no Mirage move in check)", async () => {
	for (const seed of [1, 2, 3, 4, 5]) {
		const s = position("4R2k/6pp/8/8/8/8/5r2/6K1 b - - 0 1", { seed }); // BLACK'S ONLY ANSWER: Rf8
		const real = hand.newCard(s, "move", { piece: "r" });
		Object.assign(s.players.b, { moves: [real], actives: [], passive: null, curses: [{ id: "c0", key: "mirage", piece: "r" }] }); // ENTERED (NOT waiting), FIRST BY ID: A ROOK CARD TO ITS HOLDER
		assert.deepEqual(playerView(s, "b").players.b.moves.map((c) => c.key), ["move", "move"]);
		const r = await ask(s, "b", { seed });
		assert.equal(r.refused, 0);
		assert.deepEqual(r.action, { type: "move", card: real.id, from: "f2", to: "f8" });
	}
});

/**
 * @description Card Guy (Black, 1300) plays games under White's Fog of War with a hidden Tremor Frozen on a fogged pawn: 6 actions, the fog goes up, 30 more. Returns his { turns, refused, worst: the most refusals in one turn }.
 */
async function underFog(seeds) {
	let turns = 0, refused = 0, worst = 0;
	for (const seed of seeds) {
		let s = newGame({ cardGuy: "b", level: 1300, seed: 30 + seed });
		s = (await play(s, 6, { seed })).state; // A FEW MOVES FIRST, SO LINES ARE OPEN
		fogUp(s, "w");
		const pawn = s.board.sq.find((q, i) => q && q.c === "w" && q.t === "p" && i >= 32).id;
		s.statuses[pawn] = [...(s.statuses[pawn] || []), { s: "frozen", left: 3, by: "w", veiled: true }];
		assert.equal(playerView(s, "b").statuses[pawn], undefined);
		assert.ok(playerView(s, "b").board.hidden > 0);
		for (let i = 0; i < 30 && !s.result; i++) {
			const c = owes(s), r = await ask(s, c, { seed: seed * 1000 + i });
			if (c === "b") { turns++; refused += r.refused; worst = Math.max(worst, r.refused); }
			s = applyAction(s, c, r.action).state;
		}
	}
	return { turns, refused, worst };
}

test("under the player's Fog of War Card Guy still reaches a legal action, also with a hidden Tremor Frozen on a fogged pawn", async () => {
	const { turns, refused, worst } = await underFog([1, 2, 3]);
	assert.ok(turns >= 30);
	assert.ok(refused <= turns && worst <= 6, refused + " refusals in " + turns + " turns, " + worst + " in one"); // A REFUSAL IS A WHOLE TURN THOUGHT AGAIN, AND THE REAL GAME PLAYS A FALLBACK AFTER 8 (cardsController MAX_REFUSALS)
	console.log("    under the player's fog: " + turns + " Card Guy actions, " + refused + " refused first, at most " + worst + " in one turn");
});

test("refusals under the player's Fog of War correct Card Guy's guess of the fogged pieces: checked by a fogged piece, he answers the check inside the real game's limit", async () => {
	for (const [seed, most] of [[1, 8], [67, 8], [66, 6]]) { // 18 REFUSALS IN ONE TURN (A FOGGED BISHOP'S CHECK, EVERY OTHER MOVE TRIED FIRST) AND, BEFORE THE ONE-CARD-AT-A-TIME DRAWS, 12. SINCE THOSE DRAWS GAMES 1 AND 67 PASS WITHOUT THE FITTED GUESS (simulate's fit): GAME 66 PINS IT, 4 WITH IT AND 8 WITHOUT
		const { worst } = await underFog([seed]);
		assert.ok(worst <= most, "game " + seed + ": " + worst + " refusals in one turn"); // 8: cardsController MAX_REFUSALS
	}
});

test("his own veiled Frozen pawn under the player's Fog of War: one refused move of it that no fogged piece explains and he tries none of its other moves that turn", async () => {
	for (const seed of [1, 2, 3, 4, 5]) {
		let s = newGame({ cardGuy: "b", level: 1300, seed });
		s.board = fromFen("4k3/pp6/8/8/8/8/1p4P1/4K2R b - - 0 1"); // HIS b2 PAWN PROMOTES: UP TO 12 MOVES, EACH REFUSED IN TURN WITHOUT THE FIX
		fogUp(s, "w");
		const pawn = s.board.sq[engine.board.sqIndex("b2")].id;
		s.statuses[pawn] = [{ s: "frozen", left: 3, by: "w", veiled: true }];
		assert.equal(playerView(s, "b").statuses[pawn], undefined);
		let calls = 0;
		const evaluate = async (fen) => { calls++; return material(fen); };
		const pushes = [];
		for (let k = 0; k < 6 && s.board.turn === "b" && !s.result; k++) { // THE WHOLE TURN: HIS FREE DISCARDS, THEN THE MOVE
			const refused = [];
			let action;
			while (!isLegal(s, "b", (action = await cardGuyTurn(playerView(s, "b"), s.level, opts({ seed, evaluate, refused, legal: engine.playerLegal(s, "b") }))))) {
				assert.ok(refused.length < 12, "12 refusals in one think");
				refused.push(actionKey(action));
				if (action.from === "b2" && action.to[0] === "b") { pushes.push(action.to + (action.promotion || "")); }
			}
			s = applyAction(s, "b", action).state;
		}
		assert.ok(pushes.length <= 1, `seed ${seed}: the veiled pawn's pushes refused ${pushes.join(", ")}`); // A CAPTURE OF A GUESSED PIECE IS THE FOG'S, NOT COUNTED
		assert.ok(calls <= 21, `seed ${seed}: ${calls} evaluations in the turn`); // MEASURED 2026-11-23: 28, 8, 28, 35, 35 WITHOUT THE FIX (3-4 PUSHES REFUSED), 14, 8, 21, 14, 15 WITH IT
	}
});

test("All or Nothing is scored by its expected value, not played out", async () => {
	for (const [key, value] of [["all-or-nothing", 0.5 * 225 - 0.5 * (6 * 35 + 100)], ["all-or-nothing-epic", 0.5 * 225 - 0.5 * 100], ["all-or-nothing-legendary", 0.5 * 225 - 0.5 * 6 * 35]]) {
		const s = newGame({ cardGuy: "w", level: 2400, seed: 2 });
		s.players.w.actives = [hand.newCard(s, key)];
		const pawn = s.board.sq.find((q) => q && q.c === "w" && q.t === "p").id, rook = s.board.sq.find((q) => q && q.c === "w" && q.t === "r").id;
		const scored = await scoreTurn(playerView(s, "w"), opts({ evaluate: async () => 40 }));
		const on = (piece) => scored.find((c) => c.action.type === "active" && c.action.target.piece === piece);
		assert.equal(on(pawn).total, 40 + value); // THE BOARD AS IT STANDS + THE GAMBLE
		assert.ok(on(pawn).favourite && on(rook).favourite);
		assert.equal(on(rook).total < on(pawn).total, key !== "all-or-nothing-legendary"); // A ROOK RISKS MORE FOR ITS QUEEN, UNLESS THE PIECE ISN'T AT STAKE
	}
});

test("a first move of a two-move turn that leaves the king for another piece to take is worth the game", async () => {
	let s = position("4k3/5N2/8/7Q/8/8/8/4K3 w - - 0 1"); // THE KNIGHT STEPS OFF THE QUEEN'S LINE TO e8
	Object.assign(s.players.w, { moves: [hand.newCard(s, "move", { piece: "m" }), hand.newCard(s, "move", { piece: "q" })], actives: [hand.newCard(s, "double-time-legendary")], passive: null });
	s.players.b.kingSkulls = 0; // NO SKULL ENDS THE TWO-MOVE TURN ON THE CHECK: THE SECOND MOVE TAKES THE KING
	s = applyAction(s, "w", { type: "active", card: s.players.w.actives[0].id }).state;
	const quiet = async () => ({ from: "h5", to: "h4" }), o = opts({ evaluate: async () => 0, bestOf: quiet });
	const a = await cardGuyTurn(playerView(s, "w"), 2400, o);
	assert.equal(a.from, "f7");
	s = applyAction(s, "w", a).state;
	assert.equal(s.board.turn, "w");
	assert.equal(applyAction(s, "w", await cardGuyTurn(playerView(s, "w"), 2400, o)).state.result.reason, "king");
	let lone = position("4k3/8/8/8/8/8/8/R3K3 w - - 0 1"); // THE ROOK'S CHECK ON a8 WINS NOTHING: THE SECOND MOVE IS THE KING'S
	Object.assign(lone.players.w, { moves: [hand.newCard(lone, "move", { piece: "r" })], actives: [hand.newCard(lone, "double-time-legendary")], passive: null });
	lone.players.b.kingSkulls = 0;
	lone = applyAction(lone, "w", { type: "active", card: lone.players.w.actives[0].id }).state;
	const scored = await scoreTurn(playerView(lone, "w"), opts({ evaluate: async () => 30 }));
	assert.equal(scored.find((c) => c.action.to === "a8").total, 30);
});

test("when the real game refused every action of its guesses Card Guy plays on the board it can see; with nothing hidden it has none left", async (t) => {
	const logged = t.mock.method(console, "log", () => {});
	const s = position("3r3k/8/8/8/8/8/PPPPPPPP/RNBQKBNR b - - 0 1", { level: 1300 });
	Object.assign(s.players.b, { moves: [hand.newCard(s, "move", { piece: "r" })], actives: [], passive: null });
	const guessed = (view) => [7, 16, 25].flatMap((seed) => legalActions(engine.fromView(view, seed), "b").map(actionKey)); // THE THREE GUESSES OF SEED 7 (index.js simulate)
	await assert.rejects(cardGuyTurn(playerView(s, "b"), 1300, opts({ refused: guessed(playerView(s, "b")) })), /no action/);
	await assert.rejects(cardGuyTurn(playerView(s, "w"), 1300, opts()), /no action/); // NOT ITS TURN
	const over = position("3r3k/8/8/8/8/8/PPPPPPPP/RNBQKBNR b - - 0 1", { level: 1300 });
	over.result = { winner: "w", reason: "resign" };
	await assert.rejects(cardGuyTurn(playerView(over, "b"), 1300, opts()), /no action/); // THE GAME IS OVER: THE CALLER CATCHES IT
	fogUp(s, "w");
	const view = playerView(s, "b"), refused = guessed(view);
	assert.equal(view.board.hidden, 16);
	const a = await cardGuyTurn(view, 1300, opts({ refused, evaluate: down, bestOf: down })); // THE ENGINE ISN'T ASKED ABOUT A BOARD WITH NO WHITE KING
	assert.ok(!refused.includes(actionKey(a)) && a.from === "d8" && ["d2", "d1"].includes(a.to), JSON.stringify(a)); // EVERY GUESS HAD A PIECE IN THE WAY
	assert.equal(logged.mock.callCount(), 0); // NOT ASKED, SO NO ENGINE ALARM
});

test("with no fog up Card Guy's own Peasant Immunity or Phalanx never leads it to an illegal action", async () => {
	const s = position("1k6/8/5p2/3p4/3PK3/8/8/2R5 w - - 0 1"); // d5 CHECKS e4 AND IS STOPPED; f6 ATTACKS e5 FOR REAL
	place(s, "peasant-immunity", "w", { stopping: [s.board.sq[engine.board.sqIndex("d5")].id] });
	assert.ok(!legalActions(s, "w").some((a) => a.to === "e5"));
	const still = toFen(s), stay = async (fen) => (fen === still ? 900 : 0); // AN ENGINE THAT LIKES THE BOARD AS IT STANDS: e4-e5 LEAVES NO CHESS POSITION, SO IT WOULD SCORE AS THAT BOARD
	const r = await ask(s, "w", { evaluate: stay, bestOf: async () => ({ from: "e4", to: "e5" }) });
	assert.equal(r.refused, 0);
	assert.notEqual(r.action.to, "e5");
	for (const [key, owner] of [["phalanx", "w"], ["phalanx", "b"], ["peasant-immunity", "w"], ["peasant-immunity", "b"]]) {
		const g = newGame({ cardGuy: "b", level: 1300, seed: 41 });
		place(g, key, owner);
		assert.equal((await play(g, 16, { seed: 41 })).refused, 0);
	}
	let g = position("4k3/8/8/2p5/1PPP4/8/8/4K2N w - - 0 1"), denied = 0; // c5 COULD TAKE b4 OR d4 BUT FOR WHITE'S PHALANX. WHITE HOLDS NO PAWN CARD, SO c5 STAYS
	Object.assign(g.players.w, { moves: [hand.newCard(g, "move", { piece: "m" })], actives: [], passive: null });
	place(g, "phalanx", "w");
	for (let n = 0; n < 6 && !g.result; n++) {
		const c = owes(g), r = await ask(g, c, { seed: 50 + n });
		assert.equal(r.refused, 0);
		g = applyAction(g, c, r.action).state;
		const waiting = g.effects.find((e) => e.card.key === "phalanx");
		if (waiting && waiting.card.denied) { denied++; assert.equal(playerView(g, "w").effects.find((e) => e.card.key === "phalanx").card.denied, true); }
	}
	assert.ok(denied > 0, "Phalanx never denied a capture here"); // THE LOOP DID PLAY WITH denied SET
});

test("the engine is only asked about chess positions: no en passant square for the wrong side, no king left to take, and no engine alarm for a board it isn't asked about", async (t) => {
	const logged = t.mock.method(console, "log", () => {}), sent = [];
	const o = opts({ evaluate: async (fen) => { sent.push(fen); return material(fen); }, bestOf: async (fen, lans) => { sent.push(fen); return firstOf(fen, lans); } });
	let s = position("rnbqkbnr/ppp1pppp/8/8/3p4/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"); // d4 COULD TAKE e3 IN PASSING
	Object.assign(s.players.w, { moves: [hand.newCard(s, "move", { piece: "p" }), hand.newCard(s, "move", { piece: "m" })], actives: [hand.newCard(s, "double-time-legendary")] });
	s = applyAction(s, "w", { type: "active", card: s.players.w.actives[0].id }).state;
	s = applyAction(s, "w", legalActions(s, "w").find((a) => a.from === "e2" && a.to === "e4")).state; // WHITE MOVES AGAIN, THE STATE'S EN PASSANT SQUARE IS e3
	assert.match(toFen(s), / w KQkq e3 /);
	assert.ok(isLegal(s, "w", await cardGuyTurn(playerView(s, "w"), 2400, o)));
	assert.ok(sent.length > 3 && sent.every((fen) => fen.split(" ")[3] !== "e3"));
	assert.equal(sent.filter((fen) => fen === toFen(s).replace(" e3 ", " - ")).length, 2); // THE BOARD NOW IS STILL ASKED ABOUT (bestOf & evaluate), WITHOUT THE SQUARE
	const p = position("1k6/8/5p2/3p4/3PK3/8/8/2R5 w - - 0 1"); // WHITE'S KING STANDS IN A PAWN'S CHECK ITS PEASANT IMMUNITY STOPS: AFTER A ROOK MOVE THAT IS NO CHESS POSITION
	Object.assign(p.players.w, { moves: [hand.newCard(p, "move", { piece: "r" })], actives: [], passive: null });
	place(p, "peasant-immunity", "w", { stopping: [p.board.sq[engine.board.sqIndex("d5")].id] });
	const scored = await scoreTurn(playerView(p, "w"), o);
	assert.ok(scored.some((c) => c.action.from === "c1") && scored.every((c) => Number.isFinite(c.total)));
	assert.deepEqual(sent.map(notChess).filter(Boolean), []);
	assert.equal(logged.mock.callCount(), 0);
});

test("when the board as it stands is no chess position (or one chess.js refuses) the engine isn't asked: every board scores 0 that turn, the card scores decide, no engine alarm", async (t) => {
	const logged = t.mock.method(console, "log", () => {}), sent = [];
	const o = opts({ evaluate: async (fen) => { sent.push(fen); return material(fen); }, bestOf: async (fen, lans) => { sent.push(fen); return firstOf(fen, lans); } });
	const s = position("8/4k3/3P4/8/8/8/7P/3QK3 w - - 0 1"); // A QUEEN UP. THE VISITOR'S PEASANT IMMUNITY STOPS d6'S CHECK, WHICH CARD GUY'S VIEW DOESN'T SAY: ITS GUESS HAS THE KING IN CHECK WITH WHITE TO MOVE
	Object.assign(s.players.w, { moves: [hand.newCard(s, "move", { piece: "p" }), hand.newCard(s, "move", { piece: "q" })], actives: [hand.newCard(s, "all-or-nothing-epic"), hand.newCard(s, "double-time-legendary")], passive: null });
	place(s, "peasant-immunity", "b", { stopping: [s.board.sq[engine.board.sqIndex("d6")].id] });
	const scored = await scoreTurn(playerView(s, "w"), o), cards = scored.filter((c) => c.favourite), moves = scored.filter((c) => c.plain);
	assert.ok(cards.length === 3 && moves.length > 3);
	assert.deepEqual(cards.map((c) => c.total).sort(), [0, 62.5, 62.5]); // BOTH DUELS AND DOUBLE TIME
	assert.ok(moves.every((c) => Math.abs(c.total) < 300), "a move scored " + Math.max(...moves.map((c) => c.total)) + " against the cards' 0"); // NOT THE QUEEN'S 1240 BESIDE CARDS SCORED AGAINST NOTHING
	const win = position("8/4k3/3P4/8/8/8/7P/3QK3 w - - 0 1"); // THE SAME BOARD WITH NO PASSIVE: THE PAWN TAKES THE KING
	Object.assign(win.players.w, { moves: [hand.newCard(win, "move", { piece: "p" })], actives: [], passive: null });
	const taking = (await scoreTurn(playerView(win, "w"), o)).find((c) => c.action.to === "e7");
	assert.ok(taking && taking.total > 90000, "a won game lost its score"); // DECIDED GAMES KEEP THEIRS
	const edge = position("4k3/8/8/8/8/8/8/P3K2R w - - 0 1"); // A PAWN ON ITS FIRST RANK: chess.js REFUSES THE BOARD
	assert.match(notChess(toFen(edge)), /edge rows/);
	Object.assign(edge.players.w, { moves: [hand.newCard(edge, "move", { piece: "r" }), hand.newCard(edge, "move", { piece: "p" })], actives: [], passive: null });
	const a = await cardGuyTurn(playerView(edge, "w"), 2400, o);
	assert.ok(isLegal(edge, "w", a));
	assert.deepEqual(sent, []); // NEITHER evaluate NOR bestOf, ON ANY OF THE THREE TURNS
	assert.equal(logged.mock.callCount(), 0);
});

test("a fogged epic Swap (115 candidates) is answered within 3 s on an instant engine, with no 200 ms stretch that answers nothing else", async (t) => {
	const view = playerView(FOGGED_SWAP, "w"), fens = new Set();
	assert.ok(legalActions(engine.fromView(view, 306675), "w").length > 100);
	const tried = t.mock.method(engine, "applyAction");
	let stall = 0, last = Date.now();
	const tick = setInterval(() => { stall = Math.max(stall, Date.now() - last - 10); last = Date.now(); }, 10);
	const started = Date.now();
	const a = await cardGuyTurn(view, 1300, opts({ seed: 306675, evaluate: async (fen) => { fens.add(fen); return 0; } }));
	const took = Date.now() - started;
	stall = Math.max(stall, Date.now() - last - 10); // A TURN THAT NEVER LET THE TIMER RUN
	clearInterval(tick);
	assert.ok(a && a.type);
	assert.ok(took < 3000, "took " + took + " ms"); // THE PLAN'S LIMIT (0.7 s HERE, 1.9 s WITH EVERY CORE BUSY): THE TWO ASSERTS BELOW HOLD THE FIX
	assert.ok(stall < 200, "the event loop stood still for " + stall + " ms");
	assert.ok(tried.mock.callCount() < 250, tried.mock.callCount() + " actions tried"); // ONE PER CANDIDATE, 8 ONLY FOR THE FEW THE ENGINE IS ASKED ABOUT (IT WAS 875)
	assert.ok(fens.size <= MAX_EVALS && fens.size > 6, fens.size + " boards evaluated");
});

test("when one evaluation fails, or isn't a number, every board scores 0 that turn and the card scores decide; one log line", async (t) => {
	const logged = t.mock.method(console, "log", () => {});
	const s = position("4k3/8/8/r2Q4/8/8/8/4K3 b - - 0 1");
	Object.assign(s.players.b, { moves: [hand.newCard(s, "move", { piece: "r" }), hand.newCard(s, "move", { piece: "r" })], actives: [], passive: hand.newCard(s, "patience") });
	const view = playerView(s, "b"), cards = (await scoreTurn(view, opts({ evaluate: down }))).map((c) => c.total); // NO BOARD ANSWERED: THE CARD SCORES ALONE
	const marks = (to) => { const c = cards.length && whole.find((x) => x.action.to === to); return [c.plain, c.standsOut]; }, whole = await scoreTurn(view, opts());
	assert.deepEqual([marks("d5"), marks("a1"), marks("a8")], [[true, true], [true, true], [true, false]]); // A CAPTURE & A CHECK STAND OUT, A QUIET MOVE DOESN'T
	assert.ok(!whole.some((c) => c.action.type === "discard" || "discard" in c)); // THE FREE DISCARD IS NEVER SCORED
	logged.mock.resetCalls();
	for (const broken of [down, async () => NaN, async () => undefined, async () => "12"]) {
		let calls = 0;
		logged.mock.resetCalls();
		const scored = await scoreTurn(view, opts({ evaluate: async (fen) => (++calls > 3 ? broken() : material(fen)) })); // THE FIRST THREE BOARDS ARE ANSWERED
		assert.ok(calls > 3);
		assert.deepEqual(scored.map((c) => c.total), cards); // NOT THE THREE ANSWERS AGAINST 0 FOR THE REST
		assert.equal(new Set(scored.filter((c) => c.plain).map((c) => c.total)).size, 1); // THE FREE QUEEN AND A QUIET MOVE SCORE ALIKE: EVERY BOARD IS 0
		assert.equal(scored.find((c) => c.action.type === "passive").total - scored[0].total, WEIGHTS.passiveWaiting + WEIGHTS.cardLost);
		assert.equal(logged.mock.callCount(), 1);
		assert.ok(String(logged.mock.calls[0].arguments[0]).startsWith("STOCKFISH FAILED, js-chess-engine PLAYS INSTEAD: "));
	}
	logged.mock.resetCalls();
	await scoreTurn(view, opts({ evaluate: down, bestOf: down }));
	assert.equal(logged.mock.callCount(), 1); // bestOf AND EVERY BOARD FAILED: STILL ONE LINE A TURN
});

test("a seed that isn't a finite number is refused, and a turn makes each guess once", async (t) => {
	const s = newGame({ cardGuy: "w", level: 2400, seed: 3 }), view = playerView(s, "w");
	for (const seed of [undefined, null, NaN, Infinity, "7", "ab".repeat(32)]) {
		await assert.rejects(cardGuyTurn(view, 2400, opts({ seed })), /seed/);
		await assert.rejects(scoreTurn(view, opts({ seed })), /seed/);
	}
	s.players.w.actives = [hand.newCard(s, "mulligan")]; // MOVES AND A CARD: ONE GUESS, AND A SECOND TO TELL A CHANCE OUTCOME
	s.discarded = "w"; // THE FREE DISCARD USED: THE SEARCH DECIDES
	const spy = t.mock.method(engine, "fromView");
	await cardGuyTurn(playerView(s, "w"), 2400, opts());
	assert.deepEqual(spy.mock.calls.map((c) => c.arguments[1]), [7, 8]);
});
