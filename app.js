import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const VAPID_PUBLIC_KEY='BBIXHd5qOc_t0xwcgLb4y9tkGLBiJxiYMgka9wwsqkuZmSuVWDbc0jZtFjhQuBBuxHWK0Wt3Ww3-D6Kh5k2hdHU';
const sb=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true}});
const app=document.querySelector('#app'),toastEl=document.querySelector('#toast');
const S={user:null,member:null,house:null,members:[],settings:null,events:[],tab:'today',channel:null,install:null,pushSupported:'serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window,pushEnabled:false,pushPermission:'Notification'in window?Notification.permission:'unsupported'};

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toast=m=>{toastEl.textContent=m;toastEl.classList.add('show');clearTimeout(toastEl.t);toastEl.t=setTimeout(()=>toastEl.classList.remove('show'),2200)};
const add=(d,m)=>new Date(new Date(d).getTime()+m*60000);
const mins=(a,b)=>Math.round((new Date(b)-new Date(a))/60000);
const dayKey=d=>{d=new Date(d);return \`\${d.getFullYear()}-\${String(d.getMonth()+1).padStart(2,'0')}-\${String(d.getDate()).padStart(2,'0')}\`};
const fmt=d=>d?new Intl.DateTimeFormat([],{hour:'numeric',minute:'2-digit'}).format(new Date(d)):'—';
const shortDate=d=>new Intl.DateTimeFormat([],{weekday:'short',month:'short',day:'numeric'}).format(new Date(d));
const dur=m=>{m=Math.max(0,Math.round(m||0));return \`\${Math.floor(m/60)?Math.floor(m/60)+'h ':''}\${m%60?m%60+'m':''}\`.trim()||'0m'};
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const median=a=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y),i=Math.floor(s.length/2);return s.length%2?s[i]:(s[i-1]+s[i])/2};

function pairDays(events){
  const by={};
  for(const e of [...events].sort((a,b)=>new Date(a.occurred_at)-new Date(b.occurred_at))){
    const k=dayKey(e.occurred_at);(by[k]??=[]).push(e);
  }
  return Object.entries(by).map(([date,es])=>{
    const wake=es.find(e=>e.event_type==='morning_wake');
    const bedtime=[...es].reverse().find(e=>e.event_type==='bedtime');
    const naps=[];
    for(const e of es){
      if(e.event_type==='nap_start')naps.push({start:e,end:null});
      if(e.event_type==='nap_end'){const n=[...naps].reverse().find(n=>!n.end);if(n)n.end=e}
    }
    return {date,events:es,wake,bedtime,naps};
  }).sort((a,b)=>a.date.localeCompare(b.date));
}

function recentIntervals(){
  const rows=pairDays(S.events).slice(-10);
  const w1=[],w2=[],w3=[];
  for(const d of rows){
    if(d.wake&&d.naps[0]?.start)w1.push(mins(d.wake.occurred_at,d.naps[0].start.occurred_at));
    if(d.naps[0]?.end&&d.naps[1]?.start)w2.push(mins(d.naps[0].end.occurred_at,d.naps[1].start.occurred_at));
    if(d.naps[1]?.end&&d.bedtime)w3.push(mins(d.naps[1].end.occurred_at,d.bedtime.occurred_at));
  }
  return {w1,w2,w3};
}

function learnedWindow(config,actual){
  const clean=actual.filter(v=>v>60&&v<420);
  if(clean.length<2)return {minutes:config,learned:false,samples:clean.length,spread:20};
  const med=median(clean.slice(-7)),weight=Math.min(.65,.18+clean.length*.08);
  const prediction=Math.round(config*(1-weight)+med*weight);
  const spread=Math.max(12,Math.min(30,Math.round((Math.max(...clean)-Math.min(...clean))/2)||18));
  return {minutes:prediction,learned:true,samples:clean.length,spread};
}

function todayState(){
  if(!S.settings)return null;
  const today=dayKey(new Date()),todayEvents=S.events.filter(e=>dayKey(e.occurred_at)===today).sort((a,b)=>new Date(a.occurred_at)-new Date(b.occurred_at));
  const wake=todayEvents.find(e=>e.event_type==='morning_wake');
  const bedtime=[...todayEvents].reverse().find(e=>e.event_type==='bedtime');
  const naps=[];
  for(const e of todayEvents){
    if(e.event_type==='nap_start')naps.push({start:e,end:null});
    if(e.event_type==='nap_end'){const n=[...naps].reverse().find(n=>!n.end);if(n)n.end=e}
  }
  const open=[...naps].reverse().find(n=>!n.end);
  const hist=recentIntervals();
  const p1=learnedWindow(S.settings.wake_window_1_minutes,hist.w1);
  const p2=learnedWindow(S.settings.wake_window_2_minutes,hist.w2);
  const p3=learnedWindow(S.settings.wake_window_3_minutes,hist.w3);
  let kind='wake',anchor=null,p=null,target=null;
  if(!wake){kind='wake'}
  else if(open){kind='nap-running';anchor=open.start}
  else if(!naps[0]){kind='nap1';anchor=wake;p=p1;target=add(wake.occurred_at,p.minutes)}
  else if(!naps[1]){kind='nap2';anchor=naps[0].end;p=p2;target=anchor?add(anchor.occurred_at,p.minutes):null}
  else if(!bedtime){kind='bedtime';anchor=naps[1].end;p=p3;target=anchor?add(anchor.occurred_at,p.minutes):null}
  else kind='done';
  const totalNap=naps.reduce((t,n)=>t+(n.end?mins(n.start.occurred_at,n.end.occurred_at):mins(n.start.occurred_at,new Date())),0);
  return {todayEvents,wake,bedtime,naps,open,kind,target,p,totalNap};
}

function countdown(target){
  if(!target)return '';
  const m=Math.round((new Date(target)-Date.now())/60000);
  if(m<=0)return m>-15?'now':\`\${Math.abs(m)}m late\`;
  if(m<60)return \`\${m} min\`;
  return \`\${Math.floor(m/60)}h \${m%60}m\`;
}

function confidence(p){
  if(!p?.learned)return 'Schedule-based';
  if(p.samples>=6)return 'High confidence';
  if(p.samples>=4)return 'Good confidence';
  return 'Learning';
}

function ageText(){
  if(!S.house?.baby_birth_date)return '';
  const birth=new Date(S.house.baby_birth_date+'T12:00:00'),now=new Date();
  let months=(now.getFullYear()-birth.getFullYear())*12+now.getMonth()-birth.getMonth();
  if(now.getDate()<birth.getDate())months--;
  return months>=0?\`\${months} month\${months===1?'':'s'}\`:'';
}

async function auth(){
  const {data}=await sb.auth.getSession();
  if(data.session?.user)return data.session.user;
  const r=await sb.auth.signInAnonymously();if(r.error)throw r.error;return r.data.user;
}
async function refreshPushState(){
  S.pushPermission='Notification'in window?Notification.permission:'unsupported';
  if(!S.pushSupported){S.pushEnabled=false;return}
  try{const reg=await navigator.serviceWorker.ready;S.pushEnabled=!!(await reg.pushManager.getSubscription())}catch{S.pushEnabled=false}
}
async function load(){
  try{
    S.user=await auth();
    const m=await sb.from('household_members').select('*').eq('user_id',S.user.id).limit(1);if(m.error)throw m.error;
    S.member=m.data?.[0]||null;
    if(!S.member){S.house=null;S.settings=null;S.events=[];S.members=[];await sub(null);render();return}
    const id=S.member.household_id,cut=new Date(Date.now()-35*86400000).toISOString();
    const [h,st,ev,ms]=await Promise.all([
      sb.from('households').select('*').eq('id',id).single(),
      sb.from('sleep_settings').select('*').eq('household_id',id).single(),
      sb.from('sleep_events').select('*').eq('household_id',id).gte('occurred_at',cut).order('occurred_at'),
      sb.from('household_members').select('*').eq('household_id',id).order('joined_at')
    ]);
    for(const r of[h,st,ev,ms])if(r.error)throw r.error;
    S.house=h.data;S.settings=st.data;S.events=ev.data||[];S.members=ms.data||[];
    await sub(id);await refreshPushState();render();
  }catch(e){console.error(e);app.innerHTML=\`<main class="center"><div class="logo">Zz</div><h1>SleepSarku</h1><p class="muted">Couldn’t connect.</p><button class="btn" onclick="location.reload()">TRY AGAIN</button></main>\`}
}
async function sub(id){
  if(S.channel){await sb.removeChannel(S.channel);S.channel=null}if(!id)return;
  S.channel=sb.channel('sync:'+id)
    .on('postgres_changes',{event:'*',schema:'public',table:'sleep_events',filter:\`household_id=eq.\${id}\`},load)
    .on('postgres_changes',{event:'*',schema:'public',table:'sleep_settings',filter:\`household_id=eq.\${id}\`},load)
    .on('postgres_changes',{event:'*',schema:'public',table:'households',filter:\`id=eq.\${id}\`},load)
    .subscribe();
}
async function create(name){const r=await sb.rpc('create_household',{p_name:'Our Family',p_display_name:name||'Parent'});if(r.error)throw r.error;await load()}
async function join(code,name){const r=await sb.rpc('join_household',{p_invite_code:code.trim().toUpperCase(),p_display_name:name||'Parent'});if(r.error)throw r.error;await load()}
async function log(type,note=''){
  const r=await sb.from('sleep_events').insert({household_id:S.member.household_id,event_type:type,occurred_at:new Date().toISOString(),note:note||S.member.display_name,created_by:S.user.id});
  if(r.error)throw r.error;toast('Logged');await load();
}
async function editEvent(id){
  const e=S.events.find(x=>x.id===id);if(!e)return;
  const d=new Date(e.occurred_at),local=new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16),v=prompt('Edit time',local);if(!v)return;
  const nd=new Date(v);if(Number.isNaN(+nd))return toast('Invalid time');
  const r=await sb.from('sleep_events').update({occurred_at:nd.toISOString()}).eq('id',id);if(r.error)throw r.error;toast('Updated');await load();
}
async function deleteEvent(id){const r=await sb.from('sleep_events').delete().eq('id',id);if(r.error)throw r.error;toast('Deleted');await load()}
async function saveBaby(){
  const baby_name=document.querySelector('#baby-name')?.value.trim()||null;
  const baby_birth_date=document.querySelector('#baby-birth')?.value||null;
  const r=await sb.from('households').update({baby_name,baby_birth_date}).eq('id',S.house.id);if(r.error)throw r.error;toast('Saved');await load();
}
async function setting(k,delta){
  const min=['bedtime_feed_gap_minutes','nap_warning_minutes'].includes(k)?0:15,v=Math.max(min,Number(S.settings[k])+delta);
  const r=await sb.from('sleep_settings').update({[k]:v,updated_by:S.user.id}).eq('household_id',S.member.household_id);if(r.error)throw r.error;await load();
}
function urlBase64ToUint8Array(s){const p='='.repeat((4-s.length%4)%4),b=(s+p).replace(/-/g,'+').replace(/_/g,'/'),raw=atob(b);return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)))}
async function enablePush(){
  if(!S.pushSupported)throw new Error('Push is not supported on this phone.');
  const permission=await Notification.requestPermission();S.pushPermission=permission;if(permission!=='granted')throw new Error('Notifications were not allowed.');
  const reg=await navigator.serviceWorker.ready;let subscription=await reg.pushManager.getSubscription();
  if(!subscription)subscription=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(VAPID_PUBLIC_KEY)});
  const j=subscription.toJSON(),r=await sb.from('push_subscriptions').upsert({endpoint:subscription.endpoint,household_id:S.member.household_id,user_id:S.user.id,p256dh:j.keys?.p256dh,auth:j.keys?.auth,device_label:'Android phone',enabled:true,updated_at:new Date().toISOString()},{onConflict:'endpoint'});
  if(r.error)throw r.error;S.pushEnabled=true;toast('Reminders enabled');render();
}
async function disablePush(){
  const reg=await navigator.serviceWorker.ready,subscription=await reg.pushManager.getSubscription();
  if(subscription){await sb.from('push_subscriptions').delete().eq('endpoint',subscription.endpoint);await subscription.unsubscribe()}
  S.pushEnabled=false;toast('Reminders disabled');render();
}
async function testPush(){
  const {data}=await sb.auth.getSession(),token=data.session?.access_token;if(!token)throw new Error('Could not verify this phone.');
  const res=await fetch(\`\${SUPABASE_URL}/functions/v1/sleep-push\`,{method:'POST',headers:{'Content-Type':'application/json',apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:\`Bearer \${token}\`},body:JSON.stringify({action:'test'})});
  const body=await res.json().catch(()=>({}));if(!res.ok||!body.sent)throw new Error(body.error||'Test failed');toast('Test sent');
}

const meta={
  morning_wake:['☀️','Wake up'],nap_start:['☁️','Nap started'],nap_end:['🌤️','Nap ended'],bedtime:['🌙','Bedtime'],
  bottle:['🍼','Bottle'],nursing:['🤱','Nursing'],solids:['🥣','Solids'],pumping:['🍼','Pumping'],diaper:['🧷','Diaper']
};

function setup(){
  return \`<main class="center setup"><div class="logo glow">Zz</div><h1>SleepSarku</h1><p class="muted">A shared rhythm for naps, bedtime, and baby care.</p><div class="setup-box"><label>YOUR NAME</label><input id="name" class="input" placeholder="Dad or Mom"><button class="btn" data-a="create">CREATE HOUSEHOLD</button><div class="or">or</div><label>INVITE CODE</label><input id="code" class="input" maxlength="6" placeholder="ABC123"><button class="btn secondary" data-a="join">JOIN HOUSEHOLD</button></div></main>\`;
}

function timeline(c){
  const items=[];
  if(c.wake)items.push(['☀️',fmt(c.wake.occurred_at),'Wake']);
  c.naps.forEach((n,i)=>items.push(['☁️',n.end?\`\${fmt(n.start.occurred_at)}–\${fmt(n.end.occurred_at)}\`:fmt(n.start.occurred_at),\`Nap \${i+1}\`]));
  if(c.bedtime)items.push(['🌙',fmt(c.bedtime.occurred_at),'Bed']);
  return \`<div class="timeline">\${items.length?items.map(x=>\`<div class="timeline-item"><span>\${x[0]}</span><strong>\${x[1]}</strong><small>\${x[2]}</small></div>\`).join(''):'<div class="empty">Log morning wake to start today’s rhythm.</div>'}</div>\`;
}

function today(){
  const c=todayState(),baby=esc(S.house?.baby_name||'Your baby'),age=ageText();
  let title='Ready for today',big='—',time='',sub='Log morning wake to begin',primary='<button class="main-action" data-log="morning_wake">☀️ BABY IS UP</button>';
  if(c.kind==='nap-running'){title='Nap in progress';big=dur(mins(c.open.start.occurred_at,new Date()));time=\`started \${fmt(c.open.start.occurred_at)}\`;sub='Tap when baby wakes';primary='<button class="main-action" data-log="nap_end">🌤️ BABY IS AWAKE</button>'}
  if(['nap1','nap2','bedtime'].includes(c.kind)){
    const name=c.kind==='nap1'?'Nap 1':c.kind==='nap2'?'Nap 2':'Bedtime';
    title=c.kind==='bedtime'?'Bedtime in':\`\${name} in\`;big=countdown(c.target);time=fmt(c.target);
    const lo=add(c.target,-(c.p?.spread||20)),hi=add(c.target,c.p?.spread||20);
    sub=\`Expected \${fmt(lo)}–\${fmt(hi)} · \${confidence(c.p)}\`;
    primary=c.kind==='bedtime'?'<button class="main-action moon" data-log="bedtime">🌙 BEDTIME</button>':'<button class="main-action" data-log="nap_start">☁️ START NAP</button>';
  }
  if(c.kind==='done'){title='Day complete';big='✓';time=fmt(c.bedtime.occurred_at);sub=\`Day sleep \${dur(c.totalNap)}\`;primary='<button class="main-action ghost" data-tab="trends">VIEW TODAY</button>'}
  const progress=c.target?clamp(1-(new Date(c.target)-Date.now())/(4*3600000),0.05,1):.12;
  return \`<section class="hello"><div><span class="kicker">TODAY</span><h1>\${baby}</h1><p>\${age||'Sleep rhythm'}</p></div><div class="sync">● Synced</div></section>
  <section class="orbit-card">
    <div class="stars"></div>
    <div class="orbit" style="--p:\${progress}"><div class="orbit-inner"><span class="orbit-label">\${esc(title)}</span><strong>\${esc(big)}</strong><b>\${esc(time)}</b><small>\${esc(sub)}</small></div></div>
    \${primary}
  </section>
  <section class="section-head"><div><span class="kicker">TODAY'S RHYTHM</span><h2>At a glance</h2></div><div class="stat-pill">\${dur(c.totalNap)} naps</div></section>
  \${timeline(c)}
  <section class="mini-grid">
    <button class="mini-card" data-tab="log"><span>＋</span><b>Quick log</b><small>Feeds, solids, diaper</small></button>
    <button class="mini-card" data-tab="trends"><span>⌁</span><b>Trends</b><small>Patterns & averages</small></button>
  </section>\`;
}

function quickLog(){
  const c=todayState(),last=t=>[...S.events].reverse().find(e=>e.event_type===t);
  const items=[
    ['morning_wake','☀️','Wake-up'],['nap_start','☁️','Start nap'],['nap_end','🌤️','End nap'],['bedtime','🌙','Bedtime'],
    ['bottle','🍼','Bottle'],['nursing','🤱','Nursing'],['solids','🥣','Solids'],['pumping','🫗','Pumping'],['diaper','🧷','Diaper']
  ];
  return \`<section class="page-title"><span class="kicker">QUICK LOG</span><h1>What just happened?</h1><p>One tap saves it for both parents.</p></section>
  <div class="log-grid">\${items.map(([t,i,n])=>{const e=last(t);return \`<button class="log-card" data-log="\${t}"><span>\${i}</span><b>\${n}</b><small>\${e?\`\${fmt(e.occurred_at)} · \${dayKey(e.occurred_at)===dayKey(new Date())?'today':shortDate(e.occurred_at)}\`:'Not logged today'}</small></button>\`}).join('')}</div>
  <section class="section-head"><div><span class="kicker">RECENT</span><h2>Latest activity</h2></div></section>
  \${historyList(12)}\`;
}

function dailyMetrics(){
  return pairDays(S.events).slice(-7).map(d=>{
    const napMin=d.naps.reduce((t,n)=>t+(n.end?mins(n.start.occurred_at,n.end.occurred_at):0),0);
    return {date:d.date,wake:d.wake?new Date(d.wake.occurred_at):null,bed:d.bedtime?new Date(d.bedtime.occurred_at):null,napMin,naps:d.naps.filter(n=>n.end).length};
  });
}
function timeMinutes(d){return d?d.getHours()*60+d.getMinutes():null}
function barChart(rows,field,min,max,format){
  return \`<div class="chart">\${rows.map(r=>{const v=r[field],pct=v==null?3:clamp((v-min)/(max-min)*100,3,100);return \`<div class="bar-col"><div class="bar-value">\${v==null?'—':format(v)}</div><div class="bar-track"><div class="bar-fill" style="height:\${pct}%"></div></div><small>\${new Date(r.date+'T12:00:00').toLocaleDateString([],{weekday:'short'})}</small></div>\`}).join('')}</div>\`;
}
function trends(){
  const rows=dailyMetrics(),completed=rows.filter(r=>r.napMin>0),avgNap=Math.round(avg(completed.map(r=>r.napMin))||0);
  const wakeVals=rows.map(r=>timeMinutes(r.wake)).filter(v=>v!=null),bedVals=rows.map(r=>timeMinutes(r.bed)).filter(v=>v!=null);
  const avgWake=avg(wakeVals),avgBed=avg(bedVals);
  const fmtMin=v=>{const h=Math.floor(v/60)%24,m=Math.round(v%60);return new Date(2000,0,1,h,m).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})};
  return \`<section class="page-title"><span class="kicker">TRENDS</span><h1>What’s working?</h1><p>Sleep patterns from your recent logs.</p></section>
  <div class="metric-grid">
    <div class="metric"><span>DAY SLEEP</span><strong>\${dur(avgNap)}</strong><small>7-day average</small></div>
    <div class="metric"><span>WAKE-UP</span><strong>\${avgWake!=null?fmtMin(avgWake):'—'}</strong><small>average</small></div>
    <div class="metric"><span>BEDTIME</span><strong>\${avgBed!=null?fmtMin(avgBed):'—'}</strong><small>average</small></div>
  </div>
  <section class="chart-card"><div class="section-head compact"><div><span class="kicker">DAYTIME SLEEP</span><h2>Last 7 days</h2></div></div>\${barChart(rows,'napMin',0,180,v=>dur(v))}</section>
  <section class="chart-card"><div class="section-head compact"><div><span class="kicker">BEDTIME</span><h2>Consistency</h2></div></div>\${barChart(rows,'bed',1140,1380,v=>fmtMin(timeMinutes(v)))}</section>
  <section class="insight"><span>✦</span><div><b>SleepSarku is learning</b><p>\${predictionInsight()}</p></div></section>
  <section class="section-head"><div><span class="kicker">HISTORY</span><h2>Recent logs</h2></div></section>\${historyList(30)}\`;
}
function predictionInsight(){
  const h=recentIntervals(),sets=[h.w1,h.w2,h.w3],n=sets.reduce((a,x)=>a+x.length,0);
  if(n<4)return 'Keep logging wake-ups and naps. Predictions become personalized after a few complete days.';
  const d=Math.round(avg(sets.flat().slice(-12))||0);
  return \`Predictions now use \${n} recent wake-window samples and blend them with your schedule. Recent average wake window: \${dur(d)}.\`;
}
function historyList(limit){
  const hidden=new Set(['night_wake','feed_start','feed_end','back_asleep']);
  const rows=[...S.events].filter(e=>!hidden.has(e.event_type)).sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at)).slice(0,limit);
  return \`<div class="history-card">\${rows.length?rows.map(e=>{const [icon,name]=meta[e.event_type]||['•',e.event_type];return \`<div class="history-row"><span class="event-icon">\${icon}</span><div><b>\${esc(name)}</b><small>\${esc(e.note||'Parent')} · \${shortDate(e.occurred_at)}</small></div><time>\${fmt(e.occurred_at)}</time><button data-edit="\${e.id}">⋯</button></div>\`}).join(''):'<div class="empty">No activity yet.</div>'}</div>\`;
}

function srow(name,k){return \`<div class="setting-row"><div><b>\${name}</b><small>\${dur(S.settings[k])}</small></div><button data-set="\${k}" data-d="-15">−</button><button data-set="\${k}" data-d="15">＋</button></div>\`}
function settings(){
  const status=!S.pushSupported?'Not supported':S.pushPermission==='denied'?'Blocked':S.pushEnabled?'On':'Off';
  return \`<section class="page-title"><span class="kicker">SETTINGS</span><h1>SleepSarku</h1><p>Shared between \${S.members.map(m=>esc(m.display_name)).join(' + ')||'your household'}.</p></section>
  <section class="settings-card"><span class="kicker">BABY PROFILE</span><label>Baby name<input id="baby-name" class="input" value="\${esc(S.house.baby_name||'')}" placeholder="Baby"></label><label>Birth date<input id="baby-birth" class="input" type="date" value="\${esc(S.house.baby_birth_date||'')}"></label><button class="btn" data-a="save-baby">SAVE PROFILE</button></section>
  <section class="settings-card"><div class="settings-title"><div><span class="kicker">REMINDERS</span><h2>Android notifications</h2></div><span class="status">\${status}</span></div><p>Nap and bedtime reminders can alert even when SleepSarku is closed.</p><div class="btns">\${S.pushEnabled?'<button class="btn secondary" data-a="disable-push">DISABLE</button><button class="btn" data-a="test-push">TEST</button>':'<button class="btn" data-a="enable-push">ENABLE REMINDERS</button>'}</div></section>
  <section class="settings-card"><div class="settings-title"><div><span class="kicker">HOUSEHOLD</span><h2>Invite code</h2></div><strong class="code">\${esc(S.house.invite_code)}</strong></div><button class="btn secondary" data-a="share">SHARE WITH PARTNER</button></section>
  <section class="settings-card"><span class="kicker">SCHEDULE BASELINE</span>\${srow('Wake window 1','wake_window_1_minutes')}\${srow('Wake window 2','wake_window_2_minutes')}\${srow('Wake window 3','wake_window_3_minutes')}\${srow('Day sleep cap','daytime_sleep_cap_minutes')}</section>\`;
}
function nav(){
  const items=[['today','⌂','Today'],['log','＋','Log'],['trends','⌁','Trends'],['settings','⚙','Settings']];
  return \`<nav class="tabs">\${items.map(([id,i,n])=>\`<button class="tab \${S.tab===id?'active':''}" data-tab="\${id}"><span>\${i}</span>\${n}</button>\`).join('')}</nav>\`;
}
function render(){
  if(!S.user)return;if(!S.member){app.innerHTML=setup();return}
  const body=S.tab==='today'?today():S.tab==='log'?quickLog():S.tab==='trends'?trends():settings();
  app.innerHTML=\`<div class="shell"><header class="top"><div><div class="brand">SleepSarku</div><div class="parent">\${esc(S.member.display_name)}</div></div><div class="sync-dot">●</div></header><main class="page">\${body}</main>\${nav()}</div>\`;
}
async function run(fn){try{await fn()}catch(e){console.error(e);toast(e.message||'Could not save')}}

app.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.tab){S.tab=b.dataset.tab;render()}
  else if(b.dataset.log)run(()=>log(b.dataset.log));
  else if(b.dataset.a==='create')run(()=>create(document.querySelector('#name')?.value.trim()));
  else if(b.dataset.a==='join'){const code=document.querySelector('#code')?.value||'';if(code.trim().length!==6)return toast('Enter the 6-character code');run(()=>join(code,document.querySelector('#name')?.value.trim()))}
  else if(b.dataset.a==='save-baby')run(saveBaby);
  else if(b.dataset.edit){const id=b.dataset.edit;if(confirm('Edit this log time? Cancel to leave it unchanged.'))run(()=>editEvent(id));}
  else if(b.dataset.set)run(()=>setting(b.dataset.set,Number(b.dataset.d)));
  else if(b.dataset.a==='share'){const text=\`Join our SleepSarku household with code \${S.house.invite_code}\`;navigator.share?navigator.share({title:'SleepSarku',text,url:location.origin}).catch(()=>{}):navigator.clipboard.writeText(\`\${text} \${location.origin}\`).then(()=>toast('Invite copied'))}
  else if(b.dataset.a==='enable-push')run(enablePush);
  else if(b.dataset.a==='disable-push')run(disablePush);
  else if(b.dataset.a==='test-push')run(testPush);
});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();S.install=e});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).catch(console.error));
setInterval(()=>S.member&&S.tab==='today'&&render(),30000);
load();