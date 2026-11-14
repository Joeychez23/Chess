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
			["Game actions", ["Hint", "Takeback", "Offer Draw", "Type a Move", "Monitor"]],
			["View", ["Turn Sound: Off", "Flip Board", "View: 3D", "Reset View", "Turn Eval Bar: On", "Download PGN"]],
			["End the game", ["Restart", "Cancel", "Replay"]],
			["Navigation", ["Home", "Settings"]],
			["Account", ["Exit"]],
			["Legal", ["Privacy", "Terms"]],
		],
		home: [
			["On this page", ["Invites", "Your games", "Finished games", "Friends"]],
			["Navigation", ["Settings"]],
			["Account", ["Logout"]],
			["Legal", ["Privacy", "Terms"]],
		],
		guest: [
			["On this page", ["Play the AI"]],
			["Account", ["Login/Signup"]],
			["Legal", ["Privacy", "Terms"]],
		],
		settings: [
			["Navigation", ["Home"]],
			["Account", ["Logout"]],
			["Legal", ["Privacy", "Terms"]],
		],
		login: [
			["Navigation", ["Home"]],
			["Legal", ["Privacy", "Terms"]],
		],
		signup: [
			["Navigation", ["Home"]],
			["Legal", ["Privacy", "Terms"]],
		],
		privacy: [
			["Navigation", ["Home"]],
			["Legal", ["Terms"]],
		],
		terms: [
			["Navigation", ["Home"]],
			["Legal", ["Privacy"]],
		],
	};

	for (const [page, groups] of Object.entries(expected)) {
		test(`${page} has its groups in order`, () => {
			assert.deepEqual(menuGroups(page), groups);
		});
	}
});

describe("the menus' labels & link types", () => {
	const read = (file) => fs.readFileSync(path.join(client, file), "utf8");

	test("Play's Home & Settings are links, Settings starts hidden", () => {
		const play = read("play.html");
		assert.match(play, /<li><a class="menuButton" id="optHome" href="\/">Home<\/a><\/li>/);
		assert.match(play, /<li hidden><a class="menuButton" id="optSettings" href="\/settings">Settings<\/a><\/li>/);
	});

	test("Play shows Settings to signed in players & says Login/Signup to guests", () => {
		const page = read("src/js/pages/play/index.js");
		assert.match(page, /optSettingsBtn\.parentElement\.hidden = !sessionUser/);
		assert.match(page, /sessionUser \? "Logout" : "Login\/Signup"/);
	});

	test("Home & Settings leave the game the same way, a new tab leaves it running", () => {
		assert.match(read("src/js/gameplay/index.js"), /optHomepageBtn\.addEventListener\("click", handleLeave\);\s+optSettingsBtn\.addEventListener\("click", handleLeave\);/);
		const handler = read("src/js/gameplay/menu/index.js").match(/export function handleLeave[\s\S]*?\n}/)[0];
		assert.ok(handler.indexOf("e.metaKey") < handler.indexOf("e.preventDefault"));
		assert.ok(handler.indexOf("e.metaKey") < handler.indexOf("stopFrames"));
		assert.match(handler, /stopFrames\(\);[\s\S]*leaveGame\(\);[\s\S]*cancelRematch[\s\S]*fillThenGo\(link, link\.href\)/);
	});

	const titles = { play: "Chess", join: "Join game", home: "Home", guest: "Home", settings: "Settings", login: "Login/Signup", signup: "Login/Signup", privacy: "Privacy", terms: "Terms" };
	for (const [page, title] of Object.entries(titles)) {
		test(`${page}'s menu is titled ${title} & has no item for the page it's on`, () => {
			const html = read(`${page}.html`);
			assert.equal(html.match(/<div id="resultDisplay">([^<]*)</)[1], title);
			assert.doesNotMatch(html, /aria-current/);
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
