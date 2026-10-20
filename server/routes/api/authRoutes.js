const router = require('express').Router()
const { login, callback, logout, refresh } = require('../../controllers/authController.js')


router.route('/login').get(login);          // /api/auth/login    -> AUTH0 LOGIN PAGE

router.route('/callback').get(callback);    // /api/auth/callback -> AUTH0 RETURNS HERE, STARTS SESSION

router.route('/logout').get(logout);        // /api/auth/logout   -> ENDS SESSION + AUTH0 SESSION

router.route('/refresh').post(refresh);     // /api/auth/refresh  -> RE-UPS THE ACCESS TOKEN


module.exports = router
