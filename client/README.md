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
them; every asset url starts with `CHESS_ASSETS_URL`. That includes the 3D board's
textures, `pieces.glb` and the library room (`library*.glb`, `library-*.webp`, [docs/3d-room.md](../docs/3d-room.md)), under `images/3d/`. Those need CloudFront's CORS headers
(`terraform/modules/cloudfront`). The `.blend` sources in `images/3d/blend/` stay local.

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
| `/` | Signed in: `home.html`, the Play the AI, Play a friend, Invites, Your games, Finished games and Friends boxes. Play the AI and Play a friend show their open game's board (`pages/utils/boardPicture.js`) and Continue current game, and Invites lists the invites. Signed out: `guest.html`, the homepage with Sign in and Play the AI (level, color, Play AI / New game), and the guest's game board while it's open. The access cookie lives as long as the token (15 minutes), so the guest page re-ups the session first and goes Home if it can |
| `/play/:gameId` | A signed-in player's game. Signed out, it goes through `/api/auth/resume` and comes back. A `PENDING` invite goes to `/` (it's answered on Home). A challenge link opened by anyone not in its game shows `join.html`, which joins it or says it's taken; its creator goes to `/`. Restart and Rematch swap the url to the new game's id |
| `/replay/:gameId` | A signed-in player's finished game, step by step on a read-only board (play.html with `READ_ONLY`): the bar under the board (first, back, forward, last), Left / Right / Home / End, the move list's current move & click to jump. Signed out, it goes through `/api/auth/resume` and comes back. A game that's still going opens `/play/:gameId`, an invite goes to `/`. Home's Finished games and the game-over menu's Replay link here |
| `/play` | The guest's game. Signed-in players are sent Home |
| `/settings` | Signed in: `settings.html`, the Username, Account, Default start settings, Friends, Closed games and Delete my account boxes. A player without a username lands here from `/` and goes back Home once it's saved. Signed out, it goes through `/api/auth/resume` and comes back |
| `/login` | Signed out: `login.html`, email and password through `POST /api/auth/login`, with a Forgot password? form through `POST /api/auth/forgot` and a link to `/signup`. Signed in, it goes to `?returnTo=` or `/` |
| `/privacy`, `/terms` | Anyone: `privacy.html` and `terms.html`, linked from every menu and the login and signup pages |
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
`joinGame()` for friend games (also when a rematch loads), and the Home and Settings links call `leaveGame()`. Home opens its own socket
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
	drawOffer: ({ state, mine }) => showDraw(state, mine), // a draw was offered or declined
	rematch: (newGameId) => loadGame(newGameId),     // both pressed Rematch
	opponentLeft: () => showOpponentLeft(),          // opponent left the game page, the rematch request says so
	opponentBack: () => clearStatus("rematch"),      // they came back
});

