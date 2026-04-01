#!/bin/bash
# Post-commit documentation update hook for Amicus Superbrain
# Triggered by Claude Code after each git commit
# Outputs instructions for Claude to update docs based on what changed

# Get the files changed in the last commit
CHANGED_FILES=$(git diff --name-only HEAD~1 HEAD 2>/dev/null)

if [ -z "$CHANGED_FILES" ]; then
  exit 0
fi

# Check which areas were modified
HAS_MCP_CHANGES=$(echo "$CHANGED_FILES" | grep -c "server/index.ts\|supabase/functions/open-brain-mcp")
HAS_SCHEMA_CHANGES=$(echo "$CHANGED_FILES" | grep -c "\.sql\|schema")
HAS_OUTLOOK_CHANGES=$(echo "$CHANGED_FILES" | grep -c "outlook")
HAS_RECIPE_CHANGES=$(echo "$CHANGED_FILES" | grep -c "recipes/")
HAS_DOC_CHANGES=$(echo "$CHANGED_FILES" | grep -c "docs/amicus-superbrain")

UPDATES_NEEDED=""

if [ "$HAS_MCP_CHANGES" -gt 0 ] && [ "$HAS_DOC_CHANGES" -eq 0 ]; then
  UPDATES_NEEDED="${UPDATES_NEEDED}MCP server changed — update docs/amicus-superbrain/03-mcp-deployment.md (tool count, tool list) and 08-tools-reference.md\n"
fi

if [ "$HAS_SCHEMA_CHANGES" -gt 0 ] && [ "$HAS_DOC_CHANGES" -eq 0 ]; then
  UPDATES_NEEDED="${UPDATES_NEEDED}Schema changed — update docs/amicus-superbrain/02-database-setup.md\n"
fi

if [ "$HAS_OUTLOOK_CHANGES" -gt 0 ] && [ "$HAS_DOC_CHANGES" -eq 0 ]; then
  UPDATES_NEEDED="${UPDATES_NEEDED}Outlook functions changed — update docs/amicus-superbrain/06-email-import.md\n"
fi

if [ "$HAS_RECIPE_CHANGES" -gt 0 ]; then
  UPDATES_NEEDED="${UPDATES_NEEDED}Recipe changed — check if recipes/README.md index needs updating\n"
fi

if [ -n "$UPDATES_NEEDED" ]; then
  echo "DOCUMENTATION UPDATE NEEDED:"
  echo -e "$UPDATES_NEEDED"
  echo "Changed files: $CHANGED_FILES"
fi
