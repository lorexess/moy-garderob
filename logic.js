'use strict';
// Чистые функции без DOM: справочники, цвета, процент сочетания, деньги, проверка данных из копии.

const SEASONS = {
  winter: { name: 'Зима', gen: 'зимы', icon: '❄️' },
  spring: { name: 'Весна', gen: 'весны', icon: '🌸' },
  summer: { name: 'Лето', gen: 'лета', icon: '☀️' },
  autumn: { name: 'Осень', gen: 'осени', icon: '🍂' },
};
const SEASON_ORDER = ['winter', 'spring', 'summer', 'autumn'];
const CATEGORIES = { top: 'Верх', bottom: 'Низ', dress: 'Платье / комбинезон', outer: 'Верхняя одежда', shoes: 'Обувь', accessory: 'Аксессуар' };
const STYLES = { casual: 'Повседневный', sport: 'Спортивный', classic: 'Классический', festive: 'Нарядный' };
const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);

// ---------- Цвета ----------
const hexToRgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

function hexToHsl(hex) {
  const [r, g, b] = hexToRgb(hex).map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s, l };
}

// Нейтральные: чёрный, белый, серый, бежевый, коричневый, джинсовый синий.
function isNeutral(hex) {
  const { h, s, l } = hexToHsl(hex);
  if (s < 0.15 || l < 0.12 || l > 0.92) return true;
  if (h >= 15 && h <= 50 && s <= 0.5 && l >= 0.6) return true;
  if (h <= 45 && l <= 0.45 && s <= 0.7) return true;
  if (h >= 195 && h <= 235 && s >= 0.15 && s <= 0.6 && l >= 0.2 && l <= 0.6) return true;
  return false;
}

const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
// Близкие на круге или противоположные.
const huesMatch = (a, b) => { const d = hueDist(a, b); return d <= 45 || d >= 150; };

// Сколько «несвязанных» групп среди ярких цветов.
function colorGroups(hues) {
  const p = hues.map((_, i) => i);
  const f = i => (p[i] === i ? i : (p[i] = f(p[i])));
  hues.forEach((a, i) => hues.forEach((b, j) => { if (j > i && huesMatch(a, b)) p[f(i)] = f(j); }));
  return new Set(hues.map((_, i) => f(i))).size;
}

// Самый частый цвет, не считая фона (фон = частые цвета по краю картинки).
function dominantColor(px, w, h) {
  const near = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 60;
  const key = i => (px[i] >> 5) << 6 | (px[i + 1] >> 5) << 3 | px[i + 2] >> 5;
  const add = (m, k, c) => { const b = m.get(k) || [0, 0, 0, 0]; b[0] += c[0]; b[1] += c[1]; b[2] += c[2]; b[3]++; m.set(k, b); };
  const border = new Map(); let bn = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x > 1 && y > 1 && x < w - 2 && y < h - 2) continue;
    const i = (y * w + x) * 4;
    if (px[i + 3] < 128) continue;
    add(border, key(i), [px[i], px[i + 1], px[i + 2]]); bn++;
  }
  const bg = [...border.values()].filter(b => b[3] >= bn * 0.08).map(b => [b[0] / b[3], b[1] / b[3], b[2] / b[3]]);
  const pick = skipBg => {
    const m = new Map(); let n = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue;
      const c = [px[i], px[i + 1], px[i + 2]];
      if (skipBg && bg.some(b => near(b, c))) continue;
      add(m, key(i), c); n++;
    }
    let best = null;
    for (const b of m.values()) if (!best || b[3] > best[3]) best = b;
    return { best, n };
  };
  let r = pick(true);
  if (!r.best || r.n < w * h * 0.03) r = pick(false); // вещь сливается с фоном — берём всё
  if (!r.best) return '#888888';
  const b = r.best;
  return rgbToHex(b[0] / b[3], b[1] / b[3], b[2] / b[3]);
}

// ---------- Процент сочетания ----------
const STYLE_COMPAT = { 'casual|sport': 0.7, 'casual|classic': 0.7, 'casual|festive': 0.4, 'classic|festive': 0.75, 'classic|sport': 0.3, 'festive|sport': 0 };
const styleCompat = (a, b) => (a === b ? 1 : STYLE_COMPAT[[a, b].sort().join('|')] ?? 0.5);

