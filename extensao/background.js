/* Salva a página (ou o link clicado) como tarefa: "AAAA-MM-DD título url +inbox @ler". */
if(typeof importScripts==='function')importScripts('dropbox.js');
const X=typeof browser!=='undefined'?browser:chrome;

function badge(txt,color,tabId){
  try{X.action.setBadgeBackgroundColor({color});X.action.setBadgeText({text:txt});
    setTimeout(()=>X.action.setBadgeText({text:''}),2500)}catch(e){}
}
function note(msg){
  try{X.notifications.create({type:'basic',iconUrl:'icon.png',title:'PraFazer',message:msg})}catch(e){}
}
async function queue(){return(await X.storage.local.get('queue')).queue||[]}
async function setQueue(q){await X.storage.local.set({queue:q});if(q.length)X.alarms.create('reenviar',{delayInMinutes:3,periodInMinutes:5});else X.alarms.clear('reenviar')}

async function flushQueue(){
  const q=await queue(),left=[];
  for(const it of q){try{await PF.append(it.ws,it.line)}catch(e){left.push(it)}}
  if(left.length!==q.length)await setQueue(left);
  return left.length;
}

async function save(title,url){
  if(!/^https?:\/\//i.test(url||'')){badge('!','#c0392b');note('Só páginas http(s) podem ser salvas.');return}
  const cfg=await PF.getCfg(),line=PF.buildLine(title,url,cfg);
  try{
    await PF.append(cfg.ws,line,cfg);
    badge('✓','#2e8b57');
    flushQueue().catch(()=>{});
  }catch(e){
    if(/autorize/.test(String(e.message))){badge('!','#c0392b');note(e.message);X.runtime.openOptionsPage();return}
    await setQueue([...await queue(),{ws:cfg.ws,line}]);   // sem rede/erro: guarda e reenvia depois
    badge('…','#d98e04');note('Não consegui enviar agora; fica na fila para reenviar. ('+String(e.message).slice(0,80)+')');
  }
}

X.action.onClicked.addListener(tab=>save(tab.title,tab.url));
X.commands.onCommand.addListener((cmd,tab)=>{
  if(cmd!=='salvar')return;
  if(tab)save(tab.title,tab.url);else X.tabs.query({active:true,currentWindow:true}).then(t=>t[0]&&save(t[0].title,t[0].url));
});
X.runtime.onInstalled.addListener(()=>{
  X.contextMenus.removeAll(()=>X.contextMenus.create({id:'salvar',title:'Salvar no PraFazer (+inbox)',contexts:['page','link']}));
});
X.contextMenus.onClicked.addListener((info,tab)=>{
  if(info.linkUrl)save(info.linkText||info.selectionText||'',info.linkUrl);
  else save(tab.title,info.pageUrl||tab.url);
});
X.alarms.onAlarm.addListener(a=>{if(a.name==='reenviar')flushQueue()});
