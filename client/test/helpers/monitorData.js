/*
 *  monitorData.js  --  chess frontend tests
 *	Shared test data for the CRT monitor's channels: one full `data` object (base) & acts(), the five actions
 *
 */

const { defaults } = require("../../src/js/gameplay/three/monitor/prefs.js");

const LABELS = { hint: "HINT", takeback: "TAKEBACK", draw: "OFFER DRAW", restart: "RESTART", pgn: "DOWNLOAD PGN" };

// acts({ id: [shown, enabled] }): ALL FIVE ACTIONS IN ORDER, THE ONES NOT NAMED HIDDEN & OFF
function acts(spec = {}) {
	return Object.keys(LABELS).map((id) => {
		const [shown, enabled] = spec[id] || [false, false];
		return { id, label: LABELS[id], shown, enabled };
	});
}

const base = {
	ai: true, over: false, yourTurn: true, tv: false,
	result: "",
	moves: [{ number: 1, white: "e4", black: "e5" }, { number: 2, white: "Nf3", black: "Nc6" }, { number: 3, white: "Bb5", black: "" }],
	opening: { eco: "C60", name: "Ruy Lopez" },
	eval: { allowed: true, scores: [50, 54, null, 61], failed: false },
	actions: acts({ hint: [true, true], takeback: [true, true], draw: [true, true], restart: [true, true], pgn: [true, true] }),
	screen: { name: "Bob", status: "your move", picture: null, bars: false, face: { cells: [[11, 9], [28, 9], [18, 16]], colour: "#7fe0ff" } },
	prefs: defaults(),
	ui: {},
	frame: 0, reduce: false, zoomed: false,
};

module.exports = { base, acts };
