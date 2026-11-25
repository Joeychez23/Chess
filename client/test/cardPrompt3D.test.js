// Task 23 S4: the prompts the 3D view shows as brass plaques (ruling T23-4). flow.js loads only in the browser (the DOM, the renderer), so its pure parts are tested here:
// which prompts become plaques & where (select.js plaquePrompt, tableLayout.js plaqueAnchor), the one button list both the 2D prompt & the plaques are built from (select.js promptButtons,
// so a plaque, which presses its 2D button, sends what that button sends), & the keys' rules the plaques keep (select.js promptFocus, keyPlan). The wiring is a browser check
const { test } = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/js/gameplay/cards/select.js");
const { plaqueAnchor, tableSpots, duelSpot, HAND_Z, BOARD_RECT } = require("../src/js/gameplay/three/tableLayout.js");
const { CARD_SIZE } = require("../src/js/gameplay/three/cardLayout.js");
const { fromFen } = require("../../cards-engine/board.js");

const CATALOG = { veto: { name: "Veto", rarity: "rare" }, foresight: { name: "Foresight", rarity: "common" }, "all-or-nothing": { name: "All or Nothing", rarity: "epic" }, shackles: { name: "Shackles", rarity: "common" } };
const view = (w = {}, more = {}) => ({
	you: "w", board: fromFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"), effects: [],
	players: {
		w: { king: true, kingSkulls: 2, moves: [{ id: "c1", key: "move", piece: "p" }, { id: "c2", key: "move", piece: "p" }], actives: [{ id: "c10", key: "foresight" }], passive: { id: "c11", key: "veto" }, curses: [{ id: "c12", key: "shackles" }], spot: [], pile: { n: 0, top: null }, kept: null, ...w },
		b: { king: true, hand: { count: 0, shown: [] }, spot: [], pile: { n: 0, top: null }, kept: null },
	},
	...more,
});
const DUEL = { round: 1, player: "w", piece: "w12", card: "all-or-nothing", step: "decide", hands: { w: [{ r: 9, s: "h" }, null, null], b: [{ r: 3, s: "c" }, null, null] }, picked: { w: [0], b: [0] }, spades: null };
const labels = (list) => list.map((b) => b.label);

test("group 1, the card duel: Stop / Continue & Knight / Bishop are plaques beside the player's duel cards, the legal actions in order, no Cancel", () => {
	const v = view({}, { duel: DUEL });
	const stop = [{ type: "duel", stop: true }, { type: "duel", stop: false }];
	assert.deepEqual(S.plaquePrompt({ pick: stop, choosing: true, duel: true }), { duel: true });
	const list = S.promptButtons({ pick: stop, choosing: true }, v, CATALOG);
	assert.deepEqual(labels(list), ["Stop", "Continue"]);
	assert.deepEqual(list.map((b) => b.action), stop, "each plaque sends its own legal action");
	assert.equal(new Set(list.map((b) => b.id)).size, 2);
	const kb = [{ type: "choice", option: "n" }, { type: "choice", option: "b" }];
	const pending = view({}, { duel: DUEL, pending: { card: "all-or-nothing" } });
	assert.deepEqual(S.plaquePrompt({ pick: kb, choosing: true, duel: true }), { duel: true });
	assert.deepEqual(labels(S.promptButtons({ pick: kb, choosing: true }, pending, CATALOG)), ["Knight", "Bishop"]);
	const at = plaqueAnchor({ duel: true }, v, false);
	assert.deepEqual(at, { x: duelSpot("mine", "round", 2).x + CARD_SIZE.w / 2, z: HAND_Z, side: "right" }, "the right end of the player's duel row");
});

test("group 2, a King move that costs a King skull: Play & Cancel beside the king's square, on the board's nearer side edge, turned with the room", () => {
	const skull = { type: "move", card: "king", from: "e1", to: "e2" };
	assert.deepEqual(S.plaquePrompt({ skull, pick: [] }), { square: "e1" });
	const list = S.promptButtons({ skull, pick: [] }, view(), CATALOG);
	assert.deepEqual(labels(list), ["Play", "Cancel"]);
	assert.deepEqual(list.map((b) => b.action), [skull, null], "Play sends the waiting move, Cancel is null (cancelPick)");
	assert.equal(list[S.promptFocus([])].label, "Play", "the keys start on Play, as the 2D prompt");
	assert.deepEqual(plaqueAnchor({ square: "e1" }, view(), false), { x: BOARD_RECT.x1, z: 10.5, side: "right" }); // e1: x 1.5, z 10.5 (three/index.js center)
	assert.deepEqual(plaqueAnchor({ square: "e1" }, view(), true), { x: BOARD_RECT.x0, z: -10.5, side: "left" }); // FROM BLACK'S SIDE THE ROOM IS TURNED HALF ROUND
	assert.deepEqual(plaqueAnchor({ square: "a8" }, view(), false), { x: BOARD_RECT.x0, z: -10.5, side: "left" });
});

