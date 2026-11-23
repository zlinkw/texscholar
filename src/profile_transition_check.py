"""Verify that explicitly removed plugin metadata is already in paper storage."""
from pathlib import Path
import base64
import json
import re
import sys
from document_roles import scan
from paper_background import read, read_roles
from source_review import Review, letters


def verify(root, storage, plan):
    root = Path(root).resolve(strict=True)
    owner = plan['owner']
    raw = (root / owner).read_bytes()
    if raw != base64.b64decode(plan['owner_before'], validate=True):
        raise ValueError('待迁移源文件已变化。')
    if plan['kind'] == 'header-metadata':
        from review_header_migration import mapped_header
        checks = [item for item in plan['checks'] if item['file'] == '.codex-review/state.json']
        state_path = root / '.codex-review/state.json'
        if len(checks) != 1 or state_path.read_bytes() != base64.b64decode(checks[0]['before'], validate=True):
            raise ValueError('外置审核状态已变化。')
        review = Review(root, '.codex-review/state.json')
        current = scan(root, storage)
        if review.state.get('transaction') or current['authority'] != 'paper' or current['status'] != 'confirmed' or current['review_owner'] != '.codex-review/state.json':
            raise ValueError('论文资料或外置审核状态尚未成为唯一权威。')
        text = raw.decode('utf-8-sig')
        result, records = mapped_header(text, owner)
        encoded = (b'\xef\xbb\xbf' if raw.startswith(b'\xef\xbb\xbf') else b'') + result.encode('utf-8')
        if encoded != base64.b64decode(plan['owner_after'], validate=True):
            raise ValueError('头部转换包含未经核对的其他修改。')
        if '% CODEX-REVIEW-STATE-BEGIN' in text:
            if review.state.get('legacy_owner') != owner:
                raise ValueError('旧审核拥有文件不一致。')
            counters = re.findall(r'^% CODEX-REVIEW-NEXT manuscript=([1-9][0-9]*) response=([a-z]+)\r?$', text, re.M)
            if counters != [(str(review.state['next'][0]), letters(review.state['next'][1]))]:
                raise ValueError('旧计数与外置审核状态不一致。')
        pointer = re.findall(r'^% CODEX-REVIEW-STATE-FILE: (.+?)\r?$', text, re.M)
        if pointer and pointer != [review.state.get('legacy_owner')]:
            raise ValueError('旧审核指针与迁移身份不一致。')
        role_pointer = re.findall(r'^% CODEX-RULES-FILE: (.+?)\r?$', text, re.M)
        if role_pointer and role_pointer != [current['owner']]:
            raise ValueError('旧规则指针与已确认角色拥有文件不一致。')
        entries = read(storage, root, '.codex-review/state.json')['entries']
        expected_entries = plan.get('entries')
        if not isinstance(expected_entries, list) or len(expected_entries) != len(records):
            raise ValueError('头部来源与批准的论文资料不一致。')
        for record in records:
            matches = [entry for entry in entries if entry['source'] == record['source']]
            approved = [entry for entry in expected_entries if entry.get('source') == record['source']]
            if len(matches) != 1 or len(approved) != 1 or matches[0] != approved[0] or matches[0]['text'] != record['text'] or matches[0]['evidence'] != 'source':
                raise ValueError('论文资料中缺少准确来源及原文；未修改源文件。')
            if record['historical'] and (matches[0]['kind'] != 'other' or
                                         '覆盖' not in matches[0].get('scope', '') or '不构成当前操作许可' not in matches[0].get('scope', '')):
                raise ValueError('过时授权必须明确标记为已被覆盖的历史记录。')
        return {'verified':True}
    if plan['kind'] == 'retired-review-header':
        checks = [item for item in plan['checks'] if item['file'] == '.codex-review/state.json']
        if len(checks) != 1 or (root / '.codex-review/state.json').read_bytes() != base64.b64decode(checks[0]['before'], validate=True):
            raise ValueError('外置审核状态已变化。')
        review = Review(root, '.codex-review/state.json')
        if review.state.get('transaction') or review.state.get('legacy_owner') != owner:
            raise ValueError('审核迁移未完成或旧拥有文件不一致。')
        text = raw.decode('utf-8-sig')
        counters = re.findall(r'^% CODEX-REVIEW-NEXT manuscript=([1-9][0-9]*) response=([a-z]+)\r?$', text, re.M)
        expected = (str(review.state['next'][0]), letters(review.state['next'][1]))
        if counters != [expected]:
            raise ValueError('旧计数与外置审核状态不一致。')
        current = scan(root, storage)
        if current['authority'] != 'paper' or current['status'] != 'confirmed' or current['review_owner'] != '.codex-review/state.json':
            raise ValueError('论文资料或外置审核状态尚未成为权威。')
        return {'verified':True}
    roles = read_roles(storage, root)
    if roles['record'] is None:
        raise ValueError('论文资料尚未保存文件角色。')
    current = scan(root, storage, roles['record'])
    if current['authority'] != 'paper-pending' or current['status'] != 'confirmed' or current['owner'] != owner or current['review_owner'] is None:
        raise ValueError('待迁移角色与旧登记不一致。')
    entries = read(storage, root, current['review_owner'])['entries']
    text = raw.decode('utf-8-sig')
    for name in plan['remove']:
        if name == 'CODEX-FILE-ROLES':
            continue
        if name not in ('CODEX-RULES', 'CODEX-WRITING-PROFILE'):
            raise ValueError('不支持的待迁移注释块。')
        pattern = r'^% ' + name + r'-BEGIN\r?$[\s\S]*?^% ' + name + r'-END\r?$(?:\n)?'
        matches = list(re.finditer(pattern, text, re.M))
        if len(matches) != 1:
            raise ValueError('待迁移规则块不唯一。')
        entry = {'kind':'constraints', 'text':matches[0].group(), 'evidence':'author', 'source':owner + ':' + name}
        if entry not in entries:
            raise ValueError('论文资料中缺少精确迁移的规则；未修改源文件。')
    return {'verified':True}


if __name__ == '__main__':
    try:
        value = json.load(sys.stdin)
        print(json.dumps(verify(value['root'], value['storage'], value['plan'])))
    except (OSError, ValueError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
