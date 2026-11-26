const { test } = require("node:test");
const assert = require("node:assert/strict");
const { tableSpots, placeAt, PILES, DISCARD } = require("../src/js/gameplay/three/tableLayout.js");
const { PILE_AREA } = require("../src/js/gameplay/three/piles.js");
const { CARD_SIZE, DECK } = require("../src/js/gameplay/three/cardLayout.js");
const S = require("../src/js/gameplay/cards/select.js");
const { fromFen } = require("../../cards-engine/board.js");

// THE START POSITION: WHITE'S g1 KNIGHT IS w15, b1 IS w10 (AS server/test/cards-clientSelect.test.js)
const view = (w = {}) => ({
	you: "w", board: fromFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"), effects: [{ id: "p1", owner: "w", card: { id: "p1", key: "spite" } }],
	players: {
		w: { king: true, moves: [{ id: "c1", key: "move", piece: "p" }], actives: [{ id: "c9", key: "stronghold" }, { id: "c10", key: "foresight" }, { id: "c13", key: "conscription" }], passive: { id: "c11", key: "veto" }, curses: [{ id: "c12", key: "shackles" }], spot: [{ id: "s1", key: "fog-of-war" }], pile: { n: 3, top: { id: "t1", key: "move", piece: "p" } }, kept: null, ...w },
		b: { king: true, hand: { count: 0, shown: [] }, spot: [], pile: { n: 0, top: null }, kept: null },
	},
});
const LEGAL = [
	{ type: "move", card: "c1", from: "e2", to: "e4" },
	{ type: "active", card: "c9", target: { piece: "w15" } },
	{ type: "active", card: "c9", target: { piece: "w10" } },
	{ type: "active", card: "c10" },
	{ type: "active", card: "c13", target: { t: "n" } },
	{ type: "active", card: "c13", target: { t: "b" } },
	{ type: "passive" },
	{ type: "discard", cards: ["c1"] },
	{ type: "discard", cards: ["c10"] },
	{ type: "discard", cards: ["c11"] },
	{ type: "drop", card: "p1" },
];
const mine = (place) => ({ side: "mine", place });
const hand = (id) => ({ from: "hand", id });

test("the discard piles: on the green deck's outer side, clear of the taken pieces, on the desk, the player's nearer the player", () => {
	for (const d of [DISCARD.mine, DISCARD.his]) {
		assert.ok(d.x - CARD_SIZE.w / 2 > -DECK.x + CARD_SIZE.w / 2, "right of the green deck");
		assert.ok(d.x - CARD_SIZE.w / 2 - 0.5 > -PILE_AREA.x0, "placeAt's reach stays off the taken pieces (the near pile is PILE_AREA mirrored)");
		assert.ok(d.x + CARD_SIZE.w / 2 < 48 && Math.abs(d.z) + CARD_SIZE.h / 2 < 32, "on the desk top");
	}
	assert.ok(DISCARD.mine.z > 0 && DISCARD.his.z < 0);
	assert.deepEqual(placeAt(DISCARD.mine.x, DISCARD.mine.z), mine("discard"));
});

test("dropPlay: a hand card on the player's discard pile is its own free discard, when legal lists it", () => {
	const v = view();
	assert.deepEqual(S.dropPlay(LEGAL, v, hand("c1"), mine("discard")), { action: { type: "discard", cards: ["c1"] } }); // A MOVE CARD
	assert.deepEqual(S.dropPlay(LEGAL, v, hand("c10"), mine("discard")), { action: { type: "discard", cards: ["c10"] } }); // AN ACTIVE
	assert.deepEqual(S.dropPlay(LEGAL, v, hand("c11"), mine("discard")), { action: { type: "discard", cards: ["c11"] } }); // THE HELD PASSIVE: ITS REROLL
	assert.equal(S.dropPlay(LEGAL, v, hand("c9"), mine("discard")), null); // NOT OFFERED: BACK TO THE HAND
	assert.equal(S.dropPlay(LEGAL, v, hand("c12"), mine("discard")), null); // A CURSE
	assert.equal(S.dropPlay(LEGAL, v, hand("king"), mine("discard")), null);
	assert.equal(S.dropPlay(LEGAL.filter((a) => a.type !== "discard"), v, hand("c1"), mine("discard")), null);
});

