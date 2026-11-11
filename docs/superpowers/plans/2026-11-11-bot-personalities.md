# Bot Personalities Implementation Plan (#76)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each of the 27 AI levels (600–3200 Elo) a named bot with a bio, avatar and chat lines, shown in the level dropdowns, the game lists and beside the board.

**Architecture:** The bot data (name, bio, avatar path, lines) lives on the server in `server/utils/bots.js`, one bot per level. `levelList()` merges it into `GET /api/chess/levels`, so the writing is in one place and the client gets it with the levels it already loads. The client decides when to speak by looking at the moves (a pure module), so game endpoints don't change.

**Tech Stack:** Node (CommonJS, `node:test`) on the server; vanilla ES modules + webpack + chess.js 1.4.0 on the client; S3 assets from `process.env.CHESS_ASSETS_URL`.

**Spec:** GitHub issue #76 ("Bots with personalities"). Decision made with the user: **27 bots, one per level** (not 8). The issue was written when there were 8 levels.

## Global Constraints

- One bot for every level in `LEVELS`, keyed by `level` (600, 700 … 3200). Shown rating = the level's existing `elo` string (`≈600` … `3200+`).
- Avatars live at `${CHESS_ASSETS_URL}/images/bots/<level>.webp` (e.g. `images/bots/1300.webp`). The server sends the path `images/bots/<level>.webp`, never a full URL.
- Moments with lines: `start`, `capture`, `check`, `win`, `lose`. Every bot has at least 2 lines per moment.
- Out of scope: playing styles, MultiPV, any change to how a level plays.
- Old saved levels 1–8 still map through `OLD_LEVELS` (`server/utils/ai.js:48`); the client must show the right bot for them.
- Names and lines are set with `innerText`/`textContent`, never `innerHTML`.
- No commits or PRs unless the user asks (CLAUDE.md). Version bump: **MINOR → 1.12.0** (new backward-compatible feature; `/levels` only gains fields).

## Review Focus

1. A game saved with an old level (`ai_level` 4) shows the bot for 1600, not "unknown" — Task 1 test on `old_levels`, Task 4 test on `botFor`.
2. Reloading a game mid-way, or one already over, does not replay `start`/`win`/`lose` or the last move's line — Task 4 test (`momentFor` only takes a new move), Task 5 manual check.
3. `/levels` fails or a bot's avatar 404s: dropdown falls back to the Elo text and the board shows the name with a plain fallback circle, no broken-image icon — Task 3 and Task 5 manual checks.
4. Player is black, bot moves first: `start` line still shows once, and the bot's first move doesn't also fire a line — Task 4 test.
5. A bot move that is both a capture and a check, or ends the game, shows one line, by priority `win` > `check` > `capture` — Task 4 test.

---

### Task 1: Bot data on the server and in `GET /levels`

**Files:**
- Create: `server/utils/bots.js`
- Modify: `server/utils/ai.js:61-63` (`levelList`)
- Modify: `server/README.md:152` (response shape)
- Test: `server/test/ai.test.js` (describe `levels`), `server/test/games.test.js:25-31`

**Interfaces:**
- Produces: `BOTS` in `server/utils/bots.js`: `{ [level: number]: { name: string, bio: string, lines: { start: string[], capture: string[], check: string[], win: string[], lose: string[] } } }`, exported as `module.exports = { BOTS }`.
- Produces: `levelList()` → `{ levels: [{ level, elo, name, bio, avatar, lines }], default_level, old_levels }` where `avatar = "images/bots/<level>.webp"` and `old_levels = OLD_LEVELS` (`{ 1: 800, … 8: 3200 }`).

- [ ] **Step 1: Write the failing tests** in `server/test/ai.test.js`, inside `describe("levels")`:

```js
test("every level is a bot with a name, bio, avatar and lines for each moment", () => {
	const { levels } = levelList();
	const moments = ["start", "capture", "check", "win", "lose"];
	for (const bot of levels) {
		assert.ok(bot.name.trim() && bot.bio.trim(), `${bot.level} has a name and bio`);
		assert.equal(bot.avatar, `images/bots/${bot.level}.webp`);
		assert.deepEqual(Object.keys(bot.lines).sort(), [...moments].sort());
		assert.ok(moments.every((m) => bot.lines[m].length >= 2 && bot.lines[m].every((line) => line.trim())));
	}
	assert.equal(new Set(levels.map((bot) => bot.name)).size, 27); // NO TWO BOTS SHARE A NAME
});

test("the old levels go to the client so it shows their bot", () => {
	assert.deepEqual(levelList().old_levels, { 1: 800, 2: 1100, 3: 1300, 4: 1600, 5: 1900, 6: 2200, 7: 2600, 8: 3200 });
});
```

