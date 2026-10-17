"""Private worktree of a Codex child (installed as .agents/roster/bridge_wt.py). Stdlib only.

A Codex sandbox cannot deny sub-paths, so a Codex child with a writable sandbox in the parent's checkout could always
touch control files. Instead the child never gets the parent's checkout: for every Codex run the bridge adds a linked
worktree `<system temp>/roster-wt-<run-id>-<random>` at the target's HEAD (`create`; outside the repo and outside every
`.git` directory, because Vite and other tools refuse to load files below a `.git` path), seeds it with the target's
uncommitted state, links the target's ignored top-level directories (node_modules, .venv, ...) into it and runs the
child there. The seed and everything else here use git PLUMBING only (`diff-index`, `ls-files`, `read-tree`,
`hash-object`, `update-index`, `write-tree`, `commit-tree`; never `diff`, `apply` or `commit`), always through `git()`:
hooks, fsmonitor, color, prefix and quoting settings are pinned, GIT_* variables are dropped and the system config is
not read, so a user's ~/.gitconfig cannot change a result (the eol settings are NOT pinned: files are seeded with their
exact bytes, and the base of an unchanged file is read in the working-tree form the user's own config produces). Once the seed
is recorded, `filter_pins` names every filter driver (git config and the seed tree's attributes): every later git call that works in the
worktree is prefixed with `wt.pins`, which empties the clean, smudge and process commands, so no program the child may have rewritten
runs in the supervisor. For the same reason `pin_tools` resolves git, ps, claude and codex to absolute paths on a PATH cleaned of every entry a child can write, and every supervisor subprocess gets that PATH. bridge_xfer.py collects the child's changes and applies them
per file; this module also owns `protected` and `remove`. bridge.py executes this file's bytes only after they match
the trust anchor."""
from __future__ import annotations

import os
import re
import shutil
import stat
import subprocess
import tempfile
import unicodedata
from pathlib import Path
from typing import Any

SEED_CAP = 200_000_000  # bytes of uncommitted state copied into the private worktree
NESTED_LIMIT = 500_000  # directory entries inspected when looking for a nested .git below an ignored directory
PREFIX = "roster-wt-"  # basename prefix of every private worktree directory (the installer finds stale ones by it)
NESTED_DIRS = (".claude", ".codex", ".agents")  # a path component of this name, at any depth, is a control tree (same as bridge_ctl)
GIT_ANY = (".git", ".gitattributes", ".gitmodules")  # protected at ANY depth (`.git`: file or directory, and everything under it); bridge_policy denies the same names to a Claude child
NESTED_FILES = ("claude.md", "claude.local.md", "agents.md", "agents.override.md", ".mcp.json")  # normalized (norm): control files at any depth
ALWAYS = (".agents/roster", ".agents/agent-roster.lock.json")  # never applied, whatever `edits_control_files` says
ZERO = "0" * 40
HARD = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "color.ui=never", "-c", "diff.noprefix=false",
        "-c", "core.quotePath=false", "-c", "commit.gpgsign=false", "-c", "diff.external="]
ATTR_FILTER = re.compile(r"(?:^|[ \t])filter=(\S+)")  # a `filter=<name>` attribute on a .gitattributes line
ATTR_CAP = 1_000_000  # bytes read from one attributes file
ATTR_FILES = 2000  # .gitattributes files read from the seed tree
IDENT = {"GIT_AUTHOR_NAME": "agent-roster", "GIT_AUTHOR_EMAIL": "agent-roster@localhost", "GIT_AUTHOR_DATE": "@0 +0000",
         "GIT_COMMITTER_NAME": "agent-roster", "GIT_COMMITTER_EMAIL": "agent-roster@localhost", "GIT_COMMITTER_DATE": "@0 +0000"}


class SeedError(ValueError):
    """The private worktree cannot be created or seeded, or its changes are over the cap (the bridge refuses, exit 2)."""


class CapError(SeedError):
    """A size cap was exceeded (the seed, or the child's changes with their bases; the only SeedError the bridge refuses
    for after the child ran: any other SeedError while collecting is an error, exit 11)."""


