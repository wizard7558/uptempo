#!/usr/bin/env python3
"""Agent roster checks (stdlib only); the installer's modules import the shared constants and parsers from here.
Installed as `.agents/roster/check_core.py` and run by the bootstrap `.agents/roster/check.py`
(roster_check_main.py) only after its sha256 matched the trust anchor. `run_check` returns one finding per problem.
Strict checks apply to roster roles only; other agents are ignored except for the Codex size cap."""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True

import hashlib
import json
import posixpath
import re
import stat
import types
from pathlib import Path
from typing import Any, Collection

try:
    import tomllib
except ImportError:  # Python < 3.11
    print("error: agent roster check needs Python 3.11+ (tomllib)", file=sys.stderr)
    sys.exit(2)

MAX_READ, RUNTIME_DIR = 1_048_576, ".agents/roster"
FACTS_REL, LOCK_REL = f"{RUNTIME_DIR}/facts.json", ".agents/agent-roster.lock.json"
CLAUDE_DIR, CODEX_DIR = ".claude/agents", ".codex/agents"
CODEX_ROOT_REL, TEST_REL = ".codex/config.toml", "tests/agents/agent-roster.test.ts"
COPIED = {"bridge.py": "bridge.py", "bridge_cfg.py": "bridge_cfg.py", "bridge_ctl.py": "bridge_ctl.py", "bridge_policy.py": "bridge_policy.py", "bridge_io.py": "bridge_io.py",
          "bridge_run.py": "bridge_run.py", "bridge_tools.py": "bridge_tools.py", "bridge_wt.py": "bridge_wt.py", "bridge_read.py": "bridge_read.py", "bridge_arch.py": "bridge_arch.py", "bridge_xfer.py": "bridge_xfer.py",
          "check.py": "roster_check_main.py", "check_core.py": "roster_check.py",
          "check_policy.py": "roster_policy_check.py"}  # runtime file <- skill scripts/<file>
RUNTIME_ENTRIES = (".gitignore", *COPIED, "facts.json")  # plus the tmp/ directory
LOADED = ("bridge.py", "bridge_tools.py", "bridge_wt.py", "bridge_cfg.py", "bridge_ctl.py", "bridge_policy.py", "bridge_io.py", "bridge_run.py", "bridge_read.py", "bridge_arch.py", "bridge_xfer.py", "check_policy.py")  # executed by the checker only from verified bytes
LOCK_PREFIXES = (CLAUDE_DIR + "/", CODEX_DIR + "/", ".agents/skills/", RUNTIME_DIR + "/")  # tracked paths must exist
HEADING, ROUTING_HEADING = "## Agent roster and model routing", "### When to use which"
MARK_START, MARK_END = "<!-- agent-roster:start -->", "<!-- agent-roster:end -->"
INSTR_MARK = "\n\n## Role instructions\n\n"
TABLE_HEAD = ["Agent", "Group", "Model", "Claude Code", "Codex", "Use for"]
CALLS = {"claude": "codex exec", "codex": "claude -p"}
SUFFIX_RE = re.compile(r" Runs on \S+ via the (?:codex|claude) CLI\.$")
FRONT_RE = re.compile(r"^---\n([\s\S]*?)\n---\n?([\s\S]*)$")
KEY_RE = re.compile(r"^([A-Za-z_][\w-]*):(?:[ \t]|$)")
AGENT_RE = re.compile(r"^(?:\.claude/agents/([^/]+)\.md|\.codex/agents/([^/]+)\.toml)$")
BOLD_RE, TICK_RE = re.compile(r"\*\*([a-z0-9-]+)\*\*"), re.compile(r"`([a-z0-9-]+)`")
START_RE = re.compile(rf"^{re.escape(MARK_START)}[ \t\r]*$", re.M)  # \r: CRLF documents (offsets are kept)
END_RE = re.compile(rf"^{re.escape(MARK_END)}[ \t\r]*$", re.M)
CLAUDE_MANAGED, CLAUDE_ALLOW = ("name", "description", "model", "effort", "tools"), ("color",)
CODEX_MANAGED = ("name", "description", "model", "model_reasoning_effort", "developer_instructions")
ESCALATIONS = (("sandbox_mode", "danger-full-access"), ("approval_policy", "never"))
ROLE_KEYS = {"group", "model", "effort", "tools", "writes", "network", "bridgeTarget", "mcp_allow", "editsControlFiles", "maxMinutes", "claude", "codex"}
RT_KEYS = {"kind", "fallback", "suffix", "bridged", "extras", "shimText"}
REQUIRED_FACTS = ("models", "runtimeProvider", "shim", "shimTools", "efforts", "cap", "workflows", "workflowRequires",
                  "roles", "retiredRoles", "retiredWorkflows", "bridgeMode", "runtimeHashes")
