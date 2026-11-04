'use strict';
// UI-only positions. The embedded machine ledger is never manuscript content.
function view(text) {
    const starts = [...text.matchAll(/^% CODEX-REVIEW-STATE-BEGIN\r?$/gm)];
    const ends = [...text.matchAll(/^% CODEX-REVIEW-STATE-END\r?$(?:\n)?/gm)];
    if (!starts.length && !ends.length) return {text, body: text};
    if (starts.length !== 1 || ends.length !== 1 || ends[0].index < starts[0].index) return;
    const start = starts[0].index, end = ends[0].index + ends[0][0].length;
    return {text, start, end, body: text.slice(0, start) + text.slice(end)};
}
const nativeOffset = (text, codepoints) => Array.from(text).slice(0, codepoints).join('').length;
function locateDisplay(data, current, previous = view(data.source.text)) {
    if (!current || !previous) return;
    const a = nativeOffset(previous.text, data.source.start), b = nativeOffset(previous.text, data.source.end);
    if (previous.start !== undefined && (a === b ? a >= previous.start && a < previous.end : a < previous.end && b > previous.start)) return;
    const logical = offset => previous.start !== undefined && offset >= previous.end ? offset - (previous.end - previous.start) : offset;
    let start = logical(a), end = logical(b);
    const excerpt = data[data.source.side];
    if (previous.body.slice(start, end) !== excerpt) return;
    if (previous.body !== current.body) {
        const left = previous.body.slice(Math.max(0, start - 120), start), right = previous.body.slice(end, end + 120);
        const matches = [];
        for (let at = 0; at <= current.body.length;) {
            const hit = excerpt ? current.body.indexOf(excerpt, at) : at;
            if (hit < 0) break;
            if (current.body.slice(Math.max(0, hit - left.length), hit) === left && current.body.slice(hit + excerpt.length, hit + excerpt.length + right.length) === right) matches.push(hit);
            at = hit + 1;
        }
        if (matches.length !== 1) return;
        start = matches[0]; end = start + excerpt.length;
    }
    const raw = offset => current.start !== undefined && offset >= current.start ? offset + current.end - current.start : offset;
    const result = {start: raw(start), end: raw(end)};
    if (current.start !== undefined && (result.start === result.end ? result.start >= current.start && result.start < current.end : result.start < current.end && result.end > current.start)) return;
    return result;
}
module.exports = {view, locateDisplay};
