const { renderCanvas } = require("./gameplay/index.js");
// ENV

const main = document.querySelector("#main");

const optBtn = document.getElementById("optBtn");
const menu = document.getElementById("menuContainer");

const optResumeBtn = document.getElementById("optResume");
const optNewGameBtn = document.getElementById("optRestart");
const optHomepageBtn = document.getElementById("optSettings");
const optExitBtn = document.getElementById("optExit");
const multiEmailBtn = document.getElementById("enterMultiSubmit");

exitState = {
	button: null,
	nest: 0
};


const optNewSoloBtn = document.getElementById("optNewSolo")
const optNewMultiBtn = document.getElementById("optNewMulti");

const muliplayerForm = document.getElementById("muliplayerForm");

const { ObjectId } = require("bson");

let gameOpen;
let gameContainer

let newGameMenu = false;

let openCanvas;
let menuToggled = false;

const { validate, getUserGameData, initMultiplayerGame } = require('./gameplay/validate/index.js');

// Firefox (desktop & Android) has no location.ancestorOrigins, fall back to the embedding page's origin
const ancestorOrigins = window.location.ancestorOrigins || ((window.parent !== window && document.referrer) ? [new URL(document.referrer).origin] : []);
const parent = ancestorOrigins[0];
document.cookie = "cookieID=1; SameSite=None; Secure";


const TV_DEV = false;

// GAME STATE LISTENER
let playerData;

// /* ---------------------------------------------------------------- */
// // Window Load
// /* ---------------------------------------------------------------- */
// /**
//  * @description Start renderCanvas() function
//  */
window.addEventListener("load", function () {
	if (ancestorOrigins.length == 0) {
		playerData = { GAME_URL: process.env.CHESS_URL, GAME_ID: process.env.GAME_ID, PLAYER_ID: process.env.PLAYER_ID }
		window.postMessage({
			action: "start",          // Action key.
			receiptToken: "{receipt-token}", // Receipt validation token.
		})
	}
}, false);


