/*
 *  framework-registry.test.js  --  chess cards engine tests
 *	The card framework (cards-engine/cards/index.js, hand.js, ctx.js): rarity draws, curses given, new cards, and the registry against the catalog
 *
 */

const path = require("node:path");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { legalActions, applyAction } = require("../../../../cards-engine/index.js");
const { makeCtx } = require("../../../../cards-engine/ctx.js");
const hand = require("../../../../cards-engine/hand.js");
const { reset, RARITY_WEIGHTS } = require("../../../../cards-engine/cards/index.js");
const { other, fresh, placed, passive, curse, active, ofType } = require("../../helpers/framework.js");

test("active and passive draws follow rarity, never a held, waiting or used card", () => {
	reset();
	const tiers = Object.keys(RARITY_WEIGHTS), total = tiers.reduce((sum, r) => sum + RARITY_WEIGHTS[r], 0);
	assert.deepEqual(RARITY_WEIGHTS, { common: 12, uncommon: 6, rare: 3, epic: 2, legendary: 1 });
	for (const r of tiers) active("t-" + r, () => {}, { rarity: r });
	passive("t-p1");
	passive("t-p2");
	const s = fresh(), ctx = makeCtx(s), p = s.players.w, n = 10000, count = {};
	for (let i = 0; i < n; i++) {
		p.actives = [];
		const c = hand.drawCard(ctx, "w", "active");
		count[c.key] = (count[c.key] || 0) + 1;
	}
	for (const r of tiers) assert.ok(Math.abs(count["t-" + r] / n - RARITY_WEIGHTS[r] / total) < 0.03, r + " " + count["t-" + r] / n);
	p.actives = [{ id: "c90", key: "t-common" }];
	for (let i = 0; i < 300; i++) { p.actives.length = 1; assert.notEqual(hand.drawCard(ctx, "w", "active").key, "t-common"); }
	p.actives = tiers.map((r, i) => ({ id: "c9" + i, key: "t-" + r }));
	assert.equal(hand.drawCard(ctx, "w", "active"), null);
	p.used = ["t-p1"]; // A USED KEY (FIRING PUTS IT THERE: "a fired passive leaves Board Effects") IS NEVER DRAWN
	for (let i = 0; i < 300; i++) { p.passive = null; assert.equal(hand.drawCard(ctx, "w", "passive").key, "t-p2"); }
	s.effects = [placed("c93", "t-p2", "w", 1)]; // NOR IS ONE WAITING IN BOARD EFFECTS
	p.passive = null;
	assert.equal(hand.drawCard(ctx, "w", "passive"), null);
});

test("ctx.giveCurse: at most 2 held, the giver waits 5 of its own turns, with a curse-given event", () => {
	reset();
	active("t-hex", (ctx, player) => ctx.giveCurse(other(player), "t-c", player));
	curse("t-c");
	curse("t-m", { make: (ctx, to) => ({ piece: to === "b" ? "n" : "p" }) }); // A CURSE'S OWN FIELDS COME FROM ITS make
	const s = fresh(), ctx = makeCtx(s);
	const c1 = ctx.giveCurse("b", "t-c", "w");
	assert.ok(/^c\d+$/.test(c1.id) && c1.key === "t-c");
	assert.deepEqual(ofType(ctx.events, "curse-given"), [{ type: "curse-given", player: "w", card: c1 }]);
	assert.equal(s.players.w.curseWait, 6); // GIVEN ON WHITE'S OWN TURN (ctx.turn "w"), BEFORE ITS TICK: 6, SO 5 OWN TURNS AFTER IT ARE BLOCKED
	assert.equal(ctx.giveCurse("b", "t-c", "w"), false); // THE GIVER WAITS
	s.players.w.curseWait = 0;
	ctx.giveCurse("b", "t-m", "w");
	assert.equal(s.players.b.curses[1].piece, "n");
	s.players.w.curseWait = 0;
	assert.equal(ctx.giveCurse("b", "t-c", "w"), false); // BLACK ALREADY HOLDS 2
	assert.equal(s.players.b.curses.length, 2);
	// THE WAIT COUNTS DOWN AT THE END OF EACH OF THE GIVER'S OWN TURNS
	let g = fresh();
	g.players.w.actives = [{ id: "c80", key: "t-hex" }];
	g = applyAction(g, "w", { type: "active", card: "c80" }).state;
	const waits = [g.players.w.curseWait]; // AT THE START OF EACH OF WHITE'S NEXT TURNS (THE GIVING TURN DOESN'T COUNT)
	for (let i = 0; i < 5; i++) {
		g = applyAction(g, "b", legalActions(g, "b").find((a) => a.type === "move")).state;
		g = applyAction(g, "w", legalActions(g, "w").find((a) => a.type === "move")).state;
		waits.push(g.players.w.curseWait);
	}
	assert.deepEqual(waits, [5, 4, 3, 2, 1, 0]); // 5 OWN TURNS BLOCKED, THE 6TH MAY GIVE
	// GIVEN ON THE OPPONENT'S TURN (BLACK'S PASSIVE FIRES ON WHITE'S MOVE): ALSO 5 OF BLACK'S OWN TURNS
	passive("t-omen", { on: { move: (ctx, owner, ev) => ev.player !== owner && !!ctx.giveCurse(ev.player, "t-c", owner) } });
	let o = fresh();
	o.effects = [placed("c91", "t-omen", "b", 0)];
	o = applyAction(o, "w", legalActions(o, "w").find((a) => a.type === "move")).state;
	const bw = [o.players.b.curseWait];
	for (let i = 0; i < 5; i++) {
		o = applyAction(o, "b", legalActions(o, "b").find((a) => a.type === "move")).state;
		o = applyAction(o, "w", legalActions(o, "w").find((a) => a.type === "move")).state;
		bw.push(o.players.b.curseWait);
	}
	assert.deepEqual(bw, [5, 4, 3, 2, 1, 0]);
});

