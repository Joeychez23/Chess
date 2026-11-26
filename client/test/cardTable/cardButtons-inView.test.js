// The brass plaque buttons on the table: lying inside the desk the camera shows (deskInView), wrapping when too wide, on screen in the opening & orbited views or not up at all, & resting on the baize or the desk, with real three.js in node, as cardTable-duel.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { THREE, deskInView, buttonLayout, plaqueAnchor, tableSpots, duelLayout, DUEL_STACK, BOARD_RECT, DESK_AVOID, HAND_Z, CARD_SIZE, CARD_Y, openingCamera, DESK_Y, S, fromFen, setup, plaques, cardRect, box, clear, LIST, laidBoxes, laidAt, handRows } = require("../helpers/cardButtons.js");

// THE PLAQUES LIE INSIDE THE DESK THE CAMERA SHOWS (buttonLayout's within: cardTable.buttons.js deskInView), SHIFTED ALONG
// & WRAPPED TO MORE ROWS WHEN TOO WIDE. THE END-TO-END CHECK CHAINS openingCamera -> deskInView -> plaqueAnchor -> buttonLayout WITH THE REAL LABELS (select.js promptButtons) & THE VIEW'S
// REAL CARD FOOTPRINTS, & PROJECTS EVERY PLAQUE CORNER (ON THE DESK & AT THE TOP OF ONE ON THE BAIZE) THROUGH THE CAMERA, AS A REVIEW'S FUZZ PROBE DID
const inside = (laid, r) => laid.every((p) => { const b = box(p); return b.x0 >= r.x0 - 1e-5 && b.x1 <= r.x1 + 1e-5 && b.z0 >= r.z0 - 1e-5 && b.z1 <= r.z1 + 1e-5; }); // 1e-5: A MESH'S GEOMETRY IS 32-BIT
const LONG = [{ id: "a", label: "Discard your Pawn card & Knight card (the next one discarded draws 1)" }, { id: "b", label: "Discard your Pawn card & Bishop card (the next one discarded draws 1)" }, { id: "c", label: "Discard your Pawn card (draw 1)" }, { id: "x", label: "Cancel" }];

test("a row past the view's side shifts inside it, on one line while it fits", () => {
	const within = { x0: -19, x1: 19, z0: -40, z1: 27 }, anchor = { x: -18.4, z: HAND_Z + CARD_SIZE.h / 2, side: "below" };
	const laid = buttonLayout(LIST, anchor, [BOARD_RECT, ...handRows(9)], within);
	assert.ok(!laid.blocked);
	assert.ok(inside(laid, within), JSON.stringify(laid.map(box)));
	assert.equal(new Set(laid.map((p) => p.z)).size, 1, "one row");
	const free = buttonLayout(LIST, anchor, [BOARD_RECT, ...handRows(9)]), dx = laid[0].x - free[0].x;
	assert.ok(dx > 0 && laid.every((p, i) => Math.abs(p.x - free[i].x - dx) < 1e-9 && p.z === free[i].z), "the same row, moved toward the middle");
	assert.ok(Math.abs(laid[0].x - laid[0].w / 2 - within.x0) < 1e-9, `slid flush to the view's side, not to the nearest-spot search's 0.25 grid: ${laid[0].x - laid[0].w / 2}`); // FLUSH, NOT SNAPPED TO THE GRID
});

test("a row wider than the view wraps to two rows, then to a column; in order, inside, clear of the cards", () => {
	const anchor = { x: 0, z: HAND_Z + CARD_SIZE.h / 2, side: "below" }, cards = handRows(9);
	const SHORT = [{ id: "a", label: "Knight" }, { id: "b", label: "Bishop" }, { id: "c", label: "Rook" }, { id: "x", label: "Cancel" }];
	for (const [list, width, rows] of [[LONG, 38, 2], [LONG, 20, 3], [SHORT, 5, 4]]) { // 38: BOTH PAIRS, THEN THE REST. 20: ONE LONG PLAQUE A ROW. 5: A COLUMN
		const within = { x0: -width / 2, x1: width / 2, z0: -40, z1: 32 };
		const laid = buttonLayout(list.map((b, i) => ({ ...b, id: LONG[i].id })), anchor, [BOARD_RECT, ...cards], within);
		assert.ok(!laid.blocked);
		assert.ok(inside(laid, within), `${width} wide: ${JSON.stringify(laid.map(box))}`);
		assert.equal(new Set(laid.map((p) => p.z.toFixed(6))).size, rows, `${width} wide: ${rows} rows`);
		assert.deepEqual(laid.map((p) => p.id), ["a", "b", "c", "x"]);
		clear(laid, cards);
	}
});

