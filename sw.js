const CACHE='baby-sleep-sync-v3';
const ASSETS=['/','/index.html','/styles.css','/app.js','/config.js','/manifest.webmanifest','/icon.svg'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const u=new URL(e.request.url);if(u.origin!==self.location.origin)return;e.respondWith(fetch(e.request).then(r=>{const x=r.clone();caches.open(CACHE).then(c=>c.put(e.request,x));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('/index.html'))))});
self.addEventListener('push',e=>{
  let data={title:'Baby Sleep Sync',body:'Sleep reminder',silent:false,type:'reminder'};
  try{if(e.data)data={...data,...e.data.json()}}catch{if(e.data)data.body=e.data.text()}
  const options={
    body:data.body,
    icon:'/icon.svg',
    badge:'/icon.svg',
    tag:`baby-sleep-${data.type||'reminder'}`,
    renotify:false,
    silent:!!data.silent,
    data:{url:'/',type:data.type||'reminder'}
  };
  if(!data.silent)options.vibrate=[180,90,180];
  e.waitUntil(self.registration.showNotification(data.title||'Baby Sleep Sync',options));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const url=e.notification.data?.url||'/';
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{
    for(const c of cs){if('focus'in c){c.navigate?.(url);return c.focus()}}
    return self.clients.openWindow(url)
  }));
});