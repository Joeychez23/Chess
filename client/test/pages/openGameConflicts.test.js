// HOME'S ANSWERS TO A 409: ONLY A 409 THAT CARRIES THE OPEN GAME'S game_id MEANS "ANOTHER GAME IS OPEN". A REFUSAL'S BODY
// SAYS ITS REAL STATUS (409 "Invite was already answered", "They're in another game now", "They already invited you",
// A SAVE CONFLICT), SO EACH OF THOSE KEEPS ITS OWN LINE. EACH FUNCTION'S SOURCE IS RUN ON STUBS (AS homeCards.test.js DOES)
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "../../src/js/pages/home", file), "utf8");
const home = read("index.js"), invites = read("invites.js");
const body = (source, name) => new RegExp(`function ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}`).exec(source)[1];
const EVENT = { preventDefault() {}, stopPropagation() {} };
const OPEN = "Friend game already open";

async function accept(response) {
	const calls = [], inviteNote = { innerText: "" };
	const run = new Function("e", "gameId", "acceptBtn", "FRIEND_GAME_ID", "confirmAccept", "inviteList", "inviteNote", "startLoading", "stopLoading", "acceptInvite", "CHESS_URL", "goToPage", "refreshHome",
		`return (async () => {${body(home, "handleAccept")}\n})();`);
	await run(EVENT, "g1", {}, null, null, {}, inviteNote, () => {}, () => {}, async () => response, "/api/chess", (url) => calls.push(`go:${url}`), async () => calls.push("refresh"));
	return inviteNote.innerText;
}

test("Accept: only the 409 with the open game's id says a friend game is open", async () => {
	assert.equal(await accept({ status: 409, game_id: "f1", message: OPEN }), "You already have a friend game open");
	assert.equal(await accept({ status: 409, message: "They're in another game now" }), "They're in another game now, the invite was removed");
	assert.equal(await accept({ status: 409, message: "Invite was already answered" }), "Couldn't accept, try again");
	assert.equal(await accept({ status: 404, message: "Invite not found" }), "That invite was cancelled");
});

async function newGame(name, response) {
	const calls = [], note = { innerText: "" };
	const run = new Function("e", "CURRENT_GAME_ID", "confirmNewGame", "confirmNewCards", "optNewSoloBtn", "optNewCardsBtn", "soloNote", "cardsNote", "startLoading", "stopLoading", "newAiGame", "newCardsGame", "CHESS_URL", "aiColorSelect", "aiLevelSelect", "aiFenInput", "cardsColorSelect", "cardsLevelSelect", "loadCurrentGame", "goToPage", "console",
		`return (async () => {${body(home, name)}\n})();`);
	const select = { value: "w" };
	await run(EVENT, null, false, false, {}, {}, note, note, () => {}, () => {}, async () => response, async () => response, "/api/chess", select, select, select, select, select,
		(id) => calls.push(`load:${id}`), (url) => calls.push(`go:${url}`), { log: () => calls.push("log") });
	return { note: note.innerText, calls };
}

test("Play AI & Chess Cards: a 409 without the open game's id loads no game", async () => {
	for (const name of ["handleNewSoloGame", "handleNewCardsGame"]) {
		assert.deepEqual((await newGame(name, { status: 409, game_id: "a1", message: "AI game already open" })).calls, ["load:a1"], name);
		assert.deepEqual((await newGame(name, { status: 409, message: "Game lists changed before the save: alice" })).calls, ["log"], name);
	}
});

async function invite(response) {
	const note = { innerText: "" };
	const run = new Function("e", "clearPlayerSearch", "multiEmailInput", "validateUsername", "FRIEND_GAME_ID", "confirmInvite", "multiNote", "multiEmailBtn", "initMultiplayerGame", "CHESS_URL", "PLAYER_ID", "friendColorSelect", "friendFenInput", "friendTakebacksSelect", "friendDaysSelect", "resetInviteBtn", "refreshHome", "inviteError",
		`return (async () => {${body(invites, "handleMultiSubmit")}\n})();`);
	const inviteError = new Function("response", body(invites, "inviteError"));
	await run(EVENT, () => {}, { value: "bob" }, () => true, null, false, note, {}, async () => response, "/api/chess", "alice", { value: "w" }, { value: "" }, { value: "0" }, { value: "" }, () => {}, async () => {}, inviteError);
	return note.innerText;
}

test("Invite: each refusal keeps its own line, only the open friend game's 409 says one is open", async () => {
	assert.equal(await invite({ status: 409, game_id: "f1", open: true, message: OPEN }), "You already have a friend game open");
	assert.equal(await invite({ status: 409, game_id: "f1", open: true, message: "A reworded message" }), "You already have a friend game open"); // THE FIELD SAYS IT, NOT THE TEXT
	assert.equal(await invite({ status: 409, game_id: "f1", message: OPEN }), "Couldn't send the invite, try again");
	assert.equal(await invite({ status: 409, game_id: "i1", message: "They already invited you" }), "They already invited you, accept it in Invites");
	assert.equal(await invite({ status: 400, message: "That's your username" }), "That's your username, invite a friend");
	assert.equal(await invite({ status: 404, message: "Opponent not found" }), "No player has that username");
	assert.equal(await invite({ status: 400, message: "start_fen can't be played" }), "start_fen can't be played");
	assert.equal(await invite({ status: 429, message: "Too many new games" }), "Too many new games");
	assert.equal(await invite({ status: 409, message: "Game lists changed before the save: alice" }), "Couldn't send the invite, try again");
});

async function challenge(response) {
	const note = { innerText: "" };
	const run = new Function("e", "FRIEND_GAME_ID", "confirmChallenge", "createChallengeBtn", "multiNote", "createChallenge", "CHESS_URL", "friendColorSelect", "friendFenInput", "friendTakebacksSelect", "friendDaysSelect", "resetInviteBtn", "refreshHome",
		`return (async () => {${body(invites, "handleCreateChallenge")}\n})();`);
	await run(EVENT, null, false, {}, note, async () => response, "/api/chess", { value: "w" }, { value: "" }, { value: "0" }, { value: "" }, () => {}, async () => {});
	return note.innerText;
}

test("Challenge link: a 409 without the open game's id is the plain failure", async () => {
	assert.equal(await challenge({ status: 409, game_id: "f1", message: OPEN }), "You already have a friend game open");
	assert.equal(await challenge({ status: 409, message: "Game lists changed before the save: alice" }), "Couldn't create the link, try again");
});
