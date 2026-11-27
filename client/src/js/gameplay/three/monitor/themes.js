/*
 *  themes.js  --  chess frontend
 *	The Meridian Terminal's Colour Themes
 *	Five themes; a theme changes colours only. Tones "ink", "dim" & "hot" name a theme colour of the same name.
 *	No DOM & no three.js here, so the tests load it in Node (client/test/monitor/themes.test.js)
 *
 */

export const THEME_IDS = ["slateamber", "base", "paper", "contrast", "contrastgreen"];
export const DEFAULT_THEME = "slateamber";

/**
 * @description One theme; the bar, brand & splash default to the theme's own ink
 * @return {object} T
 */
function theme(id, label, bg, ink, dim, faint, hot, glow, bar = ink, brand = ink) {
	return Object.freeze({ id, label, bg, ink, dim, faint, hot, bar, brand, splash: brand, glow });
}

const THEMES = {
	slateamber: theme("slateamber", "Slate / Amber", "#0d0d0d", "#f2f2f2", "#9c9c9c", "#262626", "#ffffff", true, "#8fb2c4", "#ffb648"),
	base: theme("base", "Base", "#0d0d0d", "#f2f2f2", "#9c9c9c", "#262626", "#ffffff", true),
	paper: theme("paper", "Black on white", "#ecebe4", "#161616", "#77756c", "#d3d1c6", "#b3261e", false),
	contrast: theme("contrast", "Contrast: yellow", "#0d0d0d", "#ffe600", "#b3a100", "#262626", "#ffffff", true),
	contrastgreen: theme("contrastgreen", "Contrast: green", "#0d0d0d", "#00ff41", "#00b32d", "#262626", "#ffffff", true),
};

/**
 * @description The theme for an id
 * @param {string} id
 * @return {object} T, the default theme for an unknown id
 */
export function themeFor(id) {
	return Object.hasOwn(THEMES, id) ? THEMES[id] : THEMES[DEFAULT_THEME];
}
