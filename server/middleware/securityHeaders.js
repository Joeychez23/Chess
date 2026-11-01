/*
 *  securityHeaders.js  --  chess server
 *	Security Headers (#191)
 *	Every response says what the pages may load (CSP), that no other site can put them in a frame (Forfeit / Accept clickjacking),
 *	not to guess content types, & how much of the URL other sites see. HSTS is only sent in production, where nginx is HTTPS-only
 *
 */

const config = require("../config");

/**
 * @description The origin of an absolute URL, null for a relative one (CHESS_ASSETS_URL="." serves the assets from this site)
 */
function originOf(url) {
	try { return new URL(url).origin; } catch { return null; }
}

/**
 * @description The Content-Security-Policy for the pages. Inline styles are allowed (each page's first-paint <style> & the
 * <style> tags style-loader adds), inline scripts aren't: every script is a bundle from this site
 */
function contentSecurityPolicy() {
	const assets = originOf(config.assetsUrl); // S3 / CLOUDFRONT: SPRITES, SOUNDS, FAVICONS, THE HOME PAGE BOARD
	const sources = (...list) => list.filter(Boolean).join(" ");
	return [
		"default-src 'self'",
		"script-src 'self'",
		`style-src ${sources("'self'", "'unsafe-inline'", "https://fonts.googleapis.com")}`,
		`font-src ${sources("'self'", "https://fonts.gstatic.com")}`,
		`img-src ${sources("'self'", "data:", assets)}`,
		`media-src ${sources("'self'", assets)}`,
		"connect-src 'self'", // fetch() & SOCKET.IO, BOTH SAME ORIGIN
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"frame-ancestors 'none'" // NOTHING FRAMES THE GAME SINCE #43
	].join("; ");
}

const csp = contentSecurityPolicy();

/**
 * @description Express middleware, sets the headers on every response
 */
function securityHeaders(req, res, next) {
	res.set({
		"Content-Security-Policy": csp,
		"X-Frame-Options": "DENY", // OLDER BROWSERS WITHOUT frame-ancestors
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy": "strict-origin-when-cross-origin",
		"Cross-Origin-Opener-Policy": "same-origin"
	});
	if (config.isProduction) { res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains"); } // ONE YEAR
	next();
}

module.exports = { securityHeaders, contentSecurityPolicy };
