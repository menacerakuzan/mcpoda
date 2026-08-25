#!/usr/bin/env bash
#
# Збирає повний індекс закупівель Prozorro. Розрахований на те, щоб залишити
# його на ніч: усе резюмоване, тож перерваний запуск продовжується з того ж
# місця, а не починається спочатку.
#
#   ./scripts/build-index.sh              повний індекс: історія з 2015 і збагачення
#   ./scripts/build-index.sh --years=5    лише останні роки
#   ./scripts/build-index.sh --recent     тільки свіже, десь пів години
#
# Зупинити можна будь-коли: Ctrl+C або просто закрити ноутбук. Наступний запуск
# підхопить з курсора.

set -uo pipefail
cd "$(dirname "$0")/.."

YEARS=""
RECENT_ONLY=0
ENRICH_BATCH=5000

for arg in "$@"; do
  case "$arg" in
    --years=*) YEARS="${arg#*=}" ;;
    --recent) RECENT_ONLY=1 ;;
    --enrich=*) ENRICH_BATCH="${arg#*=}" ;;
    *) echo "невідомий аргумент: $arg" >&2; exit 1 ;;
  esac
done

LOG_DIR="${PROYAV_LOG_DIR:-$HOME/.proyav}"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/build-$(date +%Y%m%d-%H%M%S).log"

say() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }

say "збірка індексу починається"
say "лог: $LOG"

if [ ! -f dist/index.js ]; then
  say "збираємо проєкт"
  npm run build >>"$LOG" 2>&1
fi

# Свіже завжди першим: індекс стає корисним за пів години, а не за ніч.
say "крок 1: свіжі процедури"
node dist/cli.js crawl --recent 2>&1 | tee -a "$LOG" | tail -1

if [ "$RECENT_ONLY" -eq 0 ]; then
  say "крок 2: історія"
  if [ -n "$YEARS" ]; then
    FROM=$(date -v-"${YEARS}"y +%Y-%m-%d 2>/dev/null || date -d "${YEARS} years ago" +%Y-%m-%d)
    say "починаємо з $FROM"
    node dist/cli.js crawl --from="$FROM" 2>&1 | tee -a "$LOG" | tail -1
  else
    node dist/cli.js crawl 2>&1 | tee -a "$LOG" | tail -1
  fi
fi

# Назв і сум у стрічці немає взагалі, тому це окремий прохід: один запит на
# процедуру, найновіші першими. Крутиться, доки є що збагачувати.
say "крок 3: назви, суми та коди CPV"
while :; do
  OUT=$(node dist/cli.js enrich --limit="$ENRICH_BATCH" 2>&1 | tail -1)
  echo "$OUT" >>"$LOG"
  UPDATED=$(echo "$OUT" | grep -oE 'оновлено [0-9]+' | grep -oE '[0-9]+' || echo 0)
  say "збагачено $UPDATED"
  [ "${UPDATED:-0}" -gt 0 ] || break
done

say "готово"
node dist/cli.js stats | tee -a "$LOG"
