"""Transfer of a Codex child's changes from its private worktree to the target (installed as .agents/roster/bridge_xfer.py).
Stdlib only; plumbing only, per file, no patches.

`collect` lists what the child changed against the SEED state: tracked changes by `ls-files --modified --deleted` on the
worktree (through its recorded git dir) and untracked files by `ls-files --others` WITHOUT the worktree's own ignore
files (only the run's `--exclude-from` list and the user's global and `info/exclude` lists), then lets the TARGET's
ignore rules decide (`git -C <target> check-ignore --no-index`): a `.gitignore` the child edited cannot hide or reveal a
path. It totals the sizes of the child's files, the seed's base blobs and the target's files before reading anything,
reads each changed file without following any symlink (bridge_read: `lread`) and drops what must never reach the target:
protected paths (bridge_wt.protected), every symlink and every change to or from one, gitlinks, and paths outside the
repo. The base of a path is read by bridge_read (exact seeded bytes, else working-tree form, through a bounded stream).
`finish` archives the whole collected set (bridge_arch.py: files, bases, conflicts) before anything is applied. `apply`
runs under the target's writer lock: per path, target == base takes the child's version, child == base is a no-op, and
anything else is a three-way `git merge-file`; ONE conflict means nothing at all is written and the four versions of
each conflicting path are saved under <run>/conflicts (and copied into the archive). The target's permission bits are
kept (only the executable bit follows the child, and only while the target's still equals the base's; a new file is
0644/0755 under the umask). Results are written by temp file + rename through directories that are opened with
O_NOFOLLOW (made as real directories when missing), and rolled back if a write fails. Only a size cap is a refusal
(CapError, exit 2); any other failure to collect is an error (exit 11). A path below a symlink of the target (not ignored) is dropped on its own and reported; it never blocks the rest. bridge.py executes this file's bytes only after
they match the trust anchor; it uses bridge_wt.py, bridge_read.py and bridge_arch.py (`load`, injected by bridge.module)."""
from __future__ import annotations

import os
import shutil
import stat
import tempfile
import time
from pathlib import Path
from typing import Any, Callable

W = load("bridge_wt")  # type: ignore[name-defined]  # noqa: F821 - injected by bridge.module
R = load("bridge_read")  # type: ignore[name-defined]  # noqa: F821
A = load("bridge_arch")  # type: ignore[name-defined]  # noqa: F821
git, protected, SeedError, CapError = W.git, W.protected, W.SeedError, W.CapError
open_parent, lstat_of, lread, seed_meta, attr_source, State, NONE = R.open_parent, R.lstat_of, R.lread, R.seed_meta, R.attr_source, R.State, R.NONE
PATCH_CAP = 200_000_000  # bytes of changed files collected from the child (and, separately, of expanded base versions read)
OBJ_CAP = 100_000_000  # bytes of one expanded base version
LOCK_WAIT = 120.0  # seconds the apply waits for the target's writer lock


def lwrite(root: Path, rel: str, state: State) -> None:
    """Make the entry at `rel` below `root` `state` (a regular file via temp file + rename, or absent): parents are real
    directories, never reached or made through a symlink. OSError when that is not possible."""
    r = open_parent(root, rel, create=state[0] == "file")
    if isinstance(r, str):
        if r == "none" and state[0] == "none":
            return
        raise OSError(f"{rel}: a parent directory is a symlink or not a directory")
    fd, name = r
    tmp = f".roster-tmp-{os.getpid()}-{time.monotonic_ns()}"
    try:
        if state[0] == "none":
            try:
                os.unlink(name, dir_fd=fd)
            except FileNotFoundError:
                pass
            return
        out = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=fd)
        try:
            view = memoryview(state[1])
            while view:
                view = view[os.write(out, view):]
            os.fchmod(out, (state[3] or (0o755 if state[2] else 0o644)) & 0o7777)
        finally:
            os.close(out)
        os.replace(tmp, name, src_dir_fd=fd, dst_dir_fd=fd)
    except OSError:
        try:
            os.unlink(tmp, dir_fd=fd)
        except OSError:
            pass
        raise
    finally:
        os.close(fd)


