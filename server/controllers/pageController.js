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
const { retrieveGame, retrieveUser } = require("../dynamoDB.js");

const BUILD_DIR = path.join(__dirname, "../../client/dist"); // SAME FOLDER server/index.js SERVES THE BUNDLES FROM

/* ---------------------------------------------------------------- */
// Home Page
/* ---------------------------------------------------------------- */
/**
 * @description / -> home.html for signed in players, guest.html for guests. A signed in player without a username goes to /settings
 * to pick one first (friends see it on invites & games), the settings page comes back here once it's saved.
 * No access token can also mean it expired (the cookie lives as long as the token), so guest.html re-ups the session & reloads when it can
 */
async function homePage(req, res) {
	const sessionUser = readSessionUser(req);
	if (!sessionUser) { return sendPage(res, "guest.html"); }
	const response = await retrieveUser(sessionUser.user_id.split("auth0|")[1], true).catch(() => null); // CONSISTENT: THE SETTINGS PAGE COMES HERE RIGHT AFTER THE SAVE
	if (response && !response.user_data?.username) { return res.redirect("/settings"); } // A FAILED CHECK STILL SENDS HOME
	return sendPage(res, "home.html");
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
 * Whose game it is gets checked by the chess routes, the page only needs a signed in player.
 * A PENDING friend invite goes Home, it's accepted or declined there & the board only opens once it's accepted
 */
async function gamePage(req, res) {
	if (!readSessionUser(req)) { return res.redirect(`/api/auth/resume?returnTo=${encodeURIComponent(req.originalUrl)}`); }
	const response = await retrieveGame(req.params.gameId).catch(() => null); // A FAILED CHECK STILL SENDS THE PAGE
	if (response?.game_data?.state?.S == "PENDING") { return res.redirect("/"); }
	return sendPage(res, "play.html");
}

/* ---------------------------------------------------------------- */
// Settings Page
/* ---------------------------------------------------------------- */
/**
 * @description /settings -> a signed in player's account settings. Signed out (or the access token expired) -> /api/auth/resume,
 * which re-ups the session or logs in, then comes back here
 */
function settingsPage(req, res) {
	if (!readSessionUser(req)) { return res.redirect(`/api/auth/resume?returnTo=${encodeURIComponent("/settings")}`); }
	return sendPage(res, "settings.html");
}

/**
 * @description Sends a page from client/dist (max-age 0, so a new build shows up on the next load)
 */
function sendPage(res, page) {
	return res.sendFile(path.join(BUILD_DIR, page));
}


module.exports = { homePage, playPage, gamePage, settingsPage };
