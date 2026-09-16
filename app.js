import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const VAPID_PUBLIC_KEY = 'BBIXHd5qOc_t0xwcgLb4y9tkGLBiJxiYMgka9wwsqkuZmSuVWDbc0jZtFjhQuBBuxHWK0Wt3Ww3-D6Kh5k2hdHU';
const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});
const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');

const S = {
  user: null,
  member: null,
  house: null,
  members: [],
  settings: null,
  events: [],
  tab: 'today',
  channel: null,
  install: null,
  pushSupported: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
  pushEnabled: false,
  pushPermission: 'Notification' in window ? Notification.permission : 'unsupported'
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
const toast = m => {
  toastEl.textContent = m;
  toastEl.classList.add('show');
  clearTimeout(toastEl.t);
  toastEl.t = setTimeout(() => toastEl.classList.remove('show'), 2200);
};
const fmt = d => d ? new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(new Date(d)) : '—';
const long = d => new Intl.DateTimeFormat([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(d));
const dur = m => `${Math.floor(m / 60) ? Math.floor(m / 60) + 'h ' : ''}${m % 60 ? m % 60 + 'm' : ''}`.trim() || '0m';
const add = (d, m) => new Date(new Date(d).getTime() + m * 60000);
const key = d => {
  d = new Date(d);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function calc() {
  if (!S.settings) return null;
  const e = [...S.events].sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
  const today = key(new Date());
  const wake = [...e].reverse().find(x => x.event_type === 'morning_wake' && key(x.occurred_at) === today);
  const day = wake ? e.filter(x => new Date(x.occurred_at) >= new Date(wake.occurred_at)) : [];
  const naps = [];
  for (const x of day) {
    if (x.event_type === 'bedtime') break;
    if (x.event_type === 'nap_start') naps.push({ start: x, end: null });
    if (x.event_type === 'nap_end') {
      const n = [...naps].reverse().find(n => !n.end);
      if (n) n.end = x;
    }
  }
  const n1 = naps[0], n2 = naps[1];
  const open = [...naps].reverse().find(n => !n.end);
  const nap1 = wake ? add(wake.occurred_at, S.settings.wake_window_1_minutes) : null;
  const nap2 = n1?.end ? add(n1.end.occurred_at, S.settings.wake_window_2_minutes) : null;
  const bed = n2?.end ? add(n2.end.occurred_at, S.settings.wake_window_3_minutes) : null;
  const total = Math.round(naps.reduce((a, n) => a + (n.end ? new Date(n.end.occurred_at) - new Date(n.start.occurred_at) : Date.now() - new Date(n.start.occurred_at)), 0) / 60000);
  const recent = Date.now() - 20 * 3600000;
  const bedtime = [...e].reverse().find(x => x.event_type === 'bedtime' && new Date(x.occurred_at) > recent);
  const night = bedtime ? e.filter(x => new Date(x.occurred_at) >= new Date(bedtime.occurred_at)) : [];
  const lastFeed = [...night].reverse().find(x => x.event_type === 'feed_end');
  const active = [...night].reverse().find(x => x.event_type === 'feed_start' && !night.some(y => y.event_type === 'feed_end' && new Date(y.occurred_at) > new Date(x.occurred_at)));
  const eligible = lastFeed ? add(lastFeed.occurred_at, S.settings.later_night_feed_minutes) : bedtime ? add(bedtime.occurred_at, S.settings.first_night_feed_minutes) : null;
  return { wake, naps, open, nap1, nap2, bed, total, bedtime, eligible, active };
}

async function auth() {
  const { data } = await sb.auth.getSession();
  if (data.session?.user) return data.session.user;
  const r = await sb.auth.signInAnonymously();
  if (r.error) throw r.error;
  return r.data.user;
}

async function refreshPushState() {
  S.pushPermission = 'Notification' in window ? Notification.permission : 'unsupported';
  if (!S.pushSupported) {
    S.pushEnabled = false;
    return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    S.pushEnabled = !!(await reg.pushManager.getSubscription());
  } catch {
    S.pushEnabled = false;
  }
}

async function load() {
  try {
    S.user = await auth();
    const m = await sb.from('household_members').select('*').eq('user_id', S.user.id).limit(1);
    if (m.error) throw m.error;
    S.member = m.data?.[0] || null;
    if (!S.member) {
      S.house = null; S.events = []; S.settings = null; S.members = [];
      await sub(null);
      await refreshPushState();
      render();
      return;
    }
    const id = S.member.household_id;
    const cut = new Date(Date.now() - 5 * 86400000).toISOString();
    const [h, st, ev, ms] = await Promise.all([
      sb.from('households').select('*').eq('id', id).single(),
      sb.from('sleep_settings').select('*').eq('household_id', id).single(),
      sb.from('sleep_events').select('*').eq('household_id', id).gte('occurred_at', cut).order('occurred_at'),
      sb.from('household_members').select('*').eq('household_id', id).order('joined_at')
    ]);
    for (const r of [h, st, ev, ms]) if (r.error) throw r.error;
    S.house = h.data; S.settings = st.data; S.events = ev.data || []; S.members = ms.data || [];
    await sub(id);
    await refreshPushState();
    render();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<main class="center"><h1>Couldn’t connect</h1><p class="muted">${esc(e.message)}</p><button class="btn" onclick="location.reload()">TRY AGAIN</button></main>`;
  }
}

async function sub(id) {
  if (S.channel) { await sb.removeChannel(S.channel); S.channel = null; }
  if (!id) return;
  S.channel = sb.channel('sync:' + id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sleep_events', filter: `household_id=eq.${id}` }, load)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sleep_settings', filter: `household_id=eq.${id}` }, load)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'household_members', filter: `household_id=eq.${id}` }, load)
    .subscribe();
}

async function create(name) {
  const r = await sb.rpc('create_household', { p_name: 'Our Family', p_display_name: name || 'Parent' });
  if (r.error) throw r.error;
  await load();
}
async function join(code, name) {
  const r = await sb.rpc('join_household', { p_invite_code: code.trim().toUpperCase(), p_display_name: name || 'Parent' });
  if (r.error) throw r.error;
  await load();
}
async function log(type) {
  const r = await sb.from('sleep_events').insert({ household_id: S.member.household_id, event_type: type, occurred_at: new Date().toISOString(), note: S.member.display_name, created_by: S.user.id });
  if (r.error) throw r.error;
  toast('Saved');
  await load();
}
async function del(id) {
  const r = await sb.from('sleep_events').delete().eq('id', id);
  if (r.error) throw r.error;
  toast('Deleted');
  await load();
}
async function edit(id) {
  const e = S.events.find(x => x.id === id), d = new Date(e.occurred_at);
  const local = new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const v = prompt('Edit date/time (YYYY-MM-DDTHH:MM)', local);
  if (!v) return;
  const nd = new Date(v);
  if (Number.isNaN(+nd)) return toast('Invalid time');
  const r = await sb.from('sleep_events').update({ occurred_at: nd.toISOString() }).eq('id', id);
  if (r.error) throw r.error;
  toast('Updated');
  await load();
}
async function setting(k, delta) {
  const min = ['bedtime_feed_gap_minutes', 'nap_warning_minutes'].includes(k) ? 0 : 15;
  const v = Math.max(min, Number(S.settings[k]) + delta);
  const r = await sb.from('sleep_settings').update({ [k]: v, updated_by: S.user.id }).eq('household_id', S.member.household_id);
  if (r.error) throw r.error;
  await load();
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function enablePush() {
  if (!S.pushSupported) throw new Error('Push notifications are not supported on this device.');
  const permission = await Notification.requestPermission();
  S.pushPermission = permission;
  if (permission !== 'granted') throw new Error('Notifications were not allowed.');
  const reg = await navigator.serviceWorker.ready;
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
  }
  const j = subscription.toJSON();
  const r = await sb.from('push_subscriptions').upsert({
    endpoint: subscription.endpoint,
    household_id: S.member.household_id,
    user_id: S.user.id,
    p256dh: j.keys?.p256dh,
    auth: j.keys?.auth,
    device_label: `${navigator.platform || 'Android'} ${navigator.userAgent.includes('Android') ? 'phone' : 'device'}`,
    enabled: true,
    updated_at: new Date().toISOString()
  }, { onConflict: 'endpoint' });
  if (r.error) throw r.error;
  S.pushEnabled = true;
  toast('Alarms enabled');
  render();
}

async function disablePush() {
  if (!S.pushSupported) return;
  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.getSubscription();
  if (subscription) {
    const r = await sb.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
    if (r.error) throw r.error;
    await subscription.unsubscribe();
  }
  S.pushEnabled = false;
  toast('Alarms disabled');
  render();
}

async function testPush() {
  if (!S.pushEnabled) throw new Error('Enable alarms first.');
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Could not verify this phone.');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/sleep-push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ action: 'test' })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Test notification failed.');
  if (!body.sent) throw new Error('No active subscription found for this phone.');
  toast('Test sent');
}

const label = t => ({
  morning_wake: 'Morning wake', nap_start: 'Nap started', nap_end: 'Nap ended', bedtime: 'Bedtime',
  night_wake: 'Night wake', feed_start: 'Feed started', feed_end: 'Feed finished', back_asleep: 'Back asleep'
})[t] || t;

function setup() {
  return `<main class="center"><div class="logo">Zz</div><h1>Baby Sleep Sync</h1><p class="muted">One shared schedule on both phones.</p><div style="width:min(420px,90vw);text-align:left"><label class="inputlabel">YOUR NAME</label><input id="name" class="input" placeholder="Dad or Mom"><div class="btns"><button class="btn" data-a="create">CREATE HOUSEHOLD</button></div><p class="muted" style="text-align:center">or</p><label class="inputlabel">6-CHARACTER INVITE CODE</label><input id="code" class="input" maxlength="6" autocapitalize="characters" placeholder="ABC123"><div class="btns"><button class="btn secondary" data-a="join">JOIN HOUSEHOLD</button></div></div></main>`;
}
function today(c) {
  const cap = S.settings.daytime_sleep_cap_minutes, feedTarget = c.bed ? add(c.bed, -S.settings.bedtime_feed_gap_minutes) : null;
  return `<h1 class="hero">Today</h1><p class="muted">Targets move automatically from the times you actually log.</p><div class="stack"><div class="card"><div class="label">MORNING WAKE</div><div class="big">${fmt(c.wake?.occurred_at)}</div>${!c.wake ? '<div class="btns"><button class="btn" data-log="morning_wake">BABY IS UP</button></div>' : ''}</div><div class="card"><div class="label">NEXT SLEEP TARGET</div><div class="big">${fmt(c.open ? null : (!c.naps[0] ? c.nap1 : !c.naps[1] ? c.nap2 : c.bed))}</div><div class="sub">${c.open ? 'Nap is currently running' : !c.naps[0] ? 'Nap 1' : !c.naps[1] ? 'Nap 2' : 'Bedtime'}</div><div class="btns">${c.open ? '<button class="btn" data-log="nap_end">BABY AWAKE</button>' : '<button class="btn" data-log="nap_start">START NAP</button>'}${c.naps[1]?.end ? '<button class="btn secondary" data-log="bedtime">START NIGHT</button>' : ''}</div></div><div class="grid2"><div class="card"><div class="label">DAY SLEEP</div><div class="big">${dur(c.total)}</div><div class="sub">Cap ${dur(cap)}</div></div><div class="card"><div class="label">FINISH LAST FEED</div><div class="big">${fmt(feedTarget)}</div><div class="sub">${S.settings.bedtime_feed_gap_minutes}m before target bedtime</div></div></div>${c.total >= cap ? '<div class="notice">Daytime sleep has reached the configured cap.</div>' : ''}</div>`;
}
function night(c) {
  const ok = c.eligible && Date.now() >= c.eligible.getTime();
  return `<h1 class="hero">Night</h1><p class="muted">This screen never tells you to wake a sleeping baby.</p><div class="stack"><div class="card"><div class="label">BEDTIME</div><div class="big">${fmt(c.bedtime?.occurred_at)}</div></div><div class="card"><div class="label">NEXT FEED WINDOW</div><div class="big">${fmt(c.eligible)}</div><div class="sub">${c.eligible ? (ok ? 'Window is open' : 'Not open yet') : 'Start Night first'}</div><div class="btns"><button class="btn secondary" data-log="night_wake">BABY AWAKE</button>${c.active ? '<button class="btn" data-log="feed_end">FEED FINISHED</button>' : '<button class="btn" data-log="feed_start">START FEED</button>'}<button class="btn secondary" data-log="back_asleep">BACK ASLEEP</button></div></div></div>`;
}
function history() {
  const rows = [...S.events].sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at)).slice(0, 60);
  return `<h1 class="hero">History</h1><p class="muted">Edit or delete a bad log and both phones recalculate.</p><div class="card">${rows.length ? rows.map(e => `<div class="history"><div class="row"><div><strong>${esc(label(e.event_type))}</strong><span class="muted small">${esc(e.note || 'Parent')}</span></div><div>${long(e.occurred_at)}</div></div><button class="link" data-edit="${e.id}">EDIT TIME</button> <button class="link danger" data-del="${e.id}">DELETE</button></div>`).join('') : '<p class="muted">Nothing logged yet.</p>'}</div>`;
}
function srow(name, k) {
  return `<div class="card setting"><div><strong>${name}</strong><div class="muted">${dur(S.settings[k])}</div></div><button class="step" data-set="${k}" data-d="-15">−</button><button class="step" data-set="${k}" data-d="15">+</button></div>`;
}
function pushCard() {
  const status = !S.pushSupported ? 'Not supported on this device' : S.pushPermission === 'denied' ? 'Blocked in Android settings' : S.pushEnabled ? 'On for this phone' : 'Off for this phone';
  const button = !S.pushSupported || S.pushPermission === 'denied' ? '' : S.pushEnabled
    ? '<button class="btn secondary" data-a="disable-push">DISABLE ALARMS</button><button class="btn" data-a="test-push">TEST NOTIFICATION</button>'
    : '<button class="btn" data-a="enable-push">ENABLE ALARMS</button>';
  return `<h2>Android alarms</h2><div class="card"><div class="label">BACKGROUND NOTIFICATIONS</div><div class="big" style="font-size:24px">${esc(status)}</div><div class="sub">Nap and bedtime reminders can alert even when the app is closed. Night feed-window alerts stay silent by default and never mean you should wake a sleeping baby.</div>${button ? `<div class="btns">${button}</div>` : ''}</div>`;
}
function settings() {
  return `<h1 class="hero">Settings</h1><div class="card"><div class="label">HOUSEHOLD CODE</div><div class="invite">${esc(S.house.invite_code)}</div><div class="sub">${S.members.map(m => esc(m.display_name)).join(' + ')}</div><div class="btns"><button class="btn secondary" data-a="share">SHARE WITH PARTNER</button>${S.install ? '<button class="btn" data-a="install">INSTALL APP</button>' : ''}</div></div>${pushCard()}<h2>Schedule rules</h2><div class="stack">${srow('Wake window 1', 'wake_window_1_minutes')}${srow('Wake window 2', 'wake_window_2_minutes')}${srow('Wake window 3', 'wake_window_3_minutes')}${srow('Daytime sleep cap', 'daytime_sleep_cap_minutes')}${srow('Final feed before bed', 'bedtime_feed_gap_minutes')}${srow('First night feed wait', 'first_night_feed_minutes')}${srow('Later night feed wait', 'later_night_feed_minutes')}</div>`;
}
function tabs() {
  return `<nav class="tabs">${[['today', '◷', 'TODAY'], ['night', '☾', 'NIGHT'], ['history', '≡', 'HISTORY'], ['settings', '⚙', 'SETTINGS']].map(([id, i, n]) => `<button class="tab ${S.tab === id ? 'active' : ''}" data-tab="${id}"><span>${i}</span>${n}</button>`).join('')}</nav>`;
}
function render() {
  if (!S.user) return;
  if (!S.member) { app.innerHTML = setup(); return; }
  const c = calc();
  const body = S.tab === 'today' ? today(c) : S.tab === 'night' ? night(c) : S.tab === 'history' ? history() : settings();
  app.innerHTML = `<div class="shell"><header class="top"><div><div class="eyebrow">BABY SLEEP SYNC</div><div class="title">${esc(S.member.display_name)}</div></div><div class="pill">● SHARED</div></header><main class="page">${body}</main>${tabs()}</div>`;
}
async function run(fn) {
  try { await fn(); } catch (e) { console.error(e); toast(e.message || 'Could not save'); }
}

app.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.tab) { S.tab = b.dataset.tab; render(); }
  else if (b.dataset.log) run(() => log(b.dataset.log));
  else if (b.dataset.a === 'create') run(() => create(document.querySelector('#name')?.value.trim()));
  else if (b.dataset.a === 'join') {
    const code = document.querySelector('#code')?.value || '';
    if (code.trim().length !== 6) return toast('Enter the 6-character code');
    run(() => join(code, document.querySelector('#name')?.value.trim()));
  }
  else if (b.dataset.edit) run(() => edit(b.dataset.edit));
  else if (b.dataset.del && confirm('Delete this entry?')) run(() => del(b.dataset.del));
  else if (b.dataset.set) run(() => setting(b.dataset.set, Number(b.dataset.d)));
  else if (b.dataset.a === 'share') {
    const text = `Join our Baby Sleep Sync household with code ${S.house.invite_code}`;
    navigator.share ? navigator.share({ title: 'Baby Sleep Sync', text, url: location.origin }).catch(() => {}) : navigator.clipboard.writeText(`${text} ${location.origin}`).then(() => toast('Invite copied'));
  }
  else if (b.dataset.a === 'install' && S.install) {
    S.install.prompt();
    S.install.userChoice.finally(() => { S.install = null; render(); });
  }
  else if (b.dataset.a === 'enable-push') run(enablePush);
  else if (b.dataset.a === 'disable-push') run(disablePush);
  else if (b.dataset.a === 'test-push') run(testPush);
});

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.install = e; render(); });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(console.error));
setInterval(() => S.member && ['today', 'night'].includes(S.tab) && render(), 30000);
load();