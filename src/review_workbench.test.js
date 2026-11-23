'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {createWorkbench, html, filterItems, staleBatchSelections} = require('./review_workbench');

test('question entries use open note counts from their respective data contracts', () => {
    const fs=require('node:fs'),vm=require('node:vm');
    const source=fs.readFileSync(require.resolve('./review_workbench_client'),'utf8');
    const notes=[{status:'open',text:'keep'},{status:'resolved',text:'old'}];
    const context={selectedQuestion:'__unbound__',questionRows:[{key:'q',entries:[{id:'linked',requests:notes,card:{}},{id:'closed',requests:[]}]}],directoryItems:[{id:'linked',requests:1},{id:'unbound',requests:2},{id:'empty',requests:0}]};
    const entries=vm.runInNewContext('('+source.slice(source.indexOf('function questionEntries('),source.indexOf('\nfunction questionEntryDraft(',source.indexOf('function questionEntries(')))+')',context);
    assert.deepEqual(Array.from(entries(),item=>[item.id,item.openRequests,item.requests]),[['unbound',2,2],['empty',0,0]]);
    context.selectedQuestion='q';const linked=entries();assert.equal(linked[0].openRequests,1);assert.equal(linked[0].requests,notes);
});

test('question card controls reflect coordination and their own target state', () => {
    const fs=require('node:fs'),vm=require('node:vm');
    const source=fs.readFileSync(require.resolve('./review_workbench_client'),'utf8');
    const context={current:{id:'1',version:'v1'},data:{source_match:false},waiting:false,coordinating:false,unavailable:true,conflict:true};
    const disabled=vm.runInNewContext('('+source.slice(source.indexOf('function cardButtonDisabled('),source.indexOf('\nfunction buttons()',source.indexOf('function cardButtonDisabled(')))+')',context);
    const button=(id,intent,mismatch=false)=>({dataset:{target:id,targetVersion:'v1',intent,targetMismatch:String(mismatch)}});
    assert(disabled(button('1','accept')));assert(disabled(button('1','preview')));
    assert(!disabled(button('2','accept')));assert(!disabled(button('2','preview')));
    context.data.source_match=true;assert(disabled(button('1','accept')));assert(!disabled(button('1','preview')));assert(!disabled(button('2','accept')));
    assert(disabled(button('2','accept',true)));assert(disabled(button('2','preview',true)));
    assert(!disabled(button('2','editToggle',true)));assert(!disabled(button('2','optionNote',true)));
    context.coordinating=true;assert(disabled(button('2','accept')));assert(!disabled(button('2','preview')));assert(!disabled(button('2','editToggle')));assert(!disabled(button('2','optionNote')));
    context.waiting=true;for(const intent of ['accept','preview','editToggle','optionNote']) assert(disabled(button('2',intent)));
    context.waiting=false;context.coordinating=false;assert(!disabled(button('2','accept')));
});

test('question card actions route only to the exact linked item, version and session', async () => {
    let receive, session='batch', gate;
    const messages=[], calls=[];
    const one={repo:'/fixture',owner:'owner',id:'1',version:'v1'}, two={...one,id:'2',version:'v2'};
    const data=id=>({id,version:id==='1'?'v1':'v2',original:'old '+id,source_match:true,edit:{file:id+'.tex',kind:'manuscript',versions:[id==='1'?'v1':'v2'],requests:[],questions:[{id:'Q',file:'r',quote:'same'}]},options:[{label:'A',after:'new '+id,reason:'A',changes:[]}]});
    const records=new Map([['1',{c:one,data:data('1')}],['2',{c:two,data:data('2')}]]);
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{showWarningMessage:async()=>undefined,createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
    const state={get:(_k,fallback)=>fallback,update:async()=>{}};
    const services={session:()=>session,read:async c=>{if(gate && c.id==='2') await gate;return structuredClone(records.get(c.id).data);},style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[],questions:()=>[{key:'q',snapshot:'[]',entries:[{id:'1',version:'v1'},{id:'2',version:'v2'}]}],preview:async (...args)=>calls.push(args)};
    const view=createWorkbench(vscode,{subscriptions:[],workspaceState:state},services);view.setRecords(records);await view.show(one);await receive({type:'ready',instance:'page'});
    const action={type:'questionCard',instance:'page',repo:one.repo,owner:one.owner,id:'1',version:'v1',session:'batch',questionKey:'q',target:'2',targetVersion:'v2',option:'A',intent:'preview'};
    await receive({...action,targetVersion:'old'});assert.equal(view.active.id,'1');assert(messages.some(m=>m.error));
    await receive({...action,session:'old'});assert.equal(view.active.id,'1');
    await receive({...action,option:'B'});assert.equal(view.active.id,'1');
    const draft={c:one,drafts:{A:'unsaved candidate'},blockDraft:'unsaved source',note:'unsaved note',purpose:'personal'};
    await receive({type:'dirty',instance:'page',id:'1',version:'v1',dirty:true,noteDirty:true,state:draft});
    await receive(action);assert.equal(view.active.id,'1');assert.equal(calls.length,0);
    await receive({type:'dirty',instance:'page',id:'1',version:'v1',dirty:false,noteDirty:false,state:draft});
    await receive(action);assert.equal(view.active.id,'2');
    const intent=messages.findLast(m=>m.pendingCardAction)?.pendingCardAction;
    assert.equal(intent.c.id,'2');assert.equal(intent.c.version,'v2');assert.equal(intent.option,'A');assert.equal(calls.length,0);
    session='new batch';await receive({type:'cardActionClaim',instance:'page',token:intent.token});assert(!messages.some(m=>m.type==='cardActionGrant'));
    session='batch';await receive({type:'cardActionClaim',instance:'other',token:intent.token});assert(!messages.some(m=>m.type==='cardActionGrant'));
    await receive({type:'cardActionClaim',instance:'page',token:intent.token});
    await receive({type:'cardActionClaim',instance:'page',token:intent.token});
    assert.equal(messages.filter(m=>m.type==='cardActionGrant').length,1);
    await receive({type:'preview',instance:'page',repo:two.repo,owner:two.owner,id:'2',version:'v2',option:'A'});
    assert.equal(calls.length,1);assert.equal(calls[0][0].id,'2');
    await view.show(one);let release;gate=new Promise(resolve=>{release=resolve;});
    const pending=receive(action);await Promise.resolve();await view.show(one);release();await pending;
    assert.equal(view.active.id,'1');assert.equal(calls.length,1);assert(messages.some(m=>m.error && m.message.includes('取消')));
    gate=undefined;
    await receive({...action,intent:'open',option:undefined});
    const opened=messages.findLast(m=>m.pendingCardAction)?.pendingCardAction;
    assert.equal(opened.intent,'open');assert.equal(opened.c.id,'2');assert.equal(opened.c.version,'v2');
    await receive({type:'cardActionClaim',instance:'page',token:opened.token});
    assert.equal(messages.findLast(m=>m.type==='cardActionGrant').action.intent,'open');
});

test('translation keeps candidate identity separate and reports a pure display formula', async () => {
    let receive; const calls=[],messages=[];
    const c={repo:'/translation',owner:'state',id:'1',version:'v1'};
    const data={version:'v1',original:'Option A: prose',source_match:true,edit:{file:'main.tex',kind:'manuscript',versions:['v1'],requests:[]},options:[{label:'A',after:'Option A: prose',reason:'A',changes:[]},{label:'B',after:'$$x=1$$',reason:'B',changes:[]}]};
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
    const services={read:async()=>data,style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,provider:()=> 'fixture',directory:()=>[],translate:async(text,provider,item)=>{calls.push({text,kind:item.kind,option:item.option});return {text,noTranslation:item.option==='B'?'纯行间公式无需翻译。':undefined};}};
    const view=createWorkbench(vscode,{subscriptions:[]},services);view.setRecords(new Map([['1',{c,data}]]));await view.show(c);await receive({type:'ready',instance:'page'});
    await receive({type:'translate',instance:'page',id:'1',version:'v1'});await view.whenTranslationIdle();
    assert.equal(calls.length,3);assert.equal(calls[0].kind,undefined);assert.equal(calls[1].option,'A');
    assert(messages.some(message=>message.key==='B' && message.noTranslation==='纯行间公式无需翻译。'));
    await receive({type:'translate',instance:'page',id:'1',version:'v1'});await view.whenTranslationIdle();assert.equal(calls.length,3);
});

test('translation shows restoration warnings and supplier failure', async () => {
    let receive;const messages=[];
    const c={repo:'/translation',owner:'state',id:'1',version:'v1'},data={version:'v1',original:'Old text',source_match:true,edit:{file:'main.tex',kind:'manuscript',versions:['v1'],requests:[]},options:[{label:'A',after:'New text',reason:'A',changes:[]}]};
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
    const services={read:async()=>data,style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,provider:()=> 'fixture',directory:()=>[],translate:async text=>{if(text==='Old text')return {text:'旧文',warning:'部分公式未完整还原'};throw Error('供应商不可用');}};
    const view=createWorkbench(vscode,{subscriptions:[]},services);view.setRecords(new Map([['1',{c,data}]]));await view.show(c);await receive({type:'ready',instance:'page'});
    await receive({type:'translate',instance:'page',id:'1',version:'v1'});await view.whenTranslationIdle();
    assert(messages.some(m=>m.type==='translationStatus'&&m.message.includes('部分公式未完整还原')));
    assert(messages.some(m=>m.type==='translation'&&m.key==='A'&&m.error==='供应商不可用'));
});

test('automatic paragraph translation only requests visible source areas', async () => {
    let receive;const calls=[];
    const c={repo:'/visible',owner:'state',id:'1',version:'v1'},data={version:'v1',original:'Old text',source_match:true,edit:{file:'main.tex',kind:'manuscript',versions:['v1'],requests:[],questions:[]},options:[{label:'A',after:'Visible text',reason:'A',changes:[]},{label:'B',after:'Hidden text',reason:'B',changes:[]}]};
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage(){}}})}};
    const services={read:async()=>data,style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>true,provider:()=> 'fixture',directory:()=>[],translate:async text=>{calls.push(text);return {text:'中文 '+text};}};
    const view=createWorkbench(vscode,{subscriptions:[]},services);view.setRecords(new Map([['1',{c,data}]]));await view.show(c);await receive({type:'ready',instance:'page'});await view.whenTranslationIdle();assert.deepEqual(calls,[]);
    await receive({type:'paragraphTranslationView',instance:'page',...c,visible:['A']});await view.whenTranslationIdle();assert.deepEqual(calls,['Visible text']);
    await receive({type:'paragraphTranslationView',instance:'page',...c,visible:['original']});await view.whenTranslationIdle();assert.deepEqual(calls,['Visible text','Old text']);
});

test('question translation requests use the displayed card identity and do not translate other cards', async () => {
    let receive, handoffs=0; const calls=[], messages=[], notes=[];
    const c={repo:'/fixture',owner:'state',id:'1',version:'v1'}, other={...c,id:'2',version:'v2'};
    const question={id:'Q',file:'review.txt',quote:'Explain this method.'}, questionKey=JSON.stringify([question.id,question.file,question.quote]);
    const make=(id,version)=>({version,original:'Original '+id,source_match:true,edit:{file:id+'.tex',kind:'manuscript',versions:[version],requests:[],questions:[question]},options:[{label:'A',after:'Changed '+id,reason:'A',changes:[]},{label:'B',after:'$$x=1$$',reason:'B',changes:[]}]});
    const one=make('1','v1'),two=make('2','v2');
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
    const state={get:(_k,fallback)=>fallback,update:async()=>{}};
    const services={read:async()=>one,session:()=> 'session',style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,provider:()=> 'fixture',directory:()=>[],questions:()=>[{key:questionKey,question,entries:[{id:'1',version:'v1'},{id:'2',version:'v2'}],snapshot:'[]'}],translate:async text=>{calls.push(text);return text==='$$x=1$$' ? {noTranslation:'纯行间公式无需翻译。'} : {text:'中文 '+text};},note:async (...args)=>notes.push(args),handoff:async target=>{assert.equal(target.id,'2');if (++handoffs===1) throw Error('offline');}};
    const view=createWorkbench(vscode,{subscriptions:[],workspaceState:state},services);view.setRecords(new Map([['1',{c,data:one}],['2',{c:other,data:two}]]));await view.show(c);await receive({type:'ready',instance:'page'});
    const viewKey=JSON.stringify(['session',questionKey,'full','question']), displayKey=JSON.stringify(['session',questionKey,'2','v2','candidate','A','full','Changed 2']);
    await receive({type:'questionTranslationView',instance:'page',...c,session:'session',view:viewKey,visible:[displayKey]});
    await receive({type:'questionTranslate',instance:'page',...c,session:'session',questionKey,target:'2',targetVersion:'v2',side:'candidate',option:'A',viewStyle:'full',source:'Changed 2',view:viewKey,displayKey,retry:true});
    await view.whenTranslationIdle();
    assert.deepEqual(calls,['Changed 2']);
    assert(messages.some(m=>m.type==='questionTranslation' && m.target==='2' && m.targetVersion==='v2' && m.option==='A' && m.text==='中文 Changed 2'));
    await receive({type:'note',instance:'page',...c,side:'translation',provider:'fixture',questionTranslationKey:displayKey,questionTarget:'2',questionTargetVersion:'v2',questionKey,questionSide:'candidate',option:'A',questionSource:'Changed 2',questionViewStyle:'full',session:'session',value:'中文 Changed 2',start:0,end:2,text:'核对译文'});
    assert.equal(notes[0][0].id,'2');assert.equal(notes[0][0].version,'v2');
    assert.equal(notes[0][1].option,'A');assert.equal(notes[0][1].quote,'Changed 2');assert.equal(notes[0][1].display_context.quote,'中文');
    assert.deepEqual(notes[0][1].display_context.review_question,question);
    const sourceKey=JSON.stringify(['session',questionKey,'2','v2','candidate','A','full','Changed 2']);
    await receive({type:'note',instance:'page',...c,side:'candidate',questionSourceKey:sourceKey,questionTarget:'2',questionTargetVersion:'v2',questionKey,option:'A',questionSource:'Changed 2',questionViewStyle:'full',session:'session',value:'Changed 2',start:0,end:7,text:'核对原文'});
    assert.equal(notes[1][0].id,'2');assert.equal(notes[1][0].version,'v2');assert.equal(notes[1][1].quote,'Changed');assert.equal(notes[1][1].option,'A');
    await receive({type:'note',instance:'page',...c,side:'candidate',questionSourceKey:sourceKey,questionTarget:'2',questionTargetVersion:'old',questionKey,option:'A',questionSource:'Changed 2',questionViewStyle:'full',session:'session',value:'Changed 2',start:0,end:7,text:'过期'});
    assert.equal(notes.length,2,'stale card selection is rejected');
    const quoteKey=JSON.stringify(['session',questionKey,'2','v2','question','','full',question.quote]);
    await receive({type:'note',instance:'page',...c,side:'question',questionSourceKey:quoteKey,questionTarget:'2',questionTargetVersion:'v2',questionKey,questionSource:question.quote,questionViewStyle:'full',session:'session',value:question.quote,start:0,end:7,text:'核对问题'});
    assert.equal(notes[2][0].id,'2');assert.equal(notes[2][1].display_context.quote,'Explain');assert.deepEqual(notes[2][1].display_context.question,question);
    await receive({type:'note',instance:'page',...c,side:'translation',provider:'fixture',questionTranslationKey:displayKey,questionTarget:'2',questionTargetVersion:'v2',questionKey,questionSide:'candidate',option:'A',questionSource:'Changed 2',questionViewStyle:'full',session:'session',value:'中文 Changed 2',start:0,end:2,text:'核对译文',handoff:true});
    assert(messages.some(message=>message.error && message.message.includes('加入 Codex 失败')));
    await receive({type:'retryHandoff',instance:'page',...c});assert.equal(handoffs,2);assert.equal(notes.length,4,'retry must not save the note again');
    await receive({type:'questionTranslate',instance:'page',...c,session:'session',questionKey,target:'2',targetVersion:'old',side:'candidate',option:'A',viewStyle:'full',source:'Changed 2',view:viewKey,displayKey,retry:true});
    assert.deepEqual(calls,['Changed 2'],'a stale card must not be translated');
    const firstKey=JSON.stringify(['session',questionKey,'1','v1','candidate','A','full','Changed 1']);
    await receive({type:'questionTranslate',instance:'page',...c,session:'session',questionKey,target:'1',targetVersion:'v1',side:'candidate',option:'A',viewStyle:'full',source:'Changed 1',view:viewKey,displayKey:firstKey,retry:true});
    assert.deepEqual(calls,['Changed 2','Changed 1']);
    const mathKey=JSON.stringify(['session',questionKey,'1','v1','candidate','B','full','$$x=1$$']);
    await receive({type:'questionTranslate',instance:'page',...c,session:'session',questionKey,target:'1',targetVersion:'v1',side:'candidate',option:'B',viewStyle:'full',source:'$$x=1$$',view:viewKey,displayKey:mathKey,retry:true});
    assert(messages.some(message=>message.type==='questionTranslation' && message.option==='B' && message.noTranslation==='纯行间公式无需翻译。'));
});