class Worktree:
    """A private worktree: `path`, the `target` it was made from, its git dir, the seed commit and tree ids, the names of
    the symlinks to the target's ignored directories (`links`), their real paths (`roots`: extra writable roots for
    the child), the paths whose exact bytes were copied from the target (`seeded`) and the paths that were not copied or
    linked (`skipped`). A plain class: this module is executed from
    bytes, outside sys.modules."""

    def __init__(self, path: Path, target: Path) -> None:
        self.path, self.target, self.gitdir, self.base_tree, self.seed_commit = path, target, "", "", ""
        self.links: list[str] = []
        self.exclude = ""  # the per-run exclude file naming the links (core.excludesFile of every collection)
        self.roots: list[str] = []
        self.skipped: list[str] = []
        self.skipped_tracked: list[str] = []  # tracked paths whose current target bytes could not be copied: the child sees HEAD's version, so its changes there are never applied
        self.held: list[Any] = []  # type-change Changes found by bridge_xfer.collect (archived, never applied)
        self.unreadable: list[str] = []  # changed paths dropped because they are in skipped_tracked
        self.seeded: set[str] = set()
        self.pins: list[str] = []  # `-c` options that switch off every filter driver (filter_pins); prefix of every git call that works in `path`


LIBRARY = globals().get("LIBRARY", False)  # True for a module read from disk by a library user (bridge.module without bytes) or imported plainly
try:
    T = load("bridge_tools")  # type: ignore[name-defined]  # noqa: F821 - injected by bridge.module (the verified bytes)
except NameError:  # imported as a plain module (tests, the skill's own tooling)
    import bridge_tools as T
    LIBRARY = True
if LIBRARY and not T.PINNED["tools"]:  # library use only (the runtime, loaded from verified bytes, never gets here): pin once on the caller's PATH
    try:
        T.PINNED["path"], T.PINNED["tools"] = T.resolve(T.PROGRAMS, [], [])
    except LookupError:
        pass
PROGRAMS, PINNED, UNRUNNABLE, inside_any, clean_path, find_tool, clean_env, tool = T.PROGRAMS, T.PINNED, T.UNRUNNABLE, T.inside_any, T.clean_path, T.find_tool, T.clean_env, T.tool


def pin_tools(targets: list[Path], forbidden: list[Path | str]) -> None:
    """Resolve PROGRAMS to absolute paths (bridge_tools.resolve) on a PATH from which every entry a child can write is removed:
    relative and empty entries, entries inside `forbidden` (the repo, work dir, private worktree, its writable roots, run and Codex
    temp dirs) and inside the ignored top-level entries of each target (`.venv`, `node_modules`, ...; a symlink there counts by where
    it points); a program whose real path is inside one of them is skipped. Call again when `forbidden` grows. SeedError when
    there is no git. Nothing the child wrote can then be run as git or ps."""
    try:
        PINNED["path"], PINNED["tools"] = T.resolve(PROGRAMS, list(targets), list(forbidden))
    except LookupError as e:
        raise SeedError(str(e))


def git_argv(args: list[str], ident: bool = False) -> tuple[list[str], dict[str, str]]:
    """(argv, environment) of `git <HARD> <args>`: git is the pinned absolute path, the environment is clean_env() with the
    system config off and, for `ident`, a fixed author/committer (commit-tree)."""
    env = clean_env()
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    if ident:
        env.update(IDENT)
    return [tool("git"), *HARD, *args], env