test("the nearest-spot search stays inside the view too", () => {
	const duel = { player: "w", piece: "w12", step: "decide", round: 1, hands: { w: [null, null, null], b: [null, null, null] }, picked: { w: [], b: [] }, spades: { hands: { w: [null, null, null], b: [null, null, null] }, picked: { w: [], b: [] } } }; // THE SPADES SET UP: THE ROW'S RIGHT END AT x 15.95
	const cards = [...duelLayout(duel, "w").map(cardRect), cardRect(DUEL_STACK.mine), cardRect(DUEL_STACK.his)];
	const right = Math.max(...duelLayout(duel, "w").map((d) => d.x)) + CARD_SIZE.w / 2, within = { x0: -19, x1: 19, z0: -30, z1: 23.5 };
	const laid = buttonLayout(LIST, { x: right, z: HAND_Z, side: "right" }, [BOARD_RECT, ...DESK_AVOID, ...cards], within);
	assert.ok(!laid.blocked);
	assert.ok(inside(laid, within), JSON.stringify(laid.map(box)));
});

const CATALOG = { veto: { name: "Veto", rarity: "rare" }, foresight: { name: "Foresight", rarity: "common" }, "all-or-nothing": { name: "All or Nothing", rarity: "epic" }, shackles: { name: "Shackles", rarity: "common" }, hunger: { name: "Hunger", rarity: "common" } };
const gameView = (n, more = {}) => ({ you: "w", board: fromFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"), effects: [],
	players: { w: { king: true, kingSkulls: 2, moves: Array.from({ length: n }, (_, i) => ({ id: `m${i}`, key: "move", piece: "pnbrqk"[i % 6] })), actives: [{ id: "a1", key: "foresight" }], passive: { id: "p1", key: "veto" }, curses: [{ id: "k1", key: "shackles" }, { id: "k2", key: "hunger" }], spot: [], pile: { n: 0, top: null }, kept: null },
		b: { king: true, hand: { count: 9, shown: [] }, spot: [], pile: { n: 0, top: null }, kept: null } }, ...more });
const DUEL_UP = { round: 1, player: "w", piece: "w12", card: "all-or-nothing", step: "decide", hands: { w: [{ r: 9, s: "h" }, { r: 4, s: "d" }, null], b: [{ r: 3, s: "c" }, null, null] }, picked: { w: [0], b: [0] }, spades: null };
const footprints = (v) => [...tableSpots(v, { base: 0, layer: 0 }).values()].map(cardRect).concat(v.duel ? duelLayout(v.duel, v.you, v).map(cardRect) : []);
function promptCases() { // [what, view, at, turned, ask]
	const out = [];
	for (const n of [5, 6]) {
		const v = gameView(n), last = n - 1;
		for (const i of [0, last]) {
			out.push([`move m${i} pair`, v, { card: `m${i}` }, false, { pick: [{ type: "discard", cards: [`m${i}`, `m${(i + 1) % n}`] }, { type: "discard", cards: [`m${i}`] }] }]);
			out.push([`move m${i} two pairs`, v, { card: `m${i}` }, false, { pick: [{ type: "discard", cards: [`m${i}`, `m${(i + 1) % n}`] }, { type: "discard", cards: [`m${i}`, `m${(i + 2) % n}`] }, { type: "discard", cards: [`m${i}`] }] }]);
			out.push([`move m${i} alone`, v, { card: `m${i}` }, false, { pick: [{ type: "discard", cards: [`m${i}`] }] }]);
		}
		out.push(["active", v, { card: "a1" }, false, { pick: [{ type: "discard", cards: ["a1"] }] }]);
		out.push(["passive", v, { card: "p1" }, false, { pick: [{ type: "passive" }, { type: "discard", cards: ["p1"] }] }]);
		const dv = gameView(n, { duel: DUEL_UP });
		out.push(["duel stop", dv, { duel: true }, false, { pick: [{ type: "duel", stop: true }, { type: "duel", stop: false }], choosing: true }]);
		out.push(["duel knight", { ...dv, pending: { card: "all-or-nothing" } }, { duel: true }, false, { pick: [{ type: "choice", option: "n" }, { type: "choice", option: "b" }], choosing: true }]);
		for (const sq of ["a8", "h8", "a1", "h1", "e4"]) {
			for (const turned of [false, true]) { out.push([`skull ${sq}${turned ? " turned" : ""}`, v, { square: sq }, turned, { skull: { type: "move", card: "king", from: sq, to: sq } }]); }
		}
	}
	return out;
}

