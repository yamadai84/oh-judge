// ===== バトル ジャッジシステム 共通ロジック =====
import { FIREBASE_CONFIG } from './config.js?v=7';

const QS = new URLSearchParams(location.search);
export const DEMO = QS.has('demo') || !FIREBASE_CONFIG.projectId;

// ---------- 小物 ----------
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const clone = o => JSON.parse(JSON.stringify(o));
export const uid = (p = '') => p + Math.random().toString(36).slice(2, 8);

export function toast(msg, isErr = false) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = ''), isErr ? 5000 : 2200);
}

// ---------- 既定値 ----------
export const DEFAULT_SETTINGS = {
  eventName: 'BATTLE EVENT 2026',
  subtitle: '',
  logo: '',
  bg: '',
  bgColor: '#000000',
  red: '#e60023',
  blue: '#0b57a4',
  points: 3,
  mustUseAll: true,
  stage1Name: 'STAGE 1',
  stage2Name: 'STAGE 2',
  stage1Judges: [],
  stage2Judges: [],
  finalJudges: [],
  qualify: 2,
  prelimLabel: '予選',
  showOrg: true,
  barStyle: 'slant',   // slant=斜め / square=四角（and8風）
  bgPreset: 'rope',    // rope / glow / grid / dots / none（背景画像があればそちらが優先）
  font: 'heavy',       // standard / heavy / street / pop
  photoFallback: 'none' // 写真が無いとき：none=何も出さない / initial=頭文字
};

export function emptyEvent() {
  return { settings: clone(DEFAULT_SETTINGS), teams: [], judges: [], matches: [], live: {}, screen: { mode: 'logo', matches: [], league: 'ALL' } };
}

export function normalizeEvent(ev) {
  ev = ev ? clone(ev) : emptyEvent();
  ev.settings = Object.assign(clone(DEFAULT_SETTINGS), ev.settings || {});
  ev.teams ||= []; ev.judges ||= []; ev.matches ||= []; ev.live ||= {};
  ev.screen = Object.assign({ mode: 'logo', matches: [], league: 'ALL' }, ev.screen || {});
  // 管理画面で選んだ内容はまず下書きに入り、「スクリーンに反映」を押したときに screen へコピーされる
  ev.screenDraft = ev.screenDraft ? Object.assign({ mode: 'logo', matches: [], league: 'ALL' }, ev.screenDraft) : clone(ev.screen);
  return ev;
}

// ---------- 対戦表づくり ----------
export function roundRobin(ids) {
  const a = ids.slice();
  if (a.length % 2) a.push(null);
  const n = a.length, rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const x = a[i], y = a[n - 1 - i];
      if (x && y) pairs.push(r % 2 ? [y, x] : [x, y]);
    }
    rounds.push(pairs);
    a.splice(1, 0, a.pop());
  }
  return rounds;
}

export const leaguesOf = ev => [...new Set(ev.teams.map(t => t.league).filter(Boolean))].sort();

// 各リーグの総当たり。リーグを交互にステージ1/2へ振り、同じステージ内でリーグを交互に進める
export function genLeagueMatches(ev) {
  const leagues = leaguesOf(ev);
  const per = leagues.map((L, li) => ({ L, stage: li % 2 + 1, rounds: roundRobin(ev.teams.filter(t => t.league === L).map(t => t.id)), k: 0 }));
  const maxR = Math.max(0, ...per.map(p => p.rounds.length));
  const out = [];
  for (let r = 0; r < maxR; r++) {
    for (const p of per) {
      for (const [red, blue] of p.rounds[r] || []) {
        p.k++;
        out.push(newMatch({ id: `${p.L}-${p.k}`, type: '予選', group: p.L, stage: p.stage, red, blue }));
      }
    }
  }
  return out;
}

const ROUND_NAME = n => n >= 16 ? `TOP${n}` : n === 8 ? 'TOP8' : n === 4 ? 'TOP4' : 'FINAL';
const ROUND_PREFIX = n => n >= 16 ? `R${n}-` : n === 8 ? 'QF' : n === 4 ? 'SF' : 'F';

