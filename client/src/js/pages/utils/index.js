/*
 *  index.js  --  chess frontend
 *	Page Utils
 *	Shared by the pages: the menu (on pages without the game), the table background, the current game in the Play the AI & Play a friend boxes,
 *	the AI level dropdown & how a game's start settings read ("You play white (random)")
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { drawBoardPicture } = require("./boardPicture.js");
const { getLevels } = require("../../gameplay/validate/index.js");

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
