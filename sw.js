/* Service worker: o app inteiro fica no cache e abre sem rede.
   Troque VERSION a cada publicação para os aparelhos pegarem a versão nova. */
const VERSION='prafazer-v2';
const SHELL=['./','index.html','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png','icon-maskable-512.png','apple-touch-icon.png'];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const req=e.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==location.origin)return;   // Dropbox etc. passam direto
  // stale-while-revalidate: responde do cache e atualiza em segundo plano
  e.respondWith(caches.open(VERSION).then(async cache=>{
    const hit=await cache.match(req,{ignoreSearch:true})||(req.mode==='navigate'?await cache.match('index.html'):null);
    const net=fetch(req).then(r=>{if(r.ok)cache.put(req,r.clone());return r}).catch(()=>hit);
    return hit||net;
  }));
});
