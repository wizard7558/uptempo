"""I/O half of bridge.py (installed as .agents/roster/bridge_io.py): request-file parsing, `git worktree list -z`
parsing, the writable probe, run-state files and the writer lock. Policy (child argv, sandbox settings, MCP lookup,
protected paths) lives in bridge_policy.py, the child runner in bridge_run.py, the Codex private worktree in
bridge_wt.py and bridge_apply.py. The install lock and the private-directory helper that run BEFORE any helper is
verified live in bridge.py itself. bridge.py executes this file's bytes only after they match the trust anchor.
Stdlib only."""
from __future__ import annotations

import errno
import fcntl
import hashlib
import os
import json
import re
import shutil
import stat
import time
import tomllib
from pathlib import Path
from typing import Callable

# ----------------------------------------------------------- request / git
REQUEST_MAX = 1_000_000


def parse_worktrees(raw: str) -> list[str]:
    """Paths from `git worktree list --porcelain -z`, main work tree first."""
    return [f[len("worktree "):] for f in raw.split("\0") if f.startswith("worktree ")]


def realpaths(paths: list[str]) -> list[str]:
    return [os.path.realpath(p) for p in paths]


def validate_dir(arg: str | None, role: dict, root: Path, worktrees: str) -> Path:
    """The work dir named by `dir:` (`arg`, relative to `root`; None: `root`): it must be `root` or one of the work trees in
    `worktrees` (`git worktree list --porcelain -z`); a `worktree` role needs an explicit `dir:` naming a linked one (not the
    main work tree, not the checkout the bridge runs from). ValueError with the reason otherwise."""
    if arg is not None and (not arg or any(ord(c) < 32 for c in arg)):
        raise ValueError("dir: is empty or has control characters")
    wt = role["writes"] == "worktree"
    if wt and arg is None:
        raise ValueError(f"role {role['name']!r} edits files and needs a `dir:` line naming a linked git worktree "
                         "(git worktree add), not the checkout the bridge runs from")
    real = Path(os.path.realpath(os.path.join(root, arg) if arg else root))
    if not real.is_dir():
        raise ValueError(f"dir {arg!r} is not a directory")
    listed = realpaths(parse_worktrees(worktrees))
    if str(real) not in listed:
        raise ValueError(f"dir {real} is not this repo or one of its worktrees (git worktree list)")
    if wt and (str(real) == listed[0] or real == root):
        raise ValueError(f"role {role['name']!r} edits files and needs a linked git worktree (git worktree add) "
                         f"given with a `dir:` line, not the main work tree or this checkout ({real})")
    return real


def instructions(role: dict, root: Path, read_text: Callable[[Path], str], mark: str) -> str:
    """Text after `mark` (`## Role instructions`) in the calling runtime's own agent file of `role` below `root`
    (`.claude/agents/<name>.md`, or `developer_instructions` of `.codex/agents/<name>.toml`). ValueError when it is missing."""
    if role["caller"] == "claude":
        text = read_text(root / ".claude" / "agents" / f"{role['name']}.md")
    else:
        try:
            text = str(tomllib.loads(read_text(root / ".codex" / "agents" / f"{role['name']}.toml")).get("developer_instructions", ""))
        except tomllib.TOMLDecodeError as e:
            raise ValueError(f"invalid TOML in the {role['name']} agent file: {e}")
    i = text.find(mark)
    if i < 0:
        raise ValueError(f"the {role['caller']} agent file for {role['name']!r} has no '## Role instructions' section")
    return text[i + len(mark):].strip()