test("in the opening view at desktop, 4:3 & narrow portrait sizes (FOV 45 & 30) every plaque of a lifted card's free discards & the duel's lies on screen, or none is up", (t) => {
	t.mock.method(console, "warn", () => {});
	const SIZES = [[1920, 1080], [1440, 900], [1024, 768], [540, 1000], [700, 1000]], cases = promptCases();
	// THESE UNPINNED NARROW VIEWS SHOW UNDER 2.5 OF DESK BELOW THE HAND & NO OTHER CLEAR SPOT WIDE ENOUGH: A LIFTED CARD'S PROMPT LAYS NO PLAQUES & KEEPS ITS 2D BUTTONS
	// SINCE THE USER'S PICKED OPENING VIEW (2026-11-25: THE BOTTOM ON THE LEATHER EDGE) THE WIDE DESKTOP VIEWS TOO: UNDER 2.8 OF DESK BELOW THE HAND IS NO ROOM
	const noRoom = (within) => within.z1 - (HAND_Z + CARD_SIZE.h / 2) < 2.8;
	let views = 0, kept2D = 0;
	for (const [w, h] of SIZES) {
		for (const fov of [45, 30]) {
			for (const black of [false, true]) {
				const spot = openingCamera({ fov, width: w, height: h, angle: black ? Math.PI : 0 });
				if (!spot) { continue; } // NO OPENING SPOT: camera/index.js KEEPS ITS NORMAL VIEW
				views++;
				const cam = new THREE.PerspectiveCamera(fov, w / h, 0.1, 1000), room = new THREE.Group();
				room.rotation.y = black ? Math.PI : 0; // room.js turnRoom
				cam.position.set(spot.position.x, spot.position.y, spot.position.z);
				cam.lookAt(spot.target.x, spot.target.y, spot.target.z);
				const within = deskInView(cam, room);
				for (const [what, v, at, turned, ask] of cases) {
					if (turned !== black && at.square) { continue; } // A SQUARE'S ANCHOR IS FOR THE SIDE THE ROOM IS TURNED TO
					const list = S.promptButtons(ask, v, CATALOG).map(({ id, label }) => ({ id, label })), avoid = [BOARD_RECT, ...DESK_AVOID, ...footprints(v)];
					const where = `${what} @${w}x${h} fov ${fov}${black ? " black" : ""}`;
					if (at.card && noRoom(within)) { // THE TABLE ITSELF, ITS CARDS SET: NO PLAQUES, & showButtons false KEEPS flow.js's data-plaques OFF (THE 2D BUTTONS SHOW)
						const { room: r, table } = setup(undefined, () => within);
						table.set(v, { catalog: CATALOG });
						assert.equal(table.showButtons(list, plaqueAnchor(at, v, turned)), false, `${where}: plaques said up`);
						assert.equal(plaques(r).length, 0, `${where}: plaques laid`);
						kept2D++;
						continue;
					}
					const laid = buttonLayout(list, plaqueAnchor(at, v, turned), avoid, within);
					assert.ok(!laid.blocked, `${where}: blocked`);
					clear(laid, avoid);
					for (const p of laid) {
						for (const dx of [-1, 1]) for (const dz of [-1, 1]) for (const y of [DESK_Y, CARD_Y - 0.02 + 0.25]) {
							const q = room.localToWorld(new THREE.Vector3(p.x + dx * p.w / 2, y, p.z + dz * p.d / 2)).project(cam);
							assert.ok(Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1, `${where}: ${p.label} at ndc (${q.x.toFixed(2)}, ${q.y.toFixed(2)})`);
						}
					}
				}
			}
		}
	}
	assert.ok(views >= 16, `${views} opening views checked`);
	assert.ok(kept2D >= 4 * 8, `${kept2D} lifted-card prompts kept their 2D buttons`); // 2 VIEWS x 2 SIDES x 8 CARD CASES (n 5 & 6)
});

