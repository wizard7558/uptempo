"""Trusted program resolution (installed as .agents/roster/bridge_tools.py; used by bridge_wt.py, which the bridge runs, and by
the installer and checker of the skill). Stdlib only.

A bridged child can write files in the repo, in the directories it links into its private worktree and in its temp dirs. A
program the supervisor (or the installer, or the checker) runs by bare name is found through PATH, so any of those directories
on PATH would let the child plant `git` or `ps` and have it run outside the sandbox. `resolve` therefore looks for each
program only on PATH entries that are absolute and not inside a forbidden root (the repo, its work dirs, the run and temp
dirs and the repo's ignored top-level entries, a symlink there counting by where it points), and `find_tool` also rejects a
CANDIDATE whose real path (every symlink followed) lies inside a forbidden root: `/trusted/bin/ps -> <repo>/.venv/bin/ps` is
skipped and the search continues. `PINNED` holds the result of the last `resolve` made by bridge_wt.pin_tools; `clean_env` is
the environment of every subprocess (no GIT_* variable, the trusted PATH).

INVARIANT (v16): every program the supervisor, check.py or the installer starts, and every program the child CLI's unsandboxed
host process can start by name, is either an absolute path from this resolver or unrunnable. There are no bare names: a program
that is not pinned is `/nonexistent-roster/<name>` (see `tool`, `UNRUNNABLE`), and no process environment we build has a PATH
with a directory a child can write (`clean_env`, the child environment of bridge_policy.child_env, `repo_tools`). Every
checkout of the repository (the main work tree and every linked one) is a forbidden root. selftest_v18 enumerates every
subprocess call site of the skill and fails on a bare program name."""
from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any

UNRUNNABLE = "/nonexistent-roster"  # directory of the path given to a program that has no trusted executable: starting it fails (ENOENT)
PROGRAMS = ("git", "ps", "claude", "codex")  # the programs the supervisor itself starts (resolve finds each once)
PINNED: dict[str, Any] = {"path": None, "tools": {}}  # the trusted PATH and {program: absolute path} (set by bridge_wt.pin_tools)
LS_IGNORED = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "diff.external=", "-c", "core.quotePath=false"]


def inside_any(p: str, forbidden: list[str]) -> bool:
    """True when `p` is, or lies inside, one of `forbidden`, judged by both the lexical and the real path of each."""
    mine = {os.path.abspath(p), os.path.realpath(p)}
    return any(c == q or c.startswith(q.rstrip(os.sep) + os.sep) for f in forbidden for q in {os.path.abspath(f), os.path.realpath(f)} for c in mine)


def clean_path(path: str, forbidden: list[str]) -> str:
    """`path` without the empty and relative entries and the entries inside `forbidden` (see inside_any)."""
    keep = [x for x in dict.fromkeys(path.split(os.pathsep)) if x and os.path.isabs(x) and not inside_any(x, forbidden)]
    return os.pathsep.join(keep) or "/usr/bin:/bin"


def find_tool(name: str, path: str, forbidden: list[str] | tuple[str, ...] = ()) -> str:
    """The first executable regular file `name` on `path` (absolute directories only) whose real path, every symlink followed,
    is not inside `forbidden`; a candidate that resolves into a forbidden root is skipped and the search goes on. "" if none."""
    deny = [str(x) for x in forbidden]
    for d in path.split(os.pathsep):
        cand = os.path.join(d, name)
        if os.path.isabs(d) and os.path.isfile(cand) and os.access(cand, os.X_OK) and not inside_any(cand, deny):
            return cand
    return ""


