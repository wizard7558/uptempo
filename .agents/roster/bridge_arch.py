"""Durable archive of a Codex child's change set (installed as .agents/roster/bridge_arch.py). Stdlib only.

Before any apply decision the supervisor saves everything the child changed at `<git-common-dir>/agent-roster/changes/
<run-id>/` (dirs 0700, outside every child's writable root): `files/<path>` (the child's bytes of every changed or added
path, permission bits kept), `bases/<path>` (the bytes the child started from, for every path that existed; they do not
depend on the prunable run directory or on git objects), `deleted.txt` (paths the child removed), `bases.json` (the
seed object id of every path; "" when it did not exist), `conflicts/` (the versions of every conflicting path, added
when the apply conflicts) and, written LAST and atomically, `manifest.json` (`complete: true`, run id, target, the
worktree, sha256/size/mode per file and per base and, once the run is settled, its `outcome`). A conflict, an error, a
refusal or a stopped child leaves the archive in place and the message names it. Only an archive whose run ended `applied` is
pruned (after KEEP_DAYS); a refusal for size records an incomplete manifest (`complete: false`, the worktree path) because
nothing was read. The installer keeps a stale private worktree unless this manifest says complete. bridge.py executes this
file's bytes only after they match the trust anchor."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

KEEP_DAYS = 7  # successful-run archives older than this are pruned; every other outcome is kept
MANIFEST = "manifest.json"
FILE_FLAGS = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC


def dir_of(run: Path) -> Path:
    """The archive directory of the run directory `run` (`<common>/agent-roster/runs/<id>`)."""
    return run.parents[1] / "changes" / run.name


def _fsync_dir(d: Path) -> None:
    fd = os.open(d, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _private(d: Path) -> None:
    """`d` as a real 0700 directory owned by you (made when missing); OSError for a symlink or foreign owner."""
    if not os.path.lexists(d):
        os.mkdir(d, 0o700)
    st = os.lstat(d)
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.getuid():
        raise OSError(f"{d} must be a real directory owned by you")
    os.chmod(d, 0o700)


def _write(path: Path, data: bytes, mode: int = 0o600) -> None:
    """New file `path` (never through a symlink), bytes fsynced; `mode` is kept, plus owner read/write."""
    fd = os.open(path, FILE_FLAGS, 0o600)
    try:
        view = memoryview(data)
        while view:
            view = view[os.write(fd, view):]
        os.fchmod(fd, (mode & 0o7777) | 0o600)
        os.fsync(fd)
    finally:
        os.close(fd)


def _put_manifest(d: Path, doc: dict[str, Any]) -> None:
    """manifest.json via temp file + rename, fsynced (the file and its directory)."""
    tmp = d / f"{MANIFEST}.{os.getpid()}.tmp"
    if os.path.lexists(tmp):
        os.unlink(tmp)
    _write(tmp, (json.dumps(doc, sort_keys=True, indent=1) + "\n").encode("utf-8"))
    os.replace(tmp, d / MANIFEST)
    _fsync_dir(d)


def read_manifest(d: Path) -> dict[str, Any]:
    """The manifest of archive directory `d` ({} when absent, unreadable or not a JSON object)."""
    try:
        fd = os.open(d / MANIFEST, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    except OSError:
        return {}
    try:
        doc = json.loads(os.read(fd, 64_000_000).decode("utf-8"))
    except (OSError, ValueError):
        return {}
    finally:
        os.close(fd)
    return doc if isinstance(doc, dict) else {}


def _head(run: Path, wt: Any) -> dict[str, Any]:
    return {"schema": 1, "run_id": run.name, "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "target": str(wt.target), "worktree": str(wt.path), "base_tree": wt.base_tree, "seed_commit": wt.seed_commit}


def save(run: Path, wt: Any, changes: list[Any]) -> Path:
    """Archive the whole collected change set of `run` (Change objects: path, base, child, base_oid; a child state of
    kind none is a deletion; a state is (kind, bytes, executable, mode)). Returns the archive directory; the manifest
    (`complete: true`, outcome `pending`) is the last thing written. OSError when it cannot be made durable."""
    d = dir_of(run)
    _private(d.parent)
    _private(d)
    files: dict[str, Any] = {}
    bases: dict[str, Any] = {}
    for sub, rows, doc in (("files", [(ch.path, ch.child) for ch in changes], files), ("bases", [(ch.path, ch.base) for ch in changes], bases)):
        _private(d / sub)
        for path, state in rows:
            if state[0] == "file":
                doc[path] = put(d / sub, path, state[1], state[3])
    deleted = sorted(ch.path for ch in changes if ch.child[0] == "none")
    _write(d / "deleted.txt", "".join(f"{p}\n" for p in deleted).encode("utf-8", "surrogateescape"))
    _write(d / "bases.json", (json.dumps({ch.path: ch.base_oid for ch in changes}, sort_keys=True, indent=1) + "\n").encode("utf-8", "surrogateescape"))
    _fsync_dir(d)
    _put_manifest(d, {**_head(run, wt), "complete": True, "outcome": "pending", "files": files, "bases": bases, "deleted": deleted})
    return d


def put(root: Path, rel: str, data: bytes, mode: int) -> dict[str, Any]:
    """File `rel` below `root` (real 0700 directories on the way, never through a symlink); its manifest entry."""
    cur = root
    for part in rel.split("/")[:-1]:
        cur = cur / part
        _private(cur)
    _write(root / rel, data, mode)
    return {"sha256": hashlib.sha256(data).hexdigest(), "size": len(data), "mode": f"{mode & 0o7777:04o}"}


def add_conflicts(d: Path, src: Path) -> list[str]:
    """Copy the conflict versions saved under `src` (<run>/conflicts) into `<d>/conflicts` and list them in the manifest
    (`conflicts`: relative names). Returns the names; OSError when a copy fails."""
    names: list[str] = []
    _private(d / "conflicts")
    for dp, dirs, files in os.walk(src):
        for f in sorted(files):
            rel = (Path(dp) / f).relative_to(src).as_posix()
            fd = os.open(Path(dp) / f, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
            try:
                chunks = []
                while chunk := os.read(fd, 1 << 20):
                    chunks.append(chunk)
            finally:
                os.close(fd)
            put(d / "conflicts", rel, b"".join(chunks), 0o600)
            names.append(rel)
    doc = read_manifest(d)
    if doc.get("complete") is True:
        doc["conflicts"] = sorted(names)
        _put_manifest(d, doc)
    return sorted(names)


def incomplete(run: Path, wt: Any, outcome: str, why: str) -> Path:
    """Record that the change set could not be archived (`outcome` refused or error): `complete: false` and where the
    work is (the worktree), unless a complete manifest is already there. Returns the archive directory."""
    d = dir_of(run)
    _private(d.parent)
    _private(d)
    if read_manifest(d).get("complete") is not True:
        _put_manifest(d, {**_head(run, wt), "complete": False, "outcome": outcome, "reason": why[:300]})
    return d


def settle(d: Path, outcome: str) -> None:
    """Record how the run ended (applied | conflict | error | stopped) in a complete manifest."""
    doc = read_manifest(d)
    if doc.get("complete") is True:
        doc["outcome"] = outcome
        _put_manifest(d, doc)


def prune(changes: Path, days: float = KEEP_DAYS, now: float | None = None) -> list[str]:
    """Remove the archives (under `changes`, a real directory) of runs that ended `applied` more than `days` days ago;
    never an archive of a conflict, error, refusal or stopped run, nor one without a complete manifest. Returns the
    removed run ids."""
    gone: list[str] = []
    try:
        if not stat.S_ISDIR(os.lstat(changes).st_mode):
            return gone
        names = sorted(os.listdir(changes))
    except OSError:
        return gone
    cutoff = (time.time() if now is None else now) - days * 86400
    for n in names:
        d = changes / n
        try:
            st = os.lstat(d)
            doc = read_manifest(d) if stat.S_ISDIR(st.st_mode) else {}
            if doc.get("complete") is True and doc.get("outcome") == "applied" and os.lstat(d / MANIFEST).st_mtime < cutoff:
                shutil.rmtree(d)
                gone.append(n)
        except OSError:
            continue
    return gone