const gameCenterActionsIn = { // An interface to match expected actions.
	userinfo: (data) => { // "userinfo" action handler.
		if (data?.chessUrl || false && data?.gameId || false && data?.userId || false) {
			// playerData = { GAME_URL: process.env.CHESS_URL, GAME_ID: process.env.GAME_ID, PLAYER_ID: process.env.PLAYER_ID }
			playerData = { GAME_URL: data.chessUrl, GAME_ID: data.gameId, PLAYER_ID: data.userId }
		} else {
			playerData = null;
		}
	},
	start: () => { // "start" action handler.
		if (playerData?.PLAYER_ID) { // Start a new full game.
			optNewGameBtn.innerHTML = "Restart"

			optBtn.removeEventListener("click", handleMenuBtn);
			optResumeBtn.removeEventListener("click", handleResume);
			optNewGameBtn.removeEventListener("click", handleNewGame);
			// optHomepageBtn.removeEventListener("click", handleHomepage);
			optExitBtn.removeEventListener("click", handleExit);

			optNewSoloBtn.removeEventListener("click", handleNewSoloGame);
			optNewMultiBtn.removeEventListener("click", handleNewMultiGame);

			multiEmailBtn.removeEventListener("click", handleMultiSubmit)

			optResumeBtn.parentElement.style.display = "block";
			optNewGameBtn.parentElement.style.display = "block";
			optHomepageBtn.parentElement.style.display = "block";

			optNewSoloBtn.parentElement.style.display = 'none'
			optNewMultiBtn.parentElement.style.display = 'none'

			muliplayerForm.style.display = 'none'

			optNewGameBtn.innerHTML = "Restart"
			optExitBtn.innerHTML = "Exit"

			// if (window.location.ancestorOrigins.length == 0 && parent) { optHomepageBtn.parentElement.style.display = "none"; }
			if (playerData?.PLAYER_ID != "LAKESIDE_GUEST_USER") { optHomepageBtn.innerText = "Home" }
			else { optHomepageBtn.innerText = "Sign-in" }


			playerData.TV_BOOL = TV_DEV; // TV CONDITIONAL

			openCanvas = renderCanvas(playerData);
		}
	},
	ready: (data, returnMessage) => {
		gameOpen = true;
		if (document.getElementById('gameContainer')) { document.getElementById('gameContainer').remove(); }
		main.width = window.innerWidth;
		main.height = window.innerHeight;
		if (ancestorOrigins.length != 0 && parent) {
			const { action, receiptToken } = data; // Return message handler for the current event.
			window.parent.postMessage({
				action: action,          // Action key.
				receiptToken: "{receipt-token}", // Receipt validation token.
			}, parent);
			console.log(`\n[CHESS] Message sent to ${parent}:  [action: ${action}]`);

			if (data.origin != this.origin) {
				const res = { action: "return", receiptToken: `${action}-${receiptToken}` }
				console.log(`\n[CHESS] Message sent to ${data.origin}:  [action: ${res.action}]`);
				returnMessage(res); // Invoke an expected action.
			}

		}
	},
	exit: (data, returnMessage) => {
		if (ancestorOrigins.length != 0 && parent) {
			const { action, receiptToken } = data; // Return message handler for the current event.
			window.parent.postMessage({
				action: action,          // Action key.
				receiptToken: "{receipt-token}", // Receipt validation token.
			}, parent);
			console.log(`\n[CHESS] Message sent to ${parent}:  [action: ${action}]`);
			if (data.origin != this.origin) {
				const res = { action: "return", receiptToken: `${action}-${receiptToken}` }
				console.log(`\n[CHESS] Message sent to ${data.origin}:  [action: ${res.action}]`);
				returnMessage(res); // Invoke an expected action.
			}
		}
	},
	home: async (data, returnMessage) => {
		if (document.getElementById("canvas")) {
			optBtn.addEventListener("click", handleMenuBtn);
			optResumeBtn.addEventListener("click", handleResume);
			optNewGameBtn.addEventListener("click", handleNewGame);
			optExitBtn.addEventListener("click", handleExit);

			optNewGameBtn.innerHTML = "New Game"
			optHomepageBtn.parentElement.style.display = 'none'

			openCanvas = null;
			gameOpen = false;

			document.getElementById("canvas").remove();
			gameContainer = document.createElement("div");
			gameContainer.id = "gameContainer";

			const gameList = document.createElement("li");
			gameList.id = "gameList"

			const loadingDiv = document.createElement('div');
			loadingDiv.id = "loadingDiv"
			loadingDiv.innerText = "Loading..."

			gameContainer.append(loadingDiv);
			gameContainer.append(gameList);
			main.append(gameContainer);
		}

		if (!gameOpen && data?.userInfo) {
			exitState = { button: null, nest: 0 };
			playerData.PLAYER_ID = data.userInfo.user_id.split("auth0|")[1]
			gameContainer.append(loadingDiv);
			gameContainer.append(gameList);
			main.append(gameContainer);

			const userData = await getUserGameData(playerData.GAME_URL, playerData.PLAYER_ID);

			if (document.getElementById("loadingDiv")) { document.getElementById("loadingDiv").remove(); }
			const openGames = JSON.parse(userData?.open_games);
			for (let i = 0; i < openGames.length; i++) {
				const listElement = document.createElement("ul");
				const listElementAnchor = document.createElement("button")
				listElementAnchor.innerHTML = openGames[i];
				listElementAnchor.addEventListener('click', function (e) {
					e.preventDefault();
					e.stopPropagation();
					gameOpen = true;
					if (document.getElementById('gameContainer')) {
						if (document.getElementById(gameList.id)) {
							document.getElementById(gameList.id).remove();
							const loadingDiv = document.createElement('div')
							loadingDiv.innerText = "Loading..."
							gameContainer.append(loadingDiv);
						}
						playerData = { GAME_URL: playerData.GAME_URL, GAME_ID: openGames[i], PLAYER_ID: playerData.PLAYER_ID }
						window.postMessage({
							action: "start",          // Action key.
							receiptToken: "{receipt-token}", // Receipt validation token.
						})
					}
				})
				listElement.append(listElementAnchor)
				gameList.append(listElement);
			}
			main.append(gameContainer);
		} else {
			window.parent.postMessage({
				action: "auth",          // Action key.
				receiptToken: "{receipt-token}", // Receipt validation token.
			}, parent);
		}

		main.width = window.innerWidth;
		main.height = window.innerHeight;

		main.style.backgroundRepeat = "repeat-y";
		main.style.backgroundImage = 'url("./images/board/table.webp")';
		main.style.backgroundSize = "cover";
		main.style.backgroundPosition = "center";
	}
};

