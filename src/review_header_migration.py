"""Recognize only supported legacy header metadata during one-time migration."""
import re


REPLY_PREFIXES = ('% 回复信约定：', '% 摘录装配：', '% 回复篇幅约定：',
                  '% 颜色约定：', '% 回复排版约定：', '% 回复模板：')


def mapped_header(text, file):
    """Return exact top-of-file lines and roles; ordinary comments remain untouched."""
    lines = text.splitlines(keepends=True)
    head = next((i for i, line in enumerate(lines) if line.lstrip().startswith('\\documentclass')), None)
    if head is None:
        raise ValueError('源文件缺少明确的文档起点。')
    begin = [i for i in range(head) if lines[i].rstrip('\r\n') == '% CODEX-REVIEW-STATE-BEGIN']
    end = [i for i in range(head) if lines[i].rstrip('\r\n') == '% CODEX-REVIEW-STATE-END']
    if bool(begin) != bool(end) or len(begin) > 1 or len(end) > 1 or begin and begin[0] >= end[0]:
        raise ValueError('旧审核状态头不完整或不唯一。')
    metadata, records = [], []
    version_line = next((i for i in range(head) if lines[i].startswith('% CODEX-VERSION-CONTROL:')), None)
    if version_line is not None and sum(line.startswith('% CODEX-VERSION-CONTROL:') for line in lines[:head]) != 1:
        raise ValueError('旧版本控制资料不唯一。')
    for i, line in enumerate(lines[:head]):
        value = line.rstrip('\r\n')
        in_state = bool(begin and begin[0] < i < end[0])
        envelope = bool(begin and i in (begin[0], end[0]))
        machine = (envelope or value.startswith(('% CODEX-RULES-FILE:', '% CODEX-REVIEW-STATE-FILE:')) or
                   in_state and bool(re.fullmatch(r'% CODEX-REVIEW-(?:NEXT manuscript=[1-9][0-9]* response=[a-z]+|MIGRATED state=\.codex-review/state\.json)', value)))
        main_info = (i == version_line or version_line is not None and i in (version_line+1, version_line+2)
                     and value.startswith(('% Git 成果快照', '% 已有本机编译日志')))
        reply_info = value.startswith(REPLY_PREFIXES)
        if in_state and (not value.startswith('%') or value.startswith('% CODEX-') and not machine):
            raise ValueError('旧状态头包含未知机器字段。')
        if machine or in_state or main_info or reply_info:
            metadata.append(i)
            if not machine:
                records.append({'line':i + 1, 'text':line, 'source':f'{file}:header-line-{i + 1}',
                                'historical':'废弃' in value or value.startswith('% 唯一状态归属：')})
    if not metadata:
        raise ValueError('未找到已支持的旧头元信息。')
    return ''.join(line for i, line in enumerate(lines) if i not in metadata), records