# ----------------------------------------------------------------- collect
class Change:
    """One changed path: `base` is the seed version (what the child started from, in working-tree form), `child` its
    version now, `base_oid` the seed's object id of the path ("" when it did not exist)."""

    def __init__(self, path: str, base: State, child: State, base_oid: str = "") -> None:
        self.path, self.base, self.child, self.base_oid = path, base, child, base_oid


def safe_rel(p: str) -> bool:
    parts = p.split("/")
    return bool(p) and not p.startswith("/") and "" not in parts and "." not in parts and ".." not in parts and "\0" not in p and "\n" not in p


def seed_blobs(wt: Any, paths: list[str], meta: dict[str, tuple[str, str, int]] | None = None) -> dict[str, State]:
    """The seed versions of `paths` (bridge_read.seed_blobs) under this module's caps."""
    return R.seed_blobs(wt, paths, meta, PATCH_CAP, OBJ_CAP)


def user_excludes(target: Path) -> list[str]:
    """The user's own ignore lists as `--exclude-from` arguments: the target's `info/exclude` and its global excludes file
    (`core.excludesFile`, else `$XDG_CONFIG_HOME/git/ignore` or `~/.config/git/ignore`), those that exist."""
    found: list[str] = []
    r = git(["-C", str(target), "rev-parse", "--path-format=absolute", "--git-path", "info/exclude"])
    if r.returncode == 0:
        found.append(r.stdout.decode().strip())
    c = git(["-C", str(target), "config", "--type=path", "--get", "core.excludesFile"])
    glob = c.stdout.decode().strip() if c.returncode == 0 else ""
    if not glob:
        xdg = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
        glob = os.path.join(xdg, "git", "ignore")
    found.append(glob)
    return [f"--exclude-from={p}" for p in found if p and os.path.isfile(p)]


def ignore_batch(target: Path, paths: list[str]) -> set[str]:
    """The `paths` the target's rules ignore: ONE `git check-ignore --stdin -z --no-index` run in the target. SeedError
    when git cannot answer (an error of the run, exit 11); the caller keeps symlinked prefixes out of the batch."""
    if not paths:
        return set()
    r = git(["-C", str(target), "check-ignore", "--stdin", "-z", "--no-index"], data="".join(f"{x}\0" for x in paths).encode("utf-8", "surrogateescape"))
    if r.returncode not in (0, 1):
        raise W.fail("cannot check the child's new files against the target's ignore rules", r)
    return set(W.paths_of(r.stdout))


def stop_prefix(target: Path, path: str, seen: dict[str, str]) -> str:
    """The first leading directory component of `path` that is a symlink or not a directory in the target ("" when every
    one is a real directory or missing): git refuses to check anything beyond a symlink. `seen` caches the lstat of each
    prefix (dir | gone | stop) so that thousands of files below one directory cost one lstat walk."""
    parts, cur = path.split("/")[:-1], ""
    for part in parts:
        cur = f"{cur}/{part}" if cur else part
        kind = seen.get(cur)
        if kind is None:
            try:
                kind = "dir" if stat.S_ISDIR(os.lstat(target / cur).st_mode) else "stop"
            except OSError:
                kind = "gone"
            seen[cur] = kind
        if kind != "dir":
            return cur if kind == "stop" else ""
    return ""


