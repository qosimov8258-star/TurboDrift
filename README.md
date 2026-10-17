# 🏎 TURBO DRIFT — 3D poyga o'yini

7 ta haqiqiy 3D mashina (BMW M3, BMW M3 GTR, Dodge Charger, Ferrari 296 GT3, Mercedes-AMG GT3, Toyota GR Supra GT300, Toyota Supra MK4), hammasi **bir xil kuchda**.

## Ishga tushirish

```bash
cd /Users/ismoil/Desktop/game
npm install        # birinchi marta
npm start          # http://localhost:3000
```

Terminalda ko'rsatilgan `http://192.168.x.x:3000` manzilini **bir WiFi dagi do'stlaringiz** ochsa bo'ldi.
Internet orqali o'ynash uchun serverni tunnel (masalan `npx cloudflared tunnel --url http://localhost:3000`) yoki hostingga qo'ying.

## Yo'llar (10 ta trassa)

Menyudagi **YO'LLAR** tugmasi yoki garajdagi **Yo'lni tanlash** orqali tanlanadi. Onlayn o'yinda yo'lni xona egasi tanlaydi — hamma o'yinchida bir xil yo'l ochiladi.

| # | Yo'l | Turi | Mavzu |
|---|---|---|---|
| 1 | Klassik Speedway | yo'l | o'rmon |
| 2 | Tog' serpantini | yo'l | qorli tog'lar |
| 3 | Cho'l avtobani | yo'l | cho'l, kaktus |
| 4 | Shahar ko'chalari | yo'l | kechki shahar, osmono'par binolar |
| 5 | Sohil yo'li | yo'l | dengiz, palmalar |
| 6 | Katta Aylana | yumaloq | quyosh botishi |
| 7 | Oval Superspeedway | yumaloq | o'rmon |
| 8 | Uchburchak Ring | yumaloq | cho'l |
| 9 | Gul Arena | yumaloq | tungi stadion, prožektorlar |
| 10 | Yong'oq Ring | yumaloq | qor |

Yangi yo'l qo'shish: `public/js/trackdata.js` dagi `TRACKS` ga nuqtalar ro'yxatini qo'shing, `node tools/validate-tracks.mjs` bilan tekshiring (burilish radiusi, devorlar kesishmasligi), `server.js` dagi `TRACK_COUNT` ni yangilang.

## Grafika (4K)

Pauza menyusi yoki bosh menyudagi grafika tugmasi: **4K Ultra** (kamida 3840 px kenglikda render, 4096 soya) → Yuqori → O'rta → Past. FPS tushib ketsa o'yin o'zi pasaytiradi.

## Tekshiruv skriptlari

