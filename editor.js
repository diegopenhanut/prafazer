/* Comportamentos de editor para o textarea das notas.
   As funções são puras: recebem (texto, início, fim, …) e devolvem a edição
   {from,to,text,selStart,selEnd}, ou null quando não há o que fazer. */
const Editor=(()=>{
  const lineStart=(v,p)=>p>0?v.lastIndexOf('\n',p-1)+1:0;
  const lineEnd=(v,p)=>{const i=v.indexOf('\n',p);return i<0?v.length:i};
  const edit=(from,to,text,selStart,selEnd)=>({from,to,text,selStart,selEnd:selEnd===undefined?selStart:selEnd});
  /* linhas tocadas pela seleção; se ela termina logo após um \n, a linha seguinte não entra */
  function block(v,s,e){
    return{from:lineStart(v,s),to:lineEnd(v,e>s&&v[e-1]==='\n'?e-1:e)};
  }

  /* Tab / Shift+Tab */
  function tab(v,s,e,shift){
    const multi=v.slice(s,e).indexOf('\n')>=0;
    if(!shift&&!multi)return edit(s,e,'\t',s+1);
    const b=block(v,s,e),old=v.slice(b.from,b.to),lines=old.split('\n');
    const neu=lines.map(l=>shift?l.replace(/^(\t| {1,4})/,''):l&&'\t'+l),text=neu.join('\n');
    if(text===old)return null;
    if(multi)return edit(b.from,b.to,text,b.from,b.from+text.length);
    const cut=lines[0].length-neu[0].length;
    return edit(b.from,b.to,text,Math.max(b.from,s-cut),Math.max(b.from,e-cut));
  }

  /* Enter: repete recuo, citação, marcador, caixa e numeração; item vazio encerra a lista */
  const PREFIX=/^([ \t]*)((?:>[ \t]?)*)(?:([-*+]|\d+[.)])([ \t]+)(\[[ xX]\](?:[ \t]+|$))?)?/;
  const RULE=/^\s*([-*_])(\s*\1){2,}\s*$/;
  function enter(v,s,e){
    if(s!==e)return null;
    const ls=lineStart(v,s),le=lineEnd(v,s),line=v.slice(ls,le);
    const code=(v.slice(0,ls).match(/^```/gm)||[]).length%2===1,m=line.match(PREFIX);
    const plain=code||RULE.test(line),indent=m[1],quote=plain?'':m[2],mark=plain?'':m[3]||'';
    const full=indent+quote+(mark?mark+m[4]+(m[5]||''):'');
    if(!full||s-ls<full.length)return null;
    if((quote||mark)&&s===le&&!line.slice(full.length).trim())return edit(ls,le,'',ls);
    const num=mark.match(/^(\d+)([.)])$/);
    const next=indent+quote+(mark?(num?(+num[1]+1)+num[2]:mark)+m[4]+(m[5]?'[ ] ':''):'');
    return edit(s,s,'\n'+next,s+1+next.length);
  }

  /* Ctrl+B ('**') e Ctrl+I ('*'): liga/desliga, só dentro de uma linha */
  function format(v,s,e,mark){
    if(v.slice(s,e).indexOf('\n')>=0)return null;
    while(s<e&&/\s/.test(v[s]))s++;
    while(e>s&&/\s/.test(v[e-1]))e--;
    while(s<e&&v[s]==='*')s++;
    while(e>s&&v[e-1]==='*')e--;
    let a=0,b=0;
    while(v[s-1-a]==='*')a++;
    while(v[e+b]==='*')b++;
    const n=Math.min(a,b),k=mark.length,on=k===2?n>=2:n%2===1;
    if(on)return edit(s-k,e+k,v.slice(s,e),s-k,e-k);
    return edit(s,e,mark+v.slice(s,e)+mark,s+k,e+k);
  }

  const URLRE=/^(https?:\/\/|mailto:)\S+$/i;
  /* Ctrl+K */
  function link(v,s,e){
    const sel=v.slice(s,e);
    if(sel.indexOf('\n')>=0)return null;
    if(URLRE.test(sel.trim()))return edit(s,e,'[]('+sel.trim()+')',s+1);
    if(!sel)return edit(s,e,'[](url)',s+1);
    const u=s+sel.length+3;
    return edit(s,e,'['+sel+'](url)',u,u+3);
  }

  /* digitar um destes com texto selecionado envolve a seleção */
  const PAIRS={'*':'*','_':'_','`':'`','[':']','(':')'};
  function wrap(v,s,e,ch){
    if(s===e||!Object.prototype.hasOwnProperty.call(PAIRS,ch))return null;
    return edit(s,e,ch+v.slice(s,e)+PAIRS[ch],s+1,e+1);
  }

  /* colar uma URL sobre um texto selecionado vira link */
  function paste(v,s,e,clip){
    const sel=v.slice(s,e),url=(clip||'').trim();
    if(!sel.trim()||sel.indexOf('\n')>=0||URLRE.test(sel.trim())||!URLRE.test(url))return null;
    const text='['+sel+']('+url.replace(/\(/g,'%28').replace(/\)/g,'%29')+')';
    return edit(s,e,text,s+text.length);
  }

  /* Alt+↑/↓ */
  function move(v,s,e,dir){
    const b=block(v,s,e),cur=v.slice(b.from,b.to);
    if(dir<0){
      if(b.from===0)return null;
      const pf=lineStart(v,b.from-1),prev=v.slice(pf,b.from-1),d=prev.length+1;
      return edit(pf,b.to,cur+'\n'+prev,s-d,e-d);
    }
    if(b.to===v.length)return null;
    const ne=lineEnd(v,b.to+1),next=v.slice(b.to+1,ne),d=next.length+1;
    return edit(b.from,ne,next+'\n'+cur,s+d,Math.min(e+d,ne));
  }

  /* Shift+Alt+↑/↓: a seleção fica na cópia de cima ou na de baixo */
  function duplicate(v,s,e,dir){
    const b=block(v,s,e),cur=v.slice(b.from,b.to),d=dir>0?cur.length+1:0;
    return edit(b.to,b.to,'\n'+cur,s+d,Math.min(e+d,v.length+cur.length+1));
  }

  /* marca/desmarca a caixa "- [ ]" da linha n (começando em 0) */
  function toggleBox(v,n){
    const L=v.split('\n');
    if(L[n]===undefined)return v;
    L[n]=L[n].replace(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/,(m,a,c,z)=>a+(c===' '?'x':' ')+z);
    return L.join('\n');
  }

  /* onde fica a posição p depois que o texto a virou b (mudança vinda da sincronização) */
  function mapPos(a,b,p){
    const n=Math.min(a.length,b.length);let i=0,j=0;
    while(i<n&&a[i]===b[i])i++;
    if(p<=i)return p;
    while(j<n-i&&a[a.length-1-j]===b[b.length-1-j])j++;
    if(p>=a.length-j)return p+b.length-a.length;
    return Math.min(p,b.length-j);
  }

  /* aplica pelo execCommand para o Ctrl+Z continuar funcionando */
  function apply(ta,r){
    if(!r)return;
    const before=ta.value,want=before.slice(0,r.from)+r.text+before.slice(r.to);
    if(want!==before){
      ta.focus();ta.setSelectionRange(r.from,r.to);
      let ok=false;
      try{ok=r.text?document.execCommand('insertText',false,r.text):document.execCommand('delete')}catch(err){}
      if(!ok||ta.value!==want){ta.value=want;ta.dispatchEvent(new Event('input',{bubbles:true}))}
    }
    ta.setSelectionRange(r.selStart,r.selEnd);
  }

  function attach(ta){
    ta.addEventListener('keydown',ev=>{
      if(ev.isComposing)return;
      const k=ev.key,v=ta.value,s=ta.selectionStart,e=ta.selectionEnd;
      const mod=ev.ctrlKey||ev.metaKey,altgr=ev.ctrlKey&&ev.altKey&&!ev.metaKey;
      let r=null;
      if(k==='Tab'&&!mod&&!ev.altKey){ev.preventDefault();r=tab(v,s,e,ev.shiftKey)}
      else if(mod&&!ev.altKey&&!ev.shiftKey&&/^[bik]$/i.test(k)){
        ev.preventDefault();
        const c=k.toLowerCase();r=c==='k'?link(v,s,e):format(v,s,e,c==='b'?'**':'*');
      }
      else if(ev.altKey&&!mod&&(k==='ArrowUp'||k==='ArrowDown')){
        ev.preventDefault();
        r=(ev.shiftKey?duplicate:move)(v,s,e,k==='ArrowUp'?-1:1);
      }
      else if(k==='Enter'&&!mod&&!ev.altKey&&!ev.shiftKey){r=enter(v,s,e);if(r)ev.preventDefault()}
      else if((!mod&&!ev.altKey)||altgr){r=wrap(v,s,e,k);if(r)ev.preventDefault()}
      apply(ta,r);
    });
    ta.addEventListener('paste',ev=>{
      const r=paste(ta.value,ta.selectionStart,ta.selectionEnd,ev.clipboardData&&ev.clipboardData.getData('text/plain'));
      if(r){ev.preventDefault();apply(ta,r)}
    });
  }

  return{tab,enter,format,link,wrap,paste,move,duplicate,toggleBox,mapPos,apply,attach};
})();
if(typeof module!=='undefined')module.exports=Editor;
