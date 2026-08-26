#!/bin/bash
# vexp-restore: context lifecycle restore on SessionStart (compact/resume). Fails open.
VEXP_BIN="/Users/iladovzenko/.vscode/extensions/vexp.vexp-vscode-2.7.0-darwin-arm64/binaries/vexp-core-darwin-arm64/vexp-core"
[ -x "$VEXP_BIN" ] || exit 0
"$VEXP_BIN" session-context 2>/dev/null
exit 0
