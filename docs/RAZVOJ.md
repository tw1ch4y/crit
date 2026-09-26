# Razvoj

## Sastav

| Deo | Tehnologija | Sadržaj |
|---|---|---|
| `server/` | Node.js 24, `node:sqlite`, Express, `ws` | API, naplata, WebSocket veza sa panelom i launcherima, održavanje baze, nadzornik |
| `server/public/` | HTML, CSS, JavaScript bez okvira | panel za osoblje (desktop i telefon) |
| `client/` | Electron | launcher: kiosk prozor, pokretanje igara, rad bez servera, čišćenje sesije |
| `testovi/` | Node.js | automatske provere i alati koji puštaju pravi launcher |
| `alati/` | Node.js, sh | kopija koda, provera paketa, serviserski nalog, git hook-ovi |
| `assets/` | SVG, PNG | logo, šabloni za dizajn, skripte za probu na jednom računaru |

Server ima dve zavisnosti (`express`, `ws`); baza je ugrađena u Node.

## Pokretanje na razvojnom računaru

```bash
cd server && npm install && npm start      # http://localhost:8095
cd client && npm install && npm run dev    # launcher u prozoru, bez kioska
```

`npm start` u `client/` otvara kiosk preko celog ekrana. Podaci servera su u
`server/data/`; druga lokacija se zadaje sa `CRIT_DATA_DIR`.

### Zaštita razvojnog računara

Launcher menja Windows na četiri načina: politike u registru, plan napajanja,
gašenje programa pokrenutih tokom sesije i čišćenje sesije (profili pregledača,
prijave na Steam, Epic, Riot, Discord i druge, korpa za otpatke). Čišćenje je
nepovratno. Zato launcher Windows dira samo kad je ispunjeno sve:

1. launcher je instaliran (`app.isPackaged`); nepakovan se zaključava samo uz
   `--zakljucaj`;
2. nije pokrenut sa `--dev` ili `--no-lock` i pored programa nema
   `bez-zakljucavanja.txt`;
3. u korisničkom folderu nema fajla **`CRIT-NE-DIRAJ.txt`**. Ova provera je
   nezavisna od načina pokretanja i odbija i čišćenje i nadogradnju.

`--suvo` pušta čišćenje u probnom režimu: samo ispisuje šta bi obrisalo.

## Provere

```bash
node testovi/pokreni-sve.mjs
```

Svaka suita diže svoj server na svom portu i svoju praznu bazu u
`testovi/.radno/`; prava baza se ne dira. Traje nekoliko minuta. Opis suita je
u [testovi/README.md](../testovi/README.md).

Alati `testovi/proba-*.mjs` i `pregled-*.mjs` puštaju pravi launcher u
Electronu i otvaraju prozore; `proba-podesavanja.mjs` menja miša i zvuk
računara na kom se pusti (i vraća ih). Puštaju se pojedinačno, uz nameru, ne
na računaru na kom se radi nešto drugo.

**Git hook-ovi** (`git config core.hooksPath alati/git-hooks`):

- `pre-commit` - sintaksa svakog izmenjenog `.js`/`.mjs` i usklađenost verzije;
- `pre-push` - ceo skup provera.

Isti skup se pušta na GitHub Actions za svaki push (`.github/workflows/provera.yml`).

## Izdavanje

```bash
node verzija.mjs 1.0.1        # verzija u server/ i client/
cd client && npm run build    # instaler u dist/
node napravi-paket.mjs        # folder za USB pored projekta
node alati/proveri-paket.mjs  # diže server iz paketa i proverava ga
```

`napravi-paket.mjs` odbija da napravi paket ako se verzija instalera ne
poklapa sa projektom. `proveri-paket.mjs` diže server iz samog paketa, otvara
panel, traži katalog i povlači svaku sliku koju baza pominje.

Numeracija verzija počinje od `v1.0.0` i nosi oznaku (`NUMERACIJA` u
`server/src/verzije.js` i `client/nadogradnja-skripta.js`). Verzije stare
numeracije (do 2.58.0) su brojem veće, pa se nigde ne porede sa novim.

## Druga igraonica

```bash
node igraonica.mjs "Ime igraonice"
```

Upisuje ime na sva mesta gde ga vidi korisnik ili Windows: ime paketa,
`appId`, ime instalera i foldera instalacije, alati za oporavak. Unutrašnja
imena (`crit.db`, `CRIT_DATA_DIR`) ostaju. Bez argumenta alat samo proverava da
se ime svuda slaže. Posle promene imena, na računarima sa starom instalacijom
prvo ide `DEINSTALIRAJ-LAUNCHER.bat`, pa ponovo adresa servera i token.

## Ostali alati

| Komanda | Namena |
|---|---|
| `node postavi-bazu.mjs` | puni `server/data/crit.db` katalogom igraonice (igre, prečice, pozadine, shop); server ne sme da radi |
| `node alati/kopija-koda.mjs D:\kopije` | ceo repozitorijum sa istorijom u jedan `git bundle` fajl; čuva poslednjih pet |
| `node alati/serviser.mjs <ime> <lozinka>` | serviserski nalog na glavnom računaru |
| `node assets/napravi-sablone.mjs` | SVG šabloni za dizajn iz trenutnog rasporeda launchera |
| `node testovi/godina-rada.mjs --dana 365` | puni bazu obimom rada igraonice i meri veličinu i brzinu |

## Plan

| Stavka | Stanje |
|---|---|
| HTTPS za panel i launcher | lozinke i tokeni danas idu u čistom tekstu; do tada gosti moraju biti na odvojenoj mreži |
| Fiskalizacija (ESIR/PFR) | kasa ne izdaje fiskalni račun; prvi korak je izvoz prometa u obliku koji prihvata knjigovođa |
| Prijava bez servera | igrači koji igraju nastavljaju, nova prijava čeka server; sledeće je puštanje sesije za keš servisnim PIN-om |
| Straža nad launcherom | zakazani zadatak koji vraća launcher ako ga neko ugasi; do tada panel javlja računar *Bez veze* |
| `Program Files` uz zakazani zadatak | vraća instalaciju van profila igrača; traži sertifikat za potpisivanje koda (i zbog SmartScreen upozorenja) |
| Rezervacije računara | nije urađeno |

Namerno nije urađeno: gašenje startup programa i vizuelnih efekata Windows-a,
odlaganje Windows Update-a iz programa i profili optimizacije po igri.
Rešavaju se u samom Windows-u ili traže održavanje po svakoj igri.
