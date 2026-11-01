#!/usr/bin/env bash
#
#  deploy.sh  --  chess frontend
#	One command deploy of main from GitHub (#195), run from any machine with the SSH key loaded (ssh-add). It logs in to
#	Chess-Stockfish with the key forwarded and pipes itself over, so the steps below --on-server run there: data service
#	first, then the chess server's copy, install, client build and restart, checking each one comes back up.
#	It keeps the running version in ~/chess-previous & ~/data-service-previous on each instance, so a rollback is one command.
#
#	deploy/deploy.sh                          deploy main
#	deploy/deploy.sh --rollback               go back to the version before the last deploy
#	deploy/deploy.sh --data-service-packages  also npm ci on the data service, for a changed lock file (needs an upkeep window)
#	BRANCH=other HOST=ubuntu@1.2.3.4 SITE=https://example.com deploy/deploy.sh
#

set -euo pipefail

# ---------- ON YOUR MACHINE ----------

if [[ "${1:-}" != --on-server ]]; then
	HOST="${HOST:-ubuntu@52.11.177.148}"
	SITE="${SITE:-https://chess.aws-prac-route53.com}"
	BRANCH="${BRANCH:-main}"
	ACTION=deploy
	PACKAGES=no

	case "${1:-}" in
		"") ;;
		--rollback) ACTION=rollback ;;
		--data-service-packages) PACKAGES=yes ;;
		*) echo "usage: $0 [--rollback | --data-service-packages]" >&2; exit 2 ;;
	esac

	if [[ ! "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]]; then
		echo "Bad branch name: $BRANCH" >&2
		exit 2
	fi

	result=0
	ssh -A -o BatchMode=yes "$HOST" bash -s -- --on-server "$ACTION" "$BRANCH" "$PACKAGES" < "$0" || result=$?

	# THE CHECK A PLAYER WOULD SEE: THROUGH DNS, nginx & HTTPS. /api/chess/levels ANSWERS WITHOUT DYNAMODB OR AUTH0
	echo "==> Checking $SITE"
	up=no
	for _ in 1 2 3 4 5 6 7 8 9 10; do
		if curl -fsS -m 5 -o /dev/null "$SITE/api/chess/levels" 2>/dev/null; then
			up=yes
			break
		fi
		sleep 3
	done

	if [[ "$up" == no ]]; then
		echo "SITE DOWN: $SITE/api/chess/levels isn't answering. To go back: $0 --rollback" >&2
		exit 1
	fi
	if [[ "$result" != 0 ]]; then
		echo "$ACTION FAILED (exit $result), but the site is answering." >&2
		exit "$result"
	fi
	echo "OK: $ACTION finished and the site is up."
	exit 0
fi

# ---------- ON CHESS-STOCKFISH (STDIN IS THIS SCRIPT, SO main RUNS WITH </dev/null) ----------

ACTION="$2"
BRANCH="$3"
PACKAGES="$4"

REPO=https://github.com/Joeychez23/Chess.git
CHESS_DIR=/opt/chess
CHESS_PREVIOUS="$HOME/chess-previous"
DATA_HOST=ubuntu@172.31.64.10
DATA_DIR=/opt/data-service
DATA_URL=http://172.31.64.10:8090/health
CHESS_URL=http://127.0.0.1:8080/api/chess/levels
SYSTEMD_DIR=/etc/systemd/system

# SET WHEN A DEPLOY STARTS CHANGING THINGS, REMOVED ONCE IT'S HEALTHY. WHILE IT'S THERE THE LIVE COPY MAY BE BROKEN,
# SO THE NEXT DEPLOY MUST NOT SAVE IT OVER THE LAST GOOD VERSION
UNFINISHED="$HOME/.chess-deploy-unfinished"

# LEFT ALONE IN /opt/chess BY EVERY COPY: SECRETS, ASSETS, & WHAT DOESN'T RUN THERE
CHESS_KEEP=(--exclude .env --exclude /.git --exclude /stockfish --exclude /terraform --exclude /data-service --exclude /client/src/images --exclude /client/src/audio)
DATA_KEEP="--exclude .env --exclude auth0-jwks.json"

step="starting"
touched=no
NEW=""

on_data() {
	ssh -o BatchMode=yes "$DATA_HOST" "$@"
}

on_exit() {
	local code=$?
	[[ -n "$NEW" ]] && rm -rf "$NEW"
	if [[ "$code" != 0 ]]; then
		if [[ "$touched" == yes ]]; then
			echo "FAILED while: $step. The live copy may be half changed. To go back: deploy/deploy.sh --rollback" >&2
		else
			echo "STOPPED while: $step. Nothing on the instances changed." >&2
		fi
	fi
}

say() {
	step="$1"
	echo "==> $1"
}

die() {
	echo "$1" >&2
	exit 1
}

wait_for() {
	for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
		if curl -fsS -m 3 -o /dev/null "$1" 2>/dev/null; then
			return 0
		fi
		sleep 2
	done
	return 1
}

check_data_service() {
	if ! wait_for "$DATA_URL"; then
		on_data journalctl -u data-service -n 20 --no-pager || true
		die "The data service isn't answering $DATA_URL"
	fi
}

check_chess() {
	if ! wait_for "$CHESS_URL"; then
		journalctl -u chess -n 20 --no-pager || true
		die "The chess server isn't answering $CHESS_URL"
	fi
}

commit_in() {
	cat "$1/.deployed-commit" 2>/dev/null || echo unknown
}

# A NON-INTERACTIVE LOGIN DOESN'T LOAD nvm, & nvm.sh ISN'T SAFE UNDER set -eu
load_node() {
	set +eu
	local file
	for file in /opt/nvm/nvm.sh "$HOME/.nvm/nvm.sh"; do
		if [[ -s "$file" ]]; then
			. "$file"
			break
		fi
	done
	set -eu
	command -v npm >/dev/null || die "npm isn't on the PATH on Chess-Stockfish"
}

# COPIED TO ONE SIDE FIRST, SO A COPY THAT DIES HALFWAY NEVER REPLACES THE GOOD ONE. KEEPS client/dist & THE node_modules THAT
# RUN, SO A ROLLBACK NEEDS NO INSTALL OR BUILD. NOT THE ROOT node_modules, THAT ONLY BUILDS
save_previous() {
	if [[ -e "$UNFINISHED" ]]; then
		echo "    The last deploy didn't finish: keeping the version saved before it"
		return
	fi

	rm -rf "$CHESS_PREVIOUS.new"
	rsync -a "${CHESS_KEEP[@]}" --exclude /node_modules "$CHESS_DIR/" "$CHESS_PREVIOUS.new/"
	rm -rf "$CHESS_PREVIOUS"
	mv "$CHESS_PREVIOUS.new" "$CHESS_PREVIOUS"

	on_data "rm -rf ~/data-service-previous.new && rsync -a $DATA_KEEP $DATA_DIR/ ~/data-service-previous.new/ && rm -rf ~/data-service-previous && mv ~/data-service-previous.new ~/data-service-previous"
}

# THE CODE IS LIVE BUT A CHANGED UNIT ISN'T INSTALLED BY THIS SCRIPT: IT NEEDS ITS OWN STEP (deploy/README.md)
warn_unit() {
	echo "    WARNING: $1 differs from what's installed. See deploy/README.md -> Updating, logs and fixes" >&2
}

deploy() {
	say "Checking the data service can be reached"
	on_data true || die "Can't log in to the data service. Load your key on your machine first: ssh-add <key file>"

	say "Getting $BRANCH from GitHub"
	NEW="$(mktemp -d)"
	git clone --quiet --depth 1 --branch "$BRANCH" "$REPO" "$NEW"
	local commit before
	commit="$(git -C "$NEW" rev-parse --short HEAD)"
	before="$(commit_in "$CHESS_DIR")"
	echo "    $before -> $commit"

	# IT HAS NO INTERNET OUTSIDE AN UPKEEP WINDOW, SO NEW PACKAGES WOULD LEAVE IT UNABLE TO START. STOP BEFORE ANYTHING CHANGES
	say "Checking the data service's packages"
	local lock_changed=no
	if ! on_data cat "$DATA_DIR/package-lock.json" | cmp -s - "$NEW/data-service/package-lock.json"; then
		lock_changed=yes
	fi
	if [[ "$lock_changed" == yes && "$PACKAGES" != yes ]]; then
		die "data-service/package-lock.json changed. Open an upkeep window (terraform apply -var maintenance=true), run deploy/deploy.sh --data-service-packages, then close it (terraform apply)."
	fi
	if [[ "$PACKAGES" == yes ]] && ! on_data "curl -sS -m 5 -o /dev/null https://registry.npmjs.org/"; then
		die "The data service can't reach npm: open the upkeep window first (terraform apply -var maintenance=true)."
	fi

	load_node

	say "Saving the running version"
	save_previous
	touched=yes
	touch "$UNFINISHED"

	say "Updating the data service"
	# shellcheck disable=SC2086
	rsync -a --delete --exclude node_modules $DATA_KEEP --exclude test "$NEW/data-service/" "$DATA_HOST:$DATA_DIR/"
	if [[ "$PACKAGES" == yes ]]; then
		on_data "cd $DATA_DIR && . /opt/nvm/nvm.sh && npm ci --omit=dev"
	fi
	on_data sudo systemctl restart data-service
	say "Checking the data service came back"
	check_data_service

	say "Copying the chess server"
	rsync -a --delete "${CHESS_KEEP[@]}" --exclude node_modules --exclude dist "$NEW/" "$CHESS_DIR/"

	say "Building the client"
	(cd "$CHESS_DIR" && npm ci && npm run build)

	say "Installing the server's packages"
	(cd "$CHESS_DIR/server" && npm ci --omit=dev)
	echo "$commit" > "$CHESS_DIR/.deployed-commit"

	say "Restarting the chess server"
	sudo systemctl restart chess
	say "Checking the chess server came back"
	check_chess

	rm -f "$UNFINISHED"

	cmp -s "$NEW/deploy/chess.service" "$SYSTEMD_DIR/chess.service" || warn_unit deploy/chess.service
	cmp -s "$NEW/deploy/chess-logs.service" "$SYSTEMD_DIR/chess-logs.service" || warn_unit deploy/chess-logs.service
	on_data cat "$SYSTEMD_DIR/data-service.service" | cmp -s - "$NEW/deploy/data-service.service" || warn_unit deploy/data-service.service

	echo "    Deployed $commit (was $before)"
}

rollback() {
	say "Checking there's a saved version"
	[[ -d "$CHESS_PREVIOUS" ]] || die "No saved version in $CHESS_PREVIOUS: nothing has been deployed with this script yet."
	on_data test -d '~/data-service-previous' || die "No saved version on the data service."
	local before target
	before="$(commit_in "$CHESS_DIR")"
	target="$(commit_in "$CHESS_PREVIOUS")"
	echo "    $before -> $target"

	touched=yes

	# THE REVERSE OF A DEPLOY: THE SERVER GOES BACK BEFORE THE DATA SERVICE IT TALKS TO
	say "Restoring the chess server"
	rsync -a --delete "${CHESS_KEEP[@]}" --exclude /node_modules "$CHESS_PREVIOUS/" "$CHESS_DIR/"
	sudo systemctl restart chess
	say "Checking the chess server came back"
	check_chess

	say "Restoring the data service"
	on_data "rsync -a --delete $DATA_KEEP ~/data-service-previous/ $DATA_DIR/ && sudo systemctl restart data-service"
	say "Checking the data service came back"
	check_data_service

	rm -f "$UNFINISHED"
	echo "    Rolled back to $target (was $before)"
}

main() {
	trap on_exit EXIT
	"$ACTION"
}

main </dev/null
exit