export function genFinalMatches(ev) {
  const leagues = leaguesOf(ev), q = Math.max(1, +ev.settings.qualify || 2);
  let entrants;
  if (leagues.length === 4 && q === 2) {
    const [A, B, C, D] = leagues;
    entrants = [`${A}1位`, `${B}2位`, `${C}1位`, `${D}2位`, `${B}1位`, `${A}2位`, `${D}1位`, `${C}2位`];
  } else {
    const seeds = [];
    for (let r = 1; r <= q; r++) for (const L of leagues) seeds.push(`${L}${r}位`);
    entrants = [];
    const n = seeds.length;
    for (let i = 0; i < Math.floor(n / 2); i++) entrants.push(seeds[i], seeds[n - 1 - i]);
  }
  const out = [];
  let prev = [];
  let size = entrants.length;
  // 1回戦
  const first = [];
  for (let i = 0; i < entrants.length; i += 2) {
    const id = size === 2 ? 'F' : ROUND_PREFIX(size) + (i / 2 + 1);
    first.push(id);
    out.push(newMatch({ id, type: '本戦', group: ROUND_NAME(size), stage: 1, red: entrants[i], blue: entrants[i + 1] || '' }));
  }
  prev = first; size /= 2;
  while (prev.length > 1) {
    const next = [];
    for (let i = 0; i < prev.length; i += 2) {
      const id = size === 2 ? 'F' : ROUND_PREFIX(size) + (i / 2 + 1);
      next.push(id);
      out.push(newMatch({ id, type: '本戦', group: ROUND_NAME(size), stage: 1, red: `勝者:${prev[i]}`, blue: prev[i + 1] ? `勝者:${prev[i + 1]}` : '' }));
    }
    prev = next; size /= 2;
  }
  return out;
}

export function newMatch(o) {
  return Object.assign({ id: '', type: '予選', group: '', stage: 1, red: '', blue: '', judges: [], status: '未開始', round: 0, extra: 0, redTotal: null, blueTotal: null, winner: '', scores: [], at: null }, o);
}

export function judgesFor(m, ev) {
  if (m.judges && m.judges.length) return m.judges;
  const S = ev.settings;
  if (m.type === '本戦') return S.finalJudges || [];
  return (+m.stage === 2 ? S.stage2Judges : S.stage1Judges) || [];
}

// ---------- 順位・組み合わせの解決 ----------
export function leagueStandings(ev, L) {
  const teams = ev.teams.filter(t => t.league === L);
  const ms = ev.matches.filter(m => m.type === '予選' && m.group === L);
  const rec = new Map(teams.map(t => [t.id, { team: t, w: 0, l: 0, d: 0, pt: 0, played: 0 }]));
  for (const m of ms) {
    if (m.status !== '確定') continue;
    const r = rec.get(m.red), b = rec.get(m.blue);
    if (r) { r.pt += +m.redTotal || 0; r.played++; }
    if (b) { b.pt += +m.blueTotal || 0; b.played++; }
    if (m.winner === 'red') { r && r.w++; b && b.l++; }
    else if (m.winner === 'blue') { b && b.w++; r && r.l++; }
    else { r && r.d++; b && b.d++; }
  }
  // 勝ち数・ポイントが同じチームどうしの「直接対決での勝ち数」（2チームなら直接対決そのもの、3チーム以上なら同率チーム間の成績）
  const all = [...rec.values()];
  const key = r => r.w + '|' + r.pt;
  all.forEach(r => {
    const grp = new Set(all.filter(o => key(o) === key(r)).map(o => o.team.id));
    r.h2h = ms.filter(m => m.status === '確定' && grp.has(m.red) && grp.has(m.blue)
      && ((m.winner === 'red' && m.red === r.team.id) || (m.winner === 'blue' && m.blue === r.team.id))).length;
  });
  const adj = (x, y) => {
    const a = x.team.adjust, b = y.team.adjust;
    const ha = a !== '' && a != null, hb = b !== '' && b != null;
    if (ha && hb) return (+a) - (+b);
    return 0;
  };
  const cmp = (x, y) => (y.w - x.w) || (y.pt - x.pt) || (y.h2h - x.h2h) || adj(x, y);
  const rows = all.sort((x, y) => cmp(x, y) || x.team.name.localeCompare(y.team.name));
  rows.forEach((r, i) => {
    r.rank = i + 1;
    if (i > 0 && cmp(rows[i - 1], r) === 0) { r.rank = rows[i - 1].rank; r.tie = true; rows[i - 1].tie = true; }
  });
  const done = ms.length > 0 && ms.every(m => m.status === '確定');
  return { league: L, rows, done, tie: rows.some(r => r.tie), matches: ms };
}

