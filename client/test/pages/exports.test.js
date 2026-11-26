/*
 *  exports.test.js  --  chess client tests
 *	The files split into folders or sub-files (the cards flow and select logic, the 3D view)
 *  A split answers with the same exports the one file had, keeps each piece of module state in one file,
 *  and no sub-file loads its parent (a cycle would hand back a half-built module).
 *  Most of these files only load in the browser, so their exports are read from the source with acorn (webpack installs it)
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const acorn = require("acorn");

const GAMEPLAY = path.join(__dirname, "../../src/js/gameplay");
const read = (file) => fs.readFileSync(path.join(GAMEPLAY, file), "utf8");

// The names a file exports: `export function`, `export const`, `export { a, b } from`, or `module.exports = { a, b }`
function exportNames(source) {
	const names = [];
	for (const node of acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" }).body) {
		if (node.type === "ExportNamedDeclaration") {
			for (const declared of node.declaration ? node.declaration.declarations || [node.declaration] : []) { names.push(declared.id.name); }
			for (const specifier of node.specifiers) { names.push(specifier.exported.name); }
		} else if (node.type === "ExportAllDeclaration") {
			names.push("*");
		} else if (node.type === "ExpressionStatement" && node.expression.type === "AssignmentExpression" && node.expression.right.type === "ObjectExpression"
			&& node.expression.left.type === "MemberExpression" && node.expression.left.object.name === "module") {
			for (const property of node.expression.right.properties) { names.push(property.key.name); }
		}
	}
	return names.sort();
}

// The names a file declares at module level that can change after load: every `let`, and a Map, Set or WeakMap
function stateNames(source) {
	const names = [];
	for (const match of source.matchAll(/^(?:let (\w+)|(?:const|var) (\w+) = new (?:Map|Set|WeakMap)\()/gm)) { names.push(match[1] || match[2]); }
	return names;
}

// One split: `parent` is the file the others import through, `subFiles` are the private files beside it (paths under gameplay/)
// A split's sub-files: the files beside `parent` whose names start with `prefix` and a dot, so one added later is checked too
const subFilesOf = (parent, prefix) => fs.readdirSync(path.join(GAMEPLAY, path.dirname(parent)))
	.filter((name) => name.startsWith(`${prefix}.`)).map((name) => path.posix.join(path.dirname(parent), name));

function checkSplit(parent, subFiles, expected) {
	assert.deepEqual(exportNames(read(parent)), expected, "the same exports as the one file had");
	assert.ok(subFiles.length > 0, "the file is split");

	const seen = new Map();
	for (const file of [parent, ...subFiles]) {
		const source = read(file);
		for (const name of stateNames(source)) {
			assert.ok(!seen.has(name), `${name} is module state in both ${seen.get(name)} and ${file}`);
			seen.set(name, file);
		}
		if (file !== parent) {
			const up = path.relative(path.dirname(file), parent);
			assert.ok(!source.includes(`"./${up}"`) && !source.includes(`'./${up}'`), `${file} loads its parent ${up}`);
		}
	}
}

// cards/ holds the sub-files of two splits and cards.network.js, which is neither's: these two tests keep explicit lists
test("cards/flow.js answers as it did, with the prompts, the drag and the shared picks in their own files", () => {
	checkSplit("cards/flow.js", ["cards/cards.prompts.js", "cards/cards.drag.js", "cards/cards.state.js"],
		["act", "handKey", "promote", "putDown", "startCards"]);
	assert.doesNotMatch(read("cards/cards.state.js"), /require\("\.\/|from "\.\//, "the shared state loads nothing from cards/");
});

test("cards/select.js answers as it did, with the labels and the fog's blind moves in their own files", () => {
	checkSplit("cards/select.js", ["cards/cards.labels.js", "cards/cards.fog.js"], [
		"CARD_MOVES", "PIECE_NAMES", "PIECE_VALUE", "actionsFor", "askedBy", "asking", "blindMoves", "canPlace", "costsSkull", "dimmed", "dropPlay",
		"focusList", "handCards", "handRead", "keyPlan", "label", "lift", "liftedCard", "movesForCard", "options", "pick", "pickPiece", "pileDrops",
		"plaquePrompt", "pressPick", "promotionPick", "promptButtons", "promptFocus", "promptPlays", "shortcutFor", "squaresOf", "stepFocus",
		"targetsForActive", "zooms",
	]);
});

test("three/cardTable/ answers as cardTable.js did", () => {
	checkSplit("three/cardTable/index.js", subFilesOf("three/cardTable/index.js", "cardTable"), [
		"DUEL_OUT", "DUEL_WAYPOINT", "createCardTable", "deskInView", "duelPath",
	]);
	assert.ok(!fs.existsSync(path.join(GAMEPLAY, "three/cardTable.js")), "cardTable.js is gone: one way in");
});

test("three/index.js answers as it did, with the mount and the facing in their own files", () => {
	checkSplit("three/index.js", subFilesOf("three/index.js", "three"), [
		"UP", "addPiece", "animateMove", "animateUndo", "center", "corner", "dealDuel", "dealShift", "dropCard", "dropHeld", "endDuel", "enterMonitor",
		"faceTravel", "fileOf", "fitCamera", "flipDuel", "focusCard", "focusMonitor", "focusTableButton", "forward", "glassCentre", "glassNormal",
		"glassScale", "glassSize", "glideHome", "hasCards", "highlight", "highlightSquares", "holdStatuses", "homeYaw", "isCameraGesture", "leaveMonitor",
		"liftCard", "monitorState", "mount", "offset", "openCardPile", "perfLoaded", "pickStatuses", "place", "playBoardStep", "pointer",
		"pressTableButton", "raycaster", "relayPlaques", "removePiece", "requestRender", "resetCamera", "rowOf", "setCardTable", "setFace", "setFacing",
		"setHeld", "setLabels", "setMonitor", "setPickable", "setPromotion", "setScreen", "setSide", "setTaken", "setYaw", "shadeOnGround",
		"showTableButtons", "slotOf", "spherical", "squareUnder", "stopMotion", "storedYaw", "syncFromBoard", "syncStatuses", "table", "tablePoint",
		"toCell", "toggleCardPile", "unmount", "view", "whenDrawn", "yawSide", "yawToward",
	]);
});

test("three/camera/ answers as camera.js did", () => {
	checkSplit("three/camera/index.js", subFilesOf("three/camera/index.js", "camera"), [
		"CARD_SETTLE_MS", "frameDeal", "framePile", "isCameraGesture", "landDealEase", "landHome", "landTurn", "openCardCamera", "placeCamera",
		"resetCamera", "resize", "setCameraAt", "setRoomSide", "setSide", "sideAngle", "stepCamera", "stepZoom", "unframeDeal", "zoomSpot", "zoomTo",
	]);
	assert.ok(!fs.existsSync(path.join(GAMEPLAY, "three/camera.js")), "camera.js is gone: one way in");
});

test("statusFx/index.js answers as it did, with the status lists in their own file", () => {
	checkSplit("three/statusFx/index.js", subFilesOf("three/statusFx/index.js", "statusFx"), [
		"MODULES", "SLOW_MS", "clearStatuses", "decideCheap", "diffStatuses", "focusStatuses", "holdStatuses", "hoverStatuses", "liveStatuses",
		"pickStatuses", "ringList", "springSquare", "statusList", "statusText", "stepStatuses", "syncStatuses", "tapStatuses", "wardIds",
	]);
});

test("three/pointer/ answers as pointer.js did, with the card and monitor picks in their own files", () => {
	checkSplit("three/pointer/index.js", subFilesOf("three/pointer/index.js", "pointer"), [
		"PROMOTION_DEAD_ZONE", "PROMOTION_DEAD_ZONE_TOUCH", "createControls", "enterMonitor", "focusMonitor", "hoverBoard", "inPromotionDeadZone",
		"leaveMonitor", "monitorIdle", "monitorInput", "monitorState", "onClick", "onKeyDown", "onMonitorShow", "onPointerDown", "onPointerLeave",
		"onPointerMove", "onPointerUp", "onTouchTap", "rehover", "rehoverPlaque", "setMonitor",
	]);
});

test("renderer/index.js answers as it did, with the draw, the card table, the 3D lifecycle and the shared state in their own files", () => {
	checkSplit("renderer/index.js", subFilesOf("renderer/index.js", "renderer"), [
		"VIEWS", "addBoardListener", "boardStep3D", "can3D", "currentView", "dealDuel3D", "drawBoard", "dropTablePiece3D", "endDuel3D", "enterMonitor3D",
		"flipDuel3D", "focusMonitor3D", "focusTableButton3D", "glideHome3D", "holdTablePiece3D", "isCameraGesture", "leaveMonitor3D", "monitorState3D",
		"onCardPick", "onTablePick", "onViewChange", "pressTableButton3D", "resetCamera", "setFace", "setMonitorHooks", "setTable3D", "setView",
		"showTableButtons3D", "skipNextAnimation3D", "squareUnder3D", "stopMotion3D", "tablePileOpen3D", "toggleTablePile3D", "whenDrawn3D",
	]);
});
