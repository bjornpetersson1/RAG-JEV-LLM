#!/usr/bin/env bash
# Move an issue on the "Legal RAG POC" project board.
# Usage: .claude/scripts/set-issue-status.sh <issue-number> "<Todo|In Progress|In Review|Done>"
set -euo pipefail

OWNER=bjornpetersson1
PROJECT=4
ISSUE=${1:?issue number required}
STATUS=${2:?status name required}

project_id=$(gh project view "$PROJECT" --owner "$OWNER" --format json --jq .id)
field_json=$(gh project field-list "$PROJECT" --owner "$OWNER" --format json --jq '.fields[] | select(.name=="Status")')
field_id=$(jq -r .id <<<"$field_json")
option_id=$(jq -r --arg s "$STATUS" '.options[] | select(.name==$s) | .id' <<<"$field_json")
[[ -n "$option_id" ]] || { echo "Unknown status: $STATUS" >&2; exit 1; }

item_id=$(gh project item-list "$PROJECT" --owner "$OWNER" --format json --limit 500 \
  --jq ".items[] | select(.content.number==$ISSUE) | .id")
[[ -n "$item_id" ]] || { echo "Issue #$ISSUE is not on project $PROJECT" >&2; exit 1; }

gh project item-edit --id "$item_id" --project-id "$project_id" --field-id "$field_id" \
  --single-select-option-id "$option_id" >/dev/null
echo "#$ISSUE → $STATUS"
