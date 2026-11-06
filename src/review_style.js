'use strict';
// Display preferences only, never author-source color macros or writing rules.
const defaults = Object.freeze({removedColor: '#d32f2f', addedColor: '#1565c0', unchangedColor: '',
    strikeDeleted: true, cardLayout: 'compact', showLegend: true, candidateFontSize: 16, candidateLineHeight: 1.5,
    fontFamily: '', controlFontSize: 13, translationFontSize: 15});
const screenKeys = Object.freeze(['fontFamily', 'candidateFontSize', 'candidateLineHeight', 'controlFontSize', 'translationFontSize', 'cardLayout']);
const pdfKeys = Object.freeze(['removedColor', 'addedColor', 'unchangedColor', 'strikeDeleted', 'showLegend']);
function read(config) {
    const style = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, config.get('reviewStyle.' + key, value)]));
    for (const key of ['removedColor', 'addedColor', 'unchangedColor'])
        if (!(key === 'unchangedColor' && style[key] === '') && !/^#[0-9a-f]{6}$/i.test(style[key])) throw new Error('审核颜色须为 #RRGGBB 格式。');
    if (!['compact', 'comfortable'].includes(style.cardLayout) || typeof style.strikeDeleted !== 'boolean' || typeof style.showLegend !== 'boolean'
        || !Number.isFinite(style.candidateFontSize) || style.candidateFontSize < 10 || style.candidateFontSize > 32
        || !Number.isFinite(style.candidateLineHeight) || style.candidateLineHeight < 1 || style.candidateLineHeight > 2.5
        || typeof style.fontFamily !== 'string'
        || !Number.isFinite(style.controlFontSize) || style.controlFontSize < 10 || style.controlFontSize > 24
        || !Number.isFinite(style.translationFontSize) || style.translationFontSize < 10 || style.translationFontSize > 32)
        throw new Error('审核样式配置无效，请检查插件设置。');
    return style;
}
module.exports = {defaults, read, screenKeys, pdfKeys};
