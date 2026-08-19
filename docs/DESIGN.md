# Logixa AI — Dizayn tizimi

> Manba: `Logixa AI Brand Board` (Claude Design handoff, 2026 — V1.0).
> Bu hujjat TZ §11 dagi eski palitra (`#1B2A4A` / `#F5A623`) o'rniga keladi:
> brend **Logixa AI**, asosiy ranglar Deep Navy + Electric Blue.
> Kod tarafda yagona manba — `apps/web/src/index.css` (tokenlar) va
> `apps/web/tailwind.config.js` (ularning Tailwind'ga bog'lanishi).

## 1. Brend

| Element    | Qiymat                                                                    |
| ---------- | ------------------------------------------------------------------------- |
| Nom        | Logixa AI («Logixa» — massa, «AI» — faqat Electric Blue bilan ajratiladi) |
| Slogan     | AI-POWERED LOGISTICS                                                      |
| Belgi      | «L» shaklidagi marshrut: boshlanish tuguni → yo'l → manzil tuguni         |
| Komponent  | `LogixaLogo` / `LogixaMark` (`shared/ui/Logo.tsx`)                        |
| Variantlar | `horizontal` (default), `mark`, `wordmark`, `stacked`                     |
| Tonlar     | `auto` (currentColor), `light`, `dark`, `mono`                            |

Belgi geometriyasi 64×64 to'rda qat'iy belgilangan va qayta chizilmaydi; kichik
o'lchamlarda chiziq qalinligi avtomatik oshadi (16px da ham o'qiladi). Manzil
tuguni har doim Electric Blue — u signal, tema emas. Faqat `mono` variantida
bitta rangga tushadi.

Asset'lar: `apps/web/public/favicon.svg`, `app-icon.svg`, `apple-touch-icon.png`,
`app-icon-192.png`, `app-icon-512.png`, `site.webmanifest`.

## 2. Rang tokenlari

Ranglar RGB kanallar sifatida saqlanadi (`--c-*`) — Tailwind ularga shaffoflik
qo'sha oladi; oddiy CSS/SVG uchun `--brand-primary` kabi tayyor aliaslar bor.
Yorug'/tungi rejim — bitta token to'plamining almashinuvi (`.dark`).

| Rol             | Token                | Light     | Dark      |
| --------------- | -------------------- | --------- | --------- |
| Brand primary   | `--brand-primary`    | `#0A84FF` | `#0A84FF` |
| Brand secondary | `--brand-secondary`  | `#0D1220` | `#0D1220` |
| Brand accent    | `--brand-accent`     | `#3E9BFF` | `#3E9BFF` |
| Background      | `--background`       | `#F2F3F7` | `#0D1220` |
| Surface         | `--surface`          | `#FFFFFF` | `#141B2C` |
| Surface raised  | `--c-surface-raised` | `#FFFFFF` | `#1C2431` |
| Text primary    | `--text-primary`     | `#0D1220` | `#FFFFFF` |
| Text secondary  | `--text-secondary`   | `#66707F` | `#C6CEDC` |
| Text tertiary   | `--c-text-tertiary`  | `#98A0AE` | `#8A93A8` |
| Border          | `--border`           | `#E7EAF0` | `#2A3346` |
| Success         | `--success`          | `#1FA55C` | `#30D158` |
| Warning         | `--warning`          | `#C77800` | `#FF9F0A` |
| Danger          | `--danger`           | `#D0342C` | `#FF453A` |

Tailwind nomlari: `brand-*`, `background`, `surface(-raised/-sunken/-inverse)`,
`ink(-secondary/-tertiary/-inverse)`, `line(-strong/-divider)`,
`success|warning|danger|info(-surface)`.