export function buildView(ev) {
  ev = normalizeEvent(ev);
  const V = { ev, teamById: {}, judgeById: {}, matchById: {}, standings: {}, leagues: leaguesOf(ev) };
  ev.teams.forEach(t => (V.teamById[t.id] = t));
  ev.judges.forEach(j => (V.judgeById[j.id] = j));
  ev.matches.forEach(m => (V.matchById[m.id] = m));
  V.leagues.forEach(L => (V.standings[L] = leagueStandings(ev, L)));
  V.resolve = (ref, depth = 0) => resolveRef(ref, V, depth);
  V.side = (m, c) => V.resolve(m[c]);
  V.judgesOf = m => (m.status === '採点中' && ev.live[m.id] ? ev.live[m.id].judges : judgesFor(m, ev)).map(id => V.judgeById[id] || { id, name: id });
  return V;
}

export function resolveRef(ref, V, depth = 0) {
  ref = String(ref ?? '').trim();
  if (!ref) return { label: '未定' };
  if (V.teamById[ref]) return { team: V.teamById[ref] };
  if (depth > 10) return { label: ref };
  let m = ref.match(/^([A-Za-z])\s*(?:リーグ)?\s*(\d+)\s*位$/);
  if (m) {
    const L = m[1].toUpperCase(), n = +m[2], s = V.standings[L], label = `${L}リーグ ${n}位`;
    const row = s && s.rows.find(r => r.rank === n);
    if (s && s.done && row && !row.tie) return { team: row.team, label };
    return { label };
  }
  m = ref.match(/^(勝者|敗者)\s*[:：]?\s*(.+)$/);
  if (m) {
    const mm = V.matchById[m[2].trim()], label = `${m[2].trim()} ${m[1]}`;
    if (mm && mm.status === '確定' && (mm.winner === 'red' || mm.winner === 'blue')) {
      const side = m[1] === '勝者' ? mm.winner : (mm.winner === 'red' ? 'blue' : 'red');
      const r = resolveRef(mm[side], V, depth + 1);
      if (r.team) return { team: r.team, label };
    }
    return { label };
  }
  const byName = V.ev.teams.find(t => t.name === ref);
  return byName ? { team: byName } : { label: ref };
}

export function groupLabel(m, ev) {
  if (m.type === '予選') return `${ev.settings.prelimLabel || '予選'} ${m.group} LEAGUE`;
  return m.group || '本戦';
}
export const stageName = (m, ev) => (+m.stage === 2 ? ev.settings.stage2Name : ev.settings.stage1Name) || `STAGE ${m.stage}`;
export const refName = r => (r.team ? r.team.name : r.label);

// ---------- 画像 ----------
export function imgSrc(ref, images) {
  ref = String(ref || '').trim();
  if (!ref) return '';
  if (ref.startsWith('img:')) return (images && images[ref.slice(4)]) || '';
  const d = ref.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]+)/);
  if (d) return `https://drive.google.com/thumbnail?id=${d[1]}&sz=w1200`;
  return ref;
}

// 画像ファイルを縮小して data URL に（Firestore の1件1MB制限に収める）
export async function fileToDataUrl(file, { max = 600, alpha = false } = {}) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ng; i.src = url; });
    let s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    for (let tries = 0; tries < 6; tries++) {
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      const g = c.getContext('2d');
      if (!alpha) { g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); }
      g.drawImage(img, 0, 0, c.width, c.height);
      let out = c.toDataURL('image/webp', 0.85);
      if (!out.startsWith('data:image/webp')) out = alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85);
      if (out.length < 900000) return out;
      s *= 0.75;
    }
    throw new Error('画像が大きすぎます');
  } finally { URL.revokeObjectURL(url); }
}

// ---------- 保存先（Firebase / デモ） ----------
export async function openStore() {
  return DEMO ? demoStore() : await firebaseStore();
}