test("group 3, a move's two forms under fog: both forms & Cancel beside the moving piece's square", () => {
	const forms = [{ type: "move", card: "c1", from: "e2", to: "e4" }, { type: "move", card: null, from: "e2", to: "e4" }];
	assert.deepEqual(S.plaquePrompt({ pick: forms, card: "c1", hidden: true }), { square: "e2" });
	const list = S.promptButtons({ pick: forms }, view(), CATALOG);
	assert.deepEqual(labels(list), ["e2 to e4", "e2 to e4 without a card", "Cancel"]);
	assert.deepEqual(list.map((b) => b.action), [...forms, null]);
	assert.equal(S.promptFocus(forms), 0);
});

test("T23-26: only the fog's two forms are group 3; any other prompt of moves keeps the 2D box", () => {
	const forms = [{ type: "move", card: "c1", from: "e2", to: "e4" }, { type: "move", card: null, from: "e2", to: "e4" }];
	assert.equal(S.plaquePrompt({ pick: forms, card: "c1" }), null, "the same forms with no fog: the 2D box");
	assert.deepEqual(S.plaquePrompt({ pick: [forms[1], forms[0]], hidden: true }), { square: "e2" }, "either order");
	assert.equal(S.plaquePrompt({ pick: [forms[0], { type: "move", card: "c2", from: "e2", to: "e4" }], hidden: true }), null, "two cards' moves under fog, neither without a card");
	assert.equal(S.plaquePrompt({ pick: [forms[1], { type: "move", card: "c1", from: "e2", to: "e3" }], hidden: true }), null, "moves to two squares");
	assert.equal(S.plaquePrompt({ pick: [{ type: "move", card: "c1", from: "e7", to: "e8", promotion: "q" }, { type: "move", card: "c1", from: "e7", to: "e8", promotion: "n" }], card: "c1" }), null, "a promotion's pieces");
});

test("group 4, a lifted card's free discards: place, reroll, a pair's discard & Cancel, below the lifted hand card; a reroll first starts the keys on Cancel", () => {
	const v = view();
	const passive = [{ type: "passive" }, { type: "discard", cards: ["c11"] }];
	assert.deepEqual(S.plaquePrompt({ pick: passive, card: "c11" }), { card: "c11" });
	assert.deepEqual(labels(S.promptButtons({ pick: passive }, v, CATALOG)), ["Place in Board Effects (uses your turn)", "Reroll your Veto (new passive now)", "Cancel"]);
	const reroll = [{ type: "discard", cards: ["c11"] }];
	const list = S.promptButtons({ pick: reroll }, v, CATALOG);
	assert.equal(list[S.promptFocus(reroll)].label, "Cancel", "Enter alone never rerolls");
	const pair = [{ type: "discard", cards: ["c1", "c2"] }, { type: "discard", cards: ["c1"] }];
	assert.deepEqual(S.plaquePrompt({ pick: pair, card: "c1" }), { card: "c1" });
	const active = [{ type: "discard", cards: ["c10"] }];
	assert.deepEqual(S.plaquePrompt({ pick: active, card: "c10" }), { card: "c10" });
	const spot = tableSpots(v, { base: 0, layer: 0 }).get("w:c11");
	assert.deepEqual(plaqueAnchor({ card: "c11" }, v, false), { x: spot.x, z: HAND_Z + CARD_SIZE.h / 2, side: "below" }, "the lifted card's near edge");
});

test("every other prompt keeps the 2D prompt: a curse's Pay, a choice's options, the placed cards' drops, an active's targets, & nothing to press", () => {
	assert.equal(S.plaquePrompt({ pick: [{ type: "clear", card: "c12" }, { type: "clear", card: "c12", discard: "c1" }], card: "c12" }), null);
	assert.equal(S.plaquePrompt({ pick: [{ type: "choice", option: "w15" }, { type: "choice", option: "w10" }], choosing: true, duel: false }), null);
	assert.equal(S.plaquePrompt({ pick: [{ type: "drop", card: "p1" }], card: null }), null);
	assert.equal(S.plaquePrompt({ pick: [{ type: "active", card: "c13", target: { t: "n" } }, { type: "active", card: "c13", target: { t: "b" } }], card: "c13" }), null);
	assert.equal(S.plaquePrompt({ pick: [{ type: "active", card: "c10" }, { type: "discard", cards: ["c10"] }], card: "c10" }), null, "an active's Play it with its discard: not only free discards");
	assert.equal(S.plaquePrompt({ pick: [] }), null, "no prompt: the plaques go (showButtons([]))");
});

