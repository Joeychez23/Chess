/*
 *  authRoutes.js  --  chess server
 *	Auth Routes
 *	Sign in with Auth0, the session cookies & sign out (controllers/authController.js)
 *
 */

const router = require('express').Router()
const { login, callback, checkLogin, passwordLogin, logout, refresh, resume } = require('../../controllers/authController.js')
const { limitLogins } = require('../../middleware/rateLimit.js')


router.route('/login').get(login);          // /api/auth/login    -> AUTH0 LOGIN PAGE (?returnTo= THE PAGE TO COME BACK TO), UNTIL #227

router.route('/login').post(checkLogin, limitLogins, passwordLogin); // /api/auth/login -> THE LOGIN PAGE'S { email, password, returnTo }, SETS THE SESSION

router.route('/callback').get(callback);    // /api/auth/callback -> AUTH0 RETURNS HERE, STARTS SESSION

router.route('/logout').get(logout);        // /api/auth/logout   -> ENDS SESSION + AUTH0 SESSION

router.route('/refresh').post(refresh);     // /api/auth/refresh  -> RE-UPS THE ACCESS TOKEN

router.route('/resume').get(resume);        // /api/auth/resume   -> PAGES SEND SIGNED OUT PLAYERS HERE: RE-UPS THE SESSION OR LOGS IN, THEN BACK TO ?returnTo=


module.exports = router
