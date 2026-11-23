"""Verify that explicitly removed plugin metadata is already in paper storage."""
from pathlib import Path
import base64
import json
import re
import sys
from document_roles import scan
from paper_background import read, read_roles


def verify(root, storage, plan):
    root = Path(root).resolve(strict=True)
    owner = plan['owner']
    raw = (root / owner).read_bytes()
    if raw != base64.b64decode(plan['owner_before'], validate=True):
        raise ValueError('待迁移源文件已变化。')
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
