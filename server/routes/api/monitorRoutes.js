/*
 *  monitorRoutes.js  --  chess server
 *	Monitoring Routes (#194)
 *	/api/health & /api/client-errors. Neither needs a session: the uptime check & signed out pages use them
 *
 */

const router = require('express').Router();
const { limitClientErrors } = require('../../middleware/rateLimit.js');
const { getHealth, reportClientError } = require('../../controllers/monitorController.js');


router.get('/health', getHealth);
router.post('/client-errors', limitClientErrors, reportClientError);


module.exports = router;
