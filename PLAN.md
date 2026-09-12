# CRIT - Plan razvoja

Živi dokument. Radimo fazu po fazu, redom. Kad se nešto završi, štiklira se ovde.

---

## Urađeno

- [x] **Server + baza** (Node + `node:sqlite`, port 8095) - nalozi, sesije, naplata po sekundi, auto-lock
- [x] **Panel** (desktop + telefon preko LAN-a) - kontrolna tabla, igrači, porudžbine, shop, igre, računari, podešavanja
- [x] **Launcher** (Electron kiosk) - login, HUD sa vremenom, igre, internet, shop, otključavanje PIN-om
- [x] **Uloge** vlasnik/radnik (zaključane opcije radniku, provera na serveru)
- [x] **Daljinska kontrola** računara - poruka, zaključaj/otključaj, odjavi, ugasi/restart/logoff, grupne akcije
- [x] **Daljinski spisak procesa** - glavni računar vidi šta je pokrenuto na izabranoj mašini i gasi program odatle (sistemski procesi se odbijaju). Zamenilo je staru opciju koja je pokušavala da otvori Task Manager *na računaru igrača*, gde igrač ionako nema pristup
- [x] **Statusi** Online / Standby / Zaključan / Offline
- [x] **Redizajn panela iz korena** - profesionalna paleta, SVG ikone, custom kontrole, bez "lampica"
- [x] **Kasa (POS)** - radnik ručno kuca porudžbinu (keš ili sa naloga)
- [x] **Logovi / audit** - evidencija svih događaja sa filterima
- [x] **Shop kartice** - profesionalne kartice sa slikom (bez bordera), u panelu i launcheru
- [x] **Daljinska instalacija** programa/igara preko URL-a (biblioteka + status uživo)
- [x] **Redizajn panela 2.0** - flat minimalistički dizajn sistem, animacije, stilizovane potvrde umesto browser dijaloga, grupisana navigacija, centriran logo
- [x] **Panel dopune** - Kasa u navigaciji, istorija porudžbina, IP adresa + poslednji put online po računaru, izmena/brisanje naloga igrača (sa napomenom), brzo sakrivanje shop artikla, "Otključaj sve", restart launchera iz panela, server info + ručni backup u Podešavanjima, baner kad panel izgubi vezu, zvučna obaveštenja za isteklo vreme
- [x] **Dorada slabijih stranica** - Logovi (grupisanje po danima, mirne kategorije, filter Sistem), Instalacije (dvokolonski raspored, instalacija sa linka kroz modal, čišćenje statusa), Podešavanja (red-po-podešavanje sa opisima, PIN sakriven sa prikazom na klik), Igre (kartice po kategorijama)
- [x] **Prijava na panel preživljava restart servera** (tokeni u bazi, važe 30 dana; reset lozinke odjavljuje taj nalog svuda)
- [x] **Logovi kao feed** - ikone po kategoriji, grupisanje Danas/Juče, 15 po strani; **Porudžbine** kao račun-kartice (cene po stavci, status, "pre X min", centrirano prazno stanje); **naplata sa naloga preko pretrage** (kucanjem imena, bez liste svih igrača; keš nema polje naloga)

---

## Faze koje radimo (redom)

### Faza 1 - Brend i logo (završeno)
- [x] Transparentna verzija logoa (bela pozadina uklonjena, bela kontura zadržana) > `assets/crit-logo.png`
- [x] Favicon (`server/public/img/favicon.png`)
- [x] Logo u **panel** (login, sidebar, mobilni topbar)
- [x] Logo u **launcher** (login, setup, gornja traka)
- [x] Akcenat panela > crvena iz logoa (`--accent #e23b34`)
- [x] Uklonjena senka sa logoa; logo smanjen (suptilniji) u panelu i launcheru
- [x] Dizajn-audit svih ekrana (tabla, Igrači, Shop, Kasa, modali) - sređeno; Offline kartice dobile čisto "Detalji" dugme

### Faza 2 - Optimizacija računara (launcher) - "bezbedna + srednja"
- [x] Plan napajanja na **High Performance** pri pokretanju - launcher prelazi na njega i gasi uspavljivanje/gašenje ekrana (`planNapajanja`); pri admin izlazu vraća Balanced
- [x] **Čišćenje nepotrebnih fajlova** na kraju sesije: temp, keš i profili pregledača, prijave na Steam/Epic/Riot/Battle.net/EA/Ubisoft, skorašnji dokumenti, korpa za otpatke, DirectX/NVIDIA/AMD keš šejdera (`ciscenje.js`). Lične fascikle se NE diraju osim na izričit zahtev - na računarima sa OneDrive-om brisanje bi otišlo i u oblak
- [~] Gašenje **pozadinskih procesa** - radi se samo za ono što je igrač sam pokrenuo tokom sesije (`ugasiNoveProcese`), uz zaštitu Windows fascikle i spiska sistemskih. Šire gašenje bloatware-a NIJE urađeno namerno: spisak se razlikuje od mašine do mašine i lako obori nešto što igrama treba
- [ ] Gašenje **startup aplikacija** i vizuelnih efekata - NIJE urađeno. Teško je vratiti u prvobitno stanje, a dobitak je mali u odnosu na rizik
- [ ] **Odlaganje Windows Update** - NIJE urađeno. Rešava se u samom Windows-u (Active hours / pauza ažuriranja), ne iz launchera; upisano u DEPLOY.md
- [x] Sve reverzibilno - politike i plan napajanja se vraćaju pri admin izlazu; `POPRAVI-RACUNAR.bat` vraća sve i kad launcher ne može da se pokrene

### Faza 3 - Igre da rade perfektno na svakom računaru
- [x] Pouzdano pokretanje igara - podrška za `steam://`/`epic://` protokole (`shell.openExternal`), interni kiosk browser za http(s), hvatanje asinhronih grešaka pri pokretanju (`child.on("error")` > poruka igraču), zaštita od duplog klika (3s po putanji + "Pokrećem..." stanje na pločici)
- [x] Povratak u launcher pametniji - po izlasku procesa se preko `tasklist` proveri da li igra i dalje radi (slučaj kad je .exe samo pokretač), pa se fokus ne otima pokrenutoj igri
- [x] Kill na lock/odjavu - pored `child.kill()` i `taskkill /IM /F /T` za sam proces igre
- [x] Provera da je igra instalirana; jasna poruka ako nedostaje ("... nije instalirana na ovom računaru. Pozovite osoblje.")
- [x] **Lov na bagove u klijentu (5 nađenih i ispravljenih)**
  - Korpa je dodavala više komada po kliku (`refreshCart` je ponovo kačio listenere na sve artikle) > prelazak na delegaciju klikova
  - Dupli klik na "Poruči" slao dve porudžbine i naplaćivao dvaput > dugme zaključano do odgovora servera
  - Dupla prijava pravila **dve aktivne sesije** na istom računaru (dvostruka naplata) > zaštita na serveru (`clientLogin`) + zaključano dugme na klijentu
  - Zastareo katalog kod igrača > server šalje `catalog` svim launcherima na svaku izmenu shopa/igara, korpa se čisti od nedostupnog
  - Alarm za isteklo vreme kasnio sekundu (`startTimer` je gasio klasu koju je `updateHud` upravo upalio)
  - Uz to: količina ograničena na 20 po artiklu (usklađeno sa serverom), tajmer staje kad nema veze, Escape zatvara prozore
