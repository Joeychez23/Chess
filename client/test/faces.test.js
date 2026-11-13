/*
 *  faces.test.js  --  chess frontend tests
 *	The CRT monitor's pixel faces (client/src/js/gameplay/three/faces.js): the table is data, so these check it holds together.
 *	Run with npm run test:client
 *
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { PARTS, FACES, GRID, cellsFor, nextStep, frameMs, mainFrame } = require("../src/js/gameplay/three/faces.js");

describe("face parts", () => {
	test("every part is a rectangle of # and .", () => {
		for (const [name, rows] of Object.entries(PARTS)) {
			assert.ok(rows.length > 0, name);
			for (const row of rows) {
				assert.equal(row.length, rows[0].length, `${name} is ragged`);
				assert.match(row, /^[#.]+$/, name);
			}
		}
	});
});

describe("faces", () => {
	test("the first version's faces are all there", () => {
		for (const name of ["neutral", "thinking", "happy", "sad", "angry", "won", "lost"]) { assert.ok(FACES[name], name); }
	});

	test("every frame names parts that exist and has a time", () => {
		for (const [name, face] of Object.entries(FACES)) {
			assert.ok(face.frames.length > 0, name);
			assert.match(face.colour, /^#[0-9a-f]{6}$/i, name);
			for (const frame of face.frames) {
				for (const slot of ["eyes", "mouth", "brows"]) {
					if (frame[slot] !== undefined) { assert.ok(PARTS[frame[slot]], `${name}: no part ${frame[slot]}`); }
				}
				assert.ok(frame.eyes && frame.mouth, `${name}: a frame needs eyes and a mouth`);
				assert.ok(frameMs(frame, () => 0) > 0 && frameMs(frame, () => 0.999) >= frameMs(frame, () => 0), name);
			}
		}
	});

	test("every then names a face that exists, and a face that doesn't loop goes somewhere", () => {
		for (const [name, face] of Object.entries(FACES)) {
			if (face.then !== undefined) { assert.ok(FACES[face.then], `${name}: then ${face.then}`); }
			if (!face.loop) { assert.ok(FACES[face.then ?? "neutral"], name); }
		}
	});

	test("every frame's lit cells fit the face area", () => {
		for (const [name, face] of Object.entries(FACES)) {
			for (const frame of face.frames) {
				const cells = cellsFor(frame);
				assert.ok(cells.length > 0, name);
				for (const [x, y] of cells) { assert.ok(x >= 0 && x < GRID.width && y >= 0 && y < GRID.height, `${name}: cell ${x},${y} is off the face`); }
			}
		}
	});

	test("the right eye mirrors the left, and look moves both eyes", () => {
		const ahead = cellsFor({ eyes: "eyesNeutral", mouth: "flat" });
		const xs = ahead.map(([x]) => x);
		assert.equal(Math.min(...xs) + Math.max(...xs), GRID.width - 1); // SYMMETRIC ABOUT THE MIDDLE
		const left = cellsFor({ eyes: "eyesNeutral", mouth: "flat", look: -1 });
		assert.equal(left.length, ahead.length);
		assert.equal(Math.min(...left.map(([x]) => x)), Math.min(...xs) - 1);
	});
});

describe("stepping through a face", () => {
	test("a looping face goes round", () => {
		const last = FACES.neutral.frames.length - 1;
		assert.deepEqual(nextStep("neutral", 0), { name: "neutral", index: 1 });
		assert.deepEqual(nextStep("neutral", last), { name: "neutral", index: 0 });
	});

	test("a reaction ends on its then face, neutral by default", () => {
		assert.deepEqual(nextStep("happy", FACES.happy.frames.length - 1), { name: "neutral", index: 0 });
		assert.deepEqual(nextStep("happy", FACES.happy.frames.length - 1, "thinking"), { name: "thinking", index: 0 }); // THE AI IS PICKING ITS MOVE
		assert.equal(nextStep("lost", FACES.lost.frames.length - 1).name, FACES.lost.then);
	});

	test("a lost game ends up sad and stays", () => {
		let step = { name: "lost", index: 0 };
		for (let i = 0; i < 20; i++) { step = nextStep(step.name, step.index); }
		assert.ok(FACES[step.name].loop);
		assert.ok(FACES[step.name].frames.some((frame) => frame.eyes === "eyesSad"));
	});

	test("a random time stays inside its range", () => {
		assert.equal(frameMs({ ms: 400 }), 400);
		assert.equal(frameMs({ ms: [3000, 7000] }, () => 0), 3000);
		assert.ok(frameMs({ ms: [3000, 7000] }, () => 0.9999) <= 7000);
	});

	test("the main frame is the face itself, not the blink into it", () => {
		assert.equal(mainFrame("happy").eyes, "eyesHappy");
		assert.equal(mainFrame("angry").brows, "browsAngry");
		assert.equal(mainFrame("neutral").eyes, "eyesNeutral");
	});
});
