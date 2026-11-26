const X=typeof browser!=='undefined'?browser:chrome,$=id=>document.getElementById(id);
const say=(t,ok)=>{const m=$('msg');m.textContent=t;m.className=ok?'ok':'err'};
async function load(){
  const c=await PF.getCfg();
  ['key','ws','tag','ctx','prefix'].forEach(k=>$(k).value=c[k]);
  $('st').textContent=c.refresh?'· conectado ✓':'· não conectado';$('st').className=c.refresh?'ok':'err';
}
$('gen').onclick=async()=>{
  const key=$('key').value.trim();if(!key){$('lnk').textContent='Informe a App key.';return}
  const u=await PF.authStart(key);
  $('lnk').innerHTML='Abra, autorize e copie o código: <a href="'+u+'" target="_blank" rel="noopener">'+u+'</a>';
};
$('fin').onclick=async()=>{
  try{await PF.authFinish($('code').value);$('code').value='';$('lnk').textContent='';say('Autorizado.',true);load()}
  catch(e){say(String(e.message||e),false)}
};
$('sv').onclick=async()=>{
  await X.storage.local.set({key:$('key').value.trim(),ws:$('ws').value,tag:$('tag').value.trim(),ctx:$('ctx').value.trim(),prefix:$('prefix').value.trim()});
  say('Opções salvas.',true);
};
load();
