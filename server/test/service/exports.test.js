/*
 *  exports.test.js  --  chess server tests
 *	The files split into folders or sub-files (the card engine's turn/, Card Guy)
 *  A split answers with the same exports the one file had, keeps each piece of module state in one file,
 *  and no sub-file loads its parent (a cycle would hand back a half-built module)
 *
 */

require("../helpers/env.js");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../../..");

// The names a file declares at module level that can change after load: every `let`, and a Map, Set or WeakMap
function stateNames(source) {
	const names = [];
	for (const match of source.matchAll(/^(?:let (\w+)|(?:const|var) (\w+) = new (?:Map|Set|WeakMap)\()/gm)) { names.push(match[1] || match[2]); }
	return names;
}

// A split's sub-files: the files beside `parent` whose names start with `prefix` and a dot, so one added later is checked too
const subFilesOf = (parent, prefix) => fs.readdirSync(path.join(ROOT, path.dirname(parent)))
	.filter((name) => name.startsWith(`${prefix}.`)).map((name) => path.posix.join(path.dirname(parent), name));

// One split: `parent` is the file the others import through, `subFiles` are the private files beside it
function checkSplit(parent, subFiles, exportNames) {
	const parentPath = path.join(ROOT, parent);
	assert.deepEqual(Object.keys(require(parentPath)).sort(), exportNames, "the same exports as the one file had");
	assert.ok(subFiles.length > 0, "the file is split");

	const seen = new Map();
	for (const file of [parent, ...subFiles]) {
		const source = fs.readFileSync(path.join(ROOT, file), "utf8");
		for (const name of stateNames(source)) {
			assert.ok(!seen.has(name), `${name} is module state in both ${seen.get(name)} and ${file}`);
			seen.set(name, file);
		}
		if (file !== parent) {
			const up = path.relative(path.dirname(path.join(ROOT, file)), parentPath);
			assert.ok(!source.includes(`"./${up}"`) && !source.includes(`'./${up}'`), `${file} loads its parent ${up}`);
		}
	}
}

test("cards-engine/turn/ answers as turn.js did", () => {
	checkSplit("cards-engine/turn/index.js", subFilesOf("cards-engine/turn/index.js", "turn"),
		["PASSIVES", "PASSIVE_CHANCE", "act", "actionKey", "barKey", "endTurn", "isLegal", "legalActions", "noAction", "startTurn"]);
	assert.ok(!fs.existsSync(path.join(ROOT, "cards-engine/turn.js")), "turn.js is gone: one way in");
});

test("Card Guy's index answers as it did, with the guesses and the free discard in their own files", () => {
	checkSplit("server/utils/card-guy/index.js", subFilesOf("server/utils/card-guy/index.js", "cardGuy"),
		["MAX_EVALS", "cardGuyTurn", "evaluate", "otherColor", "scoreTurn"]);
});