WHY_PERMS = "roster roles' permissions are roster-managed; put custom agents under a different name"


class Bad(Exception):  # a finding that stops the check of one file
    pass


def read_file(path: Path, root: Path, follow: bool = False) -> str:
    """Text of a regular file under the 1 MB cap. Symlinks are refused unless `follow` (and then must stay in the repo)."""
    try:
        if path.is_symlink() and (not follow or root.resolve() not in path.resolve().parents):
            raise Bad("is a symlink (agent and runtime files must be regular files)" if not follow else "symlink leaves the repo")
        st = path.stat()
        if not stat.S_ISREG(st.st_mode) or st.st_size > MAX_READ:
            raise Bad(f"not a regular file of at most {MAX_READ} bytes")
        return path.read_bytes().decode("utf-8").replace("\r\n", "\n")
    except OSError as e:
        raise Bad(f"unreadable ({e.strerror})") from e
    except UnicodeDecodeError as e:
        raise Bad("not valid UTF-8") from e


def valid_lock_key(key: object, roles: Collection[str], workflows: Collection[str]) -> bool:
    """Only exact roster-managed paths: a roster (or retired) role's agent files, a roster workflow's files, the
    runtime files, the Codex root config and the guard test. Never other skills or non-roster agents."""
    if (not isinstance(key, str) or not key or key.startswith("/") or "\x00" in key or "\\" in key
            or posixpath.normpath(key) != key or ".." in key.split("/")):
        return False
    if key in (CODEX_ROOT_REL, TEST_REL) or key in {f"{RUNTIME_DIR}/{n}" for n in RUNTIME_ENTRIES}:
        return True
    m = AGENT_RE.match(key)
    if m:
        return (m.group(1) or m.group(2)) in roles
    parts = key.split("/")
    return len(parts) >= 4 and parts[:2] == [".agents", "skills"] and parts[2] in workflows


def scalar(raw: str) -> str | None:
    """Decode a one-line YAML scalar: JSON/double-quoted, single-quoted or plain. None if not decodable."""
    raw = raw.strip()
    if raw.startswith('"'):
        try:
            v = json.loads(raw)
        except json.JSONDecodeError:
            return None
        return v if isinstance(v, str) else None
    if raw.startswith("'") and raw.endswith("'") and len(raw) >= 2:
        return raw[1:-1].replace("''", "'")
    return None if raw[:1] in (">", "|") else raw


def workflow_agents(text: str) -> list[str]:
    m = re.search(r"^## Agents[ \t]*$", text, re.M)
    if not m:
        return []
    rest = text[m.end():]
    nxt = re.search(r"^## ", rest, re.M)
    return re.findall(r"^- `([a-z0-9-]+)`:", rest[: nxt.start()] if nxt else rest, re.M)


def split_cells(line: str) -> list[str]:
    """Cells of one table row, split on unescaped `|` (`\\|` stays in the cell)."""
    body = line.strip()
    body = body[1:] if body.startswith("|") else body
    body = body[:-1] if body.endswith("|") and not body.endswith("\\|") else body
    return [c.strip() for c in re.split(r"(?<!\\)\|", body)]


