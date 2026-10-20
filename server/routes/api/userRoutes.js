const router = require('express').Router()
const { requireAuth } = require('../../middleware/auth.js')
const { getUser } = require('../../controllers/userController.js')


router.route('/').get(requireAuth, getUser);    // /api/user -> SIGNED-IN USER (401 WHEN SIGNED OUT / EXPIRED)


module.exports = router