`node tools/validate-tracks.mjs` (geometriya) · `node tools/bot-tracks.mjs` (bot har yo'lda aylana yuradi) · `node tools/test-ws-track.mjs` (onlayn yo'l sinxroni) · `node tools/test-tracks.mjs` (brauzerda hamma yo'l, skrinshotlar)

## Boshqaruv

| Tugma | Vazifa |
|---|---|
| W / ↑ | Gaz |
| S / ↓ | Tormoz / orqaga |
| A D / ← → | Rul |
| SPACE | Qo'l tormozi — drift (tutun + g'ildirak izi) |
| SHIFT | Nitro (drift qilsangiz tezroq to'ladi) |
| E / Q  yoki  1 2 3 | Uzatmani oshirish / kamaytirish (1-2-3). JANG rejimida raqamlar qobiliyatlar uchun |
| T | Avto / qo'lda uzatma |
| C | Kamera |
| R | Yo'lga qaytarish |
| M | Ovoz |
| ESC | Pauza |

## O'yin rejimlari

- **Yakka o'yin** — botlarga qarshi (0–6 ta bot).
- **Do'stlar bilan** — xona yarating, 4 harfli kodni do'stlarga bering (yoki "Havola" tugmasi). 7 tagacha o'yinchi; har kim o'z mashinasini tanlaydi, **bir xil mashinani ikki kishi tanlay olmaydi**. Xona egasi bo'sh o'rinlarni botlar bilan to'ldirishi mumkin.

## Fayllar

- `server.js` — statik server + WebSocket xonalar
- `public/js/carmodel.js` — GLB modellardan g'ildiraklarni avtomatik topadi
- `public/js/car.js` — fizika (teng kuch, 3 ta uzatma, drift, nitro)
- `public/js/track.js`, `trackdata.js` — trassa (chap/o'ng burilishlar)
- `public/js/race.js`, `bot.js`, `hud.js`, `audio.js`, `net.js`, `main.js`
- `tools/optimize.mjs` — original og'ir `.glb` larni (280 MB) yengil (42 MB) qiladi

## Jang Arena (to'qnashuv rejimi)

Garajdagi **O'yin rejimi** bo'limida **JANG** ni tanlang (yakka o'yinda ham, onlayn xonada ham — rejimni xona egasi tanlaydi).

- Hamma mashinaning **joni (HP) 100**. Tepada katta jon chizig'i, dushmanlar tepasida ham kichik jon chizig'i bor; jon **sekin kamayib** boradi (oq iz — oxirgi zarba).
- Jon **urilish kuchiga qarab** ketadi (`carDamage` / `wallDamage`, `public/js/car.js`): yengil tegish deyarli zarar bermaydi, 150 km/soat tezlikda to'g'ridan-to'g'ri urilish juda og'ir. Urgan mashina kamroq, urilgan mashina ko'proq jon yo'qotadi. Devorga urilish ham jonni kamaytiradi.
- Jon 55% dan tushsa mashina tutaydi, 22% dan pastda yonadi; jon 0 bo'lsa mashina **portlaydi** va to'siq bo'lib qoladi.
- **Oxirgi tirik qolgan g'olib.** Botlar (`BattleBot`, `public/js/bot.js`) eng yaqin / eng jarohatli dushmanni quvib uradi.
- Arena: `Jang Arena` halqasi (`trackdata.js`, group `arena` — yo'l tanlash oynasida ko'rinmaydi). Sinov: `node tools/test-battle.mjs <papka>`.

### Jang qobiliyatlari (1 2 3 … 9 0 - =)

JANG rejimida raqam qatori **qobiliyatlarga** aylanadi (uzatma esa avtomatik, qo'lda — <kbd>E</kbd>/<kbd>Q</kbd>). Pastdagi panelda 12 ta qobiliyat, har birining o'z **kutish vaqti (cooldown)** bor; panelni bosish/tegish ham ishlaydi (telefonda).

| Tugma | Qobiliyat | Turi | Nima qiladi |
|---|---|---|---|
| 1 | Pulemyot | hujum | 14 ta o'q ketma-ket (har biri 3.4 jon), 8 s |
| 2 | Raketa | hujum | oldingi dushmanga intiladi, 26 jon + portlash, 11 s |
| 3 | Mina | hujum | orqaga mina qo'yadi (45 s turadi, 5 tagacha), 30 jon, 9 s |
| 4 | Qalqon | himoya | 4.5 s hech qanday zarar/EMP/magnit ta'sir qilmaydi, 18 s |
| 5 | Ta'mir | himoya | 4 s ichida 30 jon tiklaydi, 22 s |
| 6 | Turbo | yordam | 2.4 s kuchli tezlanish, 10 s |
| 7 | Yog' | hujum | yo'lga moy dog'i — ustiga chiqqan sirpanib aylanadi, 11 s |
| 8 | EMP | hujum | 28 m atrofdagi dushmanlar dvigateli ~2 s o'chadi + 9 jon, 18 s |
| 9 | Bomba | hujum | uloqtiriladi, tushgan joyda portlaydi (28 jon, katta radius), 12 s |
| 0 | Lazer | hujum | bir zumda tegadigan nur, 80 m, 20 jon, 9 s |
| - | Zirh | himoya | 10 s hamma zarar 2 baravar kam, 20 s |
| = | Magnit | yordam | 50 m atrofdagi dushmanlarni o'ziga tortadi, 15 s |

Botlar ham shu qobiliyatlardan foydalanadi (vaziyatga qarab, ~2 s da bir marta). Kod: `public/js/abilities.js` (ro'yxat), `public/js/arsenal.js` (o'q/raketa/mina… fizikasi va botlar miyasi), HUD paneli `public/js/hud.js`. Onlayn: tugma bosilganda `{t:'ab'}` xabari yuboriladi, har bir klient effektni o'zida modellashtiradi, zararni esa faqat o'zi boshqarayotgan mashinalarga (o'zi + host bo'lsa botlarga) qo'llaydi. Sinov: `node tools/test-abilities.mjs <papka>`.

## Yangiliklar
- **iPhone (iOS) dizayni** — `public/ios.css`, SVG ikonlar `public/js/icons.js`; 4K/katta ekranlarda interfeys avtomatik kattalashadi.
- **Garaj 3D** — sichqoncha bilan suring (aylantirish), g'ildirak/pinch (zoom), ikki marta bosish (tiklash).
- **Mashina rangi** — 4 xil rang (`public/js/paint.js`), onlayn ham ko'rinadi.
- **Telefon boshqaruvi** — ekrandagi tugmalar (`public/js/touch.js`), poyga paytida pauza/kamera/ovoz/tiklash tugmalari.
- Orqaga yurish va kamera tuzatildi; tez tezlikda titrash va yengil grafika (uzoq mashinalar soddalashtiriladi).