test("dropPlay: an active on the active spot is played at once with no target, else its targets are picked next; a passive on the passive pile is placed", () => {
	const v = view();
	assert.deepEqual(S.dropPlay(LEGAL, v, hand("c10"), mine("spot")), { action: { type: "active", card: "c10" } });
	const targets = S.dropPlay(LEGAL, v, hand("c9"), mine("spot"));
	assert.deepEqual(targets, { pick: { card: "c9", actions: [LEGAL[1], LEGAL[2]], picks: [] } }); // NO DISCARD AMONG THEM
	assert.deepEqual(S.options(targets.pick, v.board).glow, ["b1", "g1"]);
	assert.deepEqual(S.dropPlay(LEGAL, v, hand("c13"), mine("spot")).pick.actions, [LEGAL[4], LEGAL[5]]); // TARGETS WITH NO SQUARE: THE PROMPT CHOOSES
	assert.deepEqual(S.dropPlay(LEGAL, v, hand("c11"), mine("passive")), { action: { type: "passive" } });
	assert.equal(S.dropPlay(LEGAL.filter((a) => a.type !== "passive"), v, hand("c11"), mine("passive")), null);
	assert.equal(S.dropPlay(LEGAL.filter((a) => a.type !== "active"), v, hand("c10"), mine("spot")), null); // UNPLAYABLE (DIMMED)
});

test("dropPlay: the wrong place, Card Guy's places & nowhere put the card back", () => {
	const v = view();
	assert.equal(S.dropPlay(LEGAL, v, hand("c10"), mine("passive")), null);
	assert.equal(S.dropPlay(LEGAL, v, hand("c11"), mine("spot")), null);
	assert.equal(S.dropPlay(LEGAL, v, hand("c1"), mine("spot")), null); // A MOVE CARD IS PLAYED THROUGH ITS PIECE
	assert.equal(S.dropPlay(LEGAL, v, hand("c1"), { side: "his", place: "discard" }), null);
	assert.equal(S.dropPlay(LEGAL, v, hand("c1"), null), null);
	assert.equal(S.dropPlay(LEGAL, v, hand("nope"), mine("discard")), null);
});

test("dropPlay: one of the player's placed cards on their discard pile is its drop, when legal lists it", () => {
	const v = view();
	assert.deepEqual(S.dropPlay(LEGAL, v, { from: "pile", id: "p1" }, mine("discard")), { action: { type: "drop", card: "p1" } });
	assert.equal(S.dropPlay(LEGAL, v, { from: "pile", id: "s1" }, mine("discard")), null); // NOT OFFERED (IT ONLY WAITS FOR THE TURN'S END)
	assert.equal(S.dropPlay(LEGAL, v, { from: "pile", id: "p1" }, mine("spot")), null);
	assert.equal(S.dropPlay(LEGAL, v, { from: "pile", id: "p1" }, { side: "his", place: "discard" }), null);
	assert.equal(S.dropPlay(LEGAL, v, hand("p1"), mine("discard")), null); // A PLACED CARD IS NO HAND CARD
});

