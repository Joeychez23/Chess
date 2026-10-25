const router = require('express').Router()
const { homePage, playPage, gamePage, settingsPage } = require('../controllers/pageController.js')

// PAGES: THE SERVER PICKS THE .html FILE (client/dist) FOR THE URL, THE CLIENT MOVES BETWEEN THEM WITH window.location.href

router.route('/').get(homePage);                // /              -> SIGNED IN -> home.html (GAME LIST, PLAY AI, PLAY FRIENDS), GUEST -> guest.html (SIGN IN FOR NOW)

router.route('/play').get(playPage);            // /play          -> GUEST GAME (ITS ID STAYS IN localStorage), SIGNED IN -> HOME

router.route('/play/:gameId').get(gamePage);    // /play/:gameId  -> A SIGNED IN PLAYER'S GAME, SIGNED OUT -> /api/auth/resume, THEN BACK HERE

router.route('/settings').get(settingsPage);     // /settings      -> SIGNED IN -> settings.html (ACCOUNT, DEFAULT START SETTINGS, DELETE MY DATA), SIGNED OUT -> /api/auth/resume, THEN BACK HERE


module.exports = router
