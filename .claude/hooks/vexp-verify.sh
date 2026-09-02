#!/bin/bash
# vexp-verify: mechanical completion gate on Stop (Horizon). Fails open.
VEXP_BIN="/Users/iladovzenko/.vscode/extensions/vexp.vexp-vscode-3.1.0-darwin-arm64/binaries/vexp-core-darwin-arm64/vexp-core"
[ -x "$VEXP_BIN" ] || exit 0
"$VEXP_BIN" stop-gate 2>/dev/null
exit 0
