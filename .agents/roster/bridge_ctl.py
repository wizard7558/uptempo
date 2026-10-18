"""Protected control paths of a repo (installed as .agents/roster/bridge_ctl.py; loaded by bridge_policy.py). Pure
functions, stdlib only: which files and trees of a checkout a bridged child must never change (the fixed control files,
the files that Claude and Codex hooks, MCP servers and notify programs name, the git hooks directory and the in-repo
targets of its symlinks, the in-repo `@path` imports of the memory files (`.claude/rules/**/*.md` too), the config files git
includes and the programs its configuration names, the programs of the Codex config, nested worktrees, every nested
`.claude`/`.codex`/`.agents` directory and `CLAUDE.md`-style file at any depth, the in-repo targets of symlinks among
them), read from the config files WITHOUT following a symlink out of the repo. A config file that exists but cannot be
read or parsed is a ConfigError: the bridge refuses the run (exit 2) rather than guess which hooks it names. bridge.py
executes this file's bytes only after they match the trust anchor."""
from __future__ import annotations

import json
import os
import re
import shlex
import stat
import sys
import tomllib
from pathlib import Path
from typing import Any

try:
    C = load("bridge_cfg")  # type: ignore[name-defined]  # noqa: F821 - injected by bridge.module (the verified bytes)
except NameError:  # imported as a plain module (tests, the skill's own tooling)
    import bridge_cfg as C

CONFIG_MAX = C.CONFIG_MAX  # bytes of one config file that are read
canon, within, _inside = C.canon, C.within, C._inside  # one definition of the canonical-path helpers (bridge_cfg)
nested_worktrees, hooks_dir, git_hooks_dirs, hook_link_targets, nested_controls = C.nested_worktrees, C.hooks_dir, C.git_hooks_dirs, C.hook_link_targets, C.nested_controls
MEMORY, IMPORT, IMPORT_DEPTH, import_tokens, read_small, memory_imports = C.MEMORY, C.IMPORT, C.IMPORT_DEPTH, C.import_tokens, C.read_small, C.memory_imports
norm_word, rels = C.norm_word, C.rels


class ConfigError(ValueError):
    """A config file that names protected programs exists but cannot be read or parsed (the message never has its content)."""


# ------------------------------------------------------ protected control paths
FILES = (".claude/settings.json", ".claude/settings.local.json", ".claude/CLAUDE.md", ".mcp.json", "CLAUDE.md",
         "CLAUDE.local.md", "AGENTS.md", "AGENTS.override.md", ".gitattributes", ".git")  # `.git` only when it is a file
TREES = (".claude/agents", ".claude/commands", ".claude/hooks", ".claude/skills", ".claude/rules", ".codex", ".agents")
SETTINGS = (".claude/settings.json", ".claude/settings.local.json")


SCRIPT_EXT = (".js", ".mjs", ".cjs", ".ts", ".sh", ".py", ".rb")
COMMAND_KEY = re.compile(r"^command$|(Helper|Refresh|Export)$")
SUBST_CMD = re.compile(r"\$\((?:[^()]|\([^()]*\))*\)|`[^`]*`")  # $(...) and `...`: some command's output, assumed to name the repo


def commands_in(data: Any) -> list[str]:
    """Every command-valued entry of parsed settings: a string (or a list of strings, shell-joined) under a key named
    `command` (hooks, statusLine, ...) or a string under a key ending in `Helper`, `Refresh` or `Export`
    (apiKeyHelper, awsAuthRefresh, awsCredentialExport, otelHeadersHelper, ...), at any depth."""
    cmds: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                if isinstance(v, str) and COMMAND_KEY.search(k):
                    cmds.append(v)
                elif k == "command" and isinstance(v, list) and v and all(isinstance(a, str) for a in v):
                    cmds.append(shlex.join(v))
                else:
                    walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)
    walk(data)
    return cmds