def probe_writable(d: Path) -> bool:
    """False when creating a file in the directory (created 0700 if absent) is denied by a sandbox (EPERM/EACCES/
    EROFS). A symlink or any other problem is not a sandbox signal; the callers refuse those themselves."""
    try:
        if os.path.realpath(d) != str(d):
            return True
        os.makedirs(d, mode=0o700, exist_ok=True)
        fd = os.open(d / f".probe-{os.getpid()}", os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    except OSError as e:
        return e.errno not in (errno.EPERM, errno.EACCES, errno.EROFS)
    os.close(fd)
    os.unlink(d / f".probe-{os.getpid()}")
    return True


def parse_request_text(text: str) -> tuple[str | None, str]:
    """(dir or None, task) from a request: an optional `dir: <path>` line, a line `---`, then the task verbatim."""
    if not text.startswith("dir:"):
        return None, text
    first, _, rest = text.partition("\n")
    marker, _, body = rest.partition("\n")
    if marker.rstrip() != "---":
        raise ValueError("a `dir:` first line must be followed by a line containing only ---")
    return first[4:].strip(), body


def read_request(p: Path) -> tuple[str | None, str]:
    """(dir or None, task) of a request file opened with O_NOFOLLOW: regular, at most 1 MB, owned by this user,
    UTF-8. ValueError carries the reason."""
    try:
        fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    except OSError as e:
        raise ValueError(f"task file: {e}")
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_size > REQUEST_MAX or st.st_uid != os.getuid():
            raise ValueError(f"task file must be a regular file of at most {REQUEST_MAX} bytes owned by the current user "
                             "(it is larger, not regular, or not yours)")
        data = os.read(fd, REQUEST_MAX + 1)
    finally:
        os.close(fd)
    try:
        return parse_request_text(data.decode("utf-8"))
    except UnicodeDecodeError:
        raise ValueError("task file is not valid UTF-8")


REQUEST_FORM = ".agents/roster/tmp/task-<role>-<16 hex>.md"  # <role>: the role name; <16 hex>: 16 lowercase hex digits, e.g. task-feature-0123456789abcdef.md


def request(arg: str, tmp: Path, pattern: re.Pattern[str]) -> tuple[Path, str | None, str]:
    """(path, dir or None, task) of the request file `arg`, which must be directly inside `tmp` and match `pattern`. ValueError
    names the expected form (REQUEST_FORM) and says whether the file was deleted: an invalid `task-*` file inside `tmp` is deleted
    (a symlink is unlinked, never followed); any other name, and anything outside `tmp`, is never touched."""
    p = Path(os.path.abspath(arg))
    inside = os.path.realpath(p.parent) == str(tmp)
    try:
        if not pattern.match(p.name) or not inside:
            raise ValueError(f"request file {p.name!r} is not {REQUEST_FORM} (inside .agents/roster/tmp, 16 hex digits)")
        return (p, *read_request(p))
    except ValueError as e:
        gone = False
        if inside and p.name.startswith("task-") and os.path.lexists(p) and (os.path.islink(p) or not os.path.isdir(p)):
            try:
                os.unlink(p)
                gone = True
            except OSError:
                pass
        raise ValueError(f"{e}; expected {REQUEST_FORM}; the {'invalid request file was deleted' if gone else 'file was not deleted'}")


# ------------------------------------------------------- run-state files
def atomic_json(path: Path, data: dict) -> None:
    tmp = path.with_name(path.name + f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def writer_lock(locks: Path, workdir: Path) -> int:
    """Open and exclusively flock `locks/<sha256 of workdir>.lock`, returning the fd (not inheritable). BlockingIOError
    when another writer holds it, OSError when the file cannot be opened."""
    fd = os.open(locks / (hashlib.sha256(str(workdir).encode()).hexdigest() + ".lock"),
                 os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(fd)
        raise BlockingIOError(errno.EWOULDBLOCK, "locked")
    os.set_inheritable(fd, False)
    return fd


def drop_run(d: Path) -> None:
    """Remove a run dir (links unlinked, never followed) and the Codex temp dir it recorded, if still there."""
    try:
        tmp = (d / "codex-tmp").read_text(encoding="utf-8").strip()
        st = os.lstat(tmp)
        if os.path.basename(tmp).startswith("roster-codex-") and stat.S_ISDIR(st.st_mode) and st.st_uid == os.getuid():
            shutil.rmtree(tmp, ignore_errors=True)
    except OSError:
        pass
    shutil.rmtree(d, ignore_errors=True)


def prune(runs: Path, tmp: Path, run_id: re.Pattern[str], run_days: int, task_days: int) -> None:
    """Delete run dirs older than `run_days` and task-* request files older than `task_days`; links are unlinked,
    never followed."""
    now = time.time()
    for base, wanted, days in ((runs, run_id.match, run_days), (tmp, lambda n: n.startswith("task-"), task_days)):
        for d in base.iterdir():
            try:
                st = d.lstat()
                if wanted(d.name) and st.st_mtime < now - days * 86400:
                    drop_run(d) if stat.S_ISDIR(st.st_mode) else os.unlink(d)
            except OSError:
                pass