def table_after(lines: list[str], start: int) -> list[list[str]]:
    rows = []
    for line in lines[start:]:
        if not line.startswith("|"):
            break
        rows.append(split_cells(line))
    return rows


def parse_tables(section: str) -> tuple[list[str], list[list[str]], list[list[str]]]:
    """(agent table header cells, agent data rows, routing data rows)."""
    lines = section.split("\n")
    head: list[str] = []
    agents: list[list[str]] = []
    routing: list[list[str]] = []
    for i, line in enumerate(lines):
        if line.startswith("| Agent |") and not head:
            block = table_after(lines, i)
            head, agents = block[0], [r for r in block[2:] if r]
        elif line.strip() == ROUTING_HEADING and not routing:
            j = i + 1
            while j < len(lines) and not lines[j].startswith("|"):
                j += 1
            routing = table_after(lines, j)[2:]
    return head, agents, routing


def parse_claude(text: str, p: str, errs: list[str]) -> tuple[dict[str, str], str] | None:
    """(frontmatter key -> raw value, body). Roster roles need flat `key: value` lines: quoted or complex keys
    (a line starting with a quote, `?` or `{`), continuation lines and duplicate keys are findings."""
    m = FRONT_RE.match(text)
    if not m:
        errs.append(f"{p}: missing frontmatter")
        return None
    fields: dict[str, str] = {}
    for line in (x for x in m.group(1).split("\n") if x.strip() and not x.strip().startswith("#")):
        kv = KEY_RE.match(line)
        if not kv or line.strip()[0] in "\"'?{":
            errs.append(f"{p}: frontmatter line {line.strip()[:40]!r} is not a plain one-line 'key: value' (quoted or "
                        "complex keys and continuation lines are not allowed in roster roles)")
        elif kv.group(1) in fields:
            errs.append(f"{p}: duplicate frontmatter key {kv.group(1)!r}")
        else:
            fields[kv.group(1)] = line.split(":", 1)[1].strip()
    return fields, m.group(2).strip()


def split_instr(body: str) -> tuple[str | None, str]:
    """(relay text before the role instructions or None when not bridged, role instructions)."""
    i = body.find(INSTR_MARK)
    return (body[:i].strip(), body[i + len(INSTR_MARK):].strip()) if i >= 0 else (None, body.strip())


def toml_literal(lit: str) -> Any:
    return tomllib.loads(f"v = {lit}")["v"]


def escalation(errs: list[str], p: str, parsed: Any) -> None:
    """Escalation on parsed keys and values only, at any depth."""
    todo = [parsed]
    while todo:
        node = todo.pop()
        for k, v in node.items() if isinstance(node, dict) else enumerate(node if isinstance(node, list) else []):
            errs += [f"{p}: permission escalation ({k} = {v!r})"] if (k, v) in ESCALATIONS else []
            todo.append(v)


def check_role(errs: list[str], facts: dict[str, Any], rt: str, name: str, p: str, f: dict[str, Any]) -> str:
    """Managed values of one roster-role file; returns the runtime cell the docs table must show."""
    role = facts["roles"][name]
    info, (shim, _) = role[rt], split_instr(f["body"])
    bridged = bool(info.get("bridged"))
    if (shim is not None) != bridged:
        errs.append(f"{p}: must {'be' if bridged else 'not be'} a bridge shim (bridge mode {facts['bridgeMode'].get(rt)})")
    if bridged:
        want = (facts["shim"][rt]["model"], facts["shim"][rt]["effort"])
        errs += [f"{p}: bridged tools must be {facts['shimTools']!r}, found {f['tools']!r}"] if rt == "claude" and f["tools"] != facts["shimTools"] else []
        errs += [f"{p}: bridge shim text differs from the expected relay text"] if shim is not None and shim != info["shimText"] else []
        errs += [f"{p}: description must end with {info['suffix'].strip()!r}"] if not f["description"].endswith(info["suffix"]) else []
    else:
        want = (role["model"] if info["kind"] == "native" else info["fallback"], role["effort"])
        errs += [f"{p}: expected tools {role['tools']!r}, found {f['tools']!r}"] if rt == "claude" and (f["tools"] or None) != role["tools"] else []
    if (f["model"], f["effort"]) != want:
        errs.append(f"{p}: expected {want[0]} / {want[1]}, found {f['model']} / {f['effort']}")
    errs += [f"{p}: managed key {k} must be {v!r}, found {f['extra'].get(k)!r}" for k, v in f["expect"].items() if f["extra"].get(k) != v]
    return f"bridge ({CALLS[rt]})" if bridged else "native" if f["model"] == role["model"] else f"fallback `{f['model']}`"