def hook_commands(settings_text: str) -> list[str]:
    """The command-valued strings (commands_in) of a `.claude/settings*.json` text FOLLOWED BY every other string of it
    (all_strings: `env` values such as `NODE_OPTIONS=--require ./tools/preload.js`, `statusLine`, ... a string that names
    no file protects nothing); none when it does not parse."""
    try:
        data = json.loads(settings_text)
        return commands_in(data) + [v for v, _cwd in all_strings(data)]
    except ValueError:
        return []


def codex_commands(hooks_json: str, config_toml: str) -> list[str]:
    """Command lines of the Codex hooks: every `command` of `.codex/hooks.json` and of the `[hooks]` table of
    `.codex/config.toml` (any depth; a list of words is shell-joined)."""
    out: list[str] = []
    try:
        out += commands_in(json.loads(hooks_json)) if hooks_json else []
        table = tomllib.loads(config_toml).get("hooks") if config_toml else None
        out += commands_in(table) if table is not None else []
    except ValueError:
        pass
    return out


def _words(text: str) -> list[str]:
    """Shell words of a command line with the operators (`&&`, `;`, `|`, parentheses, redirections) as separate tokens."""
    try:
        lex = shlex.shlex(text, posix=True, punctuation_chars=True)
        lex.whitespace_split = True
        return list(lex)
    except ValueError:
        return text.split()


def _scan(base: str, text: str, cwd: str, depth: int, out: list[str]) -> None:
    """Add the repo-relative files that the words of `text` name (each word goes through norm_word: `~`, `$HOME`,
    `$CLAUDE_PROJECT_DIR`; other `$VAR` words stay unresolved; inside-repo is judged lexically and canonically, see rels). A `cd <dir>` in a `&&`/`;` chain moves the directory
    that later relative words resolve against (starting from `cwd`, the repo root for a hook); an argument that itself
    holds a command line (`bash -c "..."`) is scanned the same way from the current directory."""
    seg = True  # at the start of a command
    parts, i = _words(SUBST_CMD.sub("$ROSTER_BASE", text)), 0  # a command substitution stands for the repo root
    while i < len(parts):
        tok = norm_word(parts[i], base)
        i += 1
        if tok and all(c in "&|;()<>" for c in tok):
            seg = tok != "<" and tok != ">" and tok != ">>"
            continue
        if seg and tok == "cd":
            while i < len(parts) and parts[i].startswith("-"):
                i += 1
            if i < len(parts):
                d = norm_word(parts[i], base)
                cwd = os.path.normpath(d if os.path.isabs(d) else os.path.join(cwd, d))
                i += 1
            seg = False
            continue
        seg = False
        for cand in (tok, norm_word(tok.partition("=")[2], base)):
            if cand and not cand.startswith("-") and (os.path.isabs(cand) or "/" in cand or os.path.lexists(os.path.join(cwd, cand))):
                for rel in rels(base, cand if os.path.isabs(cand) else os.path.join(cwd, cand)):
                    out.append(rel)
                    if not os.path.splitext(rel)[1]:  # an extensionless word: the script it stands for may carry an extension
                        out += [rel + e for e in SCRIPT_EXT if os.path.lexists(os.path.join(base, rel + e))]
        if depth < 2 and any(c.isspace() for c in tok):
            _scan(base, tok, cwd, depth + 1, out)


def hook_paths(base: str, settings_text: str) -> list[str]:
    """Repo-relative files that command-valued settings (see hook_commands) refer to: `$CLAUDE_PROJECT_DIR`, `${VAR}` and
    `$(...)` prefixes (taken as the repo root), relative paths (against the repo root, or the directory a `cd` in the command chain moved to) and absolute paths
    inside the repo. Limit: a hook that runs repo code indirectly (`npm run`, `make`, `python -m`, an interpreter
    reading a config file) protects only the files its words name."""
    return command_paths(base, hook_commands(settings_text))


def command_paths(base: str, commands: list[str], cwds: tuple[str, ...] = ()) -> list[str]:
    """Repo-relative files that the command lines name (the one resolver of Claude and Codex hooks, MCP servers and
    notify programs); relative words resolve against the repo root and each of `cwds` (a nested instance's directory)."""
    out: list[str] = []
    for c in commands:
        for cwd in (base, *cwds):
            _scan(base, c, cwd, 0, out)
    return list(dict.fromkeys(out))


