# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue, pull request or discussion.

Go to the repository's **Security** tab and choose **[Report a vulnerability](https://github.com/Joeychez23/Chess/security/advisories/new)**. Only the maintainer can see the report.

Include:

- What the problem is and what someone could do with it
- Where it is: the url, API route, Socket.IO event or file
- Steps to reproduce it, or a proof of concept
- Anything you've already tried or noticed

You'll get a reply in the advisory. Once it's fixed, the advisory can be published with credit to you if you'd like.

## What's covered

- The live site, [chess.aws-prac-route53.com](https://chess.aws-prac-route53.com/), including `/api` and `/socket.io`
- The code in this repository on `main`, including the Terraform and deploy files
- The engine API at `engine.aws-prac-route53.com` (its code is in [Joeychez23/Chess-Engine](https://github.com/Joeychez23/Chess-Engine))

Only the latest `main` and the live site are supported. Older commits don't get fixes.

## Please don't

- Run denial-of-service or load tests against the live site or the engine
- Access, change or delete other players' accounts or games; use your own test accounts
- Test Auth0, AWS or GitHub themselves. Report problems in those services to them