test("the plaques keep their place when the camera moves; a new prompt, or relayButtons (a resize), lays them inside the view then", () => {
	let rect = { x0: -12, x1: 12, z0: -40, z1: 30 };
	const { room, table } = setup(undefined, () => rect);
	const anchor = { x: -16, z: HAND_Z + CARD_SIZE.h / 2, side: "below" }; // AN EMPTY TABLE
	table.showButtons(LONG, anchor);
	assert.ok(inside(laidAt(room), rect), `inside the view: ${JSON.stringify(laidBoxes(room))}`);
	const before = plaques(room);
	rect = { x0: 0, x1: 40, z0: -40, z1: 32 }; // THE CAMERA MOVED
	table.showButtons(LONG, { ...anchor }); // THE SAME PROMPT AGAIN (flow.js showPrompt RUNS ON EVERY REFRESH)
	assert.deepEqual(plaques(room), before, "they don't chase the camera");
	table.relayButtons();
	assert.ok(before.every((m) => !room.children.includes(m)), "a resize lays them again");
	assert.ok(inside(laidAt(room), rect));
	rect = { x0: -30, x1: -2, z0: -40, z1: 32 };
	table.showButtons(LONG.slice(1), anchor); // ANOTHER PROMPT
	assert.ok(inside(laidAt(room), rect));
	table.showButtons([]);
	table.relayButtons();
	assert.equal(table.buttonCount(), 0, "nothing to lay again");
});

test("no clear place inside the view lays no plaques & says so (showButtons false: the 2D buttons stay); a resize or another prompt with room brings them back", (t) => {
	const warn = t.mock.method(console, "warn", () => {});
	const TINY = { x0: -2, x1: 2, z0: 24, z1: 25 }, ROOMY = { x0: -30, x1: 30, z0: -40, z1: 32 };
	let rect = TINY;
	const { room, table } = setup(undefined, () => rect);
	const anchor = { x: 0, z: 25, side: "below" };
	assert.equal(table.showButtons(LIST, anchor), false, "blocked in the view: none up");
	assert.equal(table.buttonCount(), 0);
	assert.equal(plaques(room).length, 0);
	assert.equal(table.showButtons(LIST, { ...anchor }), false);
	assert.equal(warn.mock.callCount(), 1, "warned once per rebuild");
	rect = ROOMY;
	assert.equal(table.showButtons(LIST, { ...anchor }), false, "the same prompt keeps its view (T23-24)");
	assert.equal(table.relayButtons(), true, "a resize with room: up");
	assert.equal(table.buttonCount(), 2);
	rect = TINY;
	assert.equal(table.relayButtons(), false, "a resize with none: taken away");
	assert.equal(plaques(room).length, 0);
	assert.equal(warn.mock.callCount(), 2);
	rect = ROOMY;
	assert.equal(table.showButtons(LONG.slice(2), anchor), true, "another prompt with room: up");
	assert.ok(inside(laidAt(room), rect));
	assert.equal(table.showButtons([]), false);
});

