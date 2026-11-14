/*
 *  pageRoutes.js  --  chess server
 *	Page Routes
 *	Picks the page for each URL & sends signed out players to sign in first (controllers/pageController.js)
 *
 */

const router = require('express').Router()
const { homePage, playPage, gamePage, replayPage, settingsPage, loginPage, signupPage, privacyPage, termsPage } = require('../controllers/pageController.js')

// PAGES: THE SERVER PICKS THE .html FILE (client/dist) FOR THE URL, THE CLIENT MOVES BETWEEN THEM WITH window.location.href

router.route('/').get(homePage);                // /              -> SIGNED IN -> home.html (GAME LIST, PLAY AI, PLAY FRIENDS), NO USERNAME YET -> /settings, GUEST -> guest.html (SIGN IN FOR NOW)

router.route('/play').get(playPage);            // /play          -> GUEST GAME (ITS ID STAYS IN localStorage), SIGNED IN -> HOME

router.route('/play/:gameId').get(gamePage);    // /play/:gameId  -> A SIGNED IN PLAYER'S GAME, A CHALLENGE LINK -> join.html, SIGNED OUT -> /api/auth/resume, THEN BACK HERE

router.route('/replay/:gameId').get(replayPage); // /replay/:gameId -> A SIGNED IN PLAYER'S FINISHED GAME, STEP BY STEP (play.html, READ-ONLY), STILL GOING -> /play/:gameId, AN INVITE -> HOME, SIGNED OUT -> /api/auth/resume, THEN BACK HERE

router.route('/settings').get(settingsPage);     // /settings      -> SIGNED IN -> settings.html (USERNAME, ACCOUNT, DEFAULT START SETTINGS, DELETE MY ACCOUNT), SIGNED OUT -> /api/auth/resume, THEN BACK HERE

router.route('/login').get(loginPage);          // /login         -> SIGNED OUT -> login.html, SIGNED IN -> ?returnTo= OR HOME

router.route('/signup').get(signupPage);        // /signup        -> SIGNED OUT -> signup.html, SIGNED IN -> ?returnTo= OR HOME

router.route('/privacy').get(privacyPage);      // /privacy       -> ANYONE -> privacy.html

router.route('/terms').get(termsPage);          // /terms         -> ANYONE -> terms.html


module.exports = router