And in `server/test/games.test.js:29` change the `deepEqual` on `levels[0]` to check `level`, `elo` and that `name` is a string and `avatar == "images/bots/600.webp"`.

- [ ] **Step 2: Run and see them fail**

Run: `cd server && node --test test/ai.test.js test/games.test.js`
Expected: FAIL (`bot.name` undefined, `old_levels` undefined).

- [ ] **Step 3: Write `server/utils/bots.js`** — 27 entries. Writing rules: names get more confident/serious as Elo rises; bios ≤ 120 characters and say roughly how it plays (e.g. 600 "misses things", 3200 "full-strength engine"); each line ≤ 80 characters, family-friendly, no taunting of the player by name. Then update `levelList()` to merge `BOTS[level]`, add `avatar`, and add `old_levels: OLD_LEVELS`. Add a check at module load in `ai.js` that throws if any `LEVELS` entry has no bot (catches a new level added without one). Update the README row to the new shape.

- [ ] **Step 4: Run the server tests**

Run: `cd server && node --test`
Expected: all PASS (including `csrf`, `shutdown`, `securityHeaders` which hit `/levels`).

### Task 2: Avatars on S3

**Files:**
- Create (local, not committed if the repo ignores art sources): 27 files `bots/<level>.webp`, 256×256, square, ≤ 30 KB each.

**Interfaces:**
- Produces: `${CHESS_ASSETS_URL}/images/bots/<level>.webp` for every level.

