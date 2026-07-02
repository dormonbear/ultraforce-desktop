#!/usr/bin/env bash
# Architecture guardrails. Fast greps that keep paid-off debt from creeping
# back — see "Architecture rules" in CLAUDE.md. Run from the repo root.
set -u
cd "$(dirname "$0")/.."
fail=0
err() {
  echo "check-arch: $1" >&2
  fail=1
}

# 1. Single Apex parsing stack: the legacy CST modules must not come back.
for f in lexer parser cst cst_context cst_scope complete resolve; do
  if [ -e "crates/apex-lang/src/$f.rs" ]; then
    err "legacy apex-lang module reintroduced: crates/apex-lang/src/$f.rs (ast/* is the only stack)"
  fi
done

# 2. IPC errors cross the boundary as CommandError, never Debug strings.
if grep -rn 'format!("{e:?}")\|format!("{:?}"' desktop/src-tauri/src --include='*.rs'; then
  err "Debug-formatted IPC error above — return CommandError instead"
fi

# 3. Every invoke goes through the typed layer in desktop/src/ipc/.
if grep -rl '@tauri-apps/api/core' desktop/src --include='*.ts' --include='*.tsx' \
  | grep -v '^desktop/src/ipc/'; then
  err "raw tauri invoke outside desktop/src/ipc/ above — add a typed wrapper"
fi

# 4. 800-line cap, ratchet style: the baseline list below is grandfathered
#    and may only shrink. New files (or files newly crossing) must be split.
baseline="
crates/apex-lang/src/ast/parser.rs
crates/features/src/soql.rs
desktop/src-tauri/src/dto.rs
crates/soql-lang/src/complete.rs
"
while read -r lines file; do
  [ "$file" = "total" ] && continue
  [ "$lines" -le 800 ] && continue
  case "$baseline" in *"$file"*) continue ;; esac
  err "$file is $lines lines (cap 800) — split it"
done < <(find crates desktop/src desktop/src-tauri/src \
  \( -name '*.rs' -o -name '*.ts' -o -name '*.tsx' \) -not -path '*/node_modules/*' \
  -print0 | xargs -0 wc -l | awk '{print $1, $2}')

exit "$fail"
