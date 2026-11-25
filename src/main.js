'use strict';
let reviewHost;
exports.activate = async context => {
    require('./quick_actions').activate(context);
    try {reviewHost = await require('./review_host_bridge').activate(context);}
    catch (error) {require('vscode').window.showErrorMessage('审核宿主登记失败，外置状态的受控源码写入不可用：' + error.message);}
    await require('./setup').activate(context);
    require('./menu_commands').activate(context);
    require('./extension').activate(context);
    require('./backup').activate(context);
    require('./navigation').activate(context);
    require('./chktex_actions').activate(context);
    require('./questions').activate(context);
    await require('./document_roles').activate(context).ready;
    await require('./mcp_setup').activate(context).ready;
    require('./updates').activate(context);
    await require('./writing').activate(context).ready;
    await require('./pdf_navigation').activate(context).ready;
    const inline = require('./inline_review').activate(context);
    if (reviewHost) context.subscriptions.push({dispose:reviewHost.onHeaderSettled(root => inline.headerSettled(root))});
    return inline;
};
exports.deactivate = async () => {if (reviewHost) await reviewHost.close();};