Parsed = dict[str, tuple[str, str, str]]  # name -> (description base, instructions, runtime cell)


def role_files(root: Path, facts: dict[str, Any], rel_dir: str, ext: str, errs: list[str]) -> dict[str, Path]:
    """Roster role files that exist (symlinks are findings). Everything else in the folder is ignored."""
    paths = {n: root / rel_dir / f"{n}{ext}" for n in facts["roles"]}
    errs += [f"{rel_dir}/{n}{ext}: is a symlink (agent files must be regular files)" for n, f in paths.items() if f.is_symlink()]
    return {n: f for n, f in paths.items() if f.exists() and not f.is_symlink()}


def check_codex(root: Path, facts: dict[str, Any], errs: list[str]) -> Parsed:
    out: Parsed = {}
    for name, f in role_files(root, facts, CODEX_DIR, ".toml", errs).items():
        p = f"{CODEX_DIR}/{name}.toml"
        try:
            d = tomllib.loads(read_file(f, root))
        except (Bad, tomllib.TOMLDecodeError) as e:
            errs.append(f"{p}: {e}")
            continue
        errs += [f"{p}: name != file name"] if d.get("name") != name else []
        desc, instr = d.get("description"), d.get("developer_instructions")
        if not isinstance(desc, str) or not desc.strip() or not isinstance(instr, str) or not instr.strip():
            errs.append(f"{p}: empty or non-string description or developer_instructions")
            continue
        errs += [f"{p}: [agents] enabled must be the boolean false"] if not isinstance(d.get("agents"), dict) or d["agents"].get("enabled") is not False else []
        ex = facts["roles"][name]["codex"]["extras"]
        extra = {k: d.get(k) for k in ex["top"]} | {f"{t}.{k}": (d.get(t) or {}).get(k) for t, kv in ex["tables"].items() for k in kv if isinstance(d.get(t), dict)}
        expect = {k: toml_literal(v) for k, v in ex["top"].items()} | {f"{t}.{k}": toml_literal(v) for t, kv in ex["tables"].items() for k, v in kv.items()}
        tables = {"agents": {"enabled"}} | {t: set(kv) for t, kv in ex["tables"].items()}
        for k, v in d.items():
            if k in tables:
                errs += [f"{p}: non-allowlisted key {k}.{x} ({WHY_PERMS})" for x in (sorted(set(v) - tables[k]) if isinstance(v, dict) else [])]
            elif k == "mcp_servers" and isinstance(v, dict) and not facts["roles"][name]["codex"]["bridged"]:
                errs += [f"{p}: [mcp_servers.{s}] is not in this role's mcp_allow" for s in sorted(set(v) - set(facts["roles"][name]["mcp_allow"]))]
            elif k not in (*CODEX_MANAGED, *ex["top"]):
                errs.append(f"{p}: non-allowlisted key {k} ({WHY_PERMS})")
        escalation(errs, p, d)
        fields = {"model": d.get("model"), "effort": d.get("model_reasoning_effort"), "tools": None, "description": desc,
                  "body": instr, "extra": extra, "expect": expect}
        out[name] = (SUFFIX_RE.sub("", desc), split_instr(instr)[1], check_role(errs, facts, "codex", name, p, fields))
    return out


