/*
 *  faces.js  --  chess frontend
 *	The CRT Monitor's Faces
 *	The pixel faces the monitor shows in AI games (three/screen.js draws them, gameplay/bots/index.js faceFor picks them). All data:
 *	a new expression is a new entry in FACES &, if it needs one, a new part in PARTS. The drawing code never changes for it.
 *	No DOM & no three.js here, so the tests load it in Node (client/test/faces.test.js)
 *
 */

/* ---------------------------------------------------------------- */
// Parts
/* ---------------------------------------------------------------- */

// PIXEL GRIDS, # LIT & . DARK. EYES & BROWS ARE THE LEFT ONE, THE RIGHT IS ITS MIRROR
const PARTS = {
	eyesHappy: [
		".###.",
		"#...#",
	],
	eyesNeutral: [
		"#####",
		"..#..",
		"..#..",
	],
	eyesSad: [
		"#...#",
		".###.",
	],
	eyesAngry: [
		".###.",
	],
	eyesBlink: [
		"#####",
	],
	browsAngry: [
		"##...",
	],
	smile: [
		"#.....#",
		".#####.",
	],
	flat: [
		".#####.",
	],
	frown: [
		".#####.",
		"#.....#",
	],
};

const CYAN = "#33d6e0";
const RED = "#e03030";
const BLINK_MS = 120; // AN IDLE BLINK
const INTO_MS = 150; // THE BLINK INTO & OUT OF A REACTION
const HOLD_MS = 2500; // HOW LONG A REACTION STAYS
const IDLE_MS = [3000, 7000]; // BETWEEN IDLE BLINKS, A RANDOM GAP SO IT'S NEVER A METRONOME

/* ---------------------------------------------------------------- */
// Faces
/* ---------------------------------------------------------------- */

const blink = (ms) => ({ eyes: "eyesBlink", mouth: "flat", ms });
const happy = { eyes: "eyesHappy", mouth: "smile" };
const sad = { eyes: "eyesSad", mouth: "frown" };
const angry = { brows: "browsAngry", eyes: "eyesAngry", mouth: "frown" };
const neutral = { eyes: "eyesNeutral", mouth: "flat" };

// A FACE: colour, frames ([{ eyes, mouth, brows, look, ms }], look MOVES THE EYES SIDEWAYS IN FACE PIXELS, ms IS A TIME OR A [MIN, MAX] RANGE),
// loop (THE FRAMES REPEAT: AN IDLE FACE) OR then (THE FACE AFTER THE LAST FRAME, neutral WHEN LEFT OUT), main (THE FRAME THAT IS THE FACE, SHOWN
// ALONE UNDER REDUCED MOTION: 0 WHEN LEFT OUT)
const FACES = {
	neutral: { colour: CYAN, loop: true, frames: [{ ...neutral, ms: IDLE_MS }, blink(BLINK_MS)] },
	thinking: { colour: CYAN, loop: true, frames: [{ ...neutral, ms: 400 }, { ...neutral, look: -1, ms: 400 }, { ...neutral, ms: 400 }, { ...neutral, look: 1, ms: 400 }] }, // WHILE THE AI MOVE REQUEST IS OUT
	happy: { colour: CYAN, main: 1, frames: [blink(INTO_MS), { ...happy, ms: HOLD_MS }, blink(INTO_MS)] },
	sad: { colour: CYAN, main: 1, frames: [blink(INTO_MS), { ...sad, ms: HOLD_MS }, blink(INTO_MS)] },
	angry: { colour: RED, main: 1, frames: [{ ...blink(INTO_MS), brows: "browsAngry" }, { ...angry, ms: HOLD_MS }, { ...blink(INTO_MS), brows: "browsAngry" }] },
	won: { colour: CYAN, then: "wonHeld", frames: [blink(INTO_MS)] }, // THE BOT WON: HAPPY UNTIL THE NEXT GAME, STILL BLINKING
	wonHeld: { colour: CYAN, loop: true, frames: [{ ...happy, ms: IDLE_MS }, { eyes: "eyesBlink", mouth: "smile", ms: BLINK_MS }] },
	lost: { colour: RED, main: 1, then: "lostHeld", frames: [{ ...blink(INTO_MS), brows: "browsAngry" }, { ...angry, ms: 1500 }, blink(INTO_MS)] }, // THE BOT LOST: ANGRY, THEN SAD UNTIL THE NEXT GAME
	lostHeld: { colour: CYAN, loop: true, frames: [{ ...sad, ms: IDLE_MS }, { eyes: "eyesBlink", mouth: "frown", ms: BLINK_MS }] },
};

