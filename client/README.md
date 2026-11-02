# Client

<div align="center">

[Home](../README.md) · **Client** · [Server](../server/README.md) · [Data service](../data-service/README.md) · [Deploy](../deploy/README.md) · [Terraform](../terraform/README.md) · [Setup & fixes](../SETUP.md)

</div>

---

## Setup

`client/.env`:

| Variable | Purpose |
| --- | --- |
| `CHESS_ASSETS_URL` | Where the images and audio load from, with `https://` and no trailing slash: `https://assets.chess.aws-prac-route53.com/v1` (CloudFront, the version folder of the current upload), or `http://localhost:3001` to use local copies (see below). It's built into the bundle, so rebuild after changing it. |

**Images and audio aren't in the repo** (`client/src/images` and `client/src/audio`
are git-ignored). They're in the `aws-prac-chess-s3` bucket and CloudFront serves
them; every asset url starts with `CHESS_ASSETS_URL`.

To use local copies instead of CloudFront, put them in `client/dist`, which the
server already serves (and builds leave in place). From the repo root:

```bash
aws s3 sync s3://aws-prac-chess-s3/v1/images client/src/images   # skip if client/src already has them
aws s3 sync s3://aws-prac-chess-s3/v1/audio client/src/audio
mkdir -p client/dist && cp -R client/src/images client/src/audio client/dist/
```