def check_claude(root: Path, facts: dict[str, Any], errs: list[str]) -> Parsed:
    out: Parsed = {}
    for name, f in role_files(root, facts, CLAUDE_DIR, ".md", errs).items():
        p = f"{CLAUDE_DIR}/{name}.md"
        try:
            parsed = parse_claude(read_file(f, root), p, errs)
        except Bad as e:
            errs.append(f"{p}: {e}")
            continue
        if not parsed:
            continue
        fm, body = parsed
        errs += [f"{p}: name != file name"] if scalar(fm.get("name", "")) != name else []
        desc = scalar(fm.get("description", "")) if fm.get("description", "").startswith('"') else None
        if desc is None or not desc.strip() or not body:
            errs.append(f"{p}: description must be a non-empty one-line JSON-quoted YAML string, and the body non-empty")
            continue
        expect = dict(facts["roles"][name]["claude"]["extras"]["frontmatter"])
        errs += [f"{p}: permission escalation (permissionMode is not allowed in roster agents)" if k == "permissionMode"
                 else f"{p}: non-allowlisted key {k} ({WHY_PERMS})" for k in sorted(set(fm) - {*CLAUDE_MANAGED, *CLAUDE_ALLOW, *expect})]
        fields = {"model": fm.get("model"), "effort": fm.get("effort"), "tools": fm.get("tools"), "description": desc,
                  "body": body, "extra": fm, "expect": expect}
        out[name] = (SUFFIX_RE.sub("", desc), split_instr(body)[1], check_role(errs, facts, "claude", name, p, fields))
    return out


def check_workflows(root: Path, facts: dict[str, Any], agents: set[str], lock_files: set[str]) -> list[str]:
    errs: list[str] = []
    for wf in facts["workflows"]:
        skill, link = root / ".agents/skills" / wf, root / ".claude/skills" / wf
        if not skill.exists() and not link.is_symlink() and f".agents/skills/{wf}/SKILL.md" not in lock_files:
            continue
        if not (skill / "SKILL.md").is_file():
            errs.append(f".agents/skills/{wf}/SKILL.md is missing")
            continue
        want = f"../../.agents/skills/{wf}"
        if not link.is_symlink() or link.readlink().as_posix() != want or link.resolve() != skill.resolve():
            errs.append(f".claude/skills/{wf} must be a symlink to {want}")
        texts: dict[Path, str] = {}
        for f in (x for x in sorted(skill.rglob("*")) if x.is_file()):
            try:
                texts[f] = read_file(f, root)
            except Bad as e:
                errs.append(f"{f.relative_to(root)}: {e}")
        errs += [f"{f.relative_to(root)}: mentions model ID {m}" for f, t in texts.items() for m in facts["models"] if m in t]
        errs += [f"workflow {wf}: agent {a} missing from .claude/agents or .codex/agents"
                 for a in workflow_agents(texts.get(skill / "SKILL.md", "")) if a not in agents]
        errs += [f"workflow {wf}: requires workflow {d}, which is not installed"
                 for d in facts["workflowRequires"].get(wf, []) if not (root / ".agents/skills" / d / "SKILL.md").is_file()]
    return errs


def marked_section(text: str) -> str:
    starts, ends = list(START_RE.finditer(text)), list(END_RE.finditer(text))
    if not starts and not ends:
        raise Bad(f"missing the {MARK_START} / {MARK_END} markers around the roster section")
    if len(starts) != 1 or len(ends) != 1 or starts[0].start() > ends[0].start():
        raise Bad("expected exactly one start marker before one end marker")
    inner = text[starts[0].end():ends[0].start()].strip("\n")
    if not inner.startswith(HEADING + "\n"):
        raise Bad(f"the marked region must begin with '{HEADING}'")
    return inner