test("hand.newCard makes every new card: id c<nextId>", () => {
	const s = fresh(), n = s.nextId;
	assert.deepEqual(hand.newCard(s, "x", { piece: "q" }), { id: "c" + n, key: "x", piece: "q" });
	assert.equal(s.nextId, n + 1);
});

/**
 * @description Run fn with a fresh copy of the engine (every cards-engine module loaded again through the public entry, so every card registers into a fresh registry), then put the modules the tests above use back.
 */
function freshEngine(fn) {
	const dir = path.resolve(__dirname, "../../../../cards-engine"), saved = {};
	for (const k of Object.keys(require.cache)) if (k.startsWith(dir + path.sep)) { saved[k] = require.cache[k]; delete require.cache[k]; }
	try {
		return fn(require("../../../../cards-engine/index.js"), require("../../../../cards-engine/cards/index.js"));
	} finally {
		for (const k of Object.keys(require.cache)) if (k.startsWith(dir + path.sep)) delete require.cache[k];
		Object.assign(require.cache, saved);
	}
}

// THE CATALOG (docs: chess-cards-catalog.md): EVERY CARD'S KIND AND RARITY, AND EVERY VERSION KEY'S RARITY
const CATALOG = {
	active: { "all-or-nothing": "rare", cleanse: "common", conscription: "legendary", "double-time": "rare", "fog-of-war": "uncommon", foresight: "common", "heavy-cavalry": "epic",
		"heretical-subjection": "rare", hexcraft: "uncommon", "insidious-nullification": "rare", "last-stand": "uncommon", mulligan: "uncommon", "opposing-finality": "rare",
		pickpocket: "common", stronghold: "rare", swap: "rare", trapdoor: "uncommon" },
	passive: { "interdicted-foresight": "common", "peasant-immunity": "common", "unjust-retribution": "rare", "last-rites": "uncommon", "escape-artist": "uncommon", veto: "rare",
		reinforcements: "uncommon", retaliation: "uncommon", "bleeding-hand": "uncommon", hex: "uncommon", spite: "common", underdog: "rare", grace: "legendary", patience: "common",
		echo: "epic", witness: "common", "four-of-a-kind": "uncommon", bounty: "common", "pawn-storm": "common", phalanx: "uncommon", overwatch: "legendary", "unbroken-line": "uncommon",
		"bad-omen": "rare" },
	curse: { "dead-weight": "uncommon", "traitors-mark": "common", rust: "uncommon", tremor: "common", debt: "uncommon", shackles: "common", mirage: "uncommon", leech: "rare",
		"hollow-crown": "epic", hunger: "rare", pact: "uncommon" },
	versions: { "double-time-legendary": "legendary", "all-or-nothing-epic": "epic", "all-or-nothing-legendary": "legendary", "hexcraft-legendary": "legendary", "fog-of-war-rare": "rare",
		"fog-of-war-epic": "epic", "pickpocket-uncommon": "uncommon", "pickpocket-epic": "epic", "foresight-rare": "rare", "foresight-epic": "epic",
		"cleanse-rare": "rare", "swap-epic": "epic", "stronghold-common": "common", "interdicted-foresight-rare": "rare", "bad-omen-epic": "epic" },
};
test("the registry holds 17 actives, 23 passives and 11 curses, each with key, kind, name, text and (actives, passives) rarity", () => {
	freshEngine((engine, { CARDS, ACTIVE_KEYS, PASSIVE_KEYS, CURSE_KEYS }) => {
		const base = (keys) => keys.filter((k) => !CARDS[k].base); // VERSIONS ARE ENTRIES OF THEIR OWN
		assert.equal(base(ACTIVE_KEYS).length, 17); assert.equal(base(PASSIVE_KEYS).length, 23); assert.equal(base(CURSE_KEYS).length, 11);
		for (const k of [...ACTIVE_KEYS, ...PASSIVE_KEYS, ...CURSE_KEYS]) for (const f of ["key", "kind", "name", "text"]) assert.ok(CARDS[k][f], k + " " + f);
		for (const k of [...ACTIVE_KEYS, ...PASSIVE_KEYS]) assert.ok(k in CARDS && CARDS[k].rarity in RARITY_WEIGHTS, k);
		assert.deepEqual(base(PASSIVE_KEYS).filter((k) => CARDS[k].oncePerGame).sort(), ["grace", "unbroken-line"]);
	});
});

