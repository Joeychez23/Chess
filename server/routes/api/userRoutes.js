const router = require('express').Router()
const { requireAuth } = require('../../middleware/auth.js')
const { getUser, saveSettings, saveUsername, deleteUserData } = require('../../controllers/userController.js')


router.route('/').get(requireAuth, getUser);    // /api/user -> SIGNED-IN USER & THEIR USERNAME (401 WHEN SIGNED OUT / EXPIRED)

router.route('/').delete(requireAuth, deleteUserData);    // /api/user -> DELETE MY DATA (SETTINGS PAGE): LEAVES EVERY GAME, THEN DELETES THE user_db ROW & FREES THE USERNAME

router.route('/settings').put(requireAuth, saveSettings);    // /api/user/settings -> DEFAULT START SETTINGS (SETTINGS PAGE), HOME'S DROPDOWNS START ON THEM

router.route('/username').put(requireAuth, saveUsername);    // /api/user/username -> USERNAME (SETTINGS PAGE), WHAT FRIENDS SEE. 409 WHEN SOMEONE HAS IT


module.exports = router
