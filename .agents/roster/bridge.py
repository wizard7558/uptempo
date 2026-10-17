#!/usr/bin/env python3
"""Run a bridged roster role on the other provider's CLI (installed as .agents/roster/bridge.py). Stdlib only.

  python3 -I .agents/roster/bridge.py run <role> --task-file .agents/roster/tmp/task-<role>-<16 hex>.md [--wait-seconds 100]
  python3 -I .agents/roster/bridge.py wait <run-id> [--wait-seconds 100]

The request file: an optional first line `dir: <path>`, a line `---`, then the task verbatim. Settings come from
facts.json (bridge_policy.py derives the flags), instructions from the calling runtime's agent file.

Every run/wait verifies this file, the bridge_*.py helpers and facts.json against the trust anchor in
<git-common-dir>/agent-roster/trust.json (outside every child's writable root); a mismatch exits 6 (a file that differs
from the anchor but equals a clean HEAD blob is accepted with a note). The install lock and that verification use only
code in THIS file; the helper modules are executed only from the verified bytes. `run` first takes a shared flock on
locks/install.lock, kept by its supervisor until the status is recorded, so the installer (exclusive) cannot run under a
live run and a run cannot start during an install (exit 4). Run state lives in <git-common-dir>/agent-roster/; tmp/ holds
only incoming requests. When the child ends, everything left in its process group is killed.

A Claude child runs in the target dir with every protected control path and credential directory denied up front. A
Codex child NEVER gets the target's checkout: it runs in a private worktree (bridge_wt.py) seeded by git plumbing; a writer
level's changes are collected file by file, protected paths and symlinks dropped (exit 7), the rest ARCHIVED (bridge_arch.py)
and applied three-way under the writer lock (bridge_xfer.py); one conflict writes nothing (exit 10); `no`/`commands` changes
are discarded. The supervisor starts only programs it resolved itself: git, ps, claude and codex are absolute paths on a
PATH without relative or empty entries or any directory a child can write (repo, work dir, private worktree and its
writable roots, run and Codex temp dirs, the target's ignored top-level directories: bridge_wt.pin_tools).

`run` prints `RUN-ID <id>` first, then the child's output and `exit code: N`, or `STILL RUNNING run-id=<id>`
(exit 75) when --wait-seconds elapses (the child keeps running). Bridge exit: 0 when the child exited 0, 1 when it
exited non-zero, 2 refused input (also changes over the size cap, an unreadable or invalid config file, an I/O error
creating the worktree), 4 writer lock held or an install in progress, 5 the calling Codex session is sandboxed (the
Codex->Claude direction needs sandbox_mode = "danger-full-access"), 6 runtime differs from the installed copy, 7 protected
changes of a Codex child were dropped, 8 the child exceeded its max runtime and was stopped, 10 the child's changes
conflict with the target (nothing applied, versions saved), 11 the child's changes could not be collected or written
(nothing applied; archive and worktree kept), 75 still running. Precedence: 2 > 11 > 10 > 8 > 7 > the child's code. The
child gets an allowlisted environment only. Every subprocess uses an argument list (no shell); no argv is written to disk.
"""
from __future__ import annotations

import os, sys  # noqa: E401

sys.dont_write_bytecode = True  # before anything else is imported: this entry point leaves no __pycache__ ...
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"  # ... and neither does anything it starts

import argparse, errno, fcntl, functools, hashlib, json, re, secrets, shutil, stat, subprocess, types  # noqa: E401
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
RDIR = ROOT / ".agents" / "roster"
TMP = RDIR / "tmp"
MAX_BYTES, KEEP_DAYS, TASK_DAYS = 1_000_000, 7, 1
UNRUNNABLE = "/nonexistent-roster"  # the directory of a program with no trusted executable (bridge_tools.UNRUNNABLE)
EXIT_REFUSED, EXIT_LOCKED, EXIT_SANDBOXED, EXIT_TAMPERED = 2, 4, 5, 6  # 7/8/10/11/75: bridge_run
TAMPERED_MSG = ("roster runtime is not anchored for this checkout or differs from the installed copy; run the "
                "agent-roster installer (python3 -I ~/.agents/skills/agent-roster/scripts/install_roster.py --repo .)")
SANDBOXED_MSG = ('the Codex session is sandboxed; the Claude bridge needs a Codex session with '
                 'sandbox_mode = "danger-full-access" (see SKILL.md)')
