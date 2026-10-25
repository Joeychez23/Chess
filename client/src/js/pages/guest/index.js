/*
 *  index.js  --  chess frontend
 *	Guest Page (/, signed out)
 *	The homepage for guests: Play as guest (/play) & Sign in. The links are plain <a>s, so this only runs the menu,
 *	preloads the play page's sprites, shows the guest's game in Play the AI & checks for a session that can be renewed
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

import "../../../css/nav.css"; // MENU (3 LINES, TOP RIGHT), COLORS & FONTS
import "../../../css/home.css"; // HOME PAGE STYLES
const { InternalAuth } = require("../../auth/index.js");
const { preloadImages } = require("../../gameplay/index.js");
const { validate } = require("../../gameplay/validate/index.js");
const { startNav, showCurrentGame } = require("../utils/index.js");

const CHESS_URL = "/api/chess"; // CHESS ROUTES LIVE ON THE EXPRESS SERVER (server/routes/api/chessRoutes.js)

const auth = new InternalAuth;

startNav();
preloadImages(); // THE GAME'S IMAGES, AS SOON AS THE PAGE OPENS, SO Play as guest OPENS FROM THE BROWSER CACHE
checkSession();
loadGuestGame();

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
// Guest Game
/* ---------------------------------------------------------------- */
/**
 * @description A guest has one AI game, its id is in localStorage (guestGameId() in pages/play/index.js). While it's open
 * its board & Continue current game go in Play the AI
 */
async function loadGuestGame() {
	let gameId;
	try { gameId = localStorage.getItem("GUEST_GAME_ID"); } catch (err) { } // STORAGE BLOCKED (PRIVATE MODE)
	if (!gameId) { return; } // NO GAME YET
	const game = await validate(CHESS_URL, gameId, gameId, false, false, false); // GET THE GAME, A GUEST'S PLAYER ID IS THEIR GAME ID
	if (game?.status != 200 || game.state != "OPEN") { return; } // EXPIRED OR OVER, Play as guest STARTS OR SHOWS IT
	showCurrentGame(document.getElementById("soloBox"), game, "/play");
}
