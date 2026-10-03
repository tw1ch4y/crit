# CRIT - sistem za igraonicu

Kompletan launcher i upravljački sistem za igraonicu **Crit**.

Sastoji se iz dva dela:

| Deo | Gde se pokreće | Šta radi |
|-----|----------------|----------|
| **`server/`** | Glavni računar | Server + admin panel (desktop i telefon), baza, naplata vremena, shop |
| **`client/`** | Svaki računar igrača | Kiosk launcher: login igrača, igre, internet, shop, otključavanje |

Računari su povezani LAN kablom preko switcha. Launcheri se povezuju na server preko lokalne mreže.

---

## Brzo pokretanje (test na jednom računaru)

### 1. Server (glavni računar)

```
cd server
npm install        (samo prvi put)
npm start
```

U konzoli piše adrese panela, npr:
```
Crit server radi na portu 8095
  ovaj racunar:  http://localhost:8095
  mreza/telefon: http://192.168.0.10:8095
```

Otvori panel u browseru. Prijava: **admin / admin** (obavezno promeni šifru u Podešavanjima).

### 2. Launcher (računar igrača)

```
cd client
npm install        (samo prvi put)
npm run dev        (test u prozoru - NE preko celog ekrana)
```

Pri prvom pokretanju launcher traži:
- **Adresa servera** - npr. `http://192.168.0.10:8095` (IP glavnog računara)
- **Token računara** - nalazi se u panelu > **Računari**

Za pravi rad na računarima igrača koristi `npm start` (kiosk preko celog ekrana).

> Kompletno postavljanje (autostart, zaključavanje sistema, više računara) je u **[DEPLOY.md](DEPLOY.md)**.

---

## Kako radi (ukratko)

- **Nalozi** - praviš ih u panelu (Igrači > Novi nalog). Svaki igrač ima korisničko ime, lozinku i **kredit u dinarima**.
- **Brzi gost** - za grupu koja uđe sa ulice bez naloga. Otvara do deset naloga odjednom (`gost-01`, `gost-02`...) sa četvorocifrenom lozinkom koja se izdiktira gostima. Kad se potroše, vlasnik ih čisti jednim dugmetom; briše samo one bez kredita, starije od dan, koji nisu za računarom.
- **Naplata** - dok je igrač prijavljen, kredit se troši po ceni na sat (Podešavanja > Cena po satu). Kad kredit padne na nulu, računar se **automatski zaključa**.

### Šta igrač sme da menja

Windows podešavanja su na računarima igrača zaključana, pa igrač do skoro nije
imao kako da namesti ni miša. U launcheru, **Nalog > Miš i zvuk**, stoji ono što
je za igru bitno a bezbedno je menjati:

- **brzina pokazivača** i **ubrzanje pokazivača**. Ubrzanje je za pucačine
  najvažnije: dok je uključeno, brži potez rukom pomeri pokazivač dalje, pa se
  nišan ne može naučiti. Fabrički se drži isključeno.
- **jačina zvuka** celog računara
- **zvuci i animacije u samom launcheru** (animacije se gase na slabijoj mašini)

Sve važi samo dok je igrač prijavljen. **Kad se odjavi, launcher vraća ono što
je zatekao**, pa sledeći gost ne nasleđuje tuđa podešavanja.

> **Rezolucije i osvežavanja ekrana namerno nema.** Windows ume da prihvati
> režim koji monitor ne prikaže: ekran ostane crn, a igrač u kiosku nema čime da
> vrati staro. Ko traži drugu rezoluciju, javi se osoblju.

### Kredit i vreme

Sistem čuva **samo kredit u dinarima**. Vreme se nigde ne pamti nego se uvek
računa: `preostalo vreme = kredit ÷ cena po satu`. Zato se svuda - u panelu, u
launcheru, na tajmeru i na zaključanom ekranu - vidi isti broj.

Iz toga slede tri stvari koje je dobro znati unapred:

- **Promena cene po satu menja preostalo vreme svima koji trenutno igraju.**
  Ko je uplatio 600 pri ceni 120 ima pet sati; čim cena pređe na 150, isti taj
  kredit vredi četiri. Panel te zato upozori pre nego što sačuvaš izmenu, i
  pokaže primer na brojkama. Kredit se pri tome ne dira - menja se cena, ne
  novac koji je gost uplatio.
