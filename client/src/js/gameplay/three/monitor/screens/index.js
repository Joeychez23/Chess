/*
 *  screens/index.js  --  chess frontend
 *	The Terminal's Windows' Contents, by window id (windows.js has the ids, titles & geometry)
 *
 */

import * as session from "./session.js";
import * as log from "./log.js";
import * as mail from "./mail.js";
import * as systems from "./systems.js";
import * as diag from "./diagnostics.js";
import * as theme from "./theme.js";
import * as admin from "./admin.js";

const SCREEN = { session, log, mail, systems, diag, theme, admin };
const NAMES = { session: "Session", log: "Log", mail: "Mail", systems: "Systems", diag: "Diagnostics", theme: "Theme", admin: "Administrative control" }; // FOR THE SCREEN READER

export { SCREEN, NAMES };
