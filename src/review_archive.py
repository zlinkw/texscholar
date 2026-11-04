#!/usr/bin/env python3
"""Local review-chain ZIP backup/restore. No remote, source, HEAD or real-index writes.

Native backup includes current paper sources/assets, embedded state, immutable local
review objects and selected extra files, without Git. Legacy schema-1 archives also
preserve tracked working/index/deleted state and Git history. No credentials/config.
Restore requires an absent destination; archives are private local data, not uploads.
"""
import argparse
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import uuid
import zipfile

from source_review import Review, Conflict, digest
from review_checkpoint import referenced_objects


def safe_name(name):
    p = PurePosixPath(name)
    if (not name or p.is_absolute() or p.as_posix() != name or
            any(x in ("", ".", "..") or x.endswith((" ", ".")) or ":" in x or
                re.match(r"(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)", x)
                for x in p.parts) or
            any(x.lower() == ".git" for x in p.parts) or
            any(c in name for c in "\\\x00\r\n")):
        raise Conflict("Unsafe archive/source path: " + name)
    return name


def plain_file(root, name, missing=False):
    safe_name(name)
    p = root / name
    cur = p
    while cur != root:
        if cur.is_symlink() or (hasattr(cur, "is_junction") and cur.is_junction()):
            raise Conflict("Links/junctions are not supported: " + name)
        cur = cur.parent
    if not p.exists() and missing:
        return None
    if not p.is_file() or not p.resolve().is_relative_to(root):
        raise Conflict("Expected confined regular file: " + name)
    return p


def refs(r):
    return r.git("for-each-ref", "--format=%(refname) %(objectname)").decode().splitlines()


def make_index_commit(r, entries):
    tree = {}
    for mode, oid, name in entries:
        node = tree
        parts = name.split("/")
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = (mode, oid)
    def build(node):
        rows = []
        for name, item in sorted(node.items()):
            mode, typ, oid = ("040000", "tree", build(item)) if isinstance(item, dict) else (item[0], "blob", item[1])
            rows.append(f"{mode} {typ} {oid}\t{name}".encode("utf-8") + b"\0")
        return r.git("mktree", "-z", data=b"".join(rows)).decode().strip()
    oid = r.git("commit-tree", build(tree), "-m", "Local review backup staging snapshot").decode().strip()
    r.git("update-ref", "refs/codex-backup/" + uuid.uuid4().hex[:16], oid, "0" * len(oid))
    return oid


