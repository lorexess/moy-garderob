'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим — переживём */ } },
};

// ================= IndexedDB =================
let dbp;
const db = () => dbp || (dbp = new Promise((res, rej) => {
  const r = indexedDB.open('wardrobe', 1);
  r.onupgradeneeded = () => { r.result.createObjectStore('items', { keyPath: 'id' }); r.result.createObjectStore('outfits', { keyPath: 'id' }); };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
}));
// Одна транзакция на все записи: либо всё сохранилось, либо ничего.
const dbTx = (fn) => db().then(d => new Promise((res, rej) => {
  const t = d.transaction(['items', 'outfits'], 'readwrite');
  fn(t.objectStore('items'), t.objectStore('outfits'));
  t.oncomplete = () => res();
  t.onerror = t.onabort = () => rej(t.error);
}));
// Изменения пользователя: ставим время и отдаём в очередь отправки в аккаунт. Данные из облака пишутся через dbTx.
function dbWrite(fn) {
  const keys = [], now = Date.now();
  const wrap = (store, name) => ({
    put: o => { o.updatedAt = now; keys.push(name + '/' + o.id); return store.put(o); },
    delete: id => { keys.push(name + '/' + id); return store.delete(id); },
    clear: () => { (name === 'items' ? S.items : S.outfits).forEach(x => keys.push(name + '/' + x.id)); return store.clear(); },
  });
  return dbTx((st, so) => fn(wrap(st, 'items'), wrap(so, 'outfits'))).then(() => syncTrack(keys, now));
}
const dbAll = store => db().then(d => new Promise((res, rej) => {
  const r = d.transaction(store).objectStore(store).getAll();
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
}));
const saveErr = e => toast('Не удалось сохранить: ' + (e && e.name === 'QuotaExceededError' ? 'в браузере не хватает места' : 'ошибка хранилища'));

// ================= Состояние =================
const nowSeason = () => { const m = new Date().getMonth(); return m < 2 || m === 11 ? 'winter' : m < 5 ? 'spring' : m < 8 ? 'summer' : 'autumn'; };
const S = {
  items: [], outfits: [], view: 'items',
  season: ls.get('season', nowSeason()),
  rates: ls.get('rates', null), manual: ls.get('manualRates', {}),
  filter: { cat: '', season: '' }, build: null,
};
if (!SEASONS[S.season]) S.season = nowSeason();
const rate = code => rateFrom(S.rates, S.manual, code);
const byId = id => S.items.find(i => i.id === id);
const itemsOf = o => o.itemIds.map(byId).filter(Boolean);
const thumb = i => (i.photo ? `<img src="${i.photo}" alt="" loading="lazy">` : `<span class="sw" style="background:${i.color}"></span>`);
const scoreCls = p => (p < 50 ? 'bad' : p < 75 ? 'mid' : 'good');

// ================= Тема =================
const THEME_COLOR = { summer: '#ffcf5a', autumn: '#b4532a', winter: '#dcecf8', spring: '#f7c6da' };
function setSeason(s) {
  S.season = s; ls.set('season', s);
  document.body.dataset.season = s;
  $$('.bg').forEach(b => b.classList.toggle('on', b.classList.contains('bg-' + s)));
  $$('#seasonSwitch button').forEach(b => b.setAttribute('aria-checked', b.dataset.s === s));
  $$('input[name="bSeason"]').forEach(i => { i.checked = i.value === s; });
  $('meta[name="theme-color"]').content = THEME_COLOR[s];
  if (S.view === 'build') renderBuild();
}
function makeParticles() {
  const r = Math.random;
  const conf = [
    ['leaves', 14, 'leaf', ['#c8642c', '#d9a520', '#8a2b2b', '#b4532a', '#e08a2e'], [14, 26], [12, 22]],
    ['snow', 34, 'flake', null, [3, 8], [9, 18]],
    ['petals', 16, 'petal', ['#f7a8c8', '#c9b3ef', '#ffc2d6', '#f48fb1'], [10, 18], [11, 20]],
  ];
  for (const [id, n, cls, colors, [s0, s1], [d0, d1]] of conf) {
    const box = $('#' + id);
    for (let k = 0; k < n; k++) {
      const e = document.createElement('i');
      const big = cls === 'flake' && k % 4 === 0;
      e.className = cls + (big ? ' big' : '');
      if (big) e.textContent = '❄';
      const size = big ? 14 + r() * 10 : s0 + r() * (s1 - s0);
      const dur = d0 + r() * (d1 - d0);
      e.style.cssText = `--x:${r() * 100}%;--s:${size}px;--d:${dur}s;--delay:${-r() * dur}s;--sway:${(r() - 0.5) * 140}px`;
      if (colors) e.style.setProperty('--c', colors[k % colors.length]);
      box.append(e);
    }
  }
}

