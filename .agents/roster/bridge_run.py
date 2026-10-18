"""Child-process half of bridge.py (installed as .agents/roster/bridge_run.py). Stdlib only.

Runs the child CLI under the supervisor: stdout and stderr are PIPES that the supervisor copies into run files (a
sandboxed `claude -p` whose stdout or stderr is a regular file on an external volume such as /Volumes/<ssd> hangs at
startup with no output, so no child ever receives a path-based stdio file); stall watchdog; every process left in the
child's process group or session is SIGKILLed after it exits; then (Codex children) the child's changes in its private
worktree are collected and applied to the target file by file (bridge_xfer.py), the worktree and the Codex temp dir are
removed, the writer lock is released and the status recorded. bridge.py executes this file's bytes only after they match the trust anchor."""
from __future__ import annotations

import fcntl
import json
import os
import selectors
import sys
import shutil
import signal
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Callable

try:
    W = load("bridge_wt")  # type: ignore[name-defined]  # noqa: F821 - injected by bridge.module (the verified bytes)
except NameError:  # imported as a plain module (tests, the skill's own tooling)
    import bridge_wt as W

EXIT_REFUSED, EXIT_GUARD, EXIT_STOPPED, EXIT_CONFLICT, EXIT_ERROR, EXIT_RUNNING = 2, 7, 8, 10, 11, 75
TERM_GRACE = 10.0  # seconds between SIGTERM and SIGKILL when the watchdog stops a child
MAX_EVENTS = 64_000_000  # the tail of the event stream that is parsed for the result


# ------------------------------------------------------------ process cleanup
def session_pids(sid: int) -> list[int]:
    """Live processes whose process group or session id is `sid` (the child was started with start_new_session)."""
    try:
        listing = subprocess.run([W.tool("ps"), "-A", "-o", "pid="], capture_output=True, text=True, env=W.clean_env()).stdout
    except OSError:
        return []
    found = []
    for tok in listing.split():
        try:
            pid = int(tok)
            if pid != os.getpid() and (os.getpgid(pid) == sid or os.getsid(pid) == sid):
                found.append(pid)
        except (ValueError, OSError):
            continue
    return found


def reap(sid: int, rounds: int = 100) -> bool:
    """SIGKILL everything in the child's group and session, repeating until none is left (bounded). True when clean."""
    for _ in range(rounds):
        try:
            os.killpg(sid, signal.SIGKILL)
        except OSError:
            pass
        left = session_pids(sid)
        if not left:
            return True
        for pid in left:
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
        time.sleep(0.05)
    return not session_pids(sid)


# --------------------------------------------------------------- the child
class Pump:
    """Copies the child's stdout/stderr pipes into files and counts the bytes (the watchdog's progress signal)."""

    def __init__(self, proc: subprocess.Popen[bytes], sinks: dict[int, Any]) -> None:
        self.sel, self.sinks, self.total = selectors.DefaultSelector(), sinks, 0
        for f in (proc.stdout, proc.stderr):
            assert f is not None
            os.set_blocking(f.fileno(), False)
            self.sel.register(f, selectors.EVENT_READ)

    def poll(self, timeout: float) -> bool:
        """Move whatever is readable (an EOF counts); False when nothing was ready within `timeout`."""
        ready = self.sel.select(timeout)
        for key, _ in ready:
            try:
                data = os.read(key.fd, 1 << 16)
            except BlockingIOError:
                continue
            except OSError:
                data = b""
            if not data:
                self.sel.unregister(key.fileobj)
                continue
            self.total += len(data)
            sink = self.sinks.get(key.fd)
            if sink is not None:
                sink.write(data)
        return bool(ready)

    def drain(self, seconds: float) -> None:
        """Read what is buffered; stop at EOF on both pipes, or as soon as nothing is ready (a leftover process may
        still hold a pipe open)."""
        end = time.monotonic() + seconds
        while self.sel.get_map() and time.monotonic() < end and self.poll(0.05):
            pass


