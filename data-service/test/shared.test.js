/*
 *  shared.test.js  --  data service tests
 *	Shared Files
 *  The chess server & the data service each have the move rules, the ratings & the username rules. They must stay the same file,
 *  and both must run the same chess.js, or the server would refuse (or allow) a move the data service doesn't
 *
 */

require("./helpers/env.js");
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const servicePackage = require("../package.json");
const serverPackage = require("../../server/package.json");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", "..", file), "utf8");

describe("files both have", () => {
	for (const name of ["validate.js", "rating.js", "username.js"]) {
		test(`data-service/utils/${name} is the same as server/utils/${name}`, () => {
			assert.equal(read(`data-service/utils/${name}`), read(`server/utils/${name}`), `change both copies of ${name}`);
		});
	}
});

describe("chess.js version", () => {
	test("the data service pins the same exact version as the server", () => {
		assert.match(servicePackage.dependencies["chess.js"], /^\d+\.\d+\.\d+$/, "data-service/package.json pins an exact version (no ^ or ~)");
		assert.equal(servicePackage.dependencies["chess.js"], serverPackage.dependencies["chess.js"]);
	});

	test("the data service runs the version it pins", () => {
		assert.equal(require("chess.js/package.json").version, servicePackage.dependencies["chess.js"]);
	});
});
