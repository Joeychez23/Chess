/*
 *  index.js  --  chess frontend
 *	Play Page (/play, /play/:gameId)
 *	Starts the game on the canvas. The server picks this page (server/controllers/pageController.js), the game id
 *	comes from the url (signed in) or localStorage (guest). Home & Exit leave the page, so nothing has to be torn down.
 *	The menu (3 lines, top right) is the game's menu here, the game opens & closes it (handleMenuBtn in gameplay/menu/index.js)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

import "../../../css/style.css"; // PLAY PAGE STYLES (CANVAS LAYOUT)
import "../../../css/nav.css"; // MENU (3 LINES, TOP RIGHT), COLORS & FONTS
const { renderCanvas } = require("../../gameplay/index.js");
const { preloadImages } = require("../../gameplay/images/index.js");
const { validate, newAiGame, getRatings } = require("../../gameplay/validate/index.js");
const { InternalAuth } = require("../../auth/index.js");
const { startNav, showTable, showPage, startLoading, goToPage } = require("../utils/index.js");

const CHESS_URL = "/api/chess"; // CHESS ROUTES LIVE ON THE EXPRESS SERVER (server/routes/api/chessRoutes.js), SAME ORIGIN AS THE AUTH ROUTES
const TV_DEV = false; // TRUE = TV REMOTE CONTROLS (ARROW KEYS & ENTER) INSTEAD OF THE MOUSE

const resultDisplay = document.getElementById("resultDisplay");
const ratingDisplay = document.getElementById("ratingDisplay"); // FRIEND GAMES: BOTH PLAYERS' RATINGS UNDER THE TITLE
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
		if (!response.ai) { showRatings(gameId); } // NOT AWAITED, THE GAME DOESN'T WAIT FOR IT
		playerData = { GAME_URL: CHESS_URL, GAME_ID: gameId, PLAYER_ID: playerId }
	} else {
		const guestId = await newGuestGame(guestGameId()); // A GUEST'S PLAYER ID IS THEIR GAME ID
		if (!guestId) { return gameNotFound(); } // NO SAVED ID & THE SERVER COULDN'T MAKE A GAME
		playerData = { GAME_URL: CHESS_URL, GAME_ID: guestId, PLAYER_ID: guestId }
	}
	playerData.TV_BOOL = TV_DEV; // TV CONDITIONAL
	playerData.SIGNED_IN = !!sessionUser; // EXIT: LOGOUT OR LOGIN, A NEW GAME ID GOES IN THE URL

	optExitBtn.innerHTML = sessionUser ? "Logout" : "Sign in"; // HOME IS FOR EVERYONE, GUESTS HAVE A HOMEPAGE TOO

	renderCanvas(playerData);
}, false);


/* ---------------------------------------------------------------- */
// Ratings
/* ---------------------------------------------------------------- */
/**
 * @description Friend games: both players' ratings under the menu's title, "You 1520? // Bob 1480?" (? while provisional), and the
 * change once the game is over, "You 1532 (+12) // ...". Filled when the page loads (a Rematch keeps the line until the next load)
 * @param  {[string]} gameId [the friend game]
 */
async function showRatings(gameId) {
	const ratings = await getRatings(CHESS_URL, gameId);
	if (ratings?.status != 200 || !ratings.rated) { return; } // AI GAMES AREN'T RATED
	const text = (rating) => `${rating.rating}${rating.provisional ? "?" : ""}`; // 1520, OR 1520? WHILE PROVISIONAL
	const change = ratings.rating_change ? ratings.rating_change.after - ratings.rating_change.before : null;
	const changeText = change == null ? "" : ` (${change >= 0 ? "+" : "-"}${Math.abs(change)})`;
	ratingDisplay.innerText = `You ${text(ratings.player_rating)}${changeText} // ${ratings.opponent_name || "Opponent"} ${text(ratings.opponent_rating)}`;
	ratingDisplay.hidden = false;
}

/* ---------------------------------------------------------------- */
// Guest Game
/* ---------------------------------------------------------------- */
/**
 * @description Each guest gets their own game vs the AI, its id is saved in localStorage so a reload opens it again
 * (the guest page's Play AI saves it). None saved -> newGuestGame asks the server for a new game, which makes the id
 * @return {[string]} gameId [also the guest's player id, null when none is saved]
 */
function guestGameId() {
	try { return localStorage.getItem("GUEST_GAME_ID"); } catch { return null; } // STORAGE BLOCKED (PRIVATE MODE)
}


/**
 * @description No game for the guest's id yet (a bare /play, or their game expired): a new game vs the AI with a random color
 * at the default level, made before the game starts. Otherwise setInitialData (gameplay/moves/index.js) makes it & the guest is always white.
 * The server only lets the browser with the game's guest_game cookie play it, another guest's id (or one from before the cookie) gets a new id
 * @param  {[string]} gameId [the guest's saved game id, also their player id (null = none, the server makes one)]
 * @return {[string]} gameId [the id their game has, saved for the next load (null when there's none & the create failed)]
 */
async function newGuestGame(gameId) {
	if (gameId) {
		const response = await validate(CHESS_URL, gameId, gameId, false, false, false); // GET THE GAME
		if (response?.game_board) { return gameId; } // THEIR GAME IS THERE (OPEN OR OVER)
	}
	const created = await newAiGame(CHESS_URL, gameId || undefined, "random"); // IF THIS FAILS setInitialData STILL MAKES ONE (WHITE)
	if (!created?.game_id) { return gameId; }
	try { localStorage.setItem("GUEST_GAME_ID", created.game_id); } catch { } // NOT SAVED (PRIVATE MODE) -> A NEW GAME EACH LOAD
	return created.game_id;
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
