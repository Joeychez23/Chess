/*
 *  authRoutes.js  --  chess server
 *	Auth Routes
 *	Sign in with Auth0, the session cookies & sign out (controllers/authController.js)
 *
 */

const router = require('express').Router()
const { login, callback, logout, refresh, resume } = require('../../controllers/authController.js')


router.route('/login').get(login);          // /api/auth/login    -> AUTH0 LOGIN PAGE (?returnTo= THE PAGE TO COME BACK TO)

router.route('/callback').get(callback);    // /api/auth/callback -> AUTH0 RETURNS HERE, STARTS SESSION

router.route('/logout').get(logout);        // /api/auth/logout   -> ENDS SESSION + AUTH0 SESSION

router.route('/refresh').post(refresh);     // /api/auth/refresh  -> RE-UPS THE ACCESS TOKEN

router.route('/resume').get(resume);        // /api/auth/resume   -> PAGES SEND SIGNED OUT PLAYERS HERE: RE-UPS THE SESSION OR LOGS IN, THEN BACK TO ?returnTo=


module.exports = router
