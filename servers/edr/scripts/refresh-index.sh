#!/usr/bin/env bash
#
# Weekly refresh of the ЄДР index from the Ministry's open-data dump.
#
# The register republishes the whole file once a week, and until this script
# existed the only way to pick that up was for a person to remember to download
# and import it by hand — so the index aged silently, with nothing anywhere
# showing how stale it had become.
#
# Safe to run repeatedly: the import upserts, so a re-run of the same dump
# changes nothing. Safe to interrupt: the download goes to a temporary file and
# is only imported once it is complete.
#
#   ./refresh-index.sh
#
set -uo pipefail

ROOT="${PROYAV_EDR_ROOT:-$HOME/proyav/edr}"
NODE="${PROYAV_NODE:-$HOME/node24/bin/node}"
WORK="${PROYAV_EDR_WORK:-$HOME/.proyav/edr-refresh}"
LOG="${PROYAV_EDR_LOG:-$HOME/proyav-edr-refresh.log}"

URL="https://data.gov.ua/dataset/03cc1239-3988-4451-aa0d-aadb77448714/resource/d40cc921-39bb-44fd-be06-dc02589f45c6/download/uo.zip"

say() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG"; }

mkdir -p "$WORK"
cd "$WORK" || exit 1

# The unpacked XML is over three gigabytes, so refusing early beats filling the
# disk of a machine that is also running everything else.
FREE_MB=$(df -Pm "$WORK" | awk 'NR==2 {print $4}')
if [ "$FREE_MB" -lt 5000 ]; then
  say "замало місця: вільно ${FREE_MB} МБ, потрібно щонайменше 5000. Пропускаю оновлення."
  exit 1
fi

say "завантажую дамп ЄДР"
if ! curl -sSL --fail --max-time 1800 -o uo.zip.part "$URL"; then
  say "не вдалося завантажити дамп — лишаю попередній індекс як є"
  rm -f uo.zip.part
  exit 1
fi
mv uo.zip.part uo.zip
say "завантажено $(du -h uo.zip | cut -f1)"

say "розпаковую"
if ! unzip -oq uo.zip; then
  say "архів пошкоджений — лишаю попередній індекс як є"
  rm -f uo.zip UO.xml
  exit 1
fi

say "імпортую в індекс"
if "$NODE" "$ROOT/dist/cli.js" import --file="$WORK/UO.xml" >>"$LOG" 2>&1; then
  say "готово"
  "$NODE" "$ROOT/dist/cli.js" stats | tee -a "$LOG"
else
  say "імпорт не вдався — див. лог вище"
fi

# Three and a half gigabytes of temporary files have no reason to sit here for
# a week until the next run.
rm -f uo.zip UO.xml
say "тимчасові файли прибрано"
