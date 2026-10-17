"""Reading half of the Codex change transfer (installed as .agents/roster/bridge_read.py; used by bridge_xfer.py). Stdlib only.

No-follow file access (every directory on the way is opened with O_NOFOLLOW), the seed tree's metadata (`ls-tree -r -l`)
and the BASE versions of changed paths. A base is what the child started from, in the form the target holds on disk: a
path whose exact bytes were copied into the worktree at seed time (`wt.seeded`; hashed with `--no-filters`) is read as
stored; any other path is read in WORKING-TREE form (`cat-file --batch --filters` of the seed tree's blob, so eol, LFS
and filter attributes match the bytes on disk; attributes come from the seed tree, never from `.gitattributes` files
the child may have rewritten). The filtered read runs with `--work-tree <target>` and `cwd=<target>`, never in the private
worktree, so a filter command such as `./tools/smudge.sh` is the user's own script, not one the child rewrote. Every read goes through a bounded stream: a filter driver may expand a blob without
limit, so the actual bytes are counted per object and in total and the read is abandoned (CapError) at the first
excess. Git holds one filtered object in memory before it prints it, so a watchdog also kills a git process whose
resident size passes a multiple of the cap (an endless filter never reaches the stream). bridge.py executes this file's bytes only after they match the trust anchor (`load`, injected by bridge.module)."""
from __future__ import annotations

import os
import secrets
import stat
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

W = load("bridge_wt")  # type: ignore[name-defined]  # noqa: F821 - injected by bridge.module
git, SeedError, CapError = W.git, W.SeedError, W.CapError
DIRFLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_DIRECTORY | os.O_CLOEXEC
State = tuple[str, bytes, bool, int]  # (kind: file | none | link | bad, bytes, executable, st_mode & 0o7777)
NONE: State = ("none", b"", False, 0)
CHUNK = 1 << 20


# -------------------------------------------------- no-follow file access
def open_parent(root: Path, rel: str, create: bool = False) -> tuple[int, str] | str:
    """(fd of the directory that holds `rel`, its name) with every directory below `root` opened O_NOFOLLOW (made when
    `create`); "none" when one is missing, "bad" when one is a symlink or not a directory. The caller closes the fd."""
    *dirs, name = rel.split("/")
    fd = os.open(root, DIRFLAGS)
    for d in dirs:
        try:
            try:
                nfd = os.open(d, DIRFLAGS, dir_fd=fd)
            except FileNotFoundError:
                if not create:
                    os.close(fd)
                    return "none"
                os.mkdir(d, 0o755, dir_fd=fd)
                nfd = os.open(d, DIRFLAGS, dir_fd=fd)
        except OSError:
            os.close(fd)
            return "bad"
        os.close(fd)
        fd = nfd
    return fd, name


def lstat_of(root: Path, rel: str) -> tuple[str, int]:
    """(kind, size) of the entry at `rel` below `root`, nothing followed: file | link | none | bad."""
    r = open_parent(root, rel)
    if isinstance(r, str):
        return r, 0
    fd, name = r
    try:
        st = os.stat(name, dir_fd=fd, follow_symlinks=False)
    except FileNotFoundError:
        return "none", 0
    finally:
        os.close(fd)
    return ("link" if stat.S_ISLNK(st.st_mode) else "file" if stat.S_ISREG(st.st_mode) else "bad"), st.st_size


def lread(root: Path, rel: str) -> State:
    """The entry at `rel` below `root` without following any symlink: its bytes, executable bit and permission bits for
    a regular file."""
    r = open_parent(root, rel)
    if isinstance(r, str):
        return (r, b"", False, 0)
    fd, name = r
    try:
        try:
            st = os.stat(name, dir_fd=fd, follow_symlinks=False)
        except FileNotFoundError:
            return NONE
        if stat.S_ISLNK(st.st_mode):
            return ("link", os.fsencode(os.readlink(name, dir_fd=fd)), False, 0)
        if not stat.S_ISREG(st.st_mode):
            return ("bad", b"", False, 0)
        ffd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=fd)
        try:
            st, chunks = os.fstat(ffd), []
            while chunk := os.read(ffd, CHUNK):
                chunks.append(chunk)
        finally:
            os.close(ffd)
        return ("file", b"".join(chunks), bool(st.st_mode & 0o111), st.st_mode & 0o7777)
    except OSError:
        return ("bad", b"", False, 0)
    finally:
        os.close(fd)