def codex_walk(data: Any) -> list[tuple[str, str | None]]:
    """(command line, cwd) of every program a parsed `.codex/config.toml` names, at any depth: each `command` (a string or a
    list of words, followed by the `args` beside it: MCP servers, `[model_providers.*.auth]`, hooks), each string under a
    key ending in `_helper`, `_command`, `Helper`, `Refresh` or `Export`, and `notify`. `cwd` is the `cwd` key of the
    table that holds it (None when unset)."""
    out: list[tuple[str, str | None]] = []

    def words(v: Any) -> list[str] | None:
        return [v] if isinstance(v, str) else v if isinstance(v, list) and v and all(isinstance(a, str) for a in v) else None

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            cwd = node["cwd"] if isinstance(node.get("cwd"), str) else None
            for k, v in node.items():
                if k == "command" and (w := words(v)) is not None:
                    args = node.get("args")
                    out.append((shlex.join([*w, *(a for a in (args if isinstance(args, list) else []) if isinstance(a, str))]), cwd))
                elif k == "notify" and (w := words(v)) is not None:
                    out.append((shlex.join(w), cwd))
                elif isinstance(v, str) and (k.endswith(("_helper", "_command")) or COMMAND_KEY.search(k)):
                    out.append((v, cwd))
                else:
                    walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)
    walk(data)
    return out


def all_strings(data: Any) -> list[tuple[str, str | None]]:
    """(string, cwd) for EVERY string in parsed config data, at any depth and inside arrays (keys are not strings of the
    config, a `cwd` value is skipped); `cwd` is the `cwd` key of the table that holds it (None when unset). No key list: a program named under any key
    is found, and a string that names no file protects nothing."""
    out: list[tuple[str, str | None]] = []

    def walk(node: Any, cwd: str | None) -> None:
        if isinstance(node, dict):
            here = node["cwd"] if isinstance(node.get("cwd"), str) else cwd
            [walk(v, here) for k, v in node.items() if k != "cwd"]  # a `cwd` is a directory to run in, not a program: it only resolves words
        elif isinstance(node, list):
            [walk(v, cwd) for v in node]
        elif isinstance(node, str) and node:
            out.append((node, cwd))
    walk(data, None)
    return out


def fallback_names(toml_text: str) -> list[str]:
    """The file names `project_doc_fallback_filenames` lists (any table of a `.codex/config.toml`): Codex reads them like
    AGENTS.md, so they are memory files at any depth."""
    try:
        data = tomllib.loads(toml_text) if toml_text else {}
    except ValueError:
        return []
    return [n for k, v in _items(data) if k == "project_doc_fallback_filenames" and isinstance(v, list) for n in v if isinstance(n, str) and n not in (".", "..") and "/" not in n and "\0" not in n]


def _items(node: Any) -> list[tuple[str, Any]]:
    found: list[tuple[str, Any]] = []
    for k, v in node.items() if isinstance(node, dict) else []:
        found += [(k, v), *_items(v)]
    return found


def codex_programs(base: str, toml_text: str, inst: str) -> list[str]:
    """Repo-relative files named by the programs of a `.codex/config.toml` (codex_walk, and every string of it: all_strings); `inst` is the directory that holds
    its `.codex` (the repo root or a nested instance's directory). A relative word resolves against the repo root, `inst`
    and, when the table sets a `cwd`, that directory (relative to either; a `cwd` outside the repo is ignored)."""
    try:
        data = tomllib.loads(toml_text) if toml_text else {}
    except ValueError:
        return []
    out: list[str] = []
    for cmd, cwd in [*codex_walk(data), *all_strings(data)]:
        dirs = {inst}
        for root in (base, inst) if cwd else ():
            full = os.path.normpath(cwd if os.path.isabs(cwd) else os.path.join(root, cwd))  # type: ignore[arg-type]
            if full == os.path.normpath(base) or _inside(base, full) is not None:
                dirs.add(full)
        out += command_paths(base, [cmd], tuple(dirs))
    return out


