/*
 *  index.js  --  chess frontend
 *	Page Utils
 *	Shared by the pages: the menu's size (on pages without the game), the table background & warming the play page's sprites
 *
 */

/* ---------------------------------------------------------------- */
// Size Menu
/* ---------------------------------------------------------------- */
/**
 * @description Sizes the menu from the screen, same math as handleWindowResize() in gameplay/index.js (which sizes it once the game is drawn)
 */
export function sizeMenu() {
	const cw = window.innerWidth;
	const ch = window.innerHeight;
	const menu = document.getElementById("menuContainer");
	const resultDisplay = document.getElementById("resultDisplay");
	const menuBox = document.getElementById("menuBox");
	const menuButtons = document.getElementsByClassName("menuButton");
	const newGameInput = document.getElementsByClassName("newGameInput");

	if ((ch / cw) > .225) { // NOT A VERY SHORT, WIDE WINDOW
		let menuSize = ((ch) * .90); // MENU IS 16:9, SIZED FROM THE SCREEN HEIGHT
		if (Math.min(cw, ch) < 600) { menuSize = Math.min(ch * 1.9, cw * 2.2); } // SMALL (MOBILE) SCREENS: GROW MENU TO FIT THE SCREEN SO BUTTONS ARE TAPPABLE
		menu.style.width = `${Math.min(menuSize, cw)}px`; // CONTAINER NEVER WIDER / TALLER THAN THE SCREEN
		menu.style.height = `${Math.min(9 * (menuSize) / 16, ch)}px`;
		menuBox.style.width = `${menuSize * .375}px`;
		menuBox.style.height = `${(9 * (menuSize) / 16) * .7}px`;

		for (let i = 0; i < menuButtons.length; i++) { menuButtons[i].style.fontSize = `${(menuSize) * .035}px` }
		for (let i = 0; i < newGameInput.length; i++) { newGameInput[i].style.fontSize = `${Math.max(16, (menuSize) * .035)}px` } // >= 16PX STOPS IOS FROM ZOOMING IN ON INPUT FOCUS
		resultDisplay.style.fontSize = `${(menuSize) * .05}px`
	}
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
// Warm Images
/* ---------------------------------------------------------------- */
/**
 * @description Loads another page's images into the browser cache while this page sits idle, so that page's loadImage() hits the cache.
 * !NOTE: ONLY RELIABLE ONCE S3 SENDS A Cache-Control HEADER, WITHOUT ONE THE BROWSER GUESSES HOW LONG TO KEEP THEM
 * @param  {[array]} paths [image urls]
 */
export function warmImages(paths) {
	if (navigator.connection?.saveData) { return; } // DATA SAVER ON -> LET THE PLAY PAGE LOAD THEM
	const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200)); // NOT IN EVERY BROWSER
	idle(() => { for (let i = 0; i < paths.length; i++) { new Image().src = paths[i]; } });
}
