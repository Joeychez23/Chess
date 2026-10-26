/*
 *  index.js  --  chess frontend
 *	Images
 *	Loads the game's images (SPRITES, gameplay/sprites/index.js) & keeps them in images[] by image number.
 *	Home, guest & the play page call preloadImages() when they open, the game draws from images[] (gameplay/index.js)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { SPRITES } = require("../sprites/index.js"); // EVERY SPRITE URL IN IMAGE NUMBER ORDER

const imagePaths = [];			// This will hold array of all loaded image resources
export const images = [];		// { path, image } IN LOAD ORDER, THE INDEX IS THE IMAGE NUMBER USED TO DRAW IT (SEE IMAGE NUMBERS IN sprites/index.js)
let imagememory = 0;			// BYTES OF ALL LOADED IMAGES (LOGGED)
let loadedImages = 0;			// IMAGES FINISHED LOADING, THE GAME STARTS WHEN THIS MATCHES images.length
/* ---------------------------------------------------------------- */
// Load Image
/* ---------------------------------------------------------------- */
/**
 * @description Loads an image once. It's added to images[] before it finishes loading, so its index is the order loadImage() was called in
 * @param  {[string]} path [image url, ".png" is added when there's no extension]
 * @return {[object]} img [Promise of the loaded Image, or the saved one if this path was already loaded]
 */
async function loadImage(path) {
	return new Promise(function (resolve) {
		if (path.indexOf('.') == -1) path += '.png';			// If no file extension provided, default to .png (lowercase is important for linux)
		if (imagePaths.indexOf(path) == -1) {					// First, check to see if image is already loaded and available
			let img = new Image();
			img.src = path;
			images.push({ "path": path, "image": img });		// Save it right away
			img.onload = (() => {
				imagememory += (img.naturalWidth * img.naturalHeight) * 4;
				console.log('loadImage():Total Memory allocated:' + imagememory + ' for:' + path);
				loadedImages += 1
				resolve(img);
			});
			imagePaths.push(path);								// Add the new path to the imagePaths array
		}
		else													// It's already been loaded
			for (let i = 0; i < images.length; i++) { if (images[i].path == path) { resolve(images[i].image); } }
	})
}

/* ---------------------------------------------------------------- */
// Preload Images
/* ---------------------------------------------------------------- */
/**
 * @description Loads every image the game draws, from CHESS_ASSESTS_URL (S3 / CloudFront). The list is SPRITES (gameplay/sprites/index.js).
 * !NOTE: THE ORDER MATTERS. EACH IMAGE'S INDEX IN images[] IS ITS IMAGE NUMBER (wFrontKingImg = 5, ... IN sprites/index.js),
 * SO NEW IMAGES GO AT THE END OF SPRITES OR EVERY NUMBER AFTER THEM HAS TO CHANGE
 */
export function preloadImages() {
	for (let i = 0; i < SPRITES.length; i++) { loadImage(SPRITES[i]); } // IN ORDER, SO images[i] IS SPRITES[i]
}

/* ---------------------------------------------------------------- */
// Image Progress
/* ---------------------------------------------------------------- */
/**
 * @description How many of the game's images have loaded, Home & guest fill the Loading button with it (startLoading in pages/utils)
 * @return {[number]} progress [0 - 1, 1 when every image preloadImages() started is in]
 */
export function imageProgress() {
	if (!images.length) { return 0; } // preloadImages() HASN'T RUN
	return loadedImages / images.length;
}
