/*
 *  index.js  --  chess frontend
 *	Guest Page (/, signed out)
 *	For now only a Sign in button, the guest homepage comes later. The guest game (/play) still works, nothing links to it yet
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

import "../../../css/style.css"; // PAGE & MENU STYLES
const { InternalAuth } = require("../../auth/index.js");
const { SPRITES } = require("../../gameplay/sprites/index.js");
const { sizeMenu, showTable, warmImages } = require("../utils/index.js");

const menu = document.getElementById("menuContainer");
const optLoginBtn = document.getElementById("optLogin"); // MENU: SIGN IN

const auth = new InternalAuth;

showTable();
menu.style.display = "flex"; // THE MENU IS THE WHOLE PAGE FOR NOW
sizeMenu();
window.addEventListener("resize", sizeMenu);

optLoginBtn.addEventListener("click", function (e) {
	e.preventDefault();
	e.stopPropagation();
	auth.login();
});

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
	warmImages(SPRITES); // THE PLAY PAGE'S SPRITES, SO THE FIRST GAME AFTER SIGNING IN OPENS FROM THE BROWSER CACHE
}
