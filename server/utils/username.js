/*
 *  username.js  --  chess server
 *	Usernames
 *  The name friends see on invites & games. Each one is unique ignoring case: claimUsername in dynamoDB.js saves a
 *  username#<name in lowercase> item in user_db next to the player's row, so only one player can hold it
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,20}$/; // 3 - 20 LETTERS, NUMBERS, _ OR -
const RESERVED = ["admin", "administrator", "moderator", "support", "system", "root", "stockfish", "chess", "chess_ai", "chess-ai", "ai", "computer", "guest", "guest_user", "friend", "you", "null", "undefined", "anonymous"]; // STAFF, THE AI, & WHAT THE PAGES SHOW IN PLACE OF A NAME ("Friend", "You")

/* ---------------------------------------------------------------- */
// Check Username
/* ---------------------------------------------------------------- */
/**
 * @description Checks a username a player picked (the settings page). Whether someone else has it is checked when it's saved (claimUsername)
 * @param  {[string]} value [the name as typed, spaces around it are dropped]
 * @return {[object]} result [{ username } when it can be used | { message } why it can't]
 */
function checkUsername(value) {
	const username = typeof value == "string" ? value.trim() : "";
	if (!USERNAME_PATTERN.test(username)) { return { message: "Usernames are 3 to 20 letters, numbers, _ or -" }; }
	if (RESERVED.includes(username.toLowerCase())) { return { message: "That username is reserved" }; }
	return { username };
}

/**
 * @description The user_db key that holds a username, the same for every way of writing it ("Joe", "joe" & "JOE")
 * @param  {[string]} username [a checked username]
 * @return {[string]} key ["username#joe"]
 */
function usernameKey(username) {
	return `username#${username.toLowerCase()}`;
}


module.exports = { checkUsername, usernameKey };