def server_commands(text: str, toml: bool) -> list[str]:
    """Command lines of the MCP servers in a `.mcp.json` (`mcpServers`: `command` + `args`, shell-quoted) FOLLOWED BY every
    other string of the file (`headersHelper`, `env` values, ... : all_strings); for `toml`, of every program of a
    `.codex/config.toml` (codex_walk)."""
    try:
        data = tomllib.loads(text) if toml else json.loads(text)
    except ValueError:
        return []
    if toml:
        return [c for c, _cwd in codex_walk(data)]
    servers = data.get("mcpServers") if isinstance(data, dict) else None
    lines = []
    for s in servers.values() if isinstance(servers, dict) else []:
        if isinstance(s, dict) and isinstance(s.get("command"), str):
            args = s.get("args")
            lines.append(shlex.join([s["command"], *[a for a in (args if isinstance(args, list) else []) if isinstance(a, str)]]))
    return lines + [v for v, _cwd in all_strings(data)]


NESTED_DIRS, NESTED_FILES, GIT_ANY = C.NESTED_DIRS, C.NESTED_FILES, C.GIT_ANY


def read_config(base: str, rel: str, toml: bool = False) -> str:
    """Text of the config file `rel` below `base` ("" when it does not exist). A symlink (or a symlinked directory above
    it) is followed only when it resolves inside the repo; the resolved file is opened with O_NOFOLLOW and must be a
    regular file of at most CONFIG_MAX bytes that parses as JSON (TOML for `toml`). ConfigError otherwise."""
    path = os.path.join(base, rel)
    if not os.path.lexists(path):
        return ""
    real = canon(path)
    if within(base, real) in (None, "."):
        raise ConfigError(f"{rel} resolves outside the repo (a symlink); refusing to run: fix or remove it")
    try:
        fd = os.open(real, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    except OSError as e:
        raise ConfigError(f"{rel} cannot be read ({e.strerror}); refusing to run")
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_size > CONFIG_MAX:
            raise ConfigError(f"{rel} is not a regular file of at most {CONFIG_MAX} bytes; refusing to run")
        text = os.read(fd, CONFIG_MAX + 1).decode("utf-8")
    except UnicodeDecodeError:
        raise ConfigError(f"{rel} is not valid UTF-8; refusing to run")
    except OSError as e:
        raise ConfigError(f"{rel} cannot be read ({e.strerror}); refusing to run")
    finally:
        os.close(fd)
    try:
        tomllib.loads(text) if toml else json.loads(text)
    except ValueError:
        raise ConfigError(f"{rel} is not valid {'TOML' if toml else 'JSON'}; refusing to run: fix or remove it")
    return text


USER_MAX = 16_000_000  # bytes of ~/.claude.json that are read (it also holds the history of every project)


def user_text(path: str, limit: int) -> str | None:
    """Text of the user-scope file `path`, None when it does not exist; a one-line notice (never any content) on stderr and
    None when it cannot be read, is too big or is not valid UTF-8. These files are outside the repo: never a refusal."""
    if not os.path.lexists(path):
        return None
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_CLOEXEC)
        try:
            st = os.fstat(fd)
            if not stat.S_ISREG(st.st_mode) or st.st_size > limit:
                raise ValueError("not a regular file within the size limit")
            return os.read(fd, limit + 1).decode("utf-8")
        finally:
            os.close(fd)
    except (OSError, ValueError) as e:
        print(f"bridge: note: skipped unreadable user-scope config {path} ({type(e).__name__})", file=sys.stderr)
        return None


def user_scope_paths(b: str, home: str | None = None) -> list[str]:
    """See _user_scope_paths. Only targets that exist, or that name a script (SCRIPT_EXT) the child could create, count: the user's
    own files hold many words (URLs, `org/repo` names) that would otherwise protect directories that do not exist."""
    return [r for r in _user_scope_paths(b, home) if os.path.lexists(os.path.join(b, r)) or os.path.splitext(r)[1] in SCRIPT_EXT]