function scoreOutfit(items, season) {
  if (!items.length) return { score: 0, parts: { color: 0, season: 0, style: 0, full: 0 }, notes: [{ t: 'Отметьте вещи для образа', ok: false }] };
  const bad = [], good = [];

  // 1. Цвета — до 40
  const hues = items.filter(i => !isNeutral(i.color)).map(i => hexToHsl(i.color).h);
  const groups = colorGroups(hues);
  let color;
  if (!hues.length) { color = 40; good.push('Спокойные базовые цвета — сочетаются со всем'); }
  else if (groups === 1) { color = 40; good.push(hues.length > 1 ? 'Цвета отлично дополняют друг друга' : 'Яркий акцент на спокойной базе'); }
  else if (groups === 2) { color = 32; good.push('Два разных ярких цвета — смело, но допустимо'); }
  else { color = Math.max(0, 40 - 14 * (groups - 1)); bad.push('Слишком много ярких цветов, которые спорят друг с другом'); }

  // 2. Сезон — до 25
  const gen = SEASONS[season].gen;
  const misfit = items.filter(i => !i.seasons.includes(season));
  const seasonPts = 25 * (items.length - misfit.length) / items.length;
  misfit.forEach(i => bad.push(i.category === 'shoes' ? `Обувь не подходит для ${gen}` : i.category === 'outer' ? `Верхняя одежда не подходит для ${gen}` : `«${i.name}» не подходит для ${gen}`));
  if (!misfit.length) good.push(`Все вещи подходят для ${gen}`);

  // 3. Стиль — до 20
  const styles = [...new Set(items.map(i => i.style))];
  let m = 1;
  styles.forEach((a, i) => styles.forEach((b, j) => { if (j > i) m = Math.min(m, styleCompat(a, b)); }));
  const stylePts = 20 * m;
  if (styles.length === 1) good.push('Все вещи в одном стиле');
  else if (m === 0) bad.push('Спортивные вещи не сочетаются с нарядными');
  else if (m < 0.5) bad.push('Стили вещей плохо сочетаются');

  // 4. Полнота — до 15
  const has = c => items.some(i => i.category === c);
  const body = has('dress') || (has('top') && has('bottom')) ? 10 : has('top') || has('bottom') ? 5 : 0;
  const full = body + (has('shoes') ? 5 : 0);
  if (!has('dress')) {
    if (!has('top') && !has('bottom')) bad.push('Не хватает верха и низа (или платья)');
    else if (!has('top')) bad.push('Не хватает верха');
    else if (!has('bottom')) bad.push('Не хватает низа');
  }
  if (!has('shoes')) bad.push('Не хватает обуви');
  if (full === 15) good.push('Образ собран полностью');

  const notes = [...new Set(bad)].map(t => ({ t, ok: false })).concat(good.map(t => ({ t, ok: true }))).slice(0, 3);
  return { score: Math.round(color + seasonPts + stylePts + full), parts: { color, season: seasonPts, style: stylePts, full }, notes };
}

// Лучшие образы для сезона: по одному лучшему на каждую пару «основа + обувь», чтобы варианты заметно отличались.
function buildOutfits(all, season, limit = 40) {
  const pool = cat => all.filter(i => i.category === cat)
    .sort((a, b) => b.seasons.includes(season) - a.seasons.includes(season)).slice(0, 6);
  const [tops, bottoms, dresses, shoes, outer, acc] = ['top', 'bottom', 'dress', 'shoes', 'outer', 'accessory'].map(pool);
  const bases = [...dresses.map(d => [d]), ...tops.flatMap(t => bottoms.map(b => [t, b]))];
  const res = [];
  for (const base of bases) for (const sh of shoes.length ? shoes : [null]) for (const o of [null, ...outer]) for (const a of [null, ...acc]) {
    const items = [...base, sh, o, a].filter(Boolean);
    res.push({ key: base.map(i => i.id).join('+') + '/' + (sh ? sh.id : ''), items, score: scoreOutfit(items, season).score });
  }
  res.sort((x, y) => y.score - x.score || y.items.length - x.items.length);
  const seen = new Set();
  return res.filter(r => !seen.has(r.key) && seen.add(r.key)).slice(0, limit);
}

// ---------- Деньги ----------
const POPULAR = ['RUB', 'USD', 'EUR', 'CNY', 'KZT', 'TRY', 'AED', 'BYN'];
const CUR_FALLBACK = {
  RUB: { name: 'Российский рубль', sym: '₽' }, USD: { name: 'Доллар США', sym: '$' }, EUR: { name: 'Евро', sym: '€' },
  CNY: { name: 'Китайский юань', sym: '¥' }, KZT: { name: 'Казахстанский тенге', sym: '₸' }, TRY: { name: 'Турецкая лира', sym: '₺' },
  AED: { name: 'Дирхам ОАЭ', sym: 'AED' }, BYN: { name: 'Белорусский рубль', sym: 'Br' },
};
const curSym = code => (CUR_FALLBACK[code] || {}).sym || code;

