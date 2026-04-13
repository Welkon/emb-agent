#!/usr/bin/env bash
set -euo pipefail

SELF_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
DEFAULT_SKILL_DIR="$(CDPATH= cd -- "$SELF_DIR/.." && pwd)"
SKILL_DIR_INPUT="${1:-$DEFAULT_SKILL_DIR}"
SKILL_DIR="$(CDPATH= cd -- "$SKILL_DIR_INPUT" && pwd)"

FAILURES=0

say() {
  printf '%s\n' "$*"
}

fail() {
  say "FAIL: $*"
  FAILURES=$((FAILURES + 1))
}

pass() {
  say "PASS: $*"
}

extract_frontmatter_description() {
  awk '
    BEGIN { in_head = 0 }
    NR == 1 && $0 == "---" { in_head = 1; next }
    in_head && $0 == "---" { exit }
    in_head && $0 ~ /^description:[[:space:]]*/ {
      sub(/^description:[[:space:]]*/, "", $0)
      print
      exit
    }
  ' "$SKILL_DIR/SKILL.md"
}

extract_section() {
  local file_path="$1"
  local heading="$2"
  awk -v heading="$heading" '
    $0 == heading { in_section = 1; next }
    in_section && /^## / { exit }
    in_section { print }
  ' "$file_path"
}

extract_trigger_phrases() {
  awk '
    /^[[:space:]]*-[[:space:]]*Phrase:/ { expect = 1; next }
    expect {
      if ($0 ~ /FILL:/) {
        expect = 0
        next
      }
      if ($0 ~ /^[[:space:]]*$/) {
        next
      }
      gsub(/^[[:space:]]+/, "", $0)
      print
      expect = 0
    }
  ' "$SKILL_DIR/rules/auto-triggers.md"
}

count_words() {
  awk '
    {
      for (i = 1; i <= NF; i += 1) {
        count += 1
      }
    }
    END { print count + 0 }
  ' <<<"$1"
}

normalize_tokens() {
  tr '[:upper:]' '[:lower:]' \
    | sed 's/`[^`]*`/ /g' \
    | sed 's/[^a-z0-9][^a-z0-9]*/ /g' \
    | awk '
        {
          for (i = 1; i <= NF; i += 1) {
            if (length($i) >= 4) {
              print $i
            }
          }
        }
      ' \
    | sort -u
}

DESCRIPTION="$(extract_frontmatter_description)"
DESCRIPTION_WORDS="$(count_words "$DESCRIPTION")"
TRIGGER_PHRASES="$(extract_trigger_phrases | sed '/^[[:space:]]*$/d')"
TRIGGER_COUNT="$(printf '%s\n' "$TRIGGER_PHRASES" | sed '/^[[:space:]]*$/d' | wc -l | tr -d ' ')"
COMMON_TASKS="$(
  extract_section "$SKILL_DIR/SKILL.md" "## Common Tasks" \
    | sed 's/<!--[^>]*-->//g' \
    | sed '/^[[:space:]]*$/d'
)"
DISCOVERY_POOL="$(printf '%s\n%s\n' "$DESCRIPTION" "$TRIGGER_PHRASES")"
POOL_TOKENS="$(printf '%s\n' "$DISCOVERY_POOL" | normalize_tokens)"

say "Static trigger preflight only."
say "This checks description and trigger coverage against Common Tasks."
say

if (( DESCRIPTION_WORDS >= 20 )); then
  pass "description length ok ($DESCRIPTION_WORDS words)"
else
  fail "description is too short for discovery ($DESCRIPTION_WORDS words, expected >= 20)"
fi

if (( TRIGGER_COUNT >= 2 )); then
  pass "auto trigger phrase count ok ($TRIGGER_COUNT)"
else
  fail "need at least 2 concrete trigger phrases in rules/auto-triggers.md"
fi

TASK_COUNT=0
while IFS= read -r task_line; do
  [[ -n "$task_line" ]] || continue
  TASK_COUNT=$((TASK_COUNT + 1))
  PROMPT="$(printf '%s\n' "$task_line" | sed 's/^[[:space:]-]*//')"
  OVERLAP="$(comm -12 <(printf '%s\n' "$PROMPT" | normalize_tokens) <(printf '%s\n' "$POOL_TOKENS") | wc -l | tr -d ' ')"
  if (( OVERLAP >= 2 )); then
    pass "trigger coverage ok for Common Task: $PROMPT"
  else
    fail "description/trigger coverage too weak for Common Task: $PROMPT"
  fi
done <<<"$COMMON_TASKS"

if (( TASK_COUNT == 0 )); then
  fail "Common Tasks is empty or still placeholder-only"
fi

say
if (( FAILURES > 0 )); then
  say "test-trigger: $FAILURES failure(s)"
  exit 1
fi

say "test-trigger: ok"