FULL_ACCESS = ("", "none", "danger-full-access", "full-access")  # CODEX_SANDBOX values that are not a sandbox
TRUSTED = ("bridge.py", "bridge_tools.py", "bridge_wt.py", "bridge_cfg.py", "bridge_ctl.py", "bridge_policy.py", "bridge_io.py", "bridge_run.py", "bridge_read.py", "bridge_arch.py",
           "bridge_xfer.py", "facts.json")  # verified at every run/wait; a module is listed after the ones it loads
INSTR_MARK = "\n\n## Role instructions\n\n"
RUN_ID = re.compile(r"^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$")
REQUEST = re.compile(r"^task-[a-z0-9-]+-[0-9a-f]{16}\.md$")
LEAF_NOTICE = ("You run as a leaf agent under a bridge. Do not spawn subagents (no spawn_agent or Agent tool) and "
               "do not run .agents/roster/bridge.py.\n\n")
_MODS: dict[str, types.ModuleType] = {}


class Refused(Exception):
    def __init__(self, msg: str, code: int = EXIT_REFUSED):
        super().__init__(msg)
        self.code = code


# ------------------------------------------------------- trust and policy
def read_bytes(path: Path, limit: int = MAX_BYTES) -> bytes:
    """A regular file owned by this user, opened with O_NOFOLLOW, at most `limit` bytes (OSError otherwise)."""
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_size > limit or st.st_uid != os.getuid():
            raise OSError(f"{path} is not a regular file of at most {limit} bytes owned by you")
        return os.read(fd, limit + 1)
    finally:
        os.close(fd)


def read_text(path: Path, limit: int = MAX_BYTES) -> str:
    try:
        return read_bytes(path, limit).decode("utf-8")
    except UnicodeDecodeError:
        raise Refused(f"{path} is not valid UTF-8")
    except OSError as e:
        raise Refused(f"{path}: {e}")


def committed_clean(root: Path, rel: str, data: bytes) -> bool:
    """True when `data` equals the blob at HEAD:<rel> (git cat-file --batch). Children cannot write .git."""
    try:
        r = run_git(["-C", str(root), "cat-file", "--batch"], input=f"HEAD:{rel}\n".encode(), capture_output=True)
        head, _, rest = r.stdout.partition(b"\n")
        _, kind, size = head.split(b" ")
        return kind == b"blob" and len(rest) >= int(size) and rest[:int(size)] == data
    except (OSError, ValueError):
        return False


def verify_runtime() -> dict[str, bytes]:
    """Bytes of this file, the bridge_*.py modules and facts.json, each matching the anchor entry for ROOT (or a clean
    HEAD blob, with a note); those exact bytes are used afterwards. Exit 6 on a missing or differing anchor/hash."""
    upgraded: list[str] = []
    try:
        me = Path(os.path.abspath(__file__))
        if os.path.islink(me) or os.path.realpath(me) != str(RDIR / "bridge.py"):
            raise OSError("bridge.py is not the installed regular file")
        files = {n: read_bytes(RDIR / n) for n in TRUSTED}
        common = common_dir(ROOT)
        if not common:
            raise OSError("no git common dir")
        entry = json.loads(read_bytes(Path(common) / "agent-roster" / "trust.json").decode("utf-8"))[str(ROOT)]
        for n in TRUSTED:
            if hashlib.sha256(files[n]).hexdigest() != entry.get(n):
                upgraded.append(n)
        ok = all(committed_clean(ROOT, f".agents/roster/{n}", files[n]) for n in upgraded)
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        ok = False
    if not ok:
        raise Refused(TAMPERED_MSG, EXIT_TAMPERED)
    if upgraded:
        print("bridge: note: runtime differs from the anchor but matches HEAD; run the installer to re-anchor", file=sys.stderr)
    return files


def module(name: str, data: bytes | None = None) -> types.ModuleType:
    """A bridge_*.py module (wt, cfg, ctl, policy, io, run, read, arch, xfer) from `data` (the verified bytes). Run as a script, nothing is
    read from disk here; imported as a library (tests) it is. Every module gets `load` (this function) for its siblings."""
    if name not in _MODS:
        if data is None and __name__ == "__main__":
            raise Refused(TAMPERED_MSG, EXIT_TAMPERED)
        p = Path(os.path.abspath(__file__)).with_name(f"{name}.py")
        mod = types.ModuleType(name)
        mod.__file__ = str(p)
        mod.__dict__["load"] = module
        mod.__dict__["LIBRARY"] = data is None  # read from disk by a library user (tests, tooling): bridge_wt pins on the caller's PATH; the runtime never does
        exec(compile(data if data is not None else read_bytes(p), str(p), "exec"), mod.__dict__)
        _MODS[name] = mod
    return _MODS[name]


