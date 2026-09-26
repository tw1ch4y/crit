# Crit

Sistem za vođenje igraonice: naplata vremena, kiosk launcher na računarima
igrača, shop, kasa i obračun smene, sa panelom za osoblje na računaru i
telefonu. Radi u lokalnoj mreži, bez interneta i bez spoljnih servisa.

| Deo | Gde radi | Namena |
|---|---|---|
| **Server i panel** (`server/`) | glavni računar | baza, naplata, porudžbine, kasa, izveštaji, nadogradnje |
| **Launcher** (`client/`) | svaki računar igrača | prijava igrača, igre i prečice, shop, zaključavanje računara |

## Dokumentacija

| Dokument | Sadržaj |
|---|---|
| [docs/INSTALACIJA.md](docs/INSTALACIJA.md) | postavljanje mreže, servera i računara igrača, zaštita kioska |
| [docs/ODRZAVANJE.md](docs/ODRZAVANJE.md) | svakodnevni rad, kopije, nadogradnje, kvarovi i oporavak |
| [docs/PROVERA.md](docs/PROVERA.md) | provera pred otvaranje na pravim računarima |
| [docs/RAZVOJ.md](docs/RAZVOJ.md) | razvoj, provere, izdavanje verzije, plan |
| [CHANGELOG.md](CHANGELOG.md) | izmene po verzijama |

## Mogućnosti

**Igrači i naplata**
- Nalozi sa kreditom u dinarima; vreme se uvek računa kao *kredit ÷ cena po
  satu*, pa panel, launcher i zaključan ekran pokazuju isti broj.
- Brzi gosti: do deset naloga odjednom sa četvorocifrenom lozinkom.
- Vremenski paketi (npr. 5 sati za 500): razlika do cene po satu vodi se kao
  popust i ne ulazi u pazar.
- Upozorenja pred istek (30, 15, 10, 5, 2 i 1 minut) preko igre i zvukom;
  računar se zaključa kad kredit istekne.
- Odjava zbog mirovanja, sa odbrojavanjem od 60 sekundi.
- Iskustvo i nivoi, značke, rang lista, VIP članarina i nagradni točak.

**Launcher**
- Kiosk preko celog ekrana; radna površina se ne vidi ni dok igra radi.
- Police igara po kategorijama, prečice (Steam, Discord, YouTube...), shop sa
  plaćanjem sa kredita ili kešom, praćenje porudžbina.
- Pokreće samo ono što je u katalogu sa servera; programe pokrenute iz
  Preuzimanja, Temp-a i sa radne površine gasi.
- Posle igrača briše prijave na pregledače, Steam, Epic, Riot, Battle.net, EA,
  Ubisoft, Discord, Spotify, Minecraft i Roblox, kao i privremene fajlove.
- Miš i zvuk po igraču; po odjavi se vraća zatečeno stanje.
- Radi i kad server ne radi: vreme se broji lokalno, a server posle naplati
  odigrano.

**Panel**
- Kontrolna tabla uživo: stanje svakog računara, preostalo vreme, dopuna sa
  kartice računara, grupne akcije, paljenje preko mreže (Wake-on-LAN).
- Kasa, porudžbine sa zvučnim signalom, zalihe pića sa upozorenjem.
- Smene sa obračunom kase (očekivano, prebrojano, razlika sa objašnjenjem).
- Izveštaji: promet, najigranije igre, zarada po računaru.
- Logovi svih radnji osoblja sa novcem i računarima.
- Izgled launchera po igraonici: znak, boja, pozadine ekrana, promo baneri.
- Nadogradnja servera i launchera iz panela, bez obilaska računara.

**Pouzdanost**
- Nadzornik diže server posle pada, zastoja i restarta, i pre prijave na
  Windows.
- Kopija baze na 15 minuta i jednom dnevno van računara.
- Svaka promena novca je jedan upis: prekid usred posla ne ostavlja pola
  porudžbine ili dopune.

## Uloge u panelu

| Uloga | Prava |
|---|---|
| Radnik | kontrolna tabla, igrači i dopune, porudžbine, kasa |
| Vlasnik | sve u igraonici: cene, podešavanja, katalog, izgled, logovi, radnici |
| Serviser | održavanje programa i nadogradnje; vidi se na spisku radnika i vlasnik ga ne može ukloniti |

Viša uloga sme sve što sme niža. Niko ne menja nalog iste ili više uloge.

## Statusi računara

| Status | Značenje |
|---|---|
| Online | igrač je prijavljen |
| Standby | launcher radi, niko nije prijavljen |
| Zaključan | isteklo vreme ili zaključalo osoblje |
| Bez veze | sesija je otvorena, a računar se ne javlja |
| Offline | računar je ugašen ili launcher nije povezan |

## Brzo pokretanje (razvoj)

```bash
cd server && npm install && npm start      # panel: http://localhost:8095, admin / admin
cd client && npm install && npm run dev    # launcher u prozoru
node testovi/pokreni-sve.mjs               # sve provere
```

Pokrenut iz izvornog koda, launcher ne menja Windows (politike, napajanje,
čišćenje sesije). Detalji su u [docs/RAZVOJ.md](docs/RAZVOJ.md).

## Struktura

```
server/          server, panel i alati za glavni računar
  src/           API, naplata, baza, WebSocket, održavanje
  public/        panel
client/          launcher (Electron) i alati za računar igrača
  renderer/      ekran launchera
testovi/         automatske provere i alati sa pravim launcherom
alati/           kopija koda, provera paketa, serviserski nalog, git hook-ovi
assets/          logo, šabloni za dizajn, proba na jednom računaru
docs/            dokumentacija
```
