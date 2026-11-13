/*
 *  index.js  --  chess frontend
 *	The CRT Monitor's Channels
 *	Every channel by id (the ids & their order are in ../prefs.js), with the names the settings list & the three letters its tab shows (both live in ../kit.js, which the channels import too).
 *	A channel exports draw(ctx, data), buttons(data), press(id, handlers, data) & optionally tick(data), speak(data) (the screen reader's line) & keys(action, data, handlers)
 *
 */

import * as face from "./face.js";
import * as opponent from "./opponent.js";
import * as moves from "./moves.js";
import * as evaluation from "./eval.js";
import * as actions from "./actions.js";
import * as setup from "./setup.js";
import { NAMES, SHORT } from "../kit.js";

const CHANNEL = { face, opponent, eval: evaluation, moves, actions, setup };

export { CHANNEL, NAMES, SHORT };
