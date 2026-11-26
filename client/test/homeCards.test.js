// TASK 25 F9: HOME'S CHESS CARDS BOX (C6: NO 3D, NO START; C7: THE 503 WHEN THE OPEN GAME COULDN'T BE CLOSED) & THE FINISHED-GAMES REASON (D16).
// HOME NEEDS ITS DOM AS IT LOADS, SO EACH FUNCTION'S SOURCE IS RUN ON STUBS (AS settingsUx.test.js DOES)
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../src/js/pages/home/index.js"), "utf8");
const body = (name) => new RegExp(`function ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}`).exec(source)[1];
const NO_3D = "Chess Cards needs 3D, which this device can't show.";
const NOT_CLOSED = "Your other game couldn't be closed. Try again.";

function blocked(webgl, coarse) {
	const window = { matchMedia: (q) => ({ matches: q === "(pointer: coarse)" && coarse }) };
	return new Function("hasWebGL", "window", body("cardsBlocked"))(() => webgl, window);
}

test("Chess Cards is blocked with no WebGL or on a touch-first device (can3D's media query), open with both", () => {
	assert.equal(blocked(false, false), true);
	assert.equal(blocked(true, true), true);
	assert.equal(blocked(false, true), true);
	assert.equal(blocked(true, false), false);
});

test("the start-up line disables Start with the no-3D text through cardsBlocked", () => {
	const line = source.split("\n").find((l) => l.includes("cardsBlocked()") && !l.includes("function"));
	assert.ok(line, "Home calls cardsBlocked() as it loads");
	assert.match(line, /optNewCardsBtn\.disabled = true/);
	assert.ok(line.includes(NO_3D));
	assert.ok(!/^\s*if \(!hasWebGL\(\)\)/m.test(source), "the WebGL-only check is gone");
});

const reasonLine = (r) => ({ king: "by taking the King", checkmate: "by Checkmate", timeout: "on time" })[r] || "";
const reasonText = (r) => new Function("reasonLine", "reason", body("reasonText"))(reasonLine, r);

test("the finished-games reason uses reasonLine, first letter upper case; the raw word only with no line", () => {
	assert.equal(reasonText("king"), " // By taking the King");
	assert.equal(reasonText("checkmate"), " // By Checkmate");
	assert.equal(reasonText("timeout"), " // On time");
	assert.equal(reasonText("forfeit"), " // Forfeit"); // NO LINE: TODAY'S RAW WORD
	assert.equal(reasonText(null), "");
	assert.equal(reasonText(""), "");
	assert.match(body("listFinishedGames"), /reasonText\(game\.reason\)/);
});

async function press(response, confirm = true, open = "g1") {
	const calls = [];
	const cardsNote = { innerText: "before" }, optNewCardsBtn = { innerText: "Forfeit & start" };
	const run = new Function("e", "CURRENT_GAME_ID", "confirmNewCards", "optNewCardsBtn", "cardsNote", "startLoading", "stopLoading", "newCardsGame", "CHESS_URL", "cardsColorSelect", "cardsLevelSelect", "loadCurrentGame", "goToPage",
		`return (async () => {${body("handleNewCardsGame")}\n})();`);
	await run({ preventDefault() {}, stopPropagation() {} }, open, confirm, optNewCardsBtn, cardsNote, () => calls.push("start"), () => calls.push("stop"),
		async () => response, "/api/chess", { value: "w" }, { value: "3" }, (id) => calls.push(`load:${id}`), (url) => calls.push(`go:${url}`));
	return { note: cardsNote.innerText, calls };
}

test("a 503 from newCardsGame shows the not-closed line under the box and leaves the page as it was", async () => {
	const { note, calls } = await press({ status: 503, message: NOT_CLOSED });
	assert.equal(note, NOT_CLOSED);
	assert.deepEqual(calls, ["start", "stop"]); // LOADING UNDONE, NO PAGE CHANGE, NO GAME LOADED
	assert.equal((await press({ status: 503 })).note, NOT_CLOSED); // THE TEXT IS HOME'S OWN, NOT ONLY THE SERVER'S
	assert.deepEqual((await press({ status: 200, game_id: "n1" })).calls, ["start", "go:/play/n1"]);
});

test("a 503 with no replace asked (the data service is down) is not the forfeit's: the plain line", async () => {
	const { note, calls } = await press({ status: 503, message: "Try again in a moment" }, false, null);
	assert.equal(note, "A new game couldn't be started. Try again.");
	assert.deepEqual(calls, ["start", "stop"]);
});

test("Play AI's 503 has the same two lines under its own box, as Chess Cards' does", () => {
	const line = source.split("\n").find((l) => l.includes("status == 503") && l.includes("soloNote"));
	assert.ok(line && line.includes(NOT_CLOSED) && line.includes("A new game couldn't be started. Try again.") && line.includes("confirmNewGame ?"));
});
