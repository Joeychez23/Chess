/*
 *  index.js  --  chess frontend
 *	Page Utils
 *	Shared by the pages: the menu (on pages without the game) & the table background
 *
 */

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
