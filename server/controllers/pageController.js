/*
 *  pageController.js  --  chess server
 *	Page Routes
 *  Sends the page (.html from client/dist) for the url. Signed in is the same access token cookie the api reads,
 *  so the client never has to work out which page it should be on
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const path = require("path");
const { readSessionUser } = require("../middleware/auth.js");

const BUILD_DIR = path.join(__dirname, "../../client/dist"); // SAME FOLDER server/index.js SERVES THE BUNDLES FROM

/* ---------------------------------------------------------------- */
// Home Page
/* ---------------------------------------------------------------- */
/**
 * @description / -> home.html for signed in players, guest.html for guests.
 * No access token can also mean it expired (the cookie lives as long as the token), so guest.html re-ups the session & reloads when it can
 */
function homePage(req, res) {
	return sendPage(res, readSessionUser(req) ? "home.html" : "guest.html");
}

/* ---------------------------------------------------------------- */
// Play Page
/* ---------------------------------------------------------------- */
/**
 * @description /play -> the guest's game. Signed in players pick their game on Home
 */
function playPage(req, res) {
	if (readSessionUser(req)) { return res.redirect("/"); }
	return sendPage(res, "play.html");
}

/* ---------------------------------------------------------------- */
// Game Page
/* ---------------------------------------------------------------- */
/**
 * @description /play/:gameId -> a signed in player's game. Signed out (or the access token expired) -> /api/auth/resume,
 * which re-ups the session with the refresh token (only sent to /api/auth) or logs in, then comes back here.
 * Whose game it is gets checked by the chess routes, the page only needs a signed in player
 */
function gamePage(req, res) {
	if (!readSessionUser(req)) { return res.redirect(`/api/auth/resume?returnTo=${encodeURIComponent(req.originalUrl)}`); }
	return sendPage(res, "play.html");
}

/**
 * @description Sends a page from client/dist (max-age 0, so a new build shows up on the next load)
 */
function sendPage(res, page) {
	return res.sendFile(path.join(BUILD_DIR, page));
}


module.exports = { homePage, playPage, gamePage };