def check_doc(root: Path, doc: str, facts: dict[str, Any], claude: Parsed, codex: Parsed, agents: set[str],
              wfs: list[str]) -> list[str]:
    try:
        head, rows, routing = parse_tables(marked_section(read_file(root / doc, root, follow=True)))
    except Bad as e:
        return [f"{doc}: {e}"]
    if head != TABLE_HEAD:
        return [f"{doc}: agent table header must be {' | '.join(TABLE_HEAD)}"]
    by_row: dict[str, list[list[str]]] = {}
    for cells in rows:
        a = re.fullmatch(r"`([^`]+)`", cells[0])
        if a:
            by_row.setdefault(a.group(1), []).append(cells)
    errs = [f"{doc}: row for unknown agent {n}" for n in by_row if n not in claude]
    for n, r in ((n, r) for n, r in facts["roles"].items() if n in claude):
        found = by_row.get(n, [])
        if len(found) != 1 or len(found[0]) != len(TABLE_HEAD):
            errs.append(f"{doc}: {n} has {len(found)} rows, expected exactly 1 with {len(TABLE_HEAD)} cells")
            continue
        want = [r["group"], f"`{r['model']} · {r['effort']}`", claude[n][2], codex.get(n, ("", "", ""))[2]]
        errs += [f"{doc}: {n} {label} cell {got!r} does not match its files ({exp!r})"
                 for label, got, exp in zip(TABLE_HEAD[1:5], found[0][1:5], want) if got != exp]
        errs += [f"{doc}: {n} has an empty 'Use for' cell"] if not found[0][5] else []
    for cells in routing:
        use = cells[-1] if cells else ""
        bad = [a for a in TICK_RE.findall(use) if a not in agents] + [w for w in BOLD_RE.findall(use) if w not in wfs]
        errs += [f"{doc}: routing row {cells[0]!r} names missing agents/workflows {sorted(set(bad))}"] if bad else []
    return errs


def check_lock(root: Path, facts: dict[str, Any]) -> tuple[list[str], set[str]]:
    try:
        data = json.loads(read_file(root / LOCK_REL, root))
    except (Bad, json.JSONDecodeError) as e:
        return [f"{LOCK_REL}: {e}"], set()
    files = data.get("files") if isinstance(data, dict) else None
    if not isinstance(files, dict) or data.get("version") != 3:
        return [f"{LOCK_REL}: must be a version 3 lock with a files map (re-run the installer to migrate)"], set()
    errs: list[str] = []
    keys: set[str] = set()
    scope, wfs = set(facts["roles"]) | set(facts["retiredRoles"]), [*facts["workflows"], *facts["retiredWorkflows"]]
    for k in sorted(files):
        if not valid_lock_key(k, scope, wfs):
            errs.append(f"{LOCK_REL}: lock key {k!r} is not an exact roster-managed path")
            continue
        keys.add(k)
        fl = files[k].get("fields", {}) if isinstance(files[k], dict) else None
        if not isinstance(fl, dict) or any(not isinstance(v, dict) or v.get("source") not in ("roster", "user")
                                           or not isinstance(v.get("written"), str) for v in fl.values()):
            errs.append(f"{LOCK_REL}: malformed entry for {k}")
        errs += [f"{LOCK_REL}: tracked file {k} is missing"] if k.startswith(LOCK_PREFIXES) and not (root / k).is_file() else []
    if data.get("bridge_mode") != facts["bridgeMode"]:
        errs.append(f"{LOCK_REL}: bridge_mode {data.get('bridge_mode')!r} differs from facts.json {facts['bridgeMode']!r}")
    return errs, keys