test("the keys over the plaques are the 2D buttons' (Task 19): Enter on the focused one presses it, a held Enter never does, Escape cancels a pick", () => {
	const base = { on: true, yours: true, picked: true };
	assert.equal(S.keyPlan({ ...base, key: "Enter", button: true }), "page", "the focused button (its plaque's) is pressed");
	assert.equal(S.keyPlan({ ...base, key: "Enter", button: true, repeat: true }), "stop", "a held Enter presses nothing");
	assert.equal(S.keyPlan({ ...base, key: "Escape", button: true }), "hand", "Escape is the pick's Cancel");
	assert.equal(S.keyPlan({ ...base, key: "ArrowRight", button: true }), "blur", "an arrow leaves the buttons, as today (Tab walks them: the browser's own)");
});

test("review M2: a mixed move & discard prompt & a discard with no lifted card keep the 2D prompt (plaquePrompt's every & card guards)", () => {
	assert.equal(S.plaquePrompt({ pick: [{ type: "move", card: "c1", from: "e2", to: "e4" }, { type: "discard", cards: ["c1"] }], card: null }), null, "not only moves: no square plaques");
	assert.equal(S.plaquePrompt({ pick: [{ type: "discard", cards: ["c1"] }], card: null }), null, "no lifted card: nothing to lay them by");
});

// THE WIRING flow.js, pointer.js, three/index.js & renderer/index.js CAN'T LOAD IN node FOR (THE DOM, three): READ FROM THEIR SOURCE, AS statusFx.test.js DOES
const fs = require("node:fs"), path = require("node:path");
const src = (f) => fs.readFileSync(path.join(__dirname, "../src/js/gameplay", f), "utf8");
const body = (f, head) => { const s = src(f), i = s.indexOf(head); assert.ok(i >= 0, `${head} in ${f}`); return s.slice(i, s.indexOf("\n}", i) + 2); };

test("review I1 & ruling T23-23: every showPrompt call lays its plaques (or none) & sets the hiding flag from whether they're up, before the unchanged prompt returns; hidden, the flag clears (M3)", () => {
	const fn = body("cards/flow.js", "function showPrompt(ready, glow) {");
	const lay = fn.indexOf("showTableButtons3D("), flag = fn.indexOf('promptBox?.toggleAttribute("data-plaques", plaques)'), same = fn.indexOf("if (key === shownPrompt) { return; }");
	assert.ok(lay >= 0 && flag > lay && same > flag, "laid & flagged on every call, the same key too");
	assert.match(fn, /const plaques = showTableButtons3D\([^;]*\) && Boolean\(at\);/, "always called ([] takes them away), flagged only when this prompt has plaques & the table took them");
	assert.ok(fn.indexOf("promptBox.hidden = true") > flag, "a hidden prompt's flag is already cleared (no plaques: at is null)");
	assert.equal((fn.match(/showTableButtons3D\(/g) || []).length, 1, "one place lays them, [] when the prompt has none");
	assert.match(fn, /showTableButtons3D\(at \? list\.map\(\(\{ id, label \}\) => \(\{ id, label \}\)\) : \[\], at && plaqueAnchor\(at, cards\.view, game\.viewColor === "b"\)\)/, "[] takes them away; the side is read on every call (review I2)");
	const pick = body("cards/flow.js", "onTablePick((hit) => {");
	assert.match(pick, /if \(hit\.kind === "table"\) \{ refreshTable\(\); return; \}/, "the table came up, a new board went up or the room turned: the prompt is laid again");
	assert.match(pick, /if \(hit\.kind === "button"\) \{ promptBox\?\.querySelector\(`\[data-plaque="\$\{hit\.id\}"\]`\)\?\.click\(\); return; \}/, "a plaque presses its own 2D button");
});

test("review I1 & T23-23: the table coming up (a room loaded after a view switch, a rebuild, or mid-prompt) & a new 3D board tell flow.js", () => {
	const set = body("three/index.js", "export function setCardTable(state, legal, opts = {}) {");
	assert.ok(set.indexOf('if (made && view.table) { view.cardOptions.onTable({ kind: "table" }); }') > set.indexOf("view.table.set(state, opts)"), "once it's set: the prompt's plaques lie by its cards");
	const show = body("renderer/index.js", "async function show3D() {");
	assert.ok(show.indexOf("tableUp();") > show.indexOf("applyTable3D();"), "a new board (its room still loading): the prompt shows its 2D buttons until the table is up");
	assert.match(body("renderer/index.js", "function tableUp() {"), /tableSide = game\.viewColor;\s*tablePick\?\.\(\{ kind: "table" \}\);/);
});

test("T23-27: showTableButtons says whether plaques are up (none when blocked in the view), & a resize that brings them back or takes them away tells flow.js", () => {
	assert.match(body("three/index.js", "export function showTableButtons(list, anchor) {"), /const up = view\.table\.showButtons\(list, anchor\);[\s\S]*return up;/, "flow.js's data-plaques follows the table's answer");
	const resize = body("three/index.js", "export function relayPlaques() {");
	assert.match(resize, /const up = view\.table\.buttonCount\(\) > 0;/);
	assert.match(resize, /if \(view\.table\.relayButtons\(\) !== up\) \{ view\.cardOptions\.onTable\(\{ kind: "table" \}\); \}/, "flow.js lays the prompt again: its flag follows");
	assert.match(src("three/index.js"), /new ResizeObserver\(resize\);/, "a resize reaches relayPlaques only through camera.js resize, once the camera has settled (review N1)");
	assert.match(src("three/index.js"), /inView: \(\) => deskInView\(view\.camera, view\.room\), camera: view\.camera \}\);/, "the table checks its plaques on screen through the live camera (ruling T23-28)");
});

