#!/usr/bin/env bash
#
# Nightly catch-up for the Prozorro index: read whatever changed since the
# saved cursor, then fill in titles and amounts for the newest procedures that
# still lack them.
#
# The `update` command has existed and worked for a while; what was missing was
# anything that ran it. Without this the index was fresh only up to whenever a
# person last happened to run it by hand.
#
# Enrichment is capped per run on purpose: this is one request per procedure to
# a national service, and a nightly job has no business turning into an
# open-ended flood. Whatever it does not reach tonight it reaches tomorrow.
#
#   ./nightly-update.sh
#
set -uo pipefail

ROOT="${PROYAV_PROZORRO_ROOT:-$HOME/proyav/prozorro}"
NODE="${PROYAV_NODE:-$HOME/node24/bin/node}"
LOG="${PROYAV_PROZORRO_LOG:-$HOME/proyav-prozorro-update.log}"
ENRICH="${PROYAV_ENRICH_LIMIT:-20000}"

say() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >>"$LOG"; }

cd "$ROOT" || exit 1

say "нічне оновлення почалось"
if "$NODE" dist/cli.js update --enrich="$ENRICH" >>"$LOG" 2>&1; then
  say "оновлення закупівель завершено"
else
  say "оновлення закупівель завершилось помилкою — див. вище"
fi

# Monitorings are a much smaller feed, and a conclusion that appeared today is
# exactly the thing someone will ask about tomorrow. The detail cap keeps a
# nightly job from turning into an open-ended backfill if something changed in
# bulk.
say "моніторинги Держаудитслужби"
if "$NODE" dist/cli.js audit --detail="${PROYAV_AUDIT_LIMIT:-5000}" >>"$LOG" 2>&1; then
  say "моніторинги оновлено"
else
  say "оновлення моніторингів завершилось помилкою — див. вище"
fi

# Keeps the log from growing without bound on a machine nobody watches.
if [ -f "$LOG" ] && [ "$(wc -l <"$LOG")" -gt 5000 ]; then
  tail -2000 "$LOG" >"$LOG.trim" && mv "$LOG.trim" "$LOG"
fi