def policy(data: bytes | None = None) -> types.ModuleType:
    return module("bridge_policy", data)

def bio(data: bytes | None = None) -> types.ModuleType:
    return module("bridge_io", data)


def load_all(verified: dict[str, bytes]) -> None:
    """Load every module from the verified bytes (nothing is read from disk again)."""
    [module(n[:-3], verified[n]) for n in TRUSTED if n.startswith("bridge_")]


def claude_policy(role: dict[str, Any], workdir: Path) -> tuple[str, list[str], list[str], dict[str, Any]]:
    return policy().claude_policy(role, workdir, ROOT, common_dir(ROOT) or None)


def build_argv(role: dict[str, Any], workdir: Path, out: Path, role_file: Path, codex_tmp: Path | None = None,
               control: tuple[str, ...] = (), restricted: bool = False, creds: tuple[str, ...] = (),
               roots: tuple[str, ...] = (), reads: tuple[tuple[str, ...], tuple[str, ...]] = ((), ())) -> list[str]:
    return policy().build_argv(role, workdir, out, role_file, ROOT, common_dir(ROOT) or None, codex_tmp, control, restricted, creds, roots, reads)


# --------------------------------------------------------------- inputs
def load_facts(data: bytes | None = None) -> dict[str, Any]:
    try:
        facts = json.loads(data.decode("utf-8") if data is not None else read_text(RDIR / "facts.json"))
    except (Refused, ValueError) as e:
        raise Refused(f"cannot read .agents/roster/facts.json: {e}")
    if not isinstance(facts, dict) or not isinstance(facts.get("roles"), dict):
        raise Refused("facts.json has no roles")
    return facts


def role_settings(facts: dict[str, Any], name: str) -> dict[str, Any]:
    try:
        return policy().role_settings(facts, name)
    except ValueError as e:
        raise Refused(str(e))


def role_instructions(role: dict[str, Any]) -> str:
    """Text after `## Role instructions` in the calling runtime's own agent file (bridge_io.instructions)."""
    try:
        return bio().instructions(role, ROOT, read_text, INSTR_MARK)
    except ValueError as e:
        raise Refused(str(e))


def mcp_config(role: dict[str, Any]) -> str:
    """<run>/mcp.json for the Claude child: only the mcp_allow servers, resolved from user scope (~/.claude.json
    `mcpServers`); a project .mcp.json is never read. Definitions are never printed."""
    user = Path.home() / ".claude.json"
    try:
        return json.dumps({"mcpServers": policy().mcp_servers(role["mcp_allow"], read_text(user, 64_000_000) if role["mcp_allow"] and os.path.lexists(user) else "")}) + "\n"
    except ValueError as e:
        raise Refused(str(e))


# ---------------------------------------------------------- directories
def private_dir(d: Path) -> Path:
    """A real 0700 directory owned by you (created or fixed); Refused for a symlink or foreign owner. Lives here: it runs
    before any helper module is verified."""
    try:
        if not os.path.lexists(d):
            os.mkdir(d, 0o700)
        st = os.lstat(d)
    except OSError as e:
        raise Refused(f"cannot create {d}: {e}")
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.getuid():
        raise Refused(f"{d} must be a real directory owned by you (symlink or foreign owner)")
    if stat.S_IMODE(st.st_mode) != 0o700:
        os.chmod(d, 0o700)
    return d


def runtime_dirs() -> None:
    """.agents/roster and its tmp/ (incoming requests only) are real directories inside ROOT; tmp/ is forced to 0700."""
    private_dir(TMP)
    for p in (RDIR, TMP):
        if os.path.realpath(p) != str(p):
            raise Refused(f"{p} must be a real directory inside {ROOT} owned by you (symlink or foreign owner)")


@functools.cache
def state_base() -> Path:
    """<git-common-dir>/agent-roster, 0700: run dirs, locks, trust anchor (never writable by a child)."""
    if not (common := common_dir(ROOT)):
        raise Refused(f"{ROOT} is not in a git repository")
    return private_dir(Path(common) / "agent-roster")


