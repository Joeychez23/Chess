const path = require("path");
const http = require("http");
const express = require("express");
const cookieParser = require("cookie-parser");
const config = require("./config");
const routes = require("./routes")
const { initSocket } = require("./socket.js");

const app = express();
app.set("trust proxy", "loopback"); // nginx ON THE SAME MACHINE SENDS X-Forwarded-For, SO req.ip IS THE PLAYER'S ADDRESS (THE NEW GAME LIMITS)
const buildDir = path.join(`${__dirname}/../client/dist/`);
const serveBuild = express.static(buildDir, { index: false }); // BUNDLES, MANIFEST & LOCAL ASSETS
app.use(cookieParser()); // SESSION TOKENS ARE READ FROM COOKIES (req.cookies)
app.use(express.json()); // CHESS ROUTES SEND JSON BODIES (req.body)
app.use((req, res, next) => path.extname(req.path) == ".html" ? next() : serveBuild(req, res, next)); // PAGES ONLY COME FROM THE PAGE ROUTES (routes/pageRoutes.js), SO THEIR SIGN IN CHECK CAN'T BE SKIPPED
app.use(routes);

app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
      if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Request body must be valid JSON." });
      if (err.type === "entity.too.large") return res.status(413).json({ error: "Request is too large." });
    if (err.name === "ValidationError") return res.status(400).json({ error: err.message });
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Something went wrong on our side." });
});

const server = http.createServer(app); // SOCKET.IO SHARES THE PORT WITH EXPRESS
initSocket(server);

    server.listen(config.port, () => {
        console.log(`Listening on http://localhost:${config.port}`);
    });

module.exports = app;
