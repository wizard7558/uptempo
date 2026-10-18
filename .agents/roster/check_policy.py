"""Permission-policy half of the checker (installed as .agents/roster/check_policy.py; the skill's own copy runs when
the skill's `--check` or the installer checks). It never imports repo code itself: `check.py` hands it a bridge module
that was built from hash-verified bytes. Re-derives each role's child argv from facts (writes/network/tools/mcp_allow)
and asserts the full shape for both child CLIs. Stdlib only."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

EDIT, WEB = {"Edit", "Write", "NotebookEdit"}, {"WebFetch", "WebSearch"}
GUARD = ("Agent", "Task", "Bash(claude:*)", "Bash(codex:*)")
DEFAULT_TOOLS = ("Read", "Glob", "Grep", "Bash")
NESTED = (".claude", ".codex", ".agents", "CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", "AGENTS.override.md", ".mcp.json")  # control names, any depth
GIT_ANY = (".git", ".gitattributes", ".gitmodules")  # protected at any depth (the same names as bridge_wt.GIT_ANY)
LABEL = "{rd}/bridge.py: {what} for {name} (writes={w!r}) differs from the roster policy"


def flag(argv: list[str], name: str) -> str | None:
    return argv[argv.index(name) + 1] if name in argv[:-1] else None


def expected_tools(writes: str, network: bool, explicit: list[str], mcp: list[str]) -> set[str]:
    """The `--tools` set the Claude child must get: the role's tools (or the level's defaults) by bare name, no
    Agent/Task, no edit tools below the writer levels, WebFetch/WebSearch only with network, one mcp__ entry per server."""
    ro = writes in ("no", "commands")
    base = explicit or [*DEFAULT_TOOLS[:3], *([] if ro else ["Edit", "Write"]), "Bash"]
    names = {t.split("(", 1)[0] for t in base} - {"Agent", "Task"} - (EDIT if ro else set()) - WEB
    return names | (WEB if network else set()) | {f"mcp__{s}" for s in mcp}


def claude_findings(argv: list[str], role: dict[str, Any], root: Path, run: Path, common: str, control: tuple[str, ...] = (),
                    restricted: bool = False, creds: tuple[str, ...] = (), reads: tuple[tuple[str, ...], tuple[str, ...]] = ((), ())) -> list[str]:
    w, net, ro = role["writes"], role["network"], role["writes"] in ("no", "commands")
    tools = set((flag(argv, "--tools") or "").split(",")) - {""}
    allowed_raw = (flag(argv, "--allowedTools") or "").split(",")
    allowed = {t.split("(", 1)[0] for t in allowed_raw}
    scopes = {f"{t}(/{root}/**)" for t in tools & EDIT}
    denied = (flag(argv, "--disallowedTools") or "").split(",")
    try:
        settings = json.loads(flag(argv, "--settings") or "")
        sb = settings.get("sandbox", {})
        fs = sb.get("filesystem", {})
    except (ValueError, AttributeError):
        settings, sb, fs = {}, {}, {}
    deny_w, allow_w, deny_r = fs.get("denyWrite", []), fs.get("allowWrite", []), fs.get("denyRead", [])
    allow_r = fs.get("allowRead", [])
    checks = (
        ("--tools list", tools != expected_tools(w, net, role["explicit"], role["mcp_allow"])),
        ("--allowedTools beyond --tools", not allowed <= tools),
        ("permission mode", flag(argv, "--permission-mode") != "dontAsk"),
        ("edit tool allowed without a path scope", bool(EDIT & set(allowed_raw))),
        ("edit tools not scoped to the work dir", not ro and not scopes <= set(allowed_raw)),
        ("--restricted missing although the CLI has it", ("--restricted" in argv) != restricted),
        ("edit tools allowed", ro and bool(EDIT & (tools | allowed))),
        ("edit tools not denied", ro and not EDIT <= set(denied)),
        ("edit tools for a writer", not ro and not role["explicit"] and not EDIT & {"Edit", "Write"} & tools),
        ("recursion guard not denied", not set(GUARD) <= set(denied)),
        ("WebFetch/WebSearch not denied without network", not net and not WEB <= set(denied)),
        ("WebFetch/WebSearch allowed without network", not net and bool(WEB & (tools | allowed))),
        ("strict MCP config", "--strict-mcp-config" not in argv or flag(argv, "--mcp-config") != str(run / "mcp.json")),
        ("setting sources", flag(argv, "--setting-sources") != ""),
        ("model or effort", (flag(argv, "--model"), flag(argv, "--effort")) != (role["model"], role["effort"])),
        ("hooks", settings.get("disableAllHooks") is not True),
        ("sandbox not required", sb.get("enabled") is not True or sb.get("failIfUnavailable") is not True
         or sb.get("allowUnsandboxedCommands") is not False),
        ("workdir write denial", (str(root) in deny_w) != (w == "no")),
        ("roster dir or git common dir writable", str(root / ".agents" / "roster") not in deny_w or (common not in deny_w)),
        ("writable paths", not set(allow_w) <= {str(root)} or bool(allow_w) != (w != "no")),
        ("network", ("network" in sb) != net),
        ("event stream (stdout is read as stream-json)", flag(argv, "--output-format") != "stream-json" or "--verbose" not in argv),
        ("control paths not denied in the sandbox", not set(control) <= set(deny_w)),
        ("control paths not denied as Edit/Write rules",
         not {f"{t}(/{c}{x})" for c in control for t in ("Edit", "Write") for x in ("", "/**")} <= set(denied)),
        ("nested control globs not denied", bool(control) and not ({f"{root}/**/{n}" for n in NESTED} <= set(deny_w)
                                                                  and {f"{t}(/{root}/**/{n})" for t in ("Edit", "Write") for n in NESTED} <= set(denied))),
        ("nested .git, .gitattributes or .gitmodules not denied",
         not ({f"{root}/**/{n}" for n in GIT_ANY} | {f"{root}/**/.git/**"} <= set(deny_w)
              and {f"{t}(/{root}/**/{n})" for t in ("Edit", "Write") for n in GIT_ANY} | {f"{t}(/{root}/**/.git/**)" for t in ("Edit", "Write")} <= set(denied))),
        ("work dir denied for writes", not ro and bool({f"Edit(/{root}/**)", f"Write(/{root}/**)"} & set(denied))),
        ("credential paths not denied for reads in the sandbox", not set(creds) <= set(deny_r)),
        ("home not denied for reads in the sandbox", not set(reads[0]) <= set(deny_r)),
        ("sandbox read exceptions differ from the allowed paths", set(allow_r) != set(reads[1])),
        ("credential paths not denied as Read rules", not {f"Read(/{c}{x})" for c in creds for x in ("", "/**")} <= set(denied)),
    )
    return [what for what, bad in checks if bad]


def codex_findings(argv: list[str], role: dict[str, Any], wt: Path, tmp: Path, roots: tuple[str, ...] = ()) -> list[str]:
    """Codex child shape: user config and exec-policy rules ignored, no MCP/apps, sandbox and network per role, `/tmp`
    and $TMPDIR excluded, the work dir `wt` is the run's private worktree (never the parent's checkout) and the only
    extra writable roots are the per-run temp dir `tmp` and the ignored directories `roots`."""
    w, net = role["writes"], role["network"]
    pairs = {argv[i + 1] for i, a in enumerate(argv[:-1]) if a == "-c"}
    got = [a for a in pairs if a.startswith("sandbox_workspace_write.writable_roots=")]
    checks = (
        ("Codex user config not ignored", argv[:2] != ["codex", "exec"] or "--ignore-user-config" not in argv),
        ("Codex exec-policy rules not ignored", "--ignore-rules" not in argv),
        ("Codex MCP servers not emptied", "mcp_servers={}" not in pairs),
        ("Codex connector apps not disabled", "features.apps=false" not in pairs),
        ("Codex sandbox", flag(argv, "-s") != ("read-only" if w == "no" else "workspace-write")),
        ("Codex network", f"sandbox_workspace_write.network_access={'true' if net else 'false'}" not in pairs),
        ("Codex /tmp or $TMPDIR still writable", not {"sandbox_workspace_write.exclude_slash_tmp=true",
                                                      "sandbox_workspace_write.exclude_tmpdir_env_var=true"} <= pairs),
        ("Codex extra writable roots", got != [f"sandbox_workspace_write.writable_roots={json.dumps([str(tmp), *roots])}"]),
        ("Codex model or work dir", (flag(argv, "-m"), flag(argv, "-C")) != (role["model"], str(wt))),
    )
    return [what for what, bad in checks if bad]


EXPECTED_ENV = ("HOME", "USER", "LOGNAME", "SHELL", "PATH", "LANG", "TERM", "TZ", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
                "http_proxy", "https_proxy", "no_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE")
EXPECTED_OWN = {"codex": ("CODEX_HOME", "CODEX_API_KEY", "OPENAI_API_KEY"),
                "claude": ("CLAUDE_CONFIG_DIR", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY")}
PROBE_ENV = {"CLAUDE_CODE_MESSAGING_SOCKET": "s", "CLAUDE_CODE_SUBAGENT_MODEL": "m", "CLAUDE_EFFORT": "max", "CLAUDECODE": "1",
             "CLAUDE_PID": "1", "CLAUDE_CODE_OAUTH_TOKEN": "o", "CLAUDE_CONFIG_DIR": "/c", "OPENAI_API_KEY": "k",
             "CODEX_API_KEY": "k", "ANTHROPIC_API_KEY": "k", "CODEX_HOME": "/x", "FOO_TOKEN": "t", "SSH_AUTH_SOCK": "/s",
             "PATH": "/bin", "HOME": "/h", "LC_ALL": "C", "HTTPS_PROXY": "p"}
COMMON_OUT = {"PATH": "<pinned>", "HOME": "/h", "LC_ALL": "C", "HTTPS_PROXY": "p", "TMPDIR": "/t", "PYTHONDONTWRITEBYTECODE": "1"}


def env_findings(policy: Any, runtime_dir: str) -> list[str]:
    """The child environment is an allowlist: the constant is exactly EXPECTED_ENV (+ LC_*) and a polluted parent env
    yields only allowlisted names, the target's own credential/config variables (EXPECTED_OWN) and TMPDIR; never
    CLAUDECODE, other CLAUDE_CODE_* variables, CLAUDE_PID, CLAUDE_EFFORT or session variables. PATH is the supervisor's pinned
    trusted PATH (bridge_wt.pin_tools), never the caller's (PROBE_ENV's `/bin`)."""
    try:
        pinned = policy._ctl.C.W.PINNED["path"]
        if not pinned or pinned == PROBE_ENV["PATH"]:
            return [f"{runtime_dir}/bridge_policy.py: the child environment has no pinned trusted PATH"]
        want = {**COMMON_OUT, "PATH": pinned}
        got = {t: policy.child_env(PROBE_ENV, "/t", t) for t in EXPECTED_OWN}
        bad = (tuple(policy.ENV_ALLOW) != EXPECTED_ENV or tuple(policy.ENV_ALLOW_PREFIX) != ("LC_",)
               or {k: tuple(v) for k, v in policy.TARGET_ENV.items()} != EXPECTED_OWN
               or any(got[t] != {**want, **{k: PROBE_ENV[k] for k in EXPECTED_OWN[t]}} for t in EXPECTED_OWN))
    except Exception as e:  # noqa: BLE001
        return [f"{runtime_dir}/bridge_policy.py: child_env failed ({type(e).__name__}: {e})"]
    return [f"{runtime_dir}/bridge_policy.py: the child environment is not the scrubbed allowlist"] if bad else []


def policy_findings(bridge: Any, root: Path, facts: dict[str, Any], common: str, runtime_dir: str) -> list[str]:
    """Findings for every role: the argv `bridge` builds for the Claude and the Codex child, against the policy
    re-derived from facts."""
    errs: list[str] = env_findings(bridge.policy(), runtime_dir)
    run = root / ".roster-run-under-check"
    tmp = Path("/roster-codex-tmp-under-check")
    control = (str(root / "CLAUDE.md"), str(root / ".claude" / "rules"))  # stand-ins for bridge_policy.control_paths
    wt, roots = Path("/roster-wt-under-check"), ("/roster-ignored-under-check/node_modules",)  # the private worktree and one ignored dir
    creds = ("/roster-home-under-check/.ssh", "/roster-home-under-check/.netrc")  # stand-ins for bridge_policy.credential_paths
    reads = (("/roster-home-under-check",), (str(root), "/roster-home-under-check/.npm"))  # stand-ins for bridge_policy.home_reads
    restricted = bridge.policy().claude_restricted()
    home = Path.home()
    if home.is_dir() and os.path.realpath(home) != "/" and str(home) not in bridge.policy().home_reads(home, root, root, common)[0]:
        errs.append(f"{runtime_dir}/bridge_policy.py: the user's home is not denied for reads in the Claude sandbox")
    for n, r in sorted(facts["roles"].items()):
        tools = [t.strip() for t in (r["tools"] or "").split(",") if t.strip()]
        role = {"name": n, "model": r["model"], "effort": r["effort"], "writes": r["writes"], "network": bool(r["network"]),
                "explicit": tools, "mcp_allow": list(r["mcp_allow"])}
        try:
            bad = claude_findings(bridge.build_argv({**role, "target": "claude"}, root, run / "out.txt", run / "role.md",
                                                    None, control, restricted, creds, (), reads), role, root, run, common, control, restricted, creds, reads)
            bad += codex_findings(bridge.build_argv({**role, "target": "codex"}, wt, run / "out.txt", run / "role.md", tmp, (), False, (), roots),
                                  role, wt, tmp, roots)
        except Exception as e:  # noqa: BLE001 - any failure of the bridge's own policy code is a finding
            errs.append(f"{runtime_dir}/bridge.py: policy for {n} failed ({type(e).__name__}: {e})")
            continue
        errs += [LABEL.format(rd=runtime_dir, what=what, name=n, w=r["writes"]) for what in bad]
    return errs
