# Contributing

Thanks for helping with Chess. This project is proprietary (see [LICENSE](LICENSE)), so read the [Contributions and the license](#contributions-and-the-license) section before opening a pull request.

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately as described in [SECURITY.md](SECURITY.md), not in a public issue.

## Reporting bugs and asking for features

Open an [issue](https://github.com/Joeychez23/Chess/issues/new/choose) with the **Bug report** or **Feature request** template. For a bug, say what happened, what you expected, the steps to get there, and your device and browser. Check the [open issues](https://github.com/Joeychez23/Chess/issues) first; most planned features already have one.

## Setting up

The quick start is in the README's [Quick start](README.md#quick-start), the `.env` files are in the [client](client/README.md#setup), [server](server/README.md#setup) and [data service](data-service/README.md) READMEs, and the run commands are in [client/README.md](client/README.md#run). You'll need Node 24+, an Auth0 app, a local session key pair, and AWS credentials for the DynamoDB tables (used by `data-service/`).

## Making a change

1. Branch from `develop` as `issue-<n>-<keywords>`, for example `issue-252-session-keys`.
2. Keep to one change per pull request. Big features have sub-issues; do them one at a time.
3. Update the folder's README in the same pull request when you change a route, a Socket.IO event, a stored field or a deploy step.
4. Open a pull request into `develop` (it goes into `main` once a group of issues is done). The template asks for a short summary, the changes, the commits and the related issues. Write `Closes #N` for each issue it finishes so GitHub closes it on merge.

Run `npm test` in `server/` and `data-service/` before opening a pull request, and add tests in the folder you changed (see the [server](server/README.md#tests) and [data service](data-service/README.md#tests) READMEs). CI runs both and the client build on every pull request. The tests don't cover the board drawing, so also say in the pull request how you checked the change in the browser (for example: played an AI game and a friend game in two browsers, on desktop and on a phone).

## Code style

Match the code around you:

- Tabs, plain JavaScript, no framework. The server uses CommonJS (`require`, `module.exports`).
- A section banner (`/* ---- */` then `// Name`) before each function, and a JSDoc-style `@description` / `@param` / `@return` comment on it.
- Inline comments at the end of the line, in capitals, saying why.
- `/api/chess` responses keep the `{ status, ..., message }` shape.
- New sprites go at the end of `SPRITES` in `client/src/js/gameplay/sprites/index.js`, so existing image numbers don't change.
- Only `data-service/` touches DynamoDB. Writes that could race use a condition, and a new kind of call also goes in the IAM policy in `terraform/modules/data_service/main.tf`.
- `utils/validate.js`, `rating.js`, `username.js`, `signature.js` and `sessionKeys.js` are the same file in `server/` and `data-service/`; a test fails if they differ.
- `chess.js` is pinned to `1.4.0` everywhere; change them together.
- Never commit a `.env`, a key (`*.pem`) or `auth0-jwks.json`.

## Contributions and the license

This repository isn't open source. You may read the code on GitHub, but you may not reuse it outside this project without written permission (see [LICENSE](LICENSE)).

By opening a pull request, you confirm that you wrote the contribution (or have the right to submit it), and you agree that the project owner may use, change and distribute it as part of this project under the project's license.