- **Vremenski paket je kredit, ne sat.** "5 sati za 500" pri ceni 120 upisuje
  600 kredita: 500 ide u kasu kao naplata, a 100 se vodi kao **popust** i ne
  ulazi u pazar. Zato radniku na kraju smene ne fali tih 100 dinara.
- **Kredit se troši i na piće.** Isti novac plaća i vreme i shop, pa gost koji
  kupi dva pića ima kraće vreme. Pri poručivanju bira "sa kredita" ili "kešom";
  keš ne dira nalog.

Pri dopuni panel odmah pokazuje koliko je uneti iznos vremena i koliko će gost
imati posle nje, tako da radnik ne mora da računa pred gostom.
- **Dopuna** - na kasi, preko panela (Igrači > Dopuni), ili direktno sa kartice računara na kontrolnoj tabli.
- **Mirovanje** - ako igrač ustane i zaboravi da se odjavi, launcher to prijavi, igrač dobije odbrojavanje od 60 s na ekranu, pa se sesija zatvara i računar oslobađa. Prag se podešava (Podešavanja > Odjava zbog mirovanja), 0 isključuje.
- **Zalihe** - kad piće padne na 5 komada i kad se isprazni, osoblje dobije zvučno javljanje, a na kontrolnoj tabli stoji traka sa spiskom za dopunu. Klik na artikal u traci odmah otvara dopunu.
- **Igre koje se stvarno igraju** - svako pokretanje se beleži. Igraču se njegove poslednje igre pomeraju na početak police, a vlasnik u Izveštajima vidi spisak najigranijih (koliko puta i koliko različitih igrača), pa zna šta ima smisla držati na disku.
- **Shop** - u tabu Shop u launcheru, sa slikom svake limenke. Igrač pri poručivanju bira **sa kredita** ili **kešom**; keš ne dira nalog, radnik naplaćuje kad donese. Porudžbina stiže u panel (Porudžbine) uz zvučni signal, a keš porudžbina je posebno označena da radnik zna da naplati. Iste slike vidi i radnik na Kasi, da ne promaši artikal u žurbi.
- **Moje porudžbine** - igrač u tabu Nalog vidi šta je poručio i dokle je stiglo (Primljeno / Sprema se / Doneto). Dok porudžbina nije doneta, na tabu stoji brojka, pa se vidi i iz igre.
- **Nagradni točak** - jednom nedeljno besplatan spin za svakog ko je za tih 7 dana potrošio bar prag (fabrički 1200 din). Stoji kao widget u traci na vrhu početne, sa trakom napretka do praga; klik otvara pop-up sa točkom koji se vrti. Najveća nagrada je 250 din kredita. **Ishod bira server**, igrač ga ne može namestiti. Prag, nagrade i njihove šanse podešava vlasnik (Podešavanja > Nagradni točak).
- **Vremenski paketi** - unapred plaćeno vreme jeftinije od cene na sat (fabrički 5 sati za 500 din). Osoblje ih prodaje jednim klikom pri dopuni kredita. Vlasnik ih pravi i menja u Podešavanjima.
- **Slike igara i prečica** - svaka igra ima omot (600x800) za policu; prečice imaju sliku 256x256. Igra može da ima i baner (2800x400), koji služi kao rezervna pozadina ekrana prijave ako nije okačena posebna. Panel na stranama Igre i Internet alati pokazuje kojoj stavci slika fali i ispisuje mere. Steam, Epic, Battle.net, YouTube, Twitch, Discord, TeamSpeak, Google i Spotify imaju ugrađen logo, njima slika nije potrebna.
- **Promo baneri** - brendirane slike (2200x200, odnos 11:1) u traci na vrhu početne, levo od nagradnog točka. Više njih se smenjuje samo, na 8 sekundi, sa tačkicama dole desno. Launcher ne crta ništa preko njih, pa sve piše na samoj slici. Baner se u traku uklapa i nikad se ne seče. Dok ih nema, tu stoji znak igraonice. Kače se u panelu (Izgled launchera).
- **Izgled launchera** - vlasnik u panelu (Izgled launchera) kači pozadinu za svaki ekran: prijava, početna, shop, nalog, zaključan ekran. Preporučena dimenzija 2560x1440 (16:9). Slika se odmah primeni na svim računarima, bez reinstalacije.
- **Zaključavanje** - osoblje može da zaključa/otključa svaki računar iz panela, ili lokalno hotkey-om.

