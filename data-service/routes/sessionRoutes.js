/*
 *  sessionRoutes.js  --  data service
 *	Session Routes
 *	/session/*: making, renewing & ending a signed in player's session tokens (controllers/sessionController.js)
 *
 */

const router = require('express').Router()
const { onlyFields } = require('../middleware/fields.js')
const { login, refresh, logout } = require('../controllers/sessionController.js')
// A SIGNED IN PLAYER'S TOKENS ARE ONLY MADE HERE (#252), THE CHESS SERVER SETS THEM AS COOKIES. NO req.player: EACH ROUTE CHECKS THE TOKEN IN ITS BODY
router.route('/login').post(onlyFields(["id_token", "user"]), login);        // POST /session/login   -> AUTH0'S id_token (CHECKED HERE) -> ACCESS & REFRESH TOKENS
router.route('/refresh').post(onlyFields(["refresh_token"]), refresh);       // POST /session/refresh -> A NEW PAIR, WHILE THE SESSION ID ON THEIR ROW IS UNCHANGED
router.route('/logout').post(onlyFields(["refresh_token"]), logout);         // POST /session/logout  -> CLEARS THE SESSION ID: SIGNED OUT ON EVERY DEVICE
module.exports = router
