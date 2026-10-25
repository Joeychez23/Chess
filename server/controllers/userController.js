/*
 *  userController.js  --  chess server
 *	User Routes
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { updateUserSettings, deleteUser } = require("../dynamoDB.js");
const { leaveAllGames, readSettings, userPlayerId } = require("./chessController.js");

/* ---------------------------------------------------------------- */
// Get User
/* ---------------------------------------------------------------- */
/**
 * @description Returns the signed-in user from the access token (requireAuth runs first). Same response shape as the old user lambda
 * @return {[object]} response [{ status, userData, message }]
 */
function getUser(req, res) {
	return res.json({ status: 200, userData: req.user, message: "USER DATA FOUND" });
}

/* ---------------------------------------------------------------- */
// Save Settings (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description The settings page's Default start settings, Home's dropdowns start on them (GET /api/chess/user/:userId returns them)
 * @param  {[object]} req.body [{ ai_level, ai_color, friend_color }, anything that isn't a level or a color gets the default]
 * @return {[object]} response [{ status, settings (as saved), message }]
 */
async function saveSettings(req, res) {
	const settings = readSettings(req.body);
	const response = await updateUserSettings(userPlayerId(req.user), settings);
	return res.json({ status: response.status, settings, message: response.message });
}

/* ---------------------------------------------------------------- */
// Delete User Data (DELETE)
/* ---------------------------------------------------------------- */
/**
 * @description Delete my data (the settings page): leaves every game (forfeits, cancels & declines), then deletes the player's user_db row.
 * The Auth0 login isn't deleted, the client logs out after this
 * @return {[object]} response [{ status, message }]
 */
async function deleteUserData(req, res) {
	const playerId = userPlayerId(req.user);
	await leaveAllGames(playerId);
	const response = await deleteUser(playerId);
	return res.json({ status: response.status, message: response.message });
}


module.exports = { getUser, saveSettings, deleteUserData };
