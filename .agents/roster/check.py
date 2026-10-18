#!/usr/bin/env python3
"""Bootstrap of the roster checker (installed as .agents/roster/check.py). Stdlib only.

  python3 -I .agents/roster/check.py [--repo PATH]    exit 0 clean, 1 findings, 2 usage error

It prints one `FAIL <what>` line per finding or `agent roster check: OK`. It never executes repo code it has not
verified: every runtime file is read once (O_NOFOLLOW, regular file) and only bytes whose sha256 matches this
checkout's entry in <git-common-dir>/agent-roster/trust.json (or, with no entry, the hashes in facts.json) are run;
the checks themselves (check_core.py), the bridge and the policy code run from those bytes. The anchor sits outside
every bridged child's writable root, so a child cannot make a tampered file look genuine. An anchor entry that
disagrees is a finding. No entry at all (a fresh clone, CI) is a NOTE, not a finding: the facts.json hashes decide.
"""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True
__import__("os").environ["PYTHONDONTWRITEBYTECODE"] = "1"  # subprocesses leave no __pycache__ either

import argparse
import hashlib
import json
import os
import stat
import subprocess
import types
from pathlib import Path
from typing import Any

MAX_READ, RUNTIME_DIR = 1_048_576, ".agents/roster"
NOTES: list[str] = []  # informational lines for main() to print (never findings)
NO_ANCHOR_NOTE = ("trust anchor not found for this checkout; verified against facts.json "
                  "(run the agent-roster installer to anchor it)")
UPGRADE_NOTE = "runtime differs from the anchor but matches HEAD; run the installer to re-anchor"
ANCHORED = ("bridge.py", "bridge_cfg.py", "bridge_ctl.py", "bridge_policy.py", "bridge_io.py", "bridge_run.py", "bridge_tools.py", "bridge_wt.py", "bridge_read.py", "bridge_arch.py", "bridge_xfer.py", "check.py",
            "check_core.py", "check_policy.py", "facts.json")


def read_regular(path: Path) -> bytes | None:
    """Bytes of a regular, non-symlink file of at most 1 MB (opened with O_NOFOLLOW), else None."""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    except OSError:
        return None
    try:
        st = os.fstat(fd)
        return os.read(fd, MAX_READ + 1) if stat.S_ISREG(st.st_mode) and st.st_size <= MAX_READ else None
    finally:
        os.close(fd)


_GIT: dict[str, tuple[str, dict[str, str]]] = {}


def inside(p: str, deny: list[str]) -> bool:
    """True when `p` is, or lies inside, one of `deny`, by lexical and real path (twin of bridge_tools.inside_any)."""
    mine = {os.path.abspath(p), os.path.realpath(p)}
    return any(c == q or c.startswith(q.rstrip(os.sep) + os.sep) for f in deny for q in {os.path.abspath(f), os.path.realpath(f)} for c in mine)


UNRUNNABLE = "/nonexistent-roster"  # the directory of a program with no trusted executable (twin of bridge_tools.UNRUNNABLE)


def checkouts(root: str, exe: str, path: str) -> list[str]:
    """`root` and every other checkout of its repository: parsed from the `.git` files (gitdir and commondir normalized) and, with `exe`,
    listed by `git worktree list -z` (twin of bridge_tools.bootstrap_roots + worktree_roots)."""
    out = [root]
    try:
        dot = Path(root) / ".git"
        gitdir = Path(os.path.normpath(os.path.join(root, dot.read_text().partition("gitdir:")[2].strip()))) if dot.is_file() else dot
        common = Path(os.path.normpath(gitdir / (gitdir / "commondir").read_text().strip())) if (gitdir / "commondir").is_file() else gitdir
        out += ([str(common.parent)] if common.name == ".git" else []) + [str(Path(f.read_text().strip()).parent) for f in (common / "worktrees").glob("*/gitdir")]
    except (OSError, ValueError):
        pass
    if exe:
        env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")} | {"PATH": path, "GIT_CONFIG_NOSYSTEM": "1"}
        try:
            r = subprocess.run([exe, "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-C", root, "worktree", "list", "--porcelain", "-z"],
                               env=env, capture_output=True, stdin=subprocess.DEVNULL)
            out += [os.fsdecode(x[9:]) for x in r.stdout.split(b"\0") if x.startswith(b"worktree /")] if r.returncode == 0 else []
        except OSError:
            pass
    return list(dict.fromkeys(out))


def trusted_git(root: Path) -> tuple[str, dict[str, str]]:
    """(absolute git, environment) for the checker's own git calls. This file runs before anything else is verified, so it carries
    the bootstrap twin of bridge_tools.resolve: PATH entries that are relative, empty or inside ANY checkout of the repo (main work
    tree and linked ones) or their ignored top-level directories are dropped, a git whose REAL path is inside one of them is skipped,
    and the environment has that PATH and no GIT_* variable. A `git` or `claude` a child planted in the repo (even behind a symlink)
    is never run. No git found: `/nonexistent-roster/git` (never the bare name)."""
    key = os.path.realpath(root)
    if key not in _GIT:
        raw, deny = os.environ.get("PATH", ""), checkouts(str(root), "", "") + [key]

        def pick() -> tuple[str, str]:
            path = os.pathsep.join(x for x in dict.fromkeys(raw.split(os.pathsep)) if x and os.path.isabs(x) and not inside(x, deny)) or "/usr/bin:/bin"
            return path, next((c for d in path.split(os.pathsep) if os.path.isfile(c := os.path.join(d, "git")) and os.access(c, os.X_OK) and not inside(c, deny)), "")
        path, exe = pick()
        env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")} | {"PATH": path, "GIT_CONFIG_NOSYSTEM": "1"}
        if exe:
            deny += checkouts(key, exe, path)
            for top in dict.fromkeys(deny):
                try:
                    r = subprocess.run([exe, "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-C", top, "ls-files", "-z", "--others", "--ignored",
                                        "--exclude-standard", "--directory"], env=env, capture_output=True, stdin=subprocess.DEVNULL)
                    deny += [os.path.join(top, n.rstrip("/")) for n in os.fsdecode(r.stdout).split("\0") if n and "/" not in n.rstrip("/")] if r.returncode == 0 else []
                except OSError:
                    pass
            path, exe = pick()
        _GIT[key] = (exe or UNRUNNABLE + "/git", {k: v for k, v in env.items() if k != "GIT_CONFIG_NOSYSTEM"} | {"PATH": path})
    return _GIT[key]


