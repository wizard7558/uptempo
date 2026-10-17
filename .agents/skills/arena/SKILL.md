---
name: arena
description: "Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for /arena, 'arena this', 'throw it in the arena', when one attempt at a non-trivial artifact would lock in the wrong shape, or when several plausible shapes exist for one artifact."
---

# Arena

## Spawning roster agents

This workflow runs on the repo's role agents (see "Agent roster and model routing" in CLAUDE.md or AGENTS.md). Each agent file pins its model and effort, so never pass a model override.

- Claude Code: use the `Agent` tool with `subagent_type: "<agent>"`. Put every parallel spawn in one message with `run_in_background: true`, then wait for the completion notifications instead of polling.
- Codex: spawn the custom agent by its name with the subagent tool offered in the current tool schema, and wait with the host's wait mechanism.
- If a named agent is not available, stop and tell the user to install the roster (`agent-roster` skill). Do not substitute a different agent or model.

Open a task list with the host's todo or plan tool, with one entry per phase (Frame, Fan out, Cross-judge, Pick, Graft, Verify), before launching anything.

## Phase A: Frame

Every candidate gets the same prompt, so the prompt is the contract.

1. State the artifact each candidate is producing.
2. Derive the rubric, 3-6 concrete gradeable criteria for what success looks like on *this* task. It is the picker's tool in Phase D. Candidates only see the task.
3. Pick the runners. The default is N=2: one `arena-runner` and one `arena-runner-cross`. The `-cross` seat is a different model provider on purpose, so its disagreement with the base seat is signal, not noise. For N>2 (the arena covers multiple design directions), alternate `arena-runner` and `arena-runner-cross`. When the work is generation-bound rather than judgment-sensitive, repeat one agent N times instead.
4. Give each candidate its own output location (a git worktree created by you with `git worktree add`, per the repo's or user's worktree convention when one exists). Separate state per candidate before anything is merged; never have candidates write to one shared location. Tell each candidate its worktree with a `dir: <absolute worktree path>` line followed by a `---` line at the top of its request, so a bridged runner works inside that worktree.

## Phase B: Fan out

Spawn all N runners in one message, each with the task, the path to the shared grounding, its own output path, and instructions to produce the artifact and a short rationale naming the alternatives it considered and what it rejected.

If a candidate produces no output, proceed with N-1 and note the dropout.

## Phase C: Cross-judge

After all Phase B candidates complete, spawn both `arena-judge` and `arena-judge-cross` in parallel, so the two verdicts are independent. Each judge is read-only. It sees the rubric and the candidates by path label, scores each criterion, and recommends a base with rationale. They run in parallel with your reading in Phase D. Don't spawn them while candidates are still writing.

## Phase D: Pick a base

Read every candidate end to end before picking. Score each against the rubric criterion by criterion, not on holistic feel, and compare with both judges. Agreement on the base confirms the pick. Disagreement means one of you is biased or the rubric was ambiguous. Read the rationales before deciding.

Pick the base a future maintainer can extend most easily without breaking invariants. When two feel tied, prefer the cleaner boundary or smaller API, and the option that needs the least new machinery.

## Phase E: Graft

Walk each losing candidate once more for what is worth porting into the base, usually one or two things per candidate, not most of it. Fold each graft in by hand, redesigning from first principles around the base so the result stays coherent under one mental model. Don't paste mechanically.

If the candidates converge on one shape, that is strong agreement. Note it and ship the consensus shape. No graft is needed. If they wildly diverge, Phase A was under-specified. Reframe and re-run rather than averaging the divergence.

## Phase F: Verify

Verify the synthesized artifact like any other output: prove it works by running it, not by reading the code. If verification finds a problem the arena missed, either Phase A was wrong (re-frame and re-run) or a candidate caught it and you missed the graft (go back to Phase E). Don't paper over it.

## Outputs

One synthesized artifact, with a short synthesis note alongside naming the base and why, both judges' verdicts, each graft with its source candidate, what was rejected and why, any convergence or dropouts, and the verification result.

## Agents

- `arena-runner`: base-seat candidate producer in Phase B.
- `arena-runner-cross`: second-model-family candidate producer in Phase B; its disagreement is signal.
- `arena-judge`: read-only rubric scorer in Phase C.
- `arena-judge-cross`: independent second-model-family rubric scorer in Phase C.

Adapted from pstack by Lauren Tan (MIT); see LICENSE.
