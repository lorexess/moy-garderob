# Мой гардероб

Приложение-гардероб на русском: вещи с фото, образы, процент сочетания, темы по временам года.
Владелец — не программист: объясняй простыми словами, по-русски.

## Файлы
- `index.html`, `style.css` — разметка и 4 сезонные темы.
- `logic.js` — чистые функции: процент сочетания, цвет по фото, валюты, подбор образа, проверка данных (`sanitizeItem/Outfit`).
- `app.js` — интерфейс, IndexedDB. Все записи пользователя идут через `dbWrite` (ставит `updatedAt` и кладёт в очередь синхронизации); данные из облака — через `dbTx`.
- `sync.js` — аккаунт и синхронизация через Firebase REST (без SDK). Загружается ДО `app.js`.
- `sw.js`, `manifest.webmanifest`, `icon-*.png` — установка как PWA. При добавлении файла впиши его в `FILES` в `sw.js`.
- `icon.ico` — иконка ярлыка на ПК.
- `ai/` — удаление фона на устройстве: onnxruntime-web 1.20.1 (`ort.wasm.min.js` + wasm/mjs) и модель U²-Net-p `u2netp.onnx` (Apache-2.0). Код — `removeBg` в `app.js`. Нужен http(s): из `file://` не работает.
- Вкладки: Вещи, Образы, Аккаунт (`view-more`), Статистика, Подписка (`view-sub`, пока заглушка «Скоро»). «Собери мне образ» (`view-build`) открывается кнопкой во вкладке «Образы».
- `tests.html` / `tests.js` — самопроверка: `node -e "const fs=require('fs');require('vm').runInThisContext(fs.readFileSync('logic.js','utf8')+'\n'+fs.readFileSync('tests.js','utf8'))"` — все строки должны начинаться с ✔.

## Где что живёт
- **Firebase** проект `moy-garderob` (Auth Email/Password + Firestore, правило: `users/{uid}/**` только владельцу). Документы: `users/<uid>/items|outfits/<id>`, поля `data` (JSON вещи), `updatedAt`, `serverTime`.
- **Сайт**: https://lorexess.github.io/moy-garderob/ — репозиторий GitHub `lorexess/moy-garderob`, обновляется вручную: пользователь загружает файлы через «Add file → Upload files». git/gh для этого репозитория не настроены.
- **ПК**: ярлык «Мой гардероб» на рабочем столе и в «Пуске» = Edge `--app="https://lorexess.github.io/moy-garderob/"` (офлайн работает через `sw.js`).
- **Android**: APK собирается в `C:\Users\ffill\android-tools` (JDK 21, Android SDK 35, Capacitor 7 в `garderob-app`). Ключ подписи — `C:\Users\ffill\.android\debug.keystore`; без него обновить приложение поверх не получится.

## Пересобрать APK после правок
```bash
cd /c/Users/ffill/android-tools/garderob-app
for f in index.html style.css logic.js sync.js app.js sw.js manifest.webmanifest icon-192.png icon-512.png apple-touch-icon.png; do cp "/c/Users/ffill/Documents/Мой гардероб/$f" www/; done
rm -rf www/ai && cp -r "/c/Users/ffill/Documents/Мой гардероб/ai" www/ai
npx cap sync android
cd android && JAVA_HOME="C:/Users/ffill/android-tools/jdk" ANDROID_HOME="C:/Users/ffill/android-tools/sdk" ./gradlew.bat assembleDebug --no-daemon -q
```
Перед сборкой подними `versionCode` в `android/app/build.gradle`. Готовый файл — `android/app/build/outputs/apk/debug/app-debug.apk`; копируй на рабочий стол (`C:\Users\ffill\OneDrive\Desktop\Мой гардероб.apk`).
`android/local.properties` должен содержать `sdk.dir=C:/Users/ffill/android-tools/sdk` — только прямые слэши.

## После правок напомни пользователю
1. Загрузить изменённые файлы в GitHub (обновит сайт).
2. Установить новый APK на телефон поверх старого (если менялся код приложения).