// Курс ЦБ за 1 единицу (Value дан за Nominal единиц), иначе ручной курс.
function rateFrom(rates, manual, code) {
  if (code === 'RUB') return 1;
  const v = rates && rates.Valute && rates.Valute[code];
  if (v && v.Value > 0 && v.Nominal > 0) return v.Value / v.Nominal;
  const m = manual && +manual[code];
  return m > 0 ? m : null;
}
const itemRub = (item, rateFn) => { const r = rateFn(item.currency); return r == null ? null : item.price * r; };
const fmtNum = (n, dec = 0) => n.toLocaleString('ru-RU', { maximumFractionDigits: dec });
const roundTens = x => Math.round(x / 10) * 10;

function priceLabel(item, rateFn) {
  const ownPrice = fmtNum(item.price, 2) + '\u00a0' + curSym(item.currency);
  if (item.currency === 'RUB') return ownPrice;
  const rub = itemRub(item, rateFn);
  return rub == null ? ownPrice : ownPrice + ' ≈ ' + fmtNum(roundTens(rub)) + '\u00a0₽';
}
function sumRub(items, rateFn) {
  let value = 0, approx = false, missing = 0;
  for (const i of items) {
    const r = itemRub(i, rateFn);
    if (r == null) { missing++; continue; }
    value += r;
    if (i.currency !== 'RUB') approx = true;
  }
  return { value, approx: approx || missing > 0, missing };
}
const rubLabel = (value, approx) => (approx ? '≈\u00a0' : '') + fmtNum(approx ? roundTens(value) : value) + '\u00a0₽';
function perWearLabel(item, rateFn) {
  if (!item.worn) return 'Ещё не надевали';
  const r = itemRub(item, rateFn);
  if (r == null) return '';
  const v = r / item.worn;
  return '1 раз надеть ≈ ' + fmtNum(item.currency === 'RUB' ? Math.round(v) : roundTens(v)) + '\u00a0₽';
}

// ---------- Проверка данных из файла копии ----------
const PHOTO_RE = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;
function sanitizeItem(x) {
  if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !x.id) return null;
  const num = v => (Number.isFinite(+v) && +v >= 0 ? +v : 0);
  return {
    id: x.id.slice(0, 64),
    name: String(x.name ?? '').trim().slice(0, 100) || 'Без названия',
    photo: typeof x.photo === 'string' && PHOTO_RE.test(x.photo) ? x.photo : '',
    price: num(x.price),
    currency: /^[A-Z]{3}$/.test(x.currency) ? x.currency : 'RUB',
    category: own(CATEGORIES, x.category) ? x.category : 'top',
    seasons: Array.isArray(x.seasons) ? [...new Set(x.seasons.filter(s => own(SEASONS, s)))] : [],
    style: own(STYLES, x.style) ? x.style : 'casual',
    color: /^#[0-9a-f]{6}$/i.test(x.color) ? x.color.toLowerCase() : '#888888',
    worn: Math.floor(num(x.worn)),
    created: num(x.created) || Date.now(),
    updatedAt: num(x.updatedAt),
  };
}
// Раскладка картинки образа: сдвиг (в долях размера доски), масштаб и порядок слоёв для каждой вещи.
const clampNum = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
function sanitizeLayout(l, itemIds) {
  if (!l || typeof l !== 'object') return {};
  return Object.fromEntries(itemIds.filter(id => own(l, id) && l[id] && typeof l[id] === 'object').map(id => {
    const v = l[id];
    return [id, { x: clampNum(v.x, -2, 2, 0), y: clampNum(v.y, -2, 2, 0), s: clampNum(v.s, 0.3, 3, 1), z: Math.round(clampNum(v.z, 0, 1e6, 0)) }];
  }));
}
function sanitizeOutfit(x) {
  if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !x.id) return null;
  const itemIds = Array.isArray(x.itemIds) ? [...new Set(x.itemIds.filter(i => typeof i === 'string'))] : [];
  return {
    layout: sanitizeLayout(x.layout, itemIds),
    id: x.id.slice(0, 64),
    name: String(x.name ?? '').trim().slice(0, 80) || 'Образ',
    season: own(SEASONS, x.season) ? x.season : 'summer',
    itemIds,
    fav: !!x.fav,
    created: Number.isFinite(+x.created) ? +x.created : Date.now(),
    updatedAt: Number.isFinite(+x.updatedAt) && +x.updatedAt > 0 ? +x.updatedAt : 0,
  };
}
