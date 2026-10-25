/*
 *  index.js  --  chess frontend
 *	Home Page (/, signed in)
 *	Four boxes: Play the AI (at a level), Play a friend (by email), Invites (sent & received) & the player's open games.
 *	A player has one AI game & one friend game open at a time: each box shows its game's board & Continue current game,
 *	& starting another forfeits it (after a second press). Friend invites wait (PENDING) until the friend accepts them in Invites,
 *	the socket redraws Play a friend & Invites when one changes. Every game opens on its own page, /play/:gameId. Logout is in the menu (3 lines, top right)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

import "../../../css/nav.css"; // MENU (3 LINES, TOP RIGHT), COLORS & FONTS
import "../../../css/home.css"; // HOME PAGE STYLES
const { ObjectId } = require("bson");
const { InternalAuth } = require("../../auth/index.js");
const { validate, getUserGameData, initMultiplayerGame, acceptInvite, declineInvite, getLevels } = require("../../gameplay/validate/index.js");
const { preloadImages } = require("../../gameplay/index.js");
const { watchGames } = require("../../socket/index.js");
const { startNav, showCurrentGame, hideCurrentGame } = require("../utils/index.js");

const CHESS_URL = "/api/chess"; // CHESS ROUTES LIVE ON THE EXPRESS SERVER (server/routes/api/chessRoutes.js)

const signedInAs = document.getElementById("signedInAs"); // "SIGNED IN // EMAIL"
const welcome = document.getElementById("welcome"); // "WELCOME BACK, SCREENNAME"
const soloBox = document.getElementById("soloBox"); // PLAY THE AI
const optNewSoloBtn = document.getElementById("optNewSolo"); // PLAY THE AI: PLAY AI, OR NEW GAME WHILE AN AI GAME IS OPEN
const aiLevelSelect = document.getElementById("aiLevel"); // NEXT TO PLAY AI, FILLED FROM THE SERVER'S LEVELS
const soloNote = document.getElementById("soloNote"); // NEW GAME: "THIS FORFEITS YOUR CURRENT GAME"
const friendBox = document.getElementById("friendBox"); // PLAY A FRIEND
const muliplayerForm = document.getElementById("muliplayerForm"); // PLAY A FRIEND: EMAIL & INVITE
const multiEmailInput = document.getElementById("enterMultiEmail");
const multiEmailBtn = document.getElementById("enterMultiSubmit");
const multiNote = document.getElementById("multiNote"); // WHY AN INVITE DIDN'T GO THROUGH, INVITE'S FORFEIT WARNING
const noInvites = document.getElementById("noInvites"); // INVITES: "NO INVITES RIGHT NOW"
const inviteList = document.getElementById("inviteList"); // "BOB INVITED YOU", ACCEPT & DECLINE
const sentInvite = document.getElementById("sentInvite"); // "INVITE SENT TO BOB // WAITING" & CANCEL INVITE
const sentInviteText = document.getElementById("sentInviteText");
const cancelInviteBtn = document.getElementById("cancelInvite");
const inviteNote = document.getElementById("inviteNote"); // ACCEPT'S FORFEIT WARNING, WHY AN ACCEPT DIDN'T GO THROUGH
const loadingDiv = document.getElementById("loadingDiv"); // "Loading...", THEN "No open games" IF THERE ARE NONE
const gameList = document.getElementById("gameList");

const auth = new InternalAuth;
const sessionCheck = auth.getUser(); // STARTS CHECKING THE SESSION NOW INSTEAD OF AFTER THE PAGE LOADS

let PLAYER_ID;
let CURRENT_GAME_ID = null; // THE PLAYER'S OPEN AI GAME (ONE AT A TIME)
let confirmNewGame = false; // NEW GAME NEEDS A SECOND PRESS WHILE AN AI GAME IS OPEN, IT FORFEITS THAT ONE
let FRIEND_GAME_ID = null; // THE PLAYER'S OPEN FRIEND GAME (ONE AT A TIME)
let FRIEND_NAME = "Friend"; // ITS OPPONENT, FOR THE FORFEIT WARNINGS
let SENT_INVITE_ID = null; // THE PLAYER'S SENT INVITE (ONE AT A TIME)
let confirmInvite = false; // INVITE NEEDS A SECOND PRESS WHILE A FRIEND GAME IS OPEN, IT FORFEITS THAT ONE
let confirmAccept = null; // THE INVITE WHOSE ACCEPT WAS PRESSED ONCE WHILE A FRIEND GAME IS OPEN (SAME WARNING)
let homeDrawing = Promise.resolve(); // ONE REDRAW AT A TIME (refreshHome)

startNav();
preloadImages(); // THE GAME'S IMAGES, AS SOON AS THE PAGE OPENS, SO THE GAME OPENS FROM THE BROWSER CACHE
optNewSoloBtn.addEventListener("click", handleNewSoloGame);
muliplayerForm.addEventListener("submit", handleMultiSubmit); // INVITE BUTTON & ENTER IN THE EMAIL FIELD
cancelInviteBtn.addEventListener("click", handleCancelInvite);

startHome();

/* ---------------------------------------------------------------- */
// Start Home
/* ---------------------------------------------------------------- */
/**
 * @description Gets the player, then fills the AI levels, the boxes & the open games. The socket keeps Play a friend & Invites up to date
 */
