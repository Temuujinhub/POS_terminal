# 📦 APK хэмжээ багасгах гарын авлага (UBoil POS)

**Зорилго:** Default Expo APK ~85-120MB → ~45-55MB болгох

---

## ✅ Хийгдсэн optimization

### 1. `app.json` — Android build properties
```jsonc
{
  "expo": {
    "plugins": [
      ["expo-build-properties", {
        "android": {
          "enableProguardInReleaseBuilds": true,      // R8/ProGuard минификаци
          "enableShrinkResourcesInReleaseBuilds": true, // ашиглагдаагүй resource хасна
          "buildArchs": ["arm64-v8a", "armeabi-v7a"], // x86, x86_64 хасч ABI 2-роо хязгаарлав
          "splits": {
            "abi": {
              "enabled": true,           // ABI бүрд тусдаа APK
              "reset": true,
              "universalApk": false,     // нэг универсал APK үүсгэхгүй (хэмжээ 2 дахин том)
              "include": ["arm64-v8a", "armeabi-v7a"]
            }
          }
        }
      }]
    ]
  }
}
```

### 2. `eas.json` — Build profiles
- `preview` → `assembleRelease` (хоёр ABI APK)
- `preview-small-apk` → `-PreactNativeArchitectures=arm64-v8a` (зөвхөн орчин үеийн төхөөрөмжид, **хамгийн жижиг APK ~40-50MB**)
- `production` → AAB (Play Store-д хамгийн оновчтой, ~25-35MB user-руу татах хэмжээ)
- `production-apk` → дунд хэмжээний APK

---

## 🎯 Build команд

```bash
# Хамгийн жижиг APK (зөвхөн arm64-v8a)
eas build --profile preview-small-apk --platform android

# Хоёр ABI-тэй APK (хуучин 32-bit утсуудад)
eas build --profile preview --platform android

# Play Store-д
eas build --profile production --platform android
```

---

## 📊 Хэмжээний тооцоо

| Build profile | Бүх төрлийн файл | Татаж авах хэмжээ |
|---|---|---|
| Default Expo APK (хуучин) | ~110 MB | ~110 MB |
| `preview` (2 ABI + ProGuard) | ~75 MB (нийт) | ~45-55 MB/ABI |
| `preview-small-apk` (1 ABI) | **~45 MB** ⭐ | ~45 MB |
| `production` (AAB) | ~70 MB | **~25-35 MB** ⭐ |

> **Recommendation:** Test/демо-д `preview-small-apk` (хамгийн жижиг APK). Production-д Play Store-аар тараах бол AAB.

---

## 🔧 Нэмэлт optimization (хэмжээ багасгах сонголтууд)

### A. Ашиглаагүй package-уудыг хасах
Дараах package-ууд code-д ашиглагдахгүй байж болзошгүй. Ашиглагдсан эсэхийг шалгаж хасах:

```bash
# Шалгах
grep -r "expo-blur" /app/frontend/app /app/frontend/src
grep -r "expo-haptics" /app/frontend/app /app/frontend/src
grep -r "expo-symbols" /app/frontend/app /app/frontend/src
grep -r "expo-web-browser" /app/frontend/app /app/frontend/src
grep -r "expo-image" /app/frontend/app /app/frontend/src
grep -r "react-native-webview" /app/frontend/app /app/frontend/src

# Хэрэв ашиглагдаагүй бол:
yarn remove expo-blur expo-haptics expo-symbols expo-web-browser react-native-webview
```
Хасах боломжтой: ~3-8 MB

### B. Image asset compression
PNG → WebP хөрвүүлэх (хэмжээ 60-70% хэмнэнэ):
```bash
# Logo, splash, icon файлуудыг compress
cwebp -q 80 assets/images/uboil-logo.png -o assets/images/uboil-logo.webp
cwebp -q 80 assets/images/splash-icon.png -o assets/images/splash-icon.webp
```
Дараа нь `app.json`-ийн icon/splash зам шинэчилнэ. **~500KB-2MB** хэмнэнэ.

### C. Hermes engine bytecode (default бий)
Expo SDK 50+ автоматаар Hermes ашигладаг. JS код-ыг bytecode-руу хөрвүүлж ~20% жижиг болгодог. Тусгай тохиргоо шаардлагагүй.

### D. New Architecture (`newArchEnabled: true` — одоо бий)
Fabric + TurboModule — runtime жижиг боловч APK хэмжээнд тийм ч их нөлөөгүй.

### E. NDK ABI хасах (хамгийн их хэмнэлт)
- ❌ `x86`, `x86_64` (эмуляторт л хэрэгтэй) — production-д хасъя ✅ (хийгдсэн)
- ⚠️ `armeabi-v7a` — 5-8 жилийн өмнөх утсуудад хэрэгтэй; одоогийн POS терминал арм64
- ✅ `arm64-v8a` — PAX A8900 болон бүх орчин үеийн утсанд хангалттай

---

## 🚀 Хамгийн бага APK гаргах (зөвхөн PAX A8900-руу)

PAX A8900-руу install хийх бол `preview-small-apk` profile хамгийн оновчтой. Дотор нь зөвхөн arm64-v8a архитектур + R8 минификаци:

```bash
cd /app/frontend
eas build --profile preview-small-apk --platform android
```

Бэлэн APK ~40-50MB-аас ихгүй гарна.

---

## 🛠 Хэрвээ 50MB-аас дээш гарвал

1. **Bundle visualizer ажиллуулах:**
   ```bash
   npx expo export --platform android --output-dir dist
   npx source-map-explorer dist/_expo/static/js/android/*.js
   ```
   Аль package хэт том байгааг олно.

2. **Font хасах:** @expo/vector-icons (~3 MB) автоматаар бүх icon font-уудыг оруулдаг. Бид MaterialCommunityIcons + Ionicons л ашигладаг. `babel.config.js`-д tree-shaking тохируулах боломжтой.

3. **react-native-reanimated** + **react-native-worklets**: бид зайлшгүй ашиглаж байгаа, харин update хийх үед хэмжээ өөрчлөгдөж болно.

4. **react-native-nfc-manager**: одоогоор UI flow-д ашигладаг боловч PAX A8900 дээр `expo-intent-launcher`-аар уншдаг тул хасах боломжтой (`yarn remove react-native-nfc-manager` ~2 MB хэмнэнэ).

---

## 📞 Build хийх алхам

1. `npm install -g eas-cli`
2. `cd /app/frontend && eas login`
3. `eas build:configure` (анх удаа)
4. `eas build --profile preview-small-apk --platform android`
5. Build linki-ээс APK татаж PAX-д суулгана