# ------------------------------------------------------------- seed state
_ATTR: bool | None = None
EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"


def has_attr_source() -> bool:
    """True when the installed git accepts the global `--attr-source` option (2.40+). The option itself is probed once
    (`git --attr-source=<empty tree> --version` succeeds, an older git exits 129 "unknown option"), never inferred from a
    version number; the answer is cached for the process."""
    global _ATTR
    if _ATTR is None:
        _ATTR = git([f"--attr-source={EMPTY_TREE}", "--version"]).returncode == 0
    return _ATTR


_Z: bool | None = None


def has_z(wt: Any) -> bool:
    """True when the installed git accepts `cat-file -z` (NUL-delimited batch input), probed once like --attr-source. Line-based
    batch input strips a trailing CR from a path, which would change which attributes apply to a file named `notes\\r`."""
    global _Z
    if _Z is None:
        _Z = git(["--git-dir", wt.gitdir, "cat-file", "-z", "--batch-check"], data=b"").returncode == 0
    return _Z


def attr_source(wt: Any) -> list[str]:
    """`--attr-source=<seed tree>` (git 2.40+): attributes come from the seed state, never from `.gitattributes` files the
    child may have rewritten in the private worktree."""
    return ["--attr-source", wt.base_tree] if wt.base_tree and has_attr_source() else []


def seed_meta(wt: Any, paths: list[str]) -> dict[str, tuple[str, str, int]]:
    """(mode, object id, size) of `paths` in the seed tree (`ls-tree -r -l`); absent paths are not in the result."""
    r = git(["--git-dir", wt.gitdir, "ls-tree", "-r", "-l", "-z", "--full-tree", wt.base_tree])
    if r.returncode:
        raise W.fail("cannot read the seed state", r)
    wanted, meta = set(paths), {}
    for rec in r.stdout.split(b"\0"):
        head, _, name = rec.partition(b"\t")
        if name and (path := os.fsdecode(name)) in wanted:
            mode, _, rest = head.decode().partition(" ")
            _kind, _, rest = rest.partition(" ")
            sha, _, size = rest.strip().partition(" ")
            meta[path] = (mode, sha, int(size.strip()) if size.strip().isdigit() else 0)
    return meta


# ------------------------------------------------------- bounded batch read
class Pipe:
    """A buffered reader over a pipe fd that never holds more than the caller lets it grow to."""

    def __init__(self, fd: int) -> None:
        self.fd, self.buf = fd, bytearray()

    def fill(self) -> bool:
        data = os.read(self.fd, CHUNK)
        self.buf += data
        return bool(data)


def watchdog(proc: "subprocess.Popen[bytes]", limit: int, hit: list[int]) -> None:
    """Kill `proc` once its resident size passes `limit` bytes (`ps -o rss=`, polled); `hit` is set when it did."""
    while proc.poll() is None:
        try:
            ps = subprocess.run([W.tool("ps"), "-o", "rss=", "-p", str(proc.pid)], capture_output=True, text=True, env=W.clean_env())
            rss = int(ps.stdout.strip() or 0) * 1024
        except (OSError, ValueError):
            rss = 0
        if rss > limit:
            hit.append(1)
            proc.kill()
            return
        time.sleep(0.1)


