// Owns the friends list: requests, rows & their actions, add, remove & challenge a friend
const { friendAction } = require("../../gameplay/validate/index.js");
import {
	friendRequests, sentRequests, friendList, noFriends, friendNote, USER_URL, refreshHome,
	addFriendInput, validateUsername, addFriendBtn, multiEmailInput, clearPlayerSearch,
} from "./index.js";
import { resetInviteBtn } from "./invites.js";

let confirmRemove = null; // The friend whose Remove was pressed once


/* ---------------------------------------------------------------- */
// Friends
/* ---------------------------------------------------------------- */
/**
 * @description Draws Friends: requests to the player (Accept & Decline), the ones they sent (Cancel), then their friends
 * (Challenge & Remove). A failed read keeps what's on screen
 * @param  {[object]} friendData [GET /api/user/friends response]
 */
export function loadFriends(friendData) {
	if (friendData?.status != 200) { return; }
	const { friends, sent, received } = friendData;
	drawFriendRows(friendRequests, received.map(requestRow));
	drawFriendRows(sentRequests, sent.map(sentRequestRow));
	drawFriendRows(friendList, friends.map(friendListRow));
	noFriends.hidden = Boolean(friends.length || sent.length || received.length);
}

/**
 * @description A request to the player: Accept & Decline
 * @param  {[object]} request [{ username }]
 * @return {[element]} row
 */
function requestRow({ username }) {
	return friendRow(`${username} wants to be friends`, "", [
		{ text: "Accept", cream: true, press: (button) => runFriendAction("accept", username, button) },
		{ text: "Decline", press: (button) => runFriendAction("decline", username, button) },
	]);
}

/**
 * @description A request the player sent: Cancel
 * @param  {[object]} request [{ username }]
 * @return {[element]} row
 */
function sentRequestRow({ username }) {
	return friendRow(`Request sent to ${username}`, "Waiting", [
		{ text: "Cancel", press: (button) => runFriendAction("cancel", username, button) },
	]);
}

/**
 * @description A friend, online or not: Challenge & Remove. A Remove pressed once still warns after a redraw
 * @param  {[object]} friend [{ username, online }]
 * @return {[element]} row
 */
function friendListRow({ username, online }) {
	return friendRow(username, online ? "Online" : "", [
		{ text: "Challenge", cream: true, press: () => challengeFriend(username) },
		{ text: confirmRemove == username ? "Press again" : "Remove", press: (button) => handleRemoveFriend(username, button) },
	]);
}

/**
 * @description Swaps a list's rows in one step, so a redraw never leaves it empty for a moment, & hides it when there are none
 */
function drawFriendRows(list, rows) {
	list.replaceChildren(...rows);
	list.hidden = !rows.length;
}

/**
 * @description One row of the Friends box
 * @param  {[string]} title [the row's name, innerText: a name is never read as HTML]
 * @param  {[string]} detail [the small text under it, "" = none]
 * @param  {[array]} buttons [{ text, cream (the main button), press(button) }]
 * @return {[element]} row [the list item]
 */
function friendRow(title, detail, buttons) {
	const listElement = document.createElement("li");
	listElement.innerHTML = `<span class="inviteText"><span class="label inviteName"></span><span class="spec inviteParams"></span></span><span class="inviteButtons"></span>`;
	listElement.querySelector(".inviteName").innerText = title;
	listElement.querySelector(".inviteParams").innerText = detail;
	listElement.querySelector(".inviteButtons").append(...buttons.map(rowButton));
	return listElement;
}

/**
 * @description One of a row's buttons
 * @param  {[object]} button [{ text, cream (the main button), press(button) }]
 * @return {[element]} button
 */
function rowButton({ text, cream, press }) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = `btn ${cream ? "btnCream" : "btnLine"}`;
	button.innerText = text;
	button.addEventListener("click", () => press(button));
	return button;
}

/**
 * @description Runs a friend action, then redraws Home. A refusal says why in the box
 * @param  {[string]} action ["request", "accept", "decline", "cancel" or "remove"]
 * @param  {[string]} username [their username]
 * @param  {[element]} button [off until the answer, one action per press]
 * @return {[boolean]} done [true when it saved]
 */
async function runFriendAction(action, username, button) {
	button.disabled = true;
	friendNote.innerText = "";
	const response = await friendAction(USER_URL, action, username);
	confirmRemove = null;
	await refreshHome();
	button.disabled = false;
	if (response?.status == 200) { return true; }
	friendNote.innerText = response?.status < 500 ? response.message : "Couldn't update your friends, try again";
	return false;
}

/**
 * @description Sends a friend request to the username typed in the box
 */
export async function handleAddFriend(e) {
	e.preventDefault();
	e.stopPropagation();
	const username = addFriendInput.value.trim();
	if (!validateUsername(username)) { return friendNote.innerText = "Enter a username"; }
	if (await runFriendAction("request", username, addFriendBtn)) { addFriendInput.value = ""; }
}

/**
 * @description Challenge: fills their username in the invite form, the player picks a color & presses Invite
 * @param  {[string]} username [the friend's username]
 */
function challengeFriend(username) {
	multiEmailInput.value = username;
	clearPlayerSearch();
	resetInviteBtn(); // A forfeit warning was about the last name, the next press warns again
	multiEmailInput.focus();
}

/**
 * @description Remove: only they can put it back by accepting a new request, so the first press says so & the second removes them
 * @param  {[string]} username [the friend's username]
 * @param  {[element]} button [their Remove button]
 */
function handleRemoveFriend(username, button) {
	if (confirmRemove != username) {
		friendList.querySelectorAll(".btnLine").forEach((other) => other.innerText = "Remove"); // One warning at a time
		confirmRemove = username;
		button.innerText = "Press again";
		return friendNote.innerText = `This removes ${username} from your friends. Press again to remove them.`;
	}
	return runFriendAction("remove", username, button);
}