## Uloge u panelu

Tri, i idu odozdo nagore. Viša uvek sme sve što sme niža.

- **Radnik** - svakodnevni rad: kontrolna tabla (pun nadzor i kontrola računara), igrači (kreiranje/dopuna), porudžbine, kasa. Cene, podešavanja, shop/igre katalog, logovi i radnici su mu **zaključani**.
- **Vlasnik** - sve u svojoj igraonici: cene, sva podešavanja, shop, igre, računari, izgled, logovi, upravljanje radnicima.
- **Serviser** - onaj ko je program postavio i ko ga održava. Vidi se na spisku Radnici, označen, ali ga vlasnik **ne menja i ne uklanja**. Postavlja se sa glavnog računara:

```bash
node alati/serviser.mjs <ime> <lozinka>
```

> **Zašto odvojeno.** Vlasnik je gazda svoje igraonice, ali ne i programa. Serviserski nalog postoji da bi podrška mogla da uđe i onog dana kad se vlasnik sam zaključa — i da bi kasnije uslovi pod kojima program radi mogli da stoje van naloga onoga na koga se odnose.
>
> Nalog se **vidi** namerno: nalog sa pristupom tuđim podacima ne sme da bude sakriven od onoga čiji su podaci. I da budemo iskreni do kraja — na računaru koji vlasnik fizički drži nijedna uloga nije neprobojna. Ova podela postoji da uloge budu **jasne** i da svaki potez bude **zapisan**, ne da vlasnika zaključa iz sopstvenog računara.

## Izgled po igraonici

Program je jedan, izgled je svačiji. Sve se podešava iz panela i menja se
**svuda odjednom** — u panelu i na svim launcherima, bez obilaska mašina:

| Šta | Gde |
|---|---|
| Naziv igraonice | Podešavanja |
| **Znak (logo)** | Izgled launchera > Znak i boja |
| **Boja** | isto — biraš jednu, nijanse se izvode iz nje |
| Pozadine svih pet ekrana | Izgled launchera |
| Šara i njeno kretanje | Izgled launchera |
| Promo baneri | Izgled launchera |
| Omoti i baneri igara | Igre |

> Zelena, zlatna i status boje se **ne menjaju** izborom boje kuće. Zelena znači
> „ima kredita", zlatna „nagrada", crvena u launcheru „ističe vreme" — to su
> značenja, ne ukras.

Radnike dodaje vlasnik u panelu > **Radnici**. Svako menja svoju lozinku klikom na svoj profil (na širokom ekranu dole levo, na telefonu gore desno).

Kad radnik ode, vlasnik mu **oduzima pristup** istom stranom. Prijava prestaje odmah i panel koji je ostavio otvoren se zatvara sam. Nalog se pri tom gasi a ne briše, jer smene i dopune moraju da ostanu potpisane njegovim imenom - manjak u kasi mora da ima ime. Ugašen nalog stoji precrtan na spisku i može da se vrati.

## Statusi računara

| Status | Značenje |
|--------|----------|
| **Online** | Neko je prijavljen i igra |
| **Standby** | Računar upaljen, launcher radi, niko ne igra |
| **Zaključan** | Zaključan (isteklo vreme ili osoblje) - čeka otključavanje |
| **Offline** | Računar ugašen ili launcher nije povezan |

## Daljinska kontrola (sa glavnog računara)

Na kontrolnoj tabli, za svaki računar (`⋯ Više`) ili grupno (čekiraj > traka dole):
- Poruka, Zaključaj / Otključaj, Odjavi igrača
- **Ugasi, Restartuj, Odjava Windows (logoff), Task Manager**
- Grupno: selektuj sve > **"Kraj smene - ugasi sve"**, zaključaj sve, poruka svima

