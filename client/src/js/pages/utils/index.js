/*
 *  index.js  --  chess frontend
 *	Page Utils
 *	Shared by the pages: the menu (on pages without the game), the table background, the current game in the Play the AI & Play a friend boxes,
 *	the AI level dropdown, how a game's start settings read ("You play white (random)") & the Loading button into a game
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { drawBoardPicture } = require("./boardPicture.js");
const { getLevels } = require("../../gameplay/validate/index.js");
const { imageProgress } = require("../../gameplay/index.js");

let loadingBtn = null; // THE BUTTON OR LINK THAT SAYS LOADING (ONE AT A TIME), stopLoading() PUTS IT BACK
let loadingText; // ITS TEXT BEFORE IT SAID LOADING
let loadingCheck; // FILLS IT AS THE GAME'S IMAGES LOAD
let loadingStartTime; // WHEN IT STARTED, goToPage() GOES ANYWAY 8 SECONDS AFTER THIS

/* ---------------------------------------------------------------- */
// Start Nav
/* ---------------------------------------------------------------- */
/**
 * @description The menu button (3 lines, top right) opens & closes the menu. A click outside it, a link in it or Escape closes it.
 * The play page's game does this itself (handleMenuBtn in gameplay/index.js), so only pages without the game call this
 * @return {[function]} toggleNav [toggleNav(true) opens the menu, toggleNav(false) closes it]
 */
export function startNav() {
	const optBtn = document.getElementById("optBtn"); // MENU BUTTON (3 LINES)
	const menu = document.getElementById("menuContainer");

	function toggleNav(open) {
		menu.style.display = open ? "flex" : "none";
		optBtn.setAttribute("aria-expanded", open);
	}

	optBtn.setAttribute("aria-expanded", false);
	optBtn.addEventListener("click", function (e) {
		e.preventDefault();
		e.stopPropagation();
		toggleNav(menu.style.display != "flex");
	});
	menu.addEventListener("click", function (e) { if (e.target.closest("a")) { toggleNav(false); } }); // A LINK ON THIS PAGE (#games) CLOSES IT TOO
	document.addEventListener("click", function (e) { if (!menu.contains(e.target)) { toggleNav(false); } }); // CLICK OUTSIDE
	document.addEventListener("keydown", function (e) { if (e.key == "Escape") { toggleNav(false); } });
	return toggleNav;
}

/* ---------------------------------------------------------------- */
// Show Table
/* ---------------------------------------------------------------- */
/**
 * @description The table behind the board, as the page background (the play page draws it on the canvas instead)
 */
export function showTable() {
	const main = document.querySelector("#main");
	main.style.backgroundRepeat = "repeat-y";
	main.style.backgroundImage = `url("${process.env.CHESS_ASSESTS_URL}/images/board/table.webp")`;
	main.style.backgroundSize = "cover";
	main.style.backgroundPosition = "center";
}

/* ---------------------------------------------------------------- */
// Show Current Game
/* ---------------------------------------------------------------- */
/**
 * @description Play the AI (Home & guest) & Play a friend (Home): swaps the box's text for a picture of the player's open game,
 * a line about it (level or opponent, color, whose move) & Continue current game. If the picture can't be drawn Continue still shows
 * @param  {[object]} box [the .box, it holds a .boxText, a .boardPicture (canvas & figcaption) & a .continueGame link]
 * @param  {[object]} game [GET /api/chess/game/:gameId response]
 * @param  {[string]} href [where Continue goes: /play/:gameId (signed in) or /play (guest)]
 */
export async function showCurrentGame(box, game, href) {
	const picture = box.querySelector(".boardPicture");
	const continueLink = box.querySelector(".continueGame");
	const turn = game.game_board.split(" ")[1]; // FEN: w OR b TO MOVE
	const opponent = game.ai ? `Level ${game.ai_level}` : `vs ${game.opponent_name || "Friend"}`;
	const theirMove = game.ai ? "AI's move" : "Their move";
	picture.querySelector("figcaption").innerText = `${opponent} // ${colorText(game.player_color, game.start_params)} // ${turn == game.player_color ? "Your move" : theirMove}`;
	continueLink.href = href;
	try {
		await drawBoardPicture(picture.querySelector("canvas"), game);
		picture.hidden = false;
	} catch (err) { console.log(err); } // AN IMAGE DIDN'T LOAD, CONTINUE STILL WORKS
	box.querySelector(".boxText").hidden = true;
	continueLink.hidden = false;
}

/**
 * @description Puts the box's text back once its game is over (Play a friend redraws when the socket says it changed)
 * @param  {[object]} box [the .box showCurrentGame drew in]
 */
export function hideCurrentGame(box) {
	box.querySelector(".boardPicture").hidden = true;
	box.querySelector(".continueGame").hidden = true;
	box.querySelector(".boxText").hidden = false;
}

/* ---------------------------------------------------------------- */
// AI Levels
/* ---------------------------------------------------------------- */
/**
 * @description Fills a level dropdown (Play the AI on Home & the guest page) with the server's levels & their approx Elo. The level is saved with the game,
 * so it only changes by starting a new game
 * @param  {[string]} gameUrl [chess api, "/api/chess"]
 * @param  {[object]} select [the <select>]
 */
