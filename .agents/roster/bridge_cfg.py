"""Git and memory-file discovery for the protected control paths (installed as .agents/roster/bridge_cfg.py; used by
bridge_ctl.py). Stdlib only. Everything that asks git goes through the pinned wrapper `bridge_wt.git` (hooks off,
`core.fsmonitor=false`, `diff.external` empty, no `GIT_*` variables, no system config), so reading a repository's
configuration never runs a program the repository names.

What it finds: the registered nested worktrees, the nested `.claude`/`.codex`/`.agents` trees and `CLAUDE.md`-style
files, the git hooks directories (`core.hooksPath`, the common dir's `hooks`) and the in-repo targets of the symlinks in
them, the in-repo files that the git configuration itself includes (`git config --list --show-origin -z`: every `file:`
origin inside the work tree, `include.path` and `includeIf.*.path` targets) and the command lines it names (every value of every key: filter drivers, diff and merge drivers, fsmonitor, ssh, editor, pager, credential, askpass and gpg programs, `!` aliases, ...), and the `@path` imports of the memory files (`CLAUDE.md`, `AGENTS.md`, `.claude/rules/**/*.md`).
bridge.py executes this file's bytes only after they match the trust anchor (`load`, injected by bridge.module)."""
from __future__ import annotations

import collections
import os
import re
import stat

try:
    W = load("bridge_wt")  # type: ignore[name-defined]  # noqa: F821 - injected by bridge.module (the verified bytes)
except NameError:  # imported as a plain module (tests, the skill's own tooling)
    import bridge_wt as W

CONFIG_MAX = 1_000_000  # bytes of one config or memory file that are read


def canon(p: str | os.PathLike[str]) -> str:
    """The one canonical form of a path (symlinks resolved, so /var/... and /private/var/... agree) for every place that
    compares, prefixes or relativizes paths that came from git, HOME, TMPDIR or the repo."""
    return os.path.realpath(os.fspath(p))


def within(base: str | os.PathLike[str], p: str | os.PathLike[str]) -> str | None:
    """`p` relative to `base` ("." when they are the same place) once both are canonical; None when `p` is outside
    `base`. Unlike Path.relative_to it never raises."""
    b, q = canon(base), canon(p)
    if q == b:
        return "."
    prefix = b if b.endswith(os.sep) else b + os.sep
    return q[len(prefix):] if q.startswith(prefix) else None


def _inside(base: str, p: str) -> str | None:
    """`p` relative to `base` when it lies strictly inside it (lexically; no symlink is resolved), else None."""
    p = os.path.normpath(p)
    rel = os.path.relpath(p, base)
    return None if rel == "." or rel == ".." or rel.startswith("../") or os.path.isabs(rel) else rel


def _not_git(rel: str | None) -> bool:
    return rel not in (None, ".") and rel != ".git" and not str(rel).startswith(".git/")


PROJECT_VAR = re.compile(r"\$(?:(?:CLAUDE_PROJECT_DIR|CODEX_PROJECT_DIR|ROSTER_BASE)\b|\{(?:CLAUDE_PROJECT_DIR|CODEX_PROJECT_DIR)\})")
HOME_VAR = re.compile(r"\$(?:HOME\b|\{HOME\})")


def norm_word(tok: str, base: str) -> str:
    """The one normalizer of a path word (a hook or program argument, an `@import`): `$CLAUDE_PROJECT_DIR`/`${CLAUDE_PROJECT_DIR}`
    (and the Codex name; `$ROSTER_BASE` stands for a command substitution) become the repo root, `$HOME`/`${HOME}` and a leading `~`
    the home directory; any other `$VAR` stays as written (it is NOT taken for the root)."""
    return os.path.expanduser(HOME_VAR.sub(lambda _m: os.path.expanduser("~"), PROJECT_VAR.sub(lambda _m: base, tok)))