def sandboxed_codex_parent() -> bool:
    """True in a sandboxed Codex session: CODEX_SANDBOX names one, or a write probe in the request or run/lock dirs is refused."""
    if os.environ.get("CODEX_SANDBOX", "").strip().lower() not in FULL_ACCESS:
        return True
    common, probe = common_dir(ROOT), bio().probe_writable
    return not (probe(TMP) and (not common or all(probe(Path(common) / "agent-roster" / d) for d in ("runs", "locks"))))


def checkout_roots(listed: bool = False) -> list[str]:
    """ROOT and every other checkout of its repository: the work trees `git worktree list -z` names (`listed`, through the trusted
    git) and those the `.git` files name (own code, used before any module is verified; commondir and gitdir are normalized)."""
    roots = [str(ROOT)]
    try:
        dot = ROOT / ".git"
        gitdir = Path(os.path.normpath(ROOT / dot.read_text().partition("gitdir:")[2].strip())) if dot.is_file() else dot
        common = Path(os.path.normpath(gitdir / (gitdir / "commondir").read_text().strip())) if (gitdir / "commondir").is_file() else gitdir
        roots += ([str(common.parent)] if common.name == ".git" else []) + [str(Path(f.read_text().strip()).parent) for f in (common / "worktrees").glob("*/gitdir")]
    except (OSError, ValueError):
        pass
    if listed:
        roots += [x[9:] for x in git("worktree", "list", "--porcelain", "-z", cwd=ROOT).split("\0") if x.startswith("worktree /")]
    return list(dict.fromkeys(roots))

def safe_git() -> tuple[str, dict[str, str]]:
    """(git, environment) of the supervisor's git calls: bridge_wt's pinned ones, before that (unverified runtime) the first git on
    the absolute PATH entries outside every checkout of this repo, whose REAL path is outside every checkout too (a symlink into
    one is skipped); none found: `/nonexistent-roster/git` (never the bare name)."""
    w = _MODS.get("bridge_wt")
    if w is not None and w.PINNED["path"] is not None:
        return w.tool("git"), w.clean_env()
    roots = [x for r in checkout_roots() for x in (r, os.path.realpath(r))]
    bad = lambda c: any(x == r or x.startswith(r + os.sep) for r in roots for x in (os.path.abspath(c), os.path.realpath(c)))  # noqa: E731
    path = os.pathsep.join(d for d in os.environ.get("PATH", "").split(os.pathsep) if os.path.isabs(d) and not bad(d)) or "/usr/bin:/bin"
    exe = next((c for d in path.split(os.pathsep) if os.path.isfile(c := os.path.join(d, "git")) and os.access(c, os.X_OK) and not bad(c)), UNRUNNABLE + "/git")
    return exe, {**os.environ, "PATH": path}

def run_git(args: list[str], **kw: Any) -> subprocess.CompletedProcess[Any]:
    return subprocess.run([(sg := safe_git())[0], *args], env=sg[1], **kw)

def pin(workdir: Path, extra: tuple[Path, ...] = ()) -> None:
    w = module("bridge_wt")  # resolve git, ps, claude and codex on a PATH without any directory a child can write (every checkout of the repo included)
    roots = [Path(r) for r in checkout_roots(True)]
    try:
        w.pin_tools([ROOT, workdir, *roots], [ROOT, workdir, *roots, *extra])
    except w.SeedError as e:
        raise Refused(str(e))


def git(*args: str, cwd: Path) -> str:
    if safe_git()[0].startswith(UNRUNNABLE + "/"):
        raise Refused("cannot find a trusted git (no git on a PATH entry outside the checkouts of this repository)")
    try:
        r = run_git(["-C", str(cwd), *args], capture_output=True, text=True)
    except OSError as e:
        raise Refused(f"cannot run git: {e}")
    return r.stdout.strip() if r.returncode == 0 else ""


def common_dir(path: Path) -> str:
    out = git("rev-parse", "--path-format=absolute", "--git-common-dir", cwd=path)
    return os.path.realpath(out) if out else ""


def validate_dir(arg: str | None, role: dict[str, Any]) -> Path:
    """A work tree listed by `git worktree list`; a `worktree` role needs an explicit `dir:` naming a linked one (bridge_io)."""
    try:
        return bio().validate_dir(arg, role, ROOT, git("worktree", "list", "--porcelain", "-z", cwd=ROOT))
    except ValueError as e:
        raise Refused(str(e))


def read_request(arg: str) -> tuple[Path, str | None, str]:
    """(path, dir or None, task) of task-<role>-<16 hex>.md directly inside .agents/roster/tmp (bridge_io.request: the message
    names the form and says whether the invalid file was deleted)."""
    try:
        return bio().request(arg, TMP, REQUEST)
    except ValueError as e:
        raise Refused(str(e))


