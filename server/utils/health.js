/*
 *  health.js  --  chess server
 *	Health Check (#194)
 *  GET /api/health asks DynamoDB (through the data service) & the engine if they work. The uptime check calls it from many places, so one
 *  answer is kept for a few seconds: anyone can call this route, and that keeps it from adding load on the tables or the engine
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { checkEngine } = require("./ai.js");
const { checkTables } = require("../dataClient.js");

const CHECK_MS = 1500; // ROUTE 53 ONLY WAITS 2 SECONDS FOR THE ANSWER, A CHECK THAT TAKES LONGER COUNTS AS DOWN
const KEEP_MS = 15 * 1000; // HOW LONG AN ANSWER IS KEPT

let kept = null; // { at (ms), health }
let running = null; // THE CHECK IN PROGRESS, CALLS THAT ARRIVE DURING IT SHARE IT

/* ---------------------------------------------------------------- */
// Check
/* ---------------------------------------------------------------- */
/**
 * @description Whether the site's two dependencies work, from the last few seconds
 * @return {[object]} health [{ ok, checks: { dynamodb: "ok" | "down", engine: "ok" | "down" } }]
 */
async function checkHealth() {
	if (kept && Date.now() - kept.at < KEEP_MS) { return kept.health; }
	running ||= runChecks().finally(() => { running = null; });
	return running;
}

/**
 * @description Runs both checks at once & keeps the answer
 */
async function runChecks() {
	const [dynamodb, engine] = await Promise.all([runCheck("dynamodb", checkDynamo), runCheck("engine", checkEngine)]);
	const health = { ok: dynamodb == "ok" && engine == "ok", checks: { dynamodb, engine } };
	kept = { at: Date.now(), health };
	return health;
}

/**
 * @description The data service's answer, which is anything but a 200 while it runs different code (a 404 "No such action")
 */
async function checkDynamo() {
	const answer = await checkTables();
	if (answer?.status != 200) { throw new Error(`data service answered ${answer?.status}: ${answer?.message}`); }
}

/**
 * @description One check, down when it throws or takes too long. The reason only goes in the log, the route is public
 * @param  {[string]} name [its name in the log]
 * @param  {[function]} check [async () => throws when it's down]
 * @return {[string]} result ["ok" or "down"]
 */
async function runCheck(name, check) {
	let timer;
	const tooLong = new Promise((resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`no answer in ${CHECK_MS / 1000} seconds`)), CHECK_MS);
	});
	try {
		await Promise.race([check(), tooLong]);
		return "ok";
	} catch (err) {
		console.error(`HEALTH ${name} down: ${err.message}`);
		return "down";
	} finally {
		clearTimeout(timer);
	}
}

/**
 * @description Forgets the kept answer (between tests)
 */
function resetHealth() {
	kept = null;
}


module.exports = { checkHealth, resetHealth };
