/*
 *  authRoutes.js  --  chess server
 *	Auth Routes
 *	Sign in with Auth0, the session cookies & sign out (controllers/authController.js)
 *
 */

const router = require('express').Router()
const { login, checkLogin, passwordLogin, checkSignup, signup, checkForgot, forgot, logout, refresh, resume } = require('../../controllers/authController.js')
const { limitLogins, limitSignups, limitForgot } = require('../../middleware/rateLimit.js')


router.route('/login').get(login);          // /api/auth/login    -> THE LOGIN PAGE, KEEPING ?returnTo= (OLD LINKS, #227)

router.route('/login').post(checkLogin, limitLogins, passwordLogin); // /api/auth/login -> THE LOGIN PAGE'S { email, password, returnTo }, SETS THE SESSION

router.route('/signup').post(checkSignup, limitSignups, signup); // /api/auth/signup -> THE LOGIN PAGE'S { email, password, screenname, first_name, last_name, returnTo }, SETS THE SESSION

router.route('/forgot').post(checkForgot, limitForgot, forgot); // /api/auth/forgot -> THE LOGIN PAGE'S { email }, AUTH0 EMAILS A RESET LINK. THE SAME ANSWER WITH OR WITHOUT AN ACCOUNT

router.route('/logout').post(logout);       // /api/auth/logout   -> ENDS SESSION, CLEARS THE COOKIES. OUR PAGE ONLY (#297)

router.route('/refresh').post(refresh);     // /api/auth/refresh  -> RE-UPS THE ACCESS TOKEN

router.route('/resume').get(resume);        // /api/auth/resume   -> PAGES SEND SIGNED OUT PLAYERS HERE: RE-UPS THE SESSION OR /login, THEN BACK TO ?returnTo=


module.exports = router
