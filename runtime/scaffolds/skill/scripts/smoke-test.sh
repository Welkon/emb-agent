#!/usr/bin/env bash
set -euo pipefail

SELF_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
DEFAULT_SKILL_DIR="$(CDPATH= cd -- "$SELF_DIR/.." && pwd)"
SKILL_DIR_INPUT="${1:-$DEFAULT_SKILL_DIR}"
SKILL_DIR="$(CDPATH= cd -- "$SKILL_DIR_INPUT" && pwd)"
SKILL_NAME="$(basename "$SKILL_DIR")"
SKILLS_DIR="$(dirname "$SKILL_DIR")"
PROJECT_ROOT=""

if [[ "$(basename "$SKILLS_DIR")" == "skills" ]]; then
  PROJECT_ROOT="$(CDPATH= cd -- "$SKILLS_DIR/.." && pwd)"
fi

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

display_path() {
  local file_path="$1"
  if [[ -n "$PROJECT_ROOT" && "$file_path" == "$PROJECT_ROOT/"* ]]; then
    printf '%s\n' "${file_path#"$PROJECT_ROOT"/}"
    return 0
  fi
  printf '%s\n' "$file_path"
}

check_file_exists() {
  local relative_path="$1"
  if [[ -f "$SKILL_DIR/$relative_path" ]]; then
    pass "found $relative_path"
  else
    fail "missing required file $relative_path"
  fi
}

