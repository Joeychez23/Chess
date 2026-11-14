const { test } = require("node:test");
const assert = require("node:assert/strict");
const { overlayShows } = require("../src/js/gameplay/draw/overlay.js");

test("2D draws everything, 3D nothing but the fallback picker", () => {
	assert.equal(overlayShows({ traysOnly: false, currPromotion: false, cards3D: false }), "all");
	assert.equal(overlayShows({ traysOnly: false, currPromotion: true, cards3D: true }), "all");
	assert.equal(overlayShows({ traysOnly: true, currPromotion: false, cards3D: false }), "none");
	assert.equal(overlayShows({ traysOnly: true, currPromotion: false, cards3D: true }), "none");
	assert.equal(overlayShows({ traysOnly: true, currPromotion: true, cards3D: false }), "picker");
	assert.equal(overlayShows({ traysOnly: true, currPromotion: true, cards3D: true }), "none");
});
