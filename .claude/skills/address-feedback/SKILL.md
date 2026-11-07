---
name: address-feedback
description: Collect, investigate, and address PR feedback.
argument-hint: <pr-url>
---

## Context Gathering

If no PR URL is provided:

1. Check if there's an open PR for the current branch using `gh pr view --json url,number`
2. If a PR exists, use it automatically
3. If no PR exists, use AskUserQuestion to request a PR URL

From the provided or detected PR:

1. Extract PR number and repo from the URL
2. Switch to the corresponding branch (skip if already on it)
3. Pull all feedback. For every comment, capture: the body, **all replies**, **reactions** (especially from the PR author), and (for review threads) the **resolved/unresolved** state — these are the signals that tell you a thread is already settled.
   - GitHub PR-level comments (issue comments)
   - GitHub review thread comments (line-level) — use `gh pr view <pr> --json reviewThreads` to get thread structure plus resolution status in one call; reactions can be fetched per-comment via the GraphQL API

## Analysis

Extract every actionable item:

- Questions needing answers
- Requested changes
- Nits/style suggestions
- Bug reports
- Blocking concerns

For each item, determine:

1. **Status**: Already addressed in current code, or still outstanding?
2. **Action needed**: Fix now, defer (with reason), or needs clarification?
3. **Solution**: If a fix is needed, propose the approach. If the reviewer suggested a solution, evaluate it and
   use it if sound.

Group related items together to avoid duplicate work.

## Present Findings

Organize by priority:

1. **Blocking** - Must fix before merge
2. **Should fix** - Reasonable changes that improve the PR
3. **Optional** - Nits or suggestions that could be deferred

For each item, show:

- Source (GitHub comment link + author)
- Summary of feedback
- Current status
- Recommended action + solution

Use AskUserQuestion (multiselect) to let me choose which items to address.

## Implementation

Fix selected items. If anything is unclear or requires a design decision, use AskUserQuestion before proceeding.

## Wrap Up

Provide a summary of changes with file locations for verification.

After I confirm, create **one commit per fix** with:

- Title: Brief description of what was fixed (e.g., "Fix null check in this file")
- Body: 1-2 sentences explaining the feedback addressed