def rels(base: str, p: str) -> list[str]:
    """Repo-relative spellings of the absolute path `p` that lie strictly inside `base`: the lexical one, the one against the
    canonical base, and the canonical one (symlinks resolved, so a path through a symlinked directory counts as its target).
    `.git` and below are never listed."""
    q = os.path.normpath(p)
    return [r for r in dict.fromkeys((_inside(base, q), _inside(canon(base), q), within(base, q))) if _not_git(r)]  # type: ignore[misc]


def git_out(base: str, args: list[str]) -> str:
    """Stdout of `git -C base <args>` through the pinned wrapper; "" when it fails."""
    r = W.git(["-C", base, *args])
    return r.stdout.decode("utf-8", "replace").strip() if r.returncode == 0 else ""


# ------------------------------------------------------------ git configuration
def config_entries(base: str) -> list[tuple[str, str, str]]:
    """(file, key, value) of every entry of the configuration git reads for `base` that comes from a file, in git's
    order (later wins): `git config --list --show-origin -z`, which follows includes and lists each entry with the file
    it came from. Entries of the command line (the wrapper's own pins) are not listed. Reading it runs no program."""
    r = W.git(["-C", base, "config", "--list", "--show-origin", "-z"])
    toks, out = r.stdout.split(b"\0") if r.returncode == 0 else [], []
    for origin, kv in zip(toks[0::2], toks[1::2]):
        o = os.fsdecode(origin)
        if o.startswith("file:"):
            key, _, val = os.fsdecode(kv).partition("\n")
            out.append((o[5:] if os.path.isabs(o[5:]) else os.path.join(base, o[5:]), key, val))
    return out


INCLUDE_KEY = re.compile(r"^(include|includeif\..+)\.path$", re.I)


def config_protect(base: str, entries: list[tuple[str, str, str]]) -> tuple[list[str], list[str]]:
    """(repo-relative files, command lines) of the git configuration: every config file below `base` outside `.git` (an
    `include.path`/`includeIf.*.path` target too, even when it holds no entry or does not exist yet) is a protected
    file; EVERY value of EVERY key is a command line for the program resolver (bridge_ctl.command_paths), after a leading
    `!` is stripped (`credential.helper`, `pager.*`, `core.askPass`, `mergetool.*.cmd`, `trailer.*.command`, `!` aliases, ...:
    no key list to fall behind git; a value that names no file protects nothing). `sh -c '...'` values are scanned like hooks."""
    files: list[str] = []
    cmds: list[str] = []
    for path, key, val in entries:
        cands = [path]
        if INCLUDE_KEY.match(key) and val:
            inc = os.path.expanduser(val)
            cands.append(inc if os.path.isabs(inc) else os.path.join(os.path.dirname(path), inc))
        for c in cands:
            files += rels(base, c)
        if val.lstrip("!") and not val.endswith("/"):  # a value spelled as a directory (`diff.srcPrefix = SRC/`) is no program
            cmds.append(val[1:] if val.startswith("!") else val)
    return list(dict.fromkeys(files)), cmds


def hooks_path(base: str, entries: list[tuple[str, str, str]] | None = None) -> str | None:
    """The absolute `core.hooksPath` the configuration files set (the last entry wins; relative to the work tree), else None."""
    val = ""
    for _p, key, v in config_entries(base) if entries is None else entries:
        if key.lower() == "core.hookspath":
            val = os.path.expanduser(v)
    return (val if os.path.isabs(val) else os.path.join(base, val)) if val else None


def hooks_dir(base: str, entries: list[tuple[str, str, str]] | None = None) -> str | None:
    """`core.hooksPath` as a repo-relative path when it names a directory inside the repo (not .git)."""
    hp = hooks_path(base, entries)
    rel = _inside(base, hp) if hp else None
    return None if rel is None or rel == ".git" or rel.startswith(".git/") else rel