**Qoida:** komponentda hech qachon hex yozilmaydi. Leaflet/canvas kabi CSS
o'zgaruvchilarini o'qiy olmaydigan joylar uchun `shared/ui/palette.ts` dagi
`BRAND` konstantalari ishlatiladi (tokenlar bilan qo'lda sinxron).

Electric Blue — signal, yuza emas: birlamchi amal, faol navigatsiya, jonli
holat va manzil tuguni. Katta maydonlarni u bilan to'ldirilmaydi.

## 3. Tipografika

Stack: `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text',
Inter, …`; raqamlar va texnik matn uchun `'SF Mono', ui-monospace, 'IBM Plex
Mono'`. Apple qurilmalarida SF Pro tizimdan keladi, boshqa joylarda Inter
(Google Fonts) o'rnini bosadi — ikkalasi ham Latin + Kirill.

Shkala (`text-*`): `caption 11.5` · `footnote 12.5` · `subhead 13.5` ·
`body 15` · `headline 17` · `title3 20` · `title2 24` · `title1 30` ·
`display 42`. Sarlavhalar `font-semibold` (700 dan oshmaydi), harf oralig'i
manfiy (`-0.02em` atrofida).

Pul, masofa, foiz va sanalar — `font-mono` + `tabular-nums`: ustunlar
qimirlamaydi. `Cell numeric` va `StatCard` buni avtomatik qiladi.

## 4. Shakl va harakat

- Radiuslar: `xs 8` · `sm 10` · `md 12` (input/tugma ichi) · `lg 16` (karta) ·
  `xl 20` · `2xl 24` (modal) · `pill 100px` (tugmalar, badge).
- Soyalar: `shadow-xs/sm/md/lg` — yumshoq, hech qachon og'ir emas.
- Tugma balandligi: `sm 36` · `md 44` · `lg 48` (iOS teginish o'lchami).
- Animatsiya: `--ease-ios` (`cubic-bezier(.32,.72,0,1)`), `140ms` (holat
  o'zgarishi) va `220ms` (modal/sahifa). `prefers-reduced-motion` hurmat
  qilinadi.

## 5. Komponentlar (`apps/web/src/shared/ui`)

| Komponent                                                              | Vazifasi                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------ |
| `Button`, `IconButton`                                                 | primary/secondary/danger/ghost, sm/md/lg, loading      |
| `Field`, `Input`, `SearchInput`, `CurrencyInput`, `Select`, `Textarea` | forma boshqaruvlari, xato/disabled holatlari           |
| `Card`, `CardHeader`, `StatCard`, `InfoItem`                           | yuzalar va KPI plitkalari (`tone="navy"` — AI paneli)  |
| `Table`, `Row`, `Cell`                                                 | `md` dan yuqorida jadval, pastda kartochka ko'rinishi  |
| `Badge`                                                                | status pillasi, `dot` — jonli signal                   |
| `Modal`, `ModalActions`                                                | desktop'da karta, telefonda pastdan chiqadigan sheet   |
| `Tabs`, `SegmentedControl`, `Pagination`, `PageHeader`                 | navigatsiya elementlari                                |
| `Spinner`, `Skeleton`, `EmptyState`, `ErrorMessage`                    | holatlar                                               |
| `icons.tsx`                                                            | 24×24, 1.75 stroke — yagona ikonka oilasi (emoji yo'q) |

Jadval telefonda `data-label` orqali ustun nomini har bir katakka chiqaradi
(`.lx-table` qoidalari `index.css` da) — gorizontal siqilish yo'q.

## 6. Tema

`shared/theme` — `light | dark | system`, `localStorage: tc.theme`, default
`dark` (haydovchi va dispetcher tunda ishlaydi). Tema `<html class="dark">`
orqali qo'llanadi va birinchi render'dan oldin `initTheme()` da yoziladi.
Mijozning ochiq kuzatuv sahifasi har doim navy palitrada — u brend yuzasi.

Mobil ilova (Flutter) shu tokenlarni `lib/core/theme.dart` da takrorlaydi:
`BrandColors` + `BrandRadii`.

## 7. Preview (backendsiz demo)

Interfeysni serversiz ko'rsatish uchun alohida build bor — haqiqiy ilova,
lekin API o'rniga `src/demo/fixtures.ts` dagi ma'lumotlar:

```bash
pnpm --filter web exec vite build --config vite.demo.config.ts   # → dist-demo/
```

`src/demo/` faqat shu build'ga kiradi, production bundle'ga tushmaydi.
Xarita plitkalari va chiqish tugmasi demo'da o'chiriladi (`src/demo/demo.css`).

## 8. Tekshiruv ro'yxati (yangi ekran qo'shganda)

1. Rang faqat tokendan; hex yo'q.
2. Matn faqat i18n kalitidan (uz-latn/uz-cyrl/ru — uchalasi ham to'ldiriladi).
3. Raqamlar `font-mono` + `tabular-nums`.
4. Tugma/input balandligi va radiusi shkaladan.
5. Telefon (390px), planshet va desktop tekshiriladi; safe-area hisobga olinadi.
6. Fokus halqasi ko'rinadi, ikonka tugmasida `aria-label` bor.
7. Yorug' va tungi rejimda kontrast tekshiriladi.