def _user_scope_paths(b: str, home: str | None = None) -> list[str]:
    """Repo-relative in-repo files named by the user-scope and local-scope configuration that Claude or Codex would run:
    `~/.claude.json` (only `projects[<canonical root>].mcpServers` and the top-level `mcpServers` are parsed out of it),
    `<CLAUDE_CONFIG_DIR or ~/.claude>/settings.json` and `settings.local.json`, and `<CODEX_HOME or ~/.codex>/config.toml`;
    every string goes through command_paths resolved against the repo root (targets outside the repo are ignored). A missing,
    unreadable or invalid file is skipped with a one-line notice; no value is ever printed."""
    home = home or os.path.expanduser("~")
    out: list[str] = []
    text = user_text(os.path.join(home, ".claude.json"), USER_MAX)
    try:
        data = json.loads(text) if text else {}
    except ValueError:
        print("bridge: note: skipped unreadable user-scope config ~/.claude.json (ValueError)", file=sys.stderr)
        data = {}
    projects = data.get("projects") if isinstance(data, dict) else None
    mine = projects.get(str(canon(b))) if isinstance(projects, dict) else None
    for holder in (data, mine):
        servers = holder.get("mcpServers") if isinstance(holder, dict) else None
        if isinstance(servers, dict):
            out += command_paths(b, server_commands(json.dumps({"mcpServers": servers}), False))
    cdir = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(home, ".claude")
    for name in ("settings.json", "settings.local.json"):
        text = user_text(os.path.join(cdir, name), CONFIG_MAX)
        try:
            out += command_paths(b, hook_commands(text)) if text and json.loads(text) is not None else []
        except ValueError:
            print(f"bridge: note: skipped unreadable user-scope config {os.path.join(cdir, name)} (ValueError)", file=sys.stderr)
    text = user_text(os.path.join(os.environ.get("CODEX_HOME") or os.path.join(home, ".codex"), "config.toml"), CONFIG_MAX)
    if text is not None:
        try:
            out += command_paths(b, [c for c, _cwd in codex_walk(tomllib.loads(text))] + [v for v, _cwd in all_strings(tomllib.loads(text))])
        except ValueError:
            print("bridge: note: skipped unreadable user-scope config ~/.codex/config.toml (ValueError)", file=sys.stderr)
    return out


def nested_hook_paths(base: str, config: Any, nf: list[str], nt: list[str]) -> list[str]:
    """Files named by the hooks, MCP servers and notify programs of the NESTED instances (`sub/.claude/settings*.json`,
    `sub/.codex/hooks.json` and `config.toml`, `sub/.mcp.json`); their relative words resolve against the repo root and
    against the directory that holds the instance. `config(rel, toml)` reads one file (see discover)."""
    out: list[str] = []
    for t in nt:
        parent, kind = os.path.dirname(t), os.path.basename(t)
        cwds = (os.path.join(base, parent),)
        if kind == ".claude":
            out += command_paths(base, [c for s in SETTINGS for c in hook_commands(config(f"{t}/{os.path.basename(s)}"))], cwds)
        elif kind == ".codex":
            toml = config(f"{t}/config.toml", True)
            out += command_paths(base, codex_commands(config(f"{t}/hooks.json"), toml), cwds) + codex_programs(base, toml, cwds[0])
    for f in nf:
        if os.path.basename(f) == ".mcp.json":
            out += command_paths(base, server_commands(config(f), False), (os.path.join(base, os.path.dirname(f)),))
    return out


