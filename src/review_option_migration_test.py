import copy
import unittest

from review_option_migration import CandidateMigrationError, prepare, project, selection_from_original, selection_segments, selection_to_original
from source_review import Conflict, Review
import json


class CandidateProjectionTests(unittest.TestCase):
    def setUp(self):
        self.raw = ('before\n% CODEX-PARAGRAPH-PLAN-BEGIN\n% plan\n'
                    '% CODEX-PARAGRAPH-PLAN-END\nafter α\n')
        self.proof = prepare(self.raw)

    def test_visible_source_and_immutable_selection(self):
        visible = project(self.raw, self.proof)
        self.assertEqual(visible, 'before\nafter α\n')
        start = visible.index('after')
        left, right = selection_to_original(self.raw, self.proof, start, start + len('after α'))
        self.assertEqual(self.raw[left:right], 'after α')
        self.assertEqual(selection_from_original(self.raw, self.proof, left, right), (start, start + len('after α')))
        with self.assertRaises(CandidateMigrationError):
            selection_from_original(self.raw, self.proof, 0, len(self.raw))
        with self.assertRaises(CandidateMigrationError):
            selection_to_original(self.raw, self.proof, 0, len(visible))
        spans = selection_segments(self.raw, self.proof, 0, len(visible))
        self.assertEqual(len(spans), 2)
        self.assertEqual(''.join(self.raw[s['start']:s['end']] for s in spans), visible)

    def test_changed_or_forged_proof_rejected(self):
        proof = copy.deepcopy(self.proof)
        proof['fragments'][0]['text'] = '% forged\n'
        with self.assertRaises(CandidateMigrationError):
            project(self.raw, proof)
        with self.assertRaises(CandidateMigrationError):
            project(self.raw + 'x', self.proof)

    def test_unknown_or_incomplete_markers_rejected(self):
        with self.assertRaises(CandidateMigrationError):
            prepare(self.raw.replace('% CODEX-PARAGRAPH-PLAN-END\n', ''))
        with self.assertRaises(CandidateMigrationError):
            prepare(self.raw + '% CODEX-UNRECOGNIZED data\n')

    def test_response_question_pair(self):
        link = ('% CODEX-RESPONSE reviewer=R1 changes=1,a\n'
                '% CODEX-QUESTION {"id":"R1","file":"x.tex","quote":"text"}\n')
        proof = prepare(link + self.raw)
        self.assertEqual(proof['question']['id'], 'R1')
        self.assertEqual(proof['dependencies'], ['1', 'a'])
        self.assertEqual(project(link + self.raw, proof), 'before\nafter α\n')

    def test_new_version_keeps_original_intent_and_rejects_forgery(self):
        old, new = '1' * 64, '2' * 64
        origin = {**self.proof, 'rule_source':f'candidate:session:1:{old}:A'}
        original = {'after':self.raw, 'options':[{'label':'A', 'after':self.raw}]}
        edit = {'versions':[old, new], 'block_id':'block', 'migration_item_id':'1',
                'option_migration':{old:{'A':origin}}}
        review = Review.__new__(Review)
        review.state = {'session':'session', 'edits':{'1':edit},
                        'option_migration_manifest':{'1':{old:['A']}}}
        review.contents = lambda version, name: json.dumps(original) if version == old else None
        edited = ''.join(p['text'] for p in origin['fragments']) + 'updated content\n'
        options = [{'label':'A', 'after':edited}]
        carried = review.carried_option_migration(edit, old, options)
        review.record_option_migration(edit, new, carried)
        self.assertEqual(review.option_effect(edit, {'after':edited, 'options':options}, new, 'A'), 'updated content\n')
        self.assertEqual(carried['A']['origin_version'], old)
        forged = copy.deepcopy(options)
        forged[0]['after'] = forged[0]['after'].replace('% plan', '% altered plan')
        with self.assertRaises(Conflict):
            review.option_effect(edit, {'after':edited, 'options':forged}, new, 'A')

    def test_missing_historical_proof_never_exposes_legacy_comment(self):
        old, new = '1' * 64, '2' * 64
        edit = {'file':'main.tex', 'versions':[old, new]}
        review = Review.__new__(Review)
        review.state = {'option_migration_complete':True, 'edits':{}, 'option_migration_manifest':{}}
        item = {'after':self.raw, 'options':[{'label':'A', 'after':self.raw}]}
        with self.assertRaisesRegex(Conflict, '精确迁移资料.*方案 A'):
            review.option_effect(edit, item, old, 'A')

    def test_manifest_and_option_identity_remain_required(self):
        version = '3' * 64
        proof = {**self.proof, 'rule_source':f'candidate:session:1:{version}:A'}
        edit = {'file':'main.tex', 'versions':[version], 'block_id':'block', 'migration_item_id':'1',
                'option_migration':{version:{'A':proof}}}
        review = Review.__new__(Review)
        review.state = {'session':'session', 'edits':{'1':edit}, 'option_migration_complete':True,
                        'option_migration_manifest':{'1':{version:['A']}}}
        item = {'after':self.raw, 'options':[{'label':'A', 'after':self.raw}]}
        self.assertEqual(review.option_effect(edit, item, version, 'A'), 'before\nafter α\n')
        review.state['option_migration_manifest']['1'][version] = ['B']
        with self.assertRaisesRegex(Conflict, '迁移清单不完整'):
            review.option_effect(edit, item, version, 'A')
        review.state['option_migration_manifest']['1'][version] = ['A']
        proof['rule_source'] = f'candidate:session:1:{version}:B'
        with self.assertRaisesRegex(Conflict, '来源与版本或方案不一致'):
            review.option_effect(edit, item, version, 'A')


if __name__ == '__main__':
    unittest.main()
