/*
 *  index.js  --  chess frontend
 *	Privacy & Terms Pages (/privacy & /terms, anyone)
 *	Text only: the menu, then the page shows once it's drawn
 *
 */

import "../../../css/nav.css"; // MENU (3 LINES, TOP RIGHT), COLORS & FONTS
import "../../../css/home.css"; // THE SAME BOXES AS HOME
require("../utils/reportErrors.js").startErrorReports(); // BEFORE THE OTHER MODULES RUN, SO THEIR ERRORS ARE REPORTED TOO (#194)
const { startNav, showPageWhenDrawn } = require("../utils/index.js");

startNav();
showPageWhenDrawn([]);
