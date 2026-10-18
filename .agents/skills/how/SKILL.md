---
name: how
description: "Use for \"how does X work\", code walkthroughs before changing something, and placement / ownership / layering questions (\"where should this live\", \"which package owns this\", \"is this the right layer\"). Explains subsystem architecture, runtime flow, onboarding mental models. Also use before non-trivial changes to unfamiliar code. Use why for motivation."
---

# How

## Spawning roster agents

This workflow runs on the repo's role agents (see "Agent roster and model routing" in CLAUDE.md or AGENTS.md). Each agent file pins its model and effort, so never pass a model override.

- Claude Code: use the `Agent` tool with `subagent_type: "<agent>"`. Put every parallel spawn in one message with `run_in_background: true`, then wait for the completion notifications instead of polling.
- Codex: spawn the custom agent by its name with the subagent tool offered in the current tool schema, and wait with the host's wait mechanism.
- If a named agent is not available, stop and tell the user to install the roster (`agent-roster` skill). Do not substitute a different agent or model.

Explore the codebase to answer "how does X work?" questions. Produce architectural explanations at the level of a senior engineer onboarding onto a subsystem, enough to build a working mental model, not so much that it reads like annotated source code.

Explorers are `how-explorer` agents. The explainer is `how-explainer`. Both only read; neither modifies anything.

## 1. Assess complexity

If the scope is ambiguous, state your interpretation and explore. The user can redirect.

- **Simple** (a single module, a small utility, a narrow question such as "how does function X work"): no explorers. Spawn one `how-explainer` that explores and explains in one pass, built from `references/explainer-prompt.md` without the explorer-findings section. Go to step 4.
- **Complex** (a subsystem spanning multiple files or services, a cross-cutting feature, a full architectural overview): go to step 2.

When in doubt, take the simple path.

## 2. Explore (complex only)

Decompose the question into 2 to 4 angles, each a distinct slice of the subsystem (one subsystem or question slice per explorer). Spawn one `how-explorer` per angle, all in a single parallel batch, each with `references/explorer-prompt.md` and its angle filled in.

## 3. Synthesize (complex only)

Once all explorers have returned, spawn one `how-explainer` with `references/explainer-prompt.md` and every explorer's findings filled in.

## 4. Present

Present the explainer's output. Light edits for clarity or context from the conversation are fine. Do not substantially rewrite it.

## Output format

The explanation uses the sections defined in `references/explainer-prompt.md`, dropping any that do not apply: Overview, Key Concepts, How It Works, Where Things Live, Gotchas.

## Agents

- `how-explorer`: traces one assigned slice of the subsystem and reports components, flow, files read, boundaries, and open questions
- `how-explainer`: reconciles all explorer findings (or explores directly on the simple path) into the final architectural explanation

Adapted from pstack by Lauren Tan (MIT); see LICENSE.
