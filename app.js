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
  pushSupported: '