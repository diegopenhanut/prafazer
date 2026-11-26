/* Grava uma linha no todo.txt do PraFazer pelo Dropbox (mesmo mecanismo do plugin do Flow Launcher). */
var PF=(function(){
  const PATHS={pessoal:'/todo.txt',trabalho:'/trabalho.txt'};
  const DEFAULTS={key:'',refresh:'',ws:'pessoal',tag:'+inbox',ctx:'@ler',prefix:''};
  let _tok={v:'',exp:0};
  const api=()=>typeof browser!=='undefined'?browser:chrome;

  async function getCfg(){return Object.assign({},DEFAULTS,await api().storage.local.get(Object.keys(DEFAULTS)))}
  const b64=buf=>btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

  async function tokenReq(params){
    const r=await fetch('https://api.dropboxapi.com/oauth2/token',{method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params)});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(j.error_description||j.error||('HTTP '+r.status));
    return j;
  }
  async function access(cfg){
    if(_tok.v&&Date.now()<_tok.exp)return _tok.v;
    const j=await tokenReq({grant_type:'refresh_token',refresh_token:cfg.refresh,client_id:cfg.key});
    _tok={v:j.access_token,exp:Date.now()+((j.expires_in||3600)-60)*1000};
    return _tok.v;
  }
  const argHdr=o=>JSON.stringify(o).replace(/[\u007f-￿]/g,c=>'\\u'+('0000'+c.charCodeAt(0).toString(16)).slice(-4));

  async function download(cfg,path){
    const r=await fetch('https://content.dropboxapi.com/2/files/download',{method:'POST',
      headers:{Authorization:'Bearer '+await access(cfg),'Dropbox-API-Arg':argHdr({path})}});
    if(r.status===409){const t=await r.text();if(/not_found/.test(t))return{text:'',rev:''};throw new Error(t.slice(0,200))}
    if(!r.ok)throw new Error('download HTTP '+r.status);
    let rev='';try{rev=JSON.parse(r.headers.get('dropbox-api-result')||'{}').rev||''}catch(e){}
    return{text:await r.text(),rev};
  }
  async function upload(cfg,path,text,rev){
    const arg={path,mode:rev?{'.tag':'update',update:rev}:'overwrite',mute:true};
    const r=await fetch('https://content.dropboxapi.com/2/files/upload',{method:'POST',
      headers:{Authorization:'Bearer '+await access(cfg),'Content-Type':'application/octet-stream','Dropbox-API-Arg':argHdr(arg)},body:text});
    if(r.status===409)return false;                       // o arquivo mudou no meio: tentar de novo
    if(!r.ok)throw new Error('upload HTTP '+r.status+' '+(await r.text()).slice(0,200));
    const j=await r.json();
    if(j.path_display&&j.path_display.toLowerCase()!==path.toLowerCase())throw new Error('o Dropbox salvou uma cópia em '+j.path_display);
    return true;
  }
  async function append(ws,line,cfg){
    cfg=cfg||await getCfg();
    if(!cfg.key||!cfg.refresh)throw new Error('autorize o Dropbox nas opções da extensão');
    const path=PATHS[ws]||PATHS.pessoal;
    for(let i=0;i<3;i++){
      let {text,rev}=await download(cfg,path);
      const eol=text.includes('\r\n')?'\r\n':'\n';
      if(text&&!/\n$/.test(text))text+=eol;
      if(await upload(cfg,path,text+line+eol,rev))return;
    }
    throw new Error('o arquivo mudou várias vezes; tente de novo');
  }

  /* ---- montagem da linha ---- */
  const pad=n=>String(n).padStart(2,'0');
  const isoDate=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  function cleanTitle(t,max){
    t=String(t||'').replace(/\s+/g,' ').trim();
    t=t.split(' ').map(w=>w.replace(/^[+@]+/,'').replace(/^([A-Za-z_]+):(?=\S)/,'$1: ')).filter(Boolean).join(' ').replace(/\s+/g,' ');
    if(t.length>max){t=t.slice(0,max);const i=t.lastIndexOf(' ');if(i>max*0.6)t=t.slice(0,i);t=t.replace(/[\s.,;:\-–—]+$/,'')+'…'}
    return t;
  }
  const sign=(v,s)=>{v=String(v||'').replace(/\s+/g,'');return v?(v[0]===s?v:s+v):''};
  function buildLine(title,url,cfg,now){
    cfg=Object.assign({},DEFAULTS,cfg);
    const host=(()=>{try{return new URL(url).hostname.replace(/^www\./,'')}catch(e){return ''}})();
    const t=cleanTitle((cfg.prefix?cfg.prefix.trim()+' ':'')+(cleanTitle(title,120)||host||'Link'),140);
    return [isoDate(now||new Date()),t,url,sign(cfg.tag,'+'),sign(cfg.ctx,'@')].filter(Boolean).join(' ');
  }

  /* ---- autorização (PKCE, sem redirect: o Dropbox mostra o código) ---- */
  async function authStart(key){
    const rnd=n=>b64(crypto.getRandomValues(new Uint8Array(n)));
    const verifier=rnd(48);
    const chal=b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
    await api().storage.local.set({key,authVerifier:verifier});
    return 'https://www.dropbox.com/oauth2/authorize?'+new URLSearchParams({client_id:key,response_type:'code',
      code_challenge:chal,code_challenge_method:'S256',token_access_type:'offline'});
  }
  async function authFinish(code){
    const s=await api().storage.local.get(['key','authVerifier']);
    if(!s.key||!s.authVerifier)throw new Error('gere o link de autorização primeiro');
    const j=await tokenReq({grant_type:'authorization_code',code:code.trim(),code_verifier:s.authVerifier,client_id:s.key});
    await api().storage.local.set({refresh:j.refresh_token});
    await api().storage.local.remove('authVerifier');
  }
  return{append,buildLine,cleanTitle,getCfg,authStart,authFinish,PATHS,_reset:()=>{_tok={v:'',exp:0}}};
})();
if(typeof module!=='undefined')module.exports=PF;