test('question translation discards late results and retries a visible provider failure only on request', async () => {
    let receive, release, attempt=0, provider='fixture'; const messages=[];
    const c={repo:'/fixture',owner:'state',id:'1',version:'v1'}, question={id:'Q',file:'review.txt',quote:'Explain.'};
    const questionKey=JSON.stringify([question.id,question.file,question.quote]);
    const data={version:'v1',original:'Old text',source_match:true,edit:{file:'main.tex',kind:'manuscript',versions:['v1'],requests:[],questions:[question]},options:[{label:'A',after:'New text',reason:'A',changes:[]}]};
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
    const state={get:(_k,fallback)=>fallback,update:async()=>{}};
    const services={read:async()=>data,session:()=> 'session',style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>true,provider:()=>provider,directory:()=>[],questions:()=>[{key:questionKey,question,entries:[{id:'1',version:'v1'}],snapshot:'[]'}],translate:async()=>{attempt++;if(attempt===1)return await new Promise(resolve=>{release=resolve;});if(attempt===2)throw Error('HTTP 429');return {text:'新文'};}};
    const view=createWorkbench(vscode,{subscriptions:[],workspaceState:state},services);view.setRecords(new Map([['1',{c,data}]]));await view.show(c);await receive({type:'ready',instance:'page'});
    const key=JSON.stringify(['session',questionKey,'1','v1','candidate','A','full','New text']), current=JSON.stringify(['session',questionKey,'full','question']);
    const sendView=(viewKey,visible)=>receive({type:'questionTranslationView',instance:'page',...c,session:'session',view:viewKey,visible});
    const request={type:'questionTranslate',instance:'page',...c,session:'session',questionKey,target:'1',targetVersion:'v1',side:'candidate',option:'A',viewStyle:'full',source:'New text',view:current,displayKey:key,auto:true};
    await sendView(current,[key]);const pending=receive(request);await new Promise(resolve=>setImmediate(resolve));
    await sendView(JSON.stringify(['session',questionKey,'snippets','question']),[]);release({text:'旧译文'});await pending;
    assert(!messages.some(message=>message.type==='questionTranslation'));
    await sendView(current,[key]);await receive({...request,auto:false,retry:true});
    assert(messages.some(message=>message.type==='questionTranslation' && message.error==='HTTP 429'));
    await receive(request);assert.equal(attempt,2,'automatic refresh preserves the failure and does not retry');
    await receive({...request,auto:false,retry:true});assert.equal(attempt,3);
    assert(messages.some(message=>message.type==='questionTranslation' && message.text==='新文'));
    provider='other';view.settingsChanged();await sendView(current,[key]);await receive({...request,auto:false,retry:true});
    assert.equal(attempt,4);assert(messages.some(message=>message.type==='questionTranslation' && message.provider==='other'));
});

test('successful translations are reused across cards and modes with exact note identities', async () => {
    let receive, provider='fixture'; const messages=[], calls=[], notes=[];
    const one={repo:'/fixture',owner:'state',id:'1',version:'v1'}, two={...one,id:'2',version:'v2'};
    const question={id:'Q',file:'review.txt',quote:'Shared text'}, questionKey=JSON.stringify([question.id,question.file,question.quote]);
    const make=version=>({version,original:'Shared text',source_match:true,edit:{file:'main.tex',kind:'manuscript',versions:[version],requests:[],questions:[question]},options:[{label:'A',after:'Shared text',reason:'A',changes:[]},{label:'B',after:'Shared text',reason:'B',changes:[]}]});
    const records=new Map([['1',{c:one,data:make('v1')}],['2',{c:two,data:make('v2')}]]);
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
    const services={read:async c=>records.get(c.id).data,session:()=> 'session',style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,provider:()=>provider,directory:()=>[],questions:()=>[{key:questionKey,question,entries:[{id:'1',version:'v1'},{id:'2',version:'v2'}],snapshot:'[]'}],translate:async(text,p,item)=>{calls.push([text,p,item.kind||'',item.option||'']);return {text:'中文 '+text};},note:async(...args)=>{notes.push(args);return {};}};
    const view=createWorkbench(vscode,{subscriptions:[],workspaceState:{get:(_k,fallback)=>fallback,update:async()=>{}}},services);view.setRecords(records);await view.show(one);await receive({type:'ready',instance:'page'});
    await receive({type:'translateCard',instance:'page',...one,option:'A'});
    assert.equal(calls.length,1);
    await receive({type:'reviewMode',instance:'page',...one,mode:'question',questionKey,viewStyle:'full'});
    const current=JSON.stringify(['session',questionKey,'full','question']);
    const req=(target,side='candidate',option='A')=>{const displayKey=JSON.stringify(['session',questionKey,target.id,target.version,side,option,'full','Shared text']);return {type:'questionTranslate',instance:'page',...one,session:'session',questionKey,target:target.id,targetVersion:target.version,side,option,viewStyle:'full',source:'Shared text',view:current,displayKey,retry:true};};
    await receive({type:'questionTranslationView',instance:'page',...one,session:'session',view:current,visible:[]});
    const a=req(one),b=req(two);await receive(a);await receive(b);
    assert.equal(calls.length,1,'paragraph success is reused by both valid cards');
    assert.deepEqual(messages.filter(m=>m.type==='questionTranslation').map(m=>[m.target,m.targetVersion,m.option,m.displayKey]),[['1','v1','A',a.displayKey],['2','v2','A',b.displayKey]]);
    await receive({type:'note',instance:'page',...one,side:'translation',provider:'fixture',questionTranslationKey:b.displayKey,questionTarget:'2',questionTargetVersion:'v2',questionKey,questionSide:'candidate',option:'A',questionSource:'Shared text',questionViewStyle:'full',session:'session',value:'中文 Shared text',start:0,end:2,text:'核对'});
    assert.equal(notes[0][0].id,'2');assert.equal(notes[0][0].version,'v2');assert.equal(notes[0][1].option,'A');assert.deepEqual(notes[0][1].display_context.review_question,question);
    await receive(req(one,'candidate','B'));await receive(req(one,'original',''));
    assert.deepEqual(calls.map(call=>call.slice(2)),[['candidate','A'],['candidate','B'],['','']]);
    const snippets=JSON.stringify(['session',questionKey,'snippets','question']);
    await receive({type:'questionTranslationView',instance:'page',...one,session:'session',view:snippets,visible:[]});
    const snippet={...a,viewStyle:'snippets',view:snippets,displayKey:JSON.stringify(['session',questionKey,'1','v1','candidate','A','snippets','Shared text'])};
    await receive(snippet);assert.equal(calls.length,3,'identical snippet text shares successful content');
    await receive({type:'reviewMode',instance:'page',...one,mode:'paragraph'});
    await receive({type:'translateCard',instance:'page',...one,option:'B'});
    assert.equal(calls.length,3,'question success is reused by paragraph mode');
    await receive({type:'reviewMode',instance:'page',...one,mode:'question',questionKey,viewStyle:'full'});
    await receive({type:'questionTranslationView',instance:'page',...one,session:'session',view:current,visible:[]});
    provider='other';await receive(a);assert.equal(calls.length,4,'different providers cannot share results');
});

test('question excerpts retain complete multiline math and Unicode change coordinates', () => {
    const math=require('./review_math'), excerpt=math.questionExcerpt;
    const old='远处 😀\nunchanged\n\\begin{alignat*}{2}\nx &= 1 \\\\\n+y &= 2\n\\end{alignat*}\nnear end\nfar end\n';
    const now=old.replace('y &= 2','y &= 3');
    const changes=math.wordChanges(old,now);
    for (const [text,side,number] of [[old,'old','2'],[now,'new','3']]) {
        const value=excerpt(text,changes,side);
        assert(value.includes('\\begin{alignat*}{2}'));
        assert(value.includes('y &= '+number));
        assert(value.includes('\\end{alignat*}'));
        assert(!value.includes('远处 😀'));
    }
    const inserted='one\ntwo\nthree\nfour\nfive\n', modified=inserted.replace('three','three plus');
    assert(excerpt(modified,math.wordChanges(inserted,modified),'new').includes('three plus'));
    const range=math.questionExcerptRange(now,changes,'new');
    assert.equal(Array.from(now).slice(range.start,range.end).join(''),range.text);
    const multiline='far\ncontext\nA \\cite{one,\ntwo} changed\nend\nfar end';
    assert.equal(excerpt(multiline,math.wordChanges(multiline,multiline.replace('changed','revised')),'old'),multiline);
});

test('hidden stale batch choices remain selected until explicitly reconsidered', () => {
    const selection=new Map([['3',{id:'3',version:'v1',option:'B'}],['a',{id:'a',version:'v1',option:'C'}]]);
    const directory=[{id:'3',version:'v2',options:['A','B']},{id:'a',version:'v1',options:['A','B','C']}];
    assert.deepEqual(staleBatchSelections(selection,directory).map(item=>item.id),['3']);
    assert.equal(selection.get('3').version,'v1');
    assert.deepEqual(staleBatchSelections(selection,directory.filter(item=>item.id!=='a')).map(item=>item.id),['3','a']);
});

test('coordination follows the active scope and old completion cannot release a newer operation', async () => {
    let receive; const messages=[];
    const c={repo:'/fixture',owner:'state',id:'1',version:'v1'};
    const data={version:'v1',original:'Old',source_match:true,edit:{file:'main.tex',kind:'manuscript',versions:['v1'],requests:[]},options:[{label:'A',after:'New',reason:'A',changes:[]}]};
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
    const services={read:async()=>data,style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[]};
    const view=createWorkbench(vscode,{subscriptions:[]},services);view.setRecords(new Map([['1',{c,data}]]));await view.show(c);await receive({type:'ready',instance:'page'});
    const first={repo:c.repo,owner:c.owner}, second={...first};
    view.coordinating(first,true); view.coordinating(second,true); view.coordinating(first,false);
    assert.equal(messages.findLast(m=>m.type==='coordinating').busy,true);
    view.coordinating(second,false); assert.equal(messages.findLast(m=>m.type==='coordinating').busy,false);
});

