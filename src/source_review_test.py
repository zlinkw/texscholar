"""Native Git correctness fixtures. Artifacts are deliberately retained, never cleaned."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
import uuid

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("source_review", HERE / "source_review.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
GIT = os.environ.get("SOURCE_REVIEW_GIT", "git")
ROOT = Path(os.environ.get("SOURCE_REVIEW_FIXTURES", str(Path.cwd() / "source-review-validation"))) / uuid.uuid4().hex
ROOT.mkdir(parents=True)


class Flow(unittest.TestCase):
    def setUp(self):
        self.root = ROOT / self._testMethodName
        self.root.mkdir()
        self.env = {k: v for k, v in os.environ.items() if not k.upper().startswith("GIT_")}
        self.g("init", "-b", "master")
        self.g("config", "user.name", "Isolated review fixture")
        self.g("config", "user.email", "fixture@localhost")
        self.g("config", "core.autocrlf", "false")
        self.write("main.tex", "\\documentclass{article}\n\\begin{document}\nThe model improves performance.\nIt remains efficient.\n\n\\input{section}\n\\end{document}\n")
        self.write("section.tex", "\\section{Method}\nThe estimator is robust.\nA value of 0.05 is used, e.g., for $p<0.05$.\n")
        self.write("reply.tex", "% CODEX-REVIEW-STATE-BEGIN\n% 保留作者的意见映射和中文注释。\n% CODEX-REVIEW-NEXT manuscript=1 response=a\n% CODEX-REVIEW-STATE-END\n\\documentclass{article}\n\\begin{document}\nThank you for the comment.\nThe explanation is complete.\n\\end{document}\n")
        self.write("other.txt", "original\n")
        self.g("add", ".")
        self.g("commit", "-m", "submitted fixture")
        self.submitted = self.g("rev-parse", "HEAD").strip()
        self.write("other.txt", "staged author content\n")
        self.g("add", "other.txt")
        self.write("other.txt", "unstaged author content\n")
        self.index = (self.root / ".git/index").read_bytes()
        self.runop("begin", "round-1", ["main.tex", "section.tex", "reply.tex"], self.submitted)

    def g(self, *args):
        p = subprocess.run([GIT, "-C", str(self.root), *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=self.env)
        self.assertEqual(p.returncode, 0, p.stderr.decode("utf-8", "replace"))
        return p.stdout.decode("utf-8")

    def write(self, rel, text):
        (self.root / rel).write_bytes(text.encode("utf-8"))

    def read(self, rel):
        return (self.root / rel).read_bytes().decode("utf-8-sig")

    def review(self):
        return m.Review(self.root, "reply.tex", GIT, storage="git")

    def runop(self, op, *args):
        r = self.review()
        updates, result = getattr(r, op)(*args)
        r.persist(updates, m.digest(r.raw))
        return result

    def edit(self, rel, before, after, **kwargs):
        return self.runop("propose", {"file": rel, "kind": "response" if rel == "reply.tex" else "manuscript",
                                      "before": before, "after": after, **kwargs})["id"]

    def check_index(self):
        self.assertEqual((self.root / ".git/index").read_bytes(), self.index)
        self.assertEqual(self.read("other.txt"), "unstaged author content\n")

    def test_inline_proposal_waits_for_acceptance_and_marks_only_changed_words(self):
        before = self.read("main.tex")
        id_ = self.edit("main.tex", "The model improves performance.", "The model may improve performance.", deferred=True)
        self.assertEqual(self.read("main.tex"), before)
        data = self.review().inspect(id_, source=True)
        self.assertEqual(data["source"]["side"], "original")
        self.assertEqual(data["source"]["text"][data["source"]["start"]:data["source"]["end"]], data["original"])
        for change in data["changes"]:
            self.assertNotIn("performance", data["original"][change["old_start"]:change["old_end"]])
            self.assertNotIn("performance", data["candidate"][change["new_start"]:change["new_end"]])
        self.runop("decide", [id_], [])
        self.assertIn("The model may improve performance.", self.read("main.tex"))
        self.assertEqual(self.review().status()["edits"][id_]["status"], "accepted")
        self.check_index()

    def test_inline_feedback_rework_retains_original_and_number_until_acceptance(self):
        original = self.read("reply.tex")
        id_ = self.edit("reply.tex", "The explanation is complete.", "The explanation is clearer.", deferred=True)
        self.assertEqual(m.body(self.read("reply.tex")), m.body(original))
        data = self.review().inspect(id_, source=True)
        self.runop("feedback", {"id": id_, "version": data["version"], "side": "original",
                               "start": 4, "end": 15, "quote": "explanation", "text": "只改这个词，保留其余原文。"})
        request = self.review().status()["edits"][id_]["requests"][0]
        self.runop("propose", {"after": "The rationale is complete.", "resolve_requests": [request["id"]]}, id_)
        updated = self.review().inspect(id_, source=True)
        self.assertEqual(updated["original"], "The explanation is complete.")
        self.assertEqual(updated["edit"]["status"], "rework")
        self.assertEqual(updated["edit"]["requests"][0]["status"], "addressed-pending-review")
        self.assertEqual(m.body(self.read("reply.tex")), m.body(original))
        self.runop("decide", [id_], [])
        self.assertIn("The rationale is complete.", self.read("reply.tex"))
        self.check_index()

    def test_inline_overlap_and_manual_edits_remain_protected(self):
        id_ = self.edit("main.tex", "The model improves performance.", "The model improves robustness.", deferred=True)
        with self.assertRaises(m.Conflict):
            self.edit("main.tex", "improves performance", "can improve performance", deferred=True)
        self.write("main.tex", self.read("main.tex").replace("The model improves performance.", "Author replaced this sentence."))
        with self.assertRaises(m.Conflict):
            self.runop("decide", [id_], [])
        self.assertIn("Author replaced this sentence.", self.read("main.tex"))
        self.check_index()

    def test_cli_new_proposals_default_to_inline_without_changing_source(self):
        before = self.read("main.tex")
        review = self.review()
        command = [sys.executable, "-X", "utf8", str(HERE / "source_review.py"), "--repo", str(self.root),
                   "--state", "reply.tex", "--git", GIT, "--apply", "--expect", m.digest(review.raw), "propose"]
        result = subprocess.run(command, input=json.dumps({"file": "main.tex", "kind": "manuscript",
                                "before": "It remains efficient.", "after": "It remains efficient in this setting."}).encode("utf-8"),
                                capture_output=True, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.read("main.tex"), before)
        self.assertTrue(self.review().status()["edits"]["1"]["deferred"])

    def test_cross_file_partial_accept_reject_rework(self):
        self.assertEqual(self.edit("main.tex", "The model improves performance.", "The model may improve performance."), "1")
        self.assertEqual(self.edit("section.tex", "The estimator is robust.", "The estimator can be robust."), "2")
        self.assertEqual(self.edit("main.tex", "It remains efficient.", "It uses a compact representation."), "3")
        self.assertEqual(self.edit("reply.tex", "Thank you for the comment.", "Thank you for this helpful suggestion.", deps=["1", "2"]), "a")
        self.assertEqual(self.edit("reply.tex", "The explanation is complete.", "The concern is fully resolved."), "b")
        self.runop("decide", ["1", "3"], ["b"])
        self.runop("propose", {"after": "The estimator is robust under the evaluated conditions."}, "2")
        s = self.review().status()
        self.assertEqual({k: e["status"] for k, e in s["edits"].items()}, {"1": "accepted", "2": "rework", "3": "accepted", "a": "pending", "b": "rejected"})
        self.assertEqual(s["edits"]["a"]["freshness"], "needs-recheck")
        self.assertEqual(self.review().payload(s["edits"]["2"])["before"], "The estimator is robust.")
        self.assertIn("The explanation is complete.", self.read("reply.tex"))
        acc = self.review().contents(s["accepted"], "section.tex")
        self.assertIn("The estimator is robust.", acc)
        self.assertNotIn("under the evaluated", acc)
        self.check_index()

    def test_commit_format_and_restart_do_not_accept(self):
        self.edit("main.tex", "The model improves performance.", "The model can improve performance.")
        base = self.review().state["rounds"][0]["baseline"]
        self.g("add", "main.tex", "reply.tex")
        self.g("commit", "-m", "candidate prose checkpoint")
        self.write("main.tex", self.read("main.tex").replace("\\input{section}", "  \\input{section}"))
        self.g("add", "main.tex")
        self.g("commit", "-m", "indentation only")
        # New process recovery, independent of module instance or HEAD.
        p = subprocess.run([sys.executable, "-X", "utf8", str(HERE / "source_review.py"), "--repo", str(self.root),
                            "--state", "reply.tex", "--git", GIT, "status"], capture_output=True, env=self.env)
        self.assertEqual(p.returncode, 0, p.stderr)
        s = json.loads(p.stdout)
        self.assertEqual(s["rounds"][0]["baseline"], base)
        self.assertNotEqual(self.g("rev-parse", "HEAD").strip(), base)
        self.assertEqual(s["edits"]["1"]["status"], "pending")
        self.assertTrue(s["edits"]["1"]["source_match"])
        views = self.review().view("1")
        self.assertEqual(Path(views["original"]).read_text(encoding="utf-8"), "The model improves performance.")
        self.assertEqual(Path(views["candidate"]).read_text(encoding="utf-8"), "The model can improve performance.")
        self.runop("decide", [], ["1"])
        self.assertIn("  \\input{section}", self.read("main.tex"))

    def test_round_carry_same_location_new_id_and_no_reuse(self):
        self.edit("main.tex", "The model improves performance.", "The model may improve performance.")
        self.edit("section.tex", "The estimator is robust.", "The estimator can be robust.")
        self.runop("decide", ["1"], [])
        self.runop("begin", "round-2", ["main.tex", "section.tex", "reply.tex"], None)
        self.assertEqual(self.edit("main.tex", "The model may improve performance.", "The model improves performance in this setting."), "3")
        self.runop("decide", [], ["3"])
        self.assertIn("The model may improve performance.", self.read("main.tex"))
        self.assertEqual(self.review().state["edits"]["2"]["status"], "pending")
        self.assertEqual(self.review().state["next"], [4, 1])
        self.check_index()

    def test_author_edits_line_drift_and_partial_staging_survive(self):
        self.edit("section.tex", "The estimator is robust.", "The estimator can be robust.")
        self.g("add", "section.tex")
        staged = self.g("show", ":section.tex")
        self.index = (self.root / ".git/index").read_bytes()
        self.write("section.tex", "% Author note\n" * 20 + self.read("section.tex") + "% manual addition\n")
        self.runop("decide", [], ["1"])
        self.assertTrue(self.read("section.tex").startswith("% Author note\n" * 20))
        self.assertTrue(self.read("section.tex").endswith("% manual addition\n"))
        self.assertEqual(self.g("show", ":section.tex"), staged)
        self.check_index()

    def test_overlapping_manual_edit_stops_without_overwrite(self):
        self.edit("section.tex", "The estimator is robust.", "The estimator can be robust.")
        self.write("section.tex", self.read("section.tex").replace("can be robust", "may be reliable"))
        raw = (self.root / "section.tex").read_bytes()
        state = (self.root / "reply.tex").read_bytes()
        with self.assertRaises(m.Conflict):
            self.runop("decide", [], ["1"])
        self.assertEqual((self.root / "section.tex").read_bytes(), raw)
        self.assertEqual((self.root / "reply.tex").read_bytes(), state)
        self.assertFalse(self.review().status()["edits"]["1"]["source_match"])
        self.check_index()

    def test_overlap_and_ambiguous_text_are_rejected(self):
        self.edit("main.tex", "The model improves performance.", "The model may improve performance.")
        with self.assertRaises(m.Conflict):
            self.edit("main.tex", "may improve", "could improve")
        self.write("section.tex", "Repeat.\nRepeat.\n")
        with self.assertRaises(m.Conflict):
            self.edit("section.tex", "Repeat.", "Different.")
        self.check_index()

    def test_insert_delete_bom_crlf_and_unicode_preserved(self):
        raw = (b"\xef\xbb\xbf" + "\\section{Method}\r\n测试文字。\r\nKeep this.\r\n".encode("utf-8"))
        (self.root / "section.tex").write_bytes(raw)
        self.runop("begin", "round-2", ["main.tex", "section.tex", "reply.tex"], None)
        self.edit("section.tex", "测试文字。", "中文新文字。")
        self.runop("decide", [], ["1"])
        self.assertEqual((self.root / "section.tex").read_bytes(), raw)
        self.edit("section.tex", "", "Added sentence.\r\n", left="测试文字。\r\n", right="Keep this.")
        self.runop("decide", [], ["2"])
        self.assertEqual((self.root / "section.tex").read_bytes(), raw)
        self.edit("section.tex", "Keep this.", "")
        self.runop("decide", [], ["3"])
        self.assertEqual((self.root / "section.tex").read_bytes(), raw)
        self.edit("section.tex", "", "Added sentence.\r\n", left="测试文字。\r\n", right="Keep this.")
        self.runop("decide", ["4"], [])
        self.edit("section.tex", "Keep this.", "")
        self.runop("decide", ["5"], [])
        self.assertIn("Added sentence.", self.review().contents(self.review().state["accepted"], "section.tex"))
        self.assertNotIn("Keep this.", self.review().contents(self.review().state["accepted"], "section.tex"))
        self.check_index()

    def test_main_owner_and_single_counter_survive_recovery(self):
        # Separate no-response project; the former response file is outside its scope.
        root = self.root / "no-response"
        root.mkdir()
        subprocess.run([GIT, "-C", str(root), "init", "-b", "master"], check=True, capture_output=True, env=self.env)
        text = "% CODEX-RULES-BEGIN\n% 作者约定。\n% CODEX-RULES-END\n% CODEX-REVIEW-STATE-BEGIN\n% CODEX-REVIEW-NEXT manuscript=1 response=z\n% CODEX-REVIEW-STATE-END\n\\documentclass{article}\n\\begin{document}\nAn original sentence.\n\\end{document}\n"
        (root / "article.tex").write_bytes(text.encode("utf-8"))
        r = m.Review(root, "article.tex", GIT)
        updates, _ = r.begin("first", ["article.tex"])
        r.persist(updates, m.digest(r.raw))
        r = m.Review(root, "article.tex", GIT)
        updates, result = r.propose({"file": "article.tex", "kind": "manuscript", "before": "An original sentence.", "after": "A proposed sentence."})
        r.persist(updates, m.digest(r.raw))
        r = m.Review(root, "article.tex", GIT)
        updates, _ = r.decide(["1"], [])
        r.persist(updates, m.digest(r.raw))
        r = m.Review(root, "article.tex", GIT)
        self.assertEqual(r.state["next"], [2, 26])
        self.assertEqual(r.state["edits"]["1"]["status"], "accepted")
        data = [l[len(m.DATA):] for l in r.text.splitlines() if l.startswith(m.DATA)][0]
        self.assertNotIn("next", json.loads(data))
        self.assertIn("% 作者约定。", r.text)
        self.assertEqual(m.letters(26), "z")
        self.assertEqual(m.letters(27), "aa")
        # A user-maintained counter that would reuse an issued ID blocks mutation.
        (root / "article.tex").write_bytes(r.text.replace("manuscript=2", "manuscript=1").encode("utf-8"))
        with self.assertRaises(m.Conflict):
            m.Review(root, "article.tex", GIT)

    def test_anchored_feedback_is_durable_and_not_a_rewrite(self):
        self.edit("section.tex", "The estimator is robust.", "The estimator can be robust.")
        r = self.review()
        info = r.inspect("1")
        original = (self.root / "section.tex").read_bytes()
        quote = "can be robust"
        start = info["candidate"].index(quote)
        result = self.runop("feedback", {"id":"1", "version":info["version"], "side":"candidate", "start":start,
                            "end":start+len(quote), "quote":quote, "text":"语气弱一点，保留公式。🙂\n不要改 % CODEX-REVIEW-STATE-BEGIN 或 % CODEX-REVIEW-STATE-END。"})
        self.assertFalse(result["rewritten"])
        self.assertEqual((self.root / "section.tex").read_bytes(), original)
        state = self.review().state
        note = state["edits"]["1"]["requests"][0]
        self.assertEqual(note["quote"], quote)
        self.assertEqual(note["status"], "open")
        self.assertEqual(state["edits"]["1"]["status"], "rework")
        self.assertEqual(state["next"], [2, 1])
        self.runop("propose", {"after":"The estimator is robust under the evaluated conditions.","resolve_requests":[note["id"]]}, "1")
        r = self.review()
        self.assertEqual(r.state["edits"]["1"]["requests"][0]["status"], "addressed-pending-review")
        self.assertEqual(r.payload(r.state["edits"]["1"])["before"], "The estimator is robust.")
        self.runop("decide", ["1"], [], {"1":r.state["edits"]["1"]["versions"][-1]})
        self.assertEqual(self.review().state["edits"]["1"]["requests"][0]["status"], "closed-by-author-acceptance")
        self.check_index()

    def test_stale_diff_decisions_and_invalid_selection_are_blocked(self):
        self.edit("reply.tex", "Thank you for the comment.", "Thank you for this suggestion.")
        r = self.review(); old = r.inspect("a")
        bad = {"id":"a", "version":old["version"], "side":"original", "start":0, "end":3, "quote":"wrong", "text":"请简短一些"}
        before = (self.root / "reply.tex").read_bytes()
        with self.assertRaises(m.Conflict): self.runop("feedback", bad)
        self.assertEqual((self.root / "reply.tex").read_bytes(), before)
        self.runop("propose", {"after":"Thank you for this useful suggestion."}, "a")
        before = (self.root / "reply.tex").read_bytes()
        with self.assertRaises(m.Conflict): self.runop("decide", [], ["a"], {"a":old["version"]})
        bad.update({"start":0,"end":0,"quote":""})
        with self.assertRaises(m.Conflict): self.runop("feedback", bad)
        self.assertEqual((self.root / "reply.tex").read_bytes(), before)
        self.check_index()

    def test_missing_objects_and_recovery_manual_conflict_are_explicit(self):
        self.edit("main.tex", "The model improves performance.", "The model may improve performance.")
        r = self.review()
        updates, _ = r.decide([], ["1"])
        original_write = r.write
        count = 0
        def interrupt(path, raw):
            nonlocal count
            count += 1
            if count == 2:
                raise OSError("simulated interruption")
            original_write(path, raw)
        r.write = interrupt
        with self.assertRaises(OSError):
            r.persist(updates, m.digest(r.raw))
        self.write("main.tex", self.read("main.tex") + "% concurrent author text\n")
        fresh = self.review()
        raw = (self.root / "main.tex").read_bytes()
        with self.assertRaises(m.Conflict):
            fresh.recover(m.digest(fresh.raw))
        self.assertEqual((self.root / "main.tex").read_bytes(), raw)
        with self.assertRaises(m.Conflict):
            fresh.contents("f" * 40, "main.tex")
        self.check_index()

    def test_preview_stale_state_path_and_legacy_guards(self):
        raw = (self.root / "reply.tex").read_bytes()
        p = subprocess.run([sys.executable, "-X", "utf8", str(HERE / "source_review.py"), "--repo", str(self.root),
                            "--state", "reply.tex", "--git", GIT, "propose"], input=json.dumps({"file": "main.tex", "kind": "manuscript", "before": "It remains efficient.", "after": "It is efficient."}).encode(), capture_output=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(json.loads(p.stdout)["applied"])
        self.assertEqual((self.root / "reply.tex").read_bytes(), raw)
        r = self.review()
        updates, _ = r.propose({"file": "main.tex", "kind": "manuscript", "before": "It remains efficient.", "after": "It is efficient."})
        with self.assertRaises(m.Conflict):
            r.persist(updates, "stale")
        with self.assertRaises(m.Conflict):
            r.path("../outside.tex")
        self.write("section.tex", "\\codexreplace{4}{new}{old}\n")
        with self.assertRaises(m.Conflict):
            self.runop("begin", "round-2", ["main.tex", "section.tex", "reply.tex"], None)
        self.check_index()

    def test_interrupted_multi_file_transaction_recovers(self):
        self.edit("main.tex", "The model improves performance.", "The model may improve performance.")
        self.edit("section.tex", "The estimator is robust.", "The estimator can be robust.")
        r = self.review()
        updates, _ = r.decide([], ["1", "2"])
        original_write = r.write
        count = 0

        def interrupt(path, raw):
            nonlocal count
            count += 1
            if count == 3:
                raise OSError("simulated process interruption")
            return original_write(path, raw)

        r.write = interrupt
        with self.assertRaises(OSError):
            r.persist(updates, m.digest(r.raw))
        fresh = self.review()
        self.assertTrue(fresh.interrupted)
        fresh.recover(m.digest(fresh.raw))
        self.assertIn("The model improves performance.", self.read("main.tex"))
        self.assertIn("The estimator is robust.", self.read("section.tex"))
        self.assertNotIn("transaction", self.review().state)
        self.check_index()


if __name__ == "__main__":
    print("Retained isolated fixtures: " + str(ROOT), flush=True)
    unittest.main(verbosity=2)