def dir_ignored(target: Path, prefixes: list[str]) -> set[str]:
    """The `prefixes` (symlinks or non-directories of the target) that its ignore rules ignore. git matches a directory-only
    pattern (`node_modules/`) against the real type of the path, so a symlink is never matched by it; the name is therefore
    also asked about AS A DIRECTORY: in a scratch repository that holds a real directory of that name, the target's `.gitignore`
    files along the way, its `info/exclude` and its `core.excludesFile` (the global excludes are the user's own, read from HOME)."""
    plain = ignore_batch(target, prefixes)
    rest = [p for p in prefixes if p not in plain and safe_rel(p) and ".git" not in p.split("/")]
    if not rest:
        return plain
    scratch = Path(tempfile.mkdtemp(prefix="roster-ignore-"))
    try:
        if (r := git(["-C", str(scratch), "init", "-q", "."])).returncode:
            raise W.fail("cannot check the child's new files against the target's ignore rules", r)
        for p in rest:
            (scratch / p).mkdir(parents=True, exist_ok=True)
            cur = ""
            for part in ["", *p.split("/")[:-1]]:
                cur = f"{cur}/{part}" if cur and part else part or cur
                st = lread(target, f"{cur}/.gitignore" if cur else ".gitignore")
                if st[0] == "file":
                    (scratch / cur / ".gitignore").write_bytes(st[1])
        exc = git(["-C", str(target), "rev-parse", "--path-format=absolute", "--git-path", "info/exclude"])
        info = Path(exc.stdout.decode().strip()) if exc.returncode == 0 and exc.stdout.strip() else None
        if info is not None and info.is_file():
            (scratch / ".git/info").mkdir(exist_ok=True)
            (scratch / ".git/info/exclude").write_bytes(info.read_bytes())
        g = git(["-C", str(target), "config", "--type=path", "--get", "core.excludesFile"])
        pin = ["-c", f"core.excludesFile={g.stdout.decode().strip()}"] if g.returncode == 0 and g.stdout.strip() else []
        r = git(["-C", str(scratch), *pin, "check-ignore", "--stdin", "-z", "--no-index"], data="".join(f"{x}\0" for x in rest).encode("utf-8", "surrogateescape"))
        if r.returncode not in (0, 1):
            raise W.fail("cannot check the child's new files against the target's ignore rules", r)
        return plain | set(W.paths_of(r.stdout))
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def target_ignored(target: Path, paths: list[str]) -> set[str]:
    """The `paths` that the TARGET's ignore rules ignore (`git check-ignore --stdin -z --no-index` run in the target). A
    path below a symlink (or a non-directory) of the target is decided by its first such prefix, asked ONCE (dir_ignored,
    which also applies the directory-only patterns): when the prefix is ignored (`node_modules -> elsewhere` under
    `node_modules/`), the whole subtree is ignored like any other ignored output; otherwise the path counts as not
    ignored (collect then drops it individually: it cannot be applied through the symlink)."""
    seen: dict[str, str] = {}
    plain, below = [], {}
    for p in paths:
        pre = stop_prefix(target, p, seen)
        (below.setdefault(pre, []).append(p) if pre else plain.append(p))
    hidden = dir_ignored(target, sorted(below))
    return ignore_batch(target, plain) | {p for pre in hidden for p in below[pre]}


def changed_paths(wt: Any) -> list[str]:
    """The paths the child changed, added or removed: tracked changes (`--modified --deleted`) plus untracked files that
    the TARGET's ignore rules do not ignore. The worktree's per-directory ignore files are never consulted (the child may
    have edited them): the listing uses the run's exclude list and the user's global and info lists, and
    `check-ignore --no-index` in the target decides the rest (target_ignored). Every driver of a filter is switched off
    (`wt.pins`): a driver command resolves in the worktree, where the child may have rewritten it."""
    base = [*wt.pins, *attr_source(wt), "--git-dir", wt.gitdir, "--work-tree", str(wt.path), "ls-files", "-z"]
    tracked = git([*base, "--modified", "--deleted"], cwd=wt.path)
    others = git([*base, "--others", f"--exclude-from={wt.exclude}", *user_excludes(wt.target)], cwd=wt.path)
    if tracked.returncode or others.returncode:
        raise W.fail("cannot list the child's changes", tracked if tracked.returncode else others)
    new = sorted(set(W.paths_of(others.stdout)))
    return sorted(set(W.paths_of(tracked.stdout)) | (set(new) - target_ignored(wt.target, new)))