def batch(wt: Any, items: list[tuple[str, str]], filters: bool, left: list[int], obj_cap: int) -> dict[str, bytes]:
    """{path: bytes} of `items` ((path, object id) pairs) from `git cat-file --batch [--filters]` read as a stream. The
    header size is the UNfiltered size, so each reply is closed by a request for a missing object that follows it.
    `left[0]` is the aggregate budget still open (decreased by the bytes actually read); CapError as soon as one object
    passes `obj_cap` or the budget is gone (the git process is killed); SeedError when git cannot answer."""
    if not items:
        return {}
    mark = f"roster-end-{secrets.token_hex(8)}-"
    z = filters and has_z(wt)  # a path is part of the request only when filtering; NUL-delimited so no byte of it is altered
    if filters and not z and any("\r" in p or "\n" in p for p, _ in items):
        raise SeedError("this git cannot read a path with a CR or LF in its name safely (cat-file -z needs git 2.38 or newer)")
    end = "\0" if z else "\n"
    req = "".join(f"{oid} {p}{end}{mark}{i}{end}" if filters else f"{oid}\n{mark}{i}\n" for i, (p, oid) in enumerate(items)).encode("utf-8", "surrogateescape")
    argv, env = W.git_argv([*(attr_source(wt) if filters else []), "--git-dir", wt.gitdir, "--work-tree", str(wt.target), "cat-file", "--batch",
                            *(["--filters"] if filters else []), *(["-z"] if z else [])])  # work tree AND cwd are the target: a filter command runs only the user's own scripts
    out: dict[str, bytes] = {}
    with tempfile.TemporaryFile() as err:
        proc = subprocess.Popen(argv, cwd=wt.target, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err)
        assert proc.stdin is not None and proc.stdout is not None

        def feed() -> None:
            try:
                proc.stdin.write(req)  # type: ignore[union-attr]
                proc.stdin.close()  # type: ignore[union-attr]
            except OSError:  # git stopped reading (killed on a cap, or failed)
                pass
        writer = threading.Thread(target=feed, daemon=True)
        writer.start()
        hit: list[int] = []  # set by the watchdog when it killed git for its memory
        threading.Thread(target=watchdog, args=(proc, 2 * min(obj_cap, left[0]) + 64_000_000, hit), daemon=True).start()
        ended = lambda p: CapError("the expanded base versions are larger than the size cap") if hit else SeedError(f"cannot read the seed version of {p}: git ended early")  # noqa: E731
        pipe = Pipe(proc.stdout.fileno())
        try:
            for i, (p, _oid) in enumerate(items):
                while b"\n" not in pipe.buf:
                    if not pipe.fill():
                        raise ended(p)
                end = pipe.buf.index(b"\n")
                if pipe.buf[:end].endswith(b" missing"):
                    raise SeedError(f"cannot read the seed version of {p}")
                stop, start = f"\n{mark}{i} missing\n".encode(), end + 1
                while (close := pipe.buf.find(stop, max(start, len(pipe.buf) - len(stop) - CHUNK))) < 0:
                    if len(pipe.buf) - start > obj_cap or len(pipe.buf) - start > left[0]:
                        raise CapError("a file's expanded base version is larger than the size cap")
                    if not pipe.fill():
                        raise ended(p)
                size = close - start
                if size > obj_cap or size > left[0]:
                    raise CapError("the expanded base versions are larger than the size cap")
                left[0] -= size
                out[p] = bytes(pipe.buf[start:close])
                del pipe.buf[:close + len(stop)]
        finally:
            if proc.poll() is None:
                proc.kill()
            proc.stdout.close()
            proc.wait()
            writer.join(timeout=5)
    return out


def seed_blobs(wt: Any, paths: list[str], meta: dict[str, tuple[str, str, int]] | None, agg_cap: int, obj_cap: int) -> dict[str, State]:
    """The seed versions of `paths`: kind link for 120000, bad for a gitlink, none when absent; for a file its bytes as the
    target holds them (see the module text), read through the bounded stream (`agg_cap` bytes in total, `obj_cap` each)."""
    meta = seed_meta(wt, paths) if meta is None else meta
    want = [p for p in paths if p in meta and meta[p][0] in ("100644", "100755")]
    left = [agg_cap]
    blobs = batch(wt, [(p, meta[p][1]) for p in want if p in wt.seeded], False, left, obj_cap)
    blobs.update(batch(wt, [(p, meta[p][1]) for p in want if p not in wt.seeded], True, left, obj_cap))
    out: dict[str, State] = {}
    for p in paths:
        mode = meta.get(p, ("", "", 0))[0]
        out[p] = (NONE if not mode else ("file", blobs[p], mode == "100755", 0o755 if mode == "100755" else 0o644) if p in blobs
                  else ("link" if mode == "120000" else "bad", b"", False, 0))
    return out