line_count() {
  awk 'END { print NR }' "$1"
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

extract_backtick_paths() {
  awk '
    {
      line = $0
      while (match(line, /`[^`]+`/)) {
        token = substr(line, RSTART + 1, RLENGTH - 2)
        print token
        line = substr(line, RSTART + RLENGTH)
      }
    }
  '
}

resolve_reference_path() {
  local token="$1"
  if [[ -f "$SKILL_DIR/$token" ]]; then
    printf '%s\n' "$SKILL_DIR/$token"
    return 0
  fi
  if [[ -n "$PROJECT_ROOT" && -f "$PROJECT_ROOT/$token" ]]; then
    printf '%s\n' "$PROJECT_ROOT/$token"
    return 0
  fi
  return 1
}

extract_quick_routing_block() {
  local file_path="$1"
  awk '
    $0 == "## Quick Routing" { in_block = 1; next }
    in_block && /^## / { exit }
    in_block { print }
  ' "$file_path" | sed '/^[[:space:]]*$/d'
}

SHELL_FILES=()
if [[ -n "$PROJECT_ROOT" ]]; then
  while IFS= read -r shell_file; do
    [[ -n "$shell_file" ]] && SHELL_FILES+=("$shell_file")
  done <<EOF
$PROJECT_ROOT/AGENTS.md
$PROJECT_ROOT/CLAUDE.md
$PROJECT_ROOT/CODEX.md
$PROJECT_ROOT/GEMINI.md
$PROJECT_ROOT/.codex/instructions.md
$PROJECT_ROOT/.cursor/rules/workflow.mdc
$PROJECT_ROOT/.cursor/skills/$SKILL_NAME/SKILL.md
$PROJECT_ROOT/.windsurf/rules/workflow.md
EOF
fi

HARNESS_MARKERS_FOUND=0
for shell_file in "${SHELL_FILES[@]}"; do
  if [[ -f "$shell_file" ]]; then
    HARNESS_MARKERS_FOUND=1
    break
  fi
done

say "== Structure checks =="
for relative_path in \
  "SKILL.md" \
  "rules/project-rules.md" \
  "rules/auto-triggers.md" \
  "workflows/fix-bug.md" \
  "workflows/update-rules.md" \
  "workflows/maintain-docs.md" \
  "workflows/subagent-driven.md" \
  "references/gotchas.md" \
  "scripts/README.md" \
  "scripts/smoke-test.sh" \
  "scripts/test-trigger.sh"
do
  check_file_exists "$relative_path"
done

if (( HARNESS_MARKERS_FOUND == 1 )); then
  say
  say "== Harness coverage =="
  for shell_file in "${SHELL_FILES[@]}"; do
    if [[ -f "$shell_file" ]]; then
      pass "found harness entry $(display_path "$shell_file")"
    else
      fail "missing harness entry $(display_path "$shell_file")"
    fi
  done
fi

say
say "== Line budget =="
if [[ -f "$SKILL_DIR/SKILL.md" ]]; then
  skill_lines="$(line_count "$SKILL_DIR/SKILL.md")"
  if (( skill_lines <= 100 )); then
    pass "SKILL.md line budget ok ($skill_lines <= 100)"
  else
    fail "SKILL.md exceeds 100 lines ($skill_lines)"
  fi
fi

for shell_file in "${SHELL_FILES[@]}"; do
  if [[ -f "$shell_file" ]]; then
    shell_lines="$(line_count "$shell_file")"
    if (( shell_lines <= 60 )); then
      pass "$(display_path "$shell_file") line budget ok ($shell_lines <= 60)"
    else
      fail "$(display_path "$shell_file") exceeds 60 lines ($shell_lines)"
    fi
  fi
done

say
say "== Placeholder residue =="
PLACEHOLDER_OUTPUT="$(
  {
    grep -R -n -E '\{\{[A-Z0-9_]+\}\}' "$SKILL_DIR" || true
    grep -R -n -E '<!--[[:space:]]*FILL:' "$SKILL_DIR" || true
    for shell_file in "${SHELL_FILES[@]}"; do
      [[ -f "$shell_file" ]] || continue
      grep -n -E '\{\{[A-Z0-9_]+\}\}' "$shell_file" || true
      grep -n -E '<!--[[:space:]]*FILL:' "$shell_file" || true
    done
  } | sed '/^[[:space:]]*$/d'
)"
if [[ -n "$PLACEHOLDER_OUTPUT" ]]; then
  fail "unresolved placeholders remain"
  printf '%s\n' "$PLACEHOLDER_OUTPUT"
else
  pass "no unresolved placeholders"
fi

say
say "== Content quality =="
DESCRIPTION="$(extract_frontmatter_description)"
DESCRIPTION_WORDS="$(count_words "$DESCRIPTION")"
if (( DESCRIPTION_WORDS >= 20 )); then
  pass "description length ok ($DESCRIPTION_WORDS words)"
else
  fail "description is too short ($DESCRIPTION_WORDS words, expected >= 20)"
fi

TRIGGER_COUNT="$(extract_trigger_phrases | sed '/^[[:space:]]*$/d' | wc -l | tr -d ' ')"
if (( TRIGGER_COUNT >= 2 )); then
  pass "auto trigger coverage ok ($TRIGGER_COUNT phrases)"
else
  fail "need at least 2 concrete trigger phrases in rules/auto-triggers.md"
fi

say
say "== Route completeness =="
COMMON_TASKS_BLOCK="$(extract_section "$SKILL_DIR/SKILL.md" "## Common Tasks")"
ROUTE_FAILURES=0
while IFS= read -r token; do
  [[ -n "$token" ]] || continue
  case "$token" in
    rules/*|workflows/*|references/*|scripts/*|skills/*|*.md)
      if resolved="$(resolve_reference_path "$token")"; then
        pass "task reference exists: $token"
      else
        fail "task reference missing: $token"
        ROUTE_FAILURES=$((ROUTE_FAILURES + 1))
      fi
      ;;
  esac
done < <(printf '%s\n' "$COMMON_TASKS_BLOCK" | extract_backtick_paths | sort -u)
if (( ROUTE_FAILURES == 0 )); then
  pass "all referenced task paths resolve"
fi

say
say "== Description consistency =="
CURSOR_SKILL="$PROJECT_ROOT/.cursor/skills/$SKILL_NAME/SKILL.md"
if [[ -n "$PROJECT_ROOT" && -f "$CURSOR_SKILL" ]]; then
  CURSOR_SUMMARY="$(
    awk '
      /^# / { next }
      /^[[:space:]]*$/ { next }
      /^## / { exit }
      { print; exit }
    ' "$CURSOR_SKILL"
  )"
  if [[ "$DESCRIPTION" == "$CURSOR_SUMMARY" ]]; then
    pass "SKILL.md description matches Cursor entry summary"
  else
    fail "SKILL.md description and Cursor entry summary diverge"
  fi
else
  pass "Cursor entry not installed; skipping description consistency"
fi

say
say "== Thin shell consistency =="
REFERENCE_SHELL=""
REFERENCE_BLOCK=""
CONSISTENCY_CHECKED=0
for shell_file in "${SHELL_FILES[@]}"; do
  [[ -f "$shell_file" ]] || continue
  block="$(extract_quick_routing_block "$shell_file")"
  [[ -n "$block" ]] || continue
  if [[ -z "$REFERENCE_SHELL" ]]; then
    REFERENCE_SHELL="$shell_file"
    REFERENCE_BLOCK="$block"
    continue
  fi
  CONSISTENCY_CHECKED=1
  if [[ "$block" == "$REFERENCE_BLOCK" ]]; then
    pass "quick routing matches: $(display_path "$shell_file")"
  else
    fail "quick routing drift: $(display_path "$shell_file") differs from $(display_path "$REFERENCE_SHELL")"
  fi
done
if (( CONSISTENCY_CHECKED == 0 )); then
  pass "no comparable shell suite installed; skipping drift comparison"
fi

say
if (( FAILURES > 0 )); then
  say "smoke-test: $FAILURES failure(s)"
  exit 1
fi

say "smoke-test: ok"