test('selected feedback handoff uses the displayed batch and exact selected identities', async () => {
    let receive, session = 'batch1'; const calls = [], messages = [];
    const c = {repo:'/fixture',owner:'state',id:'1',version:'v1'};
    const data = {version:'v1',original:'Old',source_match:true,edit:{file:'main.tex',kind:'manuscript',versions:['v1'],requests:[]},options:[{label:'A',after:'New',reason:'A',changes:[]}]};
    const vscode = {Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
    const services = {read:async()=>data,session:()=>session,style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[],handoff:async(...args)=>calls.push(args)};
    const view = createWorkbench(vscode,{subscriptions:[]},services);
    view.setRecords(new Map([['1',{c,data}],['2',{c:{...c,id:'2'},data}]])); await view.show(c); await receive({type:'ready',instance:'page'});
    const action = {type:'handoffSelected',instance:'page',id:'1',version:'v1',session:'batch1',items:[{id:'2',version:'v1'}]};
    await receive(action); assert.equal(calls.length,1); assert.deepEqual(calls[0],[c,action.items,'batch1']);
    session = 'batch2'; await receive(action); assert.equal(calls.length,1);
    assert(messages.some(m=>m.error && m.message.includes('变化')));
});

test('block source save and explicit sync preserve the selected review identity', async () => {
    let receive;
    const events = [], messages = [];
    const c = {repo:'/fixture', owner:'.codex-review/state.json', id:'1', version:'v1'};
    let data = {id:'1', version:'v1', original:'Original.', candidate:'Candidate.', source_match:true,
        block:{id:'block-1', text:'Original.\n', source_revision:'source-1'},
        edit:{file:'main.tex',kind:'manuscript',status:'pending',versions:['v1'],requests:[]},
        options:[{label:'A',after:'Candidate.',reason:'Choice',changes:[]}]};
    const vscode = {Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{
        cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
    const services = {read:async()=>structuredClone(data),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,
        directory:()=>[{id:c.id,...data.edit}], saveSource:async (target, block, value)=>{events.push({type:'source',target,block,value}); data.block.text=value;data.source_match=false;},
        syncBlock:async (target, block)=>{events.push({type:'sync',target,block}); data={...data,version:'v2',source_match:true,edit:{...data.edit,versions:['v1','v2']}};return structuredClone(data);},
        repairBlock:async (target, loaded)=>{events.push({type:'repair',target,loaded});return structuredClone(data);}};
    const view=createWorkbench(vscode,{subscriptions:[]},services);
    view.setRecords(new Map([['1',{c,data}]])); await view.show(c); await receive({type:'ready',instance:'page'});
    await receive({type:'saveSource',instance:'page',id:'1',version:'v1',value:'Author text.\n'});
    assert.equal(events[0].type,'source'); assert.equal(events[0].target.version,'v1');
    assert.equal(events[0].block.id,'block-1'); assert.equal(data.edit.status,'pending');
    await receive({type:'repairBlock',instance:'page',id:'1',version:'v1'});
    assert.equal(events[1].type,'repair'); assert.equal(events[1].target.id,'1');
    await receive({type:'syncBlock',instance:'page',id:'1',version:'v1'});
    assert.equal(events[2].type,'sync'); assert.equal(events[2].target.id,'1');
    assert.equal(view.active.version,'v2'); assert.equal(data.edit.status,'pending');
    assert(messages.some(m=>m.type==='result' && m.message.includes('未接收')));
});

test('same-version refresh sends current block identity and revisions without replacing drafts', async () => {
    let receive; const messages = [];
    const c = {repo:'/fixture',owner:'.codex-review/state.json',id:'1',version:'v1'};
    let data = {version:'v1',original:'Old.',source_match:true,block:{id:'block-1',text:'Old.\n',source_revision:'r1'},
        edit:{file:'main.tex',kind:'manuscript',block_id:'block-1',versions:['v1'],requests:[]},
        options:[{label:'A',after:'Candidate.',reason:'A',changes:[]}]};
    const vscode = {Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{
        cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
    const services = {read:async()=>structuredClone(data),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[]};
    const view = createWorkbench(vscode,{subscriptions:[]},services);
    let records = new Map([['1',{c,data}]]); view.setRecords(records); await view.show(c); await receive({type:'ready',instance:'page'});
    assert.equal(messages.find(m=>m.type==='content').data.edit.block_id,'block-1');
    await receive({type:'dirty',instance:'page',id:'1',version:'v1',dirty:true,state:{drafts:{A:'Unsaved'},blockDraft:'Draft'}});
    let count = messages.length; view.sync(records,c);
    assert(!messages.slice(count).some(m=>m.type==='locationStatus' || m.type==='content'));
    for (const [text, revision] of [['Manual.\n','r2'],['Again.\n','r3']]) {
        data = {...data,source_match:false,conflict:'Changed',block:{...data.block,text,source_revision:revision}};
        records = new Map([['1',{c,data}]]); count = messages.length; view.sync(records,c);
        const update = messages.slice(count).find(m=>m.type==='locationStatus');
        assert.equal(update.block.text,text); assert.equal(update.block.source_revision,revision);
        assert(!messages.slice(count).some(m=>m.type==='content'));
    }
});

test('same-version refresh updates evidence freshness without replacing the draft', async () => {
    let receive; const messages=[];
    const c={repo:'/fixture',owner:'state',id:'1',version:'v1'};
    const data={version:'v1',original:'Old',source_match:true,fact_evidence:[{file:'experiments/results.csv',location_checked:true}],
        edit:{file:'main.tex',kind:'manuscript',versions:['v1'],requests:[]},options:[{label:'A',after:'New',reason:'A',changes:[]}]};
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
    const services={read:async()=>structuredClone(data),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[]};
    const view=createWorkbench(vscode,{subscriptions:[]},services);view.setRecords(new Map([['1',{c,data}]]));await view.show(c);await receive({type:'ready',instance:'page'});
    await receive({type:'dirty',instance:'page',id:'1',version:'v1',dirty:true,state:{drafts:{A:'Unsaved draft'}}});
    const changed={...data,fact_evidence:[{...data.fact_evidence[0],location_checked:false}]};
    view.sync(new Map([['1',{c,data:changed}]]),c);
    assert.equal(messages.findLast(m=>m.type==='factEvidence').evidence[0].location_checked,false);
    assert(!messages.slice(-4).some(m=>m.type==='content'));
});

test('automatic version keeps candidate, source and note drafts on their old base', async () => {
    let receive; const messages = [];
    const c = {repo:'/fixture',owner:'.codex-review/state.json',id:'1',version:'v1'};
    const data = {version:'v1',original:'Old.',source_match:true,block:{id:'b',text:'Old.\n',source_revision:'r1'},
        edit:{file:'main.tex',kind:'manuscript',versions:['v1'],requests:[]},options:[{label:'A',after:'Candidate.',reason:'A',changes:[]}]};
    const vscode = {Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{
        cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
    const services = {read:async()=>structuredClone(data),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[]};
    const view=createWorkbench(vscode,{subscriptions:[]},services); view.setRecords(new Map([['1',{c,data}]]));
    await view.show(c); await receive({type:'ready',instance:'page'});
    await receive({type:'dirty',instance:'page',id:'1',version:'v1',dirty:true,noteDirty:true,state:{drafts:{A:'Candidate draft'},blockDraft:'Source draft',note:'Note draft',selected:{value:'Old.'}}});
    const next = {...data,version:'v2',original:'New.',block:{id:'b',text:'New.\n',source_revision:'r2'},edit:{...data.edit,versions:['v1','v2']}};
    view.sync(new Map([['1',{c:{...c,version:'v2'},data:next}]]),c,new Set(['1']));
    const packet = messages.filter(m=>m.type==='content').at(-1);
    assert.equal(view.active.version,'v2'); assert.equal(packet.resume.oldOriginal,'Old.');
    assert.equal(packet.resume.drafts.A,'Candidate draft'); assert.equal(packet.resume.blockDraft,'Source draft'); assert.equal(packet.resume.note,'Note draft');
    assert(packet.resume.candidateDraftStale && packet.resume.sourceDraftStale && packet.resume.selectionStale);
    await receive({type:'save',instance:'page',id:'1',version:'v2',option:'A',value:'Candidate draft'});
    assert(messages.some(m=>m.error && m.message.includes('旧原文')));
});

test('saving source applies queued automatic version while keeping other drafts', async () => {
    let receive, view; const messages = [];
    const c = {repo:'/fixture',owner:'.codex-review/state.json',id:'1',version:'v1'};
    const data = {version:'v1',original:'Old.',source_match:true,block:{id:'b',text:'Old.\n',source_revision:'r1'},
        edit:{file:'main.tex',kind:'manuscript',versions:['v1'],requests:[]},options:[{label:'A',after:'Candidate.',reason:'A',changes:[]}]};
    const vscode = {Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{
        cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
    const next = {...data,version:'v2',original:'New.',block:{id:'b',text:'New.\n',source_revision:'r2'},edit:{...data.edit,versions:['v1','v2']}};
    const services = {read:async()=>structuredClone(data),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[],
        saveSource:async()=>view.sync(new Map([['1',{c:{...c,version:'v2'},data:next}]]),c,new Set(['1']))};
    view=createWorkbench(vscode,{subscriptions:[]},services); view.setRecords(new Map([['1',{c,data}]]));
    await view.show(c); await receive({type:'ready',instance:'page'});
    await receive({type:'dirty',instance:'page',id:'1',version:'v1',dirty:true,noteDirty:true,state:{drafts:{A:'Draft'},blockDraft:'New.\n',note:'Note'}});
    await receive({type:'saveSource',instance:'page',id:'1',version:'v1',value:'New.\n'});
    const packet=messages.filter(m=>m.type==='content').at(-1);
    assert.equal(view.active.version,'v2'); assert.equal(packet.resume.oldOriginal,'Old.');
    assert.equal(packet.resume.drafts.A,'Draft'); assert.equal(packet.resume.note,'Note');
    assert.equal(packet.resume.blockDraft,undefined); assert.equal(packet.resume.sourceDraftStale,false);
    assert.equal(packet.resume.candidateDraftStale,true);
});

test('typing another source draft during save does not discard it', async () => {
    let receive, view, release, started; const messages=[];
    const c={repo:'/fixture',owner:'.codex-review/state.json',id:'1',version:'v1'};
    const data={version:'v1',original:'Old.',source_match:true,block:{id:'b',text:'Old.\n',source_revision:'r1'},
        edit:{file:'main.tex',kind:'manuscript',versions:['v1'],requests:[]},options:[{label:'A',after:'Candidate.',reason:'A',changes:[]}]};
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{
        cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
    const begun=new Promise(resolve=>{started=resolve;});
    const next={...data,version:'v2',original:'Saved.',block:{id:'b',text:'Saved.\n',source_revision:'r2'},edit:{...data.edit,versions:['v1','v2']}};
    const services={read:async()=>structuredClone(data),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[],
        saveSource:async()=>{started();await new Promise(resolve=>{release=resolve;});view.sync(new Map([['1',{c:{...c,version:'v2'},data:next}]]),c,new Set(['1']));}};
    view=createWorkbench(vscode,{subscriptions:[]},services);view.setRecords(new Map([['1',{c,data}]]));
    await view.show(c);await receive({type:'ready',instance:'page'});
    await receive({type:'dirty',instance:'page',id:'1',version:'v1',dirty:true,state:{drafts:{},blockDraft:'Saved.\n'}});
    const saving=receive({type:'saveSource',instance:'page',id:'1',version:'v1',value:'Saved.\n'});await begun;
    await receive({type:'dirty',instance:'page',id:'1',version:'v1',dirty:true,state:{drafts:{},blockDraft:'Still typing'}});
    release();await saving;
    const packet=messages.filter(m=>m.type==='content').at(-1);
    assert.equal(packet.resume.blockDraft,'Still typing');assert.equal(packet.resume.sourceDraftStale,true);
});

test('in-flight source save cannot apply another repository synchronization to the current drafts', async () => {
    let receive, view, release, started; const messages=[];
    const a={repo:'/a',owner:'state.json',id:'1',version:'v1'}, b={...a,repo:'/b'};
    const make=(original,version='v1')=>({version,original,source_match:true,block:{id:'b',text:original+'\n',source_revision:version},
        edit:{file:'main.tex',kind:'manuscript',versions:['v1',version],requests:[]},options:[{label:'A',after:'Candidate.',reason:'A',changes:[]}]});
    const a1=make('A old.'), b1=make('B old.'), a2=make('A new.','v2'), b2=make('B new.','v2');
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{
        cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
    const begun=new Promise(resolve=>{started=resolve;});
    const services={read:async c=>structuredClone(c.repo==='/a'?a1:b1),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[],
        saveSource:async()=>{view.sync(new Map([['1',{c:{...a,version:'v2'},data:a2}]]),a,new Set(['1']));started();await new Promise(resolve=>{release=resolve;});}};
    view=createWorkbench(vscode,{subscriptions:[]},services);view.setRecords(new Map([['1',{c:a,data:a1}]]));
    await view.show(a);await receive({type:'ready',instance:'page'});
    const saving=receive({type:'saveSource',instance:'page',id:'1',version:'v1',value:'A saved.\n'});await begun;
    await view.show(b);await receive({type:'dirty',instance:'page',id:'1',version:'v1',dirty:true,noteDirty:true,
        state:{drafts:{A:'B candidate draft'},blockDraft:'A saved.\n',note:'B note draft'}});
    view.sync(new Map([['1',{c:{...b,version:'v2'},data:b2}]]),b);
    release();await saving;
    assert.deepEqual(view.active,b);
    const packet=messages.filter(m=>m.type==='content').at(-1);
    assert.equal(packet.data.original,'B old.');
    await receive({type:'ready',instance:'reopened-page'});
    const current=messages.filter(m=>m.type==='content').at(-1);
    assert.equal(current.data.original,'B old.');assert.equal(current.resume.drafts.A,'B candidate draft');
    assert.equal(current.resume.blockDraft,'A saved.\n');assert.equal(current.resume.note,'B note draft');
    assert(messages.some(m=>m.type==='conflict'));
});

test('closing during queued source synchronization cannot mutate a reopened panel', async () => {
    for (const [reopen,syncFirst,fail] of [[false,true,false],[true,true,false],[true,false,false],[true,false,true]]) {
        let receive, dispose, release, started, view; const messages=[];
        const a={repo:'/a',owner:'state.json',id:'1',version:'v1'}, b={...a,repo:'/b'};
        const data={version:'v1',original:'Old.',source_match:true,block:{id:'b',text:'Old.\n',source_revision:'r1'},
            edit:{file:'main.tex',kind:'manuscript',versions:['v1'],requests:[]},options:[{label:'A',after:'Candidate.',reason:'A',changes:[]}]};
        const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{showErrorMessage:m=>messages.push({type:'error',message:m}),createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose:f=>{dispose=f;},onDidChangeViewState(){},webview:{
            cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
        const begun=new Promise(resolve=>{started=resolve;});
        const services={read:async()=>structuredClone(data),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[],
            saveSource:async()=>{const sync=()=>view.sync(new Map([['1',{c:{...a,version:'v2'},data:{...data,version:'v2'}}]]),a,new Set(['1']));
                if(syncFirst)sync();started();await new Promise(resolve=>{release=resolve;});if(fail)throw Error('save failed');if(!syncFirst)sync();}};
        view=createWorkbench(vscode,{subscriptions:[]},services);view.setRecords(new Map([['1',{c:a,data}]]));await view.show(a);await receive({type:'ready',instance:'old'});
        const saving=receive({type:'saveSource',instance:'old',id:'1',version:'v1',value:'Saved.\n'});await begun;dispose();
        if (reopen) {view.setRecords(new Map([['1',{c:b,data}]]));await view.show(b);await receive({type:'ready',instance:'new'});
            await receive({type:'dirty',instance:'new',id:'1',version:'v1',dirty:true,state:{drafts:{A:'New draft'}}});}
        release();await saving;
        if(fail)assert(messages.some(m=>m.type==='error' && m.message==='save failed'));
        if (reopen) {assert.deepEqual(view.active,b);await receive({type:'ready',instance:'reopened'});
            assert.equal(messages.filter(m=>m.type==='content').at(-1).resume.drafts.A,'New draft');}
        else assert.equal(view.active,undefined);
    }
});

test('manual rebase preserves block draft and rejects stale displayed revisions', async () => {
    let receive, called = 0; const messages = [];
    const c = {repo:'/fixture',owner:'.codex-review/state.json',id:'1',version:'v1'};
    let data = {version:'v1',original:'Old.',source_match:false,conflict:'Changed',block:{id:'b',text:'New.\n',source_revision:'r2'},
        edit:{file:'main.tex',kind:'manuscript',block_id:'b',versions:['v1'],requests:[]},
        options:[{label:'A',after:'Candidate.',reason:'A',changes:[]}]};
    const vscode = {Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{
        cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
    const services = {read:async()=>structuredClone(data),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[],
        manualRebase:async (target,block,spec)=>{called++; assert.equal(target.version,'v1'); assert.equal(block.source_revision,'r2'); assert.equal(spec.quote,'New.');
            return {...data,version:'v2',source_match:true,edit:{...data.edit,versions:['v1','v2']},options:[{...data.options[0],after:'Draft candidate.'}]};}};
    const view=createWorkbench(vscode,{subscriptions:[]},services); view.setRecords(new Map([['1',{c,data}]]));
    await view.show(c); await receive({type:'ready',instance:'page'});
    await receive({type:'dirty',instance:'page',id:'1',version:'v1',dirty:true,state:{drafts:{A:'Draft candidate.'},blockDraft:'Old source draft',sourceDraftStale:true}});
    const message = {type:'manualRebase',instance:'page',id:'1',version:'v1',block_id:'b',source_revision:'old',start:0,end:4,quote:'New.',options:[{label:'A',after:'Draft candidate.'}]};
    await receive(message); assert.equal(called,0);
    await receive({...message,source_revision:'r2'}); assert.equal(called,1); assert.equal(view.active.version,'v2');
    const latest=messages.filter(m=>m.type==='content').at(-1);
    assert.equal(latest.resume.blockDraft,'Old source draft'); assert.equal(latest.resume.sourceDraftStale,true); assert.deepEqual(latest.resume.drafts,{});
});

test('out-of-order reads and retired page messages cannot change the clicked decision identity', async () => {
    let receive, resolveOld;
    const messages = [], accepted = [];
    const make = id => ({c:{repo:'/identity',owner:'reply.tex',id,version:'version-'+id},data:{id,version:'version-'+id,
        original:'',source_match:true,edit:{file:'reply.tex',kind:'response',versions:['version-'+id],requests:[]},
        options:[{label:'A',after:id,reason:'Explicit identity',changes:[]}]}});
    const records = new Map(['dp','dq','dr','ds'].map(id=>[id,make(id)]));
    const delayed = new Promise(resolve=>{resolveOld=resolve;});
    const vscode = {Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{
        cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
    const services = {read:c=>c.id==='dp'?delayed:Promise.resolve(structuredClone(records.get(c.id).data)),
        style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,
        directory:()=>[...records].map(([id,r])=>({id,version:r.c.version,...r.data.edit})),
        accept:async c=>{accepted.push({...c});records.delete(c.id);view.sync(records,c);}};
    const view=createWorkbench(vscode,{subscriptions:[]},services);view.setRecords(records);
    const old=view.show(records.get('dp').c);await view.show(records.get('ds').c);resolveOld(records.get('dp').data);await old;
    assert.equal(view.active.id,'ds');
    await receive({type:'ready',instance:'current-page'});
    for (const extra of [{id:'dp'},{version:'expired'},{instance:'retired-page'}]) {
        await receive({type:'accept',id:'ds',version:'version-ds',instance:'current-page',option:'A',...extra});
        assert.equal(accepted.length,0);
    }
    await receive({type:'accept',id:'ds',version:'version-ds',instance:'current-page',option:'A'});
    assert.deepEqual(accepted.map(c=>[c.id,c.version]),[['ds','version-ds']]);
    assert(records.has('dp')&&records.has('dq')&&records.has('dr'));
});

test('a later explicit navigation wins over an in-flight automatic advance', async () => {
    let receive, view, release, started;
    const make=id=>({c:{repo:'/fixture',owner:'reply.tex',id,version:'v1'},data:{id,version:'v1',original:'Old',source_match:true,
        edit:{file:'reply.tex',kind:'response',status:'pending',versions:['v1'],requests:[]},options:[{label:'A',after:'New',reason:'A',changes:[]}]}});
    const records=new Map(['1','2','3'].map(id=>[id,make(id)]));
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{
        cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage(){}}})}};
    const begun=new Promise(resolve=>{started=resolve;});
    const services={read:async c=>structuredClone(records.get(c.id).data),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,
        directory:()=>[...records].map(([id,r])=>({id,version:r.c.version,...r.data.edit})),
        accept:async c=>{started();await new Promise(resolve=>{release=resolve;});records.delete(c.id);view.sync(records,c);}};
    view=createWorkbench(vscode,{subscriptions:[]},services);view.setRecords(records);await view.show(records.get('1').c);await receive({type:'ready',instance:'page'});
    const accepting=receive({type:'accept',instance:'page',id:'1',version:'v1',option:'A'});await begun;
    await view.show(records.get('3').c);release();await accepting;
    assert.equal(view.active.id,'3');assert(records.has('2')&&records.has('3'));
});

test('automatic advance becomes usable while the list reveal is still running', async () => {
    let receive, view, release; const messages=[];
    const make=id=>({c:{repo:'/fixture',owner:'reply.tex',id,version:'v1'},data:{id,version:'v1',original:'Old',source_match:true,
        edit:{file:'reply.tex',kind:'response',status:'pending',versions:['v1'],requests:[]},options:[{label:'A',after:'New',reason:'A',changes:[]}]}});
    const records=new Map(['1','2'].map(id=>[id,make(id)]));
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{
        cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
    const gate=new Promise(resolve=>{release=resolve;});
    const services={read:async c=>structuredClone(records.get(c.id).data),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,
        directory:()=>[...records].map(([id,r])=>({id,version:r.c.version,...r.data.edit})),
        activeChanged:c=>c.id==='2'?gate:Promise.resolve(),accept:async c=>{records.delete(c.id);view.sync(records,c);}};
    view=createWorkbench(vscode,{subscriptions:[]},services);view.setRecords(records);await view.show(records.get('1').c);await receive({type:'ready',instance:'page'});
    const accepting=receive({type:'accept',instance:'page',id:'1',version:'v1',option:'A'});
    try {
        await new Promise(resolve=>setImmediate(resolve));
        assert.equal(view.active.id,'2');assert(messages.some(m=>m.type==='busy'&&m.action===false));
    } finally {release();await accepting;}
});
test('fixed workbench reuses one tab, retains precise B notes, unsaved drafts and next acceptance', async () => {
    let receive, creations = 0, htmlWrites = 0, confirmation, disposed, panel, changed;
    const messages = [], events = [], original = 'The model is strong.';
    const make = id => ({c: {repo: '/fixture', owner: 'reply.tex', id, version: 'v1'}, data: {version: 'v1', original,
        candidate: 'The model is reliable.', fewer_options_reason: 'fixture explanation', source: {text: 'private full source with machine state'}, edit: {file: 'main.tex', kind: 'manuscript', versions: ['v1'], requests: []},
        options: [...'ABC'].map((label, i) => ({label, after: ['The model is reliable.', 'The model is compact.', 'The model is efficient.'][i], reason: label, changes: []}))}});
    const records = new Map(['1', '2', 'a'].map(id => [id, make(id)]));
    const vscode = {commands: {executeCommand: async command => {assert.equal(command, 'localLatex.checkForUpdates'); events.push({type: 'checkUpdates'});}}, Uri: {file: fsPath => ({fsPath})}, ViewColumn: {One: 1}, window: {showWarningMessage: async () => confirmation,
        createWebviewPanel: (_, __, ___, settings) => {creations++; assert.equal(settings.retainContextWhenHidden, false); return panel = {visible: true,
            reveal() {panel.visible = true;}, onDidChangeViewState(fn) {changed = fn;}, dispose() {}, onDidDispose(fn) {disposed = fn;}, webview: {
            cspSource: 'vscode-webview:', asWebviewUri: uri => ({toString: () => 'vscode-resource:' + uri.fsPath}),
            set html(value) {htmlWrites++; assert(value.includes('Content-Security-Policy'));},
            onDidReceiveMessage: fn => {let pageInstance; receive = message => {if (message.type === 'ready') pageInstance = message.instance; return fn({...message, instance: message.instance ?? pageInstance});};}, postMessage: async value => messages.push(value)}};}}};
    const services = {read: async c => {const record = records.get(c.id); assert.equal(c.version, record.c.version); return structuredClone(record.data);},
        style: () => require('./review_style').defaults, selection: () => 'A', pdfStatus: () => '待更新', autoTranslate: () => false,
        directory: () => [...records.values()].map(r => ({id: r.c.id, ...r.data.edit})),
        note: async (c, selection, text) => {events.push({type: 'note', c, selection, text}); const record = records.get(c.id);
            record.data.edit.requests.push({id: 'note-1', version: c.version, status: 'open', ...selection, text}); view.sync(records, c);},
        editNote: async (c, note, text, previous) => {assert.equal(note.text, previous); const record = records.get(c.id);
            record.data.edit.requests[0].text = text; view.sync(records, c);},
        save: async (c, label, after) => {const r = records.get(c.id); r.data.options.find(o => o.label === label).after = after;
            r.c.version = r.data.version = 'v2'; r.data.edit.versions.push('v2'); view.sync(records, c); return structuredClone(r.data);},
        saved() {}, accept: async c => {events.push({type: 'accept', c}); records.delete(c.id); view.sync(records, c);},
        source: async c => events.push({type: 'source', c}),
        reopen: async () => events.push({type: 'reopen'}), start: async () => events.push({type: 'start'}), copy: async () => events.push({type: 'copy'}), handoff: async () => events.push({type: 'handoff'}), finish() {}};
    const view = createWorkbench(vscode, {subscriptions: []}, services);
    view.setRecords(records); await view.show(records.get('1').c); await receive({type: 'ready'});
    const content = messages.find(m => m.type === 'content');
    assert(!('source' in content.data)); assert(!('options' in content.data));
    assert.equal(content.options.length, 3);
    assert.equal(content.data.fewer_options_reason, 'fixture explanation', 'the existing reader receives the explanation in data');
    const count = messages.length;
    view.status({...view.active, version: 'old'}, 'PDF 最新');
    view.status({...view.active, id: 'a'}, 'PDF 最新');
    assert.equal(messages.length, count, 'another document or stale version cannot label the current PDF latest');
    const send = (type, extra = {}) => receive({type, id: view.active.id, version: view.active.version, ...extra});
    await send('reopen');
    assert.equal(events.pop().type, 'reopen', 'top button opens an existing PDF without invoking compile/preview');
    await send('start'); assert.equal(events.pop().type, 'start');
    await send('handoff'); assert.equal(events.pop().type, 'handoff');
    assert(html('test').includes('data-action="reopen"'));
    await send('note', {option: 'B', side: 'candidate', value: 'The model is compact.', start: 13, end: 20, text: '限定这个词'});
    assert.deepEqual(events[0].selection, {side: 'candidate', option: 'B', start: 13, end: 20, quote: 'compact', purpose:'revision'});
    assert(messages.some(m => m.type === 'notes'));
    await send('editNote', {request: 'note-1', text: '修正后的要求', previousText: '限定这个词'});
    assert.equal(records.get('1').data.edit.requests.length, 1);
    assert.equal(records.get('1').data.edit.requests[0].text, '修正后的要求');
    assert(messages.some(m => m.type === 'noteEdited'));
    await send('dirty', {dirty: true, noteDirty: true});
    await send('source');
    assert.deepEqual(events.pop(), {type: 'source', c: view.active}, 'source navigation remains read-only with unsaved candidate and note inputs');
    assert.equal(view.active.id, '1'); assert.equal(view.active.version, 'v1');
    await send('checkUpdates'); assert.equal(events.pop().type, 'checkUpdates', 'manual update check remains usable with unsaved review inputs');
    await send('switch', {target: 'a'}); assert.equal(view.active.id, '1', 'unconfirmed draft cannot disappear');
    await send('dirty', {dirty: false, noteDirty: false});
    await send('save', {option: 'B', value: 'The model is compact and fast.'});
    assert.equal(view.active.version, 'v2');
    const previous = {version: 'v1', requests: [{id: 'old-note', version: 'v1', text: '保留旧版返修要求'}]};
    records.get('1').data.edit.previous_feedback = previous;
    view.sync(records, view.active);
    assert.deepEqual(messages.findLast(m => m.type === 'notes').previous_feedback, previous, 'same-version updates retain the read-only comparison round');
    assert.equal(records.get('1').data.options[0].after, 'The model is reliable.');
    await send('accept', {option: 'B'});
    assert.equal(events.at(-1).c.option, 'B'); assert.equal(view.active.id, '2');
    await send('switch', {target: 'a'}); assert.equal(view.active.id, 'a');
    assert.equal(creations, 1); assert.equal(htmlWrites, 1, 'switch/save/note never replace webview HTML');
    const notesBefore = events.length;
    await receive({type: 'note', id: '1', version: 'v1', text: 'Stale request'});
    assert.equal(events.length, notesBefore); assert(messages.findLast(m => m.type === 'result').error);
    assert.equal(records.get('a').data.original, original);
    assert(!html('test').includes('http://'), 'network runs in existing backend, not untrusted webview');
    const page = html('nonce-test', {source: 'vscode-webview:', css: 'vscode-resource:/katex.min.css', script: 'vscode-resource:/katex.min.js'});
    assert(page.includes("connect-src 'none'"));
    assert(page.includes('nonce="nonce-test" src="vscode-resource:/katex.min.js"'));
    assert(page.includes('href="vscode-resource:/katex.min.css"'));
    assert(page.includes('id="mathMode"'));
    assert(!page.includes('id="originalSource"'), 'full source is available through the mode button, not a second source block');
    assert(page.includes('data-action="start">AI 论文助手'));
    assert(page.includes('id="configuration"'));
    assert(page.includes('data-action="checkUpdates"'));
    const header = page.slice(page.indexOf('<header>'), page.indexOf('</header>'));
    assert(header.split('<details class="more">')[0].includes('id="sourceLocation" data-action="source"'), 'real source navigation has a direct top toolbar entry');
    assert.equal((header.match(/data-action="source"/g) || []).length, 1, 'one source button moves into the overflow menu on narrow windows');
    assert(header.split('<details class="more">')[0].includes('data-action="handoff"'));
    assert(!header.split('<details class="more">')[1].includes('data-action="handoff"'));
    assert(!page.includes('data-action="connect"')); assert(!page.includes('data-action="copy"'));
    let translations = 0;
    services.autoTranslate = () => true; services.provider = () => 'fixture';
    services.translate = async text => {translations++; return '中文 ' + text;};
    await send('translate'); await view.whenTranslationIdle(); const once = translations;
    await send('translate'); await view.whenTranslationIdle(); assert.equal(translations, once, 'reachable translations are reused');
    disposed(); assert.equal(view.active, undefined);
    view.setRecords(records); await view.show(records.get('a').c); await receive({type: 'ready'});
    await send('paragraphTranslationView',{repo:view.active.repo,owner:view.active.owner,visible:['original','A','B','C']}); await view.whenTranslationIdle();
    assert.equal(translations, once * 2, 'closing releases translations; reopening reads current content');
    services.autoTranslate = () => false;
    const state = {c: {...view.active}, drafts: {A: 'Draft A', B: 'Draft B'}, note: '保留未保存要求', composer: true,
        selected: {side: 'candidate', option: 'B', value: 'The model is compact.', start: 13, end: 20}};
    await send('dirty', {dirty: true, noteDirty: true, state});
    const originalSave = services.save;
    let finishSave;
    services.save = async (...args) => {await new Promise(resolve => {finishSave = resolve;}); return originalSave(...args);};
    const cachedRequests = translations;
    const saving = send('save', {option: 'B', value: 'Saved B'});
    assert.throws(() => view.assertReloadSafe(), /正在进行/, 'running writes block window reload');
    await send('reopen'); assert.equal(events.at(-1).type, 'reopen', 'PDF window remains usable during a candidate save');
    await send('accept', {option: 'A'});
    assert(messages.at(-1).error, 'a second review mutation cannot bypass the writer guard');
    panel.visible = false; changed({webviewPanel: panel}); const hiddenCount = messages.length;
    finishSave(); await saving;
    assert.equal(messages.length, hiddenCount, 'background writes update state without posting to a destroyed page');
    await view.show(view.active); await receive({type: 'ready', instance: 'restored-1', state});
    let restored = messages.filter(m => m.type === 'content').at(-1);
    assert.equal(restored.c.version, 'v2');
    assert.deepEqual(restored.resume.drafts, {A: 'Draft A'});
    assert.equal(restored.resume.note, state.note);
    assert(messages.slice(hiddenCount).some(m => m.type === 'translation'), 'existing translations restore even when automatic translation is off');
    assert.equal(translations, cachedRequests, 'restoring cached translations makes no new service request');
    assert(!messages.slice(hiddenCount).some(m => m.type === 'conflict'), 'the acknowledged own save is not an AI version conflict');
    const readyCount = messages.length;
    await receive({type: 'ready', instance: 'restored-1', state}); assert.equal(messages.length, readyCount, 'one document handshakes only once');
    await send('dirty', {dirty: false, noteDirty: true, state: {...restored.resume, drafts: {}}});
    const originalNote = services.note;
    let finishNote;
    services.note = async (...args) => {await new Promise(resolve => {finishNote = resolve;}); return originalNote(...args);};
    const noting = send('note', {text: '保存一次要求'});
    panel.visible = false; changed({webviewPanel: panel}); finishNote(); await noting;
    await view.show(view.active); await receive({type: 'ready', instance: 'restored-2', state});
    restored = messages.filter(m => m.type === 'content').at(-1);
    assert.equal(restored.resume.note, ''); assert.equal(restored.resume.composer, false);
    assert.equal(records.get('a').data.edit.requests.length, 1, 'background note completion is not restored as a new unsaved submission');
    await send('dirty', {dirty: true, noteDirty: false, state: {...restored.resume, drafts: {A: '旧版未保存候选'}}});
    panel.visible = false; changed({webviewPanel: panel});
    const updated = records.get('a'); updated.c.version = updated.data.version = 'v3'; updated.data.edit.versions.push('v3');
    view.sync(records, updated.c);
    await view.show(view.active); await receive({type: 'ready', instance: 'restored-3'});
    restored = messages.filter(m => m.type === 'content').at(-1);
    assert.equal(restored.c.version, 'v2'); assert.equal(restored.resume.drafts.A, '旧版未保存候选');
    assert(messages.some(m => m.type === 'conflict'));

    const stored = new Map(), updatedSettings = [];
    vscode.ConfigurationTarget = {Global: 1, Workspace: 2, WorkspaceFolder: 3};
    vscode.workspace = {getConfiguration: () => ({get: (k, fallback) => stored.get(k) ?? fallback,
        inspect: key => key === 'reviewStyle.controlFontSize' ? {workspaceValue: 13} : {},
        update: async (key, value, target) => {stored.set(key, value); updatedSettings.push({key, value, target});}})};
    services.style = () => require('./review_style').read(vscode.workspace.getConfiguration());
    await send('appearance', {values: {candidateFontSize: 20, controlFontSize: 15, fontFamily: 'Arial, sans-serif'}});
    assert.equal(stored.get('reviewStyle.candidateFontSize'), 20);
    assert.equal(updatedSettings.find(s => s.key === 'reviewStyle.controlFontSize').target, 2, 'preserve effective workspace override');
    const countSettings = updatedSettings.length;
    await send('appearance', {values: {candidateFontSize: 24, controlFontSize: 99}});
    assert.equal(updatedSettings.length, countSettings, 'validate the complete appearance change before writing');
    assert(messages.at(-1).error);
    await send('appearance', {values: {addedColor: '#ffffff'}});
    assert.equal(updatedSettings.length, countSettings, 'screen appearance cannot change shared PDF colors');
    await send('appearance', {reset: true});
    assert.equal(stored.get('reviewStyle.candidateFontSize'), 16);
    assert.equal(records.get('a').data.original, original);

    // Combined actions preserve ordering, version checks, drafts and failure recovery.
    services.note = originalNote; services.save = originalSave;
    await send('dirty', {dirty: false, noteDirty: false, state: {c: view.active, drafts: {}}});
    await send('latest');
    const realHandoff = services.handoff;
    services.handoff = async c => {events.push({type: 'scoped-handoff', c});};
    await send('note', {text: '仅交接本项', handoff: true});
    assert.equal(events.at(-1).type, 'scoped-handoff'); assert.equal(events.at(-1).c.id, 'a');
    assert.equal(events.at(-2).type, 'note');
    const realNote = services.note;
    services.note = async () => {throw new Error('fixture save failed');};
    const eventCount = events.length;
    await send('note', {text: 'cannot save', handoff: true});
    assert.equal(events.length, eventCount, 'failed save cannot hand off');
    services.note = realNote;
    services.handoff = async () => {throw new Error('fixture Codex unavailable');};
    await send('note', {text: '保存成功但无法交接', handoff: true});
    assert(messages.findLast(m => m.type === 'result').message.includes('批注已保存，但加入 Codex 失败'));
    assert.equal(records.get('a').data.edit.requests.at(-1).text, '保存成功但无法交接');
    assert(messages.findLast(m => m.type === 'handoffRetry').available);
    const countNotes = records.get('a').data.edit.requests.length;
    services.handoff = async c => {events.push({type: 'retry-handoff', c});};
    await send('retryHandoff');
    assert.equal(events.at(-1).c.id, 'a');
    assert.equal(events.at(-1).type, 'retry-handoff');
    assert.equal(records.get('a').data.edit.requests.length, countNotes, 'retry never saves the note again');
    assert.equal(messages.findLast(m => m.type === 'handoffRetry').available, false);
    const eventsAfterRetry = events.length;
    await send('retryHandoff');
    assert.equal(events.length, eventsAfterRetry, 'successful retry clears the target');
    services.handoff = realHandoff;
    await send('dirty', {dirty: true, noteDirty: false, state: {c: view.active, drafts: {A: 'keep other draft', B: 'edit B'}}});
    await send('saveAccept', {option: 'B', value: 'edit B'});
    assert.match(messages.findLast(m => m.type === 'result').message, /其他方案草稿/);
    await send('dirty', {dirty: true, noteDirty: false, state: {c: view.active, drafts: {B: 'edit B'}}});
    services.save = async () => {throw new Error('fixture save failed');};
    const acceptCount = events.filter(e => e.type === 'accept').length;
    await send('saveAccept', {option: 'B', value: 'edit B'});
    assert.equal(events.filter(e => e.type === 'accept').length, acceptCount);
    services.save = originalSave;
    const realAccept = services.accept;
    services.accept = async () => {throw new Error('fixture concurrent update');};
    await send('saveAccept', {option: 'B', value: 'edit B'});
    assert.match(messages.findLast(m => m.type === 'result').message, /接收或跳转返回错误/);
    assert.equal(records.get('a').data.options[1].after, 'edit B');
    assert.equal(view.active.version, 'v2');
    services.accept = realAccept;
    await send('dirty', {dirty: false, noteDirty: false, state: {c: view.active, drafts: {}}});
    services.save = async () => {throw new Error('unchanged text must not create a version');};
    await send('saveAccept', {option: 'B', value: 'edit B'});
    assert.equal(events.at(-1).type, 'accept'); assert.equal(events.at(-1).c.option, 'B');
    assert.equal(view.active.id, '2');
    assert(page.includes('data-action="noteHandoff"'));
    assert(page.includes('data-action="saveAccept"'));
    assert(page.includes('data-action="retryHandoff"'));
    assert(page.includes('id="comparisonChoice"'));

    // Lightweight view patches retain the draft payload; save-and-switch never accepts it.
    services.save = originalSave;
    await send('dirty', {dirty: true, noteDirty: true, state: {c: {...view.active}, drafts: {A: 'Saved before switch'},
        note: '先保留这个要求', scope: 'group', scrollTop: 10, composer: true}});
    await send('viewStatePatch', {patch: {scrollTop: 222, focus: 'note', textareas: {note: {start: 1, end: 1}}}});
    panel.visible = false; changed({webviewPanel: panel});
    await view.show(view.active); await receive({type: 'ready', instance: 'patch-restored'});
    restored = messages.findLast(m => m.type === 'content');
    assert.equal(restored.resume.scrollTop, 222);
    assert.equal(restored.resume.drafts.A, 'Saved before switch');
    confirmation = '保存并切换';
    const nextItem = make('3'); records.set('3', nextItem); view.setRecords(records);
    const acceptedBeforeSwitch = events.filter(e => e.type === 'accept').length;
    await send('switch', {target: '3'});
    assert.equal(view.active.id, '3');
    assert.equal(records.get('2').data.options[0].after, 'Saved before switch');
    assert.equal(records.get('2').data.edit.requests.at(-1).text, '先保留这个要求');
    assert.equal(events.filter(e => e.type === 'accept').length, acceptedBeforeSwitch);
    await send('dirty', {dirty: true, noteDirty: false, state: {c: {...view.active}, drafts: {B: 'Must survive failed save'}, note: ''}});
    services.save = async () => {throw new Error('fixture failed switch save');};
    await send('switch', {target: '2'});
    assert.equal(view.active.id, '3');
    assert.match(messages.findLast(m => m.type === 'result').message, /未切换/);
    await send('dirty', {dirty: false, noteDirty: false, state: {c: {...view.active}, drafts: {}, note: ''}});
    let finishHandoff;
    services.handoff = async () => new Promise(resolve => {finishHandoff = resolve;});
    const handoffRun = send('handoff');
    await send('note', {text: '交接期间仍可保存新要求'});
    assert.equal(records.get('3').data.edit.requests.at(-1).text, '交接期间仍可保存新要求');
    finishHandoff(); await handoffRun;
});

test('filtered navigation and own saves preserve exact note bindings without accepting or guessing', async () => {
    let receive, version = 1;
    const messages = [], writes = [];
    const records = new Map(['1', '2', 'a', 'b'].map(id => [id, {c: {repo: '/fixture', owner: 'reply.tex', id, version: 'v1'},
        data: {version: 'v1', original: 'Same original.', edit: {kind: /^\d/.test(id) ? 'manuscript' : 'response', file: 'paper.tex', versions: ['v1'], requests: [],
            questions: [{id: id === '2' ? 'R1-Q30' : 'R1-Q3', file: 'reply.tex', quote: 'Question'}]},
        options: [...'ABC'].map(label => ({label, after: label + ' text.', changes: [], reason: label}))}}]));
    const services = {read: async c => structuredClone(records.get(c.id).data), style: () => require('./review_style').defaults,
        selection: () => 'A', pdfStatus: () => '', autoTranslate: () => false,
        directory: () => [...records.values()].map(r => ({id: r.c.id, kind: r.data.edit.kind, questions: r.data.edit.questions.map(q => q.id), requests: 0})),
        save: async (c, label, after) => {writes.push('save'); const r = records.get(c.id); r.data.options.find(o => o.label === label).after = after;
            r.c.version = r.data.version = 'v' + ++version; r.data.edit.versions.push(r.c.version); view.sync(records, c); return structuredClone(r.data);}, saved() {},
        accept: async c => {writes.push('accept'); records.delete(c.id); view.sync(records, c);}};
    const vscode = {Uri: {file: fsPath => ({fsPath})}, ViewColumn: {One: 1}, window: {createWebviewPanel: () => ({visible: true, reveal() {}, dispose() {},
        onDidDispose() {}, onDidChangeViewState() {}, webview: {asWebviewUri: uri => uri.fsPath, onDidReceiveMessage: fn => {let pageInstance; receive = message => {if (message.type === 'ready') pageInstance = message.instance; return fn({...message, instance: message.instance ?? pageInstance});};}, postMessage: m => messages.push(m)}})}};
    const view = createWorkbench(vscode, {subscriptions: []}, services);
    view.setRecords(records); await view.show(records.get('1').c); await receive({type: 'ready'});
    const send = (type, extra = {}) => receive({type, id: view.active.id, version: view.active.version, ...extra});
    await send('dirty', {dirty: true, noteDirty: true, state: {drafts: {B: 'B changed.'}, note: 'Keep C exact', scope: 'C',
        selected: {side: 'candidate', option: 'C', value: 'C text.', start: 2, end: 6}}});
    await send('save', {option: 'B', value: 'B changed.'});
    let resume = messages.findLast(m => m.type === 'saved').resume;
    assert.equal(resume.selected.option, 'C'); assert.equal(resume.selectionStale, false); assert.equal(resume.scope, 'C');
    await send('save', {option: 'C', value: 'Different C.'});
    resume = messages.findLast(m => m.type === 'saved').resume;
    assert.equal(resume.selectionStale, true); assert.equal(resume.selected.value, 'C text.'); assert.equal(resume.note, 'Keep C exact');
    const saves = writes.length;
    await send('save', {option: 'C', value: 'Different C.'}); assert.equal(writes.length, saves, 'unchanged saves do not create versions');
    await send('save', {option: 'C', value: ''}); assert.equal(records.get('1').data.options[2].after, '', 'deleting all candidate text is valid');
    await send('dirty', {dirty: false, noteDirty: false});
    await send('filter', {filter: {query: 'R1-Q3', kind: 'response', notes: false}});
    await send('next'); assert.equal(view.active.id, 'a');
    await send('next'); assert.equal(view.active.id, 'b');
    await send('previous'); assert.equal(view.active.id, 'a');
    await send('viewState', {state: {c: view.active, drafts: {}, note: '', scrollTop: 321, anchor: {id: 'text-C', top: -20}, focused: 'C', comparison: 'A:C'}});
    services.related = async () => view.show(records.get('1').c);
    await send('related', {index: 0}); assert.equal(view.active.id, '1');
    assert.equal(messages.findLast(m => m.type === 'relatedReturn').id, 'a');
    // The origin can receive an AI update while we inspect another item.
    records.get('a').c.version = records.get('a').data.version = 'returned-v2';
    await send('backRelated'); assert.equal(view.active.id, 'a'); assert.equal(view.active.version, 'returned-v2');
    const returned = messages.findLast(m => m.type === 'content');
    assert.equal(returned.resume.scrollTop, 321); assert.equal(returned.resume.comparison, 'A:C');
    assert.deepEqual(returned.resume.drafts, {}); assert.equal(returned.navigationFilter.kind, 'response');
    await send('viewState', {state: {c: view.active, drafts: {}, note: '', scrollTop: 400, focused: 'C', comparison: 'A:C',
        selected: {value: 'Disposable selection'}, composer: true}});
    records.get('a').c.version = records.get('a').data.version = 'ai-v3'; view.sync(records, view.active);
    const updated = messages.findLast(m => m.type === 'content');
    assert.equal(updated.c.version, 'ai-v3'); assert.equal(updated.resume.scrollTop, 400);
    assert.equal(updated.resume.focused, 'C'); assert.equal(updated.resume.selected, undefined); assert.equal(updated.resume.composer, false);
    await send('accept', {option: 'A'}); assert.equal(view.active.id, 'b');
    await send('related', {index: 0}); assert.equal(view.active.id, '1');
    records.delete('b'); view.setRecords(records);
    await send('backRelated'); assert.equal(view.active.id, '1');
    assert.match(messages.findLast(m => m.type === 'result').message, /不再可用/);
    records.set('b', {c: {repo: '/fixture', owner: 'reply.tex', id: 'b', version: 'v1'}, data: structuredClone(records.get('1').data)});
    records.get('b').data.edit.kind = 'response'; records.get('b').data.version = 'v1';
    await send('switch', {target: 'b'});
    await send('accept', {option: 'A'}); assert.equal(view.active.id, 'b', 'do not escape filter after its last item');
    await send('filter', {filter: {query: '', kind: '', notes: false}});
    await send('next'); assert.equal(view.active.id, '1');
    assert.deepEqual(filterItems(services.directory(), {query: 'R1-Q3', kind: '', notes: false}).map(i => i.id), ['1']);
    assert.deepEqual(filterItems(services.directory(), {query: '', kind: '', notes: true}), []);
    assert.equal(records.get('1').data.original, 'Same original.');
});

test('postponed queue persists per project and session without changing review state', async () => {
    let receive, session='round-one'; const values={}, messages=[];
    const workspaceState={get:(k, fallback)=>values[k] ?? fallback, update:async(k,v)=>{values[k]=structuredClone(v);}};
    const c={repo:'/fixture',owner:'state',id:'1',version:'v1'}, c2={...c,id:'2'};
    const data=id=>({id,version:'v1',original:'Old',source_match:true,edit:{file:'x.tex',kind:'manuscript',status:'pending',versions:['v1'],requests:[]},options:[{label:'A',after:'New',reason:'A'}]});
    const d1=data('1'), d2=data('2'), records=new Map([['1',{c,data:d1}],['2',{c:c2,data:d2}]]);
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
    const services={session:()=>session,read:async x=>structuredClone(records.get(x.id).data),readNext:async x=>structuredClone(records.get(x.id).data),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[d1,d2].map(d=>({id:d.id,...d.edit,version:'v1'}))};
    const view=createWorkbench(vscode,{subscriptions:[],workspaceState},services); view.setRecords(records); await view.show(c); await receive({type:'ready',instance:'page'});
    await receive({type:'postpone',instance:'page',id:'1',version:'v1'});
    assert.equal(view.active.id,'2'); assert.equal(d1.edit.status,'pending');
    assert.deepEqual(values.reviewPostponed[JSON.stringify(['/fixture','state','round-one'])],['1']);
    await receive({type:'filter',filter:{query:'',kind:'',notes:false,queue:'deferred'}});
    await receive({type:'switch',instance:'page',id:'2',version:'v1',target:'1'});
    assert.equal(view.active.id,'1');
    await receive({type:'restorePostponed',instance:'page',id:'1',version:'v1'});
    assert.deepEqual(values.reviewPostponed[JSON.stringify(['/fixture','state','round-one'])],[]);
    await receive({type:'postpone',instance:'page',id:'1',version:'v1'});
    const reopened=createWorkbench(vscode,{subscriptions:[],workspaceState},services); reopened.setRecords(records);
    await reopened.show(c2); await receive({type:'ready',instance:'reopened'});
    assert.equal(messages.filter(m=>m.type==='content').at(-1).directory.find(i=>i.id==='1').postponed,true);
    session='round-two'; view.sync(records,c);
    assert.equal(messages.filter(m=>m.type==='directory').at(-1).directory.find(i=>i.id==='1').postponed,false);
    assert.equal(filterItems([{id:'1',postponed:true},{id:'2'}],{query:'',kind:'',notes:false}).length,1);
});

test('stash closes and restores only the exact session and source baseline', async () => {
    let receive, onDispose, session='s1', data;
    const values={}, messages=[], writes=[];
    const workspaceState={get:(k,f)=>values[k] ?? f,update:async(k,v)=>{values[k]=structuredClone(v);}};
    const c={repo:'/stash-project',owner:'state',id:'1',version:'v1'};
    const make=original=>({id:'1',version:'v1',original,source_match:true,block:{id:'b',text:original,source_revision:original},edit:{file:'main.tex',kind:'manuscript',versions:['v1'],requests:[]},options:[{label:'A',after:'Candidate',reason:'A'}]});
    data=make('Original');
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{showWarningMessage:async()=>undefined,createWebviewPanel:()=>({visible:true,reveal(){},dispose(){onDispose();},onDidDispose:f=>{onDispose=f;},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
    const services={session:()=>session,read:async()=>structuredClone(data),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[{id:'1',...data.edit}],save:()=>writes.push('save'),note:()=>writes.push('note'),saveSource:()=>writes.push('source')};
    const context={subscriptions:[],workspaceState};
    const state={c,drafts:{A:'Draft'},blockDraft:'Source draft',note:'Note draft',selected:{side:'original',value:'Original',start:0,end:3},scope:'original',editors:['A'],textareas:{},expandedNotes:[]};
    let view=createWorkbench(vscode,context,services); view.setRecords(new Map([['1',{c,data}]])); await view.show(c); await receive({type:'ready',instance:'one'});
    await receive({type:'stashClose',instance:'one',id:'1',version:'v1',state});
    assert.equal(view.active,undefined); assert.deepEqual(writes,[]);
    view=createWorkbench(vscode,context,services); view.setRecords(new Map([['1',{c,data}]])); await view.show(c); await receive({type:'ready',instance:'two'});
    const stash=messages.filter(m=>m.type==='content').at(-1).stashes[0]; assert.equal(stash.exact,true);
    await receive({type:'restoreStash',instance:'two',id:'1',version:'v1',stash:stash.id});
    const restored=messages.filter(m=>m.type==='content').at(-1).resume;
    assert.equal(restored.drafts.A,'Draft'); assert.equal(restored.blockDraft,'Source draft'); assert.equal(restored.note,'Note draft'); assert.deepEqual(writes,[]);
    data=make('Changed'); session='s2';
    view=createWorkbench(vscode,context,services); view.setRecords(new Map([['1',{c,data}]])); await view.show(c); await receive({type:'ready',instance:'three'});
    const stale=messages.filter(m=>m.type==='content').at(-1).stashes[0]; assert.equal(stale.exact,false); assert.equal(stale.original,'Original');
    await receive({type:'restoreStash',instance:'three',id:'1',version:'v1',stash:stale.id});
    assert(messages.some(m=>m.error && m.message.includes('基准已变化'))); assert.deepEqual(writes,[]);
    const other={...c,repo:'/other-project'};
    view=createWorkbench(vscode,context,services); view.setRecords(new Map([['1',{c:other,data}]])); await view.show(other); await receive({type:'ready',instance:'four'});
    assert.deepEqual(messages.filter(m=>m.type==='content').at(-1).stashes,[]);
});

test('stash preserves an exact selection on a different question card', async () => {
    let receive,dispose; const values={},messages=[],notes=[];
    const workspaceState={get:(k,f)=>values[k]??f,update:async(k,v)=>{values[k]=structuredClone(v);}};
    const c={repo:'/fixture',owner:'state',id:'1',version:'v1'}, other={...c,id:'2',version:'v2'};
    const question={id:'Q',file:'q.txt',quote:'Explain.'}, questionKey=JSON.stringify([question.id,question.file,question.quote]);
    const make=(id,version)=>({id,version,original:'Original '+id,source_match:true,edit:{file:id+'.tex',kind:'manuscript',versions:[version],requests:[],questions:[question]},options:[{label:'A',after:'Candidate '+id,reason:'A'}]});
    const one=make('1','v1'),two=make('2','v2'),records=new Map([['1',{c,data:one}],['2',{c:other,data:two}]]);
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{showWarningMessage:async()=> '保存并切换',createWebviewPanel:()=>({visible:true,reveal(){},dispose(){dispose();},onDidDispose:f=>{dispose=f;},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
    const services={session:()=> 'session',read:async target=>structuredClone(records.get(target.id).data),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[],questions:()=>[{key:questionKey,question,entries:[{id:'1',version:'v1'},{id:'2',version:'v2'}],snapshot:'[]'}],note:async(...args)=>notes.push(args),saved:()=>{}};
    const view=createWorkbench(vscode,{subscriptions:[],workspaceState},services),open=async instance=>{view.setRecords(records);await view.show(c);await receive({type:'ready',instance});};
    const selected={side:'candidate',option:'A',questionTarget:'2',questionTargetVersion:'v2',questionKey,questionSource:'Candidate 2',questionViewStyle:'full',session:'session',value:'Candidate 2',start:0,end:9};
    selected.questionSourceKey=JSON.stringify(['session',questionKey,'2','v2','candidate','A','full','Candidate 2']);
    await open('p');await receive({type:'stashClose',instance:'p',...c,state:{c,drafts:{},note:'Draft note',selected,scope:'group',editors:[],textareas:{},expandedNotes:[]}});
    await open('q');const stash=messages.findLast(m=>m.type==='content').stashes[0];assert.equal(stash.exact,true);
    await receive({type:'restoreStash',instance:'q',...c,stash:stash.id});assert.deepEqual(messages.findLast(m=>m.type==='content').resume.selected,selected);
    const mode=JSON.stringify(['session',questionKey,'full','question']);await receive({type:'questionTranslationView',instance:'q',...c,session:'session',view:mode,visible:[]});
    await view.show(other);assert.equal(notes[0][0].id,'2');assert.equal(notes[0][1].quote,'Candidate');
    await view.show(c);
    await receive({type:'stashClose',instance:'q',...c,state:{c,drafts:{},note:'Preserve me',selected,scope:'group',editors:[],textareas:{},expandedNotes:[]}});
    records.set('2',{c:{...other,version:'v3'},data:make('2','v3')});
    await open('r');assert.equal(messages.findLast(m=>m.type==='content').stashes[0].exact,false,'changed target version cannot restore old binding');
});

test('a draft already stale before stashing cannot be restored as an exact draft', async () => {
    let receive,dispose;const values={},messages=[], c={repo:'/stale',owner:'state',id:'1',version:'v2'};
    const workspaceState={get:(k,f)=>values[k]??f,update:async(k,v)=>{values[k]=structuredClone(v);}};
    const data={id:'1',version:'v2',original:'Current',source_match:true,edit:{file:'x',kind:'manuscript',versions:['v1','v2'],requests:[]},options:[{label:'A',after:'Current candidate'}]};
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},dispose(){dispose();},onDidDispose:f=>{dispose=f;},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
    const services={session:()=> 's',read:async()=>structuredClone(data),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[{id:'1',...data.edit}]};
    const open=async()=>{const view=createWorkbench(vscode,{subscriptions:[],workspaceState},services);view.setRecords(new Map([['1',{c,data}]]));await view.show(c);await receive({type:'ready',instance:'p'});return view;};
    await open();await receive({type:'stashClose',instance:'p',id:'1',version:'v2',state:{c,drafts:{A:'Old draft'},oldOriginal:'Old',candidateDraftStale:true,sourceDraftStale:true}});
    await open();const stash=messages.filter(m=>m.type==='content').at(-1).stashes[0];assert.equal(stash.exact,false);assert.equal(stash.state.oldOriginal,'Old');
    await receive({type:'restoreStash',instance:'p',id:'1',version:'v2',stash:stash.id});assert(messages.some(m=>m.error&&m.message.includes('基准已变化')));
});

test('retired history messages cannot read or adopt old candidates', async () => {
    let receive; const messages=[], writes=[];
    const c={repo:'/history',owner:'state',id:'1',version:'v2'};
    const data={id:'1',version:'v2',original:'Current',source_match:true,edit:{file:'main.tex',kind:'manuscript',versions:['v1','v2'],requests:[]},options:[{label:'A',after:'Now',reason:'A'}]};
    const old={version:'v1',original:'Old',options:[{label:'A',after:'Old choice'}],edit:{...data.edit,previous_feedback:{version:'v1',requests:[{text:'Old note'}]}}};
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
    const services={session:()=> 's',read:async()=>structuredClone(data),history:async()=>{writes.push('history');return structuredClone(old);},style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[{id:'1',...data.edit}],accept:()=>writes.push('accept'),save:()=>writes.push('save')};
    const view=createWorkbench(vscode,{subscriptions:[]},services); view.setRecords(new Map([['1',{c,data}]])); await view.show(c); await receive({type:'ready',instance:'page'});
    await receive({type:'readHistory',instance:'page',id:'1',version:'v2',historyVersion:'v1'});
    assert(!messages.some(m=>m.type==='history')); assert(messages.some(m=>m.error));
    await receive({type:'adoptHistory',instance:'page',id:'1',version:'v2',option:'A',target:'A'});
    assert(!messages.some(m=>m.type==='historyAdopted')); assert.deepEqual(writes,[]);
    await receive({type:'readHistory',instance:'page',id:'1',version:'v2',historyVersion:'other'});
    assert(!messages.some(m=>m.type==='history'));
    await receive({type:'adoptHistory',instance:'page',id:'1',version:'v1',option:'A',target:'A'});
    assert(messages.some(m=>m.error && m.message.includes('当前项已更新'))); assert.deepEqual(writes,[]);
});

test('toolbar preferences save only supported action order and remain profile scoped', async () => {
    let receive; const messages=[], values={}, writes=[];
    const globalState={get:(key,fallback)=>values[key] ?? fallback,update:async(key,value)=>{writes.push(key);values[key]=structuredClone(value);}};
    const c={repo:'/one',owner:'state',id:'1',version:'v1'};
    const data={id:'1',version:'v1',original:'Old',source_match:true,edit:{file:'main.tex',kind:'manuscript',versions:['v1'],requests:[]},options:[{label:'A',after:'New'}]};
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
    const services={session:()=> 's',read:async()=>structuredClone(data),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[],
        toolbar:()=>values.reviewToolbar,saveToolbar:async value=>{writes.push('reviewToolbar');values.reviewToolbar=structuredClone(value);}};
    const view=createWorkbench(vscode,{subscriptions:[],globalState},services);view.setRecords(new Map([['1',{c,data}]]));await view.show(c);await receive({type:'ready',instance:'page'});
    const initial=messages.findLast(m=>m.type==='content').toolbar;assert.deepEqual(initial.visible,['previous','next']);
    await receive({type:'toolbarSave',instance:'page',toolbar:{order:['unknown'],visible:['unknown']}});assert.deepEqual(writes,[]);assert(messages.findLast(m=>m.type==='toolbarResult').error);
    const value={order:[...initial.order].reverse(),visible:['handoff','source']};await receive({type:'toolbarSave',instance:'page',toolbar:value});
    assert.deepEqual(writes,['reviewToolbar']);assert.deepEqual(values.reviewToolbar,value);
    await view.show(c);assert.deepEqual(messages.findLast(m=>m.type==='content').toolbar,value);
    const reset={order:[...initial.order],visible:['previous','next']};
    await receive({type:'toolbarSave',instance:'page',toolbar:reset});
    await receive({type:'reviewMode',instance:'page',...c,mode:'question',viewStyle:'full',questionKey:''});
    await view.show(c);
    assert.deepEqual(messages.findLast(m=>m.type==='content').toolbar,reset);
    assert.deepEqual(values.reviewToolbar,reset);
    values.reviewToolbar={order:['unknown'],visible:['unknown']};
    await assert.rejects(view.show(c),/工具栏设置无效/);
});

test('problem review mark is scoped and becomes stale after associated changes', async () => {
    let receive, snapshot=JSON.stringify([{id:'one'}]), session='s1', present=true; const qkey=JSON.stringify(['R1-Q1','r','Exact']); const messages=[],values={};
    const workspaceState={get:(k,f)=>values[k] ?? f,update:async(k,v)=>{values[k]=structuredClone(v);}};
    const c={repo:'/questions',owner:'state',id:'1',version:'v1'}, c2={...c,id:'2'};
    const data=id=>({id,version:'v1',original:'Old',source_match:true,edit:{file:'x.tex',kind:'manuscript',status:'pending',versions:['v1'],requests:[]},options:[{label:'A',after:'New',reason:'A'}]});
    const records=new Map([['1',{c,data:data('1')}],['2',{c:c2,data:data('2')}]]);
    const row=()=>({key:qkey,question:{id:'R1-Q1',file:'r',quote:'Exact'},snapshot,entries:[{id:'2',kind:'manuscript',file:'x.tex',status:'pending',version:'v1',requests:[]}]});
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
    const services={session:()=>session,questions:()=>present ? [row()] : [],read:async t=>structuredClone(records.get(t.id).data),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[...records].map(([id,r])=>({id,...r.data.edit}))};
    const view=createWorkbench(vscode,{subscriptions:[],workspaceState},services);view.setRecords(records);await view.show(c);await receive({type:'ready',instance:'page'});
    await receive({type:'checkQuestion',instance:'page',id:'1',version:'v1',questionKey:qkey,snapshot:JSON.stringify([{id:'one'}])});
    assert.equal(messages.filter(m=>m.type==='questionRows').at(-1).questions[0].checked,true);
    snapshot=JSON.stringify([{id:'two'}]);view.sync(records,c);assert.equal(messages.filter(m=>m.type==='questionRows').at(-1).questions[0].recheck,true);
    await receive({type:'checkQuestion',instance:'page',id:'1',version:'v1',questionKey:qkey,snapshot:JSON.stringify([{id:'one'}])});
    assert(messages.some(m=>m.error && m.message.includes('关联或批注已变化')));
    await receive({type:'questionEntry',instance:'page',id:'1',version:'v1',questionKey:qkey,target:'2',targetVersion:'v1'});
    assert.equal(view.active.id,'2'); present=false; view.sync(records,c); assert.equal(messages.filter(m=>m.type==='questionRows').at(-1).questions[0].recheck,true); present=true; session='s2';view.sync(records,c);assert.equal(messages.filter(m=>m.type==='questionRows').at(-1).questions[0].checked,false);
});

test('postpone does not override a later explicit navigation even when the author returns', async () => {
    for (const mode of ['same','other','back']) {
        let receive,release,start;const begun=new Promise(r=>start=r),gate=new Promise(r=>release=r),values={};
        const workspaceState={get:(k,f)=>values[k]??f,update:async(k,v)=>{values[k]=structuredClone(v);start();await gate;}};
        const c={repo:'/nav',owner:'state',id:'1',version:'v1'}, c2={...c,id:'2'},c3={...c,id:'3'};
        const data=id=>({id,version:'v1',original:'Old',source_match:true,edit:{file:'x',kind:'manuscript',status:'pending',versions:['v1'],requests:[]},options:[{label:'A',after:'New'}]});
        const records=new Map([c,c2,c3].map(x=>[x.id,{c:x,data:data(x.id)}]));
        const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage(){}}})}};
        const services={session:()=> 's',read:async x=>structuredClone(records.get(x.id).data),readNext:async x=>structuredClone(records.get(x.id).data),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[...records].map(([id,r])=>({id,...r.data.edit}))};
        const view=createWorkbench(vscode,{subscriptions:[],workspaceState},services);view.setRecords(records);await view.show(c);await receive({type:'ready',instance:'p'});
        const running=receive({type:'postpone',instance:'p',id:'1',version:'v1'});await begun;
        if(mode==='same') await view.show(c); else {await view.show(c3); if(mode==='back') await view.show(c);}
        release();await running;assert.equal(view.active.id,mode==='other'?'3':'1',mode);assert.deepEqual(values.reviewPostponed[JSON.stringify(['/nav','state','s'])],['1']);
    }
});

test('question review survives an unrelated prefix but not moving its fixed block across context', async () => {
    let receive;const values={}, messages=[], q={id:'R1-Q1',file:'review.txt',quote:'Question'}, id='11111111-1111-4111-8111-111111111111';
    const prefix='% TS-BLOCK-BEGIN id='+id+' kind=paragraph\n', content='Original.\n', suffix='% TS-BLOCK-END id='+id+'\n';
    const chunk=prefix+content+suffix, c={repo:'/move',owner:'state',id:'1',version:'v1'};
    const data={id:'1',version:'v1',original:'Original.',source_match:true,edit:{file:'main.tex',kind:'manuscript',status:'pending',versions:['v1'],block_id:id,requests:[],questions:[q]},options:[{label:'A',after:'New'}]};
    const state={edits:{'1':data.edit},cards:{'1':data},sources:{'main.tex':chunk+'\nAuthor context.\n'}};
    function locate(){const text=state.sources['main.tex'], at=text.indexOf(chunk);data.block={id,parent:null,marker_start:at,marker_end:at+chunk.length};data.source={start:at+prefix.length,end:at+prefix.length+9};}
    locate();const records=new Map([['1',{c,data}]]), workspaceState={get:(k,f)=>values[k]??f,update:async(k,v)=>{values[k]=structuredClone(v);}};
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(structuredClone(m))}})}};
    const services={session:()=> 's',questions:(_,checked)=>require('./inline_review').questionRows(state,checked),read:async()=>structuredClone(data),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[{id:'1',...data.edit}]};
    const view=createWorkbench(vscode,{subscriptions:[],workspaceState},services);view.setRecords(records);await view.show(c);await receive({type:'ready',instance:'p'});
    const first=messages.findLast(m=>m.type==='content').questions[0];await receive({type:'checkQuestion',instance:'p',id:'1',version:'v1',questionKey:first.key,snapshot:first.snapshot});
    state.sources['main.tex']='Unrelated prefix.\n\n'+state.sources['main.tex'];locate();view.sync(records,c);assert.equal(messages.findLast(m=>m.type==='questionRows').questions[0].checked,true);
    state.sources['main.tex']='Unrelated prefix.\n\nAuthor context.\nAnother paragraph.\n\n'+chunk;locate();view.sync(records,c);assert.equal(messages.findLast(m=>m.type==='questionRows').questions[0].recheck,true);
});

test('single workspace draft record retains only current and previous batch per project', async () => {
    let receive, dispose, session='s1';const values={}, messages=[];
    const workspaceState={get:(k,f)=>values[k]??f,update:async(k,v)=>{values[k]=structuredClone(v);}};
    const c={repo:'/limited',owner:'state',id:'1',version:'v1'}, other={...c,repo:'/other'};
    const data=t=>({id:'1',version:t.version,original:'Original',source_match:true,edit:{file:'x',kind:'manuscript',versions:[t.version],requests:[]},options:[{label:'A',after:'Candidate'}]});
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{showWarningMessage:async()=> '替换暂存',createWebviewPanel:()=>({visible:true,reveal(){},dispose(){dispose();},onDidDispose:f=>{dispose=f;},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
    const services={session:()=>session,read:async t=>data(t),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[{id:'1',...data(c).edit}]};
    async function stash(target,text){const view=createWorkbench(vscode,{subscriptions:[],workspaceState},services);view.setRecords(new Map([['1',{c:target,data:data(target)}]]));await view.show(target);await receive({type:'ready',instance:'p'});await receive({type:'stashClose',instance:'p',id:'1',version:target.version,state:{c:target,drafts:{A:text},note:'note',scope:'group',editors:[],textareas:{},expandedNotes:[]}});}
    await stash(other,'other');await stash(c,'first');
    const count=()=>Object.entries(values.reviewDrafts).filter(([k,d])=>k!=='_batches'&&d.c.repo==='/limited');
    const size=JSON.stringify(values.reviewDrafts).length;
    for(let i=0;i<5;i++){c.version='v'+(i+2);await stash(c,'other');}
    assert.equal(count().length,1);assert.equal(count()[0][1].state.drafts.A,'other');assert.equal(JSON.stringify(values.reviewDrafts).length,size);
    session='s2';await stash(c,'batch2');session='s3';await stash(c,'batch3');
    assert.deepEqual(count().map(([,d])=>d.session).sort(),['s2','s3']);
    assert(Object.values(values.reviewDrafts).some(d=>d?.c?.repo==='/other'&&d.state.drafts.A==='other'));
    assert.deepEqual(values.reviewDrafts._batches[JSON.stringify(['/limited','state'])],['s3','s2']);
    for (const next of ['s4','s5']) {
        session=next;const view=createWorkbench(vscode,{subscriptions:[],workspaceState},services);
        view.setRecords(new Map([['1',{c,data:data(c)}]]));await view.show(c);
    }
    assert.equal(count().length,0,'batches without stashes still advance the retention window');
    assert(Object.values(values.reviewDrafts).some(d=>d?.c?.repo==='/other'));
});

test('observed empty sessions roll closed and other-project drafts in order', async () => {
    let receive, dispose, release, waiting=false, session='A'; const values={}, errors=[];
    const workspaceState={get:(k,f)=>values[k]??f,update:async(k,v)=>{if(waiting){waiting=false;await new Promise(r=>release=r);}values[k]=structuredClone(v);}};
    const c={repo:'/closed',owner:'state',id:'1',version:'v1'}, other={...c,repo:'/other'};
    const data={id:'1',version:'v1',original:'Original',source_match:true,edit:{file:'x',kind:'manuscript',versions:['v1'],requests:[]},options:[{label:'A',after:'Candidate'}]};
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{showErrorMessage:m=>errors.push(m),createWebviewPanel:()=>({visible:true,reveal(){},dispose(){dispose();},onDidDispose:f=>{dispose=f;},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage(){}}})}};
    const services={session:t=>t.repo===c.repo?session:'other-session',read:async()=>structuredClone(data),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[{id:'1',...data.edit}]};
    const view=createWorkbench(vscode,{subscriptions:[],workspaceState},services);view.setRecords(new Map([['1',{c,data}]]));await view.show(c);await receive({type:'ready',instance:'p'});
    await receive({type:'stashClose',instance:'p',id:'1',version:'v1',state:{c,drafts:{A:'private A'},note:'private note',selected:{value:'nested secret'}}});
    session='B';waiting=true;view.observeSession(c,'B');await new Promise(r=>setImmediate(r));
    session='C';view.observeSession(c,'C');release();
    await view.show(other);view.sync(new Map(),c);
    await view.show(c);assert.deepEqual(values.reviewDrafts._batches[JSON.stringify(['/closed','state'])],['C','B']);
    assert(!JSON.stringify(values.reviewDrafts).includes('private'));assert.deepEqual(errors,[]);
});

test('restored components are consumed only after successful saves and preserve the old base', async () => {
    for (const component of ['note','edit','candidate','source','failure']) {
        let receive,dispose;const values={},messages=[],writes=[];
        const c={repo:'/consume',owner:'state',id:'1',version:'v1'};
        let data={id:'1',version:'v1',original:'Original',source_match:true,block:{id:'b',text:'Original\n'},edit:{file:'x',kind:'manuscript',versions:['v1'],requests:[{id:'r1',version:'v1',status:'open',text:'old'}]},options:[{label:'A',after:'Candidate'}]};
        const workspaceState={get:(k,f)=>values[k]??f,update:async(k,v)=>{values[k]=structuredClone(v);}};
        const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{showWarningMessage:async(_m,_o,a)=>a,showErrorMessage:m=>messages.push({error:true,message:m}),createWebviewPanel:()=>({visible:true,reveal(){},dispose(){dispose();},onDidDispose:f=>{dispose=f;},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(structuredClone(m))}})}};
        const services={session:()=> 's',read:async()=>structuredClone(data),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[{id:'1',...data.edit}],saved(){},note:async(_c,_selection,text)=>{if(component==='failure')throw Error('note failed');writes.push(text);},editNote:async(_c,note,text,previous)=>{assert.equal(note.id,'r1');assert.equal(previous,'old');writes.push(text);},save:async(_c,_label,value)=>{writes.push(value);data={...data,version:'v2',edit:{...data.edit,versions:['v1','v2']},options:[{label:'A',after:value}]};return structuredClone(data);},saveSource:async(_c,_block,value)=>{writes.push(value);}};
        const view=createWorkbench(vscode,{subscriptions:[],workspaceState},services), records=new Map([['1',{c,data}]]);view.setRecords(records);await view.show(c);await receive({type:'ready',instance:'p'});
        const state={c,drafts:{A:'New candidate'},blockDraft:'New source',note:'New note',...(component==='edit'?{editingNote:{id:'r1',previousText:'old'}}:{}),scope:'group',editors:[],textareas:{},expandedNotes:[]};
        await receive({type:'stashClose',instance:'p',id:'1',version:'v1',state});view.setRecords(records);await view.show(c);await receive({type:'ready',instance:'q'});
        const draft=messages.findLast(m=>m.type==='content').stashes[0];await receive({type:'restoreStash',instance:'q',id:'1',version:'v1',stash:draft.id});
        if(component==='candidate') {
            await receive({type:'dirty',instance:'q',id:'1',version:'v1',dirty:true,noteDirty:false,state:{...state,note:''}});
            await receive({type:'save',instance:'q',id:'1',version:'v1',option:'A',value:'New candidate'});
            await receive({type:'accept',instance:'q',id:'1',version:'v2',option:'A'});
            assert(messages.some(m=>m.error&&m.message.includes('先保存候选和返修要求')),'unsaved source still blocks acceptance');
        }
        else if(component==='source') await receive({type:'saveSource',instance:'q',id:'1',version:'v1',value:'New source'});
        else {await receive({type:'dirty',instance:'q',id:'1',version:'v1',dirty:false,noteDirty:true,state});await receive(component==='edit'?{type:'editNote',instance:'q',id:'1',version:'v1',request:'r1',previousText:'old',text:'New note'}:{type:'note',instance:'q',id:'1',version:'v1',side:'original',text:'New note'});}
        const record=values.reviewDrafts[draft.id];assert(record,component);
        assert.equal(record.state.note,['note','edit'].includes(component)?'':'New note',component);
        assert.equal(record.state.drafts.A,component==='candidate'?undefined:'New candidate',component);
        assert.equal(record.state.blockDraft,component==='source'?undefined:'New source',component);
        assert.equal(record.c.version,'v1');assert.equal(record.original,'Original');
        if(component==='failure') assert(messages.some(m=>m.error&&m.message.includes('note failed')));
        if(component==='candidate') assert.equal(messages.findLast(m=>m.type==='saved').stashes[0].exact,false);
    }
});

test('an old note save does not consume a newer identical stash or clear its page', async () => {
    let receive,dispose,release,started;const begun=new Promise(r=>started=r),gate=new Promise(r=>release=r),values={},messages=[];
    const c={repo:'/race',owner:'state',id:'1',version:'v1'}, data={id:'1',version:'v1',original:'Original',source_match:true,edit:{file:'x',kind:'manuscript',versions:['v1'],requests:[]},options:[{label:'A',after:'Candidate'}]};
    const workspaceState={get:(k,f)=>values[k]??f,update:async(k,v)=>{values[k]=structuredClone(v);}};
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{showWarningMessage:async(_m,_o,a)=>a,showErrorMessage:m=>messages.push({error:true,message:m}),createWebviewPanel:()=>({visible:true,reveal(){},dispose(){dispose();},onDidDispose:f=>{dispose=f;},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(structuredClone(m))}})}};
    const services={session:()=> 's',read:async()=>structuredClone(data),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[{id:'1',...data.edit}],note:async()=>{started();await gate;}};
    const view=createWorkbench(vscode,{subscriptions:[],workspaceState},services),records=new Map([['1',{c,data}]]),state={c,drafts:{},note:'same',purpose:'skill',scope:'group',editors:[],textareas:{}};
    const open=async instance=>{view.setRecords(records);await view.show(c);await receive({type:'ready',instance});};
    await open('p');await receive({type:'stashClose',instance:'p',id:'1',version:'v1',state});await open('q');
    const draft=messages.findLast(m=>m.type==='content').stashes[0];await receive({type:'restoreStash',instance:'q',id:'1',version:'v1',stash:draft.id});
    const saving=receive({type:'note',instance:'q',id:'1',version:'v1',side:'original',text:'same'});await begun;
    dispose();await open('r');await receive({type:'stashClose',instance:'r',id:'1',version:'v1',state});
    const replacement=structuredClone(values.reviewDrafts[draft.id]);assert.notEqual(JSON.stringify(replacement),undefined);
    await open('s');await receive({type:'restoreStash',instance:'s',id:'1',version:'v1',stash:draft.id});
    release();await saving;assert.deepEqual(values.reviewDrafts[draft.id],replacement);
    assert.equal(messages.findLast(m=>m.type==='content').resume.note,'same');
    assert.equal(messages.findLast(m=>m.type==='content').resume.purpose,'skill');
});

test('a changed purpose during note save remains in the draft', async () => {
    let receive,release,start;const begun=new Promise(r=>start=r),gate=new Promise(r=>release=r),messages=[],saved=[];
    const c={repo:'/purpose-race',owner:'state',id:'1',version:'v1'},data={id:'1',version:'v1',original:'Original',source_match:true,edit:{file:'x',kind:'manuscript',versions:['v1'],requests:[]},options:[{label:'A',after:'Candidate'}]};
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(structuredClone(m))}})}};
    const services={session:()=> 's',read:async()=>structuredClone(data),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[{id:'1',...data.edit}],note:async(_c,selected)=>{saved.push(selected.purpose);start();await gate;}};
    const view=createWorkbench(vscode,{subscriptions:[]},services);view.setRecords(new Map([['1',{c,data}]]));await view.show(c);await receive({type:'ready',instance:'p'});
    await receive({type:'dirty',instance:'p',id:'1',version:'v1',dirty:false,noteDirty:true,state:{c,drafts:{},note:'same',purpose:'personal'}});
    const saving=receive({type:'note',instance:'p',id:'1',version:'v1',side:'original',text:'same',purpose:'personal'});await begun;
    await receive({type:'dirty',instance:'p',id:'1',version:'v1',dirty:false,noteDirty:true,state:{c,drafts:{},note:'same',purpose:'discussion'}});
    release();await saving;assert.deepEqual(saved,['personal']);assert.equal(messages.findLast(m=>m.type==='noteSaved').preserveInput,true);
});

test('saving the only restored note removes a record containing just an unchanged block', async () => {
    let receive,dispose;const values={},messages=[],notes=[];
    const c={repo:'/only-note',owner:'state',id:'1',version:'v1'},data={id:'1',version:'v1',original:'Original',source_match:true,block:{id:'b',text:'Original\n'},edit:{file:'x',kind:'manuscript',versions:['v1'],requests:[]},options:[{label:'A',after:'Candidate'}]};
    const workspaceState={get:(k,f)=>values[k]??f,update:async(k,v)=>{values[k]=structuredClone(v);}};
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},dispose(){dispose();},onDidDispose:f=>{dispose=f;},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(structuredClone(m))}})}};
    const services={session:()=> 's',read:async()=>structuredClone(data),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[{id:'1',...data.edit}],note:async(_c,_selected,text)=>notes.push(text)};
    const view=createWorkbench(vscode,{subscriptions:[],workspaceState},services),records=new Map([['1',{c,data}]]);
    const open=async instance=>{view.setRecords(records);await view.show(c);await receive({type:'ready',instance});};
    await open('p');await receive({type:'stashClose',instance:'p',id:'1',version:'v1',state:{c,drafts:{},blockDraft:'Original\n',note:'new note'}});
    await open('q');const stash=messages.findLast(m=>m.type==='content').stashes[0];await receive({type:'restoreStash',instance:'q',id:'1',version:'v1',stash:stash.id});
    await receive({type:'note',instance:'q',id:'1',version:'v1',side:'original',text:'new note'});
    assert.deepEqual(notes,['new note']);assert.equal(values.reviewDrafts[stash.id],undefined);assert.deepEqual(messages.findLast(m=>m.type==='stashes').stashes,[]);
    for (const text of ['another note','new note']) {
        await receive({type:'dirty',instance:'q',id:'1',version:'v1',dirty:false,noteDirty:true,state:{c,drafts:{},note:text}});
        const before=messages.length;await receive({type:'note',instance:'q',id:'1',version:'v1',side:'original',text});
        assert(messages.slice(before).some(m=>m.type==='noteSaved'));assert(!messages.slice(before).some(m=>m.error));
    }
    assert.deepEqual(notes,['new note','another note','new note']);
});

