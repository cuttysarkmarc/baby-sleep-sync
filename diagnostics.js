async function phoneOnlyTest(){
  try{
    if(!('Notification' in window)) throw new Error('Notifications are not supported on this phone.');
    if(Notification.permission!=='granted'){
      const p=await Notification.requestPermission();
      if(p!=='granted') throw new Error('Android notification permission is not granted.');
    }
    const reg=await navigator.serviceWorker.ready;
    await reg.update().catch(()=>{});
    await reg.showNotification('Baby Sleep Sync',{
      body:'Phone-only test. If you see this, Android can display our notifications.',
      tag:'baby-sleep-phone-test-'+Date.now(),
      requireInteraction:true,
      silent:false,
      vibrate:[250,120,250,120,400],
      data:{url:'/'}
    });
    showDiagToast('Phone-only test requested');
  }catch(e){
    console.error(e);
    showDiagToast(e?.message||'Phone-only test failed');
  }
}

function showDiagToast(message){
  const t=document.querySelector('#toast');
  if(!t)return;
  t.textContent=message;
  t.classList.add('show');
  clearTimeout(t.__diagTimer);
  t.__diagTimer=setTimeout(()=>t.classList.remove('show'),3000);
}

function addDiagnosticButton(){
  const test=document.querySelector('button[data-a="test-push"]');
  if(!test||document.querySelector('[data-a="phone-test"]'))return;
  const b=document.createElement('button');
  b.className='btn secondary';
  b.dataset.a='phone-test';
  b.textContent='TEST PHONE ONLY';
  b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();phoneOnlyTest()});
  test.parentElement?.appendChild(b);
}

function simplifyUi(){
  const brand=document.querySelector('.eyebrow');
  if(brand && brand.textContent!=='SleepSarku') brand.textContent='SleepSarku';

  const nightTab=document.querySelector('button[data-tab="night"]');
  if(nightTab) nightTab.remove();

  const tabs=document.querySelector('.tabs');
  if(tabs && tabs.style.gridTemplateColumns!=='repeat(3, 1fr)') tabs.style.gridTemplateColumns='repeat(3, 1fr)';

  document.querySelectorAll('button[data-log="bedtime"]').forEach(b=>{
    if(b.textContent!=='BEDTIME') b.textContent='BEDTIME';
  });

  document.querySelectorAll('.setting').forEach(card=>{
    const text=card.textContent||'';
    if(text.includes('First night feed wait')||text.includes('Later night feed wait')) card.remove();
  });

  document.querySelectorAll('.history').forEach(row=>{
    const text=row.textContent||'';
    if(/Night wake|Feed started|Feed finished|Back asleep/i.test(text)) row.remove();
  });

  const h=document.querySelector('.hero');
  if(h?.textContent==='Night'){
    const today=document.querySelector('button[data-tab="today"]');
    today?.click();
  }
}

let uiPassQueued=false;
function queueUiPass(){
  if(uiPassQueued)return;
  uiPassQueued=true;
  queueMicrotask(()=>{
    uiPassQueued=false;
    addDiagnosticButton();
    simplifyUi();
  });
}

const observer=new MutationObserver(queueUiPass);
observer.observe(document.documentElement,{childList:true,subtree:true});

window.addEventListener('load',async()=>{
  try{
    const reg=await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});
    await reg.update();
  }catch(e){console.error(e)}
  queueUiPass();
});