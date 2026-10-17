---
name: reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect or /reflect. Also OFFER (do not run) reflect at the end of a long session with repeated user corrections.
---

# Reflect

## Spawning roster agents

This workflow runs on the repo's role agents (see "Agent roster and model routing" in CLAUDE.md or AGENTS.md). Each agent file pins its model and effort, so never pass a model override.

- Claude Code: use the `Agent` tool with `subagent_type: "<agent>"`. Put every parallel spawn in one message with `run_in_background: true`, then wait for the completion notifications instead of polling.
- Codex: spawn the custom agent by its name with the subagent tool offered in the current tool schema, and wait with the host's wait mechanism.
- If a named agent is not available, stop and tell the user to install the roster (`agent-roster` skill). Do not substitute a different agent or model.

Mine the current conversation for durable learnings, then route them into skill edits.

Invoke when the user says "reflect" or "/reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings. After a long session with repeated user corrections, offer reflect in one line and wait; never start it unprompted.

## 1. Locate the active transcript

Before fanning out, find this conversation's transcript in the current project's transcript directory only. Never glob across other projects' directories: that crosses workspace boundaries and reads private chats from unrelated projects.

- Claude Code: `~/.claude/projects/<cwd-slug>/<session-id>.jsonl`, where `<cwd-slug>` is the working directory path with separators replaced by `-`. Subagent transcripts live under `<session-id>/subagents/`.
- Codex: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. Check today's directory first, then recent days. Skip files whose recorded working directory is not this project.

```bash
ls -t ~/.claude/projects/<cwd-slug>/*.jsonl ~/.claude/projects/<cwd-slug>/*/subagents/*.jsonl 2>/dev/null | head -10
ls -t ~/.codex/sessions/$(date +%Y/%m/%d)/rollout-*.jsonl 2>/dev/null | head -10
```

For each candidate, read the first user message in the JSONL. Take the file whose first user message matches the conversation's opening user prompt. If none matches, pass a tight digest of the session instead.

## 2. Spawn three reviewers in parallel

One batch, three spawns, all in a single message. Reviewers need MCP access to look up the tickets, chat threads, and observability traces the transcript references, which the agents' inherited tools provide.

| Lens | Agent | Prompt template |
|---|---|---|
| Judgment | `reflect-reviewer` (lens: judgment) | `references/judgment-reviewer.md` |
| Divergent | `reflect-reviewer` (lens: divergent) | `references/divergent-reviewer.md` |
| Tooling | `reflect-tooling` | `references/tooling-reviewer.md` |

Pass each template verbatim, substituting the transcript path or digest where marked. Reviewers return findings in their response.

## 3. Synthesize

One spawn of `reflect-reviewer` (lens: synthesizer). It spot-verifies citations through MCP. Pass `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. It returns an Accepted / Rejected / Backlog list.

## 4. Structural enforcement check

Move any Accepted item that a lint rule, script, metadata flag, or runtime check would enforce more reliably to Backlog. Skill prose is for what mechanisms cannot enforce.

## 5. Apply

Present the synthesizer's full Accepted / Rejected / Backlog output and wait for explicit user approval before applying any Accepted edit. The user picks the subset and may redirect routings. Skill changes affect every future agent. Do not auto-apply. The parent applies only the user-approved edits; the reviewers never modify anything.

File each Backlog item to the repo's tracker as documented in CLAUDE.md or AGENTS.md, without waiting. Only the Accepted list waits for approval.

Follow each approved row's Routing exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): the parent does it directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): hand to the host's skill-creation skill if one exists (Claude Code: `skill-creator`) and run its draft / test / iterate loop; otherwise edit directly.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): hand to the skill-creation skill's description-optimization loop if one exists; otherwise edit the description directly.
- `new skill: <kebab-name>`: hand creation to the skill-creation skill if one exists. Do not invent the shape ad hoc; otherwise follow the layout of the repo's existing skills.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done.

## 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.

## Agents

- `reflect-reviewer`: judgment lens, divergent lens, and the synthesizer that produces Accepted / Rejected / Backlog.
- `reflect-tooling`: tooling lens, naming the commands, paths, flags, and missed lookups future agents would re-derive.

Adapted from pstack by Lauren Tan (MIT); see LICENSE.
