/*
 *  index.js  --  chess frontend
 *	Guest Page (/, signed out)
 *	The homepage for guests: Play as guest (/play) & Sign in. The links are plain <a>s, so this only runs the menu,
 *	preloads the play page's sprites & checks for a session that can be renewed
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

import "../../../css/nav.css"; // MENU (3 LINES, TOP RIGHT), COLORS & FONTS
import "../../../css/home.css"; // HOME PAGE STYLES
const { InternalAuth } = require("../../auth/index.js");
const { preloadImages } = require("../../gameplay/index.js");
const { startNav } = require("../utils/index.js");

const auth = new InternalAuth;

startNav();
preloadImages(); // THE GAME'S IMAGES, AS SOON AS THE PAGE OPENS, SO Play as guest OPENS FROM THE BROWSER CACHE
checkSession();

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