// Going Home or opening another game
leaveGame();
```

## The 3D room's monitor

With 3D on, a CRT monitor across the board shows the opponent (`three/screen.js`, fed by `screen3D()` in `gameplay/renderer`). It is also the game's menu in 3D (channels, zoom, keys, what it hides, its `MONITOR` localStorage setting): see `docs/3d-room.md`, "The monitor". On the desk it shows:

- **Before a game has loaded:** colour bars.
- **Friend games:** the opponent's username and `your move` / `their move`, or the result. Players have no pictures.
- **AI games:** the colour bars, then a pixel face for the rest of the game, with the name and status on a strip along the bottom.

The face is data in `three/faces.js`. `faceFor()` and `endFaceFor()` in `gameplay/bots/index.js` pick it, and the game calls `setFace()` (`gameplay/renderer`) where the bot speaks:

| Event | Face |
| --- | --- |
| The bot captures or gives check | `happy` |
| The player captures a pawn, knight or bishop | `sad` |
| The player captures a rook or queen, or gives check | `angry` |
| A quiet move | no change |
| The bot wins | `won`: happy, held until the next game |
| The bot loses | `lost`: angry for 1.5 seconds, then sad, held |
| A draw, or a new game | `neutral` |

Mate beats check, and check beats a capture. While it is the bot's turn the idle face is `thinking` (the eyes look left and right). A reaction lasts 2.5 seconds and a newer one replaces it at once. The idle face blinks every 3 to 7 seconds. With reduced motion on, each face shows its main frame and holds still.

To add an expression: add its parts to `PARTS` if it needs new ones, add an entry to `FACES` (`colour`, `frames`, and `loop` or `then`), and return its name from `faceFor()` for the event it reacts to. The drawing code doesn't change. `client/test/faces.test.js` checks the table.

## Layout

```text
client/
  home.html                  Home markup: Play the AI (level), Play a friend (username or challenge link), Invites, Your games, Finished games, Friends, menu (Invites, Your games, Finished games, Friends / Settings / Logout)
  settings.html              Settings markup: Username, Account, Default start settings, Friends, Closed games, Delete my account, menu (Home / Logout)
  login.html                 Login markup: sign in, Forgot password?, link to signup, menu (Home)
  signup.html                Signup markup: Create account, link to login, menu (Home), shares the login bundle
  guest.html                 Guest homepage markup: board picture, Sign in, Play the AI (level, color), menu (Play the AI / Login/Signup)
  play.html                  Game menu markup, in groups (Resume / Hint, Takeback, Offer Draw, Type a Move, Monitor (3D, while the room's monitor is up) / Sound, Flip Board, Eval Bar, Download PGN / Forfeit or Restart or Rematch, Cancel / Home, Settings / Exit). At game over the Restart group moves under the result
  webpack.config.js          One entry + HTML page each (home, guest, play, settings, login; signup shares login's entry), PWA manifest, dotenv, dev proxy (/api, /socket.io, pages)
  src/css/nav.css            The menu (3 line button, top right) on every page, plus the colors and fonts
  src/css/home.css           Home + guest homepage styles
  src/css/style.css          Play page layout (canvas), imported by pages/play
  src/css/board3D.css        The 3D board, its controls hint & ?perf=1 readout, imported by gameplay/three (lazy "three" chunk)
  src/js/pages/
    home/index.js            Open games (opponent, level, color), new solo games, invites (send, accept, decline, cancel), friends (requests, Challenge fills the invite, Remove), color dropdowns, the open AI & friend games (Continue / forfeit)
    guest/index.js           Guest homepage menu, re-ups an expired session, the guest's game board, Play AI / New game
    settings/index.js        Username (first pick goes Home), account info, saves the Default start settings, Delete my account (two presses, then logout)
    play/index.js            Finds the player + game (url or guest localStorage, a missing guest game is made as Random), starts renderCanvas()
    utils/boxNav.js          startBoxNav() (Guest, Home, Login, Signup & Settings: arrows between the boxes, Enter goes in, Escape comes out, fields move then use, the arrow keys still leave a text box in use), boxKeys() (the hook it passes to createNav), watchMoving() (a click, losing focus & other ways of typing into a moving field), rowsOf(), rowStep(), sideStep(), menuRow()
    utils/dropdown.js        startDropdowns() (Home, Settings & Guest: each <select> drawn as a button & list that Enter, Space or a click opens; Up, Down, W & S move & loop, Enter picks, Escape, Backspace or Delete closes; the hidden <select> keeps the value), stepOption(), listAction()
    utils/nav.js             createNav() (opens & closes every page's menu, its keyboard focus, arrow keys, Tab around the page & Left and Right between the page's elements, the game passes hooks), arrowKey() (W, A, S & D are the arrows except where a letter is typed), isMoving() & typedIn() (a field the keys move past, not type in), scrollsPage() (the keys the browser scrolls with, stopped on pages that pass createNav a boxKeys hook: Guest, Home, Login, Signup & Settings), placeBefore() (the 3D monitor's stop, the leftmost), menuItems() (the visible items, remote-only mode uses them too), startNav() (pages without the game or boxes)
    utils/index.js           table background, showCurrentGame() / hideCurrentGame(), loadLevels(), colorText()
    utils/boardPicture.js    drawBoardPicture(): a still of a game's board, drawn like the play page
  src/js/auth/index.js       login() / logout() / getUser() / refresh() → server auth routes
  src/js/socket/index.js     joinGame() / leaveGame(): friend game socket, watchGames(): Home's socket
  src/js/gameplay/
    index.js                 renderCanvas() (sets up the canvas, starts once the sprites are in), startGame() (loads the game, joins a friend game, listeners), renderLoop() (runs on requestAnimationFrame, only while something changes)
    state/index.js           game: the state every gameplay file shares, plus the canvas, ctx & the chess.js boards
    images/index.js          preloadImages() / imageProgress(): loads the sprites into images[] (home, guest + play call it)
    sprites/index.js         Every sprite url in image number order + the image numbers (wFrontKingImg = 5, ...)
    layout/index.js          renderBoard(): sizes the canvas & board to the window, draws the table, board & coordinates; resize
    draw/index.js            drawScreen (handleInitialData): pieces, highlights, slides, taken piece trays & material count, right-click marks & arrows, which way pieces face
    animate/index.js         stepSlide(): where a sliding piece is from the time, knight hop height, the pieces sliding home after Restart & Rematch
    input/index.js           Mouse, touch & remote-only mode handlers
    input/modes.js           listenersFor(): which listeners go on for the mouse, remote-only mode & the read-only board (no page state, the server tests run it)
    moves/index.js           Loads the game, sends the player's moves, finishes the AI's & a friend's (socket move event), refreshData()
    menu/index.js            Menu buttons, draw offers, Forfeit / Restart / Rematch (loads the new board in place), game over, socketHandlers
    status/index.js          The play page's message area (#gameStatus): refused moves, lost connection, server or AI not answering
    movelist/index.js        The move list panel (#moveList): numbered moves, where it fits next to the board, collapsing it, its keyboard focus & arrow keys. The opening's name (#openingDisplay). In a replay: the current move's highlight (setCurrentPly) & a click jumps there (onMoveSelect)
    movelist/rows.js         moveRows(): the numbered rows & each move's ply (no page state, the server tests run it)
    movebox/index.js         The typed move box (#moveBox): the / key & the menu open it, the menu also closes it, chess.js reads the move, it slides like a clicked move, it lists the legal moves as the player types, it opens at the top right behind the menu button each time, a mouse or finger can drag it while it's open, closing gives focus back & Left or Right leave it with the cursor at that end
    movebox/suggestions.js   What the list shows & when the player can move (no page state, the server tests run it)
    validate/index.js        Backend calls: get game, move, reset, new AI game (newAiGame), AI move, levels, user games, invite, player search, friends, accept, decline, save settings, save username, delete my data
    ai/index.js              playAi(): asks the server for the AI's move (the server picks and saves it)
    bots/index.js            The AI's bot: botFor(), when it speaks (momentFor, endMomentFor, pickLine) & the face the 3D room's monitor makes (faceFor, endFaceFor). No DOM, tested in client/test
    bots/say.js              Shows the bot beside the board (#botDisplay) & its lines
    renderer/index.js        Picks the 2D canvas or the 3D board (not on a phone, tablet or in remote-only mode yet: can3D(), the menu's View button says "3D touch in progress..." or "3D remote in progress..."). On 3D it keeps the pieces, camera side, highlights & the room's monitor (screen3D, setFace, syncMonitor3D) in step with the game
    monitor/index.js         The game's side of the 3D room's monitor (docs/3d-room.md): its data, its actions (they press the menu's buttons), what it hides from the page (data-on-monitor) & the menu's Monitor item
    replay/index.js          The replay viewer (/replay/:gameId, #78): the bar, its keys, slides forward & back, jumps
    replay/positions.js      Every position of a game with its facing (the server's faceMove), move labels, facePair, stepPlan (no page state, the server tests run it)
    replay/keys.js           replayKeyAction(): what a key does in the replay (no page state, the server tests run it)
    monitor/data.js          Its pure part: actionsFrom(), resultText(), trimScores(), plyOf(), startPlyFor(). No DOM, tested in client/test
    three/load.js            load3D(): downloads the lazy "three" chunk the first time 3D is turned on
    three/index.js           The 3D board: mount / unmount, camera, picking, piece slides, highlights. Loads the library room & lights its fire after the board is up (addRoom)
    three/board.js           The board's frame, gold inlay & labels, and the baize table (the fallback when the room doesn't load)
    three/pieces.js          Piece meshes from pieces.glb (docs/3d-pieces.md), blob shadows
    three/materials.js       Piece & board materials
    three/room.js            The library room & CRT monitor from library.glb & library-room.glb (docs/3d-room.md): detail texture x baked light map, unlit
    three/fire.js            The library's fire: swaying flames, embers & the flicker of its light on the room, 30 frames a second
    three/clock.js           The library's longcase clock: its hands show the local time, stepping each second, & its pendulum swings
    three/screen.js          What the monitor shows, on a canvas used as its glass's texture: test card, name & status, the face
    three/faces.js           The monitor's pixel faces as data: PARTS (pixel grids) & FACES (frames, timings). No DOM, tested in client/test
    three/pixelFont.js       The monitor's 5 x 7 font. No DOM, tested in client/test
    three/hint.js            The controls hint, the first time 3D opens
    three/perf.js            The ?perf=1 readout (docs/3d-phone-test.md)
    user/index.js            Converts a dropped tile into a { from, to, promotion } move
    utils/index.js           Per-square tile state
```

---

<div align="center">

[Home](../README.md) · **Client** · [Server](../server/README.md) · [Data service](../data-service/README.md) · [Deploy](../deploy/README.md) · [Terraform](../terraform/README.md) · [Setup & fixes](../SETUP.md)

</div>
