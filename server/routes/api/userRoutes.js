const router = require('express').Router()
const { requireAuth } = require('../../middleware/auth.js')
const { getUser, saveSettings, deleteUserData } = require('../../controllers/userController.js')


router.route('/').get(requireAuth, getUser);    // /api/user -> SIGNED-IN USER (401 WHEN SIGNED OUT / EXPIRED)

router.route('/').delete(requireAuth, deleteUserData);    // /api/user -> DELETE MY DATA (SETTINGS PAGE): LEAVES EVERY GAME, THEN DELETES THE user_db ROW

router.route('/settings').put(requireAuth, saveSettings);    // /api/user/settings -> DEFAULT START SETTINGS (SETTINGS PAGE), HOME'S DROPDOWNS START ON THEM


module.exports = router
