// Самопроверка logic.js. Откройте tests.html в браузере — все строки должны начинаться с ✔.
const results = [];
const check = (name, ok) => results.push((ok ? '✔ ' : '✘ ') + name);
const sp = s => s.replace(/\s/g, ' ');
const it = (o) => Object.assign({ id: Math.random().toString(36), name: 'вещь', price: 0, currency: 'RUB', seasons: ['summer'], style: 'casual', color: '#000000', worn: 0 }, o);

const rates = { Valute: { USD: { Nominal: 1, Value: 91.2 }, KZT: { Nominal: 100, Value: 18.5 } } };
const rf = c => rateFrom(rates, {}, c);
check('Номинал учитывается: 1 KZT = 0.185 ₽', Math.abs(rf('KZT') - 0.185) < 1e-9);
check('Ручной курс, если ЦБ не знает валюту', rateFrom(null, { EUR: 100 }, 'EUR') === 100 && rateFrom(null, {}, 'EUR') === null);
check('«45 $ ≈ 4 100 ₽»', sp(priceLabel(it({ price: 45, currency: 'USD' }), rf)) === '45 $ ≈ 4 100 ₽');
check('Рублёвая цена без ≈', sp(priceLabel(it({ price: 1490 }), rf)) === '1 490 ₽');
const s = sumRub([it({ price: 45, currency: 'USD' }), it({ price: 1000 })], rf);
check('Сумма с валютой — примерная, до десятков', s.approx && sp(rubLabel(s.value, s.approx)) === '≈ 5 100 ₽');
check('Цена за носку', sp(perWearLabel(it({ price: 1000, worn: 4 }), rf)) === '1 раз надеть ≈ 250 ₽');

const perfect = [it({ category: 'top', color: '#ffffff' }), it({ category: 'bottom', color: '#3b5b8c' }), it({ category: 'shoes', color: '#222222' })];
check('Идеальный летний образ = 100%', scoreOutfit(perfect, 'summer').score === 100);
const winter = scoreOutfit(perfect, 'winter');
check('Летняя обувь зимой — объяснение', winter.notes.some(n => n.t === 'Обувь не подходит для зимы'));
const loud = scoreOutfit([it({ category: 'top', color: '#ff0000' }), it({ category: 'bottom', color: '#00cc00' }), it({ category: 'shoes', color: '#2244ff' })], 'summer');
check('Три несвязанных ярких цвета — минус баллы', loud.parts.color < 40 && loud.notes.some(n => n.t.startsWith('Слишком много')));
check('Противоположные цвета сочетаются', scoreOutfit([it({ color: '#ff8800', category: 'top' }), it({ color: '#0066ff', category: 'bottom' })], 'summer').parts.color === 40);
const sf = scoreOutfit([it({ category: 'top', style: 'sport' }), it({ category: 'bottom', style: 'festive' })], 'summer');
check('Спорт + нарядный = 0 за стиль', sf.parts.style === 0);
check('Нейтральные: бежевый, коричневый, джинсовый', ['#e8dcc4', '#6b4f3a', '#3b5b8c'].every(isNeutral) && !isNeutral('#f2c230'));

// 20×20: серый фон, красный квадрат 10×10 в центре
const px = new Uint8ClampedArray(20 * 20 * 4);
for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
  const i = (y * 20 + x) * 4, red = x >= 5 && x < 15 && y >= 5 && y < 15;
  px.set(red ? [220, 30, 40, 255] : [221, 221, 221, 255], i);
}
check('Цвет по фото без фона = красный', dominantColor(px, 20, 20) === '#dc1e28');

check('Проверка данных: плохое фото и категория отбрасываются', (() => { const x = sanitizeItem({ id: 'a', name: 'X', photo: 'javascript:alert(1)', category: 'toString', color: 'red' }); return x.photo === '' && x.category === 'top' && x.color === '#888888'; })());
check('Проверка данных: без id — не вещь', sanitizeItem({ name: 'X' }) === null);

check('Проверка данных: раскладка образа проверяется и ограничивается', (() => {
  const o = sanitizeOutfit({ id: 'o', itemIds: ['a'], layout: { a: { x: 9, y: 'z', s: 0.01, z: 3 }, ghost: { x: 1 }, toString: 1 } });
  return JSON.stringify(o.layout) === '{"a":{"x":2,"y":0,"s":0.3,"z":3}}';
})());

check('Синхронизация: время изменения сохраняется при проверке', sanitizeItem({ id: 'a', updatedAt: 123 }).updatedAt === 123 && sanitizeOutfit({ id: 'o', updatedAt: 'x' }).updatedAt === 0);

const pool = [...perfect, it({ category: 'shoes', seasons: ['winter'], name: 'сапоги' })];
const built = buildOutfits(pool, 'summer');
check('Подбор: лучший вариант — 100%, варианты разные', built[0].score === 100 && built.length === 2 && built[1].score < 100);

if (typeof document !== 'undefined') document.getElementById('out').textContent = results.join('\n');
else console.log(results.join('\n'));
