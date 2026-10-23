/*
 *  index.js  --  chess frontend
 *	Home Page (/, signed in)
 *	The player's open games & the menu for new ones (Play AI at a level, Play Friends by email).
 *	Every game opens on its own page, /play/:gameId
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

import "../../../css/style.css"; // PAGE & MENU STYLES
const { ObjectId } = require("bson");
const { InternalAuth } = require("../../auth/index.js");
const { validate, getUserGameData, initMultiplayerGame, getLevels } = require("../../gameplay/validate/index.js");
const { SPRITES } = require("../../gameplay/sprites/index.js");
const { sizeMenu, showTable, warmImages } = require("../utils/index.js");

const CHESS_URL = "/api/chess"; // CHESS ROUTES LIVE ON THE EXPRESS SERVER (server/routes/api/chessRoutes.js)

const optBtn = document.getElementById("optBtn"); // GEAR BUTTON, OPENS THE MENU
const menu = document.getElementById("menuContainer");
const optNewSoloBtn = document.getElementById("optNewSolo"); // MENU: PLAY AI
const optNewMultiBtn = document.getElementById("optNewMulti"); // MENU: PLAY FRIENDS
const optExitBtn = document.getElementById("optExit"); // MENU: LOGOUT ("Back" WHILE THE FRIEND FORM IS OPEN)
const aiLevelSelect = document.getElementById("aiLevel"); // NEXT TO PLAY AI, FILLED FROM THE SERVER'S LEVELS
const muliplayerForm = document.getElementById("muliplayerForm");
const multiEmailBtn = document.getElementById("enterMultiSubmit");
const loadingDiv = document.getElementById("loadingDiv");
const gameList = document.getElementById("gameList");

const auth = new InternalAuth;
const sessionCheck = auth.getUser(); // STARTS CHECKING THE SESSION NOW INSTEAD OF AFTER THE PAGE LOADS

let PLAYER_ID;
let menuToggled = false;
let friendForm = false; // THE FRIEND EMAIL FORM IS OPEN

showTable();
sizeMenu();
window.addEventListener("resize", sizeMenu);

optBtn.addEventListener("click", handleMenuBtn);
optNewSoloBtn.addEventListener("click", handleNewSoloGame);
optNewMultiBtn.addEventListener("click", handleNewMultiGame);
multiEmailBtn.addEventListener("click", handleMultiSubmit);
optExitBtn.addEventListener("click", handleExit);

startHome();

/* ---------------------------------------------------------------- */
// Start Home
/* ---------------------------------------------------------------- */
/**
 * @description Gets the player, then fills the AI levels & the open games. Warms the play page's sprites last
 */
async function startHome() {
	const sessionUser = await sessionCheck;
	if (!sessionUser) { return auth.login(); } // THE SERVER ONLY SENDS HOME TO SIGNED IN PLAYERS, THIS CATCHES A SESSION THAT ENDED SINCE
	PLAYER_ID = sessionUser.userId.split("auth0|")[1];
	loadLevels();
	await loadGames();
	warmImages(SPRITES); // SO THE GAME OPENS FROM THE BROWSER CACHE
}


/* ---------------------------------------------------------------- */
// Open Games
/* ---------------------------------------------------------------- */
/**
 * @description Lists the player's open games, each one opens /play/:gameId. No games yet -> the menu opens so they can start one
 */
async function loadGames() {
	const gameData = await getUserGameData(CHESS_URL, PLAYER_ID);
	const openGames = JSON.parse(gameData?.open_games || "[]"); // NEW USERS HAVE NO GAMES YET
	loadingDiv.remove();
	for (let i = 0; i < openGames.length; i++) {
		const listElement = document.createElement("li");
		const gameBtn = document.createElement("button");
		gameBtn.innerText = openGames[i];
		gameBtn.addEventListener("click", function (e) {
			e.preventDefault();
			e.stopPropagation();
			window.location.href = `/play/${encodeURIComponent(openGames[i])}`;
		});
		listElement.append(gameBtn);
		gameList.append(listElement);
	}
	if (!openGames.length) { toggleMenu(true); } // NOTHING TO OPEN, NEW GAMES ARE IN THE MENU
}


/* ---------------------------------------------------------------- */
// Options Button
/* ---------------------------------------------------------------- */
/**
 * @description Opens or closes menu based on current menu state
 */
function handleMenuBtn(e) {
	e.preventDefault();
	e.stopPropagation();
	toggleMenu(!menuToggled);
}

function toggleMenu(open) {
	menuToggled = open;
	menu.style.display = open ? "flex" : "none";
}


/* ---------------------------------------------------------------- */
// Play AI (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description New game vs the AI at the picked level, then opens it. Your color is random
 */
async function handleNewSoloGame(e) {
	e.preventDefault();
	e.stopPropagation();
	let _id = new ObjectId();
	let startColor
	let randInt = Math.round(Math.random() * 1)
	if (randInt == 0) { startColor = 'w' }
	else { startColor = 'b' }
	const response = await validate(CHESS_URL, _id, PLAYER_ID, false, false, startColor, aiLevelSelect.value); // CREATE NEW GAME AT THE PICKED LEVEL
	if (response?.status != 200) { return console.log(response); }
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
// Play Friends (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description Opens the opponent email form, Logout becomes Back
 */
function handleNewMultiGame(e) {
	e.preventDefault();
	e.stopPropagation();
	showFriendForm(true);
}

function showFriendForm(open) {
	friendForm = open;
	muliplayerForm.style.display = open ? "flex" : "none";
	optNewSoloBtn.parentElement.style.display = open ? "none" : "";
	optNewMultiBtn.parentElement.style.display = open ? "none" : "";
	optExitBtn.innerHTML = open ? "Back" : "Logout";
}

function validateEmail(email) {
	return String(email).toLowerCase().match(
		/^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|.(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
	);
};

/**
 * @description New game vs a friend by email, then opens it. Stays on the form when there's no account for that email
 */
async function handleMultiSubmit(e) {
	e.preventDefault();
	e.stopPropagation();
	const email = document.getElementById("enterMultiEmail").value
	let _id = new ObjectId();
	if (validateEmail(email)) {
		try {
			const response = await initMultiplayerGame(CHESS_URL, _id, PLAYER_ID, email);
			console.log(response)
			if (response?.status != 200) { return; } // NO ACCOUNT FOR THAT EMAIL, STAY ON THE FORM
			window.location.href = `/play/${response.game_id}`;
		} catch (err) { console.log(err) }
	}
}


/* ---------------------------------------------------------------- */
// Exit Button (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description Logout, or "Back" out of the friend form
 */
function handleExit(e) {
	e.preventDefault();
	e.stopPropagation();
	if (friendForm) { return showFriendForm(false); }
	auth.logout();
}
