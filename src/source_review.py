#!/usr/bin/env python3
"""Original-source author review. Immutable local snapshots, one embedded state, no index writes.

All mutators preview by default; apply requires the exact SHA256 of the state file.
This is an author-decision ledger and conservative scoped patcher, not a merge tool.
"""
import argparse
import base64
import copy
import difflib
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid
from contextlib import contextmanager, nullcontext

BEGIN = "% CODEX-REVIEW-STATE-BEGIN"
END = "% CODEX-REVIEW-STATE-END"
DATA = "% CODEX-REVIEW-DATA "
PENDING = {"pending", "rework"}


class Conflict(ValueError):
    pass


def digest(data):
    return hashlib.sha256(data).hexdigest()


def letters(n):
    result = ""
    while n:
        n, r = divmod(n - 1, 26)
        result = chr(97 + r) + result
    return result


def word_changes(before, after):
    """Word/punctuation-level spans; equal tokens are never included in markup."""
    pattern = r"\\[A-Za-z@]+|[^\W_]+|_+|\s+|."
    a, b = re.findall(pattern, before, re.S), re.findall(pattern, after, re.S)
    offsets_a, offsets_b = [0], [0]
    for token in a:
        offsets_a.append(offsets_a[-1] + len(token))
    for token in b:
        offsets_b.append(offsets_b[-1] + len(token))
    return [{"kind": tag, "old_start": offsets_a[i], "old_end": offsets_a[j],
             "new_start": offsets_b[k], "new_end": offsets_b[l]}
            for tag, i, j, k, l in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes()
            if tag != "equal"]


def validate_review_unit(text):
    """A new decision cannot combine separate paragraphs or prose and TeX displays."""
    lines = []
    for line in text.splitlines():
        for pos, char in enumerate(line):
            if char != '%':
                continue
            slashes, previous = 0, pos - 1
            while previous >= 0 and line[previous] == '\\':
                slashes += 1
                previous -= 1
            if slashes % 2 == 0:
                line = line[:pos]
                break
        lines.append(line)
    visible = '\n'.join(lines).strip()
    if not visible:
        return
    stack, whole_environment = [], False
    tokens = list(re.finditer(r'\\(begin|end)\{([^{}]+)\}', visible))
    if tokens and tokens[0].start() == 0 and tokens[0][1] == 'begin':
        for token in tokens:
            if token[1] == 'begin':
                stack.append(token[2])
            elif not stack or stack.pop() != token[2]:
                break
            if not stack:
                whole_environment = token.end() == len(visible) and tokens[0][2] in {
                    'equation', 'equation*', 'align', 'align*', 'aligned', 'gather', 'gather*', 'gathered',
                    'multline', 'multline*', 'displaymath', 'math', 'split', 'array',
                    'figure', 'figure*', 'table', 'table*', 'tabular', 'tabular*', 'tabularx',
                    'algorithm', 'algorithm*', 'tikzpicture', 'picture'}
                break
    whole_display = ((visible.startswith(r'\[') and visible.endswith(r'\]') and visible.count(r'\[') == 1)
                     or (visible.startswith('$$') and visible.endswith('$$') and visible.count('$$') == 2))
    if whole_environment or whole_display:
        return
    if re.search(r'\n[ \t]*\n', visible) or re.search(r'\\(?:begin|end)\{|\\par\b|\\\[|\\\]|\$\$', visible):
        raise Conflict('修订范围过大：请优先按句子拆分，最多一个自然段；公式、图表或其他独立环境必须单独编号，不能与前后正文打包。原文和已发编号未改变。')


def split_state(text):
    starts = list(re.finditer(r"(?m)^" + re.escape(BEGIN) + r"(?=\r?$)", text))
    ends = list(re.finditer(r"(?m)^" + re.escape(END) + r"(?=\r?$)", text))
    if len(starts) != 1 or len(ends) != 1 or ends[0].start() < starts[0].start():
        raise Conflict("Exactly one existing canonical CODEX-REVIEW-STATE block is required")
    a = starts[0].start()
    b = ends[0].end()
    # Include the line break after the block; keep all other bytes/lines intact.
    if text[b:b + 2] == "\r\n":
        b += 2
    elif text[b:b + 1] == "\n":
        b += 1
    return text[:a], text[a:b], text[b:]


def body(text):
    if BEGIN in text or END in text:
        a, _, b = split_state(text)
        return a + b
    return text


def locate(text, needle, left="", right=""):
    """Exact text plus contextual anchors, never a saved line number or fuzzy overwrite."""
    hits = []
    start = 0
    while start <= len(text):
        i = text.find(needle, start) if needle else start
        if i < 0:
            break
        left_ok = bool(left) and text[:i].endswith(left)
        right_ok = bool(right) and text[i + len(needle):].startswith(right)
        if (left_ok or right_ok) or (not left and not right):
            hits.append((int(left_ok) + int(right_ok), i))
        start = i + max(1, len(needle))
    if hits:
        score = max(h[0] for h in hits)
        hits = [i for s, i in hits if s == score]
    if len(hits) != 1:
        raise Conflict(f"Exact anchored span is missing or ambiguous ({len(hits)} matches); preserve source and reconcile")
    return hits[0], hits[0] + len(needle)