async function startHome() {
	const sessionUser = await sessionCheck;
	if (!sessionUser) { return auth.login(); } // THE SERVER ONLY SENDS HOME TO SIGNED IN PLAYERS, THIS CATCHES A SESSION THAT ENDED SINCE
	PLAYER_ID = sessionUser.userId.split("auth0|")[1];
	if (sessionUser.screenname) { welcome.innerText = `Welcome back, ${sessionUser.screenname}`; }
	if (sessionUser.email) { signedInAs.innerText = `Signed in // ${sessionUser.email}`; }
	loadLevels();
	refreshHome(true);
	watchGames(refreshHome); // INVITES & FRIEND GAMES CHANGE WITHOUT A RELOAD
}

/**
 * @description Redraws Home from the server, one redraw at a time (the socket can send a few in a row)
 * @param  {[boolean]} firstLoad [true also loads the AI game, it only changes from this page]
 */
function refreshHome(firstLoad) {
	homeDrawing = homeDrawing.then(() => drawHome(firstLoad)).catch((err) => console.log(err));
	return homeDrawing;
}

async function drawHome(firstLoad) {
	const gameData = await getUserGameData(CHESS_URL, PLAYER_ID);
	const friendGame = await openGame(gameData?.friend_game_id);
	if (firstLoad && gameData?.ai_game_id) { loadCurrentGame(gameData.ai_game_id); }
	listGames(gameData, friendGame);
	loadInvites(gameData);
	await loadFriendBox(gameData, friendGame);
}

/**
 * @description GET a game, only if it's still going
 * @param  {[string]} gameId [ai_game_id or friend_game_id from the server]
 * @return {[object]} game [GET /api/chess/game/:gameId response, null when there's no id or it ended since]
 */
async function openGame(gameId) {
	if (!gameId) { return null; }
	const game = await validate(CHESS_URL, gameId, PLAYER_ID, false, false, false); // GET THE GAME
	if (game?.status != 200 || game.state != "OPEN") { return null; }
	return game;
}


/* ---------------------------------------------------------------- */
// Your Games
/* ---------------------------------------------------------------- */
/**
 * @description Lists the player's open games, each one is a link to /play/:gameId. The AI game is marked "vs AI" & the friend game "vs Bob",
 * they're also shown in their boxes
 * @param  {[object]} gameData [GET /api/chess/user/:userId response]
 * @param  {[object]} friendGame [the open friend game or null]
 */
