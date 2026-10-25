/*
 *  index.js  --  chess frontend
 *	Play Page (/play, /play/:gameId)
 *	Starts the game on the canvas. The server picks this page (server/controllers/pageController.js), the game id
 *	comes from the url (signed in) or localStorage (guest). Home & Exit leave the page, so nothing has to be torn down.
 *	The menu (3 lines, top right) is the game's menu here, the game opens & closes it (handleMenuBtn in gameplay/index.js)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

import "../../../css/style.css"; // PLAY PAGE STYLES (CANVAS LAYOUT)
import "../../../css/nav.css"; // MENU (3 LINES, TOP RIGHT), COLORS & FONTS
const { renderCanvas, preloadImages } = require("../../gameplay/index.js");
const { validate, newAiGame } = require("../../gameplay/validate/index.js");
const { InternalAuth } = require("../../auth/index.js");
const { startNav, showTable, showPage, startLoading, goToPage } = require("../utils/index.js");
const { ObjectId } = require("bson");

const CHESS_URL = "/api/chess"; // CHESS ROUTES LIVE ON THE EXPRESS SERVER (server/routes/api/chessRoutes.js), SAME ORIGIN AS THE AUTH ROUTES
const TV_DEV = false; // TRUE = TV REMOTE CONTROLS (ARROW KEYS & ENTER) INSTEAD OF THE MOUSE

const resultDisplay = document.getElementById("resultDisplay");
const optResumeBtn = document.getElementById("optResume");
const optRestartBtn = document.getElementById("optRestart");
const optHomepageBtn = document.getElementById("optSettings");
const optExitBtn = document.getElementById("optExit");

const auth = new InternalAuth;
const gameId = decodeURIComponent(window.location.pathname.split("/")[2] || ""); // /play/:gameId, EMPTY ON A GUEST'S /play
const sessionCheck = auth.getUser(); // STARTS CHECKING THE SESSION NOW INSTEAD OF AFTER THE PAGE LOADS

preloadImages();
setTimeout(showPage, 8000); // THE BOARD ISN'T DRAWN YET (SERVER DOWN, A LONG FIRST AI MOVE): SHOW THE PAGE ANYWAY, NOT HOME FROZEN ON SCREEN
window.addEventListener("pageshow", function (e) { if (e.persisted) { window.location.reload(); } }); // BACK FROM HOME CAN SHOW THE GAME AS IT WAS LEFT (ITS RENDER LOOP STOPPED): LOAD IT AGAIN

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
		await newGuestGame(guestId);
		playerData = { GAME_URL: CHESS_URL, GAME_ID: guestId, PLAYER_ID: guestId }
	}
	playerData.TV_BOOL = TV_DEV; // TV CONDITIONAL
	playerData.SIGNED_IN = !!sessionUser; // EXIT: LOGOUT OR LOGIN, A NEW GAME ID GOES IN THE URL

	optExitBtn.innerHTML = sessionUser ? "Logout" : "Sign in"; // HOME IS FOR EVERYONE, GUESTS HAVE A HOMEPAGE TOO

	renderCanvas(playerData);
}, false);


/* ---------------------------------------------------------------- */
// Guest Game
/* ---------------------------------------------------------------- */
/**
 * @description Each guest gets their own game vs the AI, its id is saved in localStorage so a reload opens it again
 * (the guest page's Play AI saves it). None saved -> a new id, newGuestGame makes its game
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


/**
 * @description No game for the guest's id yet (a bare /play, or their game expired): a new game vs the AI with a random color
 * at the default level, made before the game starts. Otherwise setInitialData (gameplay/index.js) makes it & the guest is always white
 * @param  {[string]} gameId [the guest's game id, also their player id]
 */
async function newGuestGame(gameId) {
	const response = await validate(CHESS_URL, gameId, gameId, false, false, false); // GET THE GAME
	if (response?.game_board) { return; } // THEIR GAME IS THERE (OPEN OR OVER)
	await newAiGame(CHESS_URL, gameId, "random"); // IF THIS FAILS setInitialData STILL MAKES ONE (WHITE)
}


/* ---------------------------------------------------------------- */
// Game Not Found
/* ---------------------------------------------------------------- */
/**
 * @description The game in the url doesn't exist (expired or a bad link) or isn't the player's: the menu with Home & Logout.
 * The game never starts, so startNav() runs the menu button
 */
function gameNotFound() {
	showPage(); // NO BOARD TO WAIT FOR, SHOW THE MENU
	showTable();
	resultDisplay.innerHTML = "Game not found";
	optResumeBtn.parentElement.style.display = "none";
	optRestartBtn.parentElement.style.display = "none";
	optExitBtn.innerHTML = "Logout";
	optHomepageBtn.addEventListener("click", function () { startLoading(optHomepageBtn); goToPage("/"); }); // LOADING, THEN HOME (LIKE THE GAME'S HOME BUTTON)
	optExitBtn.addEventListener("click", function () { auth.logout(); });
	const toggleNav = startNav();
	toggleNav(true); // OPEN, THE TITLE SAYS WHAT HAPPENED
}