test('saving a last candidate or source draft allows a later independent note', async () => {
    for (const component of ['candidate','source']) {
        let receive,dispose;const values={},messages=[],notes=[];
        const c={repo:'/last-'+component,owner:'state',id:'1',version:'v1'};
        let data={id:'1',version:'v1',original:'Original',source_match:true,block:{id:'b',text:'Original\n'},edit:{file:'x',kind:'manuscript',versions:['v1'],requests:[]},options:[{label:'A',after:'Candidate'}]};
        const workspaceState={get:(k,f)=>values[k]??f,update:async(k,v)=>{values[k]=structuredClone(v);}};
        const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},dispose(){dispose();},onDidDispose:f=>{dispose=f;},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(structuredClone(m))}})}};
        const services={session:()=> 's',read:async()=>structuredClone(data),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[{id:'1',...data.edit}],saved(){},note:async(_c,_selected,text)=>notes.push(text),saveSource:async()=>{},save:async()=>{data={...data,version:'v2',edit:{...data.edit,versions:['v1','v2']},options:[{label:'A',after:'new candidate'}]};return structuredClone(data);}};
        const view=createWorkbench(vscode,{subscriptions:[],workspaceState},services),records=new Map([['1',{c,data}]]),open=async instance=>{view.setRecords(records);await view.show(c);await receive({type:'ready',instance});};
        await open('p');const state={c,drafts:component==='candidate'?{A:'new candidate'}:{},blockDraft:component==='source'?'new source':'Original\n',note:''};
        await receive({type:'stashClose',instance:'p',id:'1',version:'v1',state});await open('q');const stash=messages.findLast(m=>m.type==='content').stashes[0];
        await receive({type:'restoreStash',instance:'q',id:'1',version:'v1',stash:stash.id});
        if(component==='candidate') await receive({type:'save',instance:'q',id:'1',version:'v1',option:'A',value:'new candidate'});
        else await receive({type:'saveSource',instance:'q',id:'1',version:'v1',value:'new source'});
        assert.equal(values.reviewDrafts[stash.id],undefined,component);
        const version=view.active.version;await receive({type:'dirty',instance:'q',id:'1',version,dirty:false,noteDirty:true,state:{c:{...c,version},drafts:{},note:'later'}});
        const before=messages.length;await receive({type:'note',instance:'q',id:'1',version,side:'original',text:'later'});
        assert.deepEqual(notes,['later'],component);assert(messages.slice(before).some(m=>m.type==='noteSaved'),component);assert(!messages.slice(before).some(m=>m.error),component);
    }
});

