const CACHE='dgt-mostoles-v1';
const ASSETS=['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET') return;
  e.respondWith(caches.match(req).then(cached=>cached || fetch(req).then(resp=>{
    if(new URL(req.url).origin===self.location.origin){
      const copy=resp.clone(); caches.open(CACHE).then(c=>c.put(req,copy));
    }
    return resp;
  }).catch(()=>cached)));
});