def real_dir(root: Path, rel: str) -> bool:
    """True when `rel` below `root` is a real directory (no symlink on the way or at the end)."""
    try:
        return stat.S_ISDIR(os.lstat(root / rel).st_mode) and lstat_of(root, rel)[0] == "bad"
    except OSError:
        return False


def collect(wt: Any, spec: dict[str, list[str]], control: bool) -> tuple[list[Change], list[str]]:
    """(the child's changes that may be applied, the dropped paths). CapError over PATCH_CAP, which counts the child's
    files, the seed blobs they changed and the target's files (nothing is read before it is checked); the expanded base
    versions are bounded again as they are read. Two more groups are neither applied nor dropped silently: changes to a
    path whose target bytes could not be copied into the worktree (`wt.unreadable`: the child saw HEAD's version, so a change
    could be a fake deletion) and TYPE CHANGES (`wt.held`, Change objects): the child replaced a file by a directory, or a
    directory by a file, so the old file/directory and everything below the new one form ONE set that finish archives and
    never applies."""
    dropped, todo, total, seen, held_roots, dir_roots = [], [], 0, {}, set[str](), set[str]()
    wt.held, wt.unreadable = [], []
    paths = changed_paths(wt)
    for path in paths:
        if path.endswith("/") or not safe_rel(path) or protected(path, spec, control):
            dropped.append(path)
        elif path in wt.skipped_tracked:
            wt.unreadable.append(path)
        elif any(path.startswith(r + "/") for r in held_roots - dir_roots):  # below a directory the child replaced by a file: it is gone from the child's tree
            todo.append(path)
        elif pre := stop_prefix(wt.target, path, seen):
            if lstat_of(wt.target, pre)[0] == "file" and safe_rel(pre) and not protected(pre, spec, control):  # the target has a FILE where the child made a directory
                held_roots.add(pre)
                dir_roots.add(pre)
                todo.append(path)
                total += lstat_of(wt.path, path)[1]
            else:
                dropped.append(path)  # below a symlink of the target: it cannot be applied
        else:
            kind, size = lstat_of(wt.path, path)
            tkind = lstat_of(wt.target, path)[0]
            if kind == "bad" and real_dir(wt.path, path) and tkind == "file":  # the child's directory where the target has a file
                held_roots.add(path)
                dir_roots.add(path)
            elif kind == "file" and tkind == "bad" and real_dir(wt.target, path):  # the child's file where the target has a directory
                held_roots.add(path)
            elif kind in ("link", "bad"):
                dropped.append(path)
                continue
            todo.append(path)
            total += size
    for root in dir_roots - set(todo):  # the old file is gone from the worktree: `ls-files` may not list it
        todo.append(root)
    todo = [p for p in dict.fromkeys(todo) if p not in dropped]
    hold = {p for p in todo if any(p == r or p.startswith(r + "/") for r in held_roots)}
    meta = seed_meta(wt, todo) if todo else {}
    total += sum(m[2] for m in meta.values()) + sum(lstat_of(wt.target, p)[1] for p in todo)
    if total > PATCH_CAP:
        raise CapError(f"the child's changes (with their bases and the target's files) are larger than {PATCH_CAP // 1_000_000} MB")
    base, changes = seed_blobs(wt, todo, meta) if todo else {}, []
    for path in todo:
        child = NONE if path in dir_roots or any(path.startswith(r + "/") for r in held_roots - dir_roots) else lread(wt.path, path)
        if child[0] in ("link", "bad") or base[path][0] in ("link", "bad"):  # a symlink or gitlink, in either version
            dropped.append(path)
        elif child[:3] != base[path][:3]:
            ch = Change(path, base[path], child, meta.get(path, ("", "", 0))[1])
            (wt.held if path in hold else changes).append(ch)
    return changes, sorted(dropped)


