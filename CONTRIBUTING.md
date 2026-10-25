# Contributing

Thanks for helping with Chess. This project is proprietary (see [LICENSE](LICENSE)), so read the [Contributions and the license](#contributions-and-the-license) section before opening a pull request.

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately as described in [SECURITY.md](SECURITY.md), not in a public issue.

## Reporting bugs and asking for features

Open an [issue](https://github.com/Joeychez23/Chess/issues/new/choose) with the **Bug report** or **Feature request** template. For a bug, say what happened, what you expected, the steps to get there, and your device and browser. Check the [open issues](https://github.com/Joeychez23/Chess/issues) first; most planned features already have one.

## Setting up

Setup, the `.env` files and the run commands are in the README's [Setup](README.md#setup) and [Run](README.md#run) sections. You'll need Node 22+, an Auth0 app and AWS credentials for the DynamoDB tables.

## Making a change

1. Branch from `main` with a short name for the change, for example `knight-movement` or `restart-slide`.
2. Keep to one change per pull request. Big features have sub-issues; do them one at a time.
3. Update the README in the same pull request when you change a route, a Socket.IO event, a stored field or a deploy step.
4. Open a pull request into `main`. The template asks for a short summary, the changes, the commits and the related issues. Write `Closes #N` for each issue it finishes so GitHub closes it on merge.

Run `cd server && npm test` before opening a pull request, and add tests for server changes in `server/test/` (see the README's [Tests](README.md#tests) section). CI runs the tests and the client build on every pull request. The tests don't cover the board drawing, so also say in the pull request how you checked the change in the browser (for example: played an AI game and a friend game in two browsers, on desktop and on a phone).

## Code style

Match the code around you:

- Tabs, plain JavaScript, no framework. The server uses CommonJS (`require`, `module.exports`).
- A section banner (`/* ---- */` then `// Name`) before each function, and a JSDoc-style `@description` / `@param` / `@return` comment on it.
- Inline comments at the end of the line, in capitals, saying why.
- `/api/chess` responses keep the `{ status, ..., message }` shape.
- New sprites go at the end of `SPRITES` in `client/src/js/gameplay/sprites/index.js`, so existing image numbers don't change.
- DynamoDB writes that could race use a condition, and a new kind of DynamoDB call also goes in the IAM policy in `terraform/modules/server/main.tf`.
- `chess.js` is pinned to the same version on the client and the server; change both together.

## Contributions and the license

This repository isn't open source. You may read the code on GitHub, but you may not reuse it outside this project without written permission (see [LICENSE](LICENSE)).

By opening a pull request, you confirm that you wrote the contribution (or have the right to submit it), and you agree that the project owner may use, change and distribute it as part of this project under the project's license.
