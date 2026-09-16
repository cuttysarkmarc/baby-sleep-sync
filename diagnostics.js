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

const observer=new MutationObserver(addDiagnosticButton);
observer.observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener('load',async()=>{
  try{
    const reg=await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});
    await reg.update();
  }catch(e){console.error(e)}
  addDiagnosticButton();
});