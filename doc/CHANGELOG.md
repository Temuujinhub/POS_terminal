# Flux Monitor — Хамгийн сүүлд хийсэн өөрчлөлтүүд (CHANGELOG)

Энэ файл нь `uboil.flux.mn` production-д нөлөөлж буй backend/API-ийн
өөрчлөлтийг **огноогоор** жагсаана. POS Android app хөгжүүлэгчид шинэ
хувилбар гармагц энэ файлыг хараарай — **app-д нөлөөлөх (breaking)**
өөрчлөлтийг ⚠️ тэмдэглэв.

> **uboil.flux.mn-д сүүлд deploy хийсэн:** 2026-05-29 (commit `206b424`).
> Энэ нь доорх 2026-05-29-ийн security hardening-ийг **багтаасан**.
> Deploy нь `claude/debug-controller-data-flow-ND9Jl` branch-аас, GitHub
> Actions-ийн "Deploy Flux Monitor to UBoil" workflow-г гараар ажиллуулж хийгдсэн.

---

## 2026-05-29 — Аюулгүй байдлын бэхжүүлэлт (Security hardening)

10 засвар. Backend-ийн эрхийн хяnaлтыг (authorization) бүхэлд нь чангатгасан.
**POS app-д шууд нөлөөтэй** тул заавал уншина уу.

### ⚠️ POS app хөгжүүлэгчид заавал мэдэх ёстой

1. **Станц/брэндийн хамрах хүрээ (scope) одоо хатуу шалгагдана (IDOR засвар).**
   `attendant` болон `station_manager` дүртэй token нь **зөвхөн өөрийн
   станцад** (`station_id`) хүчинтэй. Дараах endpoint-д өөр станцын
   `station_id` дамжуулбал `403 "Энэ станцад хандах эрхгүй"` буцна:
   - `GET /api/pos/pumps`
   - `POST /api/pos/start-dispense`
   - `GET /api/pos/dispense/{command_id}/status`
   - `GET /api/pos/active-dispenses`
   - `GET /api/pos/recent-pump-transaction`
   - `POST /api/pos/finalize` (гүйлгээний станцыг шалгана)

   **Хийх зүйл:** app нь үргэлж `pos-nfc-login`-ий хариунаас ирсэн
   `station_id`-г ашиглах ёстой. Станц сонгож солих UI байх ёсгүй (нэг
   ажилтан = нэг станц). `super_admin`/`brand_admin` дүр л зөвхөн олон станц
   харна.

2. **Корпорейт картын үйлдэл брэндээр шалгагдана.**
   `POST /api/pos/cards/{card_id}/topup` ба
   `GET /api/fuel-cards/{card_id}/movements` нь өөр брэндийн картад хандвал
   `403 "Энэ брэндэд хандах эрхгүй"` буцна. (`/api/pos/lookup-card` нь NFC-ээр
   глобал хайлт хэвээр — энэ нь зориудаар.)

3. **⚠️ `POST /api/auth/register` устгагдсан.** Хэрэв app-д энэ endpoint-ийг
   дуудаж байсан бол одоо `404` өгнө. Ажилтны бүртгэлийг зөвхөн вэб дээрх
   admin `/users` хуудаснаас (эсвэл түр SQL-ээр) хийнэ. NFC tag-ийг мөн тэндээс
   онооно. Дэлгэрэнгүй: [POS_API.md §2.2](./POS_API.md).

4. **⚠️ JWT-ийн SECRET_KEY.** Production дээр SECRET_KEY тохируулаагүй/анхдагч
   утгатай байвал сервер автоматаар хүчтэй түлхүүр үүсгэж `/data`-д хадгална
   (demo mode-оос бусад тохиолдолд). **Хэрэв SECRET_KEY солигдвол өмнө олгосон
   бүх token хүчингүй болж `401` өгнө** — энэ үед app нь дахин NFC нэвтрэлт
   хийх ёстой (одоо ч 401 дээр дахин нэвтрэх логиктой байх шаардлагатай).

### Backend талын бусад засвар (app-д шууд нөлөөгүй)

5. Кодод шигдсэн (hardcoded) superadmin "backdoor" устгаж, зөвхөн
   `SUPERADMIN_EMAIL` + `SUPERADMIN_PASSWORD` env хоёуланг өгсөн үед л
   үүсдэг (opt-in) болгосон.
6. `POST /api/prices` дээр дүр + станцын scope шалгалт нэмсэн (зөвхөн
   менежер/admin, өөрийн станцад).
7. `transaction` / `alert` / `station` / `finance` / `manual-readings` /
   `shifts` / `dashboard` / `fuel-card` read-уудад станц/брэндийн scope
   шалгалт нэмсэн (IDOR).
8. **jsonPTS HTTP ingest:** бүртгэлгүй (unregistered) PTS-2 контроллерийг
   татгалзах болсон. Шинэ контроллер холбохдоо эхлээд серверт бүртгэх ёстой.

