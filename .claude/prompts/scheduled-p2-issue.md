Work one priority-2 GitHub issue in this repo and leave the changes uncommitted on a new branch.

1. Preflight
   - Run `git status --porcelain`. If the working tree is not clean, STOP and report — do not stash or discard anything.

2. Choose the issue
   - List open issues: `gh issue list --state open --label "bug priority 2: core" --json number,title,labels,assignees,createdAt` and the same for `--label "priority 2: core"`.
   - Skip issues that are assigned to someone else, or that already have a local/remote branch named `issue-<number>-*` (`git branch -a | grep issue-<number>-`).
   - Pick bugs first, then the oldest (lowest number) remaining issue. If none qualify, STOP and report.
   - Read the full issue and its comments: `gh issue view <number> --comments`.

3. Branch
   - `git checkout develop && git pull origin develop`
   - `git checkout -b issue-<number>-<short-kebab-title>` (match existing style, e.g. `issue-277-data-service-end-access-tokens-on-logout`).

4. Implement
   - Make the change the issue describes, following existing patterns in the codebase. Keep scope to this issue only.
   - Add or update tests where the repo has them for the touched area.
   - Run the repo's lint, type-check, tests and build (see package.json scripts). Fix failures caused by your change.

5. Hand off — do NOT commit, push, or open a PR
   - Leave all changes uncommitted on the new branch.
   - Final report (short): issue number + title, branch name, files changed, test/lint/build results (full output for any failures), and anything left unresolved or needing my decision.