function listGames(gameData, friendGame) {
	const openGames = JSON.parse(gameData?.open_games || "[]"); // NEW USERS HAVE NO GAMES YET
	gameList.replaceChildren(); // REDRAWN WHEN THE SOCKET SAYS A GAME CHANGED
	loadingDiv.hidden = openGames.length > 0;
	if (!openGames.length) { return loadingDiv.innerText = "No open games yet. Start one with the AI or a friend."; }
	for (let i = 0; i < openGames.length; i++) {
		const listElement = document.createElement("li");
		const gameLink = document.createElement("a");
		let gameLabel = openGames[i];
		if (openGames[i] == gameData.ai_game_id) { gameLabel = `vs AI // ${openGames[i]}`; }
		if (friendGame && openGames[i] == gameData.friend_game_id) { gameLabel = `vs ${friendGame.opponent_name || "Friend"} // ${openGames[i]}`; }
		gameLink.href = `/play/${encodeURIComponent(openGames[i])}`;
		gameLink.innerHTML = `<span class="label">Game ${i + 1}</span><span class="spec gameId"></span><span class="label gameOpen">Open</span>`;
		gameLink.querySelector(".gameId").innerText = gameLabel; // innerText, THE ID & NAME ARE NEVER READ AS HTML
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
	const game = await openGame(gameId);
	if (!game) { return; } // ENDED SINCE, PLAY AI STAYS AS IT IS
	CURRENT_GAME_ID = gameId;
	optNewSoloBtn.innerText = "New game";
	optNewSoloBtn.classList.replace("btnCream", "btnLine");
	await showCurrentGame(soloBox, game, `/play/${encodeURIComponent(gameId)}`);
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
/**
 * @description Draws Play a friend: the open friend game (board & Continue current game), then the email form.
 * While a friend game is open Invite turns into a line button, it forfeits that game
 * @param  {[object]} gameData [GET /api/chess/user/:userId response]
 * @param  {[object]} friendGame [the open friend game or null]
 */
async function loadFriendBox(gameData, friendGame) {
	const friendGameId = friendGame ? gameData.friend_game_id : null;
	if (friendGameId != FRIEND_GAME_ID) { // THE GAME A WARNING WAS ABOUT IS GONE
		resetInviteBtn();
		if (confirmAccept) { confirmAccept = null; inviteNote.innerText = ""; }
	}
	FRIEND_GAME_ID = friendGameId;
	FRIEND_NAME = friendGame?.opponent_name || "Friend";
	multiEmailBtn.classList.replace(FRIEND_GAME_ID ? "btnCream" : "btnLine", FRIEND_GAME_ID ? "btnLine" : "btnCream");

	if (friendGame) { await showCurrentGame(friendBox, friendGame, `/play/${encodeURIComponent(friendGameId)}`); }
	else { hideCurrentGame(friendBox); }
}

function validateEmail(email) {
	return String(email).toLowerCase().match(
		/^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|.(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
	);
};

/**
 * @description Invites a friend by email, they accept it on their Home. Stays here & the invite shows in Invites.
 * While a friend game is open the first press says it'll be forfeited, the second sends the invite (the server forfeits the open one)
 */
async function handleMultiSubmit(e) {
	e.preventDefault();
	e.stopPropagation();
	const email = multiEmailInput.value.trim();
	if (!validateEmail(email)) { return multiNote.innerText = "Enter an email address"; }
	if (FRIEND_GAME_ID && !confirmInvite) { // FIRST PRESS
		confirmInvite = true;
		multiEmailBtn.innerText = "Forfeit & invite";
		return multiNote.innerText = `This forfeits your game vs ${FRIEND_NAME}, they win. Press again to send the invite.`;
	}
	multiNote.innerText = "";
	multiEmailBtn.disabled = true; // ONE INVITE PER PRESS
	let _id = new ObjectId();
	try {
		const response = await initMultiplayerGame(CHESS_URL, _id, PLAYER_ID, email, confirmInvite);
		if (response?.status == 200) {
			multiEmailInput.value = "";
			resetInviteBtn();
			await refreshHome(); // SHOWS THE SENT INVITE IN INVITES
		} else if (response?.status == 409) { // A FRIEND GAME OPENED SINCE (ANOTHER TAB): SHOW IT INSTEAD
			await refreshHome();
			multiNote.innerText = "You already have a friend game open";
		} else {
			resetInviteBtn(); // NOTHING WAS FORFEITED, THE NEXT TRY WARNS AGAIN
			multiNote.innerText = inviteError(response?.message);
		}
	} catch (err) { console.log(err); resetInviteBtn(); multiNote.innerText = "Couldn't send the invite, try again"; }
	multiEmailBtn.disabled = false;
}

/**
 * @description Why an invite didn't go through, from the server's message
 */
function inviteError(message) {
	if (message == "Opponent not found") { return "No player has that email"; }
	if (message == "That's your email") { return "That's your email, invite a friend"; }
	if (message == "They already invited you") { return "They already invited you, accept it in Invites"; }
	return "Couldn't send the invite, try again";
}

function resetInviteBtn() {
	confirmInvite = false;
	multiEmailBtn.innerText = "Invite";
	multiNote.innerText = "";
}


/* ---------------------------------------------------------------- */
// Invites
/* ---------------------------------------------------------------- */
/**
 * @description Draws Invites: invites to the player (Accept & Decline), then their sent invite (Cancel invite)
 * @param  {[object]} gameData [GET /api/chess/user/:userId response]
 */
function loadInvites(gameData) {
	const received = gameData?.received_invites || [];
	listInvites(received);
	SENT_INVITE_ID = gameData?.sent_invite?.game_id || null;
	sentInviteText.innerText = `Invite sent to ${gameData?.sent_invite?.name || "your friend"} // Waiting`;
	sentInvite.hidden = !SENT_INVITE_ID;
	noInvites.hidden = Boolean(received.length || SENT_INVITE_ID);
}

/**
 * @description "Bob invited you" rows, each with Accept & Decline
 * @param  {[array]} invites [received_invites: [{ game_id, name }]]
 */
function listInvites(invites) {
	inviteList.replaceChildren();
	inviteList.hidden = !invites.length;
	for (let i = 0; i < invites.length; i++) {
		const listElement = document.createElement("li");
		listElement.innerHTML = `<span class="label inviteName"></span><span class="inviteButtons"><button class="btn btnCream" type="button">Accept</button><button class="btn btnLine" type="button">Decline</button></span>`;
		listElement.querySelector(".inviteName").innerText = `${invites[i].name || "A friend"} invited you`; // innerText, THE NAME IS NEVER READ AS HTML
		const [acceptBtn, declineBtn] = listElement.querySelectorAll("button");
		if (confirmAccept == invites[i].game_id) { acceptBtn.innerText = "Forfeit & accept"; } // STILL WARNING AFTER A REDRAW
		acceptBtn.addEventListener("click", (e) => handleAccept(e, invites[i].game_id, acceptBtn));
		declineBtn.addEventListener("click", (e) => handleDecline(e, invites[i].game_id, declineBtn));
		inviteList.append(listElement);
	}
}

/**
 * @description Starts an invited game & opens it. While a friend game is open the first press says it'll be forfeited
 */
async function handleAccept(e, gameId, acceptBtn) {
	e.preventDefault();
	e.stopPropagation();
	if (FRIEND_GAME_ID && confirmAccept != gameId) { // FIRST PRESS
		inviteList.querySelectorAll(".btnCream").forEach((btn) => btn.innerText = "Accept"); // ONE WARNING AT A TIME
		confirmAccept = gameId;
		acceptBtn.innerText = "Forfeit & accept";
		return inviteNote.innerText = `This forfeits your game vs ${FRIEND_NAME}, they win. Press again to accept.`;
	}
	acceptBtn.disabled = true; // ONE GAME PER PRESS
	inviteNote.innerText = "";
	const response = await acceptInvite(CHESS_URL, gameId, confirmAccept == gameId);
	if (response?.status == 200) { return window.location.href = `/play/${encodeURIComponent(gameId)}`; }
	await refreshHome(); // THE INVITE OR THE OPEN GAME CHANGED SINCE
	if (response?.status == 409) { inviteNote.innerText = "You already have a friend game open"; }
	else if (response?.message == "They're in another game now") { inviteNote.innerText = "They're in another game now, the invite was removed"; }
	else if (response?.message == "Invite not found") { inviteNote.innerText = "That invite was cancelled"; }
	else { inviteNote.innerText = "Couldn't accept, try again"; }
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
async function handleCancelInvite(e) {
	e.preventDefault();
	e.stopPropagation();
	if (!SENT_INVITE_ID) { return; }
	cancelInviteBtn.disabled = true;
	const response = await declineInvite(CHESS_URL, SENT_INVITE_ID);
	if (response?.status != 200) { console.log(response); }
	await refreshHome();
	cancelInviteBtn.disabled = false;
}