function demoStore() {
  const K = { ev: 'bj_demo_event', img: 'bj_demo_images', sc: 'bj_demo_scores', sec: 'bj_demo_secret' };
  const read = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const write = (k, v) => { localStorage.setItem(k, JSON.stringify(v)); fire(k); };
  const subs = { [K.ev]: [], [K.img]: [], [K.sc]: [] };
  const fire = k => (subs[k] || []).forEach(f => f());
  addEventListener('storage', e => fire(e.key));
  if (!read(K.ev, null)) {
    localStorage.setItem(K.ev, JSON.stringify(sampleEvent()));
    localStorage.setItem(K.sec, JSON.stringify({ adminPass: '', judgePass: '' }));
  }
  const on = (k, f) => { subs[k].push(f); setTimeout(f, 0); };
  return {
    demo: true,
    onEvent(cb) { on(K.ev, () => cb(read(K.ev, null))); },
    onImages(cb) { on(K.img, () => cb(read(K.img, {}))); },
    onScores(cb) { on(K.sc, () => cb(Object.values(read(K.sc, {})))); },
    async exists() { return !!read(K.ev, null); },
    async initialize({ adminPass, judgePass, event }) { write(K.sec, { adminPass, judgePass }); write(K.ev, event); },
    async loginAdmin(pass) { const s = read(K.sec, {}); if (s.adminPass && s.adminPass !== pass) throw new Error('パスワードが違います'); localStorage.setItem('bj_demo_admin', pass); },
    async isAdmin() { const p = read(K.sec, {}).adminPass; return !p || localStorage.getItem('bj_demo_admin') === p; },
    async loginJudge(judge, pass) { const s = read(K.sec, {}); if (s.judgePass && s.judgePass !== pass) throw new Error('パスワードが違います'); },
    async updateEvent(fn) { const ev = normalizeEvent(read(K.ev, null)); const r = fn(ev); write(K.ev, ev); return r; },
    async putImage(id, data) { const m = read(K.img, {}); m[id] = data; write(K.img, m); },
    async delImage(id) { const m = read(K.img, {}); delete m[id]; write(K.img, m); },
    async submitScore(s) {
      const ev = normalizeEvent(read(K.ev, null)), L = ev.live[s.match];
      if (!L || L.round !== s.round || !L.judges.includes(s.judge)) throw new Error('このバトルは採点を受け付けていません');
      const m = read(K.sc, {}); m[`${s.match}__${s.round}__${s.judge}`] = { ...s, at: Date.now() }; write(K.sc, m);
    },
    async getSecret() { return read(K.sec, {}); },
    async setSecret(v) { write(K.sec, Object.assign(read(K.sec, {}), v)); },
    async resetAll() { [K.ev, K.img, K.sc, K.sec].forEach(k => localStorage.removeItem(k)); location.reload(); }
  };
}