// ================= Навигация и отрисовка =================
function showView(v) {
  S.view = v;
  $$('.view').forEach(e => { e.hidden = e.id !== 'view-' + v; });
  $$('.tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.view === v ? 'page' : 'false'));
  render();
  window.scrollTo(0, 0);
}
function render() {
  ({ items: renderItems, outfits: renderOutfits, build: renderBuild, stats: renderStats, more: renderAccount }[S.view] || (() => {}))();
  renderRateInfo();
}
const emptyHtml = (t, withExample) => `<div class="empty"><p>${t}</p>${withExample ? '<button type="button" class="btn" data-act="example">Заполнить примером</button>' : ''}</div>`;

// shortcut: фото рисуются из data URL заново при каждой отрисовке; при сотнях вещей стоит перейти на кэш blob-URL.
function renderItems() {
  const f = S.filter;
  const list = S.items.filter(i => (!f.cat || i.category === f.cat) && (!f.season || i.seasons.includes(f.season))).sort((a, b) => b.created - a.created);
  $('#itemCount').textContent = S.items.length ? `${list.length} из ${S.items.length}` : '';
  $('#itemGrid').innerHTML = list.map(i => `
    <article class="card">
      <button type="button" class="card-hit" data-act="edit-item" data-id="${esc(i.id)}" aria-label="Изменить: ${esc(i.name)}"></button>
      <span class="ph">${i.photo ? `<img src="${i.photo}" alt="" loading="lazy">` : '<span class="noimg">👕</span>'}<span class="dot" style="background:${i.color}"></span></span>
      <span class="body">
        ${i.url ? `<a class="name link-name" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">${esc(i.name)} <span aria-hidden="true">↗</span></a>` : `<span class="name">${esc(i.name)}</span>`}
        <span class="price">${esc(priceLabel(i, rate))}</span>
        <span class="meta">${esc(perWearLabel(i, rate))}</span>
        <span class="meta">${i.seasons.map(s => SEASONS[s].icon).join(' ') || 'без сезона'} · надевал: ${i.worn}</span>
      </span>
    </article>`).join('') || emptyHtml(S.items.length ? 'Под фильтр ничего не подошло.' : 'Гардероб пока пуст. Добавьте первую вещь или заполните примером.', !S.items.length);
}

function renderOutfits() {
  const list = [...S.outfits].sort((a, b) => b.fav - a.fav || b.created - a.created);
  $('#outfitGrid').innerHTML = list.map(o => {
    const items = itemsOf(o), res = scoreOutfit(items, o.season), sum = sumRub(items, rate);
    return `<article class="card">
      <button type="button" class="ocover" data-act="open-outfit" data-id="${esc(o.id)}" aria-label="Открыть образ ${esc(o.name)}">
        <span class="collage n${Math.min(items.length, 4)}">${items.slice(0, 4).map(thumb).join('')}</span>
      </button>
      <button type="button" class="heart" data-act="fav" data-id="${esc(o.id)}" aria-pressed="${o.fav}" aria-label="Избранное">${o.fav ? '♥' : '♡'}</button>
      <span class="body">
        <span class="name">${SEASONS[o.season].icon} ${esc(o.name)}</span>
        <span class="row"><span class="pill ${scoreCls(res.score)}">${res.score}%</span><span class="price">${items.length ? rubLabel(sum.value, sum.approx) : '—'}</span></span>
      </span>
    </article>`;
  }).join('') || emptyHtml(S.items.length ? 'Образов пока нет. Нажмите «Новый образ» или попробуйте «Подбор».' : 'Сначала добавьте вещи — из них соберутся образы.', !S.items.length);
}

function scoreHtml(res, items) {
  const s = sumRub(items, rate);
  return `<div class="score ${scoreCls(res.score)}"><b>${res.score}%</b>
      <div><div><strong>сочетание вещей</strong></div><div class="muted">Стоимость: ${items.length ? rubLabel(s.value, s.approx) : '—'}</div></div></div>
    <div class="meter"><span style="width:${res.score}%"></span></div>
    <ul class="notes">${res.notes.map(n => `<li class="${n.ok ? 'ok' : 'no'}">${esc(n.t)}</li>`).join('')}</ul>`;
}

function renderBuild() {
  const out = $('#buildOut'), b = S.build;
  if (!S.items.length) { out.innerHTML = emptyHtml('В гардеробе пока нет вещей.', true); return; }
  if (!b || b.season !== S.season) { out.innerHTML = ''; return; }
  if (!b.list.length) { out.innerHTML = emptyHtml('Не хватает вещей: нужен верх и низ или платье.'); return; }
  const cur = b.list[b.i];
  out.innerHTML = `<div class="panel build-card">
    <div class="bar"><h3>Вариант ${b.i + 1} из ${b.list.length}</h3></div>
    <div class="build-items">${cur.items.map(i => `<figure>${thumb(i)}<figcaption>${esc(i.name)}</figcaption></figure>`).join('')}</div>
    <div class="score-box">${scoreHtml(scoreOutfit(cur.items, S.season), cur.items)}</div>
    <div class="row">
      <button type="button" class="btn ghost" data-act="build-next" ${b.list.length < 2 ? 'disabled' : ''}>🔄 Ещё вариант</button>
      <button type="button" class="btn" data-act="build-save">Сохранить как образ</button>
    </div></div>`;
}

function renderStats() {
  const items = S.items;
  if (!items.length) { $('#statsOut').innerHTML = emptyHtml('Статистика появится, когда в гардеробе будут вещи.', true); return; }
  const total = sumRub(items, rate);
  const per = SEASON_ORDER.map(s => ({ s, ...sumRub(items.filter(i => i.seasons.includes(s)), rate) }));
  const max = Math.max(1, ...per.map(p => p.value));
  const top = items.reduce((a, b) => (b.worn > a.worn ? b : a));
  const never = items.filter(i => !i.worn);
  const wears = items.reduce((n, i) => n + i.worn, 0);
  $('#statsOut').innerHTML = `
    <div class="tiles">
      <div class="tile"><span class="muted">Всего вещей</span><b>${items.length}</b></div>
      <div class="tile"><span class="muted">Потрачено</span><b>${rubLabel(total.value, total.approx)}</b></div>
      <div class="tile"><span class="muted">Всего носок</span><b>${wears}</b></div>
    </div>
    <div class="panel"><h3>Потрачено по сезонам</h3>
      <p class="muted small">Вещь на несколько сезонов учитывается в каждом из них.</p>
      <div class="bars">${per.map(p => `<div><div class="lbl"><span>${SEASONS[p.s].icon} ${SEASONS[p.s].name}</span><span>${rubLabel(p.value, p.approx)}</span></div>
        <div class="track"><span style="width:${(p.value / max) * 100}%"></span></div></div>`).join('')}</div></div>
    <div class="panel"><h3>Самая надеваемая вещь</h3>
      ${top.worn ? `<div class="mini">${thumb(top)}<div><strong>${esc(top.name)}</strong><div class="muted">надевали ${top.worn} раз · ${esc(perWearLabel(top, rate))}</div></div></div>` : '<p class="muted">Пока ничего не надевали. Нажмите «Надел сегодня» в образе.</p>'}
    </div>
    <div class="panel"><h3>Ни разу не надевал (${never.length})</h3>
      ${never.length ? `<div class="never">${never.map(i => `<span>${thumb(i)}${esc(i.name)}</span>`).join('')}</div>` : '<p class="muted">Таких нет — все вещи в деле!</p>'}
    </div>`;
}

// ================= Курсы ЦБ =================
const RATES_URL = 'https://www.cbr-xml-daily.ru/daily_json.js';
function renderRateInfo() {
  const t = S.rates ? `Курс ЦБ на ${new Date(S.rates.Date).toLocaleDateString('ru-RU')}` : 'Курсы ЦБ ещё не загружены';
  $$('.rate-info').forEach(e => { e.textContent = t; });
}
async function updateRates(force) {
  const today = new Date().toDateString();
  if (!force && S.rates && ls.get('ratesDay') === today) return;
  try {
    const r = await fetch(RATES_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    if (!j || !j.Valute || !j.Date) throw new Error('format');
    const Valute = {};
    for (const [k, v] of Object.entries(j.Valute)) if (/^[A-Z]{3}$/.test(k) && v.Value > 0 && v.Nominal > 0) Valute[k] = { Name: String(v.Name), Nominal: +v.Nominal, Value: +v.Value };
    S.rates = { Date: j.Date, Valute };
    ls.set('rates', S.rates); ls.set('ratesDay', today);
    if (force) toast('Курс обновлён');
  } catch {
    if (force) toast(S.rates ? 'Нет связи — используются сохранённые курсы' : 'Не удалось загрузить курсы. Курс можно ввести вручную в карточке вещи.');
  }
  render();
  if ($('#itemDlg').open) updateCurUI();
}

// ================= Форма вещи =================
let editing = null, formPhoto = '', formCur = 'RUB';
const curName = c => (S.rates && S.rates.Valute[c] && S.rates.Valute[c].Name) || (CUR_FALLBACK[c] || {}).name || c;

function openItem(it) {
  editing = it || null;
  const d = it || { name: '', price: '', currency: ls.get('lastCur', 'RUB'), category: 'top', seasons: [S.season], style: 'casual', color: '#888888', worn: 0, photo: '' };
  $('#itemTitle').textContent = it ? 'Изменить вещь' : 'Новая вещь';
  $('#fName').value = d.name;
  $('#fUrl').value = d.url || '';
  $('#fPrice').value = d.price || '';
  formCur = d.currency;
  $('#fCat').value = d.category;
  $$('#fSeasons input').forEach(i => { i.checked = d.seasons.includes(i.value); });
  $('#fStyle').value = d.style;
  $('#fColor').value = d.color;
  $('#fWorn').value = d.worn;
  formPhoto = d.photo;
  photoOrig = photoCut = null; $('#bgRow').hidden = true;
  showPhoto();
  $('#colorHint').textContent = 'Главный цвет определится по фото. Нажмите на кружок, чтобы поправить.';
  $('#delItem').hidden = !it;
  closeCur(); updateCurUI();
  $('#itemDlg').showModal();
}
function showPhoto() {
  $('#photoPreview').hidden = !formPhoto;
  if (formPhoto) $('#photoPreview').src = formPhoto;
  $('#photoEmpty').hidden = !!formPhoto;
  $('#photoEmpty').textContent = 'Нет фото';
}
function updateCurUI() {
  $('#curBtn').textContent = `${curSym(formCur)} ${formCur === curSym(formCur) ? '' : formCur} ▾`;
  const cbr = formCur === 'RUB' || (S.rates && S.rates.Valute[formCur]);
  const box = $('#manualBox');
  box.hidden = !!cbr;
  if (!cbr) {
    $('#manualLbl').textContent = `Курс вручную: сколько рублей стоит 1 ${formCur}${S.rates ? '' : ' (курсы ЦБ ещё не загружены)'}`;
    if (document.activeElement !== $('#fManual')) $('#fManual').value = S.manual[formCur] || '';
  }
  const price = parseFloat($('#fPrice').value) || 0, r = rate(formCur);
  $('#rubPreview').textContent = formCur === 'RUB' || !price ? '' : r ? `≈ ${fmtNum(roundTens(price * r))} ₽ по курсу ${cbr ? 'ЦБ' : 'вручную'}` : 'Укажите курс, чтобы пересчитать в рубли';
}
function openCur() { $('#curPop').hidden = false; $('#curBtn').setAttribute('aria-expanded', 'true'); $('#curSearch').value = ''; renderCurList(); $('#curSearch').focus(); }
function closeCur() { $('#curPop').hidden = true; $('#curBtn').setAttribute('aria-expanded', 'false'); }
function curMatches() {
  const q = $('#curSearch').value.trim().toLowerCase();
  const ok = c => !q || `${c} ${curName(c)} ${curSym(c)}`.toLowerCase().includes(q);
  const others = S.rates ? Object.keys(S.rates.Valute).filter(c => !POPULAR.includes(c)).sort((a, b) => curName(a).localeCompare(curName(b), 'ru')) : [];
  return [POPULAR.filter(ok), others.filter(ok)];
}
function renderCurList() {
  const [p, o] = curMatches();
  const row = c => `<button type="button" role="option" aria-selected="${c === formCur}" data-cur="${c}"><b>${esc(curSym(c))}</b><span>${esc(curName(c))} <span class="muted">${c}</span></span></button>`;
  $('#curList').innerHTML =
    (p.length ? `<div class="grp">Популярные</div>${p.map(row).join('')}` : '') +
    (o.length ? `<div class="grp">Все валюты ЦБ</div>${o.map(row).join('')}` : '') +
    (!p.length && !o.length ? '<div class="grp">Ничего не найдено</div>' : '') +
    (S.rates ? '' : '<div class="grp">Полный список появится после загрузки курсов ЦБ</div>');
}
function pickCur(c) { formCur = c; ls.set('lastCur', c); closeCur(); updateCurUI(); $('#curBtn').focus(); }

function loadImg(file) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(u); res(img); };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('bad image')); };
    img.src = u;
  });
}
async function processPhoto(file) {
  const img = await loadImg(file);
  const w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, 800 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); // прозрачный PNG → белый фон в JPEG
  g.drawImage(img, 0, 0, c.width, c.height);
  return { photo: c.toDataURL('image/jpeg', 0.82), color: colorOf(img), canvas: c };
}
// Главный цвет по уменьшенной копии; прозрачные пиксели (вырезанный фон) не считаются.
function colorOf(src) {
  const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
  const k = 64 / Math.max(w, h), sw = Math.max(1, Math.round(w * k)), sh = Math.max(1, Math.round(h * k));
  const sc = document.createElement('canvas'); sc.width = sw; sc.height = sh;
  const sg = sc.getContext('2d', { willReadFrequently: true });
  sg.drawImage(src, 0, 0, sw, sh);
  return dominantColor(sg.getImageData(0, 0, sw, sh).data, sw, sh);
}

// ================= Удаление фона: нейросеть U²-Net-p прямо на устройстве, без серверов =================
let bgSession;
function bgModel() {
  if (!bgSession) bgSession = (async () => {
    if (!window.ort) await new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'ai/ort.wasm.min.js'; s.onload = res; s.onerror = rej; document.head.append(s);
    });
    ort.env.wasm.numThreads = 1; // несколько потоков требуют особых заголовков сервера, которых нет на GitHub Pages
    ort.env.wasm.wasmPaths = new URL('ai/', location.href).href;
    return ort.InferenceSession.create('ai/u2netp.onnx');
  })().catch(e => { bgSession = null; throw e; });
  return bgSession;
}
// Вход: canvas с фото. Выход: canvas того же размера, где фон прозрачный.
async function removeBg(src) {
  const N = 320, n = N * N, session = await bgModel();
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, N, N);
  const px = g.getImageData(0, 0, N, N).data, input = new Float32Array(3 * n);
  let max = 1;
  for (let i = 0; i < px.length; i += 4) max = Math.max(max, px[i], px[i + 1], px[i + 2]);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225]; // нормировка, на которой обучали U²-Net
  for (let i = 0; i < n; i++) for (let ch = 0; ch < 3; ch++) input[ch * n + i] = (px[i * 4 + ch] / max - mean[ch]) / std[ch];
  const res = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, N, N]) });
  const pred = res[session.outputNames[0]].data;
  let lo = Infinity, hi = -Infinity;
  for (const v of pred) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const mask = g.createImageData(N, N);
  for (let i = 0; i < n; i++) mask.data[i * 4 + 3] = 255 * (pred[i] - lo) / (hi - lo || 1);
  g.putImageData(mask, 0, 0);
  const out = document.createElement('canvas'); out.width = src.width; out.height = src.height;
  const o = out.getContext('2d');
  o.drawImage(c, 0, 0, out.width, out.height); // маска, растянутая до размера фото
  o.globalCompositeOperation = 'source-in';
  o.drawImage(src, 0, 0);
  return out;
}

let photoOrig = null, photoCut = null; // оба варианта нового фото, пока форма открыта
async function applyBgChoice() {
  if (!photoOrig) return;
  if ($('#fNoBg').checked && !photoCut) {
    $('#photoEmpty').hidden = false; $('#photoEmpty').textContent = 'Убираю фон…'; $('#photoPreview').hidden = true;
    try {
      const cut = await removeBg(photoOrig.canvas);
      photoCut = { photo: cut.toDataURL('image/webp', 0.85), color: colorOf(cut) }; // webp хранит прозрачность и меньше png
    } catch {
      toast('Не удалось убрать фон — оставлено исходное фото');
      $('#fNoBg').checked = false;
    }
  }
  const r = $('#fNoBg').checked && photoCut ? photoCut : photoOrig;
  formPhoto = r.photo;
  $('#fColor').value = r.color;
  showPhoto();
}
async function onPhoto(e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  $('#photoEmpty').hidden = false; $('#photoEmpty').textContent = 'Обработка…';
  try {
    photoOrig = await processPhoto(f); photoCut = null;
    $('#bgRow').hidden = false;
    $('#colorHint').textContent = 'Цвет определён по фото. Не тот? Нажмите на кружок и поправьте.';
    await applyBgChoice();
  } catch {
    toast('Не удалось открыть фото. Попробуйте JPEG или PNG.');
    showPhoto();
  }
}
async function saveItem(e) {
  e.preventDefault();
  const name = $('#fName').value.trim();
  if (!name) { $('#fName').focus(); toast('Введите название вещи'); return; }
  const it = sanitizeItem({
    ...(editing || { id: uid(), created: Date.now() }),
    name, url: $('#fUrl').value, photo: formPhoto, price: parseFloat($('#fPrice').value) || 0, currency: formCur,
    category: $('#fCat').value, seasons: $$('#fSeasons input:checked').map(i => i.value),
    style: $('#fStyle').value, color: $('#fColor').value, worn: parseInt($('#fWorn').value, 10) || 0,
  });
  try { await dbWrite(st => st.put(it)); } catch (err) { saveErr(err); return; }
  const idx = S.items.findIndex(i => i.id === it.id);
  if (idx >= 0) S.items[idx] = it; else S.items.push(it);
  ls.set('lastCur', formCur);
  $('#itemDlg').close();
  render();
  toast(editing ? 'Сохранено' : 'Вещь добавлена');
}
async function deleteItem() {
  if (!editing || !confirm(`Удалить «${editing.name}»? Вещь пропадёт и из образов.`)) return;
  const id = editing.id;
  const touched = S.outfits.filter(o => o.itemIds.includes(id)).map(o => ({ ...o, itemIds: o.itemIds.filter(x => x !== id) }));
  try { await dbWrite((st, so) => { st.delete(id); touched.forEach(o => so.put(o)); }); } catch (err) { saveErr(err); return; }
  S.items = S.items.filter(i => i.id !== id);
  S.outfits = S.outfits.map(o => touched.find(t => t.id === o.id) || o);
  $('#itemDlg').close();
  render();
  toast('Вещь удалена');
}

// ================= Форма образа =================
let od = null;
const CAT_ORDER = Object.keys(CATEGORIES);
function openOutfit(o) {
  od = o ? { ...o, itemIds: [...o.itemIds], layout: structuredClone(o.layout || {}) } : { id: uid(), name: '', season: S.season, itemIds: [], fav: false, layout: {}, created: Date.now() };
  od.isNew = !S.outfits.some(x => x.id === od.id);
  $('#outfitTitle').textContent = od.isNew ? 'Новый образ' : 'Образ';
  $('#oName').value = od.name;
  $$('input[name="oSeason"]').forEach(i => { i.checked = i.value === od.season; });
  $('#oDel').hidden = od.isNew;
  setSeason(od.season);
  $('#outfitDlg').showModal(); // до отрисовки: раскладке нужен реальный размер доски
  renderPick(); updateFav(); updateOutfitScore();
}
function renderPick() {
  const list = [...S.items].sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category));
  $('#oPick').innerHTML = list.map(i => `<button type="button" data-id="${esc(i.id)}" aria-pressed="${od.itemIds.includes(i.id)}" class="${i.seasons.includes(od.season) ? '' : 'off'}" title="${esc(CATEGORIES[i.category])}">${thumb(i)}<small>${esc(i.name)}</small></button>`).join('')
    || '<p class="muted">В гардеробе пока нет вещей.</p>';
}
function updateFav() { const b = $('#oFav'); b.textContent = od.fav ? '♥' : '♡'; b.setAttribute('aria-pressed', od.fav); b.style.color = od.fav ? '#d1365f' : ''; }
// Раскладка «как на человеке»: по центру верх → низ → обувь, аксессуары колонкой сбоку.
function boardHtml(items) {
  if (!items.length) return '';
  const by = c => items.filter(i => i.category === c);
  const rows = [[[...by('top'), ...by('dress'), ...by('outer')], 3], [by('bottom'), 3], [by('shoes'), 1.4]].filter(r => r[0].length);
  const acc = by('accessory');
  const cell = i => `<figure data-id="${esc(i.id)}">${i.photo ? `<img src="${i.photo}" alt="${esc(i.name)}" draggable="false">` : `<span class="sw" style="background:${i.color}" title="${esc(i.name)}"></span>`}<span class="grip" aria-hidden="true">⤡</span></figure>`;
  return `<div class="board" role="img" aria-label="Образ целиком">
    <div class="board-main">${rows.map(([list, w]) => `<div class="board-row" style="flex:${w};--n:${list.length}">${list.map(cell).join('')}</div>`).join('')}</div>
    ${acc.length ? `<div class="board-side">${acc.map(cell).join('')}</div>` : ''}</div>
    <div class="board-tools"><span class="muted small">Перетаскивайте вещи, кружок в углу меняет размер</span><button type="button" class="link" id="boardReset">Сбросить раскладку</button></div>`;
}
// Сдвиг хранится в долях размера доски, поэтому раскладка одинакова на телефоне и компьютере.
function placeFig(f, board) {
  const L = od.layout[f.dataset.id];
  if (!L) return;
  f.style.translate = `${L.x * board.clientWidth}px ${L.y * board.clientHeight}px`;
  f.style.scale = L.s;
  f.style.zIndex = L.z;
}
function onBoardDown(e) {
  const f = e.target.closest('.board figure');
  if (!f || e.button > 0) return;
  e.preventDefault();
  const board = f.closest('.board'), id = f.dataset.id;
  const L = od.layout[id] || (od.layout[id] = { x: 0, y: 0, s: 1, z: 0 });
  L.z = Math.max(0, ...Object.values(od.layout).map(l => l.z)) + 1;
  const resize = e.target.classList.contains('grip');
  const st = { x: e.clientX, y: e.clientY, lx: L.x, ly: L.y, s: L.s }, base = f.offsetWidth;
  f.setPointerCapture(e.pointerId);
  f.onpointermove = m => {
    const dx = m.clientX - st.x, dy = m.clientY - st.y;
    // масштаб от центра: угол уходит на base/2 по каждой оси за единицу масштаба
    if (resize) L.s = clampNum(st.s + (dx + dy) / base, 0.3, 3, 1);
    else { L.x = clampNum(st.lx + dx / board.clientWidth, -2, 2, 0); L.y = clampNum(st.ly + dy / board.clientHeight, -2, 2, 0); }
    placeFig(f, board);
  };
  f.onpointerup = f.onpointercancel = () => { f.onpointermove = null; };
  placeFig(f, board);
}
function updateOutfitScore() {
  const items = od.itemIds.map(byId).filter(Boolean);
  $('#oBoard').innerHTML = boardHtml(items);
  const board = $('#oBoard .board');
  if (board) $$('figure', board).forEach(f => placeFig(f, board));
  $('#oCount').textContent = `· выбрано ${items.length}`;
  $('#oScore').innerHTML = scoreHtml(scoreOutfit(items, od.season), items);
}
async function persistOutfit() {
  od.name = $('#oName').value.trim() || `Образ ${S.outfits.length + (od.isNew ? 1 : 0)}`;
  const o = sanitizeOutfit(od);
  await dbWrite((st, so) => so.put(o));
  const idx = S.outfits.findIndex(x => x.id === o.id);
  if (idx >= 0) S.outfits[idx] = o; else S.outfits.push(o);
  od.isNew = false; $('#oDel').hidden = false;
  return o;
}
async function saveOutfit(e) {
  e.preventDefault();
  if (!od.itemIds.length) { toast('Отметьте хотя бы одну вещь'); return; }
  try { await persistOutfit(); } catch (err) { saveErr(err); return; }
  $('#outfitDlg').close(); render(); toast('Образ сохранён');
}
async function wearToday() {
  const items = od.itemIds.map(byId).filter(Boolean);
  if (!items.length) { toast('Отметьте вещи в образе'); return; }
  const upd = items.map(i => ({ ...i, worn: i.worn + 1 }));
  try {
    await persistOutfit();
    await dbWrite(st => upd.forEach(i => st.put(i)));
  } catch (err) { saveErr(err); return; }
  upd.forEach(u => { S.items[S.items.findIndex(i => i.id === u.id)] = u; });
  render(); toast(`+1 к ${upd.length} ${upd.length === 1 ? 'вещи' : 'вещам'}. Хорошего дня!`);
}
async function deleteOutfit() {
  if (!confirm(`Удалить образ «${od.name || 'без названия'}»? Вещи останутся.`)) return;
  try { await dbWrite((st, so) => so.delete(od.id)); } catch (err) { saveErr(err); return; }
  S.outfits = S.outfits.filter(o => o.id !== od.id);
  $('#outfitDlg').close(); render();
}

// ================= Пример =================
const poly = pts => g => { g.moveTo(...pts[0]); pts.slice(1).forEach(p => g.lineTo(...p)); g.closePath(); };
const SHAPES = {
  top: poly([[130, 80], [170, 66], [200, 92], [230, 66], [270, 80], [340, 140], [300, 186], [275, 165], [275, 335], [125, 335], [125, 165], [100, 186], [60, 140]]),
  bottom: poly([[130, 55], [270, 55], [292, 345], [215, 345], [200, 150], [185, 345], [108, 345]]),
  dress: poly([[165, 55], [235, 55], [245, 150], [315, 345], [85, 345], [155, 150]]),
  outer: poly([[140, 55], [260, 55], [335, 110], [350, 300], [305, 300], [290, 165], [290, 350], [110, 350], [110, 165], [95, 300], [50, 300], [65, 110]]),
  shoes: g => { g.roundRect(45, 200, 170, 62, [46, 30, 10, 10]); g.roundRect(185, 236, 170, 62, [46, 30, 10, 10]); },
  accessory: g => { g.roundRect(105, 165, 190, 150, 26); },
};
function placeholder(kind, color) {
  const c = document.createElement('canvas'); c.width = c.height = 400;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 400, 400);
  g.beginPath(); SHAPES[kind](g);
  g.fillStyle = color; g.fill();
  g.lineWidth = 5; g.lineJoin = 'round'; g.strokeStyle = 'rgba(0,0,0,.28)'; g.stroke();
  if (kind === 'accessory') { g.beginPath(); g.arc(200, 165, 55, Math.PI, 0); g.lineWidth = 12; g.strokeStyle = color; g.stroke(); }
  if (kind === 'outer') { g.fillStyle = 'rgba(0,0,0,.35)'; [130, 190, 250].forEach(y => { g.beginPath(); g.arc(200, y, 7, 0, 7); g.fill(); }); }
  return c.toDataURL('image/jpeg', 0.85);
}
async function fillExample() {
  if (S.items.length && !confirm('Добавить примеры к вашим вещам?')) return;
  const A = ['winter', 'spring', 'summer', 'autumn'];
  const ex = [
    ['Белая футболка', 1490, 'RUB', 'top', ['spring', 'summer'], 'casual', '#f4f4f2', 14],
    ['Синие джинсы', 45, 'USD', 'bottom', ['spring', 'summer', 'autumn'], 'casual', '#3b5b8c', 22],
    ['Кремовый свитер', 59, 'EUR', 'top', ['autumn', 'winter'], 'casual', '#e8dcc4', 9],
    ['Бордовое платье', 320, 'CNY', 'dress', ['spring', 'summer', 'autumn'], 'festive', '#8b1e3f', 2],
    ['Шерстяное пальто', 12990, 'RUB', 'outer', ['autumn', 'winter'], 'classic', '#6b4f3a', 18],
    ['Белые кеды', 79, 'USD', 'shoes', ['spring', 'summer', 'autumn'], 'casual', '#fafafa', 30],
    ['Зимние ботинки', 8990, 'RUB', 'shoes', ['autumn', 'winter'], 'casual', '#2b2b2b', 11],
    ['Жёлтая сумка', 199, 'CNY', 'accessory', ['spring', 'summer'], 'casual', '#f2c230', 0],
    ['Чёрные брюки', 3990, 'RUB', 'bottom', A, 'classic', '#1f1f1f', 0],
  ];
  const now = Date.now();
  const items = ex.map(([name, price, currency, category, seasons, style, color, worn], k) =>
    sanitizeItem({ id: uid() + k, name, price, currency, category, seasons, style, color, worn, photo: placeholder(category, color), created: now - k * 1000 }));
  const pickIds = (...idx) => idx.map(k => items[k].id);
  const outfits = [
    { id: uid() + 'a', name: 'Осенняя прогулка', season: 'autumn', itemIds: pickIds(2, 1, 4, 6), fav: true, created: now },
    { id: uid() + 'b', name: 'Летний день', season: 'summer', itemIds: pickIds(0, 1, 5, 7), fav: false, created: now - 1 },
  ].map(sanitizeOutfit);
  try { await dbWrite((st, so) => { items.forEach(i => st.put(i)); outfits.forEach(o => so.put(o)); }); } catch (err) { saveErr(err); return; }
  S.items.push(...items); S.outfits.push(...outfits);
  showView('items');
  toast('Пример добавлен: 9 вещей и 2 образа');
}

// ================= Уведомления =================
let toastTimer;
function toast(t) {
  const e = $('#toast');
  e.textContent = t;
  if (e.showPopover) { try { e.hidePopover(); } catch { /* уже скрыт */ } e.showPopover(); } // поверх открытого диалога
  else e.classList.add('fallback', 'show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (e.hidePopover) { try { e.hidePopover(); } catch { /* уже скрыт */ } } e.classList.remove('show'); }, 2800);
}

// ================= События =================
const ACTIONS = {
  view: t => showView(t.dataset.view),
  season: t => setSeason(t.dataset.s),
  'add-item': () => openItem(null),
  'edit-item': t => openItem(byId(t.dataset.id)),
  'new-outfit': () => openOutfit(null),
  'open-outfit': t => openOutfit(S.outfits.find(o => o.id === t.dataset.id)),
  fav: async t => {
    const o = S.outfits.find(x => x.id === t.dataset.id);
    const upd = { ...o, fav: !o.fav };
    try { await dbWrite((st, so) => so.put(upd)); } catch (err) { saveErr(err); return; }
    S.outfits[S.outfits.indexOf(o)] = upd; renderOutfits();
  },
  close: t => t.closest('dialog').close(),
  example: fillExample,
  rates: () => updateRates(true),
  'acc-up': () => accSignIn(true),
  'acc-reset': accReset,
  'acc-sync': () => syncNow(true),
  'acc-out': accSignOut,
  build: () => { S.build = { season: S.season, list: buildOutfits(S.items, S.season), i: 0 }; renderBuild(); },
  'build-next': () => { S.build.i = (S.build.i + 1) % S.build.list.length; renderBuild(); },
  'build-save': () => {
    const cur = S.build.list[S.build.i];
    openOutfit({ id: uid(), name: `Подборка: ${SEASONS[S.season].name.toLowerCase()}`, season: S.season, itemIds: cur.items.map(i => i.id), fav: false, created: Date.now() });
  },
};

function init() {
  const opts = (o) => Object.entries(o).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('#filterCat').insertAdjacentHTML('beforeend', opts(CATEGORIES));
  $('#filterSeason').insertAdjacentHTML('beforeend', SEASON_ORDER.map(s => `<option value="${s}">${SEASONS[s].icon} ${SEASONS[s].name}</option>`).join(''));
  $('#fCat').innerHTML = opts(CATEGORIES);
  $('#fStyle').innerHTML = opts(STYLES);
  const chips = (name, type) => SEASON_ORDER.map(s => `<label class="chip"><input type="${type}" name="${name}" value="${s}"><span>${SEASONS[s].icon} ${SEASONS[s].name}</span></label>`).join('');
  $('#fSeasons').innerHTML = chips('fSeasons', 'checkbox');
  $('#oSeason').innerHTML = chips('oSeason', 'radio');
  $('#bSeason').innerHTML = chips('bSeason', 'radio');
  $('#seasonSwitch').innerHTML = SEASON_ORDER.map(s => `<button type="button" role="radio" data-act="season" data-s="${s}"><span aria-hidden="true">${SEASONS[s].icon}</span>${SEASONS[s].name}</button>`).join('');

  document.addEventListener('click', e => {
    if (!e.target.closest('.price-row')) closeCur();
    const t = e.target.closest('[data-act]');
    if (t && ACTIONS[t.dataset.act]) ACTIONS[t.dataset.act](t, e);
  });
  $('#filterCat').onchange = e => { S.filter.cat = e.target.value; renderItems(); };
  $('#filterSeason').onchange = e => { S.filter.season = e.target.value; renderItems(); };
  $('#bSeason').onchange = e => setSeason(e.target.value);

  // форма вещи
  $('#itemForm').onsubmit = saveItem;
  $('#delItem').onclick = deleteItem;
  $('#photoFile').onchange = onPhoto;
  $('#photoCam').onchange = onPhoto;
  $('#fNoBg').onchange = applyBgChoice;
  $('#fPrice').oninput = updateCurUI;
  $('#fManual').oninput = e => {
    const v = parseFloat(e.target.value);
    if (v > 0) S.manual[formCur] = v; else delete S.manual[formCur];
    ls.set('manualRates', S.manual); updateCurUI();
  };
  $('#curBtn').onclick = () => ($('#curPop').hidden ? openCur() : closeCur());
  $('#curSearch').oninput = renderCurList;
  $('#curSearch').onkeydown = e => {
    if (e.key === 'Escape') { e.preventDefault(); closeCur(); $('#curBtn').focus(); }
    if (e.key === 'Enter') { e.preventDefault(); const [p, o] = curMatches(); const c = p[0] || o[0]; if (c) pickCur(c); }
  };
  $('#curList').onclick = e => { const b = e.target.closest('[data-cur]'); if (b) pickCur(b.dataset.cur); };

  // форма образа
  $('#outfitForm').onsubmit = saveOutfit;
  $('#oPick').onclick = e => {
    const b = e.target.closest('[data-id]'); if (!b) return;
    const id = b.dataset.id, on = od.itemIds.includes(id);
    od.itemIds = on ? od.itemIds.filter(x => x !== id) : [...od.itemIds, id];
    b.setAttribute('aria-pressed', !on); updateOutfitScore();
  };
  $('#oSeason').onchange = e => { od.season = e.target.value; setSeason(od.season); renderPick(); updateOutfitScore(); };
  $('#oBoard').onpointerdown = onBoardDown;
  $('#oBoard').onclick = e => { if (e.target.id === 'boardReset') { od.layout = {}; updateOutfitScore(); } };
  $('#oFav').onclick =() => { od.fav = !od.fav; updateFav(); };
  $('#oWear').onclick = wearToday;
  $('#oDel').onclick = deleteOutfit;

  makeParticles();
  setSeason(S.season);
  showView('items');
  Promise.all([dbAll('items'), dbAll('outfits')])
    .then(([items, outfits]) => { S.items = items; S.outfits = outfits; render(); syncStart(); })
    .catch(() => toast('Браузер не дал доступ к хранилищу — данные не сохранятся'));
  updateRates(false);
  // Установка как приложение и работа без сети (только с настоящего сайта, не из файла)
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  // Просим браузер не стирать вещи при нехватке места
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}
init();
