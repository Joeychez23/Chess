/*
 *  index.js  --  chess frontend
 *	Guest Page (/, signed out)
 *	The homepage for guests: Play the AI (at a level & color, no account needed) & Sign in. Runs the menu, preloads the play page's sprites,
 *	shows the guest's game in Play the AI & checks for a session that can be renewed
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

import "../../../css/nav.css"; // MENU (3 LINES, TOP RIGHT), COLORS & FONTS
import "../../../css/home.css"; // HOME PAGE STYLES
const { InternalAuth } = require("../../auth/index.js");
const { preloadImages } = require("../../gameplay/images/index.js");
const { validate, newAiGame } = require("../../gameplay/validate/index.js");
const { startNav, showCurrentGame, loadLevels, startLoading, goToPage, stopLoading, startGameLinks, showPageWhenDrawn } = require("../utils/index.js");

const CHESS_URL = "/api/chess"; // CHESS ROUTES LIVE ON THE EXPRESS SERVER (server/routes/api/chessRoutes.js)

const soloBox = document.getElementById("soloBox"); // PLAY THE AI
const aiLevelSelect = document.getElementById("aiLevel"); // FILLED FROM THE SERVER'S LEVELS
const aiColorSelect = document.getElementById("aiColor"); // RANDOM, WHITE OR BLACK, RESTART KEEPS IT
const aiFenInput = document.getElementById("aiFen"); // START POSITION (FEN), BLANK = THE STANDARD POSITION, RESTART KEEPS IT
const soloNote = document.getElementById("soloNote"); // WHY A START POSITION CAN'T BE PLAYED
const optNewSoloBtn = document.getElementById("optNewSolo"); // PLAY AI, OR NEW GAME WHILE THE GUEST'S GAME IS OPEN
const loginNote = document.getElementById("loginNote"); // WHY SIGNING IN DIDN'T WORK

const LOGIN_FAILURES = { // ?login= FROM THE LOGIN CALLBACK (server/controllers/authController.js)
	failed: "Sign in didn't work, try again.",
	unavailable: "Sign in isn't working right now, try again in a moment."
};

const auth = new InternalAuth;

showLoginFailure();
startNav();
preloadImages(); // THE GAME'S IMAGES, AS SOON AS THE PAGE OPENS, SO THE GAME OPENS FROM THE BROWSER CACHE
startGameLinks(); // CONTINUE CURRENT GAME SAYS LOADING TOO
checkSession();
showPageWhenDrawn([loadLevels(CHESS_URL, aiLevelSelect), loadGuestGame()]); // FROM A GAME (ITS HOME BUTTON) THE GAME STAYS ON SCREEN UNTIL THESE ARE IN, THEN FADES INTO THIS PAGE
optNewSoloBtn.addEventListener("click", handleNewGuestGame);

/* ---------------------------------------------------------------- */
// Check Session
/* ---------------------------------------------------------------- */
/**
 * @description The server sends this page when there's no access token, which also happens once it expires (15 minutes).
 * getUser() re-ups the session with the refresh token, so a player who is still signed in goes Home without logging in again
 */
async function checkSession() {
	const sessionUser = await auth.getUser();
	if (sessionUser) { return window.location.replace("/"); } // THE NEW ACCESS TOKEN IS SET, THE SERVER SENDS HOME NOW
}

/* ---------------------------------------------------------------- */
// Login Failure
/* ---------------------------------------------------------------- */
/**
 * @description A failed login comes back here with ?login=failed or ?login=unavailable (#282). Says so under Sign in,
 * then drops it from the address so a reload doesn't say it again
 */
function showLoginFailure() {
	const url = new URL(window.location.href);
	const reason = url.searchParams.get("login");
	if (!reason) { return; }
	loginNote.innerText = LOGIN_FAILURES[reason] || LOGIN_FAILURES.failed;
	url.searchParams.delete("login");
	window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}

/* ---------------------------------------------------------------- */
// Guest Game
/* ---------------------------------------------------------------- */
/**
 * @description A guest has one AI game, its id is in localStorage (guestGameId() in pages/play/index.js). While it's open
 * its board & Continue current game go in Play the AI, & Play AI becomes New game
 */
async function loadGuestGame() {
	const gameId = savedGameId();
	if (!gameId) { return; } // NO GAME YET
	const game = await validate(CHESS_URL, gameId, gameId, false, false, false); // GET THE GAME, A GUEST'S PLAYER ID IS THEIR GAME ID
	if (game?.status != 200 || game.state != "OPEN") { return; } // EXPIRED OR OVER, PLAY AI STARTS A NEW ONE
	optNewSoloBtn.innerText = "New game";
	optNewSoloBtn.classList.replace("btnCream", "btnLine");
	await showCurrentGame(soloBox, game, "/play"); // ITS BOARD PICTURE IS DRAWN BEFORE THE PAGE SHOWS
}

/* ---------------------------------------------------------------- */
// Play AI
/* ---------------------------------------------------------------- */
/**
 * @description New game vs the AI at the picked level & color, then opens /play. A guest only has one game: it's reset to the new one
 * (the same saved id, the server overwrites it), so there's no forfeit warning. No saved id -> the server makes one & it's saved
 */
async function handleNewGuestGame(e) {
	e.preventDefault();
	e.stopPropagation();
	startLoading(optNewSoloBtn); // "Loading" & THE FILL, ONE GAME PER PRESS
	soloNote.innerText = "";
	const gameId = savedGameId() || undefined; // LEFT OUT: THE SERVER MAKES A NEW ID
	const response = await newAiGame(CHESS_URL, gameId, aiColorSelect.value, aiLevelSelect.value, false, aiFenInput.value); // CREATE OR RESET THE GUEST'S GAME
	if (response?.status == 400 || response?.status == 429) { stopLoading(); return soloNote.innerText = response.message; } // THE FEN CAN'T BE PLAYED, OR TOO MANY NEW GAMES: THEIR GAME WASN'T RESET
	if (response?.status != 200) { stopLoading(); return console.log(response); }
	try { localStorage.setItem("GUEST_GAME_ID", response.game_id); } catch { } // THE SERVER'S ID (A NEW ONE IF THE SAVED ID WAS ANOTHER BROWSER'S). NOT SAVED (PRIVATE MODE) -> THE PLAY PAGE MAKES ITS OWN GAME
	goToPage("/play"); // ONCE THE IMAGES ARE IN
}

/**
 * @description The guest's game id from localStorage (also their player id)
 * @return {[string]} gameId [null when there's none or storage is blocked]
 */
function savedGameId() {
	try { return localStorage.getItem("GUEST_GAME_ID"); } catch { return null; } // STORAGE BLOCKED (PRIVATE MODE)
}