---

## 2026-05-26 / 05-27 — Үйл ажиллагааны том багц feature-ууд

POS, ээлж, нөөц (tank), тайлангийн модулиудыг бодит API-д холбосон.

- **POS terminal registry** — нэг салбарт олон POS төхөөрөмж бүртгэх боломж
  (`/api/pos-terminals`). Бүртгэсний дараа `pos-nfc-login` нь `device_id`-аар
  станцыг автоматаар тогтооно. Банкны карт/провайдер тохиргоог (golomt/khan/
  qpay) терминал тус бүрд хадгална. → [POS_API.md §14–§16](./POS_API.md).
- **pump → port grouping** — нэг порт дээрх олон хошуу нэг "tray" болж
  харагдана. `/api/pos/pumps` хариунд `port` талбар нэмэгдсэн.
- **EOT background watcher** — шахалт дууссаны дараа pump нь
  `EndOfTransaction`-д удаан гацвал backend нь grace хугацааны дараа
  автоматаар чөлөөлнө (`EOT_AUTO_CLOSE_*` тохиргоо). Гүйлгээ нь бүртгэгдэнэ,
  зөвхөн хошуу чөлөөлөгдөнө.
- **Shift roster** — ажилтнуудыг ээлжид хуваарилах, ээлжийн урт/тоог
  тохируулах, нэг салбарт нэртэй олон ээлж, ээлж солилцох, ээлж нээх/хаах үед
  pump totalizer тулгалт (reconciliation) + audit.
- **Tanks / delivery** — нөөцийн манай бүртгэл (гар оруулга), шатахуун
  хүлээн авахад tank түвшин нэмэгдэж жин/температур/нягтыг бүртгэнэ.
- **Reports** — daily-sales, fuel-grade, attendant, reconciliation, shift,
  transaction list бүгд бодит API-аас татдаг болсон (хатуу demo массив устсан).
- **Demo auto-seed** — анхдагчаар **унтраалттай** болсон (`DEPLOY_MODE=client`).
  Production tenant дээр хуурамч demo дата суудаггүй. Цэвэрлэх хамгаалалттай
  script нэмсэн (`scripts/cleanup_uboil_demo.sh`).
- **UI** — sidebar-ийг дүрээр (role) хязгаарлаж дахин эрэмбэлсэн; admin-д
  хэрэглэгчийн удирдлага + audit log хуудас.

---

## 2026-05-20 — Prepay / Postpay төлбөрийн урсгал + зэрэгцээ гүйлгээ

⚠️ **POS app-д шинэ боломж** (хуучин flow эвдрэхгүй — default нь `postpay`):

- **Prepay** (Дүн / Volume): үйлчлүүлэгч эхлээд төлбөр төлж, дараа нь pump
  зөвшөөрөгдсөн дүн хүртэл шахна. `payment_method` / `bank_approval_code` нь
  `start-dispense` дээрх шинэ `prepayment` блокоор ирнэ.
- **Postpay** (Бак дүүртэл / Fill): шахалт эхэлж, дараа нь төлбөр + НӨАТ авна
  (хуучин урсгал). `payment_flow: "postpay"` нь default.
- **Concurrent dispenses**: шинэ `GET /api/pos/active-dispenses` нь идэвхтэй
  гүйлгээний жагсаалт буцаах тул кассчин нэг pump шахаж байх зуур өөр pump-д
  гүйлгээ эхлүүлэх боломжтой (minimised tray UI). → [POS_API.md §5–§9](./POS_API.md).

---

## 2026-05-19 — "Шахаж байна"-д гацах асуудлын засвар

- Шахалт дуусмагц backend нь `PumpAuthorize`-г `acknowledged → completed`
  болгож шилжүүлдэг болсон (PR #46). POS app-ын side-аас хийх зүйл алга —
  `/api/pos/pumps` нь pump-ыг автоматаар `ready`/`idle`-руу буцаана.
- `PumpCloseTransaction`-г `/finalize`-аас илгээдэг болсон. Технотрейд PTS-2
  firmware (build `743.0002.TR.0.1`) дээр `AutoCloseTransaction=true` тул
  `JSONPTS_ERROR_PUMP_STATUS_NOT_END_OF_TRANSACTION` буцах нь **хэвийн** —
  POS app зөвхөн `/finalize`-ийн `200 OK`-г хүлээж авна.
- "Шахаж байна → Хоосон" шилжих хугацаа: **~3–5 мин → ~1–3 секунд**.

---

> Бүрэн техникийн дэлгэрэнгүйг [POS_API.md](./POS_API.md) болон
> [POS_APP_DEVELOPER_GUIDE.md](./POS_APP_DEVELOPER_GUIDE.md)-аас, deploy
> топологийг [DEPLOYMENT.md](./DEPLOYMENT.md)-аас үзнэ үү.