- [ ] **Step 1:** Make the 27 avatars (user's art call: the image generator in `client/src/images/_ideas/generator` or by hand). One consistent style; stronger bots read as stronger.
- [ ] **Step 2:** **User action** — upload to the assets bucket under `images/bots/` the same way the other images were uploaded.
- [ ] **Step 3: Verify:** `curl -sI "$CHESS_ASSETS_URL/images/bots/600.webp"` and `…/3200.webp` → `200`, `content-type: image/webp`.

Tasks 3–5 don't wait on this: they show the fallback until the files exist.

### Task 3: Bots in the level dropdowns and game lists

**Files:**
- Modify: `client/src/js/pages/utils/index.js:110-120` (`loadLevels`), `:79` (game caption)
- Modify: `client/src/js/pages/home/index.js:218,246` (`vs AI // Level …`)
- Create: `client/src/js/gameplay/bots/index.mjs` (shared with Task 4)

**Interfaces:**
- Consumes: Task 1's `/levels` response.
- Produces: `botFor(levelsResponse, aiLevel) -> bot | null` in `client/src/js/gameplay/bots/index.mjs`: maps `aiLevel` through `old_levels`, compares as numbers, returns the matching `levels` entry or `null`.
- Produces: `loadLevels(gameUrl, select)` now resolves to the `/levels` response (or `undefined` on failure) so callers can use `botFor`.

- [ ] **Step 1:** `loadLevels` option text becomes `${name} · ${elo} Elo`; if `name` is missing, keep today's `${elo} Elo`. Return the response.
- [ ] **Step 2:** Home's open/finished game rows and `pages/utils:79` show `vs ${bot.name}` when `botFor` finds one, else today's `Level ${ai_level}` text. Home already awaits `levelsLoaded`; pass its result in.
- [ ] **Step 3: Verify:** `npm run dev`, then open Home, the guest page and Settings: the dropdown lists 27 bot names with Elo, 1300's bot is selected by default, a game row shows "vs <name>". With the server stopped, the dropdown is empty as today and nothing throws.

### Task 4: Picking the moment from the moves (pure, tested)

**Files:**
- Modify: `client/src/js/gameplay/bots/index.mjs`
- Test: `client/test/bots.test.mjs`
- Modify: `package.json` scripts: `"test:client": "node --test client/test"`

**Interfaces:**
- Produces: `momentFor(move, chess, botColor) -> "win" | "check" | "capture" | null` — `move` is a chess.js verbose move just played by the bot (`move.color == botColor`), `chess` is the instance after the move. Priority: `chess.isCheckmate()` → `"win"`, `chess.isCheck()` → `"check"`, `move.captured` → `"capture"`, else `null`. Returns `null` for the player's moves.
- Produces: `endMomentFor(result, botColor) -> "win" | "lose" | null` — `result` is `showGameOver`'s `{ winner }`; draw → `null`.
- Produces: `pickLine(bot, moment, random = Math.random) -> string | null` — random line from `bot.lines[moment]`, `null` if none.

- [ ] **Step 1: Write the failing tests** in `client/test/bots.test.mjs` (use chess.js from the root `node_modules`):
  - `botFor` with `old_levels` `{4: 1600}`: `botFor(res, 4).level == 1600`, `botFor(res, "1600").level == 1600`, `botFor(res, 650) == null`, `botFor(undefined, 1300) == null`.
  - `momentFor`: a bot capture → `"capture"`; a capture that gives check → `"check"`; a mating move → `"win"`; a quiet move → `null`; a player's capture → `null`.
  - `endMomentFor({ winner: "b" }, "b") == "win"`, `({ winner: "w" }, "b") == "lose"`, `({ winner: "draw" }, "b") == null`.
  - `pickLine(bot, "check", () => 0)` is `bot.lines.check[0]`; `pickLine(bot, "nope") == null`.
- [ ] **Step 2: Run:** `npm run test:client` → FAIL (exports missing).
- [ ] **Step 3: Implement** the three functions. No DOM, no `process.env` in this file so Node can load it.
- [ ] **Step 4: Run:** `npm run test:client` → PASS. `npm run lint` → clean.

### Task 5: The bot beside the board and its lines

**Files:**
- Modify: `client/play.html:89-92` (`#gameInfo`): add `<div id="botDisplay" hidden><img id="botAvatar" alt="" width="40" height="40"><span id="botName"></span><p id="botLine" aria-live="polite"></p></div>`
- Modify: `client/src/js/pages/play/index.js:~63` (where the game response is read)
- Modify: `client/src/js/gameplay/index.js:~219` (after the AI's move is applied in `playAi`)
- Modify: `client/src/js/gameplay/menu/index.js:772` (`showGameOver`)
- Modify: `client/src/css/style.css` (bot block + speech bubble, both themes, phone width)
- Modify: `package.json` version → `1.12.0`

**Interfaces:**
- Consumes: `getLevels`, `botFor`, `momentFor`, `endMomentFor`, `pickLine` (Tasks 1, 3, 4).
- Produces: `game.bot` (the bot object or `null`) and `sayLine(moment)` exported from `client/src/js/gameplay/bots/say.js` — shows `pickLine(game.bot, moment)` in `#botLine` for 4 s, a newer line replaces an older one; no-op when `game.bot` is `null`.

- [ ] **Step 1:** On play-page load for an AI game, fetch `/levels`, set `game.bot = botFor(response, game.response.ai_level)`, fill `#botName` (`innerText`) and `#botAvatar.src = ${CHESS_ASSETS_URL}/${bot.avatar}`, unhide. On `img` `error`, hide the `img` and show the name's first letter in a circle. Friend games keep `#opponentDisplay` and never show `#botDisplay`.
- [ ] **Step 2:** Say `start` once only when the loaded game has no moves yet and isn't over (new game or Restart). Not on reload of a game in progress.
- [ ] **Step 3:** In `playAi` after the move is applied: `sayLine(momentFor(move, chessInst, botColor))` when the moment isn't `null`. In `showGameOver(result)`: `sayLine(endMomentFor(result, botColor))` only when `game.ai`; `showGameOver`'s existing "already shown" guard keeps it from firing twice.
- [ ] **Step 4: Verify in the browser** (`npm run dev` + server, 2D and 3D views, desktop and 375 px width):
  - New AI game shows avatar (or fallback letter), name and a start line.
  - Bot capture / check shows the matching line; a capture-with-check shows the check line.
  - Win and lose (forfeit counts as the bot winning) show a line; a draw shows none.
  - Reloading mid-game shows the bot but no line. An old level-4 game shows the 1600 bot.
  - Screen reader announces lines (aria-live), and the block doesn't cover the move list or eval bar.
- [ ] **Step 5:** `cd server && node --test`, `npm run test:client`, `npm run lint` → all pass.

## Done when

Home and the guest page list the 27 bots by name, and an AI game shows the bot's avatar and its lines at start, capture, check, win and lose.