class Review:
    def __init__(self, repo, state, git="git", storage=None):
        self.repo = Path(repo).resolve(strict=True)
        self.git_exe = git
        self.env = {k: v for k, v in os.environ.items() if not k.upper().startswith("GIT_")}
        self.env.update({"GIT_AUTHOR_NAME": "Codex local review", "GIT_AUTHOR_EMAIL": "review@localhost",
                         "GIT_COMMITTER_NAME": "Codex local review", "GIT_COMMITTER_EMAIL": "review@localhost",
                         "GIT_OPTIONAL_LOCKS": "0"})
        self.state_path = self.path(state)
        self.state_rel = self.state_path.relative_to(self.repo).as_posix()
        self.raw = self.state_path.read_bytes()
        self.text = self.raw.decode("utf-8-sig")
        self.bom = self.raw.startswith(b"\xef\xbb\xbf")
        self.eol = "\r\n" if "\r\n" in self.text else "\n"
        _, block, _ = split_state(self.text)
        counters = re.findall(r"CODEX-REVIEW-NEXT manuscript=([1-9][0-9]*) response=([a-z]+)", block)
        if len(counters) != 1:
            raise Conflict("Exactly one reconciled next-ID counter is required")
        n, alpha = counters[0]
        alpha_value = 0
        for char in alpha:
            alpha_value = alpha_value * 26 + ord(char) - 96
        next_ids = [int(n), alpha_value]
        rows = [line[len(DATA):] for line in block.splitlines() if line.startswith(DATA)]
        if len(rows) > 1:
            raise Conflict("Duplicate machine state")
        self.state = json.loads(rows[0]) if rows else None
        if self.state and self.state.get("schema") not in (1, 2):
            raise Conflict("Unsupported review-state schema")
        self.storage = storage or ("git" if self.state and self.state["schema"] == 1 else "files")
        if self.storage not in ("git", "files"):
            raise Conflict("Unknown review object storage")
        if self.storage == "git":
            root = Path(self.git("rev-parse", "--show-toplevel").decode().strip()).resolve()
            if root != self.repo:
                raise Conflict("Use the verified legacy repository root")
        self.object_root = self.repo / ".codex-review" / "objects"
        for component in [self.object_root, self.object_root.parent]:
            if component.is_symlink() or component.is_junction():
                raise Conflict("Review object storage cannot be a link")
        if self.state:
            if "next" in self.state and self.state["next"] != next_ids:
                raise Conflict("Counter disagrees with stored state; reconcile before allocation")
            self.state["next"] = next_ids
        if self.state and any(not re.fullmatch(r"[1-9][0-9]*|[a-z]+", k) for k in self.state.get("edits", {})):
            raise Conflict("Invalid edit ID in state")
        if self.state:
            for id_ in self.state["edits"]:
                if id_.isdigit():
                    issued, unused = int(id_), next_ids[0]
                else:
                    issued = 0
                    for char in id_:
                        issued = issued * 26 + ord(char) - 96
                    unused = next_ids[1]
                if issued >= unused:
                    raise Conflict("Counter would reuse an issued ID")
        if self.state and self.state.get("transaction"):
            # Only explicit recover/status may continue; mutators check this again.
            self.interrupted = True
        else:
            self.interrupted = False
        self.original = {}
        self.question_original = {}

    @contextmanager
    def writer_lock(self):
        """Serialize CLI object creation/state persistence with object-cache cleanup."""
        parent = self.object_root.parent
        if parent.is_symlink() or parent.is_junction():
            raise Conflict('审核锁目录不能是链接。')
        parent.mkdir(exist_ok=True)
        lock = parent / 'writer.lock'
        if lock.is_symlink() or lock.is_junction():
            raise Conflict('审核锁文件不能是链接。')
        with lock.open('a+b') as stream:
            if os.name == 'nt':
                import msvcrt
                acquire = lambda: msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                release = lambda: msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                acquire = lambda: fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                release = lambda: fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
            stream.seek(0)
            try:
                acquire()
            except OSError as error:
                raise Conflict('另一个审核写入或缓存清理正在进行；未覆盖数据，请待其结束后重试。') from error
            try:
                yield
            finally:
                stream.seek(0)
                release()

    def git(self, *args, data=None):
        # Per-invocation Windows long-path support; do not mutate user/repository config.
        p = subprocess.run([self.git_exe, "-c", "core.longpaths=true", "-C", str(self.repo), *args], input=data,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=self.env)
        if p.returncode:
            raise Conflict(p.stderr.decode("utf-8", "replace").strip())
        return p.stdout

    def path(self, name):
        p = Path(name)
        if p.is_absolute() or ".." in p.parts or any(c in str(name) for c in "\x00\n\r"):
            raise Conflict("Use a repository-relative .tex path without traversal")
        p = self.repo / p
        cur = p
        while cur != self.repo:
            if cur.is_symlink() or (hasattr(cur, "is_junction") and cur.is_junction()):
                raise Conflict("Symlink/junction targets are not supported")
            cur = cur.parent
        p = p.resolve(strict=True)
        if not p.is_relative_to(self.repo) or ".git" in p.relative_to(self.repo).parts:
            raise Conflict("Path escapes source root")
        if not p.is_file() or p.suffix.lower() != ".tex":
            raise Conflict("Existing regular .tex files only")
        return p

    def read(self, rel):
        p = self.path(rel)
        raw = p.read_bytes()
        self.original.setdefault(rel, raw)
        return body(raw.decode("utf-8-sig"))

    def blob(self, raw):
        return self.git("hash-object", "-w", "--stdin", data=raw).decode().strip()

    def snapshot(self, files, label):
        """Immutable local snapshot; legacy storage uses scoped Git plumbing without HEAD/index writes."""
        if self.storage == "files":
            raw = json.dumps({"files": {name: base64.b64encode(data).decode("ascii") for name, data in sorted(files.items())}},
                             ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
            oid = digest(raw)
            self.object_root.mkdir(parents=True, exist_ok=True)
            target = self.object_root / (oid + ".json")
            if target.exists():
                if target.read_bytes() != raw:
                    raise Conflict("Immutable review object does not match its identity")
            else:
                with target.open("xb") as stream:
                    stream.write(raw)
            return oid
        tree = {}
        for name, raw in sorted(files.items()):
            node = tree
            parts = Path(name).as_posix().split("/")
            for part in parts[:-1]:
                node = node.setdefault(part, {})
            node[parts[-1]] = self.blob(raw)

        def make(node):
            entries = []
            for name, value in sorted(node.items()):
                oid = make(value) if isinstance(value, dict) else value
                mode, typ = ("040000", "tree") if isinstance(value, dict) else ("100644", "blob")
                entries.append(f"{mode} {typ} {oid}\t{name}".encode("utf-8") + b"\0")
            return self.git("mktree", "-z", data=b"".join(entries)).decode().strip()

        oid = self.git("commit-tree", make(tree), "-m", label).decode().strip()
        ref = f"refs/codex-review/{self.state['session'][:8]}/{uuid.uuid4().hex[:12]}"
        self.git("update-ref", ref, oid, "0" * len(oid))
        return oid

    def contents(self, commit, rel):
        if not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", commit):
            raise Conflict("Invalid immutable object identity")
        return self.object_bytes(commit, rel).decode("utf-8")

    def object_bytes(self, commit, rel):
        if self.storage == "git":
            return self.git("show", f"{commit}:{rel}")
        if not re.fullmatch(r"[a-f0-9]{64}", commit):
            raise Conflict("Invalid local snapshot identity; legacy Git records require migration")
        raw = (self.object_root / (commit + ".json")).read_bytes()
        if digest(raw) != commit:
            raise Conflict("Local review snapshot integrity check failed")
        return base64.b64decode(json.loads(raw)["files"][rel], validate=True)

    def migrate_storage(self, defer_pending=False):
        """One-time conversion of legacy objects; preserve IDs, notes and source."""
        self.assert_ready()
        if self.storage != "git":
            updated = self.defer_pending() if defer_pending else {}
            return updated, {"migrated": bool(updated), "storage": "files"}
        refs = {self.state["accepted"]}
        if self.state.get("submission"):
            refs.add(self.state["submission"])
        for rnd in self.state["rounds"]:
            refs.update([rnd["baseline"], rnd["accepted_start"]])
        for edit in self.state["edits"].values():
            refs.update(edit["versions"])
        converted = {}
        for old in refs:
            files = {}
            for row in self.git("ls-tree", "-rz", old).split(b"\0"):
                if not row:
                    continue
                meta, name = row.split(b"\t", 1)
                if meta.split()[1] != b"blob":
                    raise Conflict("Legacy review snapshot contains a non-file object")
                files[name.decode("utf-8")] = self.git("show", old + ":" + name.decode("utf-8"))
            self.storage = "files"
            converted[old] = self.snapshot(files, "migrated legacy snapshot")
            self.storage = "git"
        ref_fields = {"accepted", "baseline", "accepted_start", "submission", "version", "addressed_version"}
        def replace(value, field=None):
            if isinstance(value, dict):
                return {k: replace(v, k) for k, v in value.items()}
            if isinstance(value, list):
                return [converted.get(v, v) if field == "versions" else replace(v) for v in value]
            return converted.get(value, value) if field in ref_fields else value
        self.state = replace(self.state)
        self.state["schema"] = 2
        self.storage = "files"
        updated = self.defer_pending() if defer_pending else {}
        return updated, {"migrated": True, "storage": "files", "objects": len(converted), "source_changed": bool(updated)}

    def defer_pending(self):
        updated = {}
        for edit in self.state["edits"].values():
            if edit["status"] not in PENDING or edit.get("deferred", False):
                continue
            text = updated.get(edit["file"], self.read(edit["file"]))
            item = self.payload(edit)
            start, end = locate(text, item["after"], item["left"], item["right"])
            updated[edit["file"]] = text[:start] + item["before"] + text[end:]
            edit["deferred"] = True
        return updated

    def payload(self, edit):
        return json.loads(self.contents(edit["versions"][-1], "span.json"))

    @staticmethod
    def live_excerpt(edit, item):
        return item["before"] if edit.get("deferred", False) else item["after"]

    def assert_ready(self):
        if not self.state or not self.state.get("rounds"):
            raise Conflict("Begin a review round first")
        if self.interrupted:
            raise Conflict("Interrupted transaction: inspect status then explicitly recover")

    def begin(self, name, files, submission=None):
        if self.interrupted:
            raise Conflict("Recover the existing transaction first")
        if self.state is None:
            _, block, _ = split_state(self.text)
            counters = re.findall(r"CODEX-REVIEW-NEXT manuscript=(\d+) response=([a-z]+)", block)
            if len(counters) != 1:
                raise Conflict("Supply/reconcile the one actual next-ID counter before initialization")
            n, s = counters[0]
            value = 0
            for c in s:
                value = value * 26 + ord(c) - 96
            self.state = {"schema": 2 if self.storage == "files" else 1, "session": uuid.uuid4().hex, "next": [int(n), value],
                          "rounds": [], "edits": {}, "submission": None}
        if name in [r["name"] for r in self.state["rounds"]]:
            raise Conflict("Round names must not be reused")
        if self.state_rel not in files:
            raise Conflict("Include the canonical state owner in the round's file scope")
        if any(e["file"] not in files for e in self.state["edits"].values() if e["status"] in PENDING):
            raise Conflict("Carry every unresolved file into the next round")
        current = {p: self.read(p) for p in sorted(set(files))}
        if any(BEGIN in self.original[p].decode("utf-8-sig") for p in current if p != self.state_rel):
            raise Conflict("A second review-state owner exists; reconcile pointers first")
        if any(re.search(r"\\codex(?:replace|add|delete)\s*\{", t) for t in current.values()):
            raise Conflict("Unresolved legacy colored marks: migration requires an explicit preservation plan")
        if submission:
            if self.storage == "files":
                if not re.fullmatch(r"[a-f0-9]{64}", submission) or not (self.object_root / (submission + ".json")).is_file():
                    raise Conflict("Submitted identity must be an existing local snapshot; migrate legacy Git records first")
                oid = submission
            else:
                oid = self.git("rev-parse", "--verify", f"{submission}^{{commit}}").decode().strip()
            if self.state["submission"] and self.state["submission"] != oid:
                raise Conflict("Do not silently change the submitted baseline")
            self.state["submission"] = oid
        accepted = current.copy()
        for e in self.state["edits"].values():
            if e["status"] in PENDING and not e.get("deferred", False):
                item = self.payload(e)
                a, b = locate(accepted[e["file"]], item["after"], item["left"], item["right"])
                accepted[e["file"]] = accepted[e["file"]][:a] + item["before"] + accepted[e["file"]][b:]
        base = self.snapshot({p: t.encode("utf-8") for p, t in current.items()}, "review round baseline " + name)
        acc = self.snapshot({p: t.encode("utf-8") for p, t in accepted.items()}, "accepted projection at round start " + name)
        self.state["rounds"].append({"name": name, "baseline": base, "accepted_start": acc, "ids": [], "files": sorted(current)})
        self.state["accepted"] = acc
        return {}, {"round": name, "baseline": base, "accepted": acc}

    def question_source(self, name):
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts:
            raise Conflict('Reviewer question source must be inside this paper project')
        target = self.repo / relative
        for component in [target, *target.parents]:
            if component == self.repo:
                break
            if component.is_symlink() or component.is_junction():
                raise Conflict('Reviewer question source cannot be a link')
        if not target.resolve(strict=True).is_relative_to(self.repo) or not target.is_file():
            raise Conflict('Reviewer question source is not a regular project file')
        if target.suffix.lower() not in ('.tex', '.txt', '.md'):
            raise Conflict('Exact reviewer-question links currently require a UTF-8 .tex, .txt or .md source')
        return target.read_bytes()

    def question_links(self, questions):
        if not isinstance(questions, list):
            raise Conflict('questions must be a list of verified original reviewer excerpts')
        normalized = []
        for question in questions:
            if not isinstance(question, dict) or not all(isinstance(question.get(k), str) and question[k].strip() for k in ('id', 'file', 'quote')):
                raise Conflict('Each reviewer question needs id, file and exact quote')
            raw = self.question_source(question['file'])
            previous = self.question_original.setdefault(question['file'], raw)
            if previous != raw:
                raise Conflict('Concurrent reviewer-question source modification')
            # Embedded state and generated linkage comments are not original
            # reviewer prose and can repeat the stored quote verbatim.
            source = body(raw.decode('utf-8-sig'))
            source = re.sub(r'(?m)^[ \t]*%[ \t]*CODEX-QUESTION[^\r\n]*', '', source)
            start = source.find(question['quote'])
            if start < 0 or source.find(question['quote'], start + 1) >= 0:
                raise Conflict('Reviewer question quote must match its actual source uniquely')
            normalized.append({k: question[k] for k in ('id', 'file', 'quote')})
        return normalized

    def update_questions(self, id_, version, questions, replace=False):
        self.assert_ready()
        edit = self.state['edits'].get(id_)
        if not edit or edit['status'] not in PENDING:
            raise Conflict('Question metadata requires an existing unresolved candidate ID')
        if version != edit['versions'][-1]:
            raise Conflict('Displayed candidate is stale; reread the latest version before linking questions')
        data = self.inspect(id_, version)
        if not data['source_match']:
            raise Conflict(data['conflict'])
        incoming = self.question_links(questions)
        combined = incoming if replace else self.question_links(edit.get('questions', [])) + incoming
        merged = []
        for question in combined:
            if question not in merged:
                merged.append(question)
        edit['questions'] = merged
        return {}, {'id': id_, 'version': version, 'mode': 'replace' if replace else 'append', 'questions': merged}

    def propose(self, spec, rework=None):
        self.assert_ready()
        discard_annotations = spec.get('discard_annotations', False)
        if type(discard_annotations) is not bool or (discard_annotations and not rework):
            raise Conflict('discard_annotations is a boolean option for rework only')
        if discard_annotations and spec.get('resolve_requests'):
            raise Conflict('Choose annotation discard or individual request resolution, not both')
        questions = self.question_links(spec['questions']) if 'questions' in spec else None
        edits = self.state["edits"]
        if rework:
            if rework not in edits or edits[rework]["status"] not in PENDING:
                raise Conflict("Only unresolved IDs can be reworked; accepted text needs a new ID")
            edit = edits[rework]
            old = self.payload(edit)
            rel = edit["file"]
            before, left, right = self.live_excerpt(edit, old), old["left"], old["right"]
            original = old["before"]
            deferred = edit.get("deferred", False)
        else:
            rel = spec["file"]
            if rel not in self.state["rounds"][-1]["files"]:
                raise Conflict("File is outside the registered round")
            if spec.get("kind") not in ("manuscript", "response"):
                raise Conflict("kind must be manuscript or response")
            before, left, right = spec["before"], spec.get("left", ""), spec.get("right", "")
            original = before
            deferred = spec.get("deferred", self.storage == "files")
            if type(deferred) is not bool:
                raise Conflict("deferred must be a boolean")
            if self.storage == 'files' and not deferred:
                raise Conflict("新候选必须 deferred=true；接收后才替换正文。旧记录仍可读取。")
        text = self.read(rel)
        a, b = locate(text, before, left, right)
        after = spec["after"]
        if before == after or (rework and old["after"] == after):
            raise Conflict("No content change")
        if self.storage == 'files' and (not rework or edit.get('scope_policy') == 'single-unit'):
            validate_review_unit(original)
            validate_review_unit(after)
        # Refuse overlap with another unresolved edit, including insertion boundaries.
        for id_, other in edits.items():
            if id_ == rework or other["file"] != rel or other["status"] not in PENDING:
                continue
            obj = self.payload(other)
            x, y = locate(text, self.live_excerpt(other, obj), obj["left"], obj["right"])
            if max(a, x) < min(b, y) or (a == b and x <= a <= y) or (x == y and a <= x <= b):
                raise Conflict("Overlapping unresolved edits: rework the existing ID or resolve it first")
        deps = spec.get("deps", edit.get("deps", []) if rework else [])
        if any(d not in edits or d == rework for d in deps):
            raise Conflict("Dependencies must refer to other existing IDs")
        # A revision of an existing item may not introduce a dependency cycle.
        def reaches(id_, target, seen):
            if id_ == target:
                return True
            if id_ in seen:
                return False
            seen.add(id_)
            return any(reaches(d, target, seen) for d in edits[id_].get("deps", []))
        if rework and any(reaches(d, rework, set()) for d in deps):
            raise Conflict("Dependency cycle")
        id_ = rework
        if not id_:
            which = 0 if spec["kind"] == "manuscript" else 1
            id_ = str(self.state["next"][0]) if which == 0 else letters(self.state["next"][1])
            if id_ in edits:
                raise Conflict("ID counter collides with issued history")
            self.state["next"][which] += 1
            edit = {"file": rel, "kind": spec["kind"], "status": "pending", "versions": [], "deps": []}
            if self.storage == 'files':
                edit['scope_policy'] = 'single-unit'
            if deferred:
                edit["deferred"] = True
            edits[id_] = edit
        item = {"before": original, "after": after, "left": text[max(0, a - 120):a], "right": text[b:b + 120]}
        commit = self.snapshot({"original.tex": original.encode("utf-8"), "candidate.tex": after.encode("utf-8"),
                                "span.json": json.dumps(item, ensure_ascii=False).encode("utf-8")}, "review item " + id_)
        edit["versions"].append(commit)
        edit.update({"deps": deps, "location": spec.get("location", edit.get("location", ""))})
        if questions is not None:
            edit['questions'] = questions
        if rework:
            edit["status"] = "rework"
            if discard_annotations:
                edit.pop('requests', None)
            resolved = spec.get("resolve_requests", [])
            available = {r["id"] for r in edit.get("requests", []) if r["status"] == "open"}
            if not set(resolved) <= available:
                raise Conflict("Unknown or already closed feedback request")
            for request in edit.get("requests", []):
                if request["id"] in resolved:
                    request["status"] = "addressed-pending-review"
                    request["addressed_version"] = commit
            self.stale({id_})
        if id_ not in self.state["rounds"][-1]["ids"]:
            self.state["rounds"][-1]["ids"].append(id_)
        return ({} if deferred else {rel: text[:a] + after + text[b:]}), {"id": id_, "status": edit["status"]}

    def stale(self, changed):
        seen = set(changed)
        while True:
            more = {k for k, e in self.state["edits"].items() if set(e.get("deps", [])) & seen} - seen
            if not more:
                break
            for k in more:
                self.state["edits"][k]["freshness"] = "needs-recheck"
            seen |= more

    def decide(self, accept, reject, expected_versions=None):
        self.assert_ready()
        if not accept and not reject or set(accept) & set(reject):
            raise Conflict("Specify distinct exact IDs")
        updated = {}
        accepted = {}
        for id_ in accept + reject:
            edit = self.state["edits"].get(id_)
            if not edit or edit["status"] not in PENDING:
                raise Conflict("ID is missing or already decided: " + id_)
            if expected_versions and expected_versions.get(id_) != edit["versions"][-1]:
                raise Conflict("Displayed candidate is stale; reopen the latest version before deciding")
            rel = edit["file"]
            text = updated.get(rel, self.read(rel))
            item = self.payload(edit)
            a, b = locate(text, self.live_excerpt(edit, item), item["left"], item["right"])
            if id_ in reject:
                if not edit.get("deferred", False):
                    updated[rel] = text[:a] + item["before"] + text[b:]
                edit["status"] = "rejected"
                self.stale({id_})
            else:
                if edit.get("deferred", False):
                    updated[rel] = text[:a] + item["after"] + text[b:]
                # Only the explicitly accepted change enters this projection. Later manual edits stay separate.
                base = accepted.get(rel, self.contents(self.state["accepted"], rel))
                x, y = locate(base, item["before"], item["left"], item["right"])
                accepted[rel] = base[:x] + item["after"] + base[y:]
                edit["status"] = "accepted"
            for request in edit.get("requests", []):
                if request["status"] in ("open", "addressed-pending-review"):
                    request["status"] = "closed-by-author-acceptance" if id_ in accept else "closed-by-author-rejection"
        if accepted:
            files = {p: accepted.get(p, self.contents(self.state["accepted"], p)).encode("utf-8")
                     for p in self.state["rounds"][-1]["files"]}
            self.state["accepted"] = self.snapshot(files, "explicit author acceptance " + ",".join(accept))
        return updated, {"accepted": accept, "rejected": reject}

    def inspect(self, id_, version=None, source=False):
        self.assert_ready()
        edit = self.state["edits"][id_]
        if not edit['versions'] and edit.get('checkpoint'):
            return {'id': id_, 'edit': copy.deepcopy(edit), 'sha256': digest(self.raw),
                    'archived': True, 'checkpoint': edit['checkpoint'],
                    'message': '已完结候选已精简；此处仅保留依赖身份，成功成果请查看 Git 提交。'}
        version = version or edit["versions"][-1]
        if version not in edit["versions"]:
            raise Conflict("Version does not belong to the selected review item")
        result = {"id": id_, "edit": copy.deepcopy(edit), "version": version, "sha256": digest(self.raw),
                  "original": self.contents(version, "original.tex"), "candidate": self.contents(version, "candidate.tex")}
        obj = self.payload(edit)
        try:
            locate(self.read(edit["file"]), self.live_excerpt(edit, obj), obj["left"], obj["right"])
            result["source_match"] = True
        except Conflict as exc:
            result.update({"source_match": False, "conflict": str(exc)})
        if source and result["source_match"]:
            raw = self.path(edit["file"]).read_bytes().decode("utf-8-sig")
            start, end = locate(body(raw), self.live_excerpt(edit, obj), obj["left"], obj["right"])
            if BEGIN in raw:
                prefix, block, _ = split_state(raw)
                if start >= len(prefix):
                    start, end = start + len(block), end + len(block)
            result["source"] = {"text": raw, "start": start, "end": end,
                                "side": "original" if edit.get("deferred", False) else "candidate"}
            result["changes"] = word_changes(result["original"], result["candidate"])
        return result

    def feedback(self, spec):
        """An author's anchored annotation/request; no prose rewrite or AI invocation."""
        self.assert_ready()
        id_ = spec["id"]
        edit = self.state["edits"][id_]
        if edit["status"] not in PENDING:
            raise Conflict("Feedback requires an unresolved review item")
        if spec["version"] != edit["versions"][-1]:
            raise Conflict("Annotation targets an old candidate; reopen and select again")
        side = spec["side"]
        if side not in ("original", "candidate"):
            raise Conflict("Annotation side must be original or candidate")
        selected = self.contents(spec["version"], side + ".tex")
        start, end = spec["start"], spec["end"]
        if type(start) is not int or type(end) is not int or not 0 <= start <= end <= len(selected):
            raise Conflict("Invalid Unicode code-point selection offsets")
        if selected[start:end] != spec["quote"]:
            raise Conflict("Selection does not match the immutable excerpt")
        text = spec["text"]
        if not isinstance(text, str) or not text.strip():
            raise Conflict("A nonempty revision request is required")
        # Validate live source too: notes must not silently target a manually changed proposal.
        obj = self.payload(edit)
        locate(self.read(edit["file"]), self.live_excerpt(edit, obj), obj["left"], obj["right"])
        request = {"id": uuid.uuid4().hex[:12], "text": text.strip(), "status": "open", "side": side,
                   "version": spec["version"], "start": start, "end": end, "quote": spec["quote"]}
        edit.setdefault("requests", []).append(request)
        edit["status"] = "rework"
        return {}, {"id": id_, "request": request, "rewritten": False}

    def embedded(self, content=None):
        a, block, b = split_state(self.text)
        lines = [l for l in block.splitlines() if not l.startswith(DATA) and "CODEX-REVIEW-NEXT " not in l]
        at = lines.index(END)
        mechanical = {k: v for k, v in self.state.items() if k != "next"}
        lines[at:at] = [f"% CODEX-REVIEW-NEXT manuscript={self.state['next'][0]} response={letters(self.state['next'][1])}",
                        DATA + json.dumps(mechanical, ensure_ascii=False, separators=(",", ":"))]
        block = self.eol.join(lines) + self.eol
        if content is None:
            return a + block + b
        # The state block's original insertion point is before the document body.
        if not content.startswith(a):
            raise Conflict("A source edit crosses the state header insertion point")
        return content[:len(a)] + block + content[len(a):]

    def persist(self, updated, expect):
        if expect != digest(self.raw):
            raise Conflict("Stale/missing --expect state-file SHA256")
        targets = {}
        for rel, text in updated.items():
            if rel == self.state_rel:
                continue
            raw = self.original[rel]
            targets[rel] = (b"\xef\xbb\xbf" if raw.startswith(b"\xef\xbb\xbf") else b"") + text.encode("utf-8")
        if self.state_path.read_bytes() != self.raw or any(self.path(p).read_bytes() != raw for p, raw in self.original.items()):
            raise Conflict("Concurrent source/state modification; no source writes")
        if any(self.question_source(p) != raw for p, raw in self.question_original.items()):
            raise Conflict('Concurrent reviewer-question source modification; no source writes')
        # Durable intent stored in the sole state block. Recovery verifies exact old/new bytes.
        intent_files = {}
        for i, (rel, raw) in enumerate(targets.items()):
            intent_files[f"{i}-old"] = self.original[rel]
            intent_files[f"{i}-new"] = raw
        if updated.get(self.state_rel) is not None:
            intent_files["owner-old"] = body(self.text).encode("utf-8")
            intent_files["owner-new"] = updated[self.state_rel].encode("utf-8")
        intent = self.snapshot(intent_files or {"empty": b""}, "review transaction recovery")
        self.state["transaction"] = {"commit": intent, "files": list(targets), "owner": self.state_rel in updated}
        intent_raw = self.encode(self.embedded())
        self.write(self.state_path, intent_raw)
        for rel, raw in targets.items():
            if self.path(rel).read_bytes() != self.original[rel]:
                raise Conflict("Concurrent edit after intent; transaction retained for recovery")
            self.write(self.path(rel), raw)
        if self.state["transaction"]["owner"]:
            self.text = self.embedded(updated[self.state_rel])
        else:
            self.text = self.embedded()
        if self.state_path.read_bytes() != intent_raw:
            raise Conflict("Concurrent state-owner edit; transaction retained, do not overwrite")
        self.state.pop("transaction")
        self.write(self.state_path, self.encode(self.embedded()))

    def recover(self, expect):
        if not self.interrupted or expect != digest(self.raw):
            raise Conflict("No transaction or stale state SHA256")
        tr = self.state["transaction"]
        planned = []
        for i, rel in enumerate(tr["files"]):
            old = self.object_bytes(tr['commit'], f"{i}-old")
            new = self.object_bytes(tr['commit'], f"{i}-new")
            actual = self.path(rel).read_bytes()
            if actual not in (old, new):
                raise Conflict("Recovery found author/concurrent edits; preserve all files and reconcile manually")
            planned.append((self.path(rel), actual, new))
        content = None
        if tr["owner"]:
            old = self.contents(tr["commit"], "owner-old")
            content = self.contents(tr["commit"], "owner-new")
            if body(self.text) not in (old, content):
                raise Conflict("State-owner source changed during transaction")
        for path, actual, new in planned:
            if path.read_bytes() != actual:
                raise Conflict("Concurrent recovery edit")
            self.write(path, new)
        self.state.pop("transaction")
        self.write(self.state_path, self.encode(self.embedded(content)))
        return {"recovered": True}

    def encode(self, text):
        return (b"\xef\xbb\xbf" if self.bom else b"") + text.encode("utf-8")

    @staticmethod
    def write(path, raw):
        # Same-directory atomic replacement; retain any interrupted temporary artifact.
        temp = path.with_name(path.name + ".codex-write-" + uuid.uuid4().hex)
        with temp.open("xb") as f:
            f.write(raw)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, path)

    def status(self):
        if not self.state:
            return {"initialized": False, "sha256": digest(self.raw)}
        result = copy.deepcopy(self.state)
        result["sha256"] = digest(self.raw)
        for id_, edit in result["edits"].items():
            if edit["status"] in PENDING:
                try:
                    obj = self.payload(edit)
                    locate(self.read(edit["file"]), self.live_excerpt(edit, obj), obj["left"], obj["right"])
                    edit["source_match"] = True
                except Conflict as exc:
                    edit["source_match"] = False
                    edit["conflict"] = str(exc)
        return result

    def cards(self):
        """One read-only UI packet; shared source text occurs once per file."""
        self.assert_ready()
        result = copy.deepcopy(self.state)
        result.update(sha256=digest(self.raw), cards={}, sources={})
        for id_, edit in result['edits'].items():
            if edit['status'] not in PENDING:
                continue
            data = self.inspect(id_, source=True)
            edit['source_match'] = data['source_match']
            if not data['source_match']:
                edit['conflict'] = data['conflict']
                continue
            text = data['source'].pop('text')
            file = edit['file']
            if file in result['sources'] and result['sources'][file] != text:
                raise Conflict('审核卡片读取期间原文发生变化，请重新打开；未修改正文或决定。')
            result['sources'][file] = text
            result['cards'][id_] = data
        return result

    def view(self, id_, code=None):
        self.assert_ready()
        if code:
            raise Conflict('旧独立差异窗口已停用，请使用原文件中的审核卡片与逐项接收按钮。')
        edit = self.state["edits"][id_]
        if not edit['versions'] and edit.get('checkpoint'):
            return self.inspect(id_)
        obj = self.payload(edit)
        folder = self.repo / ".codex-review" / "views" / self.state["session"] / (id_ + "-" + uuid.uuid4().hex)
        folder.mkdir(parents=True, exist_ok=False)
        # Only the selected edit's excerpts; never a second full manuscript or state table.
        old, new = folder / (id_ + "-original.tex"), folder / (id_ + f"-candidate-v{len(edit['versions'])}.tex")
        old.write_bytes(obj["before"].encode("utf-8"))
        new.write_bytes(obj["after"].encode("utf-8"))
        old.chmod(0o444)
        new.chmod(0o444)
        result = {"id": id_, "original": str(old), "candidate": str(new), "file": edit["file"],
                  "status": edit["status"], "generation": len(edit["versions"]), "source_match": self.status()["edits"][id_].get("source_match")}
        # Retired old-window launch; retain commented until the next confirmed cleanup.
        # if code:
        #     subprocess.run([code, "--reuse-window", "--diff", str(old), str(new)], check=True)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", "--repo", dest="repo", required=True)
    parser.add_argument("--state", required=True)
    parser.add_argument("--git", default="git")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expect")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("begin")
    p.add_argument("--round", required=True)
    p.add_argument("--files", nargs="+", required=True)
    p.add_argument("--submission")
    sub.add_parser("propose", help="UTF-8 JSON spec on stdin")
    p = sub.add_parser("rework", help="UTF-8 JSON {after,...} on stdin")
    p.add_argument("--id", required=True)
    p = sub.add_parser('link-questions', help='Update only verified questions metadata; UTF-8 JSON {questions:[...]} on stdin')
    p.add_argument('--id', required=True)
    p.add_argument('--version', required=True)
    p.add_argument('--replace', action='store_true', help='Explicitly replace all existing associations; otherwise append/deduplicate')
    p = sub.add_parser("decide")
    p.add_argument("--accept", nargs="*", default=[])
    p.add_argument("--reject", nargs="*", default=[])
    p.add_argument("--version", help="Displayed immutable version, for a single-item GUI decision")
    sub.add_parser("status")
    sub.add_parser("cards", help="Read pending UI cards with shared live-source text; no PDF or writes")
    sub.add_parser("feedback", help="UTF-8 JSON anchored author annotation on stdin")
    p = sub.add_parser("inspect")
    p.add_argument("--id", required=True)
    p.add_argument("--version")
    p.add_argument("--source", action="store_true", help="Include live-file offsets and word-level changes for inline cards")
    sub.add_parser("recover")
    p = sub.add_parser("migrate", help="Convert legacy Git review objects into independent local snapshots")
    p.add_argument("--defer-pending", action="store_true", help="Restore pending originals, retaining candidate versions and IDs")
    p = sub.add_parser("show")
    p.add_argument("--id", required=True)
    p.add_argument("--code", help="Retired window-launch option; use original-file review cards")
    args = parser.parse_args()
    r = Review(args.repo, args.state, args.git)
    with r.writer_lock() if args.apply else nullcontext():
        if args.apply:
            r = Review(args.repo, args.state, args.git)
        result = dispatch(r, args)
    print(json.dumps(result, ensure_ascii=False, indent=2))


