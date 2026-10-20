/*
 *  userController.js  --  chess server
 *	User Routes
 *
 */

/* ---------------------------------------------------------------- */
// Get User
/* ---------------------------------------------------------------- */
/**
 * @description Returns the signed-in user from the access token (requireAuth runs first). Same response shape as the old user lambda
 * @return {[object]} response [{ status, userData, message }]
 */
function getUser(req, res) {
	return res.json({ status: 200, userData: req.user, message: "USER DATA FOUND" });
}


module.exports = { getUser };
