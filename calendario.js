/* Calendário das tarefas com due: — grade mensal + lista do dia.
   Usa os globais de index.html (items, parse, build, setTag, doTasks, addTask, snapshot, commit, undo…). */
const Cal=(()=>{
  const MESES=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const DIAS=['dom','seg','ter','qua','qui','sex','sáb'];
  let root,gridEl,listEl,titleEl,booted=false,isOpen=false;
  let month=null,sel=null,focus='grid',liUid=null;

  const first=d=>new Date(d.getFullYear(),d.getMonth(),1);
  const clean=t=>t.text.replace(/(^|\s)[A-Za-z_]+:\S+/g,' ').replace(/\s+/g,' ').trim()||t.text;
  const byDay=()=>{
    const m=new Map();
    for(const it of items){const d=it.t.due;if(!d)continue;if(!m.has(d))m.set(d,[]);m.get(d).push(it)}
    for(const l of m.values())l.sort((a,b)=>(a.t.done-b.t.done)||((a.t.time||'99:99')<(b.t.time||'99:99')?-1:(a.t.time||'99:99')>(b.t.time||'99:99')?1:a.idx-b.idx));
    return m;
  };
  const dayList=()=>byDay().get(sel)||[];
  const curItem=()=>{const l=dayList();return l.find(i=>i.uid===liUid)||l[0]||null};

  function boot(){
    if(booted)return;booted=true;
    const css=document.createElement('style');
    css.textContent=`
#cal{position:fixed;inset:0;z-index:15;background:var(--bg);color:var(--fg);display:none;flex-direction:column;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
#cal.on{display:flex}
#cal .ch{display:flex;align-items:center;gap:10px;padding:4px 10px;background:var(--panel);border-bottom:1px solid var(--line);flex:0 0 auto}
#cal .ch b{font-weight:700;letter-spacing:.02em} #cal .ch b i{font-style:normal;color:var(--accent)} #cal .sp{flex:1}
#cal .cbtn{color:var(--dim);font-size:12px;padding:2px 8px;border:1px solid var(--line);border-radius:3px} #cal .cbtn:hover{color:var(--fg);border-color:var(--dim)}
#cal #c-title{font-weight:700;min-width:11ch;text-align:center;text-transform:capitalize}
#cal .cb{flex:1;display:flex;min-height:0}
#cal .cg{flex:1;display:flex;flex-direction:column;min-width:0;padding:8px}
#cal .wd,#cal .gr{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px}
#cal .wd div{color:var(--dim);font-size:11px;text-align:center;padding:2px;text-transform:uppercase}
#cal .gr{flex:1;grid-template-rows:repeat(6,minmax(0,1fr))}
#cal .cc{border:1px solid var(--line);border-radius:3px;padding:2px 4px;overflow:hidden;cursor:pointer;min-height:0;font-size:12px;display:flex;flex-direction:column;gap:1px}
#cal .cc:hover{background:var(--cur)} #cal .cc.out{opacity:.45}
#cal .cc.today .dn{background:var(--today);color:var(--bg);font-weight:700;border-radius:8px;padding:0 5px}
#cal .cc.cur{background:var(--selbg);border-color:var(--accent)} #cal.fl .cc.cur{outline:2px solid var(--accent)}
#cal .cc.drop{background:var(--cur);border-color:var(--accent)}
#cal .cc .dh{display:flex;justify-content:space-between;align-items:center}
#cal .cc .dn{color:var(--dim)} #cal .cc .cn{color:var(--accent);font-size:11px} #cal .cc .cn.over{color:var(--over);font-weight:700}
#cal .cc .ev{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px} #cal .cc .ev.done{text-decoration:line-through;color:var(--dim)} #cal .cc .ev.over{color:var(--over)}
#cal .cd{flex:0 0 340px;border-left:1px solid var(--line);display:flex;flex-direction:column;min-height:0}
#cal .cd h4{margin:0;padding:8px 12px;border-bottom:1px solid var(--line);font-size:13px;color:var(--accent);text-transform:capitalize}
#cal #c-list{flex:1;overflow-y:auto}
#cal .cr{display:flex;gap:8px;padding:6px 12px;border-bottom:1px solid var(--line);cursor:pointer;align-items:flex-start}
#cal .cr:hover{background:var(--cur)} #cal .cr.sel{background:var(--selbg)} #cal.fl .cr.sel{outline:2px solid var(--accent);outline-offset:-2px}
#cal .cr.done .tx{text-decoration:line-through;color:var(--dim)}
#cal .cr .ck{flex:0 0 auto;width:18px;height:18px;border:1px solid var(--dim);border-radius:50%;line-height:16px;text-align:center;font-size:11px;color:var(--accent)}
#cal .cr .tx{flex:1;min-width:0;overflow-wrap:anywhere} #cal .cr .tm{color:var(--today);flex:0 0 auto}
#cal .cempty{padding:24px;color:var(--dim);text-align:center}
#cal #c-new{display:none}
body.m #cal .cb{flex-direction:column} body.m #cal .cd{flex:0 0 46%;border-left:0;border-top:1px solid var(--line)}
body.m #cal .cc .ev{display:none} body.m #cal .cg{padding:4px} body.m #cal .cc{font-size:11px}
body.m #cal .cbtn{padding:6px 12px;font-size:13px} body.m #cal .ch{gap:6px;padding:10px 12px} body.m #cal .l{display:none}
body.m #cal #c-new{position:fixed;right:18px;bottom:calc(20px + env(safe-area-inset-bottom));width:58px;height:58px;padding:0;border:0;border-radius:50%;background:var(--accent);color:var(--onaccent);font-size:30px;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(0,0,0,.5);z-index:1}`;
    document.head.appendChild(css);
    root=document.createElement('div');root.id='cal';
    root.innerHTML=`<div class="ch"><button class="cbtn" id="c-back" aria-label="Voltar">←<span class="l"> Voltar</span></button><b>Pra<i>Fazer</i></b><span class="l" style="color:var(--dim)">Calendário · <span id="c-ctx"></span></span><span class="sp"></span><button class="cbtn" id="c-prev" aria-label="Mês anterior">‹</button><span id="c-title"></span><button class="cbtn" id="c-next" aria-label="Próximo mês">›</button><button class="cbtn" id="c-today">Hoje</button><span class="sp"></span><button class="cbtn" id="c-help" aria-label="Ajuda">?</button></div>
<div class="cb"><section class="cg"><div class="wd">${DIAS.map(d=>`<div>${d}</div>`).join('')}</div><div class="gr" id="c-grid"></div></section>
<aside class="cd"><h4 id="c-dtitle"></h4><div id="c-list"></div></aside></div><button class="cbtn" id="c-new" aria-label="Nova tarefa">+</button>`;
    document.body.appendChild(root);
    gridEl=root.querySelector('#c-grid');listEl=root.querySelector('#c-list');titleEl=root.querySelector('#c-title');
    root.querySelector('#c-back').onclick=close;
    root.querySelector('#c-prev').onclick=()=>shiftMonth(-1);root.querySelector('#c-next').onclick=()=>shiftMonth(1);
    root.querySelector('#c-today').onclick=()=>goto(today());
    root.querySelector('#c-help').onclick=help;root.querySelector('#c-new').onclick=add;
    gridEl.onclick=e=>{const c=e.target.closest('.cc');if(c){focus='grid';goto(c.dataset.d)}};
    gridEl.ondragover=e=>{const c=e.target.closest('.cc');if(!c)return;e.preventDefault();gridEl.querySelectorAll('.drop').forEach(x=>x!==c&&x.classList.remove('drop'));c.classList.add('drop')};
    gridEl.ondragleave=e=>{if(!gridEl.contains(e.relatedTarget))gridEl.querySelectorAll('.drop').forEach(x=>x.classList.remove('drop'))};
    gridEl.ondrop=e=>{
      e.preventDefault();gridEl.querySelectorAll('.drop').forEach(x=>x.classList.remove('drop'));
      const c=e.target.closest('.cc'),uid=+e.dataTransfer.getData('text/plain');
      const it=items.find(i=>i.uid===uid);if(c&&it)setDue(it,c.dataset.d);
    };
    listEl.ondragstart=e=>{const r=e.target.closest('.cr');if(r)e.dataTransfer.setData('text/plain',r.dataset.u)};
    listEl.onclick=e=>{
      const r=e.target.closest('.cr');if(!r)return;
      const it=items.find(i=>i.uid===+r.dataset.u);if(!it)return;
      liUid=it.uid;focus='list';
      if(e.target.closest('.ck')){toggle(it);return}
      if(mobile)itemSheet2(it);else render();
    };
    document.addEventListener('keydown',onKey);
  }

  /* ---------- ações ---------- */
  function goto(d){
    sel=d;const dt=parseD(d);
    if(!month||dt.getFullYear()!==month.getFullYear()||dt.getMonth()!==month.getMonth())month=first(dt);
    liUid=null;render();
  }
  function shiftMonth(n){
    const m=new Date(month.getFullYear(),month.getMonth()+n,1),dt=parseD(sel);
    const last=new Date(m.getFullYear(),m.getMonth()+1,0).getDate();
    month=m;sel=fmt(new Date(m.getFullYear(),m.getMonth(),Math.min(dt.getDate(),last)));liUid=null;render();
  }
  function setDue(it,nd){
    if(!it||it.t.due===nd)return;
    snapshot();
    it.raw=build(it.t,{text:setTag(it.t.text,'due',nd)});it.t=parse(it.raw);
    commit();sel=nd;liUid=it.uid;
    const dt=parseD(nd);if(dt.getFullYear()!==month.getFullYear()||dt.getMonth()!==month.getMonth())month=first(dt);
    render();
  }
  const moveTask=(it,n)=>{if(it&&it.t.due)setDue(it,fmt(addDays(parseD(it.t.due),n)))};
  function toggle(it){if(!it)return;doTasks([it]);render()}
  function add(){
    const pre=` due:${sel}`;
    openSheet(`<h3>Nova tarefa · ${esc(parseD(sel).toLocaleDateString('pt-BR',{day:'numeric',month:'long'}))}</h3><input type="text" id="c-ad" value="${esc(pre)}" placeholder="Texto +projeto @contexto" autocomplete="off"><div class="btns"><button class="btn pri1" id="c-ad-ok">Adicionar</button><button class="btn" data-close>Cancelar</button></div>`);
    const i=document.getElementById('c-ad');setTimeout(()=>{i.focus();i.setSelectionRange(0,0)},50);
    const go=()=>{const v=i.value;closeSheet();addTask(v);render()};
    document.getElementById('c-ad-ok').onclick=go;i.onkeydown=e=>{if(e.key==='Enter')go()};
  }
  function itemSheet2(it){
    const t=it.t;
    openSheet(`<div class="preview">${t.pri?`<span class="pri" data-p="${t.pri}">(${t.pri})</span> `:''}${fmtText(t)}${relLabel(t)}</div>
    <div class="btns" style="margin-top:6px"><button class="btn pri1" id="c-do">${t.done?'↺ Reabrir':'✓ Concluir'}</button></div>
    ${t.done?'':`<div class="grp"><div class="lab">Mover para</div><div class="chips"><button class="btn sm" id="c-m1">− 1 dia</button><button class="btn sm" id="c-p1">+ 1 dia</button><input type="date" id="c-dt" value="${esc(t.due||'')}"></div></div>`}
    <div class="btns"><button class="btn" data-close>Fechar</button></div>`);
    document.getElementById('c-do').onclick=()=>{closeSheet();toggle(it)};
    if(!t.done){
      document.getElementById('c-m1').onclick=()=>{closeSheet();moveTask(it,-1)};
      document.getElementById('c-p1').onclick=()=>{closeSheet();moveTask(it,1)};
      document.getElementById('c-dt').onchange=e=>{if(e.target.value){closeSheet();setDue(it,e.target.value)}};
    }
  }
  function help(){
    const K=(k,d)=>`<tr><td>${k}</td><td>${d}</td></tr>`,S=s=>`<tr class="sec"><td colspan="2">${s}</td></tr>`;
    openSheet(`<h3>Atalhos do calendário</h3><table class="keys">
    ${S('Dias')}${K('h / ← · l / →','dia anterior / próximo')}${K('k / ↑ · j / ↓','semana anterior / seguinte')}${K('[ · ]','mês anterior / seguinte')}${K('t','hoje')}
    ${S('Tarefas do dia')}${K('Enter · Tab','alterna entre a grade e a lista do dia')}${K('j / k (na lista)','próxima / anterior tarefa')}${K('x','concluir / reabrir')}${K('H · L','mover a tarefa para o dia anterior / seguinte')}${K('a','nova tarefa com due: do dia')}${K('u','desfazer')}
    ${S('Geral')}${K('c · Esc','voltar às tarefas')}${K('?','esta ajuda')}
    </table><div class="btns"><button class="btn" data-close>Fechar</button></div>`);
  }

  /* ---------- teclado ---------- */
  function onKey(e){
    if(!isOpen||isSheet()||e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)return;
    if(e.target.matches&&e.target.matches('input,textarea'))return;
    const k=e.key,inList=focus==='list'&&dayList().length;
    const day=n=>goto(fmt(addDays(parseD(sel),n)));
    const step=n=>{const l=dayList();if(!l.length)return;let i=l.indexOf(curItem());i=Math.max(0,Math.min(l.length-1,i+n));liUid=l[i].uid;render()};
    let h=true;
    switch(k){
      case 'h':case 'ArrowLeft':day(-1);break;
      case 'l':case 'ArrowRight':day(1);break;
      case 'j':case 'ArrowDown':inList?step(1):day(7);break;
      case 'k':case 'ArrowUp':inList?step(-1):day(-7);break;
      case '[':shiftMonth(-1);break;
      case ']':shiftMonth(1);break;
      case 't':goto(today());break;
      case 'Enter':case 'Tab':focus=focus==='grid'&&dayList().length?'list':'grid';render();break;
      case 'x':case ' ':toggle(curItem());break;
      case 'H':moveTask(curItem(),-1);break;
      case 'L':moveTask(curItem(),1);break;
      case 'a':case 'n':add();break;
      case 'u':undo();render();break;
      case '?':help();break;
      case 'c':close();break;
      case 'Escape':if(focus==='list'){focus='grid';render()}else close();break;
      default:h=false;
    }
    if(h)e.preventDefault();
  }

  /* ---------- desenho ---------- */
  function render(){
    if(!isOpen)return;
    root.classList.toggle('fl',focus==='list');
    titleEl.textContent=MESES[month.getMonth()]+' '+month.getFullYear();
    const m=byDay(),td=today(),start=addDays(month,-month.getDay());
    let h='';
    for(let n=0;n<42;n++){
      const d=addDays(start,n),k=fmt(d),l=m.get(k)||[],pend=l.filter(i=>!i.t.done),over=k<td&&pend.length;
      const cls=['cc'];if(d.getMonth()!==month.getMonth())cls.push('out');if(k===td)cls.push('today');if(k===sel)cls.push('cur');
      h+=`<div class="${cls.join(' ')}" data-d="${k}"><div class="dh"><span class="dn">${d.getDate()}</span>${l.length?`<span class="cn${over?' over':''}">${pend.length||'✓'}</span>`:''}</div>`
        +l.slice(0,3).map(i=>`<div class="ev${i.t.done?' done':over?' over':''}">${i.t.time?esc(i.t.time)+' ':''}${esc(clean(i.t))}</div>`).join('')+(l.length>3?`<div class="ev" style="color:var(--dim)">+${l.length-3}</div>`:'')+`</div>`;
    }
    gridEl.innerHTML=h;
    const dt=parseD(sel),l=m.get(sel)||[],cur=curItem();
    root.querySelector('#c-dtitle').textContent=dt.toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})+(sel===td?' · hoje':'');
    listEl.innerHTML=l.length?l.map(i=>{const t=i.t;
      return `<div class="cr${t.done?' done':''}${cur&&i.uid===cur.uid?' sel':''}" data-u="${i.uid}" draggable="${mobile?'false':'true'}"><span class="ck">${t.done?'✓':''}</span>${t.time?`<span class="tm">${esc(t.time)}</span>`:''}<span class="tx">${t.pri&&!t.done?`<span class="pri" data-p="${t.pri}">(${t.pri})</span> `:''}${fmtText(t)}</span></div>`}).join('')
      :'<div class="cempty">Nenhuma tarefa com due: neste dia.<br>Tecle <b>a</b> para adicionar.</div>';
    if(cur){const r=listEl.querySelector('.sel');if(r)r.scrollIntoView({block:'nearest'})}
  }

  function open(){
    boot();
    root.querySelector('#c-ctx').textContent=wsName();
    if(!sel)sel=today();
    month=first(parseD(sel));focus='grid';liUid=null;
    isOpen=true;root.classList.add('on');document.body.classList.add('cal-on');render();
  }
  function close(){
    isOpen=false;root.classList.remove('on');document.body.classList.remove('cal-on');
    try{colsEl.focus({preventScroll:true})}catch(e){}
  }
  return{open,close,isOpen:()=>isOpen,refresh:render};
})();
