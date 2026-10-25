/*
 *  index.js  --  chess frontend
 *	Page Utils
 *	Shared by the pages: the menu (on pages without the game), the table background & the current game in the Play the AI box
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { drawBoardPicture } = require("./boardPicture.js");

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
 * @description The Play the AI box on Home & guest: swaps the box's text for a picture of the player's open AI game,
 * a line about it (level, color, whose move) & Continue current game. If the picture can't be drawn Continue still shows
 * @param  {[object]} game [GET /api/chess/game/:gameId response]
 * @param  {[string]} href [where Continue goes: /play/:gameId (signed in) or /play (guest)]
 */
export async function showCurrentGame(game, href) {
	const continueLink = document.getElementById("continueGame");
	const turn = game.game_board.split(" ")[1]; // FEN: w OR b TO MOVE
	document.getElementById("currentGameInfo").innerText = `Level ${game.ai_level} // You play ${game.player_color == "w" ? "white" : "black"} // ${turn == game.player_color ? "Your move" : "AI's move"}`;
	continueLink.href = href;
	try {
		await drawBoardPicture(document.getElementById("currentGameBoard"), game);
		document.getElementById("currentGame").hidden = false;
	} catch (err) { console.log(err); } // AN IMAGE DIDN'T LOAD, CONTINUE STILL WORKS
	document.getElementById("soloText").hidden = true;
	continueLink.hidden = false;
}
