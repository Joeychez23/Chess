/*
 *  index.js  --  chess frontend
 *	Settings Page (/settings, signed in)
 *	Five boxes: Account (the email you sign in with, games finished, Sign out), Default start settings (what Home's dropdowns start on),
 *	Friends & Closed games (placeholders for now) and Delete my data (forfeits & cancels everything, deletes the user_db row, then signs out)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

import "../../../css/nav.css"; // MENU (3 LINES, TOP RIGHT), COLORS & FONTS
import "../../../css/home.css"; // THE SAME BOXES AS HOME
const { InternalAuth } = require("../../auth/index.js");
const { getUserGameData, saveSettings, deleteUserData } = require("../../gameplay/validate/index.js");
const { startNav, loadLevels, showPageWhenDrawn } = require("../utils/index.js");

const CHESS_URL = "/api/chess"; // CHESS ROUTES (server/routes/api/chessRoutes.js), THE GAME LISTS & SAVED SETTINGS
const USER_URL = "/api/user"; // USER ROUTES (server/routes/api/userRoutes.js), SAVE SETTINGS & DELETE MY DATA

const signedInAs = document.getElementById("signedInAs"); // "SIGNED IN // EMAIL"
const accountEmail = document.getElementById("accountEmail"); // ACCOUNT: "YOU SIGN IN WITH EMAIL"
const gamesFinished = document.getElementById("gamesFinished"); // ACCOUNT: "GAMES FINISHED // 3"
const aiLevelSelect = document.getElementById("aiLevel"); // FILLED FROM THE SERVER'S LEVELS
const aiColorSelect = document.getElementById("aiColor"); // RANDOM, WHITE OR BLACK VS THE AI
const friendColorSelect = document.getElementById("friendColor"); // RANDOM, WHITE OR BLACK VS A FRIEND
const saveSettingsBtn = document.getElementById("saveSettings");
const settingsNote = document.getElementById("settingsNote"); // "SAVED", OR WHY IT WASN'T
const deleteDataBtn = document.getElementById("deleteData");
const deleteNote = document.getElementById("deleteNote"); // "PRESS AGAIN TO DELETE", OR WHY IT DIDN'T

const auth = new InternalAuth;
const sessionCheck = auth.getUser(); // STARTS CHECKING THE SESSION NOW INSTEAD OF AFTER THE PAGE LOADS

let confirmDelete = false; // DELETE MY DATA NEEDS A SECOND PRESS

startNav();
saveSettingsBtn.addEventListener("click", handleSaveSettings);
deleteDataBtn.addEventListener("click", handleDeleteData);

startSettings();

/* ---------------------------------------------------------------- */
// Start Settings
/* ---------------------------------------------------------------- */
/**
 * @description Gets the player, then fills the account box & the start settings from the server. Shows the page once they're in (showPageWhenDrawn)
 */
async function startSettings() {
	const sessionUser = await sessionCheck;
	if (!sessionUser) { return auth.login("/settings"); } // THE SERVER ONLY SENDS THIS PAGE TO SIGNED IN PLAYERS, THIS CATCHES A SESSION THAT ENDED SINCE
	const playerId = sessionUser.userId.split("auth0|")[1];
	if (sessionUser.email) {
		signedInAs.innerText = `Signed in // ${sessionUser.email}`;
		accountEmail.innerText = sessionUser.email;
	}
	const levelsLoaded = loadLevels(CHESS_URL, aiLevelSelect);
	showPageWhenDrawn([levelsLoaded, loadSettings(playerId, levelsLoaded)]);
}

/**
 * @description Puts the saved settings in the dropdowns & the games finished in the account box. A player who hasn't played yet has no row, the dropdowns keep their defaults
 * @param  {[string]} playerId [auth0 user id without "auth0|"]
 * @param  {[object]} levelsLoaded [loadLevels() promise, the level is picked once its options are there]
 */
async function loadSettings(playerId, levelsLoaded) {
	const gameData = await getUserGameData(CHESS_URL, playerId); // GET /api/chess/user/:userId: settings & games_finished
	await levelsLoaded;
	if (gameData?.status != 200) { return; } // NO ROW YET
	gamesFinished.innerText = `Games finished // ${gameData.games_finished}`;
	aiLevelSelect.value = `${gameData.settings.ai_level}`;
	aiColorSelect.value = gameData.settings.ai_color;
	friendColorSelect.value = gameData.settings.friend_color;
}

/* ---------------------------------------------------------------- */
// Save Settings
/* ---------------------------------------------------------------- */
/**
 * @description Saves the Default start settings (PUT /api/user/settings), Home's dropdowns start on them next time
 */
async function handleSaveSettings(e) {
	e.preventDefault();
	e.stopPropagation();
	saveSettingsBtn.disabled = true; // ONE SAVE PER PRESS
	settingsNote.innerText = "";
	const response = await saveSettings(USER_URL, { ai_level: aiLevelSelect.value, ai_color: aiColorSelect.value, friend_color: friendColorSelect.value });
	settingsNote.innerText = response?.status == 200 ? "Saved. Home starts on these now." : "Couldn't save, try again";
	saveSettingsBtn.disabled = false;
}

/* ---------------------------------------------------------------- */
// Delete My Data
/* ---------------------------------------------------------------- */
/**
 * @description First press warns, the second deletes (DELETE /api/user): the server forfeits the open games, cancels & declines the invites
 * & deletes the user_db row. Then it signs out (the server's logout also signs out of Auth0)
 */
async function handleDeleteData(e) {
	e.preventDefault();
	e.stopPropagation();
	if (!confirmDelete) { // FIRST PRESS
		confirmDelete = true;
		deleteDataBtn.innerText = "Press again to delete";
		deleteNote.innerText = "This forfeits your open games and can't be undone.";
		setTimeout(function () { // 5 SECONDS TO PRESS AGAIN, LIKE THE GAME'S FORFEIT
			if (!confirmDelete) { return; }
			confirmDelete = false;
			deleteDataBtn.innerText = "Delete my data";
			deleteNote.innerText = "";
		}, 5000);
		return;
	}
	confirmDelete = false;
	deleteDataBtn.disabled = true;
	deleteNote.innerText = "Deleting...";
	const response = await deleteUserData(USER_URL);
	if (response?.status != 200) {
		deleteDataBtn.disabled = false;
		deleteDataBtn.innerText = "Delete my data";
		return deleteNote.innerText = "Couldn't delete your data, try again";
	}
	auth.logout(); // /api/auth/logout, THEN BACK TO THE GUEST PAGE
}