# ------------------------------------------------------------------ runs
def writer_lock(workdir: Path) -> int:
    """Exclusive flock for the work dir, in the shared git common dir; the fd stays in the supervisor (close_fds for the CLI)."""
    try:
        return bio().writer_lock(private_dir(state_base() / "locks"), workdir)
    except BlockingIOError:
        raise Refused(f"another writer is already running in {workdir}; wait for it to finish", EXIT_LOCKED)
    except OSError as e:
        raise Refused(f"cannot open the writer lock: {e}")


def install_lock() -> int:
    """Shared, non-blocking flock on locks/install.lock (exit 4 while an install holds it), held from before the runtime
    is verified until the supervisor has recorded its status; -1 when a sandboxed session may not open it. Only code
    of this file runs here."""
    path = private_dir(state_base() / "locks") / "install.lock"
    try:
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        except FileNotFoundError:
            fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    except OSError as e:
        if e.errno in (errno.EPERM, errno.EACCES, errno.EROFS):
            return -1
        raise Refused(f"cannot open the install lock: {e.strerror}")
    try:
        fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
    except OSError:
        os.close(fd)
        raise Refused("an install is in progress; retry when it finishes", EXIT_LOCKED)
    return fd


def start(role_name: str, task_arg: str) -> str:
    """Take the shared install lock, verify and load the runtime, then start the run; returns the run id."""
    try:
        install_fd = install_lock()
    except Refused as e:
        if e.code == EXIT_REFUSED:
            verify_runtime()  # a symlinked or foreign copy has no usable git dir: report the tampering (exit 6) first
        raise
    run_id = ""
    try:
        verified = verify_runtime()
        load_all(verified)
        role = role_settings(load_facts(verified["facts.json"]), role_name)
        if role["target"] == "claude" and (install_fd < 0 or sandboxed_codex_parent()):  # Codex -> Claude needs a full-access Codex session
            raise Refused(SANDBOXED_MSG, EXIT_SANDBOXED)
        if install_fd < 0:
            raise Refused("cannot open the install lock (a write was refused)")
        run_id = launch(role, task_arg, install_fd)
    finally:
        if install_fd >= 0:
            os.close(install_fd)  # the supervisor keeps its own copy of the open lock
    return run_id


