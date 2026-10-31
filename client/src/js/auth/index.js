/*
 *  clientSideAuth.js  --  chess frontend
 *	Client Auth
 *  All Auth0 work happens on the express server (server/controllers/authController.js).
 *  The client only sends the browser to the server's auth routes & asks it who is signed in.
 *  The session tokens are httpOnly cookies, so they never show up in here.
 *
 */

export class InternalAuth {

	constructor() {
		this.userData = null;
	}

	/* ---------------------------------------------------------------- */
	// Login
	/* ---------------------------------------------------------------- */
	/**
	 * @description Server redirects to the Auth0 login page, then back signed in: to returnTo (a page's path) or Home
	 * @param  {[string]} returnTo [optional, e.g. "/play/:gameId"]
	 */
	login(returnTo) { window.location.href = returnTo ? `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}` : "/api/auth/login"; }

	/* ---------------------------------------------------------------- */
	// Logout
	/* ---------------------------------------------------------------- */
	/**
	 * @description Server ends the session (a POST, so another site can't, #297), then the browser goes to Auth0's logout & back to the game.
	 * If the server can't be reached, Home (still signed in, so they can try again)
	 */
	async logout() {
		const response = await request("/api/auth/logout", "POST");
		window.location.href = response?.logoutUrl || "/";
	}

	/* ---------------------------------------------------------------- */
	// Get User
	/* ---------------------------------------------------------------- */
	/**
	 * @description Asks the server who is signed in. If the access token expired, re-ups it with the refresh token, then asks again
	 * @return {[object]} userData [signed in user, or null for guests]
	 */
	async getUser() {
		let response = await request("/api/user", "GET");
		if (response?.status == 401) { // ACCESS TOKEN EXPIRED OR MISSING -> RE-UP
			const refreshed = await this.refresh();
			response = refreshed?.status == 200 ? await request("/api/user", "GET") : refreshed; // THE USERNAME ONLY COMES FROM /api/user
		}

		if (response?.status == 200 && response.userData) {
			this.userData = {
				userId: response.userData.user_id,
				screenname: response.userData.user_metadata?.screenname || '',
				username: response.username || null, // PICKED ON THE SETTINGS PAGE, null UNTIL THEN
				email: response.userData.email,
				emailVerified: response.userData.email_verified,
				firstName: response.userData.user_metadata?.first_name,
				lastName: response.userData.user_metadata?.last_name
			}
		} else { this.userData = null; } // GUEST

		return this.userData;
	}

	/* ---------------------------------------------------------------- */
	// Refresh
	/* ---------------------------------------------------------------- */
	/**
	 * @description Trades the refresh token for a new access token (server returns the user too, so no second request)
	 * @return {[object]} response [{ status, userData, message }]
	 */
	async refresh() { return await request("/api/auth/refresh", "POST"); }

}

/**
 * @description fetch() wrapper for the auth routes, returns null when the server can't be reached
 */
async function request(url, method) {
	try {
		return await fetch(url, { method, credentials: "same-origin" }).then(res => res.json());
	} catch { return null; }
}
