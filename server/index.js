const path = require("path");
const fs = require("fs");
const express = require("express");
const cookieParser = require("cookie-parser");
const config = require("./config");
const dynamoDB = require("./dynamoDB.js");
const routes = require("./routes")

const app = express();
const buildDir = path.join(`${__dirname}/../client/dist/`);
app.use(cookieParser()); // SESSION TOKENS ARE READ FROM COOKIES (req.cookies)
app.use(express.static(buildDir));
app.use(routes);
if (fs.existsSync(buildDir)) {
    console.log(true);
    app.use(express.static(buildDir, { index: false, maxAge: "1h" }));
    app.get("/", (req, res) => {return res.sendFile(path.join(buildDir, "index.html"))});
}

app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
      if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Request body must be valid JSON." });
      if (err.type === "entity.too.large") return res.status(413).json({ error: "Request is too large." });
    if (err.name === "ValidationError") return res.status(400).json({ error: err.message });
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Something went wrong on our side." });
});

    app.listen(config.port, () => {
        console.log(`Listening on http://localhost:${config.port}`);
    });

module.exports = app;
