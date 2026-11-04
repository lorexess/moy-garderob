'use strict';
// Аккаунт и синхронизация через Firebase по REST (без SDK). Пароли хранит Google;
// правило Firestore пускает каждого только в users/<его id>. Ключ API не секретный — он лишь называет проект.
const FB_KEY = 'AIzaSyC5Bz6n_DSY-ZUesPSHGXScfLnMLZloQeU';
const FB_PATH = 'projects/moy-garderob/databases/(default)/documents';
const FB_DOCS = 'https://firestore.googleapis.com/v1/' + FB_PATH;
const EPOCH = '1970-01-01T00:00:00Z';
const AUTH_ERR = {
  EMAIL_EXISTS: 'Такая почта уже зарегистрирована — нажмите «Войти»',
  EMAIL_NOT_FOUND: 'Неверная почта или пароль', INVALID_PASSWORD: 'Неверная почта или пароль', INVALID_LOGIN_CREDENTIALS: 'Неверная почта или пароль',
  INVALID_EMAIL: 'Проверьте адрес почты', MISSING_EMAIL: 'Впишите почту', MISSING_PASSWORD: 'Введите пароль',
  WEAK_PASSWORD: 'Пароль должен быть не короче 6 символов', TOO_MANY_ATTEMPTS_TRY_LATER: 'Слишком много попыток, попробуйте позже',
  USER_DISABLED: 'Аккаунт отключён', OPERATION_NOT_ALLOWED: 'В Firebase не включён вход по почте (Authentication → Email/Password)',
};

let session = null; // { uid, email, idToken, refreshToken, exp }; читается в syncStart — ls объявлен в app.js
const sync = { busy: false, last: 0, error: '' };
const outbox = () => ls.get('outbox', null) || {}; // «items/<id>» → время изменения; ждёт отправки
let flushTimer;

async function call(url, opts) {
  let r;
  try { r = await fetch(url, opts); } catch { throw new Error('Нет связи с сервером'); }
  const j = await r.json().catch(() => ({}));
  return { r, j };
}

