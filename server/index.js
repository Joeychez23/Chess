/*
 *  index.js  --  chess server
 *	Chess Server
 *	Starts the express app & Socket.IO on one port: serves the client bundles (client/dist), the pages (routes/pageRoutes.js)
 *	& the api (routes/api). Every read & write of a game or player goes to the data service (dataClient.js)
 *
 */

const path = require("path");
const http = require("http");
const express = require("express");
const cookieParser = require("cookie-parser");
const config = require("./config");
const routes = require("./routes")
const { initSocket } = require("./socket.js");
const { playerContext, dataServiceDown } = require("./dataClient.js");
const { securityHeaders } = require("./middleware/securityHeaders.js");
const { logServerErrors } = require("./middleware/logServerErrors.js");
const { requireOurPage } = require("./middleware/csrf.js");

const app = express();
app.disable("x-powered-by"); // NO "X-Powered-By: Express" (#191)
app.set("trust proxy", "loopback"); // nginx ON THE SAME MACHINE SENDS X-Forwarded-For, SO req.ip IS THE PLAYER'S ADDRESS (THE NEW GAME LIMITS)
const buildDir = path.join(`${__dirname}/../client/dist/`);
const serveBuild = express.static(buildDir, { index: false }); // BUNDLES, MANIFEST & LOCAL ASSETS
app.use(logServerErrors); // A LOG LINE FOR EACH 5xx ANSWER, AN ALARM COUNTS THEM (#194)
app.use(securityHeaders); // CSP, NO FRAMING, nosniff, Referrer-Policy & HSTS IN PRODUCTION (middleware/securityHeaders.js)
app.use("/api", requireOurPage); // A WRITE TO THE API FROM ANYWHERE BUT OUR OWN PAGE GETS 403 (middleware/csrf.js)
app.use(cookieParser()); // SESSION TOKENS ARE READ FROM COOKIES (req.cookies)
app.use(express.json()); // CHESS ROUTES SEND JSON BODIES (req.body)
app.use(playerContext); // EACH DATA SERVICE CALL KNOWS WHOSE REQUEST IT'S FOR (dataClient.js)
app.use((req, res, next) => path.extname(req.path) == ".html" ? next() : serveBuild(req, res, next)); // PAGES ONLY COME FROM THE PAGE ROUTES (routes/pageRoutes.js), SO THEIR SIGN IN CHECK CAN'T BE SKIPPED
app.use(routes);

app.use(dataServiceDown); // THE DATA SERVICE DIDN'T ANSWER: 503 "Try again in a moment"
app.use(require("./middleware/serverError.js").serverError); // ANYTHING ELSE: ITS 4XX, OR 500 (LOGGED)

const server = http.createServer(app); // SOCKET.IO SHARES THE PORT WITH EXPRESS
const io = initSocket(server);

    server.listen(config.port, () => {
        console.log(`Listening on http://localhost:${config.port}`);
    });

process.on("SIGTERM", () => io.close(() => process.exit(0))); // A RESTART ENDS THE SOCKETS (CLIENTS RECONNECT), TAKES NO NEW REQUESTS & LETS THE RUNNING ONES FINISH (#358)

module.exports = app;