# ------------------------------------------------------------------- apply
def merge3(tmp: Path, target: bytes, base: bytes, child: bytes) -> tuple[bool, bytes]:
    """`git merge-file -p --diff3` of the three versions: (clean, merged text with conflict markers when not)."""
    for name, data in (("target", target), ("base", base), ("child", child)):
        (tmp / name).write_bytes(data)
    r = git(["merge-file", "-p", "--diff3", "-L", "target", "-L", "base", "-L", "child", "target", "base", "child"], cwd=tmp)
    return r.returncode == 0, r.stdout


def new_mode(executable: bool) -> int:
    """Permission bits of a file the apply creates: 0644, or 0755 when executable, under the umask."""
    mask = os.umask(0)
    os.umask(mask)
    return (0o755 if executable else 0o644) & ~mask


def resolve(ch: Change, target: State, tmp: Path) -> tuple[State | None, bytes | None, str]:
    """(the target's new state or None when it stays as it is, merge output, conflict reason or ''): the child's version
    when the target still has the base; nothing when only the child's mode changed against a moved-on target; a
    three-way merge otherwise (delete against modify, or an add on both sides, is a conflict). The target's permission
    bits are kept; the executable bit is taken from the child only when the target's still equals the base's; a new
    file gets 0644/0755 under the umask."""
    if target[0] in ("link", "bad"):
        return None, None, "the target's path is a symlink, has a symlink above it or is not a regular file"
    (bk, bd, be, _bm), (ck, cd, ce, _cm), (tk, td, te, tm) = ch.base, ch.child, target
    same = lambda a, b: a[0] == b[0] and a[1] == b[1]  # noqa: E731
    merged = None
    if same(ch.child, ch.base):
        content = (tk, td)  # only the mode changed
    elif same(target, ch.base):
        content = (ck, cd)
    elif same(target, ch.child):
        content = (tk, td)
    elif "none" in (bk, ck, tk):
        return None, None, "deleted on one side and changed or added on the other" if bk != "none" else "added on both sides, differently"
    else:
        ok, merged = merge3(tmp, td, bd, cd)
        if not ok:
            return None, merged, "overlapping changes"
        content = ("file", merged)
    if content[0] != "file":
        result: State = NONE
    elif tk == "none":
        result = ("file", content[1], ce, new_mode(ce))
    else:
        mode = tm
        if ce != be and te == be:  # the child changed the executable bit and the target's is still the base's
            mode = (tm | ((tm & 0o444) >> 2)) if ce else (tm & ~0o111)
        result = ("file", content[1], bool(mode & 0o111), mode)
    return (None if result == target else result), merged, ""


def save_conflicts(run: Path, rows: list[tuple[Change, State, bytes | None]]) -> Path:
    """<run>/conflicts/<path>.{target,base,child,merged}: the versions of every conflicting path (absent ones omitted)."""
    root = run / "conflicts"
    for ch, target, merged in rows:
        for suffix, data in (("target", target[1] if target[0] == "file" else None), ("base", ch.base[1] if ch.base[0] == "file" else None),
                             ("child", ch.child[1] if ch.child[0] == "file" else None), ("merged", merged)):
            if data is not None:
                dst = root / f"{ch.path}.{suffix}"
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_bytes(data)
    return root


