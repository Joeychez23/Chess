/*
 *  index.js  --  chess frontend
 *	Login & Signup Pages (/login & /signup, signed out)
 *	Email & password through POST /api/auth/login, or a new account through POST /api/auth/signup, then on to the returnTo the server answers. Forgot password? posts an email to POST /api/auth/forgot & Auth0 emails the link
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
const loginBtn = document.getElementById("loginBtn");
const loginNote = document.getElementById("loginNote"); // WHY SIGNING IN DIDN'T WORK
const signupForm = document.getElementById("signupForm");
const signupBtn = document.getElementById("signupBtn");
const signupNote = document.getElementById("signupNote"); // WHY THE ACCOUNT WASN'T MADE

const forgotForm = document.getElementById("forgotForm");
const forgotEmail = document.getElementById("forgotEmail");
const forgotBtn = document.getElementById("forgotBtn");
const forgotNote = document.getElementById("forgotNote"); // THE SAME ANSWER WITH OR WITHOUT AN ACCOUNT, OR WHY IT DIDN'T GO THROUGH

const auth = new InternalAuth;

startNav();
showPageWhenDrawn([checkSession()]);
loginForm?.addEventListener("submit", handleLogin); // SIGN IN & ENTER IN A FIELD (EACH PAGE HAS ONE OF THE TWO FORMS)
signupForm?.addEventListener("submit", handleSignup);
forgotForm?.addEventListener("submit", handleForgot);
document.querySelectorAll(".showPassword").forEach(function (button) { button.addEventListener("click", handleShowPassword); });
document.querySelectorAll(".keepReturnTo").forEach(function (link) { link.search = window.location.search; }); // THE SAME returnTo, THE SERVER CHECKS IT
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
function handleShowPassword(e) {
	const button = e.currentTarget;
	const input = document.getElementById(button.getAttribute("aria-controls"));
	const show = input.type == "password";
	input.type = show ? "text" : "password";
	button.innerText = show ? "Hide" : "Show";
	button.setAttribute("aria-label", show ? "Hide password" : "Show password");
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

/* ---------------------------------------------------------------- */
// Forgot Password
/* ---------------------------------------------------------------- */
/**
 * @description Asks for a reset link. The server's answer (200) doesn't say whether the email has an account, a refused email or a limit says why (400, 429), anything else is on our side
 */
async function handleForgot(e) {
	e.preventDefault();
	e.stopPropagation();
	forgotBtn.disabled = true; // ONE EMAIL PER PRESS
	forgotNote.innerText = "";
	const response = await auth.forgotPassword(forgotEmail.value);
	forgotBtn.disabled = false;
	forgotNote.innerText = [200, 400, 429].includes(response?.status) ? response.message : "Password reset isn't working right now, try again in a moment.";
}

/* ---------------------------------------------------------------- */
// Create Account
/* ---------------------------------------------------------------- */
/**
 * @description Makes the account & signs in, then goes to the returnTo the server checked. A refused field or a limit says why (400, 429), so does an account made
 * but not signed in (202: pressing again would only say the email is taken), anything else is on our side
 */
async function handleSignup(e) {
	e.preventDefault();
	e.stopPropagation();
	signupBtn.disabled = true; // ONE ACCOUNT PER PRESS
	signupNote.innerText = "";
	const returnTo = new URLSearchParams(window.location.search).get("returnTo");
	const response = await auth.signup({ ...Object.fromEntries(new FormData(signupForm)), returnTo });
	if (response?.status == 200) { return window.location.replace(response.returnTo); }
	signupBtn.disabled = false;
	signupNote.innerText = [202, 400, 429].includes(response?.status) ? response.message : "Creating an account isn't working right now, try again in a moment.";
}