/* ---------------------------------------------------------------- */
// Window Message
/* ---------------------------------------------------------------- */
/**
 * @description Listen to messages from the Sinclair Game Center.
 */
window.addEventListener("message", function (event) {
	if (event.origin != this.origin) {
		// console.log(`[CHESS] Message received from [CHESS]:  [action: ${event.data.action}]`);
		console.log(`[CHESS] Message received from ${event.origin}:  [action: ${event.data.action}]`);
	}
	if (!(event.data?.action in gameCenterActionsIn)) { return } // Unknown action.
	const returnMessage = (message) => { window.postMessage(message) }// Send the message receipt.
	gameCenterActionsIn[event.data.action](event.data, returnMessage);
}, false);



/* ---------------------------------------------------------------- */
// Options Button
/* ---------------------------------------------------------------- */
/**
 * @description Opens or closes menu based on current menu state
 */
// optBtn.addEventListener("click", handleMenuBtn);
function handleMenuBtn(e) {
	e.preventDefault();
	e.stopPropagation();
	menuToggled = !menuToggled;
	if (menuToggled) { menu.style.display = "flex" }
	else { menu.style.display = "none" }
}


/* ---------------------------------------------------------------- */
// Resume Button (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description Opens or closes menu based on current menu state
 */
function handleResume(e) {
	e.preventDefault();
	e.stopPropagation();
	menuToggled = !menuToggled;
	if (menuToggled) { menu.style.display = "flex" }
	else { menu.style.display = "none" }
}


/* ---------------------------------------------------------------- */
// New Game Button (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description
 */
async function handleNewGame(e) {
	e.preventDefault();
	e.stopPropagation();

	// VALIDATE USER EMAIL
	optExitBtn.innerHTML = "Back"

	optResumeBtn.parentElement.style.display = "none";
	optNewGameBtn.parentElement.style.display = "none";
	// optHomepageBtn.parentElement.style.display = "none";

	optNewSoloBtn.parentElement.style.display = 'block'
	optNewMultiBtn.parentElement.style.display = 'block'

	newGameMenu = true;

	exitState = {
		button: optNewGameBtn,
		nest: exitState.nest + 1
	};

	optNewSoloBtn.addEventListener("click", handleNewSoloGame)
	optNewMultiBtn.addEventListener("click", handleNewMultiGame)
}

async function handleNewSoloGame(e) {
	e.preventDefault();
	e.stopPropagation();
	let _id = new ObjectId();

	menu.style.display = "none"

	if (document.getElementById('gameContainer')) {
		if (document.getElementById(gameList.id)) {
			document.getElementById(gameList.id).remove();
			const loadingDiv = document.createElement('div')
			loadingDiv.innerText = "Loading..."
			gameContainer.append(loadingDiv);
		}
	}
	let startColor
	let randInt = Math.round(Math.random() * 1)
	if (randInt == 0) { startColor = 'w' }
	else { startColor = 'b' }
	try {
		await validate(playerData.GAME_URL, _id, playerData.PLAYER_ID, false, false, startColor); // CREATE NEW GAME
		playerData = { GAME_URL: playerData.GAME_URL, GAME_ID: _id, PLAYER_ID: playerData.PLAYER_ID }
		window.postMessage({
			action: "start",          // Action key.
			receiptToken: "{receipt-token}", // Receipt validation token.
		})
	} catch (err) {
		console.log(err)
	}
}



