"""Policy half of bridge.py (installed as .agents/roster/bridge_policy.py): the child CLI's argv and sandbox settings
derived from a role's facts and MCP definition lookup. Pure functions, stdlib only. The discovery of protected control
paths is bridge_ctl.py (loaded here, its names re-exported: `discover`, `control_paths`, `canon`, `within`, ...);
request parsing and run-state files are in bridge_io.py, the child runner in bridge_run.py, the Codex private worktree
in bridge_wt.py, the archive of its changes in bridge_arch.py and their transfer in bridge_xfer.py. bridge.py executes
this file's bytes only after they match the trust anchor (see bridge.verify_runtime)."""
from __future__ import annotations

import functools
import json
import os
import re
import shlex
import signal
import stat
import subprocess
import tempfile
import tomllib
from pathlib import Path
from typing import Any, Mapping

NO_EDIT = ("no", "commands")  # levels without the Edit/Write/NotebookEdit tools
WRITE_TOOLS = ["Edit", "Write", "NotebookEdit"]
EDIT_RULES = ("Edit", "Write")  # permission rules that deny writes to the protected control paths
WEB_TOOLS = ["WebFetch", "WebSearch"]
BASE_TOOLS = ["Read", "Glob", "Grep", "Bash"]
NAME = re.compile(r"^[a-z0-9][a-z0-9.-]*$")
TOOL = re.compile(r"^[A-Za-z_][\w*]*(\([^\n,]*\))?$")
SERVER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
WRITES = ("no", "commands", "worktree", "docs", "yes")
LOCKED = ("worktree", "docs", "yes")  # levels that edit files: one at a time per directory
# The child's whole environment: nothing else of the parent's is passed on (no CLAUDE*, CLAUDECODE, ANTHROPIC_*,
# CODEX_*, OPENAI_*, *_TOKEN/_KEY/_SECRET, MCP or SSH variables). A parent Claude Code session's variables would attach
# the child to the parent's messaging socket (a live hang) and could override the pinned model/effort.
ENV_ALLOW = ("HOME", "USER", "LOGNAME", "SHELL", "PATH", "LANG", "TERM", "TZ", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
             "http_proxy", "https_proxy", "no_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE")
