/* Source-coordinate math rendering shared by the review webview and tests. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TeXScholarMath = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
    'use strict';
    function projection(raw, source = false) {
        let text = '', at = 0;
        const offsets = [];
        for (const line of raw.split(/(?<=\n)/)) {
            if (source || !/^[ \t]*%/.test(line)) for (let i = 0; i < line.length; i++) {offsets.push(at + i); text += line[i];}
            at += line.length;
        }
        offsets.push(raw.length);
        return {text, offsets, raw};
    }
    function escaped(text, at) {
        let count = 0;
        while (at > 0 && text[--at] === '\\') count++;
        return count % 2 === 1;
    }
    function segments(text) {
        const result = [];
        let at = 0, plain = 0;
        while (at < text.length) {
            if (text[at] === '%' && !escaped(text, at)) {const end = text.indexOf('\n', at); at = end < 0 ? text.length : end + 1; continue;}
            const verb = /^\\verb\*?([^A-Za-z\s])/.exec(text.slice(at));
            if (verb && !escaped(text, at)) {const end = text.indexOf(verb[1], at + verb[0].length); at = end < 0 ? at + verb[0].length : end + 1; continue;}
            const literal = /^\\begin\{(verbatim\*?|lstlisting|minted)\}/.exec(text.slice(at));
            if (literal && !escaped(text, at)) {const close = '\\end{' + literal[1] + '}', end = text.indexOf(close, at + literal[0].length); at = end < 0 ? text.length : end + close.length; continue;}
            let open, close, display = false, environment = false;
            if (!escaped(text, at)) {
                if (text.startsWith('$$', at)) {open = close = '$$'; display = true;}
                else if (text[at] === '$') open = close = '$';
                else if (text.startsWith('\\(', at)) {open = '\\('; close = '\\)';}
                else if (text.startsWith('\\[', at)) {open = '\\['; close = '\\]'; display = true;}
                else {
                    const env = /^\\begin\{((?:equation|align|alignat|gather|multline|flalign|eqnarray|displaymath|math)\*?)\}/.exec(text.slice(at));
                    if (env) {open = env[0]; close = '\\end{' + env[1] + '}'; display = env[1] !== 'math'; environment = true;}
                }
            }
            if (!open) {at++; continue;}
            let end = at + open.length;
            while (end < text.length && !(text.startsWith(close, end) && !escaped(text, end))) {
                if (text[end] === '%' && !escaped(text, end)) {const eol = text.indexOf('\n', end); if (eol < 0) {end = text.length; break;} end = eol + 1;}
                else end++;
            }
            if (end >= text.length || !display && /\r?\n[ \t]*\r?\n/.test(text.slice(at, end))) {at += open.length; continue;}
            if (plain < at) result.push({start: plain, end: at});
            const stop = end + close.length;
            result.push({start: at, end: stop, math: true, display,
                tex: environment ? text.slice(at, stop) : text.slice(at + open.length, end)});
            at = plain = stop;
        }
        if (plain < text.length) result.push({start: plain, end: text.length});
        return result;
    }
    function changedRanges(raw, changes, side) {
        const starts = [0], prefix = side === 'original' ? 'old' : 'new';
        for (const char of raw) starts.push(starts.at(-1) + char.length);
        return (changes || []).map(c => [starts[c[prefix + '_start']], starts[c[prefix + '_end']]]);
    }
    function previewTex(tex) {
        // Labels affect document references, not the visible mathematical body.
        // Keep them in source/annotations; KaTeX cannot resolve paper-wide refs.
        let result = '', at = 0;
        while (at < tex.length) {
            const verb = /^\\verb\*?([^A-Za-z\s])/.exec(tex.slice(at));
            if (verb && !escaped(tex, at)) {
                const end = tex.indexOf(verb[1], at + verb[0].length), stop = end < 0 ? tex.length : end + 1;
                result += tex.slice(at, stop); at = stop; continue;
            }
            const label = /^\\label\s*\{[^{}]*\}/.exec(tex.slice(at));
            if (label && !escaped(tex, at)) at += label[0].length;
            else result += tex[at++];
        }
        return result;
    }
    function rawBounds(model, start, end) {
        if (start < 0 || start >= end || end > model.text.length) return;
        return {start: model.offsets[start], end: model.offsets[end - 1] + 1};
    }
    function render(node, raw, changes, side, mode, katex) {
        const doc = node.ownerDocument, model = projection(raw, mode === 'source'), ranges = changedRanges(raw, changes, side);
        model.anchors = [];
        const fragment = doc.createDocumentFragment();
        function plain(parent, start, end) {
            let at = start;
            while (at < end) {
                const changed = ranges.some(([a, b]) => model.offsets[at] >= a && model.offsets[at] < b);
                let stop = at + 1;
                while (stop < end && ranges.some(([a, b]) => model.offsets[stop] >= a && model.offsets[stop] < b) === changed) stop++;
                const span = doc.createElement('span');
                span.className = changed ? side === 'original' ? 'old' : 'new' : 'same';
                span.textContent = model.text.slice(at, stop);
                parent.appendChild(span); model.anchors.push({node: span, start: at, end: stop}); at = stop;
            }
        }
        const parts = mode === 'source' ? [{start: 0, end: model.text.length}] : segments(model.text);
        for (const part of parts) {
            if (!part.math) {plain(fragment, part.start, part.end); continue;}
            const formula = doc.createElement('span'); formula.className = 'formula' + (part.display ? ' display-formula' : '');
            const preview = doc.createElement('span'); preview.className = 'math-preview';
            let error;
            if (!katex) error = '公式引擎未加载，可切换源码；不影响正文或 PDF。';
            else try {
                let denied = false;
                katex.render(previewTex(part.tex), preview, {displayMode: part.display, throwOnError: true,
                    trust: () => {denied = true; return false;}, output: 'htmlAndMathml', strict: 'warn'});
                if (denied) error = '此公式含外链、HTML 或资源命令，阅读预览不执行，已保留准确源码。';
            }
            catch (e) {if (!(e instanceof katex.ParseError)) throw e; error = '此公式暂不能预览，已显示准确源码：' + e.message;}
            if (error) {
                const notice = doc.createElement('small'); notice.className = 'math-error'; notice.textContent = error;
                formula.appendChild(notice); plain(formula, part.start, part.end);
            } else {
                formula.appendChild(preview);
                preview.title = '预览中的公式选区按整式绑定；细部请切换 LaTeX 源码。';
                model.anchors.push({node: preview, start: part.start, end: part.end, atomic: true});
                if (ranges.some(([a, b]) => a < b && model.offsets[part.start] < b && model.offsets[part.end - 1] + 1 > a)) {
                    const source = doc.createElement('details'); source.className = 'math-source-diff'; source.open = true;
                    const title = doc.createElement('summary'); title.textContent = '公式源码差异'; source.appendChild(title);
                    const code = doc.createElement('span'); code.className = 'math-code'; plain(code, part.start, part.end); source.appendChild(code); formula.appendChild(source);
                }
            }
            fragment.appendChild(formula);
        }
        if (!model.text.trim()) {
            fragment.appendChild(doc.createTextNode(side === 'original' ? '仅补充，无对应原句。' : '本项已删除，正式结果为不再保留这段内容。'));
        }
        node.replaceChildren(fragment);
        return model;
    }
    function selectedRange(node, range, model) {
        const doc = node.ownerDocument, begin = range.cloneRange(), end = range.cloneRange();
        begin.collapse(true); end.collapse(false);
        const anchors = model.anchors.filter(anchor => {
            const a = doc.createRange(), b = doc.createRange(); a.selectNodeContents(anchor.node); b.selectNodeContents(anchor.node);
            a.collapse(true); b.collapse(false);
            return a.compareBoundaryPoints(0, end) < 0 && b.compareBoundaryPoints(0, begin) > 0;
        });
        if (!anchors.length) return;
        function point(anchor, container, offset, isEnd) {
            if (anchor.atomic || !anchor.node.contains(container)) return isEnd ? anchor.end : anchor.start;
            const prefix = doc.createRange(); prefix.selectNodeContents(anchor.node); prefix.setEnd(container, offset);
            return anchor.start + prefix.toString().length;
        }
        const a = anchors[0], b = anchors.at(-1);
        const raw = rawBounds(model, point(a, range.startContainer, range.startOffset, false), point(b, range.endContainer, range.endOffset, true));
        return raw ? {...raw, wholeMath: anchors.some(a => a.atomic)} : undefined;
    }
    return {projection, segments, changedRanges, rawBounds, previewTex, render, selectedRange};
});