test("review I2: Flip Board turns the room, so a prompt's plaques by a square are laid again on the side the player now looks from", () => {
	const draw = body("renderer/index.js", "export function drawBoard() {");
	assert.ok(draw.indexOf("if (game.viewColor !== tableSide) { tableUp(); }") > draw.indexOf("board3D.setSide(game.viewColor"), "after the room turns");
	assert.notDeepEqual(plaqueAnchor({ square: "e1" }, view(), false), plaqueAnchor({ square: "e1" }, view(), true), "the anchor differs by side");
});

test("review I3 & ruling T23-22: a tap or click on a plaque presses it through a zoom or an open pile in one tap", () => {
	const fn = body("three/pointer.js", "function pickTable(e, stop) {");
	const button = fn.indexOf('if (at && at.kind === "button") {'), open = fn.indexOf("if (view.table.open() &&"), zoom = fn.indexOf("if (view.table.zoomed())");
	assert.ok(button >= 0 && button < open && button < zoom, "before the open pile's & the zoom's tap that does nothing more");
	const branch = fn.slice(button, open);
	assert.match(branch, /if \(view\.table\.open\(\)\) \{ togglePile\(null\); \}/, "the open pile closes");
	assert.match(branch, /view\.cardOptions\.onTable\(at\);[^\n]*\n\s*return true;/, "& the plaque is pressed (its 2D button's click ends a zoom: endZoom)");
	assert.match(body("cards/flow.js", "function showPrompt(ready, glow) {"), /b\.addEventListener\("click", \(\) => \{ endZoom\(\); pressTableButton3D\(id\); onClick\(\); \}\);/);
});

test("review M1 & M2: a new prompt's plaque under a still mouse lights; a plaque is never grabbed; the keys' focus is the plaque's", () => {
	assert.ok(body("three/index.js", "export function showTableButtons(list, anchor) {").indexOf("rehoverPlaque();") > 0, "after showButtons, which unlights another list (ruling T23-20)");
	const re = body("three/pointer.js", "export function rehoverPlaque() {");
	assert.match(re, /plaqueLit = undefined;/, "the cache forgets what it lit: the table may have unlit it");
	assert.match(re, /tableAt\(\{ clientX: view\.pointerAt\.x, clientY: view\.pointerAt\.y \}\)/, "the plaque under the still mouse");
	assert.match(body("three/pointer.js", "export function onPointerDown(e) {"), /cardHeld = Boolean\(at && at\.kind !== "button" && at\.id && view\.table\.grab\(/);
	const fn = body("cards/flow.js", "function showPrompt(ready, glow) {");
	assert.match(fn, /b\.addEventListener\("focus", \(\) => focusTableButton3D\(i\)\);/);
	assert.match(fn, /b\.dataset\.plaque = id;/);
});

// RE-REVIEW 1 N1: PLAQUES LAID ON A NEW TABLE UNDER A 2D BUTTON THAT KEPT THE KEYBOARD'S FOCUS SHOW ITS RING (flow.js CAN'T LOAD IN NODE: A TRIPWIRE ON ITS SOURCE)
test("N1: showPrompt rings the plaque of the focused 2D button whenever its plaques are up", () => {
	const flow = src("cards/flow.js"), lay = flow.indexOf("toggleAttribute(\"data-plaques\"");
	const ring = flow.indexOf("promptBox.contains(document.activeElement)) { focusTableButton3D(");
	assert.ok(ring > lay && ring < flow.indexOf("if (key === shownPrompt)"), "after the lay, before the early return");
});