export async function loadLevels(gameUrl, select) {
	const response = await getLevels(gameUrl);
	if (response?.status != 200) { return; } // NO LEVELS -> THE SERVER USES ITS DEFAULT
	for (let i = 0; i < response.levels.length; i++) {
		const option = document.createElement("option");
		option.value = response.levels[i].level;
		option.innerText = `Level ${response.levels[i].level} (${response.levels[i].elo})`;
		if (response.levels[i].level == response.default_level) { option.selected = true; }
		select.append(option);
	}
}

/* ---------------------------------------------------------------- */
// Color Text
/* ---------------------------------------------------------------- */
/**
 * @description How a game's color reads on Home: the picture's caption, Invites & Your games
 * @param  {[string]} playerColor ["w" or "b", the player's side in this game]
 * @param  {[object]} startParams [the game's start settings, { color: "random" | "w" | "b" }]
 * @return {[string]} text ["You play white", "You play white (random)" when it was drawn]
 */
export function colorText(playerColor, startParams) {
	return `You play ${playerColor == "w" ? "white" : "black"}${startParams?.color == "random" ? " (random)" : ""}`;
}

/* ---------------------------------------------------------------- */
// Loading
/* ---------------------------------------------------------------- */
/**
 * @description Every way into a game (Play AI, Accept, Continue current game & Your games) & Home on Game not found: it says Loading & fills up
 * from the left (--load, .loading in nav.css) as the game's images load, preloadImages() started them when the page opened. The last 10% is the server
 * (new game, accept), goToPage() fills it & goes to the page. stopLoading() puts it back if it didn't go through
 * @param  {[object]} btn [the button or link pressed]
 */
export function startLoading(btn) {
	if (loadingBtn) { stopLoading(); } // ONE AT A TIME
	const label = btn.querySelector(".gameOpen") || btn; // YOUR GAMES: ONLY "Open" SAYS LOADING
	loadingBtn = btn;
	loadingText = label.innerText;
	label.innerText = "Loading";
	btn.classList.add("loading");
	btn.disabled = true; // ONE GAME PER PRESS (LINKS DON'T HAVE disabled, .loading TURNS OFF THEIR CLICKS)
	loadingStartTime = Date.now();
	loadingCheck = setInterval(function () { btn.style.setProperty("--load", Math.min(imageProgress(), 0.9)); }, 50); // FROM EMPTY (THE FILL IS DRAWN FIRST)
}

/**
 * @description Goes to the page once the game's images are in (or after 8 seconds, an image that failed never counts), the fill finishes first.
 * The next page keeps this page on screen until it's drawn, then fades into it (play.html, home.html, guest.html)
 * @param  {[string]} href [/play/:gameId (signed in), /play (guest) or / (Home)]
 */
export function goToPage(href) {
	const openCheck = setInterval(function () {
		if (imageProgress() < 1 && Date.now() - loadingStartTime < 8000) { return; } // STILL LOADING
		clearInterval(openCheck);
		clearInterval(loadingCheck);
		if (loadingBtn) { loadingBtn.style.setProperty("--load", 1); }
		setTimeout(function () { window.location.href = href; }, 200); // THE FILL REACHES THE END FIRST (200MS IN nav.css)
	}, 50);
}

/**
 * @description Puts the button back as it was (the server said no, or Back from the game showed this page as it was left)
 */
export function stopLoading() {
	if (!loadingBtn) { return; }
	clearInterval(loadingCheck);
	(loadingBtn.querySelector(".gameOpen") || loadingBtn).innerText = loadingText;
	loadingBtn.classList.remove("loading");
	loadingBtn.style.removeProperty("--load");
	loadingBtn.disabled = false;
	loadingBtn = null;
}

/**
 * @description Continue current game & the games in Your games load like Play AI (Home & guest). Clicks that open a new tab (cmd, ctrl, shift,
 * middle) open as usual. Back from the game can show this page as it was left (the browser keeps it), so the button is put back
 */
export function startGameLinks() {
	document.addEventListener("click", function (e) {
		const link = e.target.closest("a.continueGame, #gameList a");
		if (!link || e.button != 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) { return; }
		e.preventDefault();
		startLoading(link);
		goToPage(link.href);
	});
	window.addEventListener("pageshow", function (e) { if (e.persisted) { stopLoading(); } });
}

/* ---------------------------------------------------------------- */
// Show Page
/* ---------------------------------------------------------------- */
/**
 * @description Shows the page: removes loadingPage from <html>. Coming from another page (a game's Home button, Play AI) the last page stays
 * on screen until then & fades into this one (the <style> in home.html, guest.html & play.html)
 */
export function showPage() {
	document.documentElement.classList.remove("loadingPage");
}

/**
 * @description Home & guest: shows the page once it's drawn, its images are in (window load) & what it fills from the server is filled
 * (the levels, the boxes, the board pictures). After 8 seconds it's shown anyway (server down)
 * @param  {[array]} drawn [promises of what the page fills]
 */
export async function showPageWhenDrawn(drawn) {
	const showAnyway = setTimeout(showPage, 8000);
	const pageLoaded = new Promise(function (resolve) {
		if (document.readyState == "complete") { resolve(); }
		else { window.addEventListener("load", resolve); }
	});
	await Promise.allSettled([pageLoaded, ...drawn]); // allSettled: ONE THAT FAILED STILL SHOWS THE PAGE
	clearTimeout(showAnyway);
	showPage();
}