def launch(role: dict[str, Any], task_arg: str, install_fd: int) -> str:
    runtime_dirs()
    runs = private_dir(state_base() / "runs")
    req, dir_arg, task = read_request(task_arg)
    pin(Path(os.path.realpath(os.path.join(ROOT, dir_arg))) if dir_arg and "\0" not in dir_arg else ROOT)  # before any more git runs
    workdir = validate_dir(dir_arg, role)
    instr = role_instructions(role)
    mcp = mcp_config(role) if role["target"] == "claude" else ""
    bio().prune(runs, TMP, RUN_ID, KEEP_DAYS, TASK_DAYS)
    module("bridge_arch").prune(state_base() / "changes")  # archives of runs that ended applied, after 7 days; never any other
    codex = role["target"] == "codex"
    writer_fd = writer_lock(workdir) if role["locked"] and not codex else -1  # a Codex writer locks the target only while applying
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + secrets.token_hex(4)
    run, codex_tmp, wt, forked = runs / run_id, None, None, False
    try:
        run.mkdir(mode=0o700)
        try:
            spec = policy().discover(workdir, None, not role["edits_control"]) if codex else {}
        except policy().ConfigError as e:
            raise Refused(str(e))
        if codex:  # the child never gets the target's checkout: a seeded private worktree (over the size cap the child never starts)
            try:
                wt = module("bridge_wt").create(workdir, run_id, run, spec, [ROOT, workdir, Path(common_dir(ROOT) or ROOT)])
            except (ValueError, OSError) as e:  # a size cap, a git failure or an unreadable/unwritable path: nothing has started
                raise Refused(f"{e}; refusing to run")
        (run / "tmp").mkdir(mode=0o700)
        (run / "task.md").write_text(task, encoding="utf-8")
        os.unlink(req)
        (run / "role.md").write_text(instr + "\n", encoding="utf-8")
        stdin_text = f"{LEAF_NOTICE}{instr}\n\n## Task\n\n{task}\n" if codex else task
        (run / "prompt.md").write_text(stdin_text, encoding="utf-8")
        tmpdir = run / "tmp"
        if not codex:
            with os.fdopen(os.open(run / "mcp.json", os.O_CREAT | os.O_WRONLY | os.O_EXCL | os.O_NOFOLLOW, 0o600), "w") as f:
                f.write(mcp)
        else:
            try:
                codex_tmp = tmpdir = run_mod().codex_tmp_dir([ROOT, workdir, wt.path, Path(common_dir(ROOT) or ROOT)])
            except ValueError as e:
                raise Refused(str(e))
            (run / "codex-tmp").write_text(str(codex_tmp) + "\n", encoding="utf-8")
        pin(workdir, (run, *([codex_tmp, wt.path, *map(Path, wt.roots)] if wt and codex_tmp else [])))  # now with every directory the child can write
        env = policy().child_env(os.environ, str(tmpdir), role["target"])  # allowlist only: no CLAUDE*, tokens of the other CLI, ...
        bases = [ROOT] if workdir == ROOT else [ROOT, workdir]  # protected paths of the checkout the bridge runs from and of the work dir
        try:
            control = () if codex or role["edits_control"] else tuple(p for b in bases for p in policy().control_paths(b, workdir))
        except policy().ConfigError as e:
            raise Refused(str(e))
        creds = () if codex else tuple(policy().credential_paths(Path.home()))
        reads = ((), ()) if codex else policy().home_reads(Path.home(), workdir, ROOT, common_dir(ROOT) or None)  # the whole home unreadable for the child's commands
        argv = build_argv(role, wt.path if wt else workdir, run / "out.txt", run / "role.md", codex_tmp, control,
                          not codex and policy().claude_restricted(), creds, tuple(wt.roots) if wt else (), reads)
        argv[0] = module("bridge_wt").tool(argv[0])  # a CLI not on the trusted PATH is `/nonexistent-roster/<name>`, never looked up elsewhere: "cannot find a trusted <name>", exit code 127
        alive_fd = os.open(run / "alive.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        fcntl.flock(alive_fd, fcntl.LOCK_EX)  # taken before the fork so the child owns it from its first instant
        bio().atomic_json(run / "status.json", {"state": "running", "role": role["name"]})
        print(f"RUN-ID {run_id}", flush=True)
        forked = True
        finish = None
        if wt is not None:  # collect and apply the child's changes (writer levels), then remove the private worktree
            locks = state_base() / "locks"
            finish = lambda stopped: module("bridge_xfer").finish(wt, spec, not role["edits_control"], role["locked"], run, lambda: bio().writer_lock(locks, workdir), stopped)  # noqa: E731
        if os.fork() == 0:
            run_mod().supervise(run, argv, wt.path if wt else workdir, env, finish, codex_tmp, role["max_minutes"], policy().STALL_SECONDS,
                                writer_fd, install_fd, bio().atomic_json)
        os.close(alive_fd)  # the child's copy of the open file keeps the flock
    except BaseException:
        if not forked:
            if wt is not None:
                module("bridge_wt").remove(wt)
            if codex_tmp is not None:
                shutil.rmtree(codex_tmp, ignore_errors=True)
            shutil.rmtree(run, ignore_errors=True)
        raise
    finally:
        if writer_fd >= 0:
            os.close(writer_fd)
    return run_id


def run_mod() -> types.ModuleType:
    return module("bridge_run")


def report(run_id: str, seconds: float) -> int:
    return run_mod().report(state_base() / "runs" / run_id, run_id, seconds)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Run a bridged roster role on the other provider's CLI.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("role")
    r.add_argument("--task-file", required=True)
    w = sub.add_parser("wait")
    w.add_argument("run_id")
    for p in (r, w):
        p.add_argument("--wait-seconds", type=float, default=100)
    args = ap.parse_args(argv)
    try:
        if args.cmd == "run":
            run_id = start(args.role, args.task_file)
        else:
            load_all(verify_runtime())
            run_id = args.run_id
            runtime_dirs()
            run = state_base() / "runs" / run_id
            if not RUN_ID.match(run_id) or not run.is_dir() or run.is_symlink():
                raise Refused(f"unknown run-id {run_id!r}")
        return report(run_id, args.wait_seconds)
    except (Refused, OSError) as e:  # an OSError (unreadable path, full disk, ...) is a refusal with the path, never a traceback
        code = e.code if isinstance(e, Refused) else EXIT_REFUSED
        print(f"bridge: {e}", file=sys.stderr)
        print(f"exit code: {code}")
        return code


if __name__ == "__main__":
    sys.exit(main())
