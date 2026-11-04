'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {parseSync, reviewPath} = require('./pdf_navigation');
test('review navigation uses actual SyncTeX coordinates and recognizes only stable review PDFs', () => {
    assert.deepEqual(parseSync('SyncTeX result begin\nPage:3\nx:123.5\ny:245.25\nSyncTeX result end'),
        {page: 3, x: 123.5, y: 245.25, indicator: true});
    assert.throws(() => parseSync('No result'), /SyncTeX/);
    assert.throws(() => parseSync('SyncTeX result begin\nPage:NaN\nx:0\ny:0\nSyncTeX result end'), /坐标/);
    assert(reviewPath('/paper/.latex-build/review-diff/current/main-review.pdf'));
    assert(reviewPath('D:\\paper\\.latex-build\\review-diff\\current\\reply-review.pdf'));
    assert(!reviewPath('/paper/main.pdf'));
    assert(!reviewPath('/paper/.latex-build/review-diff/old.pdf'));
});
test('navigation refuses stale PDF bytes and untrusted callback addresses before launching any viewer', async () => {
    const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
    const {locate} = require('./pdf_navigation');
    const root = await fs.mkdtemp(path.join(process.env.LOCAL_LATEX_TEST_ROOT, 'navigation-'));
    const folder = path.join(root, '.latex-build', 'review-diff', 'current');
    await fs.mkdir(folder, {recursive: true});
    const pdf = path.join(folder, 'main-review.pdf'), metaFile = path.join(folder, 'main-review.json');
    await fs.writeFile(pdf, 'isolated version fixture', 'utf8');
    const metadata = {pdf, compiled_pdf: pdf, targets: {'1': {file: path.join(root, 'derived.tex'), line: 1}}, versions: {'1': 'v1'}, pdf_digest: 'stale'};
    await fs.writeFile(metaFile, JSON.stringify(metadata), 'utf8');
    const vscode = {env: {uriScheme: 'vscode'}, Uri: {parse: value => {const u = new URL(value); return {scheme: u.protocol.slice(0, -1), authority: u.host, path: u.pathname};}}};
    const context = {extension: {id: 'local-research.latex-writing-tools'}}, c = {repo: root, id: '1', version: 'v1'};
    await assert.rejects(locate(vscode, context, metaFile, c), /版本不一致/);
    metadata.pdf_digest = crypto.createHash('sha256').update(await fs.readFile(pdf)).digest('hex');
    await fs.writeFile(metaFile, JSON.stringify(metadata), 'utf8');
    await fs.writeFile(metaFile.replace('.json', '.viewer.json'), JSON.stringify({pdf, viewer_uri: 'https://example.invalid/command'}), 'utf8');
    await assert.rejects(locate(vscode, context, metaFile, c), /地址无效/);
});