/* ---------------------------------------------------------------- */
// Layout
/* ---------------------------------------------------------------- */

// THE FACE AREA IN FACE PIXELS (ONE IS 4 x 4 ON THE SCREEN'S 160 x 120 GRID): THE SCREEN ABOVE THE NAME STRIP
const GRID = { width: 40, height: 24 };
const EYE_X = 11; // THE LEFT EYE'S LEFT COLUMN, THE RIGHT EYE MIRRORS IT
const EYE_Y = 9; // THE ROW THE EYES ARE CENTERED ON
const BROW_Y = 7;
const MOUTH_Y = 16; // THE MOUTH'S TOP ROW

// A PART'S LIT CELLS WITH ITS TOP LEFT AT (x, y), mirror FLIPS IT LEFT TO RIGHT ABOUT THE FACE'S MIDDLE
function partCells(name, x, y, mirror) {
	const cells = [];
	PARTS[name].forEach(function (row, r) {
		[...row].forEach(function (c, i) {
			if (c === "#") { cells.push([mirror ? GRID.width - 1 - (x + i) : x + i, y + r]); }
		});
	});
	return cells;
}

/**
 * @description The lit face pixels of one frame
 * @param  {[object]} frame [{ eyes, mouth, brows, look }, part names from PARTS]
 * @return {[number[][]]} cells [[x, y] in face pixels, (0, 0) the face area's top left]
 */
function cellsFor(frame) {
	const look = frame.look || 0;
	const eyeTop = EYE_Y - Math.floor(PARTS[frame.eyes].length / 2);
	const cells = [...partCells(frame.eyes, EYE_X, eyeTop, false), ...partCells(frame.eyes, EYE_X, eyeTop, true)];
	if (frame.brows) { cells.push(...partCells(frame.brows, EYE_X, BROW_Y, false), ...partCells(frame.brows, EYE_X, BROW_Y, true)); }
	const moved = cells.map(([x, y]) => [x + look, y]); // BOTH EYES LOOK THE SAME WAY, THE MOUTH STAYS
	const mouth = PARTS[frame.mouth];
	return [...moved, ...partCells(frame.mouth, Math.floor((GRID.width - mouth[0].length) / 2), MOUTH_Y, false)];
}

/* ---------------------------------------------------------------- */
// Stepping
/* ---------------------------------------------------------------- */

/**
 * @description The step after a frame: the face's next frame, its first again when it loops, or the first frame of the face it ends on
 * @param  {[string]} name [a face in FACES]
 * @param  {[number]} index [the frame showing]
 * @param  {[string]} idle [the face a reaction with no then goes back to: "neutral", or "thinking" while the AI picks its move]
 * @return {[object]} { name, index }
 */
function nextStep(name, index, idle = "neutral") {
	const face = FACES[name];
	if (index + 1 < face.frames.length) { return { name, index: index + 1 }; }
	return { name: face.loop ? name : face.then ?? idle, index: 0 };
}

/**
 * @description How long a frame shows
 * @param  {[object]} frame [{ ms: a time, or [min, max] for a random one }]
 * @param  {[function]} random [0 - 1, Math.random]
 * @return {[number]} ms
 */
function frameMs(frame, random = Math.random) {
	return Array.isArray(frame.ms) ? frame.ms[0] + random() * (frame.ms[1] - frame.ms[0]) : frame.ms;
}

/**
 * @description The frame that is the face (not the blink into it), what reduced motion shows
 * @param  {[string]} name [a face in FACES]
 * @return {[object]} frame
 */
function mainFrame(name) {
	return FACES[name].frames[FACES[name].main ?? 0];
}

export { PARTS, FACES, GRID, cellsFor, nextStep, frameMs, mainFrame };