def backup(repo, state, output, git="git", extras=()):
    r = Review(repo, state, git)
    r.assert_ready()
    # Read each generation, not just the current payload: any missing object blocks backup.
    for e in r.state["edits"].values():
        for v in e["versions"]:
            r.contents(v, "span.json")
    if r.storage == 'files':
        return backup_files(r, output, extras)
    index_rows = r.git("ls-files", "--stage", "-z")
    index_entries = []
    for row in index_rows.split(b"\0"):
        if not row:
            continue
        meta, raw_name = row.split(b"\t", 1)
        mode, oid, stage = meta.decode().split()
        name = safe_name(raw_name.decode("utf-8"))
        if stage != "0" or mode not in ("100644", "100755"):
            raise Conflict("Resolve unmerged, symlink or submodule index entries before backup")
        index_entries.append((mode, oid, name))
    head_names = {safe_name(n.decode("utf-8")) for n in r.git("ls-tree", "-rz", "--name-only", "HEAD").split(b"\0") if n}
    names = {n for _, _, n in index_entries} | head_names | {r.state_rel} | set(extras)
    for rnd in r.state["rounds"]:
        names.update(rnd["files"])
    files, absent = {}, []
    for name in sorted(names):
        p = plain_file(r.repo, name, missing=True)
        if p is None:
            absent.append(name)
        else:
            files[name] = p.read_bytes()
    if files.get(r.state_rel) != r.raw:
        raise Conflict("Review owner changed during backup")
    status = r.status()
    if any(e.get("source_match") is False for e in status["edits"].values()):
        raise Conflict("Reconcile overlapping manual changes before backing up review state")
    out = Path(output).resolve()
    if out.exists() or out.is_relative_to(r.repo):
        raise Conflict("Use an absent archive path outside the project")
    out.parent.mkdir(parents=True, exist_ok=True)
    stage_commit = make_index_commit(r, index_entries)
    all_refs = refs(r)
    head = r.git("rev-parse", "HEAD").decode().strip()
    proc = subprocess.run([git, "-C", str(r.repo), "symbolic-ref", "-q", "HEAD"], capture_output=True, env=r.env)
    head_ref = proc.stdout.decode().strip() if proc.returncode == 0 else None
    # Detached HEAD needs an explicit reachable ref too.
    if not head_ref:
        r.git("update-ref", "refs/codex-backup/" + uuid.uuid4().hex[:16], head, "0" * len(head))
        all_refs = refs(r)
    gitdir = Path(r.git("rev-parse", "--absolute-git-dir").decode().strip())
    bundle = gitdir / "codex-review" / ("backup-" + uuid.uuid4().hex + ".bundle")
    bundle.parent.mkdir(parents=True, exist_ok=True)
    r.git("bundle", "create", str(bundle), "--all")
    r.git("bundle", "verify", str(bundle))
    if (refs(r) != all_refs or r.git("ls-files", "--stage", "-z") != index_rows or
            r.git("rev-parse", "HEAD").decode().strip() != head):
        raise Conflict("Git state changed during backup; retry after edits stop")
    for name in names:
        p = plain_file(r.repo, name, missing=True)
        if (p.read_bytes() if p else None) != files.get(name):
            raise Conflict("Source changed during backup; retry after edits stop")
    omitted = [n.decode("utf-8") for n in r.git("ls-files", "--others", "--exclude-standard", "-z").split(b"\0") if n and n.decode("utf-8") not in files]
    manifest = {"schema": 1, "type": "codex-review-backup", "state": r.state_rel,
                "object_format": r.git("rev-parse", "--show-object-format").decode().strip(),
                "session": r.state["session"], "head": head, "head_ref": head_ref,
                "index_commit": stage_commit, "refs": all_refs, "absent": absent,
                "files": {n: digest(b) for n, b in files.items()}, "bundle_sha256": digest(bundle.read_bytes()),
                "omitted_untracked": omitted,
                "exclusions": "Ignored/unselected untracked files, Git config, remotes, hooks and credentials. Index contents preserved, index flags/extensions are not portable."}
    with zipfile.ZipFile(out, "x", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"))
        z.write(bundle, "history.bundle")
        for name, data in files.items():
            z.writestr("working/" + name, data)
    return {"archive": str(out), "sha256": digest(out.read_bytes()), "files": len(files),
            "omitted_untracked": omitted, "source_modified": False, "uploaded": False}


def backup_files(r, output, extras):
    """Private review snapshots and paper assets; independent of Git installation."""
    extensions = {'.tex', '.bib', '.cls', '.sty', '.bst', '.bbx', '.cbx', '.cfg', '.def', '.fd',
                  '.map', '.enc', '.tfm', '.otf', '.ttf', '.pdf', '.png', '.jpg', '.jpeg', '.eps', '.svg', '.ps'}
    excluded = {'.git', '.codex-review', '.latex-build', 'clean_dir', 'node_modules'}
    names = {r.state_rel, *extras}
    for folder, directories, leaves in os.walk(r.repo, followlinks=False):
        directories[:] = [name for name in directories if name not in excluded]
        for name in leaves:
            p = Path(folder) / name
            if p.suffix.lower() in extensions:
                names.add(p.relative_to(r.repo).as_posix())
    for oid in referenced_objects(r):
        names.add('.codex-review/objects/' + oid + '.json')
    files = {name: plain_file(r.repo, name).read_bytes() for name in sorted(names)}
    if files[r.state_rel] != r.raw or any(e.get('source_match') is False for e in r.status()['edits'].values()):
        raise Conflict('Reconcile source/review changes before backup')
    out = Path(output).resolve()
    if out.exists() or out.is_relative_to(r.repo):
        raise Conflict('Use an absent archive path outside the project')
    out.parent.mkdir(parents=True, exist_ok=True)
    manifest = {'schema': 2, 'type': 'codex-review-backup', 'state': r.state_rel,
                'session': r.state['session'], 'files': {n: digest(b) for n, b in files.items()},
                'exclusions': 'Git history/config, build outputs, request attachments, caches and unselected non-paper files.'}
    for name, raw in files.items():
        if plain_file(r.repo, name).read_bytes() != raw:
            raise Conflict('Source changed during backup; retry after edits stop')
    with zipfile.ZipFile(out, 'x', zipfile.ZIP_DEFLATED) as z:
        z.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2).encode('utf-8'))
        for name, raw in files.items():
            z.writestr('working/' + name, raw)
    return {'archive': str(out), 'sha256': digest(out.read_bytes()), 'files': len(files),
            'source_modified': False, 'uploaded': False, 'git_required': False}


