// statusFxWarded.js: the window stub every Warded test file (statusFx-wardedBody, -wardedMotesFlare, -wardedLightJoined) installs, required after three & before constants.js
global.window ??= { matchMedia: () => ({ matches: false, addEventListener() {} }) }; // constants.js READS IT AS IT LOADS