test('typing a newer candidate while save-and-accept runs keeps it and stops acceptance', async () => {
    let receive,release,start;const begun=new Promise(r=>start=r),gate=new Promise(r=>release=r),messages=[],accepted=[];
    const c={repo:'/typing',owner:'state',id:'1',version:'v1'},data={id:'1',version:'v1',original:'Original',source_match:true,edit:{file:'x',kind:'manuscript',versions:['v1'],requests:[]},options:[{label:'A',after:'Candidate'}]};
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(structuredClone(m))}})}};
    const services={session:()=> 's',read:async()=>structuredClone(data),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[{id:'1',...data.edit}],save:async()=>{start();await gate;return {...data,version:'v2',options:[{label:'A',after:'first'}]};},accept:async()=>accepted.push(true)};
    const view=createWorkbench(vscode,{subscriptions:[]},services);view.setRecords(new Map([['1',{c,data}]]));await view.show(c);await receive({type:'ready',instance:'p'});
    await receive({type:'dirty',instance:'p',id:'1',version:'v1',dirty:true,state:{c,drafts:{A:'first'}}});
    const saving=receive({type:'saveAccept',instance:'p',id:'1',version:'v1',option:'A',value:'first'});await begun;
    await receive({type:'dirty',instance:'p',id:'1',version:'v1',dirty:true,state:{c,drafts:{A:'newer'}}});release();await saving;
    assert.deepEqual(accepted,[]);assert.equal(messages.findLast(m=>m.type==='saved').resume.drafts.A,'newer');
    assert(messages.some(m=>m.error&&m.message.includes('保存期间产生的新草稿')));
});