def restore(archive, destination, git="git"):
    dest = Path(destination).resolve()
    if dest.exists():
        raise Conflict("Restore destination must not exist; never restore over a live paper")
    # Validate every member and hash before creating any destination.
    with zipfile.ZipFile(archive) as z:
        members = z.namelist()
        if len(members) != len(set(n.casefold() for n in members)):
            raise Conflict("Duplicate archive names")
        m = json.loads(z.read("manifest.json"))
        if m.get("schema") not in (1, 2) or m.get("type") != "codex-review-backup":
            raise Conflict("Unsupported backup format")
        if m['schema'] == 2:
            if set(members) != {'manifest.json'} | {'working/' + safe_name(n) for n in m['files']}:
                raise Conflict('Unexpected archive members')
            safe_name(m['state'])
            data = {n: z.read('working/' + n) for n in m['files']}
            if any(digest(raw) != m['files'][n] for n, raw in data.items()):
                raise Conflict('Source/state/object checksum mismatch')
            dest.mkdir(parents=True, exist_ok=False)
            for name, raw in data.items():
                p = dest / name
                p.parent.mkdir(parents=True, exist_ok=True)
                with p.open('xb') as f:
                    f.write(raw)
            review = Review(dest, m['state'], git)
            review.assert_ready()
            status = review.status()
            if review.state['session'] != m['session'] or any(e.get('source_match') is False for e in status['edits'].values()):
                raise Conflict('Restored review identities/source do not reconcile')
            for edit in review.state['edits'].values():
                for version in edit['versions']:
                    review.contents(version, 'span.json')
            return {'restored': str(dest), 'state': m['state'], 'edits': len(status['edits']),
                    'remotes_restored': False, 'git_required': False, 'note': 'No author decisions changed.'}
        if m.get("object_format") not in ("sha1", "sha256"):
            raise Conflict("Unsupported Git object format")
        if set(members) != {"manifest.json", "history.bundle"} | {"working/" + safe_name(n) for n in m["files"]}:
            raise Conflict("Unexpected archive members")
        for n in m["absent"]:
            safe_name(n)
        if set(m["absent"]) & set(m["files"]):
            raise Conflict("A path cannot be both present and absent")
        safe_name(m["state"])
        data = {n: z.read("working/" + n) for n in m["files"]}
        if any(digest(b) != m["files"][n] for n, b in data.items()):
            raise Conflict("Working source/state checksum mismatch")
        bundle = z.read("history.bundle")
        if digest(bundle) != m["bundle_sha256"]:
            raise Conflict("Git bundle checksum mismatch")
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith("GIT_")}
    def g(*args):
        p = subprocess.run([git, "-c", "core.longpaths=true", "-C", str(dest), *args], capture_output=True, env=env)
        if p.returncode:
            raise Conflict(p.stderr.decode("utf-8", "replace"))
        return p.stdout
    dest.mkdir(parents=True, exist_ok=False)
    g("init", "--object-format=" + m["object_format"], "-b", "restore-" + uuid.uuid4().hex[:12])
    bundle_path = dest / ".git" / "review-backup.bundle"
    bundle_path.write_bytes(bundle)
    g("bundle", "verify", str(bundle_path))
    g("fetch", "--no-write-fetch-head", str(bundle_path), "refs/*:refs/*")
    if g("for-each-ref", "--format=%(refname) %(objectname)").decode().splitlines() != m["refs"]:
        raise Conflict("Restored references differ from manifest")
    if m["head_ref"]:
        if not re.fullmatch(r"refs/heads/[^\s]+", m["head_ref"]):
            raise Conflict("Invalid restored branch")
        g("symbolic-ref", "HEAD", m["head_ref"])
    else:
        g("update-ref", "--no-deref", "HEAD", m["head"])
    if g("rev-parse", "HEAD").decode().strip() != m["head"]:
        raise Conflict("Restored HEAD differs from manifest")
    g("read-tree", m["index_commit"])
    for name, raw in data.items():
        p = dest / name
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("xb") as f:
            f.write(raw)
    review = Review(dest, m["state"], git)
    review.assert_ready()
    status = review.status()
    if review.state["session"] != m["session"] or any(e.get("source_match") is False for e in status["edits"].values()):
        raise Conflict("Restored review identities/source do not reconcile")
    return {"restored": str(dest), "state": m["state"], "edits": len(status["edits"]),
            "omitted_untracked": m["omitted_untracked"], "remotes_restored": False,
            "note": "Staged contents restored; index flags/extensions and omitted files require separate verification. No author decisions changed."}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--git", default="git")
    sub = p.add_subparsers(dest="action", required=True)
    b = sub.add_parser("backup")
    b.add_argument("--repo", required=True)
    b.add_argument("--state", required=True)
    b.add_argument("--output", required=True)
    b.add_argument("--extra", nargs="*", default=[])
    r = sub.add_parser("restore")
    r.add_argument("--archive", required=True)
    r.add_argument("--destination", required=True)
    a = p.parse_args()
    result = backup(a.repo, a.state, a.output, a.git, a.extra) if a.action == "backup" else restore(a.archive, a.destination, a.git)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (Conflict, KeyError, ValueError, OSError, zipfile.BadZipFile) as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(2)