Prikaz uživo: ko je prijavljen, preostalo vreme (odbrojava), u koliko se prijavio i koliko već igra.

## Daljinska instalacija programa (panel > Instalacije)

Vlasnik može daljinski da instalira program/igru na računare:
1. **Instalacije > Novi program** (ili Brza instalacija): unesi naziv i **direktan link (URL)** do instalacije, po potrebi **tihe argumente** (npr. `/S`, `/silent`, `/qn` za .msi).
2. Klik **Instaliraj > izaberi računare > Pošalji**.
3. Launcher na svakom računaru skine fajl i pokrene ga; status se prati uživo (Preuzimanje > Instalacija > Završeno / Greška).

Uslovi da radi bez greške:
- Instalacija mora da podržava **tihu (silent) instalaciju** - argumenti se razlikuju po programu (`/S` NSIS, `/silent` Inno, `/qn` MSI...).
- Za instalacije koje traže administratorska prava, launcher treba da bude pokrenut kao administrator.
- Računar mora biti **online** (launcher povezan) da bi primio instalaciju.

## Kopija koda van računara

Baza igraonice ide van računara sama (*Podešavanja > Kopija van računara*). Sam
program to nije imao - izvorni kod i cela istorija izmena postoje samo na
razvojnom laptopu. Otkaz tog diska znači da igraonica nastavi da radi (server je
na drugoj mašini), ali da se program više ne može ni ispraviti ni nadograditi.

```
node alati/kopija-koda.mjs D:\kopije
```

Pravi jedan fajl sa **svim granama i svim commitovima**, proveri da je čitav, i
obriše najstarije (čuva poslednjih pet). Vraćanje na bilo kom računaru sa git-om:

```
git clone "D:\kopije\crit-kod-2.44.0-2026-09-02.bundle" crit
```

Odredište koje ne postoji je **greška, ne poziv da se napravi** - folder
napravljen na lokalnom disku izgledao bi kao uspela kopija, a bio bi na istom
disku od kog čuva. Isto pravilo kao za kopiju baze.

> Ovo nije zamena za privatni repozitorijum nego ono što radi odmah, bez ijednog
> naloga.

## Ime igraonice (za drugu igraonicu)

Ime stoji na jednom mestu, u `igraonica.json`. Menja se alatom:

```
node igraonica.mjs                 pokaže gde koje ime stoji i da li se slaže
node igraonica.mjs "Nova Igraonica"  upiše svuda
```

Upisuje se u instaler (`appId`, ime instalera i foldera instalacije, prečica),
u imena paketa, u alate za oporavak (`POPRAVI-RACUNAR.bat` i ostali zovu
launcher po imenu procesa) i u podrazumevani naziv igraonice u bazi.

Unutrašnja imena **ostaju** (`crit.db`, `CRIT_DATA_DIR`, imena funkcija): ne vidi
ih nijedan korisnik, a preimenovanje baze bi ostavilo sve postojeće podatke sa
strane.

> Na mašinama gde je stara verzija već instalirana: prvo `DEINSTALIRAJ-LAUNCHER.bat`
> (drugo ime = Windows je vidi kao drugi program pa nastaje pored stare), pa se
> posle instalacije ponovo unose adresa servera i token.

## Nadogradnja launchera (panel > Instalacije)

Instalater se postavlja **jednom, na server**, a računari ga preuzimaju sami -
umesto obilaska svih 13 mašina po svakoj verziji.

1. **Postavi instalater** - `Crit Launcher Setup X.Y.Z.exe` iz `dist/`. Ime mora
   da sadrži verziju; po njoj se zna šta je novije. Postavlja ga **serviser**.
2. **Pusti verziju u rad.** Dok to ne uradiš, nijedan računar je ne preuzima ni
   sa ispravnim tokenom - prekopiran fajl sam po sebi ne znači ništa.
3. Dalje ide samo: svaki računar se nadogradi **čim se oslobodi**.

Šta drži da bude bezbedno:
- **Računar na kom neko igra se ne dira.** Nadogradnja gasi launcher, a usred
  plaćenog sata to je oduzeto vreme gostu. Zauzeta mašina čeka svoj red.