ENV_ALLOW_PREFIX = ("LC_",)
# Per target, the child's own credentials/config location when set (never CLAUDECODE, other CLAUDE_CODE_* or session vars).
TARGET_ENV = {"codex": ("CODEX_HOME", "CODEX_API_KEY", "OPENAI_API_KEY"),
              "claude": ("CLAUDE_CONFIG_DIR", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY")}
MAX_MINUTES_LIMIT = 1440
STALL_SECONDS = 60  # after max_minutes, a child that wrote no byte in this long is stopped
GUARD_DENY = ["Agent", "Task", "Bash(claude:*)", "Bash(codex:*)", "Bash(python3 -I .agents/roster/bridge.py:*)",
              "Bash(python3 .agents/roster/bridge.py:*)"]


def child_env(parent: Mapping[str, str], tmpdir: str, target: str) -> dict[str, str]:
    """The allowlisted environment for a child CLI: ENV_ALLOW, LC_*, that target's own credential/config variables
    (TARGET_ENV) and the bridge-set TMPDIR; everything else dropped. PATH is the cleaned trusted PATH of the supervisor
    (the caller's PATH is not passed on: it may hold a directory the child can write, such as node_modules/.bin)."""
    own = TARGET_ENV[target]
    env = {k: v for k, v in parent.items() if k in ENV_ALLOW or k in own or k.startswith(ENV_ALLOW_PREFIX)}
    env["TMPDIR"] = tmpdir
    pinned = _ctl.C.W.PINNED["path"]
    env["PATH"] = pinned if pinned is not None else "/usr/bin:/bin"  # the trusted PATH (bridge_wt.pin_tools; before that the system dirs), never the caller's: the CLI's host process starts `node` and others by name
    env["PYTHONDONTWRITEBYTECODE"] = "1"  # nothing the child runs leaves a __pycache__ behind
    return env


def root_aliases() -> list[tuple[str, str]]:
    """(canonical prefix, symlink spelling) for every symlink directly under `/` that points at a directory (macOS:
    `/var` -> `/private/var`, `/tmp`, `/etc`). A model that is told a path in the spelling of its caller addresses the
    file with that spelling, and Claude's permission rules match the spelling literally."""
    found: list[tuple[str, str]] = []
    try:
        names = sorted(os.listdir("/"))
    except OSError:
        return found
    for n in names:
        link = "/" + n
        real = os.path.realpath(link) if os.path.islink(link) else link
        if real != link and os.path.isdir(real):
            found.append((real, link))
    return found


def spellings(path: str | os.PathLike[str]) -> list[str]:
    """Every spelling of an absolute `path` that a tool call may use for the same file: the path as given, its canonical
    form, each root-symlink spelling of it (root_aliases) and the spelling under the caller's logical `$PWD` when that
    names the same directory (or one above it). The permission rules for a work dir and for every protected or
    credential path under it are emitted for all of them; allow rules for one spelling only would deny an Edit through
    the other (live: v8-1 under `/var/folders`, whose canonical form is `/private/var/folders`)."""
    given = os.path.abspath(os.fspath(path))
    real = canon(given)
    out = [given, real]
    for target, link in root_aliases():
        if real == target or real.startswith(target + os.sep):
            out.append(link + real[len(target):])
    pwd = os.environ.get("PWD", "")
    if pwd and os.path.isabs(pwd) and os.path.isdir(pwd):
        base = canon(pwd)
        if real == base or real.startswith(base.rstrip(os.sep) + os.sep):
            out.append(os.path.normpath(pwd) + real[len(base):] if real != base else os.path.normpath(pwd))
    return list(dict.fromkeys(out))


def scoped(tool: str, workdir: Path) -> list[str]:
    """`Edit`/`Write`/`NotebookEdit` as rules that match only files under the work dir (`//<abs path>/**`, one per
    spelling of the path); any other entry is returned unchanged."""
    return [f"{tool}(/{w}/**)" for w in spellings(workdir)] if tool in WRITE_TOOLS else [tool]


def claude_allowed(role: dict[str, Any], workdir: Path) -> list[str]:
    """--allowedTools: the role's tools (or the level's default set) minus the recursion guard and, for read-only
    levels, the edit tools; the edit tools of a writer only as path rules inside `workdir` (never bare, so a file tool
    cannot reach outside it); WebFetch/WebSearch only with network; `mcp__<server>` for each mcp_allow server."""
    readonly = role["writes"] in NO_EDIT
    base = role["explicit"] or [*BASE_TOOLS[:3], *([] if readonly else ["Edit", "Write"]), "Bash"]
    allowed = [r for t in base if t not in GUARD_DENY and t not in ("Agent", "Task") and not (readonly and t in WRITE_TOOLS)
               and not (t in WEB_TOOLS and not role["network"]) for r in scoped(t, workdir)]
    allowed += [t for t in WEB_TOOLS if role["network"] and t not in allowed]
    return [*allowed, *[f"mcp__{s}" for s in role["mcp_allow"]]]


def claude_tools(allowed: list[str]) -> list[str]:
    """--tools: the same set by bare tool name (rule arguments such as `Bash(git:*)` stay in --allowedTools)."""
    return list(dict.fromkeys(t.split("(", 1)[0] for t in allowed))


CREDENTIAL_PATHS = (".codex", ".ssh", ".aws", ".config/gcloud", ".config/gh", ".netrc", ".docker/config.json", ".kube", ".supabase",
                    "Library/Application Support/com.vercel.cli", ".gnupg", ".config/op", ".claude.json", ".git-credentials", ".npmrc",
                    ".pypirc", ".config/stripe", ".config/neonctl", ".config/lightdash", ".config/configstore", ".config/anthropic", ".dbt",
                    ".snowsql", ".snowflake", ".boto", ".config/supabase", ".config/vercel", ".vercel", ".config/railway", ".fly",
                    ".config/doctl", ".terraform.d", ".pgpass", ".my.cnf", ".password-store", ".azure", ".cargo/credentials",
                    ".cargo/credentials.toml", ".gem/credentials")  # the Read-rule list; the sandbox reads are denied for the whole home (home_reads)
# Under the home the sandbox denies reads of, a Claude child's commands may still read these (relative to the home): the toolchain caches
# (`npx vitest run` needs them) and the git configuration (git fails fatally on an unreadable ~/.gitconfig). ~/.claude and the other
# credential directories are NOT re-allowed. Probed live (Haiku low): `npx vitest run` exits 0, `git status` works, ~/.ssh and ~/.claude.json are unreadable.
HOME_READ_ALLOW = (".npm", ".cache", "Library/Caches", ".nvm", ".volta", ".local/share/pnpm", ".bun", ".gitconfig", ".config/git")


def home_reads(home: Path, workdir: Path, root: Path, common: str | None) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """(denyRead, allowRead) of the Claude sandbox: the whole home is unreadable for the child's commands (any credential file, whatever its
    name), except the work dir, the checkout the bridge runs from, the git common dir and the toolchain caches that exist
    (HOME_READ_ALLOW; `allowRead` takes precedence over `denyRead` for matching paths). ((), ()) when the home is not a directory or `/`."""
    if not home.is_dir() or canon(home) == "/":
        return (), ()
    deny = tuple(dict.fromkeys([str(home), canon(home)]))
    allow = [x for p in ((workdir, root, common) if common else (workdir, root)) for x in spellings(p)]
    allow += [x for n in HOME_READ_ALLOW if os.path.lexists(home / n) for x in (str(home / n), canon(home / n))]
    return deny, tuple(dict.fromkeys(allow))


def credential_paths(home: Path) -> list[str]:
    """The credential files and directories of the user's home that exist (the path itself and, when different, where
    it resolves): a Claude child may not read them. Codex sandbox reads are unrestricted (a documented limit)."""
    found: list[str] = []
    for n in CREDENTIAL_PATHS:
        p = home / n
        if os.path.lexists(p):  # the lexical path, where it resolves, and the canonical home's spelling of it
            found += [str(p), canon(p), os.path.join(canon(home), n)]
    return [f for f in dict.fromkeys(found) if os.path.lexists(f)]


def claude_policy(role: dict[str, Any], workdir: Path, root: Path | None = None, common: str | None = None,
                  control: tuple[str, ...] = (), creds: tuple[str, ...] = (),
                  reads: tuple[tuple[str, ...], tuple[str, ...]] = ((), ())) -> tuple[str, list[str], list[str], dict[str, Any]]:
    """(permission mode, --allowedTools, --disallowedTools, --settings object) for `claude -p` as the child.
    `root` is the roster's checkout, `common` the git common dir (never writable). The only extra writable path is
    the work dir (writer levels): the inherited TMPDIR and the system temp are not allowed, and the per-run dir is
    under `common`, which stays denied (deny wins), so the sandbox's own /tmp/claude-<uid> is the child's scratch.
    `control` (absolute paths of the protected control files and trees under the root and the work dir, from
    control_paths) are denied up front in the sandbox and as Edit/Write rules (no restore is ever needed); `creds`
    (existing credential paths, see credential_paths) are denied for reads in the sandbox and as Read rules; `reads` =
    (denyRead, allowRead) of home_reads: the whole home is unreadable for commands except the allowed paths."""
    level, readonly = role["writes"], role["writes"] in NO_EDIT
    protected = list(dict.fromkeys([str((root or workdir) / ".agents" / "roster"), str(workdir / ".agents" / "roster"),
                                    *([common] if common else []), *control]))
    rules = list(dict.fromkeys(s for d in protected for s in spellings(d)))  # every spelling: deny rules match literally too
    bases = list(dict.fromkeys(s for d in (root or workdir, workdir) for s in spellings(d)))
    nested = [f"{b}/**/{n}" for b in bases for n in (*NESTED_DIRS, *NESTED_FILES)] if control else []  # control files created at any depth (the sandbox takes absolute globs)
    gitany = [f"{b}/**/{n}" for b in bases for n in GIT_ANY]  # a nested `.git` (gitfile or directory), `.gitattributes`, `.gitmodules`: always, whatever the control flag says
    denied = [*GUARD_DENY, *(WRITE_TOOLS if readonly else []), *([] if role["network"] else WEB_TOOLS),
              *[f"{t}(/{d}{sfx})" for d in rules for t in EDIT_RULES for sfx in ("", "/**")],
              *[f"{t}(/{g})" for g in nested + gitany for t in EDIT_RULES],
              *[f"{t}(/{g}/**)" for g in nested + gitany if g.rsplit("/", 1)[1] in (*NESTED_DIRS, GIT_ANY[0]) for t in EDIT_RULES],
              *[f"Read(/{c}{sfx})" for c in dict.fromkeys(x for c in creds for x in spellings(c)) for sfx in ("", "/**")]]
    fs: dict[str, list[str]] = {"denyWrite": ([str(workdir)] if level == "no" else []) + rules + nested + gitany + [f"{g}/**" for g in gitany if g.endswith("/" + GIT_ANY[0])],
                                **({"denyRead": list(dict.fromkeys([*reads[0], *creds]))} if creds or reads[0] else {}),
                                **({"allowRead": list(reads[1])} if reads[0] else {})}
    if level != "no":
        fs["allowWrite"] = [str(workdir)]
    sandbox: dict[str, Any] = {"enabled": True, "failIfUnavailable": True, "allowUnsandboxedCommands": False,
                               "filesystem": fs}
    if role["network"]:
        sandbox["network"] = {"allowedDomains": ["*"]}
    settings = {"disableAllHooks": True, "sandbox": sandbox}
    return "dontAsk", claude_allowed(role, workdir), denied, settings


def codex_argv(role: dict[str, Any], workdir: Path, out: Path, tmp: Path, roots: tuple[str, ...] = ()) -> list[str]:
    """Codex child: no user config, no exec-policy `.rules` files (user or project), no MCP servers or connector apps,
    `/tmp` and $TMPDIR not writable. `workdir` is the run's PRIVATE worktree (never the parent's checkout); the
    writable roots are that worktree (the cwd), the per-run `tmp` (created 0700 by the supervisor, also the child's
    TMPDIR) and `roots`: the ignored dependency/cache directories (node_modules, .venv, ...) of the target."""
    return ["codex", "exec", "--ignore-user-config", "--ignore-rules", "-m", role["model"],
            "-c", f'model_reasoning_effort="{role["effort"]}"', "-c", "mcp_servers={}", "-c", "features.apps=false",
            "-s", "read-only" if role["writes"] == "no" else "workspace-write",
            "-c", f"sandbox_workspace_write.network_access={'true' if role['network'] else 'false'}",
            "-c", "sandbox_workspace_write.exclude_slash_tmp=true", "-c", "sandbox_workspace_write.exclude_tmpdir_env_var=true",
            "-c", f"sandbox_workspace_write.writable_roots={json.dumps([str(tmp), *roots])}",
            "-C", str(workdir), "-o", str(out), "-"]


def build_argv(role: dict[str, Any], workdir: Path, out: Path, role_file: Path, root: Path | None = None,
               common: str | None = None, codex_tmp: Path | None = None, control: tuple[str, ...] = (),
               restricted: bool = False, creds: tuple[str, ...] = (), roots: tuple[str, ...] = (),
               reads: tuple[tuple[str, ...], tuple[str, ...]] = ((), ())) -> list[str]:
    """The child's argv. Codex: see codex_argv (`codex_tmp` is required, `workdir` is the private worktree). Claude: explicit --tools, only the MCP
    servers in <run>/mcp.json, no user/project/local settings (only the --settings JSON), `--output-format
    stream-json --verbose` (the supervisor reads progress and the final result from the event stream), and, when the
    installed CLI has it (`restricted`), `--restricted`: file tools confined to the working directories."""
    if role["target"] == "codex":
        if codex_tmp is None:
            raise ValueError("a Codex child needs its per-run temp dir")
        return codex_argv(role, workdir, out, codex_tmp, roots)
    run = out.parent
    mode, allowed, denied, settings = claude_policy(role, workdir, root, common, control, creds, reads)
    return ["claude", "-p", *(["--restricted"] if restricted else []), "--output-format", "stream-json", "--verbose", "--model", role["model"], "--effort", role["effort"],
            "--permission-mode", mode,
            "--tools", ",".join(claude_tools(allowed)), "--allowedTools", ",".join(allowed),
            "--disallowedTools", ",".join(denied), "--strict-mcp-config", "--mcp-config", str(run / "mcp.json"),
            "--setting-sources", "", "--settings", json.dumps(settings), "--append-system-prompt-file", str(role_file)]


def supports_restricted(help_text: str) -> bool:
    """True when `claude --help` lists the `--restricted` flag."""
    return re.search(r"^\s+--restricted\b", help_text, re.M) is not None


@functools.cache
def claude_restricted() -> bool:
    """True when the installed `claude --help` lists `--restricted`; a CLI that does not answer within 5 s has not, and neither
    has one that is not pinned (no trusted claude: the CLI is unavailable, nothing is looked up by name). The program is the
    pinned absolute path (bridge_wt.pin_tools) and runs with the trusted PATH."""
    if not _ctl.C.W.PINNED["tools"].get("claude"):
        return False
    env = child_env(os.environ, tempfile.gettempdir(), "claude")
    try:
        p = subprocess.Popen([_ctl.C.W.tool("claude"), "--help"], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                             env=env, start_new_session=True)
    except OSError:
        return False
    try:
        return supports_restricted(p.communicate(timeout=5)[0].decode("utf-8", "replace"))
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGKILL)
        p.communicate()
        return False


def mcp_servers(allow: list[str], user_json: str) -> dict[str, Any]:
    """Definitions for the allowed servers from `~/.claude.json` `mcpServers` only: a project `.mcp.json` (which a
    child could have written or a clone could ship) is never copied into a child's --mcp-config. ValueError (never
    containing file content) when a server is missing or the file is not JSON."""
    try:
        data = json.loads(user_json) if user_json.strip() else {}
    except ValueError:
        raise ValueError("~/.claude.json is not valid JSON")
    servers = data.get("mcpServers") if isinstance(data, dict) else None
    servers = servers if isinstance(servers, dict) else {}
    missing = [n for n in allow if servers.get(n) is None]
    if missing:
        raise ValueError(f"mcp_allow server {missing[0]!r} is not defined in ~/.claude.json mcpServers (user scope only)")
    return {n: servers[n] for n in allow}


def role_settings(facts: dict[str, Any], name: str) -> dict[str, Any]:
    role = facts["roles"].get(name) if NAME.match(name) else None
    if role is None:
        raise ValueError(f"unknown role {name!r}")
    target = role.get("bridgeTarget")
    if target not in ("codex", "claude"):
        raise ValueError(f"role {name!r} has no bridge target")
    caller = "claude" if target == "codex" else "codex"
    if not role.get(caller, {}).get("bridged"):
        raise ValueError(f"role {name!r} is not bridged from {caller} in this repo (it runs natively or on fallback models)")
    for key in ("model", "effort"):
        if not isinstance(role.get(key), str) or not NAME.match(role[key]):
            raise ValueError(f"facts.json: bad {key} for {name!r}")
    tools = role.get("tools")
    explicit = [t.strip() for t in tools.split(",") if t.strip()] if isinstance(tools, str) else []
    mcp = role.get("mcp_allow", [])
    if (role.get("writes") not in WRITES or not isinstance(role.get("network"), bool)
            or not isinstance(role.get("editsControlFiles", False), bool)
            or isinstance(role.get("maxMinutes", 45), bool) or not isinstance(role.get("maxMinutes", 45), (int, float))
            or not 0 < role.get("maxMinutes", 45) <= MAX_MINUTES_LIMIT or not (tools is None or isinstance(tools, str))
            or not all(TOOL.match(t) for t in explicit) or not isinstance(mcp, list)
            or not all(isinstance(s, str) and SERVER.match(s) for s in mcp)):
        raise ValueError(f"facts.json: bad writes/network/tools/mcp_allow for {name!r}")
    return {**role, "name": name, "target": target, "caller": caller, "explicit": explicit, "mcp_allow": mcp,
            "locked": role["writes"] in LOCKED, "edits_control": role.get("editsControlFiles", False),
            "max_minutes": role.get("maxMinutes", 45)}


# ------------------------------------------------------ protected control paths (bridge_ctl.py)
try:
    _ctl = load("bridge_ctl")  # type: ignore[name-defined]  # noqa: F821 - injected by bridge.module (the verified bytes)
except NameError:  # imported as a plain module (tests, the skill's own tooling)
    import bridge_ctl as _ctl
ConfigError, NESTED_DIRS, NESTED_FILES, GIT_ANY = _ctl.ConfigError, _ctl.NESTED_DIRS, _ctl.NESTED_FILES, _ctl.GIT_ANY
canon, within, discover, control_paths = _ctl.canon, _ctl.within, _ctl.discover, _ctl.control_paths
FILES, TREES, SETTINGS = _ctl.FILES, _ctl.TREES, _ctl.SETTINGS
hook_commands, hook_paths, command_paths, server_commands = _ctl.hook_commands, _ctl.hook_paths, _ctl.command_paths, _ctl.server_commands
nested_worktrees, hooks_dir, read_config, nested_controls, _inside, _scan = _ctl.nested_worktrees, _ctl.hooks_dir, _ctl.read_config, _ctl.nested_controls, _ctl._inside, _ctl._scan