def clean_env() -> dict[str, str]:
    """The environment of every supervisor subprocess: no GIT_* variable, PATH = the pinned trusted PATH or, before that, the
    absolute entries of the caller's. git runs `git-*` helpers and filter programs through PATH, so it matters."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env["PATH"] = PINNED["path"] if PINNED["path"] is not None else os.pathsep.join(x for x in env.get("PATH", "").split(os.pathsep) if os.path.isabs(x)) or "/usr/bin:/bin"
    return env


def tool(name: str) -> str:
    """The absolute path resolved for `name`; `/nonexistent-roster/<name>` (never the bare name, which PATH would resolve) when
    `name` is not pinned or none was found."""
    return PINNED["tools"].get(name) or unrunnable(name)


def unrunnable(name: str) -> str:
    """An absolute path that cannot be started: what stands for a program with no trusted executable."""
    return f"{UNRUNNABLE}/{name}"


def bootstrap_roots(root: Path | str) -> list[str]:
    """`root` and every other checkout of its repository (the main work tree, every linked one), read from the `.git` files only
    (no program runs): the gitfile and `commondir` are normalized (`os.path.normpath`), the linked trees are the parents of
    `<common>/worktrees/*/gitdir`."""
    roots = [str(root)]
    try:
        dot = Path(root) / ".git"
        gitdir = Path(os.path.normpath(os.path.join(root, dot.read_text().partition("gitdir:")[2].strip()))) if dot.is_file() else dot
        cdir = gitdir / "commondir"
        common = Path(os.path.normpath(gitdir / cdir.read_text().strip())) if cdir.is_file() else gitdir
        roots += [str(common.parent)] if common.name == ".git" else []
        roots += [str(Path(f.read_text().strip()).parent) for f in (common / "worktrees").glob("*/gitdir")]
    except (OSError, ValueError):
        pass
    return list(dict.fromkeys(roots))


def worktree_roots(git_exe: str, path: str, target: Path | str) -> list[str]:
    """Every work tree `git worktree list --porcelain -z` names for the repository at `target`; [] when git cannot answer."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")} | {"PATH": path, "GIT_CONFIG_NOSYSTEM": "1"}
    try:
        r = subprocess.run([git_exe, *LS_IGNORED, "-C", str(target), "worktree", "list", "--porcelain", "-z"], env=env, capture_output=True, stdin=subprocess.DEVNULL)
    except OSError:
        return []
    return [os.fsdecode(x[9:]) for x in r.stdout.split(b"\0") if x.startswith(b"worktree /")] if r.returncode == 0 else []


def ignored_tops(git_exe: str, path: str, target: Path | str) -> list[str]:
    """Absolute paths of the ignored top-level entries of the repository at `target` (`.venv`, `node_modules`, ...), asked of
    `git_exe` with hooks and fsmonitor off; [] when git cannot answer."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")} | {"PATH": path, "GIT_CONFIG_NOSYSTEM": "1"}
    try:
        r = subprocess.run([git_exe, *LS_IGNORED, "-C", str(target), "ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"],
                           env=env, capture_output=True, stdin=subprocess.DEVNULL)
    except OSError:
        return []
    names = [os.fsdecode(x).rstrip("/") for x in r.stdout.split(b"\0") if x] if r.returncode == 0 else []
    return [str(Path(target) / n) for n in names if n and "/" not in n]


def resolve(names: tuple[str, ...], targets: list[Path | str], forbidden: list[Path | str], raw: str | None = None) -> tuple[str, dict[str, str]]:
    """(trusted PATH, {program: absolute path}) for `names`: PATH entries that are relative, empty or inside `forbidden` (and inside
    the ignored top-level entries of each work tree of each of `targets`) are dropped, and a program whose real path is inside one of them is skipped.
    LookupError when there is no git. Nothing the child wrote can then be run as git, ps, claude or codex."""
    raw = os.environ.get("PATH", "") if raw is None else raw
    deny = [str(x) for x in forbidden]
    tops = [r for t in targets for r in bootstrap_roots(t)]  # every checkout of the repository is forbidden, not only the target
    deny += tops
    exe = find_tool("git", clean_path(raw, deny), deny)
    for t in targets if exe else []:
        tops += worktree_roots(exe, clean_path(raw, deny), t)
    deny += tops
    for t in dict.fromkeys(tops) if exe else []:
        deny += ignored_tops(exe, clean_path(raw, deny), t)
    path = clean_path(raw, deny)
    found = {n: p for n in names if (p := find_tool(n, path, deny))}
    if "git" not in found:
        raise LookupError("no git executable on a trusted PATH entry (entries inside the repo, work dir or ignored directories are not trusted)")
    return path, found


def repo_tools(root: Path | str, names: tuple[str, ...] = ("git", "claude", "codex")) -> tuple[dict[str, str], dict[str, str]]:
    """({program: absolute path}, environment) for the installer and the checker of the repo at `root`: forbidden roots are the
    repo and its ignored top-level directories (and the real paths of both). The environment is the caller's without GIT_*
    variables and with the trusted PATH. A program that is not found is not in the map (callers treat it as absent). When there
    is no git on a trusted entry the map is empty and the environment keeps only the absolute entries of PATH."""
    try:
        path, found = resolve(names, [root], [root])
    except LookupError:
        path, found = clean_path(os.environ.get("PATH", ""), [str(root)]), {}
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env["PATH"] = path
    return found, env
