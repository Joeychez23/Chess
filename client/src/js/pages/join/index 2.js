/*
 *  index.js  --  chess frontend
 *	Join Page (/play/:gameId, a challenge link, signed in)
 *	Says who made the link & the color the seat plays, Join game takes the seat & opens the game. A friend game already open is forfeited after a second press.
 *	A link someone else got to first says the game is taken
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

import "../../../css/nav.css"; // MENU (3 LINES, TOP RIGHT), COLORS & FONTS
import "../../../css/home.css"; // THE SAME BOXES AS HOME
require("../utils/reportErrors.js").startErrorReports(); // BEFORE THE OTHER MODULES RUN, SO THEIR ERRORS ARE REPORTED TOO (#194)
const { InternalAuth } = require("../../auth/index.js");
const { getChallenge, joinChallenge } = require("../../gameplay/validate/index.js");
const { preloadImages } = require("../../gameplay/images/index.js");
const { startNav, startLogoutButtons, colorText, startLoading, goToPage, stopLoading, startGameLinks, showPageWhenDrawn } = require("../utils/index.js");

const CHESS_URL = "/api/chess"; // CHESS ROUTES (server/routes/api/chessRoutes.js)
const NOT_FOUND = "Game data not found"; // CANCELLED OR EXPIRED
const TAKEN = "This game is taken, someone else joined first.";
const GONE = "This link was cancelled or has expired.";

const signedInAs = document.getElementById("signedInAs"); // "SIGNED IN // EMAIL"
const joinText = document.getElementById("joinText"); // "BOB CHALLENGED YOU", OR WHY THE LINK CAN'T BE JOINED
const joinParams = document.getElementById("joinParams"); // "YOU PLAY BLACK (RANDOM)"
const joinBtn = document.getElementById("joinBtn");
const joinNote = document.getElementById("joinNote"); // THE FORFEIT WARNING, WHY A JOIN DIDN'T GO THROUGH

const auth = new InternalAuth;
const gameId = decodeURIComponent(window.location.pathname.split("/")[2] || ""); // /play/:gameId
let confirmJoin = false; // JOIN GAME NEEDS A SECOND PRESS WHILE A FRIEND GAME IS OPEN, IT FORFEITS THAT ONE

startNav();
startLogoutButtons(auth); // LOGOUT IN THE MENU IS A POST (#332)
preloadImages(); // THE LOADING FILL & goToPage() WAIT ON THESE, SO THE GAME OPENS FROM THE BROWSER CACHE
startGameLinks(); // BACK FROM THE GAME PUTS THE BUTTON BACK
joinBtn.addEventListener("click", handleJoin);
showPageWhenDrawn([loadChallenge()]);

/* ---------------------------------------------------------------- */
// Load
/* ---------------------------------------------------------------- */
/**
 * @description Fills the box from the server: who made the link & the seat's color, or why it can't be joined
 */
async function loadChallenge() {
	const sessionUser = await auth.getUser();
	if (!sessionUser) { return auth.login(window.location.pathname); } // THE SERVER ONLY SENDS THIS PAGE TO SIGNED IN PLAYERS, THIS CATCHES A SESSION THAT ENDED SINCE
	if (sessionUser.email) { signedInAs.innerText = `Signed in // ${sessionUser.email}`; }

	const challenge = await getChallenge(CHESS_URL, gameId);
	if (challenge?.status == 200 && !challenge.open) { return showClosed(TAKEN); }
	if (challenge?.message == NOT_FOUND) { return showClosed(GONE); }
	if (challenge?.status != 200) { return showClosed("Couldn't load this link, reload to try again."); }
	joinText.innerText = `${challenge.name || "A player"} challenged you to a game.`; // innerText, THE NAME IS NEVER READ AS HTML
	joinParams.innerText = colorText(challenge.player_color, challenge.start_params);
	joinBtn.hidden = false;
}

/**
 * @description The link can't be joined: says why & takes the button away
 * @param  {[string]} reason [the box's text]
 */
function showClosed(reason) {
	joinText.innerText = reason;
	joinParams.innerText = "";
	joinNote.innerText = "";
	joinBtn.hidden = true;
}

/* ---------------------------------------------------------------- */
// Join
/* ---------------------------------------------------------------- */
/**
 * @description Takes the seat & opens the game. While a friend game is open the first press's 409 says it'll be forfeited, the second press forfeits it & joins
 */
async function handleJoin(e) {
	e.preventDefault();
	e.stopPropagation();
	startLoading(joinBtn); // "Loading" & THE FILL, ONE GAME PER PRESS
	joinNote.innerText = "";
	const response = await joinChallenge(CHESS_URL, gameId, confirmJoin);
	if (response?.status == 200) { return goToPage(`/play/${encodeURIComponent(gameId)}`); } // ONCE THE IMAGES ARE IN
	stopLoading();
	if (response?.status == 409 && response.game_id) { // FIRST PRESS
		confirmJoin = true;
		joinBtn.innerText = "Forfeit & join";
		return joinNote.innerText = "This forfeits your open friend game, your opponent wins. Press again to join.";
	}
	if (response?.message == "Game is taken") { return showClosed(TAKEN); }
	if (response?.message == NOT_FOUND) { return showClosed(GONE); }
	if (response?.message == "They're in another game now") { return joinNote.innerText = "They're in another game now, try again later."; }
	joinNote.innerText = response?.status == 403 ? response.message : "Couldn't join, try again";
}
