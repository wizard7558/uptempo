---
name: swarm
description: "Fan out N parallel workers, drain them, and return one report. Use for /swarm, 'swarm this', parallel coverage, races, gauntlets, exploration, or many independent slices and coverage sweeps."
---

# Swarm

## Spawning roster agents

This workflow runs on the repo's role agents (see "Agent roster and model routing" in CLAUDE.md or AGENTS.md). Each agent file pins its model and effort, so never pass a model override.

- Claude Code: use the `Agent` tool with `subagent_type: "<agent>"`. Put every parallel spawn in one message with `run_in_background: true`, then wait for the completion notifications instead of polling.
- Codex: spawn the custom agent by its name with the subagent tool offered in the current tool schema, and wait with the host's wait mechanism.
- If a named agent is not available, stop and tell the user to install the roster (`agent-roster` skill). Do not substitute a different agent or model.

## Start

Open a task list with the host's todo or plan tool, with one entry per phase, before launching anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. State the done predicate and the artifact or report the swarm must return.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass`, `rank all`, or `best-of` before spawning.
3. Workers are `swarm-worker` agents, local only. Do not pass a model; the agent pins its own.
4. Give each writing worker its own worktree (a git worktree you create with `git worktree add`, per the repo's or user's worktree convention when one exists). When workers verify or measure commits, each brief names the exact SHAs. A measurement brief also names the method (sample count, what one sample is, order). The worker records both in its result. Pass the worktree via a `dir: <absolute worktree path>` line followed by a `---` line at the top of the worker's request, so a bridged worker runs inside it.

## Phase B: Fan out

Spawn all N workers in one message, each as `swarm-worker`.

Every brief stands alone. Include the goal, scope, exact slice or race arm, how to verify, and what to report. Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence. A worker that can prove a defect reports `ISSUES` and lists every issue it can prove, not only the first.

If a worker drops out, proceed with N-1 and note it.

## Phase C: Aggregate

Read the terminal results. Drop a result that does not record the SHAs and method its brief names, and respawn that worker once. After a second miss, record a gap. A gap does not count as a pass. For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

## Phase D: Report

Return one combined in-chat report with the table, issue one-liners, gaps or dropouts, and the race rule when used.

## Agents

- `swarm-worker`: runs one slice or race arm locally and reports PASS, ISSUES, or BLOCKED with evidence.

Adapted from pstack by Lauren Tan (MIT); see LICENSE.