async function firebaseStore() {
  const V = '10.12.2';
  const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
  const fs = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);
  const au = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`);
  const app = initializeApp(FIREBASE_CONFIG);
  const db = fs.getFirestore(app);
  const auth = au.getAuth(app);
  await new Promise(ok => { const off = au.onAuthStateChanged(auth, () => { off(); ok(); }); });
  // 匿名ログイン（初回のみ。2回目以降はブラウザに残っている）
  if (!auth.currentUser) await au.signInAnonymously(auth);
  const evRef = fs.doc(db, 'event', 'main');
  const secRef = fs.doc(db, 'secret', 'main');
  const sessRef = () => fs.doc(db, 'sessions', auth.currentUser.uid);
  const denied = e => e && (e.code === 'permission-denied' || /permission/i.test(e.message));
  return {
    demo: false,
    onEvent(cb, onConn) {
      fs.onSnapshot(evRef, { includeMetadataChanges: true }, s => { onConn && onConn(!s.metadata.fromCache); cb(s.exists() ? s.data() : null); }, () => onConn && onConn(false));
    },
    onImages(cb) {
      fs.onSnapshot(fs.collection(db, 'images'), s => { const m = {}; s.forEach(d => (m[d.id] = d.data().data)); cb(m); });
    },
    onScores(cb) {
      fs.onSnapshot(fs.collection(db, 'scores'), s => cb(s.docs.map(d => d.data())), e => console.warn(e));
    },
    async exists() { return (await fs.getDoc(evRef)).exists(); },
    async initialize({ adminPass, judgePass, event }) {
      try { await fs.setDoc(secRef, { adminPass, judgePass }); }
      catch (e) { if (denied(e)) throw new Error('すでに初期設定が済んでいます。管理パスワードでログインしてください'); throw e; }
      await fs.setDoc(sessRef(), { role: 'admin', pass: adminPass });
      await fs.setDoc(evRef, event);
    },
    async loginAdmin(pass) {
      try { await fs.setDoc(sessRef(), { role: 'admin', pass }); }
      catch (e) { if (denied(e)) throw new Error('パスワードが違います'); throw e; }
    },
    async isAdmin() { try { await fs.getDoc(secRef); return true; } catch { return false; } },
    async loginJudge(judge, pass) {
      try { await fs.setDoc(sessRef(), { role: 'judge', pass, judge }); }
      catch (e) { if (denied(e)) throw new Error('パスワードが違います'); throw e; }
    },
    async updateEvent(fn) {
      let r;
      await fs.runTransaction(db, async tx => {
        const s = await tx.get(evRef);
        const ev = normalizeEvent(s.exists() ? s.data() : null);
        r = fn(ev);
        tx.set(evRef, ev);
      });
      return r;
    },
    async putImage(id, data) { await fs.setDoc(fs.doc(db, 'images', id), { data }); },
    async delImage(id) { await fs.deleteDoc(fs.doc(db, 'images', id)); },
    async submitScore(s) {
      try {
        await fs.setDoc(fs.doc(db, 'scores', `${s.match}__${s.round}__${s.judge}`), { ...s, at: fs.serverTimestamp() });
      } catch (e) {
        if (denied(e)) throw new Error('送信できませんでした（採点受付が終わったか、ログインが切れています）');
        throw e;
      }
    },
    async getSecret() { return (await fs.getDoc(secRef)).data() || {}; },
    async setSecret(v) {
      const cur = (await fs.getDoc(secRef)).data() || {};
      const next = Object.assign(cur, v);
      await fs.setDoc(secRef, next);
      if (v.adminPass) await fs.setDoc(sessRef(), { role: 'admin', pass: next.adminPass });
    },
    async resetAll() { throw new Error('Firebase のデータ削除はコンソールから行ってください'); }
  };
}

// ---------- 採点の集計 ----------
export function tally(scores, points) {
  let red = 0, blue = 0;
  scores.forEach(s => { red += +s.red || 0; blue += +s.blue || 0; });
  return { red, blue, winner: red > blue ? 'red' : blue > red ? 'blue' : 'draw' };
}

// ---------- サンプルデータ ----------
export function sampleEvent() {
  const ev = emptyEvent();
  ev.settings.eventName = 'BATTLE EVENT 2026';
  ev.settings.subtitle = 'CREW BATTLE';
  const names = ['FLOW MASTERS', 'NEXT LEVEL', 'KIDS ROCK', 'URBAN SOUL', 'SKY WALKERS', 'BOUNCE CREW', 'FREEZE KINGS', 'GROOVE LAB', 'WINDMILL JR', 'POWER MOVES', 'STREET BEAT', 'NEW WAVE'];
  const orgs = ['スタジオ ノース', 'ダンススクール WEST', 'BREAK LAB', 'スタジオ サウス'];
  ev.teams = names.map((n, i) => ({ id: 't' + (i + 1), name: n, org: orgs[i % 4], photo: '', league: 'ABCD'[Math.floor(i / 3)], adjust: '' }));
  ev.judges = ['JUDGE A', 'JUDGE B', 'JUDGE C', 'JUDGE D', 'JUDGE E', 'JUDGE F'].map((n, i) => ({ id: 'j' + (i + 1), name: n, photo: '' }));
  ev.settings.stage1Judges = ['j1', 'j2', 'j3'];
  ev.settings.stage2Judges = ['j4', 'j5', 'j6'];
  ev.settings.finalJudges = ['j1', 'j2', 'j3', 'j4', 'j5'];
  ev.matches = [...genLeagueMatches(ev), ...genFinalMatches(ev)];
  return ev;
}
