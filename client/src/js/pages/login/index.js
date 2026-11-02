/*
 *  index.js  --  chess frontend
 *	Login Page (/login, signed out)
 *	Email & password through POST /api/auth/login, then on to the returnTo the server answers. Create account & Forgot password? open Universal Login until they're on this page
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

import "../../../css/nav.css"; // MENU (3 LINES, TOP RIGHT), COLORS & FONTS
import "../../../css/home.css"; // THE SAME BOXES AS HOME & SETTINGS
require("../utils/reportErrors.js").startErrorReports(); // BEFORE THE OTHER MODULES RUN, SO THEIR ERRORS ARE REPORTED TOO (#194)
const { InternalAuth } = require("../../auth/index.js");
const { startNav, showPageWhenDrawn } = require("../utils/index.js");

const loginForm = document.getElementById("loginForm");
const emailInput = document.getElementById("loginEmail");
const passwordInput = document.getElementById("loginPassword");
const showPasswordBtn = document.getElementById("showPassword");
const loginBtn = document.getElementById("loginBtn");
const loginNote = document.getElementById("loginNote"); // WHY SIGNING IN DIDN'T WORK

const auth = new InternalAuth;

startNav();
showPageWhenDrawn([checkSession()]);
loginForm.addEventListener("submit", handleLogin); // SIGN IN & ENTER IN A FIELD
showPasswordBtn.addEventListener("click", handleShowPassword);
document.querySelectorAll(".universalLogin").forEach(function (link) { link.search = window.location.search; }); // THE SAME returnTo, THE SERVER CHECKS IT
window.addEventListener("pageshow", function (e) { if (e.persisted) { window.location.reload(); } }); // BACK SHOWS THE PAGE AS IT WAS LEFT: THE BUTTON OFF & THE PASSWORD IN IT

/* ---------------------------------------------------------------- */
// Check Session
/* ---------------------------------------------------------------- */
/**
 * @description The server only sees the access token here (the refresh token is only sent to /api/auth), so an expired one gets here too.
 * getUser() re-ups it, then the reload lets the server send them on & check returnTo
 */
async function checkSession() {
	if (await auth.getUser()) { window.location.replace(window.location.href); }
}

/* ---------------------------------------------------------------- */
// Show Password
/* ---------------------------------------------------------------- */
function handleShowPassword() {
	const show = passwordInput.type == "password";
	passwordInput.type = show ? "text" : "password";
	showPasswordBtn.innerText = show ? "Hide" : "Show";
	showPasswordBtn.setAttribute("aria-label", show ? "Hide password" : "Show password");
}

/* ---------------------------------------------------------------- */
// Login
/* ---------------------------------------------------------------- */
/**
 * @description Signs in, then goes to the returnTo the server checked. A wrong password, a limit or a block says why (400, 401, 429), anything else is on our side
 */
async function handleLogin(e) {
	e.preventDefault();
	e.stopPropagation();
	loginBtn.disabled = true; // ONE LOGIN PER PRESS
	loginNote.innerText = "";
	const returnTo = new URLSearchParams(window.location.search).get("returnTo");
	const response = await auth.passwordLogin(emailInput.value, passwordInput.value, returnTo);
	if (response?.status == 200) { return window.location.replace(response.returnTo); }
	loginBtn.disabled = false;
	loginNote.innerText = [400, 401, 429].includes(response?.status) ? response.message : "Sign in isn't working right now, try again in a moment.";
}