test("through the public entry every catalog card and version is registered with the catalog's kind and rarity; the loader lists every card file, in sorted order", () => {
	const fs = require("node:fs"), dir = path.resolve(__dirname, "../../../../cards-engine/cards");
	freshEngine((engine, { CARDS, ACTIVE_KEYS, PASSIVE_KEYS, CURSE_KEYS }) => {
		for (const kind of ["active", "passive", "curse"]) { // FIRST, BEFORE THIS TEST REQUIRES cards/all.js ITSELF: THE PUBLIC ENTRY ALONE REGISTERED THEM
			for (const [key, rarity] of Object.entries(CATALOG[kind])) {
				assert.deepEqual([CARDS[key] && CARDS[key].kind, CARDS[key] && CARDS[key].rarity], [kind, rarity], key);
			}
		}
		for (const [key, rarity] of Object.entries(CATALOG.versions)) assert.deepEqual([CARDS[key] && CARDS[key].rarity, CARDS[key] && CARDS[key].base], [rarity, key.slice(0, key.lastIndexOf("-"))], key);
		const { FILES } = require("../../../../cards-engine/cards/all.js");
		for (const kind of ["active", "passive", "curse"]) assert.deepEqual(FILES[kind], fs.readdirSync(path.join(dir, kind)).map((f) => f.replace(/\.js$/, "")).sort(), kind + ": every file, sorted");
		const all = [...ACTIVE_KEYS, ...PASSIVE_KEYS, ...CURSE_KEYS];
		assert.deepEqual(all.filter((k) => !(k in CATALOG.versions) && !(k in CATALOG[CARDS[k].kind])), []); // NOTHING OUTSIDE THE CATALOG
		assert.deepEqual([base(ACTIVE_KEYS), base(PASSIVE_KEYS), base(CURSE_KEYS)], [FILES.active, FILES.passive, FILES.curse]); // REGISTERED IN FILE ORDER, EACH VERSION RIGHT AFTER ITS CARD
		for (const list of [ACTIVE_KEYS, PASSIVE_KEYS]) list.forEach((k, i) => { if (CARDS[k].base) assert.ok(CARDS[list[i - 1]].base === CARDS[k].base || list[i - 1] === CARDS[k].base, k); });
		const lists = JSON.stringify([ACTIVE_KEYS, PASSIVE_KEYS, CURSE_KEYS]), cards = Object.keys(CARDS).length;
		const { register: again } = require("../../../../cards-engine/cards/index.js");
		for (const k of all.filter((x) => !CARDS[x].base)) again(require(path.join(dir, CARDS[k].kind, k + ".js")));
		assert.equal(JSON.stringify([ACTIVE_KEYS, PASSIVE_KEYS, CURSE_KEYS]), lists); // A SECOND REGISTRATION IS HARMLESS: SAME KEYS, SAME ORDER
		assert.equal(Object.keys(CARDS).length, cards);
		function base(keys) { return keys.filter((k) => !CARDS[k].base); }
	});
});

test("a seeded game played through the public entry draws and plays cards without throwing, and replays identically", () => {
	freshEngine((engine) => {
		const seen = new Set(), played = new Set(), runs = [];
		for (let seed = 1; seed <= 4; seed++) for (let run = 0; run < 2; run++) { // EACH SEED TWICE: SAME SEED, SAME CHOICES → THE SAME STATES AND EVENTS
			let s = engine.newGame({ cardGuy: "b", level: 1300, seed }), pick = seed, log = "";
			const roll = (n) => { pick = (pick * 1103515245 + 12345) % 2147483648; return pick % n; }; // THE TEST'S OWN CHOICES, SEEDED
			for (let i = 0; i < 160 && !s.result; i++) {
				const color = ["w", "b"].find((c) => engine.legalActions(s, c).length);
				assert.ok(color, "seed " + seed + ": nobody can act and the game isn't over");
				const acts = engine.legalActions(s, color), cards = acts.filter((a) => a.type !== "move" && a.type !== "discard");
				const a = cards.length && roll(2) ? cards[roll(cards.length)] : acts[roll(acts.length)];
				const r = engine.applyAction(s, color, a);
				for (const e of r.events) { seen.add(e.type); if (e.type === "card-played") played.add(e.card.key); }
				for (const c of ["w", "b"]) { engine.playerView(r.state, c); engine.playerEvents(r.state, r.events, c); }
				s = JSON.parse(JSON.stringify(r.state));
				log += JSON.stringify(r.state) + JSON.stringify(r.events);
			}
			if (run) assert.equal(log, runs[runs.length - 1], "seed " + seed + " replays differently");
			runs.push(log);
		}
		for (const t of ["draw", "card-played", "passive-placed"]) assert.ok(seen.has(t), t);
		assert.ok(played.size >= 3, [...played].join()); // REAL CARDS FROM THE LOADED REGISTRY, NOT ONE TEST CARD
	});
});