- **U poruci nema linka.** Adresu preuzimanja računar sklapa sam, od servera na
  koji je već vezan i svojim tokenom - podmetnuta poruka ne može da mu pokrene
  tuđi `.exe`.
- **Otisak mora da se poklopi.** Uz najavu ide sha256; ako se ne slaže, fajl se
  briše i ništa se ne pokreće.
- **Računar se vraća i kad instalacija ne uspe** - posle pet minuta ga vrati
  osigurač, a u panelu piše zašto nije prošlo.

Instalacija je **po korisniku** (`perMachine: false`) - bez toga bi instaler tražio
administratora, pa bi nadogradnja stigla do mašine i tu čekala UAC prozor koji za
kasom niko neće odobriti. Zbog te promene je potreban **jedan poslednji ručni
obilazak** svih mašina; postupak je u DEPLOY.md §5.1.

## Prečice na tastaturi (na računaru igrača)

| Prečica | Radnja |
|---------|--------|
| `Ctrl + Alt + U` | Otključavanje računara (traži PIN osoblja) |
| `Ctrl + Alt + Home` | Vrati launcher u prvi plan (izlaz iz igre) |
| `Ctrl + Alt + Shift + Q` | Admin izlaz iz launchera (traži PIN) |

PIN osoblja se menja u panelu > Podešavanja.

## Struktura

```
crit/
  server/                  Node server + panel
    src/                   index, db, service, hub, routes, auth
    public/                panel (HTML/CSS/JS)
    data/crit.db           SQLite baza (pravi se automatski)
  client/                  Electron launcher
    main.js                kiosk prozor, WebSocket, hotkeys, pokretanje igara
    preload.js
    renderer/              UI launchera
  assets/sabloni/          SVG šabloni u tačnim dimenzijama za dizajn slika
  testovi/                 provera sistema, pokreni PROVERI-SISTEM.bat
  README.md
  DEPLOY.md                detaljno postavljanje i zaključavanje sistema
  BEZBEDNOST.md            šta server prima od računara i panela, tokeni, dnevnik
```

## Razvojni računar se ne dira

Launcher menja Windows na računaru igrača: politike u registru, plan napajanja,
gašenje pokrenutih programa i **čišćenje tragova sesije** (profili pregledača,
prijave na Steam i ostale, korpa za otpatke). Poslednje je nepovratno.

Zato to radi **samo kad je pokrenut iz instalacije**. `npm start`, `npm run dev`
i alati iz `testovi/` ne diraju Windows i to ispišu u konzoli.

> Na računaru na kom razvijaš, napravi prazan fajl **`CRIT-NE-DIRAJ.txt`** u
> svom korisničkom folderu (`%USERPROFILE%`). Dok stoji, taj računar se ne čisti
> nikad — ni ako se sve druge zaštite zaobiđu. Detalji: DEPLOY.md §3.3.

## Provera posle izmena

`testovi/PROVERI-SISTEM.bat` prolazi kroz **preko 1400 provera** (obračun smene,
neispravni unosi, mirovanje, gosti, igre, nadogradnja baze, kočnica protiv
pogađanja lozinki, izgled launchera, font) i kaže drži li sistem. Svaka suita
diže svoju praznu bazu, prava baza se ne dira.

Uz to postoje alati koji puštaju **pravi launcher u Electronu** i mere ono što
se iz koda ne vidi — raspored na oba ekrana, da li animacije rade, da li font
ima naša slova, prolazi li porudžbina od klika do baze. Detalji u
`testovi/README.md`.

Provera se pušta i **sama**: `git commit` proverava sintaksu izmenjenih fajlova
i poklapanje verzije (traje trenutak), `git push` pušta ceo paket, a GitHub
Actions ga pušta na svaku izmenu (`.github/workflows/provera.yml`). Sve što
zavisi od pamćenja se preskoči baš onog dana kad je najpotrebnije.

## Verzija

Verzija stoji na dva mesta koja moraju da se poklapaju (`server/package.json` i
`client/package.json`). Ne diraj ih ručno:

```
node verzija.mjs            pokaže gde koja stoji
node verzija.mjs 2.45.0     upiše svuda
```