test('batch selections survive page reconstruction and remove only accepted identities', async () => {
    let receive, session='s'; const messages=[];
    const c={repo:'/batch',owner:'state',id:'1',version:'v1'};
    const data={id:'1',version:'v1',original:'Original',source_match:true,edit:{file:'x',kind:'manuscript',versions:['v1'],requests:[]},options:[{label:'A',after:'Candidate'}]};
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(structuredClone(m))}})}};
    const services={session:()=>session,read:async()=>structuredClone(data),style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,directory:()=>[{id:'1',...data.edit}],acceptBatch:async()=>{}};
    const view=createWorkbench(vscode,{subscriptions:[]},services); view.setRecords(new Map([['1',{c,data}]])); await view.show(c); await receive({type:'ready',instance:'one'});
    const items=[{id:'1',version:'v1',option:'A'},{id:'2',version:'old',option:'B'}];
    await receive({type:'batchSelection',instance:'one',repo:c.repo,owner:c.owner,session,items});
    await receive({type:'ready',instance:'two'}); assert.deepEqual(messages.findLast(m=>m.type==='content').batchItems,items);
    await receive({type:'acceptBatch',instance:'two',repo:c.repo,owner:c.owner,id:'1',version:'v1',session,items:[items[0]]});
    await receive({type:'ready',instance:'three'}); assert.deepEqual(messages.findLast(m=>m.type==='content').batchItems,[items[1]]);
    session='next'; await receive({type:'ready',instance:'four'}); assert.deepEqual(messages.findLast(m=>m.type==='content').batchItems,[]);
    await receive({type:'batchSelection',instance:'one',repo:c.repo,owner:c.owner,session:'s',items});
    await receive({type:'ready',instance:'five'}); assert.deepEqual(messages.findLast(m=>m.type==='content').batchItems,[]);
});