def dispatch(r, args):
    if args.command == "status":
        result = r.status()
    elif args.command == "cards":
        result = r.cards()
    elif args.command == "inspect":
        result = r.inspect(args.id, args.version, args.source)
    elif args.command == "show":
        result = r.view(args.id, args.code)
    elif args.command == "recover":
        result = r.recover(args.expect) if args.apply else {"preview": r.state.get("transaction")}
    else:
        # Preview validates using the same object-building code, but writes no Git/source files.
        if args.apply and args.expect != digest(r.raw):
            raise Conflict("Stale/missing --expect state-file SHA256")
        if not args.apply:
            r.snapshot = lambda files, label: "0" * 40
        if args.command == "begin":
            updated, result = r.begin(args.round, args.files, args.submission)
        elif args.command == "migrate":
            updated, result = r.migrate_storage(args.defer_pending)
        elif args.command in ("propose", "rework"):
            spec = json.loads(sys.stdin.read())
            if args.command == "propose":
                spec.setdefault("deferred", True)
                if spec['deferred'] is False:
                    raise Conflict("新候选必须 deferred=true；接收后才替换正文。旧记录仍可读取。")
            updated, result = r.propose(spec, getattr(args, "id", None))
        elif args.command == "feedback":
            updated, result = r.feedback(json.loads(sys.stdin.read()))
        elif args.command == 'link-questions':
            spec = json.loads(sys.stdin.read())
            updated, result = r.update_questions(args.id, args.version, spec['questions'], replace=args.replace)
        else:
            ids = args.accept + args.reject
            if args.version and len(ids) != 1:
                raise Conflict("--version requires exactly one decision ID")
            updated, result = r.decide(args.accept, args.reject, {ids[0]: args.version} if args.version else None)
        if args.apply:
            r.persist(updated, args.expect)
        result.update({"applied": args.apply, "expected_sha256": digest(r.raw)})
    return result


if __name__ == "__main__":
    try:
        main()
    except (Conflict, KeyError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(2)
