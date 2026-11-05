'use strict';
exports.activate = async context => {
    await require('./setup').activate(context);
    require('./menu_commands').activate(context);
    require('./extension').activate(context);
    require('./backup').activate(context);
    require('./navigation').activate(context);
    require('./chktex_actions').activate(context);
    require('./questions').activate(context);
    await require('./writing').activate(context).ready;
    require('./pdf_navigation').activate(context);
    return require('./inline_review').activate(context);
};
