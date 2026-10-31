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

const app = express();
app.disable("x-powered-by"); // NO "X-Powered-By: Express" (#191)
app.set("trust proxy", "loopback"); // nginx ON THE SAME MACHINE SENDS X-Forwarded-For, SO req.ip IS THE PLAYER'S ADDRESS (THE NEW GAME LIMITS)
const buildDir = path.join(`${__dirname}/../client/dist/`);
const serveBuild = express.static(buildDir, { index: false }); // BUNDLES, MANIFEST & LOCAL ASSETS
app.use(securityHeaders); // CSP, NO FRAMING, nosniff, Referrer-Policy & HSTS IN PRODUCTION (middleware/securityHeaders.js)
app.use(cookieParser()); // SESSION TOKENS ARE READ FROM COOKIES (req.cookies)
app.use(express.json()); // CHESS ROUTES SEND JSON BODIES (req.body)
app.use(playerContext); // EACH DATA SERVICE CALL KNOWS WHOSE REQUEST IT'S FOR (dataClient.js)
app.use((req, res, next) => path.extname(req.path) == ".html" ? next() : serveBuild(req, res, next)); // PAGES ONLY COME FROM THE PAGE ROUTES (routes/pageRoutes.js), SO THEIR SIGN IN CHECK CAN'T BE SKIPPED
app.use(routes);

app.use(dataServiceDown); // THE DATA SERVICE DIDN'T ANSWER: 503 "Try again in a moment"
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
      if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Request body must be valid JSON." });
      if (err.type === "entity.too.large") return res.status(413).json({ error: "Request is too large." });
    if (err.name === "ValidationError") return res.status(400).json({ error: err.message });
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    delete err.body; // A REQUEST BODY (A LOGIN'S PASSWORD) IS NEVER LOGGED, BAD JSON IS ANSWERED ABOVE WITHOUT LOGGING
    console.error(err);
    res.status(500).json({ error: "Something went wrong on our side." });
});

const server = http.createServer(app); // SOCKET.IO SHARES THE PORT WITH EXPRESS
initSocket(server);

    server.listen(config.port, () => {
        console.log(`Listening on http://localhost:${config.port}`);
    });

module.exports = app;