def git_hooks_dirs(base: str, entries: list[tuple[str, str, str]] | None = None) -> list[str]:
    """Absolute directories git may run hooks from: the `hooks` of the common dir (a hooksPath set later falls back to it;
    the hooks of a linked worktree live there) and the `core.hooksPath` directory."""
    dirs: list[str] = []
    common = git_out(base, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
    if common:
        dirs.append(os.path.join(common, "hooks"))
    if (hp := hooks_path(base, entries)) is not None:
        dirs.append(hp)
    return list(dict.fromkeys(dirs))


def hook_dir_trees(base: str, entries: list[tuple[str, str, str]] | None = None) -> list[str]:
    """Repo-relative directories among the git hooks directories (outside `.git`), by name and by what they resolve to (a
    hooks directory that is a symlink to `scripts/hooks` protects `scripts/hooks`): protected trees."""
    out: list[str] = []
    for d in git_hooks_dirs(base, entries):
        out += [r for r in (_inside(canon(base), d), within(base, d)) if _not_git(r)]  # type: ignore[misc]
    return list(dict.fromkeys(out))


def hook_link_targets(base: str, entries: list[tuple[str, str, str]] | None = None) -> list[str]:
    """Repo-relative in-repo targets of the symlinks among the entries of the git hooks directories (a hook that links
    to `scripts/pre-commit` runs that file): the target is a protected file (a tree for a directory)."""
    out: list[str] = []
    for d in git_hooks_dirs(base, entries):
        try:
            entries_ = [e.path for e in os.scandir(d) if e.is_symlink()]
        except OSError:
            continue
        for path in entries_:
            rel = within(base, path)  # canonical: the link is resolved
            if _not_git(rel):
                out.append(str(rel))
    return out


def nested_worktrees(base: str, keep: str | None = None) -> list[str]:
    """Repo-relative paths of the registered git worktrees (`git worktree list`) that lie strictly inside `base`; the one
    that is, or contains, `keep` (the work dir a child is meant to write) is not listed."""
    r = W.git(["-C", base, "worktree", "list", "--porcelain", "-z"])
    k, found = canon(keep) if keep else "", []
    for tok in r.stdout.split(b"\0"):
        if tok.startswith(b"worktree "):
            p = os.fsdecode(tok[9:])
            rel = within(base, p)
            if rel and rel != "." and rel != ".git" and not rel.startswith(".git/") and not (k and (k == canon(p) or k.startswith(canon(p) + os.sep))):
                found.append(rel)
    return found


GIT_ANY = W.GIT_ANY  # ".git", ".gitattributes", ".gitmodules": protected at any depth (one constant for bridge_wt.protected and the Claude child policy)
NESTED_DIRS = (".claude", ".codex", ".agents")  # a directory of this name at any depth is a control tree
NESTED_FILES = ("CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", "AGENTS.override.md", ".mcp.json")  # ... and a file of this name a control file


def nested_controls(base: str, names: tuple[str, ...] = ()) -> tuple[list[str], list[str]]:
    """(files, trees): the repo-relative control files and trees below the top level that exist now, tracked or
    untracked (`git ls-files --cached --others --exclude-standard`; symlinks are listed, never followed): every
    directory named in NESTED_DIRS (`sub/.claude`) and every file named in NESTED_FILES or `names` (`sub/CLAUDE.md`)."""
    r = W.git(["-C", base, "ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    files, trees = [], []
    for raw in r.stdout.split(b"\0") if r.returncode == 0 else []:
        parts = os.fsdecode(raw).split("/")
        cut = next((i for i, p in enumerate(parts[:-1]) if p in NESTED_DIRS and i > 0), None)
        if cut is not None:
            trees.append("/".join(parts[:cut + 1]))
        elif len(parts) > 1 and (parts[-1] in NESTED_FILES or parts[-1] in names):
            files.append("/".join(parts))
    return [f for f in dict.fromkeys(files) if os.path.lexists(os.path.join(base, f))], [t for t in dict.fromkeys(trees) if os.path.lexists(os.path.join(base, t))]


# ------------------------------------------------------------ memory files and @imports
MEMORY = ("CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", "AGENTS.override.md")  # memory files whose `@path` imports are protected too
IMPORT = re.compile(r"(?:^|(?<=[\s*_\[(]))@((?:\\ |\S)+)")  # `@` at the line start, after whitespace, or after `*`, `_`, `[`, `(`; `\ ` is part of the word
IMPORT_DEPTH = 5  # Claude follows imports this many levels deep
TRAIL = ")]*_.,;:!?"


def import_tokens(text: str) -> list[str]:
    """The `@path` words of a memory file outside fenced blocks and inline code spans: split at unescaped whitespace, the
    `#fragment` cut off, `\\ ` unescaped, trailing `)`, `]`, `*`, `_`, `.`, `,` (and `;:!?`) removed. Over-matching is
    harmless: a word that names no file protects nothing."""
    out, fence = [], ""
    for line in text.splitlines():
        body = line.lstrip(" ")
        if fence:
            fence = "" if body[:3] == fence else fence
        elif len(line) - len(body) <= 3 and body[:3] in ("```", "~~~"):
            fence = body[:3]
        else:
            out += [m.partition("#")[0].rstrip(TRAIL).replace("\\ ", " ") for m in IMPORT.findall(re.sub(r"(`+).+?\1", "", line))]
    return [t for t in out if t]


def read_small(base: str, rel: str) -> str:
    """Text of the regular file `rel` below `base` when it (resolved) lies inside the repo and is small, else ""."""
    real = canon(os.path.join(base, rel))
    if within(base, real) in (None, "."):
        return ""
    try:
        fd = os.open(real, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    except OSError:
        return ""
    try:
        st = os.fstat(fd)
        return os.read(fd, CONFIG_MAX).decode("utf-8", "replace") if stat.S_ISREG(st.st_mode) and st.st_size <= CONFIG_MAX else ""
    except OSError:
        return ""
    finally:
        os.close(fd)


def rule_files(base: str, claude_dirs: list[str]) -> list[str]:
    """Repo-relative `*.md` files below `<dir>/rules` for each `.claude` directory in `claude_dirs` (symlinks are listed,
    never followed): Claude loads them as memory, so their `@path` imports count."""
    out: list[str] = []
    for d in claude_dirs:
        for root, _dirs, names in os.walk(os.path.join(base, d, "rules")):
            out += [os.path.relpath(os.path.join(root, n), base) for n in names if n.lower().endswith(".md")]
    return out


def memory_imports(base: str, memory: list[str]) -> list[str]:
    """Repo-relative in-repo files that the memory files `memory` import with `@path` (relative to the importing file;
    `~`, `$HOME` and `$CLAUDE_PROJECT_DIR` spellings are expanded by norm_word; a target outside the repo is ignored, one that
    reaches it through a symlink counts), followed breadth first up to IMPORT_DEPTH levels (a file reached by two routes counts at the shorter one). A word counts when it has a `/` or a
    `.` or names an existing file; a target that does not exist yet is protected too."""
    found: list[str] = []
    depth_of: dict[str, int] = {}  # canonical file -> the shallowest depth it was reached at
    queue = collections.deque((m, 1) for m in memory if os.path.lexists(os.path.join(base, m)))
    while queue:  # breadth first: a file is first reached by its shortest route, so its own imports get the most levels
        rel, depth = queue.popleft()
        key = str(canon(os.path.join(base, rel)))
        if depth_of.get(key, IMPORT_DEPTH + 1) <= depth:
            continue
        depth_of[key] = depth
        for tok in import_tokens(read_small(base, rel)):
            word = norm_word(tok, base)
            targets = rels(base, word if os.path.isabs(word) else os.path.join(base, os.path.dirname(rel), word))
            if not targets or not ("/" in tok or "." in tok or os.path.lexists(os.path.join(base, targets[0]))):
                continue
            found.extend(targets)
            if depth < IMPORT_DEPTH:
                queue.extend((t, depth + 1) for t in targets)
    return found
