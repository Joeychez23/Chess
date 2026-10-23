/*
 *  index.js  --  chess frontend
 *	Play Page (/play, /play/:gameId)
 *	Starts the game on the canvas. The server picks this page (server/controllers/pageController.js), the game id
 *	comes from the url (signed in) or localStorage (guest). Home & Exit leave the page, so nothing has to be torn down
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { renderCanvas, preloadImages } = require("../../gameplay/index.js");
const { validate } = require("../../gameplay/validate/index.js");
const { InternalAuth } = require("../../auth/index.js");
const { sizeMenu, showTable } = require("../utils/index.js");
const { ObjectId } = require("bson");

const CHESS_URL = "/api/chess"; // CHESS ROUTES LIVE ON THE EXPRESS SERVER (server/routes/api/chessRoutes.js), SAME ORIGIN AS THE AUTH ROUTES
const TV_DEV = false; // TRUE = TV REMOTE CONTROLS (ARROW KEYS & ENTER) INSTEAD OF THE MOUSE

const menu = document.getElementById("menuContainer");
const resultDisplay = document.getElementById("resultDisplay");
const optResumeBtn = document.getElementById("optResume");
const optRestartBtn = document.getElementById("optRestart");
const optHomepageBtn = document.getElementById("optSettings");
const optExitBtn = document.getElementById("optExit");

const auth = new InternalAuth;
const gameId = decodeURIComponent(window.location.pathname.split("/")[2] || ""); // /play/:gameId, EMPTY ON A GUEST'S /play
const sessionCheck = auth.getUser(); // STARTS CHECKING THE SESSION NOW INSTEAD OF AFTER THE PAGE LOADS

preloadImages();

/* ---------------------------------------------------------------- */
// Window Load
/* ---------------------------------------------------------------- */
/**
 * @description Finds the player & the game, sets up the menu, then starts renderCanvas()
 */
window.addEventListener("load", async function () {
	const sessionUser = await sessionCheck;
	if (gameId && !sessionUser) { return auth.login(window.location.pathname); } // SIGNED OUT ON A GAME LINK: LOGIN, THEN BACK HERE (THE SERVER USUALLY CATCHES THIS FIRST)
	if (!gameId && sessionUser) { return window.location.replace("/"); } // SIGNED IN PLAYERS PICK THEIR GAME ON HOME

	let playerData;
	if (sessionUser) {
		const playerId = sessionUser.userId.split("auth0|")[1];
		const response = await validate(CHESS_URL, gameId, playerId, false, false, false); // IS IT THEIR GAME?
		if (response?.status != 200) { return gameNotFound(); }
		playerData = { GAME_URL: CHESS_URL, GAME_ID: gameId, PLAYER_ID: playerId }
	} else {
		const guestId = guestGameId(); // A GUEST'S PLAYER ID IS THEIR GAME ID
		playerData = { GAME_URL: CHESS_URL, GAME_ID: guestId, PLAYER_ID: guestId }
	}
	playerData.TV_BOOL = TV_DEV; // TV CONDITIONAL
	playerData.SIGNED_IN = !!sessionUser; // EXIT: LOGOUT OR LOGIN, A NEW GAME ID GOES IN THE URL

	optHomepageBtn.parentElement.style.display = sessionUser ? "" : "none"; // HOME IS ONLY FOR SIGNED IN USERS
	optExitBtn.innerHTML = sessionUser ? "Logout" : "Login";

	renderCanvas(playerData);
}, false);


/* ---------------------------------------------------------------- */
// Guest Game
/* ---------------------------------------------------------------- */
/**
 * @description Each guest gets their own game vs the AI, its id is saved in localStorage so a reload opens it again.
 * None saved -> a new id. The server has no game for a new id (or an expired one), so setInitialData creates it (gameplay/index.js)
 * @return {[string]} gameId [also the guest's player id]
 */
function guestGameId() {
	let gameId;
	try { gameId = localStorage.getItem("GUEST_GAME_ID"); } catch (err) { } // STORAGE BLOCKED (PRIVATE MODE)
	if (!gameId) {
		gameId = `${new ObjectId()}`; // NEW GAME
		try { localStorage.setItem("GUEST_GAME_ID", gameId); } catch (err) { } // NOT SAVED -> A NEW GAME EACH LOAD
	}
	return gameId;
}


/* ---------------------------------------------------------------- */
// Game Not Found
/* ---------------------------------------------------------------- */
/**
 * @description The game in the url doesn't exist (expired or a bad link) or isn't the player's: the menu with Home & Logout
 */
function gameNotFound() {
	showTable();
	resultDisplay.innerHTML = "Game not found";
	optResumeBtn.parentElement.style.display = "none";
	optRestartBtn.parentElement.style.display = "none";
	optExitBtn.innerHTML = "Logout";
	optHomepageBtn.addEventListener("click", function () { window.location.href = "/"; });
	optExitBtn.addEventListener("click", function () { auth.logout(); });
	menu.style.display = "flex";
	sizeMenu();
	window.addEventListener("resize", sizeMenu);
}