def discover(base: Path, keep: Path | None = None, strict: bool = True) -> dict[str, list[str]]:
    """{files, trees}: repo-relative protected paths of `base`: the fixed control files and trees, every nested control
    file and tree (nested_controls), every file a command-valued setting (Claude settings, `.codex/hooks.json`, the
    `[hooks]` table of `.codex/config.toml`, nested instances too), MCP server (`.mcp.json`, `.codex/config.toml`) or
    notify program names (a directory it names is a tree; an extensionless word also protects its siblings with a
    script extension; the programs of every table of a Codex config, with its `cwd`), the in-repo `@path` imports of
    the memory files (`.claude/rules/**/*.md` too), the config files git includes (`git config --list --show-origin`)
    and the programs its command-valued keys name, every in-repo git hooks directory and the in-repo targets of the
    symlinks in them, the programs that the user-scope Claude and Codex configuration names (user_scope_paths), the registered git worktrees nested inside `base` (except
    the one holding `keep`), and the in-repo target of any of these that is or passes through a symlink. ConfigError
    when a config file exists but cannot be read or parsed (`strict`; otherwise it is skipped, for roles that repair them)."""
    b = str(base)
    files, trees = list(FILES), list(TREES)

    def config(rel: str, toml: bool = False) -> str:
        try:
            return read_config(b, rel, toml)
        except ConfigError:
            if strict:
                raise
            return ""
    for rel in SETTINGS:
        files += hook_paths(b, config(rel))
    files += user_scope_paths(b)  # ~/.claude.json (this project's and the top-level MCP servers), ~/.claude settings, ~/.codex/config.toml
    toml = config(".codex/config.toml", True)
    files += command_paths(b, codex_commands(config(".codex/hooks.json"), toml))
    files += command_paths(b, server_commands(config(".mcp.json"), False))
    files += codex_programs(b, toml, b)
    nf, nt = nested_controls(b)
    names = tuple(dict.fromkeys([*fallback_names(toml), *(n for t in nt if os.path.basename(t) == ".codex" for n in fallback_names(config(f"{t}/config.toml", True)))]))
    if names:  # `project_doc_fallback_filenames`: memory files of Codex at any depth, protected and parsed for @imports like AGENTS.md
        nf = nested_controls(b, names)[0]
        files += names
    files, trees = files + nf, trees + nt
    files += nested_hook_paths(b, config, nf, nt)
    claude = [".claude", *(t for t in nt if os.path.basename(t) == ".claude")]
    memory_names = (*MEMORY, *names)
    files += memory_imports(b, [*(f for f in (*FILES, *names) if os.path.basename(f) in memory_names), *(f for f in nf if os.path.basename(f) in memory_names),
                                *(f"{t}/CLAUDE.md" for t in claude[1:]), *C.rule_files(b, claude)])
    entries = C.config_entries(b)  # git's own configuration: the files it includes and the programs it names (never executed here)
    cfiles, cmds = C.config_protect(b, entries)
    files += cfiles + command_paths(b, cmds)
    files += hook_link_targets(b, entries)
    trees += C.hook_dir_trees(b, entries)
    trees += nested_worktrees(b, str(keep) if keep else None)
    trees += [f for f in files if os.path.isdir(os.path.join(b, f)) and not os.path.islink(os.path.join(b, f)) and f != ".git"]
    if (hd := hooks_dir(b, entries)) is not None:
        parent = os.path.dirname(hd)  # husky keeps its scripts beside `_`, a dot directory holds sibling hook files
        trees += [parent] if parent and (os.path.basename(hd) == "_" or os.path.basename(parent).startswith(".")) else [hd]
    for rel in [*files, *trees]:  # an entry that is, or passes through, a symlink resolving inside the repo: protect the target too
        real = _inside(os.path.realpath(b), os.path.realpath(os.path.join(b, rel)))
        if real is not None and real != os.path.normpath(rel) and real != ".git" and not real.startswith(".git/"):
            (trees if os.path.isdir(os.path.join(b, real)) else files).append(real)
    trees = [x for x in dict.fromkeys(trees) if not any(x.startswith(o + "/") for o in trees)]
    files = [f for f in dict.fromkeys(files) if not any(f == t or f.startswith(t + "/") for t in trees)]
    return {"files": files, "trees": trees, "names": [C.W.norm(n) for n in names]}


def control_paths(base: Path, keep: Path | None = None, strict: bool = True) -> list[str]:
    """Absolute protected paths under `base` for the sandbox deny rules (`.git` only when it is a file); `keep` is the
    work dir, which is never denied as a nested worktree."""
    spec = discover(base, keep, strict)
    git_is_dir = os.path.isdir(base / ".git") and not os.path.islink(base / ".git")
    return [str(base / r) for r in [*spec["files"], *spec["trees"]] if not (r == ".git" and git_is_dir)]
