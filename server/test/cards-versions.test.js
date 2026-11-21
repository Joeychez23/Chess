/*
 *  cards-versions.test.js  --  chess cards engine tests
 *	Card versions (cards-engine/cards/index.js, hand.js): each version is its own registry entry, baseKey names its card, and the no-doubles draw rule treats every version of a card as one card.
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { newGame, applyAction, legalActions, playerView, playerEvents } = require("../../cards-engine/index.js");
const { fromFen } = require("../../cards-engine/board.js");
const { makeCtx } = require("../../cards-engine/ctx.js");
const hand = require("../../cards-engine/hand.js");
const { CARDS, ACTIVE_KEYS, PASSIVE_KEYS, RARITY_WEIGHTS, register, reset, baseKey } = require("../../cards-engine/cards/index.js");

const TIERS = Object.keys(RARITY_WEIGHTS);
const play = () => {};

/**
 * @description An empty registry holding t-card (common active) with a version at each other tier, t-other (common active), t-pv (common passive) with a rare version, and t-pz (common passive).
 */
function setup() {
	reset();
	register({ key: "t-card", kind: "active", name: "Test Card", rarity: "common", skulls: 1, text: "base", targets: () => [null], play,
		versions: TIERS.slice(1).map((rarity) => ({ rarity, text: "v-" + rarity, skulls: 2 })) });
	register({ key: "t-other", kind: "active", name: "t-other", rarity: "common", skulls: 0, text: "", targets: () => [null], play });
	register({ key: "t-pv", kind: "passive", name: "t-pv", rarity: "common", skulls: 0, text: "", versions: [{ rarity: "rare", text: "pv-rare" }] });
	register({ key: "t-pz", kind: "passive", name: "t-pz", rarity: "common", skulls: 0, text: "" });
}

test("the registry lists each version under its own key, with the base's name and its own rarity, text and skulls", () => {
	setup();
	assert.deepEqual(ACTIVE_KEYS, ["t-card", "t-card-uncommon", "t-card-rare", "t-card-epic", "t-card-legendary", "t-other"]);
	assert.deepEqual(PASSIVE_KEYS, ["t-pv", "t-pv-rare", "t-pz"]);
	const v = CARDS["t-card-epic"];
	assert.deepEqual([v.key, v.base, v.name, v.kind, v.rarity, v.text, v.skulls], ["t-card-epic", "t-card", "Test Card", "active", "epic", "v-epic", 2]);
	assert.equal(v.play, play);
	assert.ok(!("versions" in v));
	assert.equal(CARDS["t-pv-rare"].skulls, 0); // NOT GIVEN: THE BASE'S
	register(CARDS["t-card"]); // RE-REGISTERING REPLACES, NEVER LISTS TWICE
	assert.equal(ACTIVE_KEYS.length, 6);
});

test("baseKey: a version's base, else the key itself (an unknown key too)", () => {
	setup();
	assert.equal(baseKey("t-card-legendary"), "t-card");
	assert.equal(baseKey("t-pv-rare"), "t-pv");
	assert.equal(baseKey("t-card"), "t-card");
	assert.equal(baseKey("nope"), "nope");
});

test("drawCard never gives a second version of a held, waiting or used card", () => {
	setup();
	const s = newGame({ cardGuy: "b", level: 1300, seed: 3 }), ctx = makeCtx(s), p = s.players.w;
	for (const held of ["t-card", "t-card-rare"]) {
		p.actives = [{ id: "c900", key: held }];
		for (let i = 0; i < 200; i++) { p.actives.length = 1; assert.equal(hand.drawCard(ctx, "w", "active").key, "t-other"); }
	}
	p.actives = [];
	s.effects = [{ id: "c901", owner: "w", card: { id: "c901", key: "t-pv-rare" }, placedAt: 0 }];
	for (let i = 0; i < 200; i++) { p.passive = null; assert.equal(hand.drawCard(ctx, "w", "passive").key, "t-pz"); }
	s.effects = [];
	p.used = ["t-pv-rare"];
	for (let i = 0; i < 200; i++) { p.passive = null; assert.equal(hand.drawCard(ctx, "w", "passive").key, "t-pz"); }
	p.used = [];
	s.effects = [{ id: "c902", owner: "b", card: { id: "c902", key: "t-pv" }, placedAt: 0 }]; // THE OPPONENT'S WAITING CARD DOESN'T COUNT
	const got = new Set();
	for (let i = 0; i < 300; i++) { p.passive = null; got.add(hand.drawCard(ctx, "w", "passive").key); }
	assert.deepEqual([...got].sort(), ["t-pv", "t-pv-rare", "t-pz"]);
});

test("draw shares follow the five weights, versions drawn at their own rarity", () => {
	reset();
	register({ key: "t-card", kind: "active", name: "Test Card", rarity: "common", text: "", targets: () => [null], play,
		versions: TIERS.slice(1).map((rarity) => ({ rarity, text: "" })) });
	const s = newGame({ cardGuy: "b", level: 1300, seed: 5 }), ctx = makeCtx(s), p = s.players.w, n = 10000, count = {};
	const total = TIERS.reduce((sum, r) => sum + RARITY_WEIGHTS[r], 0);
	for (let i = 0; i < n; i++) {
		p.actives = [];
		const r = CARDS[hand.drawCard(ctx, "w", "active").key].rarity;
		count[r] = (count[r] || 0) + 1;
	}
	for (const r of TIERS) assert.ok(Math.abs(count[r] / n - RARITY_WEIGHTS[r] / total) < 0.03, r + " " + count[r] / n);
});