def run_child(argv: list[str], cwd: Path, run: Path, env: dict[str, str], max_seconds: float, stall_seconds: float,
              claude: bool, files: list[Path]) -> tuple[int, bool]:
    """Run the CLI with <run>/prompt.md on stdin in its own session. A Claude child's stdout (stream-json events) goes
    to <run>/events.jsonl, a Codex child's is discarded; stderr goes to <run>/stderr.txt. Once the child has run longer
    than `max_seconds` and neither the pipes nor `files` made progress for `stall_seconds` it gets SIGTERM, then SIGKILL
    after TERM_GRACE. Afterwards the whole process group/session is killed. Returns (exit code, stopped)."""
    with open(run / "prompt.md", "rb") as stdin, open(run / "stderr.txt", "wb", buffering=0) as err, \
            open(run / "events.jsonl", "wb", buffering=0) as events:
        proc = subprocess.Popen(argv, cwd=cwd, stdin=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env,
                                close_fds=True, start_new_session=True)
        assert proc.stdout is not None and proc.stderr is not None
        pump = Pump(proc, {proc.stdout.fileno(): events if claude else None, proc.stderr.fileno(): err})
        start = last = time.monotonic()
        seen, stopped = -1, False
        try:
            while proc.poll() is None:
                pump.poll(0.25)
                now = time.monotonic()
                total = pump.total + sum(f.stat().st_size for f in files if f.exists())
                if total != seen:
                    seen, last = total, now
                if now - start > max_seconds and now - last >= stall_seconds:
                    stopped = True
                    break
            if stopped:
                for sig, grace in ((signal.SIGTERM, TERM_GRACE), (signal.SIGKILL, None)):
                    try:
                        os.killpg(proc.pid, sig)
                    except OSError:
                        pass
                    try:
                        proc.wait(timeout=grace)
                        break
                    except subprocess.TimeoutExpired:
                        pass
            pump.drain(2.0)
        finally:
            reap(proc.pid)  # before its changes are collected or anything is released: nothing of the child may still be running
            pump.drain(1.0)
            proc.stdout.close()
            proc.stderr.close()
        code = proc.wait()
    return code, stopped


def extract_result(run: Path) -> str:
    """The final `result` text of a Claude stream-json run (<run>/events.jsonl); on any parse problem a clear error
    followed by the raw tail of the stream."""
    path, raw = run / "events.jsonl", b""
    try:
        with open(path, "rb") as f:
            f.seek(max(0, f.seek(0, os.SEEK_END) - MAX_EVENTS))
            raw = f.read()
        result = None
        for line in raw.splitlines():
            try:
                obj = json.loads(line)
            except ValueError:
                continue
            if isinstance(obj, dict) and obj.get("type") == "result":
                result = obj
        if result is not None and isinstance(result.get("result"), str):
            return result["result"]
        why = "no result event with text"
    except OSError as e:
        why = f"cannot read events.jsonl ({e.strerror})"
    tail = raw[-4000:].decode("utf-8", "replace")
    return f"bridge: could not read the Claude result: {why}\n--- raw tail of the event stream ---\n{tail}\n"


def codex_tmp_dir(forbidden: list[Path]) -> Path:
    """A fresh 0700 dir outside the repo, work dir and git dir: the Codex child's TMPDIR and only extra writable root
    (ValueError when the system temp dir is inside one of `forbidden`)."""
    d = Path(os.path.realpath(tempfile.mkdtemp(prefix="roster-codex-")))
    if any(d == f or f in d.parents for f in (Path(os.path.realpath(x)) for x in forbidden)):
        shutil.rmtree(d, ignore_errors=True)
        raise ValueError(f"the system temp dir {d.parent} is inside the repo or git dir; set TMPDIR outside it")
    return d