- [x] Čišćenje shader/DirectX keša - deo čišćenja sesije (D3DSCache, NVIDIA DXCache/GLCache, AMD DxCache)
- [ ] (opciono) Optimizacioni profil po igri - NIJE urađeno i ne planira se: traži održavanje po svakoj igri posebno

### Faza 4 - Paljenje i gašenje preko LAN (Wake-on-LAN)
- [x] Klijent automatski javlja svoje **mrežne kartice** (IP+MAC) serveru pri povezivanju; server bira MAC LAN kartice (poklapanje sa IP-om koji vidi, tako da ne uzme VPN/VirtualBox karticu) i čuva ga (`computers.mac`)
- [x] Server šalje **magic packet** (`node:dgram`, bez zavisnosti; broadcast na portove 9 i 7) - dugme **"Upali"** na svakoj offline kartici + u modalu "Detalji", plus grupno **"Upali sve (N)"** na kontrolnoj tabli; sve upisano u logove
- [x] Gašenje/restart već rade
- [x] Uputstvo za BIOS/mrežnu karticu (WoL mora biti uključen hardverski) - DEPLOY.md §8 (Ethernet, BIOS "Wake on LAN", Windows Power Management/Advanced, isključen Fast Startup)

### Faza 5 - Dodatni meniji i opcije u panelu *(izabrano)*
- [x] **Izveštaji i statistika** - grafikon prometa (po satu/danu), KPI (promet/sesije/shop/dopune), najaktivniji igrači, zarada po računaru, period Danas/7/30 dana
- [x] **Smene i pazar** - tabela `shifts`, logovi (NOVAC/SHOP) vezani za `shift_id`, obavezni modal "Otvaranje smene" za radnika, zatvaranje sa obračunom prometa i usklađivanjem kase (razlika višak/manjak)
- [ ] **Rezervacije računara** - JEDINA veća funkcija koja nije urađena. Nije potrebna za otvaranje; radi se kad se ukaže potreba
- [x] **Vremenski paketi** - ipak urađeni: unapred plaćeno vreme jeftinije od cene na sat (fabrički 5h za 500), prodaju se jednim klikom pri dopuni kredita

### Faza 6 - Launcher (program za igrače) - UI polish
- [x] Uskladiti sa novim brendom (isti dizajn sistem kao panel: flat površine, crveni akcenat, Segoe UI Variable, SVG ikone umesto emojija u navigaciji)
- [x] Lepše igre (cover kartice 3:4 sa play-overlay-em na hover, grupisane po kategorijama, emoji fallback; cover se dodaje u panelu > Igre)
- [x] Doterati login, HUD (čipovi Igrač/Kredit/Preostalo), poruke i dijaloge (stilizovan overlay umesto browser confirm), zaključan ekran (ikona + crvena varijanta za isteklo vreme), toast sa ikonama
- [x] Server: cover slike za igre (`games.image`, upload/brisanje, ista logika kao shop slike)
- [x] **Gaming redizajn launchera** - agresivan arkadni stil (neon crvena + zlatna energija, iskošeni "cut" uglovi, glow, animirana pozadina sa mrežom i energy-sweep-om, ugaoni bracketi na cover-ima, skewovan display font). Launcher ≠ panel: panel ostaje miran/profesionalan za osoblje, launcher je maksimalno gaming za igrače
- [x] **Immersive sloj (v2)** - CRT skenline + vinjeta preko svega, ugaoni HUD okvir tokom gameplay-a, ambijentalne varnice, "library-style" cover kartice (ime na slici + kategorija badge + "POKRENI" reveal sa shine-om), stagger ulazne animacije, pun crveni edge-alarm kad vreme padne < 60s
- [x] **Feedback sloj (v3)** - zvučni feedback (WebAudio sintetizovan, bez fajlova: hover/klik/uspeh/greška/alarm/boot), boot "Dobrodošao, {ime}" sekvenca pri prijavi (logo slam + loading bar), animirano odbrojavanje kredita sa "bump" efektom pri promeni, prelaz sadržaja pri promeni taba
- [x] **Doživljaj sloj (v4)** - coin-burst (zlatni/crveni žetoni) na uspešnu porudžbinu, scan-pass linija pri promeni taba, idle attract na login ekranu (logo lebdi + zlatni CTA trepće nakon 40s praznog hoda, gasi se na prvu aktivnost)
- [x] **BUGFIX: prazan katalog u launcheru** - `welcome` (igre + shop + podešavanja) je stizao pre nego što se renderer učita i bio bi izgubljen. Rešeno dvostruko: main proces bafferuje poruke do `renderer-ready`, a renderer po učitavanju šalje `hello` na koji server ponovo pošalje pun katalog i trenutno stanje

### Faza 7 - Pakovanje i zaključavanje sistema
- [x] `electron-builder` > jedan **.exe instaler** za launcher (`npm run build` u client/), pakuje se sa `napravi-paket.mjs`; paket odbija da nastane ako se verzija instalera ne poklopi sa projektom
- [x] Autostart servera (`Podesi autostart.bat`) i launchera (instaler ga upisuje u pokretanje)
- [x] Kiosk hardening - bez AutoHotkey-a i zamene shell-a: Electron kiosk prozor koji odbija zatvaranje, presretnute prečice (Ctrl+Shift+Esc, Ctrl+Esc, Alt+Esc, Win+R/E/D/L..., F11), HKCU politike (Task Manager, Win tasteri, odjava, gašenje, zaključavanje stanice), zastor preko desktopa, gašenje programa pokrenutih iz Preuzimanja/Temp. Alt+Tab je namerno ostavljen - launcher je ispod svega, pa ne vodi nikuda

