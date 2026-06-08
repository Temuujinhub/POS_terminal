# PTS-2 lag — Алдаа оношлох ба засах

## Шинж тэмдэг

- POS терминалаас 50,000₮ дүн оруулсны дараа Pump simulator автоматаар
  trigger хийгдэхгүй (гар аргаар хошуу сугалах хэрэгтэй болж байна).
- Шахалт дууссаны дараа дараагийн үйлдэл рүү очих хүртэл 3-4 минут
  хүлээх шаардлагатай.
- `/pts/pumps`, `/pos-monitor`, attendant дэлгэц 3 өөр төлөв
  харуулж, PTS-2-ын өөрийн web UI-тай тохирохгүй.

## Шалтгаан

jsonPTS R137 дээр PTS-2 контроллер `UploadStatus` packet-ыг зөвхөн
`WebsocketsUploadStatus = true` үед, `WebsocketsUploadStatusRequestsPeriodSeconds`
хугацааны давтамжаар илгээдэг. Эдгээр тохиргоо null болохоор PTS-2
default удаан горим руу буцна (~30-120 сек тутамд нэг packet).

POS-ийн тал руу:

1. POS app `PumpAuthorize` команд явуулсны дараа сервер response-доо
   командыг хавсаргаж PTS-2 руу илгээдэг.
2. Гэхдээ сервер бид PTS-2-оос ирж буй UploadStatus-ыг хүлээж байж л
   командыг response-д хавсаргадаг (HTTP fallback) эсвэл WebSocket
   ping-н давтамжаар л хүргэдэг.
3. UploadStatus period хэт удаан байвал команд PTS-2 хүртэл 1-3 минут
   хүлээж очдог → simulator/жинхэнэ pump хошуу автоматаар trigger
   хийгдэхгүй мэт мэдрэгдэнэ.
4. Шахалт дууссан хойш PTS-2-аас ирэх PumpTransaction-ыг сервер мөн л
   удаан хүлээн авдаг тул "дараагийн үйлдэл" руу очих lock 3-4 минут
   үргэлжилнэ.

## Оношлогоо (1 минутын тест)

```sql
-- Сүүлийн UploadStatus хэдэн секундын өмнө ирсэн бэ?
SELECT id,
       extract(epoch from now() - created_at)::int AS seconds_ago
FROM pts_event_logs
WHERE event_type = 'UploadStatus'
ORDER BY id DESC
LIMIT 1;

-- Сүүлийн 5 минутад хэдэн UploadStatus packet ирсэн бэ?
SELECT count(*) AS upload_status_5min
FROM pts_event_logs
WHERE event_type = 'UploadStatus'
  AND created_at > now() - interval '5 min';

-- WebsocketsUpload* тохиргоо одоо хэвлэгдсэн утгатай юу?
SELECT id, created_at,
       payload::jsonb -> 'Data' -> 'Configuration' AS cfg
FROM pts_event_logs
WHERE event_type = 'RemoteServerConfiguration'
ORDER BY id DESC
LIMIT 1;
```

| Үр дүн | Шийдэл |
| --- | --- |
| `seconds_ago > 30` ба `upload_status_5min < 30` | SetRemoteServerConfiguration дахин явуул (доор) |
| `cfg ->> 'WebsocketsUploadStatus'` IS NULL | SetRemoteServerConfiguration дахин явуул |
| `seconds_ago < 5` бүгд healthy боловч delay хэвээр | WebSocket бус HTTP fallback ажиллаж байна — `pts_controllers.connection_status` шалга |

## Засах — 3 хувилбар

### A) Dashboard товч (хамгийн хурдан)

1. Системийн админ → **PTS-2 контроллер** → ⚡ (Zap) товч.
2. Modal-ыг батал. SetRemoteServerConfiguration `pts_command_logs`-д
   `pending` статустайгаар орно.
3. Дараагийн 1-2 секундэд PTS-2 командыг хүлээн авч UploadStatus-ыг
   1сек тутамд илгээж эхэлнэ.

### B) Bash script

```bash
# Бүх станц
ssh root@uboil.flux.mn 'cd /opt/flux && scripts/refresh_pts_remote_config.sh'

# Зөвхөн нэг станц (id=3)
ssh root@uboil.flux.mn 'cd /opt/flux && scripts/refresh_pts_remote_config.sh 3'
```

### C) cURL — super_admin токенд

```bash
curl -X POST "https://uboil.flux.mn/api/pts/commands/refresh-remote-server-config?station_id=3" \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{}'
```

## POS simulator auto-trigger асуудал

Симулятор шахагч `PumpAuthorize` хүлээн авмагц хошуу автоматаар `On`
болох ёстой. Хэрэв болохгүй байгаа бол:

1. Эхлээд **lag-ийг засах** — PTS-2 командыг бодит цагт хүлээж аваагүй
   тул автоматаар сэрэхгүй байна.
2. Lag арилсан хойш `/pos-monitor` хуудсаар pump төлөв 1сек тутамд
   шинэчлэгдэж буйг шалга. `pts_command_logs.status = 'sent'` болж
   байгаа эсэх, `acknowledged_at`-д утга орж буйг харна уу.
3. Хэрэв Pump simulator өөрөө `PumpAuthorize` packet хүлээн аваад
   trigger хийхгүй байгаа бол энэ нь simulator-ын firmware талын алдаа
   — серверийн зүгээс хийх юм байхгүй.

## Шахалт дууссаны дараах 3-4 мин delay

`PumpTransaction` packet хүлээн авах хүртэл `dispense_session.status`
`pending` хэвээр байгаа тул POS app дараагийн үйлдэл рүү шилжүүлэхгүй.
Энэ нь UploadStatus period-той ижил root cause — A) шийдлийг хийсний
дараа delay <2сек хүртэл буурна.
