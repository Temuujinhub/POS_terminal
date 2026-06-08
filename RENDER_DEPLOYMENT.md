# 🚀 UBoil POS — Render-д Deploy хийх гарын авлага

Энэхүү гарын авлага нь FastAPI backend-ийг **Render.com**-д үнэгүй suгулгаж, MongoDB Atlas-тай холбож, тогтвортой production URL гаргахад туслана.

**Эцсийн үр дүн:** APK-аас `https://uboil-pos-backend.onrender.com` гэх stable URL руу хандана. Preview өөрчлөгдсөн ч асуудалгүй.

---

## 1️⃣ MongoDB Atlas (хамгийн эхэнд)

Render үндсэн нь MongoDB-гүй. Mongodb Atlas-ийн **үнэгүй M0 cluster** үүсгэе:

1. https://cloud.mongodb.com → "Try Free" → бүртгүүлэх
2. **Build a Database** → **M0 FREE** → "Cluster0" нэрээр үлдээ → **Create**
3. **Database Access:**
   - **Database User** → "Add New Database User"
   - Username: `uboil_admin`
   - Password: random string үүсгээ (хадгал!)
   - "Built-in Role": **Atlas admin** (хялбар авах)
   - **Add User**
4. **Network Access:**
   - "Add IP Address" → **Allow Access from Anywhere** (`0.0.0.0/0`)
   - **Confirm**
5. **Connect** товч → "Drivers" → Python → connection string copy:
   ```
   mongodb+srv://uboil_admin:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
   `<password>` хэсгийг өөрийн нууц үгээр сольж дараа Render-д ашиглана.

---

## 2️⃣ Backend код GitHub-руу push

Render Git repository-аас deploy хийдэг тул код GitHub-д байх ёстой.

1. GitHub дээр шинэ **private repo** үүсгэе: `uboil-pos`
2. Локал машин дээр:
   ```bash
   cd /app
   git init
   git add backend/ render.yaml FLUX_API_CHANGES.md APK_SIZE_OPTIMIZATION.md
   git commit -m "Initial: UBoil POS backend + Render config"
   git branch -M main
   git remote add origin https://github.com/<USERNAME>/uboil-pos.git
   git push -u origin main
   ```

> Эсвэл Emergent-аас "Save to GitHub" товчоор push хийж болно.

---

## 3️⃣ Render-руу deploy

1. https://render.com → "Get Started" → GitHub-аар нэвтрэх
2. Dashboard → **New +** → **Web Service**
3. **Connect a repository** → `uboil-pos` репозиторыг сонгох
4. Тохиргоо:
   - **Name:** `uboil-pos-backend`
   - **Region:** Oregon (USA) эсвэл Frankfurt (EU — Монголд бага latency)
   - **Branch:** `main`
   - **Root Directory:** `backend`
   - **Runtime:** Python 3
   - **Build Command:** `pip install --upgrade pip && pip install -r requirements.txt`
   - **Start Command:** `uvicorn server:app --host 0.0.0.0 --port $PORT`
   - **Plan:** **Free** ($0/mo)
5. **Environment Variables** хэсэгт:
   | Key | Value |
   |---|---|
   | `MONGO_URL` | (Atlas-ийн connection string) `mongodb+srv://uboil_admin:PASSWORD@...` |
   | `DB_NAME` | `uboil_pos` |
   | `FLUX_API_BASE_URL` | `https://uboil.flux.mn` |
   | `PYTHON_VERSION` | `3.11.9` |
6. **Create Web Service** товч → ~3-5 минут хүлээнэ

Deploy-ын төгсгөлд URL гарна (жишээ):
```
https://uboil-pos-backend.onrender.com
```

Шалгах:
```bash
curl https://uboil-pos-backend.onrender.com/api/health
# → {"status": "ok"}
```

---

## 4️⃣ Frontend-ийн backend URL шинэчлэх

Render URL гарсны дараа frontend-ийн `.env` болон EAS build profile-ийг шинэчилнэ:

### 4a. `/app/frontend/.env`
```env
EXPO_PUBLIC_BACKEND_URL=https://uboil-pos-backend.onrender.com
```

### 4b. `/app/frontend/eas.json` шинэчлэх
EAS build хийхдээ build profile-руу нэгэн зэрэг env дамжуулна:

```json
{
  "build": {
    "preview-small-apk": {
      "distribution": "internal",
      "channel": "preview",
      "android": {
        "buildType": "apk",
        "gradleCommand": ":app:assembleRelease -PreactNativeArchitectures=arm64-v8a",
        "image": "latest"
      },
      "env": {
        "EAS_NO_VCS": "1",
        "EXPO_PUBLIC_BACKEND_URL": "https://uboil-pos-backend.onrender.com"
      }
    },
    "production": {
      "channel": "production",
      "android": { "buildType": "app-bundle" },
      "env": {
        "EXPO_PUBLIC_BACKEND_URL": "https://uboil-pos-backend.onrender.com"
      }
    }
  }
}
```

### 4c. APK build хийх
```bash
cd /app/frontend
eas build --profile preview-small-apk --platform android
```

PAX A8900-д install хийсний дараа Render-руу зөв холбогдоно.

---

## ⚠️ Render Free Tier-ийн анхааруулга

| Хязгаарлалт | Тайлбар |
|---|---|
| ⏰ **Spin-down after 15 min idle** | 15 мин ачаалалгүй бол sleep болно. Дараагийн хүсэлт 30-50 секунд хүлээж сэрэх (cold start). |
| 📊 **750 цаг/сар үнэгүй** | Нэг сар 24/7 ажиллахад 720 цаг, тийм учир үнэгүй plan хангалттай |
| 🐌 **0.5 vCPU, 512MB RAM** | Бага дүүргэлттэй PCO-д хангалттай |
| 🌍 **Bandwidth 100 GB/сар** | POS app-д хангалттай |

**Cold start-аас сэргийлэх 2 арга:**

**Сонголт A** — Free plan + автомат ping (UpTime Robot):
1. https://uptimerobot.com бүртгүүлэх (үнэгүй)
2. New Monitor → HTTPS → `https://uboil-pos-backend.onrender.com/api/health`
3. Interval: 5 минут
4. → Server unдаагүй (Free plan)

**Сонголт B** — Render Starter plan ($7/сар):
- Spin-down байхгүй
- 0.5 vCPU, 512MB RAM
- Production станц олонтой бол санал болгоно

---

## 🔐 Аюулгүй байдал (production-ийн өмнө)

1. **CORS хязгаарлах** — `/app/backend/server.py`-д `allow_origins=["*"]` нь dev only. Production-д APK-ийн origin л зөвшөөрнө:
   ```python
   allow_origins=[
       "https://uboil-pos-backend.onrender.com",
       "capacitor://localhost",     # APK origin
       "https://localhost",
   ]
   ```

2. **MongoDB Atlas IP whitelist** — Production-д `0.0.0.0/0` биш Render-ийн static outbound IP-нүүдийг л зөвшөөрнө.

3. **Environment secret rotate** — Atlas-ийн нууц үгийг 3 сар тутамд солих.

---

## 📞 Дараагийн алхамууд (deploy дууссаны дараа)

1. ✅ `curl https://uboil-pos-backend.onrender.com/api/health` ажиллана уу шалга
2. ✅ Demo login-аар нэвтрэн dashboard ачаалах эсэхийг web preview-д тест
3. ✅ EAS build APK гарга
4. ✅ PAX A8900 дээр суулга, login → dashboard → pump → finalize шалгах
5. ⚠️ Үйлдвэрлэлд гарахын өмнө CORS, IP whitelist, password rotation хийх

---

## 🆘 Алдаа гарах тохиолдолд

| Алдаа | Шалтгаан | Шийдэл |
|---|---|---|
| `Application failed to respond` | Render free plan-ийн cold start | 30-50с хүлээгээд дахин оролд |
| `pymongo.errors.ServerSelectionTimeoutError` | MongoDB Atlas connection алдаа | Atlas IP whitelist шалга, MONGO_URL зөв эсэх |
| `Network error` APK дээр | Backend down эсвэл URL буруу | `https://...onrender.com/api/health` хариу буцааж байгаа эсэхээ шалга |
| Build алдаа | requirements.txt-д package таарахгүй | Render logs шалгаад харгалзах package-ийг засах |

Render logs үзэх: Dashboard → Service → **Logs** tab
