'use strict';
exports.activate = async context => {
    await require('./setup').activate(context);
    require('./menu_commands').activate(context);
    require('./extension').activate(context);
    require('./backup').activate(context);
    require('./navigation').activate(context);
    require('./chktex_actions').activate(context);
    require('./questions').activate(context);
    await require('./document_roles').activate(context).ready;
    await require('./mcp_setup').activate(context).ready;
    await require('./writing').activate(context).ready;
    await require('./pdf_navigation').activate(context).ready;
    return require('./inline_review').activate(context);
};
