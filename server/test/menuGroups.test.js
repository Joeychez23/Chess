/*
 *  menuGroups.test.js  --  chess server tests
 *	Every page's menu (client/*.html): the groups, their order & no numbers on the buttons (nav.css)
 *
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const client = path.join(__dirname, "../../client");

/** The menu's groups: [[label, [every item's words or id]]] */
function menuGroups(page) {
	const html = fs.readFileSync(path.join(client, `${page}.html`), "utf8");
	const list = html.match(/<div id="menuButtonList">([\s\S]*?)<\/div>/)[1];
	return [...list.matchAll(/<ul role="group" aria-label="([^"]+)">([\s\S]*?)<\/ul>/g)].map(([, label, items]) => [
		label,
		[...items.matchAll(/<li[^>]*><(?:a|button)[^>]*>([^<]+)</g)].map((item) => item[1]),
	]);
}

describe("the menus' groups", () => {
	const expected = {
		play: [
			["Current game", ["Resume"]],
			["Game actions", ["Hint", "Takeback", "Offer Draw", "Type a Move"]],
			["View", ["Turn Sound: Off", "Flip Board", "Turn Eval Bar: On", "Download PGN"]],
			["End the game", ["Restart", "Cancel"]],
			["Navigation", ["Home"]],
			["Account", ["Exit"]],
		],
		home: [
			["Current page", ["Home"]],
			["On this page", ["Invites", "Your games", "Finished games", "Friends"]],
			["Navigation", ["Settings"]],
			["Account", ["Logout"]],
		],
		guest: [
			["Current page", ["Home"]],
			["On this page", ["Play the AI"]],
			["Account", ["Login/Signup"]],
		],
		settings: [
			["Navigation", ["Home", "Settings"]],
			["Account", ["Logout"]],
		],
		login: [
			["Navigation", ["Home"]],
			["Account", ["Login/Signup"]],
		],
		signup: [
			["Navigation", ["Home"]],
			["Account", ["Login/Signup"]],
		],
	};

	for (const [page, groups] of Object.entries(expected)) {
		test(`${page} has its groups in order`, () => {
			assert.deepEqual(menuGroups(page), groups);
		});
	}
});

describe("the menu's styles", () => {
	const css = fs.readFileSync(path.join(client, "src/css/nav.css"), "utf8");

	test("the buttons have no numbers", () => {
		assert.doesNotMatch(css, /counter-(reset|increment)|counter\(|\.menuButton[^{]*::before/);
	});

	test("scrolling the menu doesn't scroll the page, & short screens get columns", () => {
		assert.match(css, /overscroll-behavior: contain/);
		assert.match(css, /@media \(max-height: 500px\)[\s\S]*column-count: 2/);
	});
});