def apply(target: Path, changes: list[Change], run: Path) -> dict[str, Any]:
    """Apply `changes` to `target` (the caller holds its writer lock). {} on success; {"conflicts": [...], "conflicts_dir"}
    when any path conflicts (nothing written); {"error"} when a write failed (everything written is rolled back)."""
    tmp = Path(tempfile.mkdtemp(prefix="merge-", dir=run))
    try:
        writes, rows, reasons = [], [], []
        for ch in changes:
            current = lread(target, ch.path)
            new, merged, why = resolve(ch, current, tmp)
            if why:
                rows.append((ch, current, merged))
                reasons.append(f"{ch.path}: {why}")
            elif new is not None:
                writes.append((ch.path, current, new))
        if rows:
            root = save_conflicts(run, rows)
            (root / "REASONS.txt").write_text("\n".join(reasons) + "\n", encoding="utf-8")
            return {"conflicts": [ch.path for ch, _, _ in rows], "conflicts_dir": str(root)}
        done: list[tuple[str, State]] = []
        try:
            for path, before, new in writes:
                lwrite(target, path, new)
                done.append((path, before))
        except OSError as e:
            for path, before in reversed(done):
                try:
                    lwrite(target, path, before)
                except OSError:
                    pass
            return {"error": f"the child's changes could not be written ({e.strerror or e})"}
        return {}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def locked(target: Path, run: Path, changes: list[Change], lock: Callable[[], int]) -> dict[str, Any]:
    """`apply` while holding the target's writer lock (`lock()` returns an fd or raises BlockingIOError; waits up to
    LOCK_WAIT seconds)."""
    deadline, fd = time.monotonic() + LOCK_WAIT, -1
    while fd < 0:
        try:
            fd = lock()
        except BlockingIOError:
            if time.monotonic() > deadline:
                return {"error": "the target's writer lock stayed busy"}
            time.sleep(0.5)
        except OSError as e:
            return {"error": f"cannot take the target's writer lock ({e.strerror})"}
    try:
        return apply(target, changes, run)
    finally:
        os.close(fd)


def finish(wt: Any, spec: dict[str, list[str]], control: bool, writes: bool, run: Path, lock: Callable[[], int], stopped: bool = False) -> dict[str, Any]:
    """The supervisor's last step for a Codex run: for a writer level collect the child's changes, ARCHIVE the whole set
    durably (bridge_arch: files, bases), apply it (`dropped`: protected or symlink paths not applied; `conflicts`/
    `conflicts_dir`: nothing was applied, the versions are saved in the archive too; `error`: the changes could not be
    collected or a write failed and was rolled back; `refused`: only a size cap), settle the archive's outcome (applied |
    conflict | error | stopped) and remove the worktree. The worktree is left in place (`wt_left`) when the changes could
    not be collected or written, so that nothing the child did is lost; A conflict, error, refusal or stopped child keeps its archive and names it."""
    out: dict[str, Any] = {"skipped": wt.skipped}
    arch: Path | None = None
    try:
        if writes:
            changes, out["dropped"] = collect(wt, spec, control)
            out["typechange"], out["unreadable"] = sorted(c.path for c in wt.held), list(wt.unreadable)
            out["typechange_only"] = bool(wt.held) and not changes  # nothing was applied at all
            if changes or wt.held:  # the whole set is archived, the type changes too (they are not applied)
                arch = A.save(run, wt, [*changes, *wt.held])
                out["archive"] = str(arch)
            if changes:
                out.update(locked(wt.target, run, changes, lock))
    except CapError as e:
        return {**out, "refused": str(e), "wt_left": str(wt.path), **keep(run, wt, "refused", str(e))}
    except Exception as e:  # noqa: BLE001 - SeedError (git could not answer) and everything else: an error, nothing applied
        return {**out, "error": f"{type(e).__name__}: {e}"[:300], "wt_left": str(wt.path), **(keep(run, wt, "error", str(e)) if arch is None else {})}
    if arch is not None:
        try:
            if out.get("conflicts"):  # the prunable run directory is not the only place the versions live
                A.add_conflicts(arch, Path(out["conflicts_dir"]))
                out["conflicts_dir"] = str(arch / "conflicts")
        except OSError:
            pass
        try:
            A.settle(arch, "error" if out.get("error") else "conflict" if out.get("conflicts") else "stopped" if stopped else "typechange" if wt.held else "applied")
        except OSError:
            pass
    if out.get("error") or not W.remove(wt):
        out["wt_left"] = str(wt.path)
    return out


def keep(run: Path, wt: Any, outcome: str, why: str) -> dict[str, str]:
    """Record an incomplete archive (the work is in the worktree) and return its status field."""
    try:
        return {"archive": str(A.incomplete(run, wt, outcome, why))}
    except OSError:
        return {}