test("a version of Grace takes back a mating move like the base card", () => {
	reset();
	const grace = require("../../cards-engine/cards/passive/grace.js");
	register({ ...grace, versions: [{ rarity: "epic", text: "" }] });
	register({ key: "t-pass", kind: "active", name: "t-pass", rarity: "common", text: "", targets: () => [null], play });
	const s = newGame({ cardGuy: "b", level: 1300, seed: 1 });
	s.board = fromFen("3rkr2/3p1p2/8/8/8/8/8/R5K1 w - - 0 1"); // Ra1-e1 MATES
	for (const c of ["w", "b"]) Object.assign(s.players[c], { moves: [], actives: [], passive: null });
	s.players.w.moves = [{ id: "c61", key: "move", piece: "r" }];
	s.effects.push({ id: "c80", owner: "b", card: { id: "c80", key: "grace-epic" }, placedAt: s.ply });
	const { state, events } = applyAction(s, "w", { type: "move", card: "c61", from: "a1", to: "e1" });
	assert.equal(state.result, null);
	assert.ok(events.some((e) => e.type === "move-undone"));
	assert.deepEqual(state.players.b.used, ["grace-epic"]);
});

test("every built card has the catalog's rarity", () => {
	const want = {
		active: { "all-or-nothing": "rare", cleanse: "common", conscription: "legendary", "double-time": "rare", "fog-of-war": "uncommon", foresight: "common", "heavy-cavalry": "uncommon",
			"heretical-subjection": "rare", hexcraft: "uncommon", "insidious-nullification": "common", "last-stand": "uncommon", mulligan: "uncommon", "opposing-finality": "rare",
			pickpocket: "common", stronghold: "rare", swap: "rare", trapdoor: "uncommon" },
		passive: { "bad-omen": "rare", "bleeding-hand": "uncommon", bounty: "common", "escape-artist": "uncommon", grace: "legendary", hex: "uncommon", "last-rites": "uncommon",
			overwatch: "legendary", reinforcements: "uncommon", retaliation: "uncommon", spite: "common", "unjust-retribution": "rare",
			"interdicted-foresight": "common", witness: "common", veto: "rare", echo: "epic",
			"peasant-immunity": "common", phalanx: "uncommon", "unbroken-line": "uncommon", "pawn-storm": "common",
			underdog: "rare", "four-of-a-kind": "uncommon", patience: "common" },
		curse: { "dead-weight": "uncommon", "traitors-mark": "common", rust: "uncommon", tremor: "common", debt: "uncommon", shackles: "common", mirage: "uncommon", leech: "rare",
			"hollow-crown": "epic", hunger: "rare", pact: "uncommon" },
	};
	for (const kind of Object.keys(want)) for (const [key, rarity] of Object.entries(want[kind])) assert.equal(require("../../cards-engine/cards/" + kind + "/" + key + ".js").rarity, rarity, key);
	for (const kind of Object.keys(want)) { // A CARD FILE ADDED LATER MUST BE LISTED HERE TOO
		const files = require("node:fs").readdirSync(require("node:path").join(__dirname, "../../cards-engine/cards", kind)).map((f) => f.replace(".js", ""));
		for (const key of files) assert.ok(key in want[kind], key + " has no catalog rarity in this test");
	}
	assert.equal(require("../../cards-engine/cards/active/fog-of-war.js").skulls, 2);
});

test("register refuses an unknown rarity, and a repeat registration drops the versions it no longer has", () => {
	setup();
	assert.throws(() => register({ key: "t-bad", kind: "active", name: "t-bad", rarity: "mythic", text: "" }), /no known rarity/);
	assert.throws(() => register({ key: "t-bad", kind: "active", name: "t-bad", rarity: "common", text: "", versions: [{ rarity: "mythic" }] }), /no known rarity/);
	register({ ...CARDS["t-card"], versions: [{ rarity: "epic", text: "only" }] });
	assert.deepEqual(ACTIVE_KEYS.filter((k) => baseKey(k) === "t-card"), ["t-card", "t-card-epic"]);
	assert.ok(!("t-card-rare" in CARDS) && CARDS["t-card-epic"].text === "only");
});

test("a version of Trapdoor keeps its square from the opponent in the events and the view", () => {
	reset();
	register({ ...require("../../cards-engine/cards/active/trapdoor.js"), versions: [{ rarity: "rare", text: "" }] });
	const s = newGame({ cardGuy: "b", level: 1300, seed: 1 });
	s.board = fromFen("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
	s.players.w.actives = [{ id: "c90", key: "trapdoor-rare" }];
	const a = legalActions(s, "w").find((x) => x.type === "active");
	const { state, events } = applyAction(s, "w", a);
	assert.equal(state.enchant[0].data.square, a.target.square);
	assert.ok(!JSON.stringify(playerEvents(state, events, "b")).includes('"' + a.target.square + '"'));
	assert.ok(!JSON.stringify(playerView(state, "b").enchant).includes(a.target.square));
	assert.ok(JSON.stringify(playerView(state, "w").enchant).includes(a.target.square));
});