def check_runtime(root: Path, facts: dict[str, Any]) -> list[str]:
    d, errs = root / RUNTIME_DIR, []
    if d.is_symlink() or not d.is_dir():
        return [f"{RUNTIME_DIR} must be a real directory"]
    for e in sorted(d.iterdir()):
        if e.name == "tmp" and (e.is_symlink() or not e.is_dir()):
            errs.append(f"{RUNTIME_DIR}/tmp must be a real directory")
        elif e.name not in (*RUNTIME_ENTRIES, "tmp"):
            errs.append(f"{RUNTIME_DIR}/{e.name}: unexpected entry (only {', '.join(RUNTIME_ENTRIES)} and tmp/ are allowed)")
    for name in COPIED:
        f = d / name
        got = hashlib.sha256(f.read_bytes()).hexdigest() if f.is_file() and not f.is_symlink() else None
        if got != facts["runtimeHashes"].get(name):
            errs.append(f"{RUNTIME_DIR}/{name} is missing, not a regular file, or differs from the sha256 in facts.json (re-run the installer)")
    try:
        errs += [f"{RUNTIME_DIR}/.gitignore must ignore tmp/"] if "tmp/" not in read_file(d / ".gitignore", root).split("\n") else []
    except Bad as e:
        errs.append(f"{RUNTIME_DIR}/.gitignore: {e}")
    return errs


def check_facts(facts: dict[str, Any]) -> list[str]:
    """Roles carry exactly the known keys (no `perm` blob or other extras)."""
    errs = []
    for n, r in facts["roles"].items():
        bad = set(r) ^ ROLE_KEYS if isinstance(r, dict) else {"?"}
        bad = bad or {f"{rt}.{k}" for rt in ("claude", "codex") for k in (set(r[rt]) - RT_KEYS if isinstance(r[rt], dict) else {"?"})}
        errs += [f"{FACTS_REL}: role {n} has missing or unexpected keys {sorted(bad)}"] * bool(bad)
    return errs


def derive_extras(r: dict[str, Any], rt: str, bridged: bool) -> Any:
    """The managed permission keys a role's agent file must carry, derived from writes/tools only."""
    w = r["writes"]
    if rt == "claude":
        return {"frontmatter": {} if bridged or w not in ("no", "commands") or r["tools"] else {"disallowedTools": "Write, Edit, NotebookEdit"}}
    if bridged:
        return {"top": {"sandbox_mode": '"workspace-write"'}, "tables": {"sandbox_workspace_write": {"network_access": "true"}}}
    mode = {"no": "read-only", "commands": "workspace-write", "worktree": "workspace-write"}.get(w)
    return {"top": {"sandbox_mode": f'"{mode}"'} if mode else {}, "tables": {}}


def load_module(name: str, data: bytes, root: Path, file: str) -> types.ModuleType:
    """Run `data` as module `name` as if it were root/.agents/roster/<file>. Never imports anything from the repo."""
    mod = types.ModuleType(name)
    mod.__file__ = str(root / RUNTIME_DIR / file)
    exec(compile(data, mod.__file__, "exec"), mod.__dict__)  # noqa: S102 - bytes already verified by the caller
    return mod


def check_policy(root: Path, facts: dict[str, Any], good: dict[str, bytes], common: str, skill_scripts: Path | None) -> list[str]:
    """Re-derive each role's permissions from writes/network/tools/mcp_allow, compare with the facts' managed keys
    and with the argv the bridge computes. The bridge and policy code come from the skill's own scripts when the skill
    runs the check, otherwise from the repo files whose bytes matched the trust anchor; any other bytes never run."""
    errs = [f"{FACTS_REL}: {n} {rt} extras differ from the policy derived from writes={r['writes']!r}"
            for n, r in sorted(facts["roles"].items()) for rt in ("claude", "codex") if r[rt]["extras"] != derive_extras(r, rt, bool(r[rt]["bridged"]))]
    if skill_scripts is not None:
        src = {d: (skill_scripts / s).read_bytes() for d, s in COPIED.items() if d in LOADED}
    else:
        src = {n: good[n] for n in LOADED if n in good}
    if len(src) != len(LOADED):
        return errs + [f"{RUNTIME_DIR}/{n}: not executed for the policy check (it does not match the trust anchor)" for n in LOADED if n not in src]
    try:
        bridge = load_module("roster_bridge_under_check", src["bridge.py"], root, "bridge.py")
        bridge.ROOT, bridge.RDIR, bridge.TMP = root, root / RUNTIME_DIR, root / RUNTIME_DIR / "tmp"
        [bridge.module(n[:-3], src[n]) for n in LOADED if n.startswith("bridge_")]
        bridge.module("bridge_wt").pin_tools([root], [root])  # git, claude, ps and codex resolve like the bridge's own: never from the repo or its ignored directories
        mod = load_module("roster_policy_check", src["check_policy.py"], root, "check_policy.py")
        return errs + mod.policy_findings(bridge, root, facts, common, RUNTIME_DIR)
    except Exception as e:  # noqa: BLE001 - any failure to load the verified code is a finding
        return errs + [f"{RUNTIME_DIR}/bridge.py cannot be loaded for the policy check ({type(e).__name__}: {e})"]


