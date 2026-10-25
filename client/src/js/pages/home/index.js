/*
 *  index.js  --  chess frontend
 *	Home Page (/, signed in)
 *	Three boxes: Play the AI (at a level), Play a friend (by email) & the player's open games.
 *	A player has one AI game open at a time: Play the AI shows its board & Continue current game, & New game forfeits it (after a second press).
 *	Every game opens on its own page, /play/:gameId. Logout is in the menu (3 lines, top right)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

import "../../../css/nav.css"; // MENU (3 LINES, TOP RIGHT), COLORS & FONTS
import "../../../css/home.css"; // HOME PAGE STYLES
const { ObjectId } = require("bson");
const { InternalAuth } = require("../../auth/index.js");
const { validate, getUserGameData, initMultiplayerGame, getLevels } = require("../../gameplay/validate/index.js");
const { preloadImages } = require("../../gameplay/index.js");
const { startNav, showCurrentGame } = require("../utils/index.js");

const CHESS_URL = "/api/chess"; // CHESS ROUTES LIVE ON THE EXPRESS SERVER (server/routes/api/chessRoutes.js)

const signedInAs = document.getElementById("signedInAs"); // "SIGNED IN // EMAIL"
const welcome = document.getElementById("welcome"); // "WELCOME BACK, SCREENNAME"
const optNewSoloBtn = document.getElementById("optNewSolo"); // PLAY THE AI: PLAY AI, OR NEW GAME WHILE AN AI GAME IS OPEN
const aiLevelSelect = document.getElementById("aiLevel"); // NEXT TO PLAY AI, FILLED FROM THE SERVER'S LEVELS
const soloNote = document.getElementById("soloNote"); // NEW GAME: "THIS FORFEITS YOUR CURRENT GAME"
const muliplayerForm = document.getElementById("muliplayerForm"); // PLAY A FRIEND: EMAIL & INVITE
const multiEmailInput = document.getElementById("enterMultiEmail");
const multiEmailBtn = document.getElementById("enterMultiSubmit");
const multiNote = document.getElementById("multiNote"); // WHY AN INVITE DIDN'T GO THROUGH
const loadingDiv = document.getElementById("loadingDiv"); // "Loading...", THEN "No open games" IF THERE ARE NONE
const gameList = document.getElementById("gameList");

const auth = new InternalAuth;
const sessionCheck = auth.getUser(); // STARTS CHECKING THE SESSION NOW INSTEAD OF AFTER THE PAGE LOADS

let PLAYER_ID;
let CURRENT_GAME_ID = null; // THE PLAYER'S OPEN AI GAME (ONE AT A TIME)
let confirmNewGame = false; // NEW GAME NEEDS A SECOND PRESS WHILE AN AI GAME IS OPEN, IT FORFEITS THAT ONE

startNav();
preloadImages(); // THE GAME'S IMAGES, AS SOON AS THE PAGE OPENS, SO THE GAME OPENS FROM THE BROWSER CACHE
optNewSoloBtn.addEventListener("click", handleNewSoloGame);
muliplayerForm.addEventListener("submit", handleMultiSubmit); // INVITE BUTTON & ENTER IN THE EMAIL FIELD

startHome();

/* ---------------------------------------------------------------- */
// Start Home
/* ---------------------------------------------------------------- */
/**
 * @description Gets the player, then fills the AI levels & the open games
 */
async function startHome() {
	const sessionUser = await sessionCheck;
	if (!sessionUser) { return auth.login(); } // THE SERVER ONLY SENDS HOME TO SIGNED IN PLAYERS, THIS CATCHES A SESSION THAT ENDED SINCE
	PLAYER_ID = sessionUser.userId.split("auth0|")[1];
	if (sessionUser.screenname) { welcome.innerText = `Welcome back, ${sessionUser.screenname}`; }
	if (sessionUser.email) { signedInAs.innerText = `Signed in // ${sessionUser.email}`; }
	loadLevels();
	loadGames();
}


/* ---------------------------------------------------------------- */
// Your Games
/* ---------------------------------------------------------------- */
/**
 * @description Lists the player's open games, each one is a link to /play/:gameId. The AI game is marked "vs AI" & shown in Play the AI too
 */
async function loadGames() {
	const gameData = await getUserGameData(CHESS_URL, PLAYER_ID);
	const openGames = JSON.parse(gameData?.open_games || "[]"); // NEW USERS HAVE NO GAMES YET
	if (gameData?.ai_game_id) { loadCurrentGame(gameData.ai_game_id); }
	if (!openGames.length) { return loadingDiv.innerText = "No open games yet. Start one with the AI or a friend."; }
	loadingDiv.remove();
	for (let i = 0; i < openGames.length; i++) {
		const listElement = document.createElement("li");
		const gameLink = document.createElement("a");
		gameLink.href = `/play/${encodeURIComponent(openGames[i])}`;
		gameLink.innerHTML = `<span class="label">Game ${i + 1}</span><span class="spec gameId"></span><span class="label gameOpen">Open</span>`;
		gameLink.querySelector(".gameId").innerText = openGames[i] == gameData.ai_game_id ? `vs AI // ${openGames[i]}` : openGames[i]; // innerText, THE ID IS NEVER READ AS HTML
		listElement.append(gameLink);
		gameList.append(listElement);
	}
}


