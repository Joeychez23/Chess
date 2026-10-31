# Client

<div align="center">

[Home](../README.md) · **Client** · [Server](../server/README.md) · [Data service](../data-service/README.md) · [Deploy](../deploy/README.md) · [Terraform](../terraform/README.md) · [Setup & fixes](../SETUP.md)

</div>

---

## Setup

`client/.env`:

| Variable | Purpose |
| --- | --- |
| `CHESS_ASSETS_URL` | Where the images and audio load from, with `https://` and no trailing slash: `https://assets.chess.aws-prac-route53.com` (CloudFront), or `.` to use local copies. It's built into the bundle, so rebuild after changing it. |

**Images and audio aren't in the repo** (`client/src/images` and `client/src/audio`
are git-ignored). They're in the `aws-prac-chess-s3` bucket and CloudFront serves
them; every asset url starts with `CHESS_ASSETS_URL`. To work offline, copy them
back into `client/src/`, set `CHESS_ASSETS_URL=.` and turn on the
`CopyWebpackPlugin` block in `client/webpack.config.js`. To upload changes
(CloudFront's TTL is 0, so they show at once):

```bash
aws s3 sync client/src/images s3://aws-prac-chess-s3/images --exclude "*.DS_Store"
```

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

Anything else goes to `/`, and an unknown `/api` route gets a JSON `404`.
The `.html` files are only sent through these routes, never as static files.
Home and the guest page call `preloadImages()` (`client/src/js/gameplay/images/index.js`)
as soon as they open, so the game's sprites are already in the browser cache
when a game opens, and each one is logged to the console. That only sticks once the S3
objects have a `Cache-Control` header: CloudFront's TTL is 0 and nothing sets
one yet.

## Socket.IO

The client side is `client/src/js/socket/index.js`. `renderCanvas()` calls
`joinGame()` for friend games (also when a rematch loads), and the Home button calls `leaveGame()`. Home opens its own socket
with `watchGames()`. If
the server turns the socket away because the access token expired, the client
re-ups the session once and reconnects.

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
  guest.html                 Guest homepage markup: board picture, Sign in, Play the AI (level, color), menu (Home, Play the AI, Sign in)
  play.html                  Game menu markup (Resume, Restart / Forfeit / Rematch, Home, Exit)
  webpack.config.js          One entry + HTML page each (home, guest, play, settings), PWA manifest, dotenv, dev proxy (/api, /socket.io, pages)
  src-sw.js                  Workbox service worker (not registered at the moment)
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
    index.js                 renderCanvas() (sets up the canvas, starts once the sprites are in), startGame() (loads the game, joins a friend game, listeners), renderLoop()
    state/index.js           game: the state every gameplay file shares, plus the canvas, ctx & the chess.js boards
    images/index.js          preloadImages() / imageProgress(): loads the sprites into images[] (home, guest + play call it)
    sprites/index.js         Every sprite url in image number order + the image numbers (wFrontKingImg = 5, ...)
    layout/index.js          renderBoard(): sizes the canvas & board to the window, draws the table & board; resize
    draw/index.js            drawScreen (handleInitialData): pieces, highlights, slides, taken piece trays, which way pieces face
    animate/index.js         Knight hop height, the pieces sliding home after Restart & Rematch
    input/index.js           Mouse, touch & TV remote handlers
    moves/index.js           Loads the game, sends the player's moves, finishes the AI's & a friend's (socket move event), refreshData()
    menu/index.js            Menu buttons, Restart / Forfeit / Rematch (loads the new board in place), game over, socketHandlers
    validate/index.js        Backend calls: get game, move, reset, new AI game (newAiGame), AI move, levels, user games, invite, accept, decline, save settings, save username, delete my data
    ai/index.js              playAi(): asks the server for the AI's move (the server picks and saves it)
    user/index.js            Converts a dropped tile into a { from, to, promotion } move
    utils/index.js           Per-square tile state
```

---

<div align="center">

[Home](../README.md) · **Client** · [Server](../server/README.md) · [Data service](../data-service/README.md) · [Deploy](../deploy/README.md) · [Terraform](../terraform/README.md) · [Setup & fixes](../SETUP.md)

</div>
