'use strict';
const vscode = require('vscode');

// Public command aliases change our menu labels without patching another extension.
// Forward the context URI and any other arguments unchanged.
const TARGETS = Object.freeze({
    build: 'latex-workshop.build',
    viewPdf: 'latex-workshop.view',
    forwardSync: 'latex-workshop.synctex',
    wordcount: 'latex-workshop.wordcount',
    formattedPaste: 'latex-utilities.formattedPaste',
    selectEnvironment: 'latex-workshop.select-env',
    wrapEnvironment: 'latex-workshop.wrap-env',
    renameEnvironment: 'latex-workshop.multicursor-envname',
    labeledBookmark: 'bookmarks.toggleLabeled',
    bookmarkList: 'bookmarks.list',
    bookmarkListAll: 'bookmarks.listFromAllFiles',
    bookmarkSelectLines: 'bookmarks.selectLines',
    bookmarkExpandNext: 'bookmarks.expandSelectionToNext',
    bookmarkExpandPrevious: 'bookmarks.expandSelectionToPrevious',
    bookmarkShrinkSelection: 'bookmarks.shrinkSelection',
    bookmarkClearFile: 'bookmarks.clear',
    bookmarkClearAll: 'bookmarks.clearFromAllFiles',
    bookmarkExport: 'bookmarks.export',
    bookmarkSettings: 'bookmarks.openSettings',
    openVisual: 'latexVisualEditor.openVisual',
    selectSection: 'latex-workshop.select-section',
    foldSection: 'editor.foldRecursively',
    unfoldSection: 'editor.unfoldRecursively',
    promoteSection: 'latex-workshop.promote-sectioning',
    demoteSection: 'latex-workshop.demote-sectioning'
});

function activate(context) {
    for (const [name, target] of Object.entries(TARGETS)) {
        context.subscriptions.push(vscode.commands.registerCommand('localLatex.menu.' + name,
            (...args) => vscode.commands.executeCommand(target, ...args)));
    }
}
module.exports = {activate, TARGETS};