def run_git(root: Path, args: list[str], **kw: Any) -> "subprocess.CompletedProcess[Any]":
    exe, env = trusted_git(root)
    return subprocess.run([exe, "-C", str(root), *args], env=env, **kw)


def git_common_dir(root: Path) -> str:
    try:
        r = run_git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"], capture_output=True, text=True)
    except OSError:
        return ""
    return os.path.realpath(r.stdout.strip()) if r.returncode == 0 and r.stdout.strip() else ""


def committed_clean(root: Path, rel: str, data: bytes) -> bool:
    """True when `data` equals the blob at HEAD:<rel> (git cat-file --batch) and the work-tree file is clean against
    HEAD. Children cannot write .git, so committed bytes are not child-tampered (a legitimate upgrade via git)."""
    try:
        r = run_git(root, ["cat-file", "--batch"], input=f"HEAD:{rel}\n".encode(), capture_output=True)
        head, _, rest = r.stdout.partition(b"\n")
        _, kind, size = head.split(b" ")
        if kind != b"blob" or len(rest) < int(size) or rest[:int(size)] != data:
            return False
        return run_git(root, ["diff", "--quiet", "HEAD", "--", rel], capture_output=True).returncode == 0
    except (OSError, ValueError):
        return False


def anchor_state(root: Path, facts_hashes: dict[str, str]) -> tuple[list[str], dict[str, bytes], str]:
    """(findings, name -> verified bytes, git common dir). A runtime file is verified when its sha256 equals the
    anchor entry for `root`; with no entry the facts.json hashes decide what may run and a NOTE is recorded (not a
    finding). A file that differs from an existing anchor entry is a finding and is never executed, unless its bytes
    equal the clean committed blob at HEAD (an upgrade pulled through git): then it runs, with a NOTE."""
    common, entry = git_common_dir(root), None
    raw = read_regular(Path(common) / "agent-roster" / "trust.json") if common else None
    try:
        entry = json.loads(raw.decode("utf-8")).get(str(root)) if raw else None
    except (ValueError, AttributeError):
        entry = None
    anchored = isinstance(entry, dict)
    errs: list[str] = []
    if not anchored and NO_ANCHOR_NOTE not in NOTES:
        NOTES.append(NO_ANCHOR_NOTE)
    want = entry if anchored else facts_hashes
    good: dict[str, bytes] = {}
    for n in ANCHORED:
        data = read_regular(root / RUNTIME_DIR / n)
        if data is not None and hashlib.sha256(data).hexdigest() == want.get(n):
            good[n] = data
        elif anchored and data is not None and committed_clean(root, f"{RUNTIME_DIR}/{n}", data):
            good[n] = data
            if UPGRADE_NOTE not in NOTES:
                NOTES.append(UPGRADE_NOTE)
        elif anchored:
            errs.append(f"{RUNTIME_DIR}/{n} is missing, not a regular file, or differs from the trust anchor "
                        "(re-run the agent-roster installer)")
    return errs, good, common


def run(root: Path) -> list[str]:
    """Findings for the repo at `root`, running check_core.py only from verified bytes."""
    root = root.resolve()
    try:
        raw = read_regular(root / RUNTIME_DIR / "facts.json")
        hashes = json.loads(raw.decode("utf-8")).get("runtimeHashes", {}) if raw else {}
    except (ValueError, AttributeError):
        hashes = {}
    anchor = anchor_state(root, hashes if isinstance(hashes, dict) else {})
    core_bytes = anchor[1].get("check_core.py")
    if core_bytes is None:
        return [f"{RUNTIME_DIR}/facts.json or {RUNTIME_DIR}/check_core.py is missing or does not match the trust anchor; "
                "nothing was executed (run the agent-roster installer)", *anchor[0]]
    core = types.ModuleType("roster_check_core")
    core.__file__ = str(root / RUNTIME_DIR / "check_core.py")
    exec(compile(core_bytes, core.__file__, "exec"), core.__dict__)  # noqa: S102 - bytes verified above
    return list(core.run_check(root, None, anchor))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Check the agent roster installed in a repo.")
    ap.add_argument("--repo", default=None, help="repo root; default: the repo this script is installed in, else cwd")
    args = ap.parse_args(argv)
    here = Path(__file__).resolve()
    root = Path(args.repo).expanduser() if args.repo else here.parents[2] if here.parent.as_posix().endswith(RUNTIME_DIR) else Path.cwd()
    if not root.is_dir():
        print(f"error: {root} is not a directory", file=sys.stderr)
        return 2
    del NOTES[:]
    if trusted_git(root.resolve())[0].startswith(UNRUNNABLE + "/"):
        print("error: cannot find a trusted git (no git on a PATH entry outside the checkouts of this repository)", file=sys.stderr)
        return 2
    errs = run(root)
    for note in NOTES:
        print(f"NOTE {note}")
    print("\n".join(f"FAIL {e}" for e in errs) if errs else "agent roster check: OK")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