test("dropPlay under Card Guy's Fog of War: Last Stand dropped on the active spot is tried blind", () => {
	const v = view({ actives: [{ id: "c20", key: "last-stand" }] });
	v.board = fromFen("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
	const play = S.dropPlay([], v, hand("c20"), mine("spot"), true);
	assert.ok(play.pick.actions.length > 0 && play.pick.actions.every((a) => a.type === "active" && a.card === "c20"));
	assert.equal(S.dropPlay([], v, hand("c20"), mine("spot"), false), null);
});

test("promptPlays: the mouse's prompt has no discard, no placing & no Play it; the keys' & a tap's keep theirs", () => {
	const discard = { type: "discard", cards: ["c10"] }, play = { type: "active", card: "c10" }, place = { type: "passive" }, clear = { type: "clear", card: "c12", discard: "c1" };
	const forms = [{ type: "move", card: "c1", from: "e2", to: "e4" }, { type: "move", card: null, from: "e2", to: "e4" }], types = [LEGAL[4], LEGAL[5]];
	assert.deepEqual(S.promptPlays([play, discard], {}), [play, discard]);
	assert.deepEqual(S.promptPlays([place, discard], { mouse: false }), [place, discard]);
	assert.deepEqual(S.promptPlays([play, discard], { mouse: true }), []);
	assert.deepEqual(S.promptPlays([place, discard], { mouse: true }), []);
	assert.deepEqual(S.promptPlays([clear], { mouse: true }), [clear]); // A CURSE IS PAID FROM ITS PROMPT
	assert.deepEqual(S.promptPlays(forms, { mouse: true, picks: 2 }), forms); // TWO FORMS OF ONE MOVE
	assert.deepEqual(S.promptPlays(types, { mouse: true }), []); // ONLY LIFTED: NOT PLAYED FROM A BUTTON
	assert.deepEqual(S.promptPlays(types, { mouse: true, placed: true }), types); // DROPPED ON THE ACTIVE SPOT: ITS TARGETS WITH NO SQUARE
	assert.deepEqual(S.promptPlays(types, { mouse: true, picks: 1 }), types); // TWO PLAYS ON THE SAME SQUARE
});

test("tableSpots: a card let go on a place lies there until its play is answered or given up", () => {
	const Y = { base: 0, layer: 1 }, v = view();
	const at = (stage) => tableSpots(v, { ...Y, stage });
	const home = tableSpots(v, Y).get("w:c9");
	const spot = at({ id: "c9", from: "hand", place: "spot" }).get("w:c9");
	assert.deepEqual([spot.x, spot.z, spot.y, spot.staged, spot.hand], [PILES.mineSpot.x, PILES.mineSpot.z, 1, true, true]); // ON THE ONE ACTIVE IN EFFECT, STILL A HAND CARD: IT CAN BE DRAGGED BACK
	const gone = at({ id: "c1", from: "hand", place: "discard" }).get("w:c1");
	assert.deepEqual([gone.x, gone.z, gone.staged], [DISCARD.mine.x, DISCARD.mine.z, true]);
	assert.ok(gone.y > 3); // ABOVE THE PILE'S 3 CARDS
	const placed = at({ id: "c11", from: "hand", place: "passive" }).get("w:c11");
	assert.deepEqual([placed.x, placed.z, placed.y], [PILES.mine.x, PILES.mine.z, 1]);
	const dropped = at({ id: "p1", from: "pile", place: "discard" }).get("w:p1");
	assert.deepEqual([dropped.x, dropped.z, dropped.pile], [DISCARD.mine.x, DISCARD.mine.z, "mine"]);
	assert.deepEqual(at({ id: "c1", from: "hand", place: "discard" }).get("w:c9"), home); // THE REST OF THE HAND STAYS
	assert.ok(!at({ id: "t1", from: "hand", place: "spot" }).get("w:t1").staged); // IT LEFT THE HAND (THE ANSWER CAME): ITS OWN PLACE
	assert.ok(!at({ id: "c1", from: "pile", place: "discard" }).get("w:c1").staged);
});

test("pileDrops: the keys' & a tap's drop buttons, only for the player's own opened pile's cards whose drop legal lists; each sends { type: \"drop\", card }", () => {
	const v = view({ spot: [{ id: "s1", key: "fog-of-war" }, { id: "s2", key: "stronghold" }] });
	v.effects.push({ id: "p2", owner: "w", card: { id: "p2", key: "veto" } }, { id: "q1", owner: "b", card: { id: "q1", key: "spite" } });
	v.players.b.spot = [{ id: "s9", key: "fog-of-war" }];
	const legal = [...LEGAL, { type: "drop", card: "s2" }, { type: "drop", card: "q1" }, { type: "drop", card: "s9" }]; // q1 & s9 ARE CARD GUY'S: NEVER OFFERED, WHATEVER legal SAYS
	assert.deepEqual(S.pileDrops(legal, v, "mine"), [{ type: "drop", card: "p1" }]); // p2 HAS NO LEGAL DROP
	assert.deepEqual(S.pileDrops(legal, v, "mineSpot"), [{ type: "drop", card: "s2" }]);
	assert.deepEqual(S.pileDrops(legal, v, "mine", "p1"), [{ type: "drop", card: "p1" }]); // A TAP ON THAT CARD
	assert.deepEqual(S.pileDrops(legal, v, "mine", "p2"), []);
	assert.deepEqual(S.pileDrops(legal, v, "mine", "s2"), []); // NOT THAT PILE'S
	assert.deepEqual(S.pileDrops(legal, v, "his"), []);
	assert.deepEqual(S.pileDrops(legal, v, "hisSpot", "s9"), []);
	assert.deepEqual(S.pileDrops(LEGAL.filter((a) => a.type !== "drop"), v, "mine"), []);
	const drops = S.pileDrops(legal, v, "mine"), pick = { card: null, actions: drops, picks: [] };
	assert.deepEqual(S.promptPlays(S.options(pick, v.board).ready, { mouse: false }), drops); // A BUTTON, NO SQUARE TO PICK
	assert.equal(S.promptFocus(drops), 1); // CANCEL HAS THE KEYS' FOCUS: ENTER ALONE NEVER DROPS A CARD (AS A DISCARD, N2)
	assert.equal(S.label(drops[0], v, { spite: { name: "Spite" } }), "Discard your Spite from the table");
});
