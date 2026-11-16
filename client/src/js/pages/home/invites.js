// Owns the friend box's invites: the invite form & challenge link, the invites list, decline & cancel
const { initMultiplayerGame, createChallenge, declineInvite } = require("../../gameplay/validate/index.js");
const { colorText } = require("../utils/index.js");
import { clearPlayerSearch, multiEmailInput, validateUsername, FRIEND_GAME_ID, multiNote, multiEmailBtn, FRIEND_NAME, CHESS_URL, PLAYER_ID, friendColorSelect, friendFenInput, friendTakebacksSelect, friendDaysSelect, refreshHome, createChallengeBtn, challengeLinkInput, inviteNote, sentInviteText, challengeLinkField, cancelInviteBtn, sentInvite, noInvites, inviteList, confirmAccept, handleAccept } from "./index.js";

let SENT_INVITE_ID = null; // THE PLAYER'S SENT INVITE (ONE AT A TIME)
let confirmInvite = false; // INVITE NEEDS A SECOND PRESS WHILE A FRIEND GAME IS OPEN, IT FORFEITS THAT ONE
let confirmChallenge = false; // CREATE CHALLENGE LINK NEEDS A SECOND PRESS WHILE A FRIEND GAME IS OPEN (SAME WARNING)

/**
 * @description Invites a friend by username with the picked color (Random is drawn now), they accept it on their Home. Stays here & the invite shows in Invites.
 * While a friend game is open the first press says it'll be forfeited, the second sends the invite (the server forfeits the open one)
 */
export async function handleMultiSubmit(e) {
	e.preventDefault();
	e.stopPropagation();
	clearPlayerSearch();
	const opponent = multiEmailInput.value.trim();
	if (!validateUsername(opponent)) { return multiNote.innerText = "Enter a username"; }
	if (FRIEND_GAME_ID && !confirmInvite) { // FIRST PRESS
		confirmInvite = true;
		multiEmailBtn.innerText = "Forfeit & invite";
		return multiNote.innerText = `This forfeits your game vs ${FRIEND_NAME}, they win. Press again to send the invite.`;
	}
	multiNote.innerText = "";
	multiEmailBtn.disabled = true; // ONE INVITE PER PRESS
	try {
		const response = await initMultiplayerGame(CHESS_URL, PLAYER_ID, opponent, confirmInvite, friendColorSelect.value, friendFenInput.value, Number(friendTakebacksSelect.value), Number(friendDaysSelect.value) || undefined);
		if (response?.status == 200) {
			multiEmailInput.value = "";
			friendFenInput.value = "";
			resetInviteBtn();
			await refreshHome(); // SHOWS THE SENT INVITE IN INVITES
		} else if (response?.status == 409) { // A FRIEND GAME OPENED SINCE (ANOTHER TAB): SHOW IT INSTEAD
			await refreshHome();
			multiNote.innerText = "You already have a friend game open";
		} else {
			resetInviteBtn(); // NOTHING WAS FORFEITED, THE NEXT TRY WARNS AGAIN
			multiNote.innerText = response?.status == 400 || response?.status == 429 ? response.message : inviteError(response?.message); // 400: THE FEN CAN'T BE PLAYED, 429: TOO MANY NEW GAMES
		}
	} catch (err) { console.log(err); resetInviteBtn(); multiNote.innerText = "Couldn't send the invite, try again"; }
	multiEmailBtn.disabled = false;
}

/**
 * @description Makes a challenge link with the picked start settings, it shows in Invites. While a friend game is open the first press says it'll be forfeited,
 * the second makes the link (the server forfeits the open one)
 */
export async function handleCreateChallenge(e) {
	e.preventDefault();
	e.stopPropagation();
	if (FRIEND_GAME_ID && !confirmChallenge) { // FIRST PRESS
		confirmChallenge = true;
		createChallengeBtn.innerText = "Forfeit & create link";
		return multiNote.innerText = `This forfeits your game vs ${FRIEND_NAME}, they win. Press again to create the link.`;
	}
	multiNote.innerText = "";
	createChallengeBtn.disabled = true; // ONE LINK PER PRESS
	const response = await createChallenge(CHESS_URL, confirmChallenge, friendColorSelect.value, friendFenInput.value, Number(friendTakebacksSelect.value), Number(friendDaysSelect.value) || undefined);
	if (response?.status == 200) {
		friendFenInput.value = "";
		resetInviteBtn();
		await refreshHome(); // SHOWS THE LINK IN INVITES
	} else if (response?.status == 409) { // A FRIEND GAME OPENED SINCE (ANOTHER TAB): SHOW IT INSTEAD
		await refreshHome();
		multiNote.innerText = "You already have a friend game open";
	} else {
		resetInviteBtn(); // NOTHING WAS FORFEITED, THE NEXT TRY WARNS AGAIN
		multiNote.innerText = response?.status == 400 || response?.status == 429 ? response.message : "Couldn't create the link, try again"; // 400: THE FEN CAN'T BE PLAYED, 429: TOO MANY NEW GAMES
	}
	createChallengeBtn.disabled = false;
}