/* ---------------------------------------------------------------- */
// Current Game
/* ---------------------------------------------------------------- */
/**
 * @description The player's open AI game: its board & Continue current game go in Play the AI, & Play AI becomes New game
 * @param  {[string]} gameId [ai_game_id from the server]
 */
async function loadCurrentGame(gameId) {
	const game = await validate(CHESS_URL, gameId, PLAYER_ID, false, false, false); // GET THE GAME
	if (game?.status != 200 || game.state != "OPEN") { return; } // ENDED SINCE, PLAY AI STAYS AS IT IS
	CURRENT_GAME_ID = gameId;
	optNewSoloBtn.innerText = "New game";
	optNewSoloBtn.classList.replace("btnCream", "btnLine");
	await showCurrentGame(game, `/play/${encodeURIComponent(gameId)}`);
}


/* ---------------------------------------------------------------- */
// Play AI
/* ---------------------------------------------------------------- */
/**
 * @description New game vs the AI at the picked level, then opens it. Your color is random.
 * While an AI game is open the first press says it'll be forfeited, the second starts the new game (the server forfeits the open one)
 */
async function handleNewSoloGame(e) {
	e.preventDefault();
	e.stopPropagation();
	if (CURRENT_GAME_ID && !confirmNewGame) { // FIRST PRESS
		confirmNewGame = true;
		optNewSoloBtn.innerText = "Forfeit & start";
		return soloNote.innerText = "This forfeits your current game. Press again to start a new one.";
	}
	optNewSoloBtn.disabled = true; // ONE GAME PER PRESS
	soloNote.innerText = "";
	let _id = new ObjectId();
	let startColor
	let randInt = Math.round(Math.random() * 1)
	if (randInt == 0) { startColor = 'w' }
	else { startColor = 'b' }
	const response = await validate(CHESS_URL, _id, PLAYER_ID, false, false, startColor, aiLevelSelect.value, confirmNewGame); // CREATE NEW GAME AT THE PICKED LEVEL
	if (response?.status == 409) { // AN AI GAME OPENED SINCE (ANOTHER TAB): SHOW IT INSTEAD
		optNewSoloBtn.disabled = false;
		soloNote.innerText = "You already have an AI game open";
		return loadCurrentGame(response.game_id);
	}
	if (response?.status != 200) { optNewSoloBtn.disabled = false; return console.log(response); }
	window.location.href = `/play/${response.game_id}`;
}


/* ---------------------------------------------------------------- */
// AI Levels
/* ---------------------------------------------------------------- */
/**
 * @description Fills the dropdown next to Play AI with the server's levels & their approx Elo. The level is saved with the game,
 * so it only changes by starting a new game
 */
async function loadLevels() {
	const response = await getLevels(CHESS_URL);
	if (response?.status != 200) { return; } // NO LEVELS -> THE SERVER USES ITS DEFAULT
	for (let i = 0; i < response.levels.length; i++) {
		const option = document.createElement("option");
		option.value = response.levels[i].level;
		option.innerText = `Level ${response.levels[i].level} (${response.levels[i].elo})`;
		if (response.levels[i].level == response.default_level) { option.selected = true; }
		aiLevelSelect.append(option);
	}
}


/* ---------------------------------------------------------------- */
// Play a Friend
/* ---------------------------------------------------------------- */

function validateEmail(email) {
	return String(email).toLowerCase().match(
		/^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|.(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
	);
};

/**
 * @description New game vs a friend by email, then opens it. Stays on the form with a note when there's no account for that email
 */
async function handleMultiSubmit(e) {
	e.preventDefault();
	e.stopPropagation();
	const email = multiEmailInput.value.trim();
	if (!validateEmail(email)) { return multiNote.innerText = "Enter an email address"; }
	multiNote.innerText = "";
	multiEmailBtn.disabled = true; // ONE GAME PER PRESS
	let _id = new ObjectId();
	try {
		const response = await initMultiplayerGame(CHESS_URL, _id, PLAYER_ID, email);
		if (response?.status == 200) { return window.location.href = `/play/${response.game_id}`; }
		multiNote.innerText = response?.message == "Opponent not found" ? "No player has that email" : "Couldn't start the game, try again";
	} catch (err) { console.log(err); multiNote.innerText = "Couldn't start the game, try again"; }
	multiEmailBtn.disabled = false;
}