Anchor = tuple[list[str], dict[str, bytes], str]  # (findings, name -> verified bytes, git common dir)


def run_check(root: Path, skill_scripts: Path | None = None, anchor: Anchor | None = None) -> list[str]:
    """All findings for a repo. `skill_scripts` (the skill's scripts dir) makes the policy check run the skill's own
    bridge and policy code. `anchor` is the trust-anchor result the bootstrap (check.py) computed before running this
    module; the skill computes it itself. Without the skill's code only anchor-verified repo bytes ever run."""
    root = root.resolve()
    try:
        facts = json.loads(read_file(root / FACTS_REL, root))
        missing = [k for k in REQUIRED_FACTS if k not in facts]
    except (Bad, json.JSONDecodeError) as e:
        return [f"{FACTS_REL}: {e} (run the agent-roster installer)"]
    if missing or check_facts(facts):
        return [f"{FACTS_REL}: missing keys {missing} (re-run the agent-roster installer)"] if missing else check_facts(facts)
    errs = check_runtime(root, facts)
    if anchor is None:  # the skill's checker; the installed one always gets the bootstrap's result
        from roster_check_main import anchor_state  # noqa: PLC0415
        anchor = anchor_state(root, facts["runtimeHashes"])
    errs += anchor[0]
    lock_errs, lock_files = check_lock(root, facts)
    errs += lock_errs
    cdir = root / CODEX_DIR
    total = sum(f.stat().st_size for f in cdir.iterdir() if f.is_file()) if cdir.is_dir() else 0
    if total >= int(facts["cap"]):
        errs.append(f".codex/agents is {total} bytes; must be under {facts['cap']} (Codex caps its tool description; "
                    "move persona files to docs/agent-library/codex/)")
    codex, claude = check_codex(root, facts, errs), check_claude(root, facts, errs)
    present = {rt: {n for n in facts["roles"] if (root / d / f"{n}{ext}").exists()}
               for rt, d, ext in (("claude", CLAUDE_DIR, ".md"), ("codex", CODEX_DIR, ".toml"))}
    if present["claude"] != present["codex"]:
        errs.append(f"agent names differ: claude-only {sorted(present['claude'] - present['codex'])}, "
                    f"codex-only {sorted(present['codex'] - present['claude'])}")
    both = set(claude) & set(codex)
    for name in sorted(both):
        errs += [f"{name}: {what} must be the same in both runtimes" for i, what in ((0, "description"), (1, "role instructions"))
                 if claude[name][i] != codex[name][i]]
    errs += check_workflows(root, facts, both, lock_files)
    docs = [d for d in ("CLAUDE.md", "AGENTS.md") if (root / d).exists()]
    errs += ["no CLAUDE.md or AGENTS.md with a roster section"] * (not docs)
    wfs = [w for w in facts["workflows"] if (root / ".agents/skills" / w / "SKILL.md").is_file()]
    for doc in docs:
        errs += check_doc(root, doc, facts, claude, codex, both, wfs)
    try:
        errs += check_policy(root, facts, anchor[1], anchor[2], skill_scripts)
    except (KeyError, TypeError, ValueError, AttributeError) as e:
        errs.append(f"{FACTS_REL}: malformed role data ({type(e).__name__}: {e})")
    return errs
