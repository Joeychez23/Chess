/*
 *  userRoutes.js  --  chess server
 *	User Routes
 *	The signed in player's account: their user, settings, username, friends & deleting their data (controllers/userController.js)
 *
 */

const router = require('express').Router()
const { requireAuth } = require('../../middleware/auth.js')
const { limitPlayerSearch, limitFriends, limitAccountDeletes } = require('../../middleware/rateLimit.js')
const { getUser, saveSettings, saveUsername, searchPlayers, getFriends, friendAction, deleteUserData } = require('../../controllers/userController.js')


router.route('/').get(requireAuth, getUser);    // /api/user -> SIGNED-IN USER & THEIR USERNAME (401 WHEN SIGNED OUT / EXPIRED)

router.route('/').delete(requireAuth, limitAccountDeletes, deleteUserData);    // /api/user -> DELETE MY ACCOUNT (SETTINGS PAGE): DELETES THE AUTH0 LOGIN, LEAVES EVERY GAME, THEN DELETES THE user_db ROW & FREES THE USERNAME. 429 WHEN A LIMIT IS HIT

router.route('/settings').put(requireAuth, saveSettings);    // /api/user/settings -> DEFAULT START SETTINGS (SETTINGS PAGE), HOME'S DROPDOWNS START ON THEM

router.route('/username').put(requireAuth, saveUsername);    // /api/user/username -> USERNAME (SETTINGS PAGE), WHAT FRIENDS SEE. 409 WHEN SOMEONE HAS IT

router.route('/search').get(requireAuth, limitPlayerSearch, searchPlayers);    // /api/user/search?q= -> USERNAMES STARTING WITH IT (HOME), NAMES ONLY. 429 WHEN A LIMIT IS HIT

router.route('/friends').get(requireAuth, getFriends);    // /api/user/friends -> FRIENDS (WHO'S ONLINE) & REQUESTS (HOME), NAMES ONLY

for (const action of ["request", "accept", "decline", "cancel", "remove"]) {    // /api/user/friends/<action> { username } -> SAVED ON BOTH ROWS & PUSHED TO BOTH PLAYERS. 429 WHEN A LIMIT IS HIT
	router.route(`/friends/${action}`).post(requireAuth, limitFriends, friendAction(action));
}


module.exports = router
