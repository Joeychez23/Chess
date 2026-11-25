// THE SETTINGS PAGE'S USER EXPERIENCE SAVE (pages/settings/index.js handleSaveUx, TASK 21 m2): THE PAGE NEEDS ITS DOM AS IT LOADS, SO THE HANDLER'S SOURCE IS RUN ON STUBS
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../src/js/pages/settings/index.js"), "utf8");
const body = /async function handleSaveUx\(e\) \{([\s\S]*?)\n\}/.exec(source)[1];

async function save(response) {
	const uxNote = { innerText: "x" }, saveUxBtn = { disabled: false };
	const run = new Function("e", "request", "uxNote", "saveUxBtn", "statusDisplaySelect", "USER_URL", `return (async () => {${body}\n})();`);
	await run({ preventDefault() {}, stopPropagation() {} }, async () => response, uxNote, saveUxBtn, { value: "badges" }, "/api/user");
	return uxNote.innerText;
}

test("m2: a 429 (one status display save per 5 minutes, shared with the in-game toggle) says it can be saved again in 5 minutes, not try again", async () => {
	const note = await save({ status: 429, message: "Too many status display changes, try again in 300 seconds" });
	assert.match(note, /saved again in 5 minutes/);
	assert.doesNotMatch(note, /try again/);
	assert.equal(await save({ status: 200 }), "Saved. Your next card game shows it.");
	assert.equal(await save({ status: 500 }), "Couldn't save, try again");
	assert.equal(await save(null), "Couldn't save, try again");
});
