/*
 *  authRoutes.js  --  chess server
 *	Auth Routes
 *	Sign in with Auth0, the session cookies & sign out (controllers/authController.js)
 *
 */

const router = require('express').Router()
const { login, callback, checkLogin, passwordLogin, checkSignup, signup, logout, refresh, resume } = require('../../controllers/authController.js')
const { limitLogins, limitSignups } = require('../../middleware/rateLimit.js')


router.route('/login').get(login);          // /api/auth/login    -> AUTH0 LOGIN PAGE (?returnTo= THE PAGE TO COME BACK TO), UNTIL #227

router.route('/login').post(checkLogin, limitLogins, passwordLogin); // /api/auth/login -> THE LOGIN PAGE'S { email, password, returnTo }, SETS THE SESSION

router.route('/signup').post(checkSignup, limitSignups, signup); // /api/auth/signup -> THE LOGIN PAGE'S { email, password, screenname, first_name, last_name, returnTo }, SETS THE SESSION

router.route('/callback').get(callback);    // /api/auth/callback -> AUTH0 RETURNS HERE, STARTS SESSION

router.route('/logout').post(logout);       // /api/auth/logout   -> ENDS SESSION, ANSWERS { logoutUrl } (AUTH0 LOGOUT). OUR PAGE ONLY (#297)

router.route('/refresh').post(refresh);     // /api/auth/refresh  -> RE-UPS THE ACCESS TOKEN

router.route('/resume').get(resume);        // /api/auth/resume   -> PAGES SEND SIGNED OUT PLAYERS HERE: RE-UPS THE SESSION OR /login, THEN BACK TO ?returnTo=


module.exports = router