// GIVEN THE CAMERA, EVERY PLAQUE LAID (ITS MESH'S BOX, BEVEL INCLUDED, NOT ITS HIDDEN FOCUS FRAME, WHICH IS STILL AN OPEN QUESTION) PROJECTS INSIDE THE SCREEN, OR NONE IS UP
// & showButtons SAYS false (THE 2D BUTTONS SHOW). THE OPENING VIEW & A REVIEW'S ORBIT PROBE: IT ORBITED ABOUT ITS TARGET BEFORE THE PROMPT CAME UP
test("in the opening view & orbited about its target, a prompt's plaques lie on screen, or none is up", (t) => {
	t.mock.method(console, "warn", () => {});
	let seed = 23, up = 0, orbitedUp = 0, shown2D = 0;
	const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647), one = (a) => a[Math.floor(rnd() * a.length)], cases = promptCases(), UP = new THREE.Vector3(0, 1, 0);
	for (let i = 0; i < 300; i++) {
		const w = Math.round(500 + rnd() * 2600), h = Math.round(400 + rnd() * 1000), fov = one([45, 30]), black = rnd() < 0.5, az = one([0, 0, 15, -15, 30, -30, 45, -45, 60, -60]) * Math.PI / 180;
		const spot = openingCamera({ fov, width: w, height: h, angle: black ? Math.PI : 0 });
		if (!spot) { continue; }
		const cam = new THREE.PerspectiveCamera(fov, w / h, 0.1, 1000), target = new THREE.Vector3(spot.target.x, spot.target.y, spot.target.z);
		cam.position.set(spot.position.x, spot.position.y, spot.position.z).sub(target).applyAxisAngle(UP, az).add(target);
		cam.lookAt(target);
		const [what, v, at, , ask] = one(cases.filter((c) => !c[2].square || c[3] === black));
		const s = setup(undefined, () => deskInView(cam, s.room), cam);
		s.room.rotation.y = black ? Math.PI : 0; // room.js turnRoom
		s.table.set(v, { catalog: CATALOG });
		const said = s.table.showButtons(S.promptButtons(ask, v, CATALOG).map(({ id, label }) => ({ id, label })), plaqueAnchor(at, v, black));
		const where = `${what} @${w}x${h} fov ${fov}${black ? " black" : ""} orbited ${Math.round(az * 180 / Math.PI)}`;
		assert.equal(said, plaques(s.room).length > 0, `${where}: showButtons says what's up`);
		if (!said) { shown2D++; continue; }
		up++;
		if (az) { orbitedUp++; }
		s.room.updateMatrixWorld(true);
		for (const m of plaques(s.room)) {
			m.geometry.computeBoundingBox();
			const b = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
			for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
				const q = new THREE.Vector3(x, y, z).project(cam);
				assert.ok(Math.abs(q.x) <= 1 + 1e-6 && Math.abs(q.y) <= 1 + 1e-6, `${where}: ${m.userData.button} at ndc (${q.x.toFixed(3)}, ${q.y.toFixed(3)})`);
			}
		}
		s.table.dispose();
	}
	assert.ok(up >= 80 && orbitedUp >= 50 && shown2D > 0, `plaques up ${up} (orbited ${orbitedUp}), 2D ${shown2D}`); // NOT EVERY PROMPT SENT TO ITS 2D BUTTONS (80: THE USER'S CLOSER OPENING VIEW, 2026-11-25, LEAVES LESS DESK ON SCREEN)
});

// onScreen'S |z| <= 1 (IN FRONT OF THE CAMERA). A CAMERA LOOKING STRAIGHT AWAY FROM THE PLAQUES SEES THEIR CORNERS MIRRORED INSIDE |x|, |y| <= 1, BUT BEHIND IT
test("a camera looking away from where the plaques would lie lays none (the 2D buttons show); turned toward them, they're up", () => {
	const cam = new THREE.PerspectiveCamera(45, 1.6, 0.1, 1000), s = setup(undefined, () => ({ x0: -100, x1: 100, z0: -100, z1: 100 }), cam); // A VIEW THAT ALLOWS ANY LAYOUT: ONLY THE PROJECTION DECIDES
	cam.position.set(12, 2, 40);
	cam.lookAt(12, 2, 100); // AWAY FROM THE BOARD, THE PLAQUES ABOUT 48 BEHIND
	assert.equal(s.table.showButtons(LIST, { x: 10.5, z: -7.5, side: "right" }), false, "behind the camera: not up");
	assert.equal(plaques(s.room).length, 0);
	cam.lookAt(12, 0, -7.5);
	assert.equal(s.table.showButtons(LIST.slice(0, 1), { x: 10.5, z: -7.5, side: "right" }), true, "in front: up"); // ANOTHER PROMPT: A FRESH LAYOUT
});

test("a plaque on the baize lies on it; one off the baize lies on the desk, not floating", () => {
	const { room, table } = setup();
	const bottom = (m) => { m.geometry.computeBoundingBox(); return m.position.y + m.geometry.boundingBox.min.y; };
	table.showButtons(LIST, { x: 10.5, z: -7.5, side: "right" }); // BESIDE THE BOARD, ON THE BAIZE (x, z INSIDE ±21.2)
	for (const m of plaques(room)) { assert.ok(Math.abs(bottom(m) - (CARD_Y - 0.02)) < 1e-9, `on the baize: ${bottom(m)}`); }
	table.showButtons(LIST, { x: 0, z: 25, side: "below" }); // PAST THE BAIZE & ITS LEATHER EDGE (±22)
	assert.ok(plaques(room).every((m) => Math.abs(bottom(m) - DESK_Y) < 1e-9), `on the desk: ${plaques(room).map(bottom)}`);
	table.showButtons([{ id: "s", label: "Stop" }], { x: 0, z: 21.3, side: "below" }); // ON THE LEATHER EDGE (21.2 .. 22) ONLY
	assert.ok(Math.abs(bottom(plaques(room)[0]) - (DESK_Y + 0.1)) < 1e-9, `on the leather: ${bottom(plaques(room)[0])}`);
});
