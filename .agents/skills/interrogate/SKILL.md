---
name: interrogate
description: "Use for \"interrogate\", \"adversarial review\", \"multi-model review\", \"challenge this\", \"stress test this code\", \"find blind spots\", or \"tear this apart\" (/interrogate). Also use before merging a risky diff. Independent reviewers on different model providers challenge a change; the parent synthesizes a verdict."
---

# Interrogate

## Spawning roster agents

This workflow runs on the repo's role agents (see "Agent roster and model routing" in CLAUDE.md or AGENTS.md). Each agent file pins its model and effort, so never pass a model override.

- Claude Code: use the `Agent` tool with `subagent_type: "<agent>"`. Put every parallel spawn in one message with `run_in_background: true`, then wait for the completion notifications instead of polling.
- Codex: spawn the custom agent by its name with the subagent tool offered in the current tool schema, and wait with the host's wait mechanism.
- If a named agent is not available, stop and tell the user to install the roster (`agent-roster` skill). Do not substitute a different agent or model.

Spawn one reviewer per roster seat to adversarially review code changes. The adversarial signal comes from model diversity, not assigned personas. The deliverable is a synthesized verdict. Do NOT auto-apply changes.

## Step 1, Scope

Identify what to review from context:

- If the user points at specific files or a diff, use that.
- If on a feature branch, run `git diff main...HEAD` (or the appropriate base branch) for the full changeset.
- If the user's message references recent work, gather the relevant files.

Package the diff or file contents with any surrounding context files the reviewers need to understand the code.

## Step 2, Intent

Before spawning reviewers, state the intent in one clear paragraph from the user's message, commit messages, the PR description if one exists, and the code. If you're unsure about the intent, ask the user before proceeding.

## Step 3, Spawn Reviewers

Launch all reviewers in a single message, one agent per seat:

| Seat | Agent | Notes |
|------|-------|-------|
| Reviewer A | `interrogate-reviewer` | Always |
| Reviewer B | `interrogate-reviewer-cross` | Always. Runs on a different model provider on purpose, so disagreement between A and B is signal. |
| Reviewer C | `security-reviewer` | Only when the diff touches auth, data access or access policies, migrations, secrets, or boundary input handling |

Read `references/reviewer-prompt.md` and fill in the same template for every reviewer with the stated intent, the diff or file contents, the rubric from `references/rubric.md`, and the code-quality lens from `references/code-quality-review.md`. Reviewer C gets the same template, with the security section of the rubric as its priority.

## Step 4, Synthesize

As results come back, build a unified picture. Parse every reviewer's findings. Merge findings that describe the same issue differently, and note which reviewers raised each one. Findings two or more reviewers raised independently are the highest signal. Read a lone reviewer's finding, but weight it accordingly. Note disagreements. If one reviewer flags something and another explicitly says the opposite, that is context for the verdict.

## Step 5, Lead Judgment

You (the parent) are the lead reviewer, a pragmatic senior engineer, not a neutral aggregator. Lead judgment is never delegated. Read `references/lead-judgment.md` for the full framework. Put every finding in one of four buckets, with the reviewer(s) that raised it and a one-line rationale.

- **Act on**. Real issues affecting correctness, security, or maintainability given the actual goals. They would block a real PR.
- **Consider**. Legitimate, but you're not sure they outweigh the cost of addressing them now. Worth the user's attention.
- **Noted**. Technically valid but not actionable. Context-dependent, premature optimization, or low-impact at this stage.
- **Dismissed**. Wrong, nitpicky, or missing context, with a brief reason.

## Output Format

### Intent
> [The stated intent paragraph from Step 2]

### Reviewers
- Reviewer [label]: [agent name], [N findings] (one bullet per reviewer)

### Act On
[Each: description, which reviewers raised it, why it matters.]

### Consider
[Each: description, which reviewers raised it, the tradeoff.]

### Noted
[Brief list.]

### Dismissed
[Each with a brief rationale.]

### Agreement Map
[Where reviewers agreed and diverged, and what that pattern tells us.]

## Agents

- `interrogate-reviewer`: Reviewer A, adversarial review of the change
- `interrogate-reviewer-cross`: Reviewer B, independent second-provider review of the same change
- `security-reviewer`: Reviewer C, added when the diff touches auth, data access or access policies, migrations, secrets, or boundary input handling

Adapted from pstack by Lauren Tan (MIT); see LICENSE.