Then set `CHESS_ASSETS_URL=http://localhost:3001` in both `client/.env` and
`server/.env` (the server's CSP has to allow it under `npm run dev`) and rebuild
with `npm start` or `npm run dev`. Don't use `.`: on `/play/:gameId` it asks for
`/play/images/...`, which isn't an asset. Copy again after an image or sound changes.

Each upload goes into a version folder (`s3://aws-prac-chess-s3/v1/images/...`)
with `Cache-Control: public, max-age=31536000, immutable`, so browsers keep the
sprites and the move sound for a year and a second visit doesn't download them
again. Never change a file inside an uploaded version: upload the whole set to
the next version, point `CHESS_ASSETS_URL` in `client/.env` at it and rebuild
the client (the server's CSP only uses the origin, so `server/.env` can stay).
The new urls show at once, with no CloudFront invalidation:

```bash
deploy/upload-assets.sh v2   # syncs client/src/images & client/src/audio to s3://aws-prac-chess-s3/v2/
```

Delete the old version folder once no deployed build uses it.

## Run

```bash
npm start       # builds client/dist and serves it + the auth routes on http://localhost:3001
npm run dev     # webpack-dev-server on http://localhost:3002, /api, /socket.io and the pages (/, /play) are proxied to :3001 (run the server too)
npm run build   # bundles into client/dist
cd data-service && npm run dev   # the data service on http://127.0.0.1:8090, the server calls it for every game and player
```

Run the data service too, or every page that needs a game or a player answers
503 "Try again in a moment".

With `npm run dev`, set `CLIENT_URL=http://localhost:3002/` so login returns
to the dev server. The dev server writes the `.html` pages to `client/dist`
so the server can pick between them, and keeps the bundles in memory.

## Pages

The server sends the page (`server/routes/pageRoutes.js`). It checks the same
access-token cookie as the API, so the client never works out which page it
should be on. Each page is its own `.html` and bundle (`client/src/js/pages/`).

| Url | Page |
| --- | --- |
| `/` | Signed in: `home.html`, the Play the AI, Play a friend, Invites and Your games boxes. Play the AI and Play a friend show their open game's board (`pages/utils/boardPicture.js`) and Continue current game, and Invites lists the invites. Signed out: `guest.html`, the homepage with Sign in and Play the AI (level, color, Play AI / New game), and the guest's game board while it's open. The access cookie lives as long as the token (15 minutes), so the guest page re-ups the session first and goes Home if it can |
| `/play/:gameId` | A signed-in player's game. Signed out, it goes through `/api/auth/resume` and comes back. A `PENDING` invite goes to `/` (it's answered on Home). Restart and Rematch swap the url to the new game's id |
| `/play` | The guest's game. Signed-in players are sent Home |
| `/settings` | Signed in: `settings.html`, the Username, Account, Default start settings, Friends, Closed games and Delete my data boxes. A player without a username lands here from `/` and goes back Home once it's saved. Signed out, it goes through `/api/auth/resume` and comes back |
| `/login` | Signed out: `login.html`, email and password through `POST /api/auth/login`, with a Forgot password? form through `POST /api/auth/forgot` and a link to `/signup`. Signed in, it goes to `?returnTo=` or `/` |
| `/signup` | Signed out: `signup.html`, Create account through `POST /api/auth/signup`, with a link to `/login`. Signed in, it goes to `?returnTo=` or `/` |

Anything else goes to `/`, and an unknown `/api` route gets a JSON `404`.
The `.html` files are only sent through these routes, never as static files.
Home and the guest page call `preloadImages()` (`client/src/js/gameplay/images/index.js`)
as soon as they open, so the game's sprites are already in the browser cache
when a game opens, and each one is logged to the console. With the uploaded
`Cache-Control` header (above) they stay cached on later visits too.

Each page's first step is `startErrorReports()` (`pages/utils/reportErrors.js`). It sends uncaught
errors, rejected promises, 5xx answers and failed requests to `POST /api/client-errors`, at most 10
different ones per page load. 4xx answers are left out because they're normal, and so are game ids and queries.

## Socket.IO

The client side is `client/src/js/socket/index.js`. `renderCanvas()` calls
`joinGame()` for friend games (also when a rematch loads), and the Home button calls `leaveGame()`. Home opens its own socket
with `watchGames()`. If
the server turns the socket away because the access token expired, the client
re-ups the session once and reconnects. While a friend game's socket is down, the play page's message area says so
(`handlers.connectionLost`, `reconnected`, `connectionFailed`).

A friend game's board listens like this. The handshake uses the session
cookie, so the page must be on the server's origin and signed in:

```javascript
import { joinGame, leaveGame } from "./socket/index.js";

joinGame(gameId, playerId, {
	move: () => refreshData(),                       // the friend moved: fetch the game, animate prev_move
	gameOver: ({ winner, reason }) => showMenu(winner, reason), // the friend forfeited
	rematch: (newGameId) => loadGame(newGameId),     // both pressed Rematch
});

// Going Home or opening another game
leaveGame();
```

## Layout

```text
client/
  home.html                  Home markup: Play the AI (level), Play a friend (email), Invites, Your games, menu (Home, Invites, Your games, Settings, Logout)
  settings.html              Settings markup: Username, Account, Default start settings, Friends, Closed games, Delete my data, menu (Home, Settings, Logout)
  login.html                 Login markup: sign in, Forgot password?, link to signup, menu (Home, Login/Signup)
  signup.html                Signup markup: Create account, link to login, menu (Home, Login/Signup), shares the login bundle
  guest.html                 Guest homepage markup: board picture, Sign in, Play the AI (level, color), menu (Home, Play the AI, Login/Signup)
  play.html                  Game menu markup (Resume, Sound, Restart / Forfeit / Rematch, Home, Exit)
  webpack.config.js          One entry + HTML page each (home, guest, play, settings, login; signup shares login's entry), PWA manifest, dotenv, dev proxy (/api, /socket.io, pages)
  src/css/nav.css            The menu (3 line button, top right) on every page, plus the colors and fonts
  src/css/home.css           Home + guest homepage styles
  src/css/style.css          Play page layout (canvas), imported by pages/play
  src/js/pages/
    home/index.js            Open games (opponent, level, color), new solo games, invites (send, accept, decline, cancel), color dropdowns, the open AI & friend games (Continue / forfeit)
    guest/index.js           Guest homepage menu, re-ups an expired session, the guest's game board, Play AI / New game
    settings/index.js        Username (first pick goes Home), account info, saves the Default start settings, Delete my data (two presses, then logout)
    play/index.js            Finds the player + game (url or guest localStorage, a missing guest game is made as Random), starts renderCanvas()
    utils/index.js           startNav() (the menu on pages without the game), table background, showCurrentGame() / hideCurrentGame(), loadLevels(), colorText()
    utils/boardPicture.js    drawBoardPicture(): a still of a game's board, drawn like the play page
  src/js/auth/index.js       login() / logout() / getUser() / refresh() → server auth routes
  src/js/socket/index.js     joinGame() / leaveGame(): friend game socket, watchGames(): Home's socket
  src/js/gameplay/
    index.js                 renderCanvas() (sets up the canvas, starts once the sprites are in), startGame() (loads the game, joins a friend game, listeners), renderLoop() (runs on requestAnimationFrame, only while something changes)
    state/index.js           game: the state every gameplay file shares, plus the canvas, ctx & the chess.js boards
    images/index.js          preloadImages() / imageProgress(): loads the sprites into images[] (home, guest + play call it)
    sprites/index.js         Every sprite url in image number order + the image numbers (wFrontKingImg = 5, ...)
    layout/index.js          renderBoard(): sizes the canvas & board to the window, draws the table & board; resize
    draw/index.js            drawScreen (handleInitialData): pieces, highlights, slides, taken piece trays, which way pieces face
    animate/index.js         stepSlide(): where a sliding piece is from the time, knight hop height, the pieces sliding home after Restart & Rematch
    input/index.js           Mouse, touch & TV remote handlers
    moves/index.js           Loads the game, sends the player's moves, finishes the AI's & a friend's (socket move event), refreshData()
    menu/index.js            Menu buttons, Restart / Forfeit / Rematch (loads the new board in place), game over, socketHandlers
    status/index.js          The play page's message area (#gameStatus): refused moves, lost connection, server or AI not answering
    validate/index.js        Backend calls: get game, move, reset, new AI game (newAiGame), AI move, levels, user games, invite, accept, decline, save settings, save username, delete my data
    ai/index.js              playAi(): asks the server for the AI's move (the server picks and saves it)
    user/index.js            Converts a dropped tile into a { from, to, promotion } move
    utils/index.js           Per-square tile state
```

---

<div align="center">

[Home](../README.md) · **Client** · [Server](../server/README.md) · [Data service](../data-service/README.md) · [Deploy](../deploy/README.md) · [Terraform](../terraform/README.md) · [Setup & fixes](../SETUP.md)

</div>
