'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const math = require('./review_math');
const katex = require('./vendor/katex/katex.min');

test('math delimiters preserve exact source spans, nested equations and literal TeX', () => {
    const source = String.raw`Cost \$5; \verb|$literal$|. $x_i^2$ and \(\frac{a}{b}\).
\[\sum_{i=1}^n x_i\]
\begin{equation}\begin{aligned}a&=b\\c&=d\end{aligned}\label{eq:test}\end{equation}
% $comment$ stays a comment
\begin{verbatim}$literal$\end{verbatim}
unclosed $tail`;
    const parts = math.segments(source), formulas = parts.filter(p => p.math);
    assert.equal(formulas.length, 4);
    assert.deepEqual(formulas.map(p => p.display), [false, false, true, true]);
    assert.equal(formulas[0].tex, 'x_i^2');
    assert.equal(formulas[1].tex, '\\frac{a}{b}');
    assert.equal(parts.map(p => source.slice(p.start, p.end)).join(''), source, 'no character is lost or reordered');
    assert(!formulas.some(p => /literal|comment|tail/.test(p.tex)));
});

test('CRLF, hidden author comments and Unicode map to exact original source, never rendered symbols', () => {
    const raw = '% 中文计划\r\n😀 Value $x_i$ stays.\r\nNext sentence.';
    const projected = math.projection(raw);
    const start = projected.text.indexOf('$'), end = projected.text.indexOf('$', start + 1) + 1;
    const bounds = math.rawBounds(projected, start, end);
    assert.equal(raw.slice(bounds.start, bounds.end), '$x_i$');
    assert.equal(math.projection(raw, true).text, raw);
    assert.equal(math.rawBounds(projected, 3, 3), undefined);
    const changed = math.changedRanges('😀 $x_i$', [{old_start: 3, old_end: 4, new_start: 3, new_end: 4}], 'original');
    assert.deepEqual(changed, [[4, 5]], 'backend code points become native UTF-16 offsets');
});

test('the bundled engine handles fractions, matrices and alignment offline; unsupported TeX remains detectable', () => {
    for (const tex of [String.raw`\frac{a_i^2}{\sum_{j=1}^{n}b_j}`, String.raw`\begin{bmatrix}1&0\\0&1\end{bmatrix}`,
        String.raw`\begin{aligned}x&=y+1\\z&=x^2\end{aligned}`]) {
        const html = katex.renderToString(tex, {throwOnError: true, trust: false});
        assert(html.includes('katex-mathml')); assert(html.includes('katex-html'));
    }
    assert.throws(() => katex.renderToString('\\notARealMacro{x}', {throwOnError: true, trust: false}), katex.ParseError);
    const unsafe = katex.renderToString('\\href{javascript:alert(1)}{x}', {trust: false, throwOnError: true});
    assert(!unsafe.includes('<a ')); assert(!unsafe.includes('href="javascript:'));
    let denied = false;
    katex.renderToString('\\href{javascript:alert(1)}{x}', {trust: () => {denied = true; return false;}});
    assert.equal(denied, true, 'the documented trust callback lets the UI expose source instead of a partial blocked-command rendering');
    katex.renderToString('\\gdef\\privateMacro{x}', {trust: false});
    assert.throws(() => katex.renderToString('\\privateMacro', {throwOnError: true, trust: false}), katex.ParseError, 'candidate-local definitions never leak to another option');
});

test('unclosed, escaped and commented delimiters never consume ordinary following paragraphs', () => {
    for (const value of [String.raw`\$x\$`, String.raw`\(unclosed`, '$open\n\nnext paragraph', '% $x$\nordinary words']) {
        const segments = math.segments(value);
        assert(!segments.some(p => p.math));
        assert.equal(segments.map(p => value.slice(p.start, p.end)).join(''), value);
    }
});

test('nonvisual equation labels do not block preview or disappear from the exact source span', () => {
    const tex = String.raw`\begin{equation}\label{eq:test}\frac{a}{b}=x\end{equation}`;
    const display = math.previewTex(tex);
    assert(!display.includes('label'));
    assert(katex.renderToString(display, {displayMode: true, throwOnError: true, trust: false}).includes('katex'));
    assert.equal(math.segments(tex)[0].tex, tex, 'notes and source mode retain the full labeled formula');
    assert.equal(math.previewTex(String.raw`\verb|\label{x}|`), String.raw`\verb|\label{x}|`);
});

test('percent escapes in prose remain distinct from math, literal commands and comments', () => {
    const raw = String.raw`90\% and $95\%$. \verb|\%| \begin{verbatim}\%\end{verbatim} % \% $comment$
Next $p$ and 2\%.`;
    const parts = math.segments(raw);
    assert.equal(parts.map(p => raw.slice(p.start, p.end)).join(''), raw);
    assert.deepEqual(parts.filter(p => p.math).map(p => p.tex), ['95\\%', 'p']);
    assert.deepEqual(parts.filter(p => p.literal).map(p => raw.slice(p.start, p.end)), [
        String.raw`\verb|\%|`, String.raw`\begin{verbatim}\%\end{verbatim}`, '% \\% $comment$\n']);
});
