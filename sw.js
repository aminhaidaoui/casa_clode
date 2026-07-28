const CACHE_NAME='casa-nostra-v50';
const CORE=['./','./index.html','./manifest.webmanifest','./daily-messages.json','./assets/home/IMG_0201.jpg','./assets/app/icon-192.png','./assets/app/icon-512.png'];

self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(CORE)));
});

self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting()});

self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET'||request.headers.has('range'))return;
 const url=new URL(request.url);
 if(url.origin!==self.location.origin)return;
 if(url.pathname.endsWith('/daily-messages.json')){
  event.respondWith(fetch(request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(new Request(request.url),copy))}return response}).catch(()=>caches.match(new Request(request.url))));
  return;
 }
 if(request.mode==='navigate'){
  event.respondWith(fetch(request).then(response=>{const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(request,copy));return response}).catch(()=>caches.match(request).then(cached=>cached||caches.match('./index.html'))));
  return;
 }
 event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(request,copy))}return response})));
});

self.addEventListener('push',event=>{
 let data={};
 try{data=event.data?.json()||{}}catch{data={body:event.data?.text()||''}}
 const scope=self.registration.scope;
 event.waitUntil(self.registration.showNotification(data.title||'Casa Nostra 💗',{
  body:data.body||'C’è qualcosa di nuovo che ti aspetta.',
  icon:`${scope}assets/app/icon-192.png`,
  badge:`${scope}assets/app/icon-192.png`,
  tag:data.tag||'casa-nostra',
  renotify:true,
  data:{url:data.url||`${scope}#pensieriDiOggi`}
 }));
});

self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const target=new URL(event.notification.data?.url||`${self.registration.scope}#pensieriDiOggi`,self.registration.scope).href;
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
  for(const client of clients){
   if(new URL(client.url).origin===new URL(target).origin){
    if('navigate' in client)await client.navigate(target);
    return client.focus();
   }
  }
  return self.clients.openWindow(target);
 }));
});