/**
 * @description Copies the challenge link. Where the browser won't, the link is selected to copy by hand
 */
export async function handleCopyChallenge() {
	try {
		await navigator.clipboard.writeText(challengeLinkInput.value);
		inviteNote.innerText = "Link copied";
	} catch {
		challengeLinkInput.select();
		inviteNote.innerText = "Couldn't copy, the link is selected to copy by hand";
	}
}

/**
 * @description Why an invite didn't go through, from the server's message
 */
function inviteError(message) {
	if (message == "Opponent not found") { return "No player has that username"; }
	if (message == "That's your username") { return `${message}, invite a friend`; }
	if (message == "They already invited you") { return "They already invited you, accept it in Invites"; }
	return "Couldn't send the invite, try again";
}

/**
 * @description Puts the invite & challenge link buttons back: the next press warns about the forfeit again
 */
export function resetInviteBtn() {
	confirmInvite = false;
	multiEmailBtn.innerText = "Invite";
	confirmChallenge = false;
	createChallengeBtn.innerText = "Create challenge link";
	multiNote.innerText = "";
}


/* ---------------------------------------------------------------- */
// Invites
/* ---------------------------------------------------------------- */
/**
 * @description Draws Invites: invites to the player (Accept & Decline), then their sent invite (Cancel invite) or challenge link (Copy link & Cancel). Each one says the player's color
 * @param  {[object]} gameData [GET /api/chess/user/:userId response]
 */
export function loadInvites(gameData) {
	const received = gameData?.received_invites || [];
	const sent = gameData?.sent_invite;
	listInvites(received);
	SENT_INVITE_ID = sent?.game_id || null;
	const sentTo = sent?.open_seat ? "Challenge link" : `Invite sent to ${sent?.name || "your friend"}`;
	sentInviteText.innerText = sent ? `${sentTo} // ${colorText(sent.player_color, sent.start_params)} // Waiting` : "";
	challengeLinkField.hidden = !sent?.open_seat;
	challengeLinkInput.value = sent?.open_seat ? `${window.location.origin}/play/${encodeURIComponent(sent.game_id)}` : "";
	cancelInviteBtn.innerText = sent?.open_seat ? "Cancel" : "Cancel invite";
	sentInvite.hidden = !SENT_INVITE_ID;
	noInvites.hidden = Boolean(received.length || SENT_INVITE_ID);
}

/**
 * @description "Bob invited you // You play black (random)" rows, each with Accept & Decline
 * @param  {[array]} invites [received_invites: [{ game_id, name, player_color, start_params }]]
 */
function listInvites(invites) {
	const rows = [];
	for (let i = 0; i < invites.length; i++) {
		const listElement = document.createElement("li");
		listElement.innerHTML = `<span class="inviteText"><span class="label inviteName"></span><span class="spec inviteParams"></span></span><span class="inviteButtons"><button class="btn btnCream" type="button">Accept</button><button class="btn btnLine" type="button">Decline</button></span>`;
		listElement.querySelector(".inviteName").innerText = `${invites[i].name || "A friend"} invited you`; // innerText, THE NAME IS NEVER READ AS HTML
		listElement.querySelector(".inviteParams").innerText = colorText(invites[i].player_color, invites[i].start_params); // THE START SETTINGS THEY PICKED
		const [acceptBtn, declineBtn] = listElement.querySelectorAll("button");
		if (confirmAccept == invites[i].game_id) { acceptBtn.innerText = "Forfeit & accept"; } // STILL WARNING AFTER A REDRAW
		acceptBtn.addEventListener("click", (e) => handleAccept(e, invites[i].game_id, acceptBtn));
		declineBtn.addEventListener("click", (e) => handleDecline(e, invites[i].game_id, declineBtn));
		rows.push(listElement);
	}
	inviteList.replaceChildren(...rows); // BUILT FIRST, THEN SWAPPED IN ONE STEP (#240)
	inviteList.hidden = !invites.length;
}

/**
 * @description Declines an invite, the inviter's Home drops it too
 */
async function handleDecline(e, gameId, declineBtn) {
	e.preventDefault();
	e.stopPropagation();
	declineBtn.disabled = true;
	const response = await declineInvite(CHESS_URL, gameId);
	if (response?.status != 200) { console.log(response); }
	await refreshHome();
}

/**
 * @description Cancels the sent invite, the friend's Home drops it too
 */
export async function handleCancelInvite(e) {
	e.preventDefault();
	e.stopPropagation();
	if (!SENT_INVITE_ID) { return; }
	cancelInviteBtn.disabled = true;
	const response = await declineInvite(CHESS_URL, SENT_INVITE_ID);
	if (response?.status != 200) { console.log(response); }
	await refreshHome();
	cancelInviteBtn.disabled = false;
}
