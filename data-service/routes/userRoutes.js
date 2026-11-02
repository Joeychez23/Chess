/*
 *  userRoutes.js  --  data service
 *	User Routes
 *	/users/me/*: the requester's own user row, /users/named/:username: who holds a username, /users/search: usernames by their start (controllers/userController.js)
 *
 */

const router = require('express').Router()
const { requireSignedIn } = require('../middleware/player.js')
const { onlyFields } = require('../middleware/fields.js')
const { getMe, saveSettings, saveUsername, findByUsername, searchByUsername, deleteMe } = require('../controllers/userController.js')
// ONLY THE SIGNED IN REQUESTER'S OWN ROW (GUESTS HAVE NONE: 403), EACH ROUTE NAMES THE BODY FIELDS IT TAKES
router.route('/me').get(requireSignedIn, onlyFields([]), getMe);                                                        // GET /users/me           -> THEIR ROW (?consistent=true, ?games=true ADDS THEIR OPEN GAMES & INVITES)
router.route('/me/settings').post(requireSignedIn, onlyFields(["ai_level", "ai_color", "friend_color"]), saveSettings); // POST /users/me/settings -> DEFAULT START SETTINGS
router.route('/me/username').post(requireSignedIn, onlyFields(["username"]), saveUsername);                             // POST /users/me/username -> THEIR USERNAME, 409 WHEN SOMEONE HAS IT
router.route('/me/delete').post(requireSignedIn, onlyFields([]), deleteMe);                                             // POST /users/me/delete   -> DELETE MY DATA, ONCE THEY'VE LEFT EVERY GAME
router.route('/named/:username').get(requireSignedIn, onlyFields([]), findByUsername);                                   // GET /users/named/:name  -> WHO HOLDS IT, A FRIEND INVITE BY USERNAME
router.route('/search').get(requireSignedIn, onlyFields([]), searchByUsername);                                           // GET /users/search?prefix= -> USERNAMES STARTING WITH IT, NAMES ONLY
module.exports = router