# ------------------------------------------------------------ run state
def special_exit(st: dict[str, Any]) -> int | None:
    """The bridge exit code a run's status fields force, or None (then the child's code decides). The one precedence for
    the status the supervisor records and the exit `report` returns: refused (2) > error, nothing applied (11) >
    conflicts (10) > stopped (8) > protected, unreadable or type-changed paths not applied (7). A type change with nothing else
    applied (`typechange_only`) counts as 11: nothing at all was applied."""
    if st.get("refused"):
        return EXIT_REFUSED
    if st.get("error") or st.get("typechange_only"):
        return EXIT_ERROR
    if st.get("conflicts"):
        return EXIT_CONFLICT
    if st.get("stopped_min") is not None:
        return EXIT_STOPPED
    return EXIT_GUARD if st.get("dropped") or st.get("typechange") or st.get("unreadable") else None


def read_status(run: Path) -> dict[str, Any]:
    try:
        st = json.loads((run / "status.json").read_text(encoding="utf-8"))
        return st if isinstance(st, dict) else {}
    except (OSError, ValueError):
        return {}


def finished(run: Path) -> int | None:
    """Exit code once recorded; -1 if the supervisor is gone without recording one; None while it holds the lock."""
    def recorded() -> int | None:
        st = read_status(run)
        try:
            return int(st["exit"]) if st.get("state") == "done" else None
        except (KeyError, TypeError, ValueError):
            return None
    if (code := recorded()) is not None:
        return code
    try:  # no status yet: alive while the supervisor holds the lock
        fd = os.open(run / "alive.lock", os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    except OSError:
        return -1
    try:
        fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
    except OSError:
        return None  # held: the supervisor is alive
    finally:
        os.close(fd)
    code = recorded()  # it may have finished between the two checks
    return -1 if code is None else code


def archive_complete(d: Path) -> bool:
    """True when `d/manifest.json` (bridge_arch) exists, parses and says `complete: true`: only then are the child's
    changes saved there."""
    try:
        fd = os.open(d / "manifest.json", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    except OSError:
        return False
    try:
        doc = json.loads(os.read(fd, 64_000_000).decode("utf-8"))
    except (OSError, ValueError):
        return False
    finally:
        os.close(fd)
    return isinstance(doc, dict) and doc.get("complete") is True


def report(run: Path, run_id: str, seconds: float) -> int:
    """Print the run's result the way `bridge.py run`/`wait` show it and return the bridge exit code: waits up to
    `seconds` for the supervisor, prints out.txt, the notices recorded in the status and `exit code: N`."""
    deadline = time.monotonic() + max(0.0, seconds)
    code = finished(run)
    while code is None and time.monotonic() < deadline:
        time.sleep(0.25)
        code = finished(run)
    if code is None:
        print(f"STILL RUNNING run-id={run_id}")
        return EXIT_RUNNING
    if code == -1:
        print("supervisor exited without recording a status\nexit code: 1")
        return 1

    def slurp(name: str) -> str:
        return (run / name).read_text(encoding="utf-8", errors="replace") if (run / name).is_file() else ""
    out, err = slurp("out.txt"), slurp("stderr.txt")
    sys.stdout.write(out if out.endswith("\n") or not out else out + "\n")
    if code != 0 and not out.strip() and err.strip():
        sys.stdout.write(err[-4000:] if err.endswith("\n") else err[-4000:] + "\n")
    st = read_status(run)
    dropped, skipped, stopped = st.get("dropped"), st.get("skipped"), st.get("stopped_min")
    conflicts, left, error, refused = st.get("conflicts"), st.get("wt_left"), st.get("error"), st.get("refused")

    def shown(items: list[Any]) -> str:
        return ", ".join(str(c) for c in items[:10]) + (f", and {len(items) - 10} more" if len(items) > 10 else "")
    if stopped is not None:
        print(f"bridge: child exceeded max runtime ({stopped:g} min) and was stopped")
    if isinstance(skipped, list) and skipped:
        print(f"bridge: not copied into the child's private worktree: {shown(skipped)}")
    if isinstance(dropped, list) and dropped:
        print(f"bridge: not applied (protected): {shown(dropped)}")
    if isinstance(st.get("unreadable"), list) and st["unreadable"]:
        print(f"bridge: not applied (unreadable in target): {shown(st['unreadable'])}")
    typechange = st.get("typechange") if isinstance(st.get("typechange"), list) else []
    if typechange:
        print(f"bridge: not applied (type change): {shown(typechange)}; the child replaced a file by a directory or a directory by a file, "
              "so the whole set is archived and the target is unchanged there")
    if isinstance(conflicts, list) and conflicts:
        print(f"bridge: the child's changes conflict with the target and NOTHING was applied; the versions of {shown(conflicts)} "
              f"are saved under {st.get('conflicts_dir')}")
    if isinstance(refused, str) and refused:
        print(f"bridge: {refused}; refusing to apply them")
    if isinstance(error, str) and error:
        print(f"bridge: could not finish the child's changes ({error}); nothing was applied")
    archive = st.get("archive")
    saved = isinstance(archive, str) and bool(archive) and archive_complete(Path(archive))
    if isinstance(left, str) and left:
        print(f"bridge: the private worktree could not be removed and was left at {left}" if saved else
              f"bridge: the private worktree at {left} is the ONLY copy of the child's changes (no complete archive) and was kept on purpose; "
              "recover from it, then remove it with `git worktree remove --force`")
    if saved and (refused or error or conflicts or stopped is not None or typechange):
        print(f"bridge: the child's changes are archived at {archive} (every changed file, its base version, the deletions and the base object ids)")
    print(f"exit code: {code}")
    forced = special_exit(st)
    return forced if forced is not None else 0 if code == 0 else 1


# -------------------------------------------------------------- supervisor
def supervise(run: Path, argv: list[str], cwd: Path, env: dict[str, str], finish: Callable[[bool], dict[str, Any]] | None,
              codex_tmp: Path | None, max_min: float, stall: float, writer_fd: int, install_fd: int, atomic_json: Callable[[Path, dict], None]) -> None:
    """Forked child of `bridge.py run`, never returns: detach, run the CLI in `cwd`, then (in this order) kill what is
    left of it, `finish()` (Codex: collect the child's changes from its private worktree, apply them to the target,
    remove the worktree; it returns the status fields `dropped`, `conflicts`, `refused`, `wt_left`, `skipped`), remove the
    Codex temp dir, release the writer lock, record the status (changes over the cap -> 2, stopped -> 8, conflicts and
    nothing applied -> 10, protected changes dropped -> 7, else the child's code) and release the shared install lock. The alive lock is released on exit."""
    code, extra, stopped, claude = 1, {}, False, os.path.basename(argv[0]) == "claude"
    try:
        os.setsid()
        null = os.open(os.devnull, os.O_RDWR)
        [os.dup2(null, fd) for fd in (0, 1, 2)]
        try:
            code, stopped = run_child(argv, cwd, run, env, max_min * 60, min(stall, max_min * 60), claude, [run / "out.txt"])
        except OSError as e:
            what = f"cannot find a trusted {os.path.basename(argv[0])} (none on the trusted PATH)" if argv[0].startswith(W.UNRUNNABLE + "/") else f"cannot start {os.path.basename(argv[0])}: {e}"
            (run / "stderr.txt").write_text(f"bridge: {what}\n", encoding="utf-8")
            code = 127
        try:
            if claude and code != 127:  # 127: the CLI never started, there is no event stream; stderr.txt says why
                (run / "out.txt").write_text(extract_result(run), encoding="utf-8")
        except OSError:
            pass
        try:
            extra = finish(stopped) if finish is not None else {}
        except Exception as e:  # noqa: BLE001 - a failed collection must still fail the run
            extra = {"error": type(e).__name__}
        if codex_tmp is not None:
            shutil.rmtree(codex_tmp, ignore_errors=True)
        (run / "mcp.json").unlink(missing_ok=True)
        if writer_fd >= 0:
            os.close(writer_fd)
        fields = {k: v for k, v in {**extra, **({"stopped_min": max_min} if stopped else {})}.items() if v}
        forced = special_exit(fields)
        atomic_json(run / "status.json", {"state": "done", "exit": code if forced is None else forced, "child": code, **fields})
        if install_fd >= 0:
            os.close(install_fd)  # the shared install lock is kept until the status is recorded
    finally:
        os._exit(0)