def git(args: list[str], cwd: Path | None = None, data: bytes | None = None, ident: bool = False) -> subprocess.CompletedProcess[bytes]:
    """Run `git <HARD> <args>` (argument list, no shell; see git_argv) and collect its output."""
    argv, env = git_argv(args, ident)
    return subprocess.run(argv, cwd=cwd, env=env, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def norm(p: str) -> str:
    """Case- and normalization-insensitive form of a path (macOS volumes are both)."""
    return unicodedata.normalize("NFC", p).casefold()


def protected(rel: str, spec: dict[str, list[str]], control: bool = True) -> bool:
    """True when the repo-relative `rel` must never be applied to the target: anything named `.git*` at the top or
    `.git`/`.gitattributes`/`.gitmodules` at any depth, `.agents/roster/` and the roster lock file always; with `control`
    also any path with a `.agents`, `.codex` or `.claude` component at any depth, any file named `CLAUDE.md`,
    `CLAUDE.local.md`, `AGENTS.md`, `AGENTS.override.md`, `.mcp.json` or a `project_doc_fallback_filenames` entry (spec["names"], normalized) at any depth, and the discovered control files and
    trees (bridge_policy.discover)."""
    n = norm(rel)
    parts = n.split("/")
    if parts[0].startswith(".git") or GIT_ANY[0] in parts or parts[-1] in GIT_ANY:
        return True
    if any(n == a or n.startswith(a + "/") for a in ALWAYS):
        return True
    if not control:
        return False
    if any(c in NESTED_DIRS for c in parts) or parts[-1] in NESTED_FILES or parts[-1] in spec.get("names", ()):  # names: project_doc_fallback_filenames
        return True
    return any(n == norm(f) for f in spec["files"]) or any(n == (q := norm(t)) or n.startswith(q + "/") for t in spec["trees"])


def overlaps(rel: str, spec: dict[str, list[str]]) -> bool:
    """True when the directory `rel` is, contains or lies inside a protected path."""
    n = norm(rel)
    if protected(rel, spec):
        return True
    return any((q := norm(p)) == n or q.startswith(n + "/") for p in [*spec["files"], *spec["trees"]])


def paths_of(raw: bytes) -> list[str]:
    return [os.fsdecode(x) for x in raw.split(b"\0") if x]


def exclude_pattern(name: str) -> str:
    """The gitignore line that matches exactly the top-level entry `name` (file, directory or symlink): anchored, no
    trailing slash (which would match directories only, never a symlink), glob metacharacters and a leading `#`/`!`
    backslash-escaped, a trailing space protected."""
    esc = "".join("\\" + c if c in "*?[]\\" else c for c in name)
    if esc[:1] in ("#", "!"):
        esc = "\\" + esc
    if esc.endswith(" "):
        esc = esc[:-1] + "\\ "
    return "/" + esc


def fail(what: str, r: subprocess.CompletedProcess[bytes]) -> SeedError:
    return SeedError(f"{what}: {r.stderr.decode('utf-8', 'replace').strip()[:300]}")


def _read_cap(path: str) -> str:
    try:
        with open(path, "rb") as f:
            return f.read(ATTR_CAP).decode("utf-8", "replace")
    except OSError:
        return ""


def _tree_attributes(gitdir: str, tree: str) -> list[str]:
    """Texts of the `.gitattributes` files of the seed `tree` (blobs; at most ATTR_FILES of at most ATTR_CAP bytes each)."""
    r = git(["--git-dir", gitdir, "ls-tree", "-r", "-l", "-z", "--full-tree", tree])
    oids = []
    for rec in r.stdout.split(b"\0") if r.returncode == 0 else []:
        head, _, name = rec.partition(b"\t")
        f = head.split()
        if name.rsplit(b"/", 1)[-1] == b".gitattributes" and len(f) == 4 and f[0] in (b"100644", b"100755") and f[3].isdigit() and int(f[3]) <= ATTR_CAP:
            oids.append(f[2].decode())
    texts = []
    if oids[:ATTR_FILES]:
        out = git(["--git-dir", gitdir, "cat-file", "--batch"], data="".join(f"{o}\n" for o in oids[:ATTR_FILES]).encode()).stdout
        pos = 0
        while pos < len(out):
            end = out.find(b"\n", pos)
            head = out[pos:end].split(b" ") if end >= 0 else []
            if len(head) != 3 or not head[2].isdigit():
                break
            texts.append(out[end + 1:end + 1 + int(head[2])].decode("utf-8", "replace"))
            pos = end + 2 + int(head[2])
    return texts


def filter_pins(target: Path, gitdir: str, tree: str) -> list[str]:
    """`-c` options that disable EVERY filter driver (clean, smudge, process; `required=false`): the names come from the
    configuration git itself reads for the target (`git config --get-regexp ^filter\\.`, all scopes this wrapper reads)
    and from every `filter=<name>` attribute of the seed tree's `.gitattributes` files, `info/attributes` and the global
    attributes file. Git then runs no program for a path of the private worktree: a driver command such as `./clean.sh`
    resolves in the worktree, where the child may have rewritten it. SeedError for a name that cannot be set with `-c`."""
    names: set[str] = set()
    r = git(["-C", str(target), "config", "--get-regexp", "-z", r"^filter\."])
    for rec in r.stdout.split(b"\0") if r.returncode == 0 else []:
        key = rec.partition(b"\n")[0].decode("utf-8", "replace").split(".")
        if len(key) >= 3:
            names.add(".".join(key[1:-1]))
    texts = _tree_attributes(gitdir, tree)
    for args in (["rev-parse", "--path-format=absolute", "--git-path", "info/attributes"], ["config", "--type=path", "--get", "core.attributesFile"]):
        c = git(["-C", str(target), *args])
        if c.returncode == 0 and c.stdout.strip():
            texts.append(_read_cap(c.stdout.decode("utf-8", "replace").strip()))
    texts.append(_read_cap(os.path.join(os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config"), "git", "attributes")))
    for text in texts:
        for line in text.splitlines():
            if not line.lstrip().startswith("#"):
                names.update(ATTR_FILTER.findall(line))
    pins: list[str] = []
    for n in sorted(names):
        if any(c in n for c in "=\n\0"):
            raise SeedError(f"the filter driver name {n!r} cannot be disabled; refusing to run")
        pins += ["-c", f"filter.{n}.clean=", "-c", f"filter.{n}.smudge=", "-c", f"filter.{n}.process=", "-c", f"filter.{n}.required=false"]
    return pins


def outside(path: str, link: str) -> bool:
    """True when a symlink at repo-relative `path` pointing at `link` leaves the repo (or is absolute)."""
    return os.path.isabs(link) or os.path.normpath(os.path.join(os.path.dirname(path), link)).startswith("..")


def nested_git(root: str) -> bool:
    """True when a `.git` entry exists anywhere below the directory `root` (no symlink is followed), or it is too big to tell."""
    seen = 0
    for _, dirs, files in os.walk(root):
        if ".git" in dirs or ".git" in files:
            return True
        seen += len(dirs) + len(files)
        if seen > NESTED_LIMIT:
            return True
    return False


# ------------------------------------------------------------------ create
def _plain_dirs(root: Path, parent: str, create: bool) -> bool:
    """True when every directory component of `parent` below `root` is a real directory (made when `create`); a symlink
    or a non-directory anywhere on the way is False."""
    cur = root
    for part in [x for x in parent.split("/") if x]:
        cur = cur / part
        try:
            if create and not os.path.lexists(cur):
                os.mkdir(cur)
            if not stat.S_ISDIR(os.lstat(cur).st_mode):
                return False
        except OSError:
            return False
    return True


def _copy_one(src: Path, dst: Path, st: os.stat_result) -> None:
    fd = os.open(src, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    try:
        out = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o755 if st.st_mode & 0o111 else 0o644)
        try:
            while chunk := os.read(fd, 1 << 20):
                os.write(out, chunk)
        finally:
            os.close(out)
    finally:
        os.close(fd)


def argv_chunks(items: list[str], limit: int = 60_000, count: int = 1000) -> list[list[str]]:
    """`items` in consecutive groups whose argv stays far below ARG_MAX (at most `limit` bytes and `count` entries per group);
    path lists go to git as arguments (after `--`), never as line-based standard input."""
    groups: list[list[str]] = []
    size = 0
    for x in items:
        n = len(os.fsencode(x)) + 1
        if not groups or size + n > limit or len(groups[-1]) >= count:
            groups.append([])
            size = 0
        groups[-1].append(x)
        size += n
    return groups


def _seed_paths(t: Path) -> tuple[list[str], list[str]]:
    """(paths whose state differs from HEAD or is untracked in the target, nested-repository entries that are not seeded),
    by plumbing: `diff-index --raw` (staged additions included, even ignored ones) and `ls-files --others`."""
    r = git(["-C", str(t), "diff-index", "-z", "--raw", "--no-renames", "HEAD"])
    if r.returncode:
        raise fail("cannot read the target's uncommitted changes", r)
    toks, paths, skip = r.stdout.split(b"\0"), set[str](), list[str]()
    for meta, raw in zip(toks[0::2], toks[1::2]):
        if "160000" in meta.decode().lstrip(":").split(" ")[:2]:
            skip.append(os.fsdecode(raw))
        else:
            paths.add(os.fsdecode(raw))
    r = git(["-C", str(t), "ls-files", "-z", "--others", "--exclude-standard"])
    if r.returncode:
        raise fail("cannot list the target's untracked files", r)
    for x in paths_of(r.stdout):
        if x.endswith("/"):
            skip.append(x)
        else:
            paths.add(x)
    return sorted(paths), skip


def _seed(wt: Worktree, run: Path, spec: dict[str, list[str]]) -> None:
    t, p = wt.target, wt.path
    r = git(["-C", str(p), "rev-parse", "--absolute-git-dir"])
    if r.returncode:
        raise fail("cannot read the private worktree's git dir", r)
    wt.gitdir = r.stdout.decode().strip()
    g = ["--git-dir", wt.gitdir, "--work-tree", str(p)]
    paths, wt.skipped = _seed_paths(t)
    plan: list[tuple[str, str, str]] = []  # (path, kind, symlink text) with kind file | link | gone
    used = 0
    for rel in paths:  # one pass over the target: classify and total the sizes BEFORE anything is hashed
        parts = rel.split("/")
        if "\n" in rel or "" in parts or ".." in parts or "." in parts or rel.startswith("/") or ".git" in parts:
            wt.skipped.append(rel)
            continue
        try:
            st = os.lstat(t / rel)
        except FileNotFoundError:
            plan.append((rel, "gone", ""))
            continue
        except OSError:
            wt.skipped.append(rel)
            continue
        if not _plain_dirs(t, os.path.dirname(rel), False):
            wt.skipped.append(rel)
        elif stat.S_ISLNK(st.st_mode):
            try:
                link = os.readlink(t / rel)
            except OSError:
                wt.skipped.append(rel)
                continue
            (wt.skipped.append(rel) if outside(rel, link) else plan.append((rel, "link", link)))
        elif stat.S_ISREG(st.st_mode):
            used += st.st_size
            if used > SEED_CAP:
                raise CapError(f"the target's uncommitted files are larger than {SEED_CAP // 1_000_000} MB; refusing to run")
            plan.append((rel, "file", ""))
        else:
            wt.skipped.append(rel)
    r = git([*g, "read-tree", "HEAD"], cwd=p)
    if r.returncode:
        raise fail("cannot read HEAD into the private worktree's index", r)
    entries, files = [], []  # index lines and the worktree files to hash
    for rel, kind, link in plan:
        dst = p / rel
        if kind != "gone" and not _plain_dirs(p, os.path.dirname(rel), True):
            wt.skipped.append(rel)
            continue
        existed = os.path.lexists(dst)  # the HEAD checkout of this path
        if existed and os.path.isdir(dst) and not os.path.islink(dst):
            wt.skipped.append(rel)
            continue
        if existed and kind != "file":
            os.unlink(dst)
        if kind == "gone":
            entries.append(f"0 {ZERO}\t{rel}\0")
        elif kind == "link":
            os.symlink(link, dst)
            h = git([*g, "hash-object", "-w", "--no-filters", "--stdin"], cwd=p, data=os.fsencode(link))
            if h.returncode:
                raise fail("cannot record a symlink of the target", h)
            entries.append(f"120000 {h.stdout.decode().strip()}\t{rel}\0")
        else:
            tmp = dst.with_name(f".roster-seed-{len(files)}")  # copied beside dst and renamed over it only when complete: a failure leaves HEAD's file (and the index) as they are
            try:  # an unreadable or vanished entry is reported as skipped, never a failure of the run
                st = os.lstat(t / rel)
                _copy_one(t / rel, tmp, st)
                os.replace(tmp, dst)
            except OSError:
                if os.path.lexists(tmp):
                    os.unlink(tmp)
                wt.skipped.append(rel)
                wt.skipped_tracked += [rel] if existed else []
                continue
            files.append((rel, "100755" if st.st_mode & 0o111 else "100644"))
    if files:
        shas: list[str] = []
        for part in argv_chunks([f for f, _ in files]):  # argv, never a line-based stdin list (it strips a trailing CR and unquotes a leading quote)
            h = git([*g, "hash-object", "-w", "--no-filters", "--", *part], cwd=p)
            shas += h.stdout.decode().split()
            if h.returncode or len(h.stdout.decode().split()) != len(part):
                raise fail("cannot record the target's files", h)
        entries += [f"{mode} {sha}\t{rel}\0" for (rel, mode), sha in zip(files, shas)]
        wt.seeded = {rel for rel, _ in files}  # the blobs hold these paths' exact bytes (no clean filter ran)
    if entries:
        u = git([*g, "update-index", "-z", "--add", "--remove", "--index-info"], cwd=p, data="".join(entries).encode("utf-8", "surrogateescape"))
        if u.returncode:
            raise fail("cannot register the target's uncommitted state", u)
    git([*g, "update-index", "-q", "--refresh"], cwd=p)  # stat data for the checked-out files: a later `ls-files --modified` is fast
    r = git([*g, "write-tree"], cwd=p)
    if r.returncode:
        raise fail("cannot record the seeded private worktree", r)
    wt.base_tree = r.stdout.decode().strip()
    wt.pins = filter_pins(t, wt.gitdir, wt.base_tree)  # from here on the child's bytes are in the worktree: no filter driver may run there
    r = git([*g, "commit-tree", wt.base_tree, "-p", "HEAD", "-m", "agent-roster seed"], cwd=p, ident=True)
    if r.returncode:
        raise fail("cannot commit the seed state", r)
    wt.seed_commit = r.stdout.decode().strip()
    _link_ignored(wt, run, spec)


def _link_ignored(wt: Worktree, run: Path, spec: dict[str, list[str]]) -> None:
    """Symlink the target's ignored top-level directories (node_modules, .venv, ...) into the worktree, except protected
    ones, ones holding a registered worktree or any nested `.git`, and anything that is not a real directory."""
    t, p = wt.target, wt.path
    r = git(["-C", str(t), "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"])
    for ent in paths_of(r.stdout) if r.returncode == 0 else []:
        name = ent[:-1]
        if not ent.endswith("/") or "/" in name or "\n" in name or os.path.lexists(p / name):
            continue
        real = t / name
        if not stat.S_ISDIR(os.lstat(real).st_mode):
            continue
        if overlaps(name, spec) or nested_git(str(real)):
            wt.skipped.append(name + "/")
            continue
        os.symlink(real, p / name)
        wt.links.append(name)
        wt.roots.append(os.path.realpath(real))
    wt.exclude = str(run.resolve() / "seed-exclude")
    Path(wt.exclude).write_text("".join(exclude_pattern(n) + "\n" for n in wt.links), encoding="utf-8")


def create(target: Path, run_id: str, run: Path, spec: dict[str, list[str]], forbidden: list[Path]) -> Worktree:
    """The seeded private worktree for `target`: a fresh 0700 directory `<system temp>/roster-wt-<run_id>-<random>`
    (never inside one of `forbidden`: the repo, work dir and git dir). SeedError, with everything already created
    removed, when it cannot be made or the seed exceeds SEED_CAP."""
    path = Path(os.path.realpath(tempfile.mkdtemp(prefix=f"{PREFIX}{run_id}-")))
    if any(path == f or f in path.parents for f in (Path(os.path.realpath(x)) for x in forbidden)):
        shutil.rmtree(path, ignore_errors=True)
        raise SeedError(f"the system temp dir {path.parent} is inside the repo or git dir; set TMPDIR outside it")
    wt = Worktree(path, target)
    r = git(["-C", str(target), "worktree", "add", "--detach", "--quiet", str(path), "HEAD"])  # an empty existing directory is fine
    if r.returncode:
        shutil.rmtree(path, ignore_errors=True)
        raise fail("cannot create the private worktree for the Codex child (does the repo have a commit?)", r)
    try:
        _seed(wt, run, spec)
    except BaseException:
        remove(wt)
        raise
    return wt


# ------------------------------------------------------------------ remove
def remove(wt: Worktree) -> bool:
    """Remove the private worktree (the links to ignored directories are unlinked first and never followed). True when
    it is gone; on failure it is left in place for the installer's housekeeping. Only a real directory named
    `roster-wt-*` is ever touched."""
    if not wt.path.name.startswith(PREFIX) or wt.path.is_symlink():
        return False
    for n in wt.links:
        if os.path.islink(wt.path / n):
            os.unlink(wt.path / n)
    if wt.gitdir:  # the child may have rewritten or replaced the `.git` file, which would make git refuse to remove the worktree
        try:
            dot = wt.path / ".git"
            if os.path.isdir(dot) and not os.path.islink(dot):
                shutil.rmtree(dot)
            elif os.path.lexists(dot):
                os.unlink(dot)
            fd = os.open(dot, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o644)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(f"gitdir: {wt.gitdir}\n")
        except OSError:
            pass
    git(["-C", str(wt.target), "worktree", "remove", "--force", str(wt.path)])
    return not os.path.lexists(wt.path)