test('translation selection resolves the exact candidate cache key and rejects stale provider', async () => {
    let receive, provider='controlled'; const messages=[], notes=[];
    const c={repo:'/translated',owner:'state',id:'1',version:'v1'}, data={id:'1',version:'v1',original:'Same',source_match:true,edit:{file:'x',kind:'manuscript',versions:['v1'],requests:[],questions:[{id:'q',file:'x',quote:'Question'}]},options:[{label:'A',after:'Same'},{label:'B',after:'Same'}]};
    const vscode={Uri:{file:fsPath=>({fsPath})},ViewColumn:{One:1},window:{createWebviewPanel:()=>({visible:true,reveal(){},onDidDispose(){},onDidChangeViewState(){},webview:{cspSource:'vscode-webview:',asWebviewUri:u=>({toString:()=>u.fsPath}),onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)}})}};
    const services={read:async()=>data,style:()=>require('./review_style').defaults,selection:()=> 'A',pdfStatus:()=>'',autoTranslate:()=>false,provider:()=>provider,directory:()=>[],translate:async(_text,_provider,item)=>({text:item.option || item.key}),note:async(...args)=>notes.push(args)};
    const view=createWorkbench(vscode,{subscriptions:[]},services);view.setRecords(new Map([['1',{c,data}]]));await view.show(c);await receive({type:'ready',instance:'p'});await receive({type:'translate',instance:'p',id:'1',version:'v1'});await view.whenTranslationIdle();
    const send=extra=>receive({type:'note',instance:'p',id:'1',version:'v1',side:'translation',provider:'controlled',start:0,end:1,text:'note',...extra});
    await send({option:'A',value:'A'}); await send({option:'B',value:'B'}); await send({value:'original'}); await send({question:data.edit.questions[0],value:'question0'});
    assert.equal(notes.length,4);assert.equal(notes[0][1].option,'A');assert.equal(notes[1][1].option,'B');assert.equal(notes[3][1].display_context.source_side,'question');
    await send({option:'A',value:'B'}); await send({option:'missing',value:'A'});
    await receive({type:'note',instance:'p',id:'1',version:'old',side:'translation',provider:'controlled',option:'A',value:'A',start:0,end:1,text:'stale'});
    assert.equal(notes.length,4);
    provider='other'; await send({option:'A',value:'A'}); assert.equal(notes.length,4); assert(messages.some(m=>m.error&&m.message.includes('译文已变化')));
});
