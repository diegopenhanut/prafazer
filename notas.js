/* Notas em markdown: um arquivo .md por nota.
   Local: IndexedDB (funciona offline). Dropbox: uma pasta por contexto (/notas e /trabalho-notas),
   sincronização incremental por list_folder + cursor. Conflito = mantém as duas versões.
   Usa do app principal: WS, dbx, esc, today, setTag, build, parse, snapshot, commit, isSheet. */
const Notas=(()=>{
  const CONTENT='https://content.dropboxapi.com/2/files/',RPC='https://api.dropboxapi.com/2/files/';

  /* ---------- IndexedDB ---------- */
  let db=null;
  const req=r=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
  function dbOpen(){
    if(db)return Promise.resolve(db);
    return new Promise((res,rej)=>{
      const r=indexedDB.open('prafazer-notas',1);
      r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('notas',{keyPath:'id'}).createIndex('ws','ws');d.createObjectStore('meta',{keyPath:'k'})};
      r.onsuccess=()=>{db=r.result;res(db)};r.onerror=()=>rej(r.error);
    });
  }
  const st=async(name,mode)=>(await dbOpen()).transaction(name,mode).objectStore(name);
  const allOf=async ws=>req((await st('notas','readonly')).index('ws').getAll(ws));
  const get=async id=>req((await st('notas','readonly')).get(id));
  const put=async n=>req((await st('notas','readwrite')).put(n));
  const del=async id=>req((await st('notas','readwrite')).delete(id));
  /* leitura+escrita atômica (uma transação): fn(atual, store) devolve o registro a gravar, ou nada */
  const update=(id,fn)=>new Promise(async(res,rej)=>{
    try{
      const s=await st('notas','readwrite'),tx=s.transaction;
      tx.oncomplete=()=>res();tx.onerror=tx.onabort=()=>rej(tx.error);
      const g=s.get(id);
      g.onsuccess=()=>{try{const r=fn(g.result,s);if(r)s.put(r)}catch(e){tx.abort();rej(e)}};
    }catch(e){rej(e)}
  });
  const getMeta=async k=>{const r=await req((await st('meta','readonly')).get(k));return r?r.v:null};
  const setMeta=async(k,v)=>req((await st('meta','readwrite')).put({k,v}));

  /* ---------- utilitários ---------- */
  const slug=s=>(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);
  const idOf=(ws,nome)=>ws+'/'+nome;
  const base=nome=>nome.replace(/\.md$/i,'');
  function titleOf(n){
    const t=n.texto||'';let m=t.match(/^#{1,6}[ \t]+(.+)$/m);
    if(m)return m[1].trim();
    m=t.split('\n').find(l=>l.trim());
    return m?m.replace(/^#+\s*/,'').trim().slice(0,80):base(n.nome).replace(/^\d{4}-\d{2}-\d{2}-?/,'')||'(sem título)';
  }
  function snippetOf(n){
    const l=(n.texto||'').split('\n').map(x=>x.trim()).filter(x=>x&&!/^#/.test(x));
    return (l[0]||'').slice(0,90);
  }
  const jsonAscii=o=>JSON.stringify(o).replace(/[\u007f-￿]/g,c=>'\\u'+('0000'+c.charCodeAt(0).toString(16)).slice(-4));
  const dir=()=>(dbx.cfg.notes||(WS==='trabalho'?'/trabalho-notas':'/notas')).replace(/\/+$/,'');
  const fmtDate=ms=>{const d=new Date(ms),t=new Date();
    return d.toDateString()===t.toDateString()?d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})};
  /* etiquetas +projeto / @contexto no texto da nota (mesmo estilo das tarefas) */
  const TAGRE=/(^|[\s(>])([+@])([\p{L}\p{N}_][\p{L}\p{N}_.\-\/]*)/gu;
  const cleanTag=v=>v.replace(/[.\-\/]+$/,'');
  function tagsOf(text){
    const t=(text||'').replace(/```[\s\S]*?(```|$)/g,' ').replace(/`[^`\n]*`/g,' '),p=[],c=[];
    for(const m of t.matchAll(TAGRE)){const v=cleanTag(m[3]).toLowerCase();if(!v)continue;const a=m[2]==='+'?p:c;if(!a.includes(v))a.push(v)}
    return{p,c};
  }
  async function uniqueName(ws,nome){
    let n=nome,i=2;
    while(await get(idOf(ws,n)))n=base(nome)+'-'+(i++)+'.md';
    return n;
  }

  /* ---------- markdown (mínimo, escapa HTML antes) ---------- */
  function mdInline(raw){
    const codes=[];
    let s=esc(raw).replace(/`([^`]+)`/g,(m,c)=>{codes.push(c);return '\u0000'+(codes.length-1)+'\u0000'});
    s=s.replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g,'$1<i>$2</i>').replace(/~~([^~]+)~~/g,'<s>$1</s>');
    s=s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,(m,t,u)=>`<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
    s=s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,(m,p,u)=>`${p}<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
    s=s.replace(TAGRE,(m,pre,sg,name)=>{const v=cleanTag(name);if(!v)return m;const k=sg==='+'?'p':'c';
      return `${pre}<span class="tg ${k}" data-k="${k}" data-v="${v.toLowerCase()}">${sg}${v}</span>${name.slice(v.length)}`});
    return s.replace(/\u0000(\d+)\u0000/g,(m,i)=>`<code>${codes[+i]}</code>`);   // o trecho já foi escapado
  }
  function md(src){
    const L=(src||'').replace(/\r\n?/g,'\n').split('\n'),out=[];
    let i=0,para=[],list=null;
    const flushP=()=>{if(para.length){out.push('<p>'+para.map(mdInline).join('<br>')+'</p>');para=[]}};
    const flushL=()=>{if(list){out.push(`<${list.t}>`+list.items.join('')+`</${list.t}>`);list=null}};
    while(i<L.length){
      const l=L[i];let m;
      if(/^```/.test(l)){flushP();flushL();const code=[];i++;while(i<L.length&&!/^```/.test(L[i]))code.push(L[i++]);i++;out.push('<pre><code>'+esc(code.join('\n'))+'</code></pre>');continue}
      if(!l.trim()){flushP();flushL();i++;continue}
      if((m=l.match(/^(#{1,6})\s+(.*)$/))){flushP();flushL();out.push(`<h${m[1].length}>${mdInline(m[2])}</h${m[1].length}>`);i++;continue}
      if(/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)){flushP();flushL();out.push('<hr>');i++;continue}
      if(/^>/.test(l)){flushP();flushL();const q=[];while(i<L.length&&/^>/.test(L[i]))q.push(L[i++].replace(/^>\s?/,''));out.push('<blockquote>'+q.map(mdInline).join('<br>')+'</blockquote>');continue}
      if((m=l.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/))){
        flushP();const t=/\d/.test(m[1])?'ol':'ul';
        if(list&&list.t!==t)flushL();
        if(!list)list={t,items:[]};
        let item=m[2],box='';const c=item.match(/^\[([ xX])\]\s+(.*)$/);
        if(c){box=`<input type="checkbox" disabled${c[1]===' '?'':' checked'}> `;item=c[2]}
        list.items.push('<li>'+box+mdInline(item)+'</li>');i++;continue;
      }
      flushL();para.push(l);i++;
    }
    flushP();flushL();
    return out.join('\n');
  }

  /* ---------- Dropbox ---------- */
  async function rpc(endpoint,body){
    const r=await dbx.api(RPC+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const text=await r.text();let json=null;try{json=JSON.parse(text)}catch(e){}
    return{ok:r.ok,status:r.status,text,json};
  }
  async function download(path){
    const r=await dbx.api(CONTENT+'download',{method:'POST',headers:{'Dropbox-API-Arg':jsonAscii({path})}});
    if(r.status===409){const t=await r.text();if(/not_found/.test(t))return null;throw new Error(t.slice(0,200))}
    if(!r.ok)throw new Error('download HTTP '+r.status);
    const text=await r.text();let meta={};
    try{meta=JSON.parse(r.headers.get('dropbox-api-result')||'{}')}catch(e){}
    return{text,rev:meta.rev||'',mod:meta.server_modified?Date.parse(meta.server_modified):Date.now()};
  }
  async function push(folder,n,retry){
    const arg={path:folder+'/'+n.nome,mode:n.rev?{'.tag':'update',update:n.rev}:'add',autorename:false,mute:true};
    const r=await dbx.api(CONTENT+'upload',{method:'POST',headers:{'Dropbox-API-Arg':jsonAscii(arg),'Content-Type':'application/octet-stream'},body:n.texto});
    if(r.status===409)return conflict(folder,n,retry);
    if(!r.ok)throw new Error('upload HTTP '+r.status+' '+(await r.text()).slice(0,160));
    const j=await r.json();
    await update(n.id,cur=>{
      if(!cur)return;                                // apagada durante o envio: a lápide cuida
      cur.rev=j.rev;cur.auto=false;
      if(cur.texto===n.texto)cur.sujo=false;         // se mudou durante o envio, continua suja
      return cur;
    });
  }
  async function conflict(folder,n,retry){
    const rem=await download(folder+'/'+n.nome);
    if(!rem){                                         // sumiu do Dropbox: reenvia como nova
      if(retry)throw new Error('conflito ao enviar '+n.nome);
      n.rev='';await put(n);return push(folder,n,true);
    }
    const nome2=await uniqueName(n.ws,base(n.nome)+'-conflito-'+today()+'.md');
    await update(n.id,(cur,s)=>{                     // tudo numa transação: a digitação recente não se perde
      cur=cur||n;
      if(rem.text===cur.texto){cur.rev=rem.rev;cur.sujo=false;cur.auto=false;return cur}
      s.put({id:idOf(n.ws,nome2),ws:n.ws,nome:nome2,texto:cur.texto,rev:'',mod:Date.now(),sujo:true});
      again=true;
      return{...cur,texto:rem.text,rev:rem.rev,sujo:false,auto:false,mod:rem.mod};
    });
  }
  async function remoteDelete(folder,n){
    const r=await rpc('delete_v2',{path:folder+'/'+n.nome});
    if(!r.ok&&!(r.status===409&&/not_found/.test(r.text)))throw new Error('apagar HTTP '+r.status);
    await del(n.id);
  }
  async function pull(folder,ws,same,second){
    const key='cursor|'+ws+'|'+folder;
    let cursor=await getMeta(key);
    let data=cursor?await rpc('list_folder/continue',{cursor}):await rpc('list_folder',{path:folder,limit:200});
    if(data.status===409){
      if(!cursor&&/not_found/.test(data.text))return;   // a pasta ainda não existe
      if(cursor&&/reset/.test(data.text)&&!second){await setMeta(key,null);return pull(folder,ws,same,true)}
    }
    if(!data.ok)throw new Error('lista HTTP '+data.status+' '+data.text.slice(0,160));
    const seen=new Set(),full=!cursor;
    for(;;){
      for(const e of data.json.entries){
        same();
        const tag=e['.tag'];
        if(tag==='deleted'){
          const l=await get(idOf(ws,e.name));if(l&&!l.sujo)await del(l.id);
        }else if(tag==='file'&&/\.md$/i.test(e.name)){
          seen.add(e.name);
          const l=await get(idOf(ws,e.name));
          if(l&&(l.sujo||l.del||l.rev===e.rev||(isOpen&&editing&&curId===l.id)))continue;   // não atropela o que está sendo digitado
          const rem=await download(folder+'/'+e.name);if(!rem)continue;
          await put({id:idOf(ws,e.name),ws,nome:e.name,texto:rem.text,rev:rem.rev,mod:rem.mod,sujo:false});
        }
      }
      cursor=data.json.cursor;await setMeta(key,cursor);
      if(!data.json.has_more)break;
      same();data=await rpc('list_folder/continue',{cursor});
      if(!data.ok)throw new Error('lista HTTP '+data.status);
    }
    if(full){                                          // listagem completa: o que tinha rev e sumiu foi apagado fora
      for(const l of await allOf(ws))if(l.rev&&!l.sujo&&!seen.has(l.nome))await del(l.id);
    }
  }

  let syncing=false,again=false,sstate='',smsg='',timer=null;
  async function sync(){
    if(!dbx.connected()||!navigator.onLine){ui();return}
    if(syncing){again=true;return}
    syncing=true;sstate='sync';ui();
    const ws=WS,same=()=>{if(WS!==ws)throw new Error('contexto mudou durante a sincronização')};
    try{
      const folder=dir();
      for(const n of await allOf(ws)){
        same();
        if(n.del)await remoteDelete(folder,n);
        else if(n.sujo)await push(folder,n);
      }
      await pull(folder,ws,same);
      sstate='ok';smsg='';
    }catch(e){sstate='err';smsg=String(e.message||e);console.warn(e)}
    syncing=false;
    await refresh();ui();
    if(again){again=false;sync()}
  }
  const syncSoon=()=>{clearTimeout(timer);if(dbx.connected())timer=setTimeout(sync,1500)};

  /* ---------- interface ---------- */
  let root,sideEl,listEl,ta,viewEl,qEl,stEl,linksEl,curId=null,mode='view',nextEdit=false,notes=[],tagMap=new Map(),flt=null,saveT=null,isOpen=false,booted=false,editing=false;   // editing: há texto digitado ainda não salvo
  const $n=s=>root.querySelector(s);

  function boot(){
    if(booted)return;booted=true;
    const css=document.createElement('style');
    css.textContent=`
#notas{position:fixed;inset:0;z-index:15;background:var(--bg);color:var(--fg);display:none;flex-direction:column;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
#notas.on{display:flex}
#notas .nh{display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--panel);border-bottom:1px solid var(--line);flex:0 0 auto}
#notas .nh b{font-weight:700} #notas .sp{flex:1}
#notas .nbtn{padding:4px 10px;border:1px solid var(--line);border-radius:4px;color:var(--fg)} #notas .nbtn:hover{border-color:var(--dim)}
#notas .nbtn.on{background:var(--accent);color:var(--onaccent);border-color:var(--accent);font-weight:700}
#notas #n-st{color:var(--dim);font-size:12px;white-space:nowrap}
#notas .nb{flex:1;display:flex;min-height:0}
#notas .ns{flex:0 0 170px;overflow-y:auto;border-right:1px solid var(--line);padding:6px 0;font-size:13px}
#notas .ns h4{margin:10px 12px 4px;color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:700}
#notas .si{display:flex;justify-content:space-between;gap:8px;padding:5px 12px;cursor:pointer}
#notas .si:hover{background:var(--cur)} #notas .si.cur{background:var(--selbg);font-weight:700}
#notas .si .n{color:var(--dim)} #notas .si.p .v{color:var(--proj)} #notas .si.c .v{color:var(--ctx)}
#notas.noside .ns{display:none}
#notas .tg.p{color:var(--proj)} #notas .tg.c{color:var(--ctx)} #notas #n-view .tg{cursor:pointer}
#notas .nl{flex:0 0 320px;display:flex;flex-direction:column;border-right:1px solid var(--line);min-height:0}
#notas .nl input{margin:8px;padding:7px 9px;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:4px;outline:none;font:inherit}
#notas .nl input:focus{border-color:var(--accent)}
#notas #n-list{flex:1;overflow-y:auto}
#notas .ni{padding:8px 12px;border-bottom:1px solid var(--line);cursor:pointer}
#notas .ni:hover{background:var(--cur)} #notas .ni.cur{background:var(--selbg)}
#notas .ni .t{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#notas .ni .s{color:var(--dim);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#notas .ni .d{color:var(--dim);font-size:11px} #notas .ni .u{color:var(--markfg)}
#notas .nempty{padding:24px;color:var(--dim);text-align:center}
#notas .ne{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}
#notas .nbar{display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid var(--line)}
#notas #n-links{padding:4px 12px;color:var(--dim);font-size:12px}
#notas textarea{flex:1;width:100%;resize:none;border:0;outline:none;background:var(--bg);color:var(--fg);font:inherit;line-height:1.5;padding:12px 14px}
#notas #n-view{flex:1;overflow-y:auto;padding:8px 18px 40px;line-height:1.55}
#notas #n-view h1,#notas #n-view h2,#notas #n-view h3{color:var(--accent);margin:.9em 0 .3em}
#notas #n-view h1{font-size:1.5em} #notas #n-view h2{font-size:1.25em} #notas #n-view h3{font-size:1.1em}
#notas #n-view code{background:var(--head);padding:1px 4px;border-radius:3px}
#notas #n-view pre{background:var(--head);padding:10px;border-radius:4px;overflow-x:auto} #notas #n-view pre code{background:none;padding:0}
#notas #n-view blockquote{margin:.6em 0;padding:2px 12px;border-left:3px solid var(--line);color:var(--dim)}
#notas #n-view a{color:var(--link)} #notas #n-view hr{border:0;border-top:1px solid var(--line)}
#notas #n-view ul,#notas #n-view ol{padding-left:1.4em}
#notas .mob{display:none}
body.m #notas .nb{flex-direction:column} body.m #notas #n-side-t{display:none}
body.m #notas .ns{flex:0 0 auto;display:flex;flex-direction:row;align-items:center;overflow-x:auto;overflow-y:hidden;border-right:0;border-bottom:1px solid var(--line);padding:4px 6px;white-space:nowrap}
body.m #notas .ns h4{display:none}
body.m #notas .si{flex:0 0 auto;padding:6px 10px;margin-right:6px;border:1px solid var(--line);border-radius:14px;gap:6px}
body.m #notas.edit .ns{display:none}
body.m #notas .nl{flex:1;border-right:0} body.m #notas .ne{display:none}
body.m #notas.edit .nl{display:none} body.m #notas.edit .ne{display:flex}
body.m #notas .mob{display:inline-block} body.m #notas .nbtn{padding:8px 12px} body.m #notas .nh .l{display:none} body.m #notas .nh{gap:6px}
body.m #notas textarea{font-size:16px}`;
    document.head.appendChild(css);
    root=document.createElement('div');root.id='notas';
    root.innerHTML=`<div class="nh"><button class="nbtn" id="n-back" aria-label="Voltar">←<span class="l"> Voltar</span></button><button class="nbtn" id="n-side-t" aria-label="Etiquetas" title="Mostrar/ocultar etiquetas">☰</button><b>Notas<span class="l"> · <span id="n-ctx"></span></span></b><span class="sp"></span><span id="n-st"></span><button class="nbtn" id="n-new" aria-label="Nova nota">+<span class="l"> Nova</span></button><button class="nbtn" id="n-more" aria-label="Mais">⋯</button></div>
<div class="nb"><aside class="ns" id="n-side"></aside><aside class="nl"><input id="n-q" type="search" placeholder="buscar nas notas…" autocomplete="off"><div id="n-list"></div></aside>
<section class="ne"><div class="nbar"><button class="nbtn mob" id="n-tolist">‹ Lista</button><button class="nbtn" data-mode="view">Ver</button><button class="nbtn" data-mode="edit">Editar</button><span class="sp"></span><button class="nbtn" id="n-del">Excluir</button></div>
<div id="n-links"></div><textarea id="n-ta" spellcheck="false" placeholder="Escreva em markdown…"></textarea><div id="n-view" style="display:none"></div></section></div>`;
    document.body.appendChild(root);
    sideEl=$n('#n-side');listEl=$n('#n-list');ta=$n('#n-ta');viewEl=$n('#n-view');qEl=$n('#n-q');stEl=$n('#n-st');linksEl=$n('#n-links');
    $n('#n-back').onclick=close;$n('#n-new').onclick=()=>create();$n('#n-del').onclick=remove;
    $n('#n-tolist').onclick=()=>{flush();root.classList.remove('edit')};
    $n('#n-more').onclick=moreMenu;
    root.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
    qEl.oninput=renderList;
    try{if(localStorage.getItem('prafazer-notas-side')==='0')root.classList.add('noside')}catch(e){}
    $n('#n-side-t').onclick=()=>{const off=root.classList.toggle('noside');try{localStorage.setItem('prafazer-notas-side',off?'0':'1')}catch(e){}};
    sideEl.onclick=e=>{const it=e.target.closest('.si');if(it)setFlt(it.dataset.k,it.dataset.v)};
    viewEl.onclick=e=>{const t=e.target.closest('.tg');if(t&&t.dataset.k){flush();root.classList.remove('edit');setFlt(t.dataset.k,t.dataset.v,true)}};
    ta.oninput=()=>{editing=true;clearTimeout(saveT);saveT=setTimeout(flush,250)};
    listEl.onclick=e=>{const it=e.target.closest('.ni');if(it)select(it.dataset.id)};
    root.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();if(mobileEdit())root.classList.remove('edit');else close()}});
    addEventListener('beforeunload',()=>{flush()});
    addEventListener('pagehide',()=>{flush()});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flush()});
  }
  const mobileEdit=()=>document.body.classList.contains('m')&&root.classList.contains('edit');

  function ui(){
    if(!stEl)return;
    const [sym,lab]=!dbx.connected()?['○',' só neste aparelho']:sstate==='sync'?['⟳',' sincronizando…']:sstate==='err'?['⚠',' erro']:!navigator.onLine?['○',' offline']:['●',' sincronizado'];
    stEl.innerHTML=`${sym}<span class="l">${lab}</span>`;
    stEl.title=smsg||lab.trim();
  }
  async function refresh(){
    notes=(await allOf(WS)).filter(n=>!n.del).sort((a,b)=>b.mod-a.mod);
    indexTags();
    if(isOpen){
      const c=curId&&notes.find(n=>n.id===curId);
      if(c&&!editing&&ta.value!==(c.texto||'')){ta.value=c.texto||'';if(mode==='view')viewEl.innerHTML=md(ta.value);showLinks(c)}
      renderSide();renderList();
    }
  }
  function renderList(){
    const q=(qEl.value||'').trim().toLowerCase();
    const l=notes.filter(n=>passFlt(n)&&(!q||(n.texto||'').toLowerCase().includes(q)||n.nome.toLowerCase().includes(q)));
    const tg=n=>{const t=tagMap.get(n.id)||NOTAGS;return t.p.map(x=>`<span class="tg p">+${esc(x)}</span>`).concat(t.c.map(x=>`<span class="tg c">@${esc(x)}</span>`)).join(' ')};
    listEl.innerHTML=l.length?l.map(n=>`<div class="ni${n.id===curId?' cur':''}" data-id="${esc(n.id)}"><div class="t">${esc(titleOf(n))}</div><div class="s">${esc(snippetOf(n))}</div><div class="d">${fmtDate(n.mod)}${n.sujo?' <span class="u">● não enviada</span>':''} ${tg(n)}</div></div>`).join(''):`<div class="nempty">${q||flt?'Nada encontrado.':'Nenhuma nota ainda. Toque em “+ Nova”.'}</div>`;
  }
  /* índice de etiquetas: as do texto + as herdadas das tarefas ligadas (note:slug) */
  const NOTAGS={p:[],c:[],ip:[],ic:[]};
  function indexTags(){
    const bySlug=new Map();
    for(const i of (typeof items!=='undefined'?items:[])){
      const sl=i.t.tags.note;if(!sl)continue;
      const k=sl.toLowerCase().replace(/\.md$/,'');if(!bySlug.has(k))bySlug.set(k,[]);bySlug.get(k).push(i);
    }
    tagMap=new Map();
    for(const n of notes){
      const own=tagsOf(n.texto),p=new Set(own.p),c=new Set(own.c),ip=[],ic=[];
      for(const i of bySlug.get(base(n.nome).toLowerCase())||[]){
        for(const x of i.t.projects)if(!p.has(x)){p.add(x);ip.push(x)}
        for(const x of i.t.contexts)if(!c.has(x)){c.add(x);ic.push(x)}
      }
      tagMap.set(n.id,{p:[...p],c:[...c],ip,ic});
    }
  }
  const passFlt=n=>{
    if(!flt)return true;
    const t=tagMap.get(n.id)||NOTAGS;
    return flt.k==='none'?!t.p.length&&!t.c.length:(flt.k==='p'?t.p:t.c).includes(flt.v);
  };
  function renderSide(){
    if(!sideEl)return;
    const P=new Map(),C=new Map();let none=0;
    for(const n of notes){
      const t=tagMap.get(n.id)||NOTAGS;
      if(!t.p.length&&!t.c.length)none++;
      t.p.forEach(x=>P.set(x,(P.get(x)||0)+1));t.c.forEach(x=>C.set(x,(C.get(x)||0)+1));
    }
    if(flt&&flt.k!=='none'&&!(flt.k==='p'?P:C).has(flt.v))flt=null;
    const row=(k,v,label,cnt,cls)=>`<div class="si ${cls||''}${(!flt&&k==='all')||(flt&&flt.k===k&&flt.v===v)?' cur':''}" data-k="${k}" data-v="${esc(v)}"><span class="v">${esc(label)}</span><span class="n">${cnt}</span></div>`;
    const list=(M,k,sg)=>[...M].sort((a,b)=>a[0].localeCompare(b[0])).map(([v,c])=>row(k,v,sg+v,c,k)).join('');
    sideEl.innerHTML=row('all','','Todas',notes.length)+row('none','','Sem etiqueta',none)
      +(P.size?'<h4>Projetos</h4>'+list(P,'p','+'):'')+(C.size?'<h4>Contextos</h4>'+list(C,'c','@'):'');
  }
  function setFlt(k,v,keepSame){
    flt=(k==='all'||(!keepSame&&flt&&flt.k===k&&flt.v===v))?null:{k,v};
    renderSide();renderList();
  }
  function setMode(m){
    mode=m;
    root.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('on',b.dataset.mode===m));
    const n=notes.find(x=>x.id===curId);
    ta.style.display=m==='edit'?'':'none';viewEl.style.display=m==='view'?'':'none';
    if(m==='view')viewEl.innerHTML=md(ta.value);
    if(m==='edit'&&n&&!isCoarse())ta.focus();
  }
  const isCoarse=()=>matchMedia('(pointer:coarse)').matches;
  function showLinks(n){
    const sl=base(n.nome);
    const l=(typeof items!=='undefined'?items:[]).filter(i=>i.t.tags.note&&i.t.tags.note.toLowerCase()===sl.toLowerCase());
    const parts=[];
    if(l.length)parts.push('Tarefas ligadas: '+l.map(i=>{const x=esc(i.t.text.replace(/\s+note:\S+/,''));return i.t.done?`<span style="color:var(--dim)">${x} (concluída)</span>`:x}).join(' · '));
    const t=tagMap.get(n.id),inh=t?t.ip.map(x=>'+'+x).concat(t.ic.map(x=>'@'+x)):[];
    if(inh.length)parts.push('Etiquetas herdadas das tarefas: '+esc(inh.join(' ')));
    linksEl.innerHTML=parts.join('<br>');
  }
  async function select(id,focus){
    await flush();
    const n=await get(id);if(!n)return;
    curId=id;editing=false;ta.value=n.texto||'';ta.disabled=false;
    root.classList.add('edit');showLinks(n);renderList();
    const ed=nextEdit||!(n.texto||'').replace(/^#*\s*/,'').trim();nextEdit=false;   // abre em “Ver”; nota nova ou vazia abre em “Editar”
    setMode(ed?'edit':'view');
    if(focus&&mode==='edit'&&!isCoarse())ta.focus();
  }
  async function flush(){
    clearTimeout(saveT);saveT=null;
    if(!curId)return;
    const n0=await get(curId);if(!n0||n0.del)return;
    const val=ta.value;
    if(!editing||n0.texto===val){editing=false;return}
    editing=false;
    // nota nova que ainda não foi ao Dropbox: o nome acompanha o título
    let nome=null;
    if(!n0.rev&&n0.auto){
      const novo=n0.created+'-'+(slug(titleOf({texto:val,nome:n0.nome}))||'nota')+'.md';
      if(novo!==n0.nome)nome=await uniqueName(n0.ws,novo);
    }
    let out=null;
    await update(n0.id,(cur,s)=>{
      if(!cur||cur.del)return;
      cur.texto=val;cur.mod=Date.now();cur.sujo=true;
      if(nome&&!cur.rev&&cur.auto){                  // grava o novo registro antes de apagar o antigo
        const r={...cur,nome,id:idOf(cur.ws,nome)};
        s.put(r);s.delete(cur.id);out=r;return;
      }
      out=cur;return cur;
    });
    if(!out)return;
    if(out.id!==n0.id&&curId===n0.id)curId=out.id;
    await refresh();showLinks(out);syncSoon();
  }
  async function create(texto,focus){
    await flush();
    const created=today(),tit=texto!=null?slug(titleOf({texto,nome:''})):'',nome=await uniqueName(WS,created+'-'+(tit||'nova-nota')+'.md');
    const n={id:idOf(WS,nome),ws:WS,nome,texto:texto!=null?texto:'# '+(flt&&flt.k!=='none'?'\n\n'+(flt.k==='p'?'+':'@')+flt.v:''),rev:'',mod:Date.now(),sujo:true,auto:true,created};
    await put(n);await refresh();
    nextEdit=true;await select(n.id,focus!==false);
    if(texto==null){ta.focus();ta.setSelectionRange(2,2)}
    return n;
  }
  async function remove(){
    if(!curId)return;
    const n=await get(curId);if(!n)return;
    if(!confirm('Excluir a nota “'+titleOf(n)+'”?'))return;
    clearTimeout(saveT);saveT=null;
    if(n.rev)await put({...n,del:true,sujo:false});else await del(n.id);
    curId=null;ta.value='';ta.disabled=true;linksEl.innerHTML='';root.classList.remove('edit');
    await refresh();syncSoon();
  }
  function moreMenu(){
    const dirNow=dir();
    const a=prompt('Pasta das notas no Dropbox para este contexto (deixe em branco para o padrão):\n'+
      'Atual: '+dirNow+'\n\nPara sincronizar agora sem mudar nada, deixe como está e confirme.',dbx.cfg.notes||dirNow);
    if(a===null)return;
    let p=a.trim();if(p&&p[0]!=='/')p='/'+p;
    if(p===dirNow&&!dbx.cfg.notes){sync();return}
    dbx.cfg.notes=(p===(WS==='trabalho'?'/trabalho-notas':'/notas'))?'':p;dbx.persist();
    sync();
  }
  async function open(nome){
    boot();
    root.querySelector('#n-ctx').textContent=wsName();
    isOpen=true;root.classList.add('on');document.body.classList.add('notas-on');
    qEl.value='';await refresh();ui();
    if(nome){const id=idOf(WS,/\.md$/i.test(nome)?nome:nome+'.md');if(await get(id))await select(id,true)}
    else if(curId&&notes.some(n=>n.id===curId)){}else{curId=null;ta.value='';ta.disabled=true;linksEl.innerHTML='';root.classList.remove('edit')}
    sync();
  }
  async function close(){
    await flush();
    isOpen=false;root.classList.remove('on');document.body.classList.remove('notas-on');
    curId=null;
    try{colsEl.focus({preventScroll:true})}catch(e){}
  }

  /* ---------- ligação com tarefas (tag note:slug) ---------- */
  async function forTask(it){
    if(!it)return;
    boot();
    const tag=(it.t.tags.note||'').trim();
    if(tag){
      const nome=/\.md$/i.test(tag)?tag:tag+'.md';
      if(await get(idOf(WS,nome))){await open(nome);return}
    }
    const titulo=it.t.text.replace(/(^|\s)\S+:\S+/g,' ').replace(/[+@]\S+/g,' ').replace(/\s+/g,' ').trim()||'Nota';
    const n=await create('# '+titulo+'\n\n',false);
    const sl=base(n.nome);
    snapshot();
    const raw=build(it.t,{text:setTag(it.t.text,'note',sl)});
    it.raw=raw;it.t=parse(raw);commit();
    nextEdit=true;await open(n.nome);
  }

  function init(){
    boot();
    try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist().catch(()=>{})}catch(e){}
    refresh().catch(()=>{});
    const q=new URLSearchParams(location.search).get('note');
    if(q){try{history.replaceState(null,'',location.pathname)}catch(e){}open(q)}
    addEventListener('online',()=>sync());
  }
  setTimeout(init,0);
  return{open,close,sync,forTask,create,md,_titleOf:titleOf,_slug:slug,isOpen:()=>isOpen};
})();
