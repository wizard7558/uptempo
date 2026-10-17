---
name: hillclimb
description: "Use for \"hillclimb\", \"optimize this metric\", \"iteratively improve\", \"push this number down\", or \"keep improving until X\" (/hillclimb). Also use to push one measurable metric to a target over many attempts. The parent owns metric, frozen harness, decision log, and keep/revert; each attempt goes to a hillclimb agent."
---

# Hillclimb

## Spawning roster agents

This workflow runs on the repo's role agents (see "Agent roster and model routing" in CLAUDE.md or AGENTS.md). Each agent file pins its model and effort, so never pass a model override.

- Claude Code: use the `Agent` tool with `subagent_type: "<agent>"`. Put every parallel spawn in one message with `run_in_background: true`, then wait for the completion notifications instead of polling.
- Codex: spawn the custom agent by its name with the subagent tool offered in the current tool schema, and wait with the host's wait mechanism.
- If a named agent is not available, stop and tell the user to install the roster (`agent-roster` skill). Do not substitute a different agent or model.

**You (the parent) own the metric and the experiment's integrity. Supervise and review. Delegate the attempts.** This is for sustained, iterative improvement of one measurable thing against a target. A one-off fix is a bug fix or a perf issue (`bug-fix` or `perf-issue` agent). This is the loop.

Core discipline: one change, one measurement, keep or revert. Never stack untested changes, and never claim a win from code inspection: prove it works by running it, not by reading the code.

You keep the metric, the frozen harness, `decision.tsv`, and every keep or revert call. Each attempt (one hypothesis) is one call to the `hillclimb` agent in its own worktree. The agent changes code, measures, and reports; it never edits the harness and never commits.

## Steps

1. Ground the workload and architecture before choosing the metric. Run the **how** skill over the target, name the realistic workload dimensions that can move the result (data size, history, state, concurrency), and select a case that reproduces the user's complaint. If no case reproduces it, fix the repro instead of hillclimbing. Then fix one metric, the direction that counts as better, and a checkable stop predicate that pairs a target with a floor on attempts so a lucky early win can't end the run (the example "at least 50% better than baseline and at least 10 iterations" is this shape). Use the user's numbers when given, otherwise agree them.
2. Build the measurement harness, prove its sensitivity, then freeze it (build the measuring lever before pulling it). Run contrasting realistic workloads and confirm the target case reproduces the symptom while easier cases separate as expected. If the harness cannot distinguish them, revise the workload or metric. Vet the harness against `references/benchmark-checklist.md` before you freeze it, and make it print its error count and a count of the work done. Once frozen, one repeatable command emits the metric, sampled enough to clear the noise (median of N, not a single run). Record the baseline metric and a green run of the regression gate (the tests that must keep passing) before any change.
3. Open the decision log: a `decision.tsv`, one row per attempt: id, hypothesis, change, before, after, delta, tests, verdict (kept or reverted), note. Read it before each attempt. Keep it outside the repo or gitignored, never committed.
4. Ground each hypothesis in the architecture model from step 1, so it names a specific mechanism ("defer X off the boot path because it blocks first paint"), not "try memoizing something". For a perf metric, order hypotheses by the performance mantras below, cheapest first, and borrow only their order, not a stop rule:
   1. Don't do it. Stop work whose result nothing uses rather than cheapening it.
   2. Do it, but don't do it again.
   3. Do it less.
   4. Do it later.
   5. Do it when they're not looking.
   6. Do it concurrently.
   7. Do it cheaper.
5. Loop, one hypothesis per iteration:
   - Hand the change to a `hillclimb` agent with a tight scope: the hypothesis, the worktree, the frozen harness command, the regression gate command, and the baseline. Supervise and review the diff rather than typing it, and keep your own context lean. Create each attempt's directory yourself with `git worktree add`, per the repo's or user's worktree convention when one exists, and pass it via a `dir: <absolute worktree path>` line followed by a `---` line at the top of the request. When several independent hypotheses are live, fan them out to parallel `hillclimb` agents, each in its own worktree, so no two attempts share mutable state.
   - The agent measures before and after with the frozen harness, runs the regression gate, and reports before, after, delta, and test result. Re-run the harness yourself on the kept candidate when the number matters.
   - Accept only when the metric moves past noise and the gate stays green. Otherwise revert the change in full. A tweak that "might help" is not kept.
   - Commit only when the user has asked for commits: one commit per accepted fix, staging only the files you changed (`git add <files>`, never `-A`). Otherwise carry accepted changes forward uncommitted. Log the row either way, kept or reverted.
   Each iteration ends in a check before the next begins: sequence verifiable units, verifying each attempt before trying the next. If the run is unattended, set up a wake mechanism the host supports to continue the loop, but keep this workflow's stop predicate.
6. Push past the first plateau. On a stall, several rejects in a row, pivot category, combine near-misses, re-read the source, or try something more radical before concluding the hill is climbed. Correctness and simplicity outrank the number. Revert a win that breaks behavior, and keep a simplification that holds the number.
7. Stop when the predicate is met, or when the remaining ideas are marginal and not worth their cost. Don't relax the predicate to meet it, and don't quit while cheap untried hypotheses remain. If you are stuck, surface it instead of spinning.
8. Open a PR per the repo's conventions with the accepted changes in the order they landed. Delegate the description to `clerk`, giving it the metric, baseline, final number, and accepted fixes. Keep the PR body to one primary number and link the `decision.tsv` evidence.

**Reply:** the metric and target, baseline to final with the percent delta, iterations run (kept vs reverted), each accepted fix on one line, the `decision.tsv` path, and the best idea you would try next if pushed further.

## Agents

- `hillclimb`: runs one attempt (one hypothesis) in its own worktree: change, measure with the frozen harness, run the regression gate, report
- `clerk`: drafts the PR description from the final results

Adapted from pstack by Lauren Tan (MIT); see LICENSE.