### Faza 8 - Pouzdanost
- [x] Automatski **backup baze** (snapshot na start + na 15 min) + WAL checkpoint (2 min)
- [x] **Otpornost na prekid** - naplata se pauzira kad klijent izgubi vezu; sesije se nastavljaju; downtime se ne naplaćuje; auto-restart servera (`start-server.bat` petlja); LAN radi bez interneta (vidi DEPLOY.md §7)
- [x] Rotacija logova (čuva 365 dana, dnevno + na startu; otvorena smena zaštićena)
- [x] **Jedan posao, jedan upis** - porudžbina, račun na kasi i nagradni točak se upisuju kao celina (SAVEPOINT, radi i ugnežđeno). Bez toga nestanak struje između skidanja zalihe i naplate ostavlja piće skinuto a kredit nenaplaćen, i vidi se tek kao neobjašnjiv manjak pri obračunu smene
- [x] **Prostor na disku se održava sam** - logovi se seku po starosti *i po broju* (briše se najstariji da bi novi imao mesto); rezervne kopije se proređuju (gusto blizu, retko daleko: isti broj fajlova pokriva 46 dana umesto 7.5 sati) uz granicu ukupne veličine; pre svake kopije se gleda slobodan prostor. Stanje i granice su u *Podešavanja > Prostor na disku*. Izmereno na napunjenoj bazi: posle 5 godina rada baza 48 MB, kopije 1.4 GB, tvrda granica 2 GB
- [x] **Računar kome je iščupan kabl** - server pinguje svaku vezu na 15 s i gasi onu koja ne odgovori. Bez toga TCP veza ostaje otvorena satima: panel pokazuje računar kao zauzet pa radnik tamo ne posadi nikoga, a naplata teče za praznu stolicu. Zaštita "pauziraj naplatu van mreže" je postojala od ranije, ali se nikad nije ni aktivirala jer server nije imao kako da sazna
- [x] **Otpuštanje radnika** - nalog se gasi a ne briše (smene i dopune moraju da ostanu potpisane); prijava prestaje odmah, postojeći token prestaje da važi, otvoren panel se sam zatvara. Ranije je brisanje pucalo na stranom ključu čim je radnik jednom otvorio smenu, pa mu se pristup nije mogao oduzeti
- [x] **Servisni PIN preživljava nadogradnju** - instaler prepisuje `podesavanja.json` fabričkim, pa se PIN tiho vraćao na `1234` na svakoj mašini pri svakoj novoj verziji
- [x] **Poklonjen kredit se vidi** - nagradni točak i popust na paket stoje u Izveštajima kao trošak, a i dalje ne ulaze u pazar (inače radnik ima manjak koji ne ume da objasni)
- [x] **Uputstvo za nadogradnju** (DEPLOY.md §5.1), uključujući zašto se launcher ne može nadograditi sa panela (instaler traži administratora, a nalog igrača je standardni)
- [x] **Revizija obračuna novca (5 nalaza)** - pazar više ne duplira kupovine sa naloga, otkazane porudžbine se poništavaju u obračunu i ne ulaze u očekivanu kasu, naplata ne prelazi raspoloživi kredit, stanja se čuvaju zaokružena na 2 decimale, zatvorene smene čuvaju konačne brojke (ne preračunavaju se iz logova)
- [x] Kočnica protiv pogađanja PIN-a (5 promašaja > 30 s po računaru)
- [x] **Launcher "home" redizajn** - sve na jednom ekranu sa horizontalnim sliderima (police): igre grupisane po kategorijama + Internet polica; strelice + drag-to-scroll; tabovi svedeni na Početna / Shop / Nalog; brutalne cover kartice za igre i šarene brend-kartice za sajtove
- [x] **Ugrađeni internet pregledač (rešava bag "nema izlaza")** - webview unutar launchera sa punom trakom (nazad/napred/osveži/početna/URL sa lock indikatorom/preostalo vreme/**Izađi**); Escape zatvara; automatski se gasi na lock/odjavu; popup/target=_blank ostaje u istom prozoru; blokada preuzimanja fajlova (kiosk)
- [x] **Hero baner** na Početnoj - izdvojena igra sa cover pozadinom, "POKRENI" dugmetom i pozdravom + preostalim vremenom (uživo); "welcome" varijanta kad nema igara
- [x] **Brendirane internet kartice** - svaka u bojama i sa pravim (inline SVG) logom svoje aplikacije: Steam, Epic Games, Battle.net, Discord, TeamSpeak, YouTube, Twitch, Google, Instagram, Facebook (uklonjeni TikTok/Reddit/Spotify)
- [x] **Fiksni "home" bez skrola** - sve staje na jedan ekran: hero + jedna polica igara sa 7-8 vidljivih većih kartica (klizni slajd sa strelicama, drag) + internet red; igra bez cover slike dobija živopisnu gradijent pozadinu
- [x] **Internet 8 brendiranih kartica** (uklonjeni FB/Instagram/Twitch, dodat Spotify): Steam, Epic Games, Battle.net, YouTube, Discord, TeamSpeak, Google, Spotify - krupnije
- [x] **Internet pregledač = ZASEBAN prozor** (alwaysOnTop, resizable, minimizable) - umanjivanje se odnosi samo na taj prozor, launcher i dalje pokriva desktop (nema bypass-a kioska); vidljiv i preko igre (YouTube + igra istovremeno); nova traka u browser.html/browser.js/browserPreload.js
- [x] **Brutalne shop kartice** - transparentne slike pića na obojenom radijalnom sjaju (boja iz imena), uppercase naziv, veliki cena, crveno "+" dugme, hover lift + rotacija slike
- [x] **Shop kartice prate boju limenke** - dominantna boja se izvlači sa slike (canvas + `img.decode()`), sjaj/okvir/hover u toj boji; veće jasne limenke; shop fiksno bez skrola (centrirano, popunjava prostor)
- [x] **Zalihe pića** - `shop_items.stock` (NULL=∞); porudžbina proverava i skida zalihu, "Rasprodato" u launcheru (bez dugmeta), panel prikazuje stanje + "Dopuni" (dodaje na trenutno)
- [x] **Sakrivanje igre iz launchera** - `games.available`, checkbox u modalu + brzo oko-dugme na kartici; launcher dobija samo dostupne igre
- [x] **Footer centriran + gaming stil** - svi podaci u sredini sa razdelnicima i crveno-zlatnom akcentnom linijom; ikone za svaki podatak
- [x] Sve stranice launchera bez skrola (`overflow:hidden`, fiksni raspored)
- [x] **Donja statusna traka** - naziv PC-a, sat, status servera i interneta, CPU %, RAM %, temperatura CPU-a (best-effort preko WMI)
- [x] **Nalog ekran redizajniran** - profil hero (avatar, ime, kredit/vreme/cena), panel "Kako to radi" + promena lozinke (bez praznog prostora)
- [x] **Baner po igri** za vrh launchera - poseban wide upload u panelu (`games.banner`), hero ga koristi (fallback na cover pa boju); šablon `assets/baner-sablon-1600x500.svg` sa označenim zonama za dugme i tajmer
- [x] **Internet alati potpuno kroz panel** - nova tabela `tools` (Sajt ili Program), meni "Internet alati" u panelu: dodavanje/izmena/brisanje/sakrivanje + upload cover slike (isto kao igre). "Sajt" traži http(s) URL, "Program" putanju do `.exe` ili protokol (npr. `steam://`, `steam.exe`, TS3...) uz argumente. Launcher dobija samo dostupne alate preko `catalog`; kartica prati sliku > brend-logo > slovo. Seed: Steam/YouTube/Discord/Google/Twitch
- [x] **Alati kao pravi programi + realni pregledač** - "Program" alati se pokreću lokalno (`launchGame`, isti put kao igre); "Sajt" alati otvaraju **sistemski pregledač (Chrome)** preko `shell.openExternal` umesto ugrađenog webview-a, tako da igrač koristi **Alt+Tab** između igre i pretraživača. Uklonjen zaseban browser prozor (`browser.html/js`, `browserPreload.js`) i webview iz launchera
- [x] **QA prolaz (celokupan pregled) - 2 ispravke**
  - **KRITIČNO: Shop stranica u panelu je bila potpuno pokvarena** - `renderShop` je koristio promenljivu `i` van dosega (`stockHtml` je bio ispred `card` funkcije), pa je bacao `ReferenceError` pri svakom otvaranju i osoblje nije moglo da dodaje/menja/dopunjava pića iz panela. Ispravljeno (dokazano: 8 kartica + stanje + "Dopuni" se prikazuju, 0 grešaka)
  - **Kredit u launcheru mogao da ostane zastareo dok je prozor minimizovan** (npr. tokom igre) - `countTo` animacija koristi `requestAnimationFrame` koji je pauziran kad je stranica sakrivena; dodat `document.hidden` fallback koji odmah upiše konačnu vrednost
  - Provereno bez grešaka: svih 14 stranica panela, ceo launcher (HUD, tabovi, pokretanje igara/alata, korpa, prazna stanja), naplata/porudžbine/zalihe na serveru, bezbednost SQL-a i owner/staff prava
- [ ] (preporuka) UPS na server + mrežnu opremu

### Faza 9 - Temelji i revizija novca *(strateški plan je u [PROIZVOD.md](PROIZVOD.md))*

- [x] **KEŠ PORUDŽBINA IZ LAUNCHERA KVARILA OBRAČUN SHOPA** - obračun smene
  računa "Shop ukupno" iz logova, "od toga keš" iz tabele porudžbina, a "sa
  naloga" izvodi kao razliku. Keš porudžbina iz launchera jedina nije upisivala
  iznos u log, pa je gost koji kolu od 130 plati kešom radniku u obračun upisivao
  *Shop ukupno 0, sa naloga −130*. Posle otkazivanja je i ukupno postajalo −130.
  Pazar je pri tom bio tačan, pa se greška videla samo u podeli - baš tamo gde
  radnik proverava sebe pred prebrojavanje kase. Kasa je iznos oduvek upisivala;
  launcher je bio izuzetak bez razloga
- [x] **Jedan posao, jedan upis - dopunjeno na sve putanje novca.** Ranije su
  bile pokrivene tri (porudžbina, kasa, točak), a četiri su radile u dva-tri
  odvojena upisa: **dopuna kredita** (kroz nju prolazi svaki dinar preko pulta),
  **prodaja paketa** (najveći pojedinačni iznos, četiri upisa), **otkazivanje
  porudžbine** i **kraj sesije**. Kod kraja sesije je posledica bila najgora:
  sesija zatvorena a računar i dalje nosi igrača, pa panel pokazuje zauzeto,
  radnik nikoga ne posadi, a novi gost ne može ni da se prijavi
- [x] **Zapis u logu je sada deo posla sa novcem.** Obračun smene se ne računa iz
  tabele transakcija nego iz logova, pa log nije beleška o dopuni - on JESTE
  dopuna, koliko se kase tiče. Upis (`upisiLog`) je odvojen od javljanja
  panelima (`javiLog`): upis ulazi u posao i može da ga obori, javljanje ide tek
  po potvrdi - inače radnik u feedu vidi dopunu koje u bazi nema
- [x] **KOPIJA VAN RAČUNARA** - baza i svih trideset kopija su bile na istom
  disku, pa je otkaz tog diska brisao sve odjednom. Server sad jednom dnevno
  odnese najsvežiju kopiju na USB/mrežni folder i drži poslednjih sedam. Panel
  stoji crveno dok nije podešeno i kad kopiranje prestane da radi. Nepostojeće
  odredište je **greška, ne posao**: sa `mkdir -p` bi se napravio nov prazan
  folder na sistemskom disku, kopija bi tiho završila u njemu i vlasnik bi
  mesecima gledao zeleno stanje sa jednim jedinim primerkom baze
- [x] **Launcher pravio dve veze pri promeni podešavanja** - `connectWs` nije
  gasio staru. Server za jedan računar drži samo jednu i zatvori stariju, a njen
  `close` javi rendereru da veze nema (iako nova radi) i zakaže još jedno
  povezivanje. Traka gore je treperila "povezivanje" dok je sve u redu - i to
  baš pri postavljanju mašine, kad radnik i gleda da li se povezalo
- [x] **Verzija na jednom mestu** (`node verzija.mjs 2.45.0`) - dotad se ručno
  usklađivala u `server/` i `client/`, a promašaj se video tek kad paket odbije
  da nastane, posle celog build-a
- [x] **Provera se pušta sama** - `pre-commit` (sintaksa + verzija, trenutno),
  `pre-push` (ceo paket), GitHub Actions na svaku izmenu. Preko 1400 provera je
  dotad zavisilo od toga da se neko seti da otkuca komandu
- [x] **Git** - projekat do tada nije imao nijedan commit. Meseci rada su živeli
  u jednom folderu na OneDrive-u, bez istorije i bez načina da se nađe kad je
  greška ušla
- [x] **RAZVOJNI RAČUNAR VIŠE NE MOŽE DA STRADA OD SOPSTVENOG PROGRAMA.**
  Launcher menja Windows na četiri načina - politike u registru, plan napajanja,
  gašenje pokrenutih programa i **čišćenje sesije**. Poslednje briše profile
  Chrome/Edge/Firefox/Opera/Brave, prijave na Steam/Epic/Riot/Battle.net/EA/
  Ubisoft, skorašnje dokumente i prazni korpu za otpatke - nepovratno. Sve to je
  čuvala **jedna zastavica iz komandne linije** (`--no-lock`), a alati u
  `testovi/` puštaju pravi launcher: dovoljno je da je jedan zaboravi. Sada
  postoje tri nezavisne brave:
  1. `app.isPackaged` - **nepakovan launcher ne dira Windows**. `npm start`,
     `electron .` i svaki alat odavde daju netačno, a nijedno od toga nije
     računar u igraonici. Ovo se ne može zaboraviti jer se ništa i ne kuca.
     Za nepakovanu probu SA zaključavanjem postoji `--zakljucaj`
  2. postojeće `--dev` / `--no-lock` / `bez-zakljucavanja.txt`
  3. fajl **`CRIT-NE-DIRAJ.txt`** u korisničkom folderu - čišćenje se odbija bez
     obzira na sve ostalo. Provera je prva u `ocistiSesiju`, po imenu fajla, i
     ne zavisi ni od jedne zastavice
  Uz to test koji čita svaki alat u `testovi/` i ne da da neki pusti pravi
  launcher bez brave, ni da postavi bravu POSLE učitavanja
- [x] **„Promet danas" na kontrolnoj tabli lagao je na dve strane.** To je
  jedina brojka koju vlasnik pogleda u prolazu, sa telefona. (a) **Nije videla
  nikoga ko trenutno igra** - trošak sesije se u `transactions` upisuje tek pri
  završetku, pa je u osam uveče, sa deset zauzetih mašina po dva sata,
  nedostajalo oko 2400 dinara; „zarada po računaru" u Izveštajima ih je pri tom
  videla, pa su se dva broja na istoj strani razilazila. (b) **Brojala je
  otkazane porudžbine** - keš jer filter po statusu nije ni pisan, a kupovina sa
  naloga jer se čitala iz `transactions`, gde povraćaj ulazi kao zaseban red i
  original ne poništava. Obračun smene i Izveštaji su otkazano oduvek izbacivali;
  tabla je jedina pokazivala više, i to zauvek
- [x] **Proba koja menja miša i zvuk se ne pušta na razvojnom računaru** -
  `proba-podesavanja.mjs` stvarno menja mašinu na kojoj se pusti (tako se to
  jedino i može proveriti). `node pokreni-probe.mjs` pušta sve alate, pa bi
  usput promenio miša usred posla. Sad se odbija na mašini sa
  `CRIT-NE-DIRAJ.txt`, i vraća zatečeno i kad se prekine sa Ctrl+C - dotad je
  vraćanje stajalo samo u `finally`, koji prekid ne hvata
### Revizija launchera (ekran koji igrač gleda)

- [x] **OTKLJUČAVANJE RAČUNARA GASILO JE LAUNCHER.** Čim se otvori prozor za
  admin izlaz (`Ctrl+Alt+Shift+Q`), launcher upamti „izlazim" — i onda ga je
  **bilo kakvo** otključavanje gasilo: radnik sa panela, *Otključaj sve* (gasi
  svaku takvu mašinu odjednom), ili sam igrač PIN-om na zaključanom ekranu.
  Mašina ostaje bez launchera do sledećeg paljenja. Splet okolnosti nije redak
  nego svakodnevni: na zaključanom ekranu stoje **dva polja za PIN**, pa radnik
  ukuca u ono koje mu je bliže. Uzrok: ostatak iz vremena kad je admin izlaz išao
  kroz istu poruku kao otključavanje
- [x] **Zaglavljena vrtnja točka zamrzavala je kredit ZAUVEK.** Klik upali
  „vrtnja traje", a ishod se čeka sa servera; dok vrtnja traje launcher namerno
  odbacuje svako novo stanje kredita (da se brojka ne promeni pre nego što igrač
  sazna šta je dobio). Ako odgovor nikad ne stigne — veza pukne baš u tih pet
  sekundi — HUD ostaje zamrznut dok naplata teče: igrač gleda „1000 din, ostalo
  8:20" dok mu vreme curi, računar se zaključa bez upozorenja, a dopuna na kasi
  se ne vidi pa radnik dopunjuje drugi put. Sada rok od 12 s i otpuštanje čim
  veza padne. Prijava i porudžbina su rok imale od ranije; točak je bio jedini bez
- [x] **Način plaćanja se nije vraćao.** Kad kredita nema, program sam prebaci na
  keš — ali nikad nazad. Igrač sa 100 din doda kolu od 130 (skoči na keš),
  predomisli se i uzme vodu od 80: kredit sad ima, a i dalje piše „Keš". Isto i
  kad ga radnik dopuni. Gost plaća kešom nešto što je već platio, a radnik ustaje
  bez potrebe. Sada se pamti da li je keš bio **igračev** izbor
- [x] **Escape nije čistio ono što čisti „Odustani"** u prozoru za PIN — svrha je
  ostajala od prošlog otvaranja. Danas se ne može iskoristiti, ali svrha koja
  preživi odustajanje bi pri prvoj sledećoj upotrebi obrisala launcheru adresu
  servera umesto da izađe iz kioska
- [x] Pregledani i **bez nalaza**: tajmeri (svi se gase pre postavljanja, nema
  gomilanja), slušaoci događaja (svi na `document`, registrovani jednom),
  bekstvo teksta u HTML (`esc` svuda gde ulaze podaci iz baze), korpa i
  ograničenje količine, pokretanje igara, donja statusna traka
- [x] **DUGME JE POD MIŠEM POSTAJALO CRVENO.** `.btn-primary:hover` je imao
  upisanu crvenu (`#ff4040`) — ostatak palete od pre nego što je kuća postala
  plava. Crvena u ovom programu znači *ističe vreme* i *zaključano*, pa je dugme
  „Poruči" pod mišem izgledalo kao da nešto nije u redu, baš u trenutku kad
  igrač hoće da ga pritisne — a to je isto dugme na svakom ekranu: prijava,
  Poruči, Sačuvaj lozinku, Uzmi VIP, Zavrti točak. Svetliju nijansu kuće **već
  računa server** (`nijanse().hover`) i šalje je uz brend; panel je koristi kao
  `--accent-hover`, launcher je jedini nije uzimao — pa je hover morao da bude
  upisan u kod, a upisana boja ne prati izbor vlasnika. Isto je bilo i na
  prečicama: hover je uzimao boju izvučenu iz samog logotipa, pa je YouTube
  svetleo crveno. Sada `test-znacenje-boja` čuva da nijedan hover ne uvede boju
  koja nešto znači
- [x] **Isključeno dugme je pod mišem postajalo plavo.** `.btn:disabled:hover` je
  vraćao podlogu na plavi preliv glavnog dugmeta — i to na *svako* isključeno
  dugme, i sivo i providno. Izgledalo je kao da može da se pritisne baš kad ne
  može. Uz to je crven sat („ističe vreme") svetleo bojom kuće umesto svojom
- [x] **Polica igara oživi dok se skroluje** — nagib u smeru kretanja (ugao ide
  od *brzine*, pa se spor pokret jedva primeti a nagli oseti), paralaksa omota
  unutar okvira, i utišavanje pločice srazmerno tome koliko je ivica police
  seče, pa utišana pločica govori jedno: „ima još, pomeri". Petlja radi samo dok
  se nešto stvarno pomera, a igrač koji je ugasio animacije ne dobija nijednu.
  Prva verzija dubine je **skupljala okvir**, a ime igre stoji unutar tog okvira
  — naslovi na polici nisu stajali u istoj liniji, razlika 46px, i to je
  izgledalo kao pokvaren red a ne kao dubina. `proba-police.mjs` zato meri i
  gde stoji svako ime, jer su sve ostale provere merile samo da li se vrednost
  promenila — nijedna da li polica posle toga lepo izgleda
- [x] **Profil je govorio drugim oblikom od ostatka programa.** Sve u launcheru
  ima odsečen ugao i unutrašnji prsten umesto okvira; profil je jedini držao
  zaobljene kartice — a značke stoje *tačno ispod* njegovih brojki, na istom
  ekranu. Zlatna tačka koja kaže šta ide uz članarinu lebdela je u praznom iznad
  čipa (postavljena je za krug, gde sedi na ivici) i izgledala kao mrlja na
  ekranu; sada je na čipu unutra, uz sam naziv. Dugme „Sačuvaj lozinku" nije
  bilo poravnato sa poljima: `.field` nosi donju marginu za slučaj kad polja
  stoje jedno ispod drugog, a ovde su u istom redu — margina je gurala polja
  naviše, a dugme ostajalo spušteno
### Faza 10 - Priprema za izdavanje drugim igraonicama

Cilj nije licenciranje sada, nego da program prestane da bude „program za jednu
igraonicu". Prvo sve mora da radi kako treba; licence dolaze posle.

- [x] **SERVISER KAO TREĆA ULOGA.** Odozdo nagore: radnik < vlasnik < serviser.
  Viša sme sve što sme niža, ali **niko ne dira sebi ravnog ni višeg**. Pravljenje
  naloga ide do svoje uloge (vlasnik sme drugog vlasnika — igraonica sa dva gazde
  je normalna stvar), menjanje i uklanjanje samo ispod nje, pa se dva vlasnika ne
  mogu međusobno isključiti. Prvi serviserski nalog nastaje sa glavnog računara
  (`alati/serviser.mjs`), jer na svežoj instalaciji servisera nema pa ne može da
  se napravi kroz panel. Nalog se **vidi** na spisku, označen: nalog sa pristupom
  tuđim podacima ne sme da bude sakriven od onoga čiji su podaci
- [x] **IZGLED PO IGRAONICI** - znak i boja se podešavaju iz panela i menjaju se
  svuda odjednom, u panelu i na svim launcherima. Dok su stajali ušiveni u
  fajlove, druga igraonica je morala da dobije prepravljenu kopiju programa - pa
  bi i svaka nadogradnja morala da se pravi posebno za svakoga. Vlasnik bira
  **jednu** boju, nijanse se izvode iz nje. Zelena, zlatna i status boje se ne
  diraju: one nose značenje, nisu ukras
- [ ] **HTTPS na panelu i ka launcheru** - *sledeće na redu od bezbednosnih stvari.*
  Lozinke osoblja i igrača, i token panela, putuju mrežom **u čistom tekstu**.
  Na WiFi-ju koji dele gosti to znači: neko sa laptopom i uobičajenim alatom
  uhvati vlasnikovu lozinku, uđe u panel i sam sebi upiše kredit. Nije teorija,
  to je najjeftiniji napad na ovaj program.

  Ne radi se naprečac jer je pola posla gore od nikakvog: samopotpisan sertifikat
  znači upozorenje u pregledaču na svakom telefonu osoblja (a ljudi nauče da
  kliknu "nastavi", pa upozorenje prestane da išta znači), i traži da se
  sertifikat uveze na sve mašine. Node nema ugrađen alat za pravljenje
  sertifikata, pa treba ili nova zavisnost ili Windows-ov
  `New-SelfSignedCertificate`. Ništa od toga se ne može ispitati sa razvojnog
  računara - traži pravu mrežu, prave telefone i 13 mašina.

  **Dok se ne uradi**, jedina stvarna zaštita je mrežna i ne košta ništa: panel
  se ne otvara preko WiFi-ja na kom su gosti. Upisano u DEPLOY.md.

- [ ] **Licence** - *planirano, i tek posle svega ostalog.* Uslovi rada vezani za
  serviserski nalog; CRIT ostaje bez licence. Ne kreće dok program ne odradi
  sezonu u ovoj igraonici bez ijednog kvara
- [x] **Ime igraonice se menja na jednom mestu** (`igraonica.json` + `node igraonica.mjs "Ime"`). Ranije je `Crit` stajao u `appId` instalera, u prečici, u imenu foldera instalacije i u alatima za oporavak - pa bi svaka nova igraonica dobila instaler sa tuđim imenom, a njeni `.bat` alati gasili proces koji na toj mašini ne postoji i pri tom javili da je sve prošlo. Unutrašnja imena (`crit.db`, `CRIT_DATA_DIR`) namerno ostaju - preimenovanje baze bi odseklo postojeće podatke. Šara sa imenom kuće se sada crta od naziva iz Podešavanja, pa se menja bez nove verzije launchera. Provera (`test-ime-igraonice.mjs`) preimenovanje stvarno izvrši u memoriji i gleda šta je preživelo - tako je i našla dva promašaja, od kojih je jedan ostavljao `POPRAVI-RACUNAR.bat` u uverenju da launcher još radi

- [x] **Ubačena skripta se ne izvršava** - panel i launcher prihvataju samo skripte sa svog servera (CSP). Sve što ljudi upisuju već prolazi kroz `esc()`, ovo je druga brana: i da jedno mesto ikad promaši, skripta ne može da se pokrene. Bitno baš ovde jer se iz panela upisuje kredit - skripta u vlasnikovom pregledaču ne mora ništa da provaljuje, ona **već jeste** vlasnik. Provereno u pravom pregledaču (pregled slike, izvoz izveštaja i živa veza rade, ubačena skripta ne prolazi) i sa 17 alata na pravom Electronu
- [x] **Kopija koda van računara** (`node alati/kopija-koda.mjs D:\kopije`) - baza je odlazila van računara, sam program nije: kod i istorija su postojali samo na razvojnom laptopu. Jedan fajl sa svim granama i commitovima, provereno da se iz njega stvarno klonira ceo projekat. Odredište koje ne postoji je greška, ne poziv da se napravi

- [x] **Iskustvo i nivoi** - jedan potrošen dinar = jedan XP. Deset nivoa sa imenima vezanim za ime igraonice (Prvi ulazak → Zagrevanje → Pogodak → Serija → Kritičan → Dupli krit → Trostruki krit → Nezaustavljiv → Legenda kuće → Savršen krit), razmak između njih raste. Bronzu i Srebro ima svaka igraonica; ovo ima samo ova. **Dopuna NE donosi iskustvo**, samo potrošnja: dopuna je obećanje, potrošnja je ono što se stvarno desilo, a ko dopuni 5000 i ode kući nije igrao. Poklonjen kredit i nagrada sa točka takođe ne donose - to je kuća dala, i inače bi točak bio prečica do nivoa. Račun nivoa je izdvojen (`server/src/nivoi.js`) i proverava se bez servera: iz jednog broja izlaze nivo, naziv i koliko fali
- [x] **Profil igrača** - nalog je do sada bio spisak radnji (poruči, promeni lozinku), pa nije bio ničiji. Sada je prva strana profil: znak sa okvirom, ime u boji koju je izabrao, nivo i traka, brojke koje je sam napravio (sati, posete, poručeno, omiljena igra) i spisak onoga što ga tek čeka. Poslednje je namerno - nagrada koja se ne vidi unapred ne motiviše da se dođe ponovo
- [x] **Otključavanja** - svoja šara (2. nivo), boja imena (3), okvir oko znaka (4). Sve se **proverava na serveru**, ne samo skriva dugme: launcher stoji na računaru igrača, pa poruka koja stigne mimo njega dobija isti odgovor
- [x] **Nov nivo se vidi i čuje** - obaveštenje preko ekrana sa onim ŠTA je otključano, traka bljesne. Bez toga bi napredak postojao samo u bazi, a otključana stvar stajala neiskorišćena jer niko nije rekao da postoji
- [x] **RANG SE ZARAĐUJE, VIP SE KUPUJE** - dok je VIP bio nagrada za peti nivo, bio je **trošak**, i to baš na najboljim gostima: kuća je pravila popust onima koji bi ionako došli. Sada su to dve odvojene stvari - rang dolazi od igranja, besplatan je i on je *status*; VIP se plaća i on je *prihod*. Plaća se kreditom, koji je gost već uplatio kešom na kasi: ne uzima kući ništa, nego pretvara stajaći kredit u prihod, samouslužno i bez radnika. Od pet pogodnosti samo jedna (niži prag za točak) je stvarni trošak, i podesiva je. Pamti se **rok, ne zastavica** - zastavica bi tražila da neko svakog dana gasi istekle naloge, a taj se posao preskoči baš onog dana kad server ne radi; obnova se **nadovezuje**, da gost koji obnovi dan ranije ne nauči da čeka da mu istekne
- [x] **Značke** - 25 u pet grupa, sve se računaju **retroaktivno** iz podataka koji već postoje: gost koji dolazi šest meseci otvori profil prvog dana i zatekne zid zarađenih. Zaključane se **vide, sa trakom** ("98 / 100") - dva sata do značke teraju čoveka da dođe, prazan ekran ne tera nikoga
- [x] **Rang lista igraonice** - nije spisak najboljih nego **tvoje mesto u njemu**. Gola tabela prvih deset radi samo za tih deset; jedanaesti je pogleda jednom, vidi da mu do vrha fali pola godine, i više je ne otvori - a on je onaj koga je trebalo pokrenuti. Zato prvo stoji tvoje mesto i koliko ti fali do sledećeg, pa komšiluk (dvojica iznad, dvojica ispod), pa tek onda vrh. Rangira se po **iskustvu, ne po potrošnji**: iznos koji je ko ostavio u kasi nije za javni ekran. Privremeni gostujući nalozi i blokirani ne ulaze
- [ ] **Pravila XP-a se dorađuju u hodu** - *sledeće na redu.* Kriva nivoa i spisak otključavanja su prvi predlog; kad se vidi kako se igraonica ponaša, pragovi se podešavaju u `nivoi.js` (tablica je na jednom mestu, bez diranja ostalog). Za dalje: nagrade koje nisu izgled (npr. besplatan spin točka na nivo, popust na piće) - to traži odluku vlasnika, ne kod

### Revizija panela (ono što osoblje gleda ceo dan)

- [x] **DUPLI KLIK NA „NAPLATI" NAPLAĆIVAO JE DVAPUT.** Dugmad koja pomeraju
  novac nisu se zaključavala dok server ne odgovori. Izmereno u pravom
  pregledaču: **tri klika = tri računa, 390 dinara umesto 130**; tri klika na
  „Dodaj" pri dopuni = **1500 kredita umesto 500**. Najskuplji je bio *Brzi
  gost*: dupli klik pravi dva seta naloga sa kreditom, a lozinke prvog seta se
  posle ne mogu videti nigde. U launcheru je ta zaštita postojala od ranije; u
  panelu je nije bilo, a baš se on koristi u gužvi
- [x] **Grupno „Zaključaj" i „Odjavi" prekidali su meč bez ijednog pitanja.**
  Na računaru sa igračem obe akcije zatvaraju sesiju i gase igru — isto što radi
  i „Ugasi", ali su „Ugasi" i „Restart" imali potvrdu a ova dva nisu. Potvrda sad
  kaže **koliko ih trenutno igra**; prazni računari se ne pitaju, jer se pitanje
  bez sadržaja nauči da se preskače
- [x] **Otkazana porudžbina nije vraćala piće na stanje.** Kredit jeste, zaliha
  ne — svako otkazivanje je trajno „pojelo" po jedno piće iz evidencije. Kroz
  mesec dana launcher piše *Rasprodato* nad punim sanducima, a traka za dopunu
  doziva radnika na artikle kojih ima. Uz to, dugme `×` stoji tik uz
  „Dostavljeno" a radi nešto sasvim drugo — sad pita, i kaže šta se dešava sa
  novcem
- [x] **Blokiranje naloga** takođe prekida sesiju i gasi igru, a išlo je bez
  pitanja i bez hvatanja greške — kad zahtev padne, radnik ne vidi ništa i misli
  da je nalog blokiran
- [x] Pregledani i **bez nalaza**: promena cene po satu (ima odličnu potvrdu sa
  primerom na brojkama), oduzimanje pristupa radniku (upozorava na otvorenu
  smenu), brisanje naloga igrača, pretraga naloga na kasi, logovi
- [x] Provereno u pregledaču posle svih izmena: **svih 15 strana panela se
  otvara bez ijedne greške**
- [x] Uklonjen mrtav kod iz `auth.js` (tokeni igrača koje niko nije pozivao);
  `.claude/launch.json` je pokazivao na port 8090, server radi na 8095
- [x] **Fabrički servisni PIN više nije tih** - launcher uz MAC adrese javlja i
  da li mu je servisni PIN još `1234`. Kontrolna tabla stoji crveno i **nabraja
  imena mašina** (bez imena vlasnik zna da negde nešto fali, ali mora da obiđe
  svih trinaest da nađe koju), a zapis ide i u Logove. Stariji launcher to ne
  šalje - tada se ne dira poznato stanje, jer prazno polje znači "ne javlja", ne
  "u redu je"
- [x] **SERVISNI PIN SE UPISUJE JEDNOM, U PANELU.** Ručno upisivanje u
  `podesavanja.json` na svakoj mašini nije bila nezgodna procedura nego loš
  dizajn: PIN koji se menja na trinaest mesta ne promeni se nigde. Ostajao je
  fabrički `1234` - baš onaj kojim igrač koji iščupa mrežni kabl preusmerava
  računar na svoj server. Sada: upiše se u Podešavanjima, stigne na sve
  launchere odmah, i **fabrički prestaje da važi na svima odjednom**. Šalje se
  kao **heš**, ne kao sam PIN (server nikad ne šalje `unlock_pin` klijentima -
  isto pravilo važi i ovde), pa ne putuje mrežom niti stoji čitljiv na računaru
  igrača. Radi i kad server ne radi, jer tada i služi. Ručni PIN iz
  `podesavanja.json` i dalje prolazi kao rezerva - namerno, jer pogrešna
  strogost ovde zaključava osoblje na svih trinaest mašina
- [x] **Nadogradnja launchera sa panela** - instalater se postavlja jednom, na server, a računari ga preuzimaju sami čim se oslobode. Ranije je bilo 13 mašina × ručna prijava na administratorski nalog po svakoj verziji; to se uradi dvaput, treći put se preskoči, i za mesec dana u prostoriji stoji pet različitih verzija. Fajl sam po sebi ne znači ništa - dok ga serviser ne *pusti u rad*, niko ga ne preuzima ni sa ispravnim tokenom. **Računar na kom neko igra se ne dira** (nadogradnja gasi launcher, a usred plaćenog sata to je oduzeto vreme gostu). Adresu preuzimanja sklapa sam računar, svojim tokenom - u poruci nema linka, pa podmetnuta poruka ne može da pokrene tuđi `.exe` na 13 mašina; uz najavu ide sha256 koji se proverava pre pokretanja
- [x] **Računar se vraća i kad nadogradnja ne uspe** - instalaciju vodi skripta koja živi duže od launchera, uz *osigurač* koji ga vraća posle pet minuta bez obzira na sve. Proba koja tu skriptu STVARNO pokreće (`test-pomocnik-nadogradnje.mjs`) našla je dva kvara koja se čitanjem koda ne vide: launcher je pokreće bez konzole, a tamo `tasklist` tiho odgovara "nema ga" (launcher bi se vratio nasred instalacije) i `start /wait` se nikad ne vrati (računar bi ostao bez launchera do kraja smene). Obe stvari rade savršeno kad se skripta pokrene ručno
- [x] **Instalacija po korisniku** (`perMachine: false`) - bez toga bi nadogradnja stigla do mašine pa čekala UAC prozor koji za kasom niko neće odobriti, a razlog se ne bi video ni u jednoj poruci. Launcheru administrator ionako nije trebao: politike piše u `HKCU`, `powercfg` menja korisnikov plan, autostart je prečica u njegovom `Startup` folderu. `Program Files` je čuvao samo sam fajl launchera - a igrač koji ume da pokrene svoj program pod svojim nalogom i danas može da ugasi launcher i obriše prečicu, pa kiosk pada i bez toga; prava brana je spisak dozvoljenog za pokretanje. Traži **jedan poslednji ručni obilazak** svih 13 mašina (deinstalacija stare, pa instalacija sa naloga igrača), postupak u DEPLOY.md §5.1
- [x] **Boja igraonice se bira, proba i tek onda primenjuje** - polje za heks i sistemski birač su radili, ali su tražili da vlasnik ZNA koja boja valja: da se čita na tamnoj podlozi, da nosi belo slovo na dugmetu i da se ne pomeša sa bojama koje ovde nešto znače. Sada spisak od deset gotovih (svaka provereno bez zamerke), proba **ograničena na svoj okvir** (panel se ne prefarbava dok se ne potvrdi, pa nema utiska da je primenjeno nešto što nije), i u toj probi stoje zelena, zlatna i crvena jedno pored drugog sa bojom kuće - sudar značenja se vidi odmah, a ne tek u igraonici. Boja koja upadne u tuđe značenje, ili je pretamna/presvetla, dobija **upozorenje a ne zabranu**: igraonica je vlasnikova. Zamerke i izvedene nijanse računa server, iste one koje dobija launcher; dugme "Vrati fabričku" čita fabričku sa servera - panel ju je ponavljao, pa je vraćao staru crvenu i posle promene fabričke
- [x] **Tekst koji se čita sa metar udaljenosti** - treći stepen teksta davao je odnos prema podlozi 2.6-4.1:1, ispod granice od 4.5:1, i to na 9px. Njime su pisane baš oznake koje kažu ŠTA je broj pored njih ("KREDIT", "PREOSTALO"), a launcher se gleda iz stolice, ne iz ruke. Sada 4.6-6.6:1 na svakoj podlozi, donja granica veličine 11px, ista vrednost u panelu i launcheru. `test-citljivost.mjs` računa odnos iz same vrednosti u fajlu, pa ga ne čuva prepisana kopija
- [x] **Zlatna znači nagradu, ne ukras** - oznaka kategorije igre bila je zlatna: dvanaest zlatnih natpisa na polici, tačno ispod zlatne VIP trake, pa je oko vuklo ono što ništa ne znači. Uz to su `--amber` i `--gold` bile isti heks, pa je "malo na stanju" izgledalo kao nagrada - razlika je postojala samo u imenu, a ime igrač ne vidi. `test-znacenje-boja.mjs` poredi TON, ne vrednost
- [x] **Šara koja se ne nameće** - lestvica providnosti bila je 0.45/0.75/1, pa se i najtiša postavka čitala kao vodeni žig preko celog ekrana i naslov police je stajao na reči koja se ponavlja. Sada 0.22/0.42/0.7
- [x] **Jedna lestvica veličina slova** - launcher je nosio 23 različite (11, 11.5, 12, 12.5 ...), panel 19 svojih. Nijedna razlika se ne vidi kao greška, ali se vidi kao neurednost. Lestvica 11 12 13 14 15 17 19 24 30 36 44 64, sa jednim zapisanim izuzetkom (donja navigacija na telefonu)
- [x] **Tačkica kao separator** - profil je pisao "Srebro &middot; nivo 3": na ekranu tačkica, u fajlu ne, pa je prošlo pored pravila koje traži sam znak. Pravilo sada gleda i HTML zapis i važi i za panel; gde treba razdvajanje, stoji NACRTANA tačkica (ne raste sa fontom i ne završi u kopiranom tekstu)
- [x] **"Profil se učitava..." koji nikad ne prestane** - profil stiže uz prijavu; ako baš tada pukne veza, ostajao je prazan ekran sa natpisom koji nije istinit - niko ništa nije tražio, pa ništa ne bi ni stiglo. Sada launcher sam zatraži profil, a posle šest sekundi kaže šta je i ostavi dugme
- [x] **Jedna polica po kategoriji** - ko u utorak upiše "Piće" u četvrtak upiše "pice", i u launcheru osvanu dve police za istu stvar. Server sada poklapa ono što se sigurno zna da je ista reč (veliko/malo slovo, razmak, kvačica); stvarno drugačiji zapis se ne dira, ali panel nudi postojeće kategorije ispod polja
- [x] **Internet proverava server, ne trinaest mašina** - svaki launcher je učitavao `google.com/favicon.ico` svakih 30 sekundi: oko 37.000 poziva dnevno iz igraonice, i pogrešan odgovor čim baš Google negde zapne. Sada server proverava jednom u minutu i javlja **samo na promenu**, na adresu napravljenu za tu proveru (prepozna se i kad gostinska mreža podmetne svoju stranicu). Kad server ne radi, launcher piše "Internet: -" umesto da izmišlja
- [x] **Klijent, korak po korak** - prolaz kroz svaki ekran launchera, sa merenjem umesto procene:
  - **Alat koji meri je i sam lagao** - `pregled-electron` je "merio" koliko je gornja traka prazna preko elemenata kojih u ovoj verziji nema, pa je vraćao prazno a u izveštaju stajalo "(null)". Merenje koje ćuti izgleda isto kao merenje koje kaže "sve je u redu". Uz to su se izmerene brojke (visina trake, višak u polici) ispisivale **samo kad nešto padne**, a baš po njima se odlučuje kako ekran izgleda. Electron se pokretao preko `.cmd` omotača, pa je `kill()` ubijao omotač a launcher nastavljao u sledeću probu
  - **Shop: traka koja laže** - "Porudžbina se sprema" ostajala je i pošto je piće doneto, jer se na promenu statusa crtao samo Nalog - a igrač koji poruči obično ostane u Shop-u
  - **Shop: drugi red bez cene** - u CSS-u je pisalo da na 1366x768 dva reda kartica moraju da stanu bez skrolovanja; nije važilo čim igrač ima porudžbinu u toku, jer traka pojede 49 px i drugi red se preseca kroz cenu i dugme "+". Izmereno u pravom Electronu, visina slike vezana za stvarno raspoloživo
  - **Četiri CSS promenljive koje nigde ne postoje** - `--ease-out` (10 animacija i prelaza koji NISU radili), `--t-brzo` (5 prelaza), `--font-naslov`, i `--brand` u panelu (izabrana šara bez vidljivog okvira). CSS na nepoznatu promenljivu bez rezerve odbaci celo pravilo, bez ijedne greške
  - **Ploča Naloga visoka koliko sadržaj** - "Promena lozinke" (dva polja i dugme) sedela je u kartici od 750 px, od čega 630 px prazno
  - **Jedno prazno stanje umesto četiri** - igre, prečice, korpa i prazan shop imali su četiri različita izgleda; prvog dana u novoj igraonici baš to vlasnik i vidi. Prazan shop više nema ni korpu (dve prazne poruke jedna pored druge)
  - **Obaveštenje preko igre nosi boju kuće** - zaseban je prozor i ne vidi CSS launchera, pa je nosilo plavu upisanu u fajl, istu u svakoj igraonici. A to je jedino što igrač gleda dok je u igri
  - **Nagradni točak više nije crven i crn** usred plavog i zlatnog programa; crvena tu još i protivreči sama sebi, jer u ostatku znači "ističe vreme"
  - **Poruka o kvaru kaže i šta sad** - provere pre pokretanja odavno završavaju sa "Pozovite osoblje", a one koje nastanu kad pokretanje stvarno pukne nisu. Miš i zvuk su igraču slali sirovu PowerShell grešku, u istom fajlu koji to za igre izričito zabranjuje; a čitanje koje pukne prikazivalo je klizač na vrednosti 10 kao da je to stanje njegovog miša
- [ ] **Program Files uz zakazani zadatak** - *sledeće na redu, kad bude sertifikata*. Vraća launcher u `Program Files` a nadogradnju i dalje pušta samu: instaler pri postavljanju napravi zakazani zadatak sa punim pravima i zapiše adresu servera tamo gde igrač ne može da piše. Ne radi se sada jer se NSIS skripta, ACL-ovi i `schtasks` **ne mogu isprobati sa razvojnog računara** (ovde se ništa ne instalira), a neisprobana instalaciona skripta na 13 mašina je veći rizik od onoga što rešava. Sertifikat za potpisivanje koda treba nabaviti ionako, zbog SmartScreen upozorenja pred prodaju

---

## Šta ostaje pred otvaranje

Ovo su jedine stvari koje se **ne mogu proveriti sa razvojnog računara**. Sve
ostalo je pokriveno testovima (`testovi/README.md`).

- **Proba na mašini sa instaliranim Steam-om.** Ovde nema Steam-a, pa se ne vidi
  kako se ponaša njegov ugrađeni pregledač ni dijalozi za fajlove unutar kioska.
- **Vizuelni pregled panela sa pravog telefona.** Emulacija pokazuje raspored,
  ali ne i kako izgleda na staklu u ruci.
- **UPS na server i mrežnu opremu** (preporuka, nije softver).

Nije urađeno namerno, sa razlogom zapisanim uz svaku stavku: rezervacije
računara (Faza 5), gašenje bloatware-a i odlaganje Windows Update-a (DEPLOY.md
§3.2), profili optimizacije po igri.

## Napomene
- Vizuelni izgled se potvrđuje na tvom ekranu/telefonu (u razvojnom okruženju ne vidim piksele).
- Redosled faza je predlog - možemo da menjamo prioritete u hodu.
