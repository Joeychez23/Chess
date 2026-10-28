/*
 *  index.js  --  chess server
 *	Routes
 *	/api/* goes to the api routes, everything else to the page routes. An unknown api route is a 404, an unknown page goes Home
 *
 */

const router = require('express').Router();
const apiRoutes = require('./api')
const pageRoutes = require('./pageRoutes.js')


router.use('/api', apiRoutes);
router.use('/', pageRoutes);

router.use('/api', function (req, res) { // UNKNOWN API ROUTE
    return res.status(404).json({ status: 404, message: 'Wrong route' });
})

router.use(function (req, res) { // UNKNOWN PAGE -> HOME
    return res.redirect('/');
})


module.exports = router;