// ---------- Вход ----------
async function authCall(method, body) {
  const { r, j } = await call(`https://identitytoolkit.googleapis.com/v1/accounts:${method}?key=${FB_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) { const code = ((j.error && j.error.message) || '').split(/[ :]/)[0]; throw new Error(AUTH_ERR[code] || 'Ошибка входа: ' + (code || r.status)); }
  return j;
}
function setSession(j, email) {
  session = {
    uid: j.localId || j.user_id, email: j.email || email,
    idToken: j.idToken || j.id_token, refreshToken: j.refreshToken || j.refresh_token,
    exp: Date.now() + ((+(j.expiresIn || j.expires_in) || 3600) - 60) * 1000,
  };
  ls.set('session', session);
}
async function token() {
  if (Date.now() < session.exp) return session.idToken;
  const { r, j } = await call(`https://securetoken.googleapis.com/v1/token?key=${FB_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(session.refreshToken),
  });
  if (r.status === 400) { signOutLocal(); throw new Error('Вход устарел — войдите снова'); }
  if (!r.ok) throw new Error('Нет связи с сервером');
  setSession(j, session.email);
  return session.idToken;
}
async function fsPost(path, body) {
  const { r, j } = await call(FB_DOCS + path, {
    method: 'POST', headers: { Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (r.status === 403) throw new Error('Облако не пускает: проверьте правило доступа в Firestore (Rules)');
  if (!r.ok) throw new Error('Ошибка облака: ' + ((j.error && j.error.message) || r.status));
  return j;
}

// ---------- Синхронизация ----------
function syncTrack(keys, at) {
  if (!session || !keys.length) return;
  const ob = outbox();
  keys.forEach(k => { ob[k] = at; });
  ls.set('outbox', ob);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => syncNow(), 1500); // после того как вызывающий код обновит S
}
const listOf = store => (store === 'items' ? S.items : S.outfits);

async function push() {
  const snap = outbox(), base = `${FB_PATH}/users/${session.uid}/`;
  let batch = [], size = 0;
  const send = async () => {
    if (!batch.length) return;
    await fsPost(':commit', { writes: batch.map(b => b.w) });
    const ob = outbox();
    batch.forEach(b => { if (ob[b.k] === snap[b.k]) delete ob[b.k]; }); // не трогаем то, что изменили за время отправки
    ls.set('outbox', ob);
    batch = []; size = 0;
  };
  for (const k of Object.keys(snap)) {
    const [store, id] = k.split('/');
    const obj = listOf(store).find(x => x.id === id);
    const doc = obj || { id, deleted: true, updatedAt: snap[k] };
    const data = JSON.stringify(doc);
    if (data.length > 1e6) { sync.error = `«${obj.name}»: фото слишком большое для облака`; continue; } // предел документа Firestore — 1 МБ
    if (size + data.length > 4e6) await send();
    batch.push({ k, w: {
      update: { name: base + k, fields: { data: { stringValue: data }, updatedAt: { integerValue: String(doc.updatedAt || snap[k]) } } },
      updateTransforms: [{ fieldPath: 'serverTime', setToServerValue: 'REQUEST_TIME' }], // время сервера: часы устройств могут врать
    } });
    size += data.length;
  }
  await send();
}

// Забирает изменения с сервера после прошлого раза. Возвращает «ключ → время» всего, что пришло.
// shortcut: первый вход качает весь гардероб одним ответом; при тысячах вещей с фото стоит разбить на страницы.
async function pull() {
  const since = ls.get('pullSince', EPOCH), ob = outbox(), seen = {};
  let max = Date.parse(since);
  const put = { items: [], outfits: [] }, del = { items: [], outfits: [] };
  for (const store of ['items', 'outfits']) {
    const rows = await fsPost(`/users/${session.uid}:runQuery`, { structuredQuery: {
      from: [{ collectionId: store }],
      where: { fieldFilter: { field: { fieldPath: 'serverTime' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: since } } },
    } });
    for (const row of rows) {
      const f = row.document && row.document.fields;
      if (!f || !f.data || !f.serverTime) continue;
      max = Math.max(max, Date.parse(f.serverTime.timestampValue.replace(/(\.\d{3})\d+/, '$1')));
      let d; try { d = JSON.parse(f.data.stringValue); } catch { continue; }
      if (!d || typeof d.id !== 'string') continue;
      const k = store + '/' + d.id, at = +d.updatedAt || 0;
      seen[k] = at;
      if (ob[k]) continue; // своё неотправленное изменение новее
      const local = listOf(store).find(x => x.id === d.id);
      if (local && (local.updatedAt || 0) >= at) continue;
      if (d.deleted) { if (local) del[store].push(d.id); continue; }
      const clean = store === 'items' ? sanitizeItem(d) : sanitizeOutfit(d);
      if (clean) put[store].push(clean);
    }
  }
  const n = put.items.length + put.outfits.length + del.items.length + del.outfits.length;
  if (n) {
    await dbTx((st, so) => {
      put.items.forEach(i => st.put(i)); del.items.forEach(id => st.delete(id));
      put.outfits.forEach(o => so.put(o)); del.outfits.forEach(id => so.delete(id));
    });
    for (const store of ['items', 'outfits']) {
      const list = listOf(store).filter(x => !del[store].includes(x.id));
      put[store].forEach(x => { const i = list.findIndex(y => y.id === x.id); if (i >= 0) list[i] = x; else list.push(x); });
      if (store === 'items') S.items = list; else S.outfits = list;
    }
    render();
  }
  ls.set('pullSince', new Date(max).toISOString());
  return seen;
}

async function syncNow(manual) {
  if (!session || sync.busy) return;
  sync.busy = true; sync.error = ''; renderAccount();
  try {
    await push(); await pull();
    sync.last = Date.now(); ls.set('syncLast', sync.last);
    if (manual) toast(sync.error || 'Синхронизировано');
  } catch (e) { sync.error = e.message; if (manual) toast(e.message); }
  sync.busy = false; renderAccount();
  if (session && !sync.error && Object.keys(outbox()).length) setTimeout(() => syncNow(), 500); // изменили во время отправки
}

function syncStart() {
  session = ls.get('session', null);
  sync.last = ls.get('syncLast', 0);
  renderAccount();
  const soon = () => { if (session && document.visibilityState === 'visible' && Date.now() - sync.last > 20000) syncNow(); };
  window.addEventListener('online', () => syncNow());
  document.addEventListener('visibilitychange', soon);
  setInterval(soon, 120000);
  syncNow();
}

// ---------- Кнопки аккаунта ----------
async function accSignIn(signup) {
  const email = $('#accEmail').value.trim(), password = $('#accPass').value;
  if (!email || !password) { toast('Впишите почту и пароль'); return; }
  try { setSession(await authCall(signup ? 'signUp' : 'signInWithPassword', { email, password, returnSecureToken: true }), email); }
  catch (e) { toast(e.message); return; }
  // Сначала забираем облако, потом отправляем то, чего там нет или что здесь новее — ничего не теряется.
  ls.set('outbox', {}); ls.set('pullSince', EPOCH);
  sync.busy = true; renderAccount();
  try {
    const seen = await pull(), ob = {}, now = Date.now();
    for (const store of ['items', 'outfits']) listOf(store).forEach(x => {
      const k = store + '/' + x.id;
      if (seen[k] === undefined || seen[k] < (x.updatedAt || 0)) ob[k] = x.updatedAt || now;
    });
    ls.set('outbox', ob);
    toast(signup ? 'Аккаунт создан, вещи отправляются в облако' : 'Вы вошли');
  } catch (e) { sync.error = e.message; toast(e.message); }
  sync.busy = false;
  syncNow();
}
async function accReset() {
  const email = $('#accEmail').value.trim();
  if (!email) { toast('Впишите почту, на неё придёт письмо'); return; }
  try { await authCall('sendOobCode', { requestType: 'PASSWORD_RESET', email }); toast('Письмо для смены пароля отправлено на ' + email); }
  catch (e) { toast(e.message); }
}
function signOutLocal() {
  session = null; ls.set('session', null); ls.set('outbox', {}); ls.set('pullSince', EPOCH);
  renderAccount();
}
async function accSignOut() {
  const pending = Object.keys(outbox()).length;
  if (pending && !confirm(`${pending} изменений ещё не отправлены в облако (нет связи). Выйти без отправки? На этом устройстве они останутся.`)) return;
  const wipe = confirm('Удалить вещи и образы с этого устройства?\n«ОК» — удалить (в аккаунте они останутся)\n«Отмена» — оставить');
  signOutLocal();
  if (wipe) {
    try { await dbTx((st, so) => { st.clear(); so.clear(); }); } catch (err) { saveErr(err); return; }
    S.items = []; S.outfits = []; render();
  }
  toast('Вы вышли из аккаунта');
}

function renderAccount() {
  const box = $('#accountBox');
  if (!box) return;
  if (!session) {
    if (box.dataset.state === 'out') return; // не стираем то, что человек вписывает
    box.dataset.state = 'out';
    box.innerHTML = `<p class="muted">Войдите, чтобы вещи и образы были одинаковыми на телефоне и компьютере. Без входа всё хранится только на этом устройстве.</p>
      <form id="accForm" novalidate>
        <label class="field"><span>Почта</span><input id="accEmail" type="email" inputmode="email" autocomplete="username" required></label>
        <label class="field"><span>Пароль</span><input id="accPass" type="password" autocomplete="current-password" minlength="6" required></label>
        <div class="row"><button type="submit" class="btn">Войти</button><button type="button" class="btn ghost" data-act="acc-up">Регистрация</button></div>
        <button type="button" class="link" data-act="acc-reset">Забыли пароль?</button>
      </form>`;
    $('#accForm').onsubmit = e => { e.preventDefault(); accSignIn(false); };
    return;
  }
  box.dataset.state = 'in';
  const pending = Object.keys(outbox()).length;
  const state = sync.busy ? '🔄 Синхронизация…'
    : sync.error ? '⚠️ ' + sync.error
    : pending ? `⏳ Ждут отправки: ${pending}`
    : sync.last ? '✅ Всё синхронизировано · ' + new Date(sync.last).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
  box.innerHTML = `<p>Вы вошли как <b>${esc(session.email || '')}</b></p>
    <p class="muted small" aria-live="polite">${esc(state)}</p>
    <div class="row"><button type="button" class="btn" data-act="acc-sync" ${sync.busy ? 'disabled' : ''}>Синхронизировать</button><button type="button" class="btn ghost" data-act="acc-out">Выйти</button></div>`;
}