async function handleNewMultiGame(e) {
	if (multiEmailBtn.removeEventListener("click", handleMultiSubmit)) { multiEmailBtn.removeEventListener("click", handleMultiSubmit) }
	e.preventDefault();
	e.stopPropagation();
	muliplayerForm.style.display = "flex";
	optNewSoloBtn.parentElement.style.display = 'none'
	optNewMultiBtn.parentElement.style.display = 'none'
	multiEmailBtn.addEventListener("click", handleMultiSubmit)
	exitState = {
		button: optNewMultiBtn,
		nest: exitState.nest + 1
	};
}

function validateEmail(email) {
	return String(email).toLowerCase().match(
		/^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|.(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
	);
};


async function handleMultiSubmit(e) {
	e.preventDefault();
	e.stopPropagation();
	email = document.getElementById("enterMultiEmail").value
	let _id = new ObjectId();
	if (validateEmail(email)) {
		try {
			console.log(email)
			const response = await initMultiplayerGame(playerData.GAME_URL, _id, playerData.PLAYER_ID, email);
			console.log(response)
			GAME_ID = _id
			playerData = { GAME_URL: playerData.GAME_URL, GAME_ID: GAME_ID, PLAYER_ID: playerData.PLAYER_ID }
			window.postMessage({
				action: "start",          // Action key.
				receiptToken: "{receipt-token}", // Receipt validation token.
			})
		} catch (err) { console.log(err) }
	}
}


/* ---------------------------------------------------------------- */
// Exit Button (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description !NOTE: NOT WORKING 
 */
function handleExit(e) {
	e.preventDefault();
	e.stopPropagation();
	if (exitState.nest == 0) {
		window.postMessage({
			action: "exit",          // Action key.
			receiptToken: "{receipt-token}", // Receipt validation token.
		})
	} else {
		if (exitState.nest == 1) {
			optResumeBtn.parentElement.style.display = "block";
			optNewGameBtn.parentElement.style.display = "block";
			optNewSoloBtn.parentElement.style.display = 'none'
			optNewMultiBtn.parentElement.style.display = 'none'
			muliplayerForm.style.display = 'none'
			optExitBtn.innerHTML = "Exit"
			exitState.button = null;
			exitState.nest = exitState.nest - 1;
		} else {
			if (exitState.button == optNewMultiBtn) {
				optResumeBtn.parentElement.style.display = "none";
				optNewGameBtn.parentElement.style.display = "none";
				optNewSoloBtn.parentElement.style.display = 'block'
				optNewMultiBtn.parentElement.style.display = 'block'
				muliplayerForm.style.display = 'none'
				exitState.button = optNewGameBtn
			}
			exitState.nest = exitState.nest - 1;
		}
	}
}



// if ('serviceWorker' in navigator) {
// 	const wb = new Workbox('/src-sw.js');
// 	let registration;

// 	const showSkipWaitingPrompt = async (event) => {
// 		wb.addEventListener('controlling', () => { });
// 		const updateAccepted = true // Prompt user to update cached bundle data
// 		if (updateAccepted) {
// 			wb.messageSkipWaiting();
// 		}
// 	};

// 	wb.addEventListener('waiting', (event) => {
// 		showSkipWaitingPrompt(event);
// 		wb.unregister();
// 		window.location.reload();
// 	});
// 	wb.register();
// } else {
// 	console.error('Service worker unavaiable');
// }