#!/usr/bin/env bash
#
# Start, stop and check the four ПРОЯВ processes on the server.
#
# This exists because starting them by hand over ssh kept going wrong in ways
# that were invisible until someone hit the endpoint: a `pkill -f` pattern that
# silently matched nothing because the processes run `dist/serve.js` by relative
# path, and chains of `cd … & cd … &` where a failure in one left the others
# half-started. A script that names each service once, checks the port after
# starting, and says plainly what is up removes that whole class of mistake.
#
# It is also the shape a systemd unit needs, so replacing it later is a small
# step rather than a rewrite.
#
#   ./proyav-services.sh start|stop|restart|status
#
set -uo pipefail

ROOT="${PROYAV_ROOT:-$HOME/proyav}"
NODE="${PROYAV_NODE:-$HOME/node24/bin/node}"
LOGS="${PROYAV_LOGS:-$HOME}"

# name | directory | entry point | port | extra env
SERVICES=(
  "prozorro|$ROOT/prozorro|dist/serve.js|8787|"
  "nazk|$ROOT/nazk|dist/serve.js|8789|"
  "edr|$ROOT/edr|dist/serve.js|8791|PORT=8791"
  "gateway|$ROOT/gateway|dist/gateway.js|8888|"
)

port_busy() { ss -tln 2>/dev/null | grep -q ":$1 "; }

# The watchdog calls `start` every five minutes, so anything this script writes
# accumulates forever on a machine nobody watches. Roughly a day of lines is
# enough to answer "did it flap overnight"; older than that has never been
# useful.
trim_logs() {
  for log in "$LOGS"/proyav-watchdog.log "$LOGS"/proyav-boot.log; do
    if [ -f "$log" ] && [ "$(wc -l <"$log" 2>/dev/null || echo 0)" -gt 4000 ]; then
      tail -1000 "$log" >"$log.trim" 2>/dev/null && mv "$log.trim" "$log"
    fi
  done
}

stop_all() {
  # Matches how the processes actually appear in ps: the node binary plus the
  # relative entry path. Matching on the full directory never worked, because
  # each service is started after a `cd` into its own folder.
  pkill -9 -f "$NODE dist/serve.js" 2>/dev/null
  pkill -9 -f "$NODE dist/gateway.js" 2>/dev/null
  sleep 2
}

start_all() {
  for entry in "${SERVICES[@]}"; do
    IFS='|' read -r name dir script port env <<<"$entry"

    if port_busy "$port"; then
      echo "  $name: порт $port уже зайнятий, пропускаю"
      continue
    fi

    (
      cd "$dir" || exit 1
      if [ -n "$env" ]; then
        setsid nohup env "$env" "$NODE" "$script" </dev/null >"$LOGS/proyav-$name.log" 2>&1 &
      else
        setsid nohup "$NODE" "$script" </dev/null >"$LOGS/proyav-$name.log" 2>&1 &
      fi
    )
  done

  # Ports do not bind instantly, and reporting before they do was exactly the
  # false "everything is down" that sent this script into being.
  sleep 4
}

status_all() {
  local failed=0
  for entry in "${SERVICES[@]}"; do
    IFS='|' read -r name dir script port env <<<"$entry"
    if port_busy "$port"; then
      echo "  ✓ $name  :$port"
    else
      echo "  ✖ $name  :$port  НЕ ПРАЦЮЄ — див. $LOGS/proyav-$name.log"
      failed=1
    fi
  done
  return $failed
}

case "${1:-status}" in
  start)
    trim_logs
    echo "запускаю:"
    start_all
    status_all
    ;;
  stop)
    echo "зупиняю все"
    stop_all
    status_all >/dev/null
    echo "зупинено"
    ;;
  restart)
    echo "перезапускаю:"
    stop_all
    start_all
    status_all
    ;;
  status)
    echo "стан:"
    status_all
    ;;
  *)
    echo "використання: $0 start|stop|restart|status" >&2
    exit 1
    ;;
esac
