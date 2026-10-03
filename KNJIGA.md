# Novac: transakcije i glavna knjiga

Kako server pomera novac (kredit igrača, porudžbine sa šanka, keš u kasi
smene), zašto to ne može da se pokvari kad dva zahteva stignu u isto vreme, i
šta se o svakom dinaru zapisuje.

## 1. Gde je šta

| Fajl | Uloga |
|---|---|
| `server/src/knjiga.js` | **jedino** mesto koje menja kredit i vodi keš u kasi; piše `audit_log` |
| `server/src/db.js` | `uJednomPoslu` (transakcija, `BEGIN IMMEDIATE`), šema `audit_log`, okidači u bazi |
| `server/src/service.js` | poslovne putanje (tabela ispod) |
| `server/src/routes.js` | `GET /api/audit`, `GET /api/audit/provera` (samo vlasnik) |

| Putanja u `service.js` | Šta pomera | Tip u knjizi |
|---|---|---|
| `topUpPlayer` | kredit + kasa | `uplata` / `korekcija` |
| `prodajPaket` | kredit (plaćeno + popust) + kasa (plaćeno) | `uplata`, `poklon` |
| `clientOrder` (launcher), `createPosOrder` (kasa) | kredit **ili** kasa (keš), zaliha | `kupovina_artikla` |
| `setOrderStatus` (otkazivanje) | kredit **ili** kasa, zaliha nazad | `storno` |
| `billingTick` | kredit, cena sesije, XP | `trosak_vreme` |
| `zavrtiTocak` | kredit | `poklon` |
| `createPlayer` (početni kredit), `deletePlayer` (preostali kredit) | kredit | `uplata`, `korekcija` |
| `openShift`, `closeShift` | kasa | `otvaranje_smene`, `zatvaranje_smene` |

## 2. Izolacija: zašto se kredit ne može potrošiti dvaput

**Šta je bilo.** Svaka putanja je čitala nalog *pre* transakcije, računala
novo stanje u JavaScript-u i upisivala ga kao gotov broj (`SET balance = 0`).
To je klasičan izgubljeni upis (*lost update*): dva posla vide „ima 130“, oba
prođu proveru, oba upišu „ostalo 0“. U jednom Node procesu to je držalo slučajno,
zato što je sav kod sinhron. Drugi proces nad istom bazom (alat za servis,
vraćanje kopije, druga instanca servera) ili jedan `await` dodat kasnije to bi
otvorili.

To je i izmereno. Pet veza ka istoj bazi, sa starim obrascem, nalog sa 130 din:
**sve pet kupovina „uspe“, a skinuto je 130** (test `paralelna-kupovina`,
kontrola).

**Šta je sada:**

1. **`BEGIN IMMEDIATE`** (u `uJednomPoslu`). Brava za pisanje se uzima na
   početku posla, pre prvog čitanja. Poslovi koji pišu idu jedan za drugim, što
   je u SQLite-u nivo SERIALIZABLE. Drugi posao čeka (`busy_timeout` 5 s) i tek
   onda čita, pa vidi stanje posle prvog.
2. **Čitanje i provera u poslu.** `knjiga.promeniKredit` čita stanje *unutar*
   posla, proverava da li ima dovoljno, pa upisuje uslovno
   (`WHERE balance = <pročitano>`). Ko nema dovoljno dobija `NedovoljnoKredita`
   i ceo njegov posao se poništava: porudžbina, stavke, zaliha, sve.
3. **Knjiženje van posla je nemoguće.** Knjiga baca grešku ako nije pozvana
   unutar `uJednomPoslu`. Posao ne sme da bude `async`; `uJednomPoslu` to
   odbija.
4. **Baza čuva sama sebe.** Okidač `kredit_bez_minusa` odbija svaki upis koji
   spušta kredit ispod nule, ma ko pisao. Jedinstven indeks dozvoljava najviše
   jednu otvorenu smenu.
5. **Uslovni prelazi stanja** svuda gde dva zahteva mogu da urade isto:
   - otkazivanje porudžbine (`WHERE status = <pročitano>`), pa se kredit ne vraća dvaput;
   - kraj sesije (`WHERE status = 'active'`), pa se cena sesije ne upisuje dvaput;
   - zatvaranje smene (`WHERE status = 'open'`);
   - zaliha (`WHERE stock >= količina`). Ranije je stajalo `MAX(0, stock - x)`,
     što je tiho prodavalo više nego što ima.

**Vreme i porudžbina nad istim kreditom.** Naplata vremena
(`knjiga.naplatiVreme`) i porudžbina idu kroz istu bravu. Ko stigne prvi, troši.
Naplata vremena nikad ne skida više nego što ima; kad kredit dođe do nule,
sesija se završava. Porudžbina posle toga dobija „Nedovoljno kredita“. Nikad
oba, nikad minus.

Usput je ispravljena i greška u `uJednomPoslu`: `BEGIN` koji pukne (baza
zaključana) ostavljao je brojač dubine zauvek na 1.

## 3. `audit_log`

Jedan red je jedna promena na **jednom računu**: `igrac` (kredit igrača
`player_id`) ili `kasa` (keš koji bi trebalo da stoji u kasi smene `shift_id`).
Operacija koja dira oba (dopuna plaćena kešom) pravi dva reda sa istom oznakom
`operacija`.

| Kolona | Značenje |
|---|---|
| `ts` | vreme u ms |
| `operator_id` | `admins.id` radnika; `NULL` za sistem i igrača |
| `operator`, `operator_tip` | ime; `radnik` / `sistem` / `igrac` |
| `tip` | `uplata`, `trosak_vreme`, `kupovina_artikla`, `storno`, `otvaranje_smene`, `zatvaranje_smene`, plus `korekcija`, `poklon` i `pocetno_stanje` |
| `racun` | `igrac` ili `kasa` |
| `iznos` | promena na računu (+ ušlo, - izašlo) |
| `stanje_pre`, `stanje_posle` | stanje računa pre i posle |
| `operacija` | UUID, isti za sve redove jedne operacije |
| `referenca` | `porudzbina:12`, `sesija:5`, `paket:3`, `smena:2` |
| `opis` | rečenica za čoveka |
| `ts_do`, `zatvoren` | samo za zbirni red vremena (ispod) |

Operater se uzima iz prijave na panel. Ruta postavlja operatera posle tela
zahteva, pa ga zahtev ne može podmetnuti.

**Lanac.** Za isti račun, `stanje_posle` jednog reda je `stanje_pre`
sledećeg, i u svakom redu važi `pre + iznos = posle`. `knjiga.proveri()`
(`GET /api/audit/provera`) prolazi celu knjigu i javlja: prekid lanca, red koji
se ne sabira, nalog čiji kredit ne odgovara knjizi, nalog sa kreditom bez ijednog
reda i obrisan nalog koji nije završio na nuli. Novac pomeren mimo knjige se tako
vidi, kao u kontrolnom testu.

**Nepromenljivost.** Okidači u bazi ne dozvoljavaju brisanje reda ni izmenu
zatvorenog reda. Jedini izuzetak je `server/reset-podataka.mjs` (priprema za
rad), koji briše i naloge na koje se knjiga odnosi.

**Vreme se knjiži zbirno.** Naplata teče na 5 s. Red po prolazu bio bi oko
17 000 redova dnevno po računaru. Zato jedan red skuplja vreme dok traje
odsečak (30 min), a zatvara se čim se na tom nalogu desi bilo šta drugo
(porudžbina, dopuna) i na kraju sesije, pa lanac ostaje neprekinut. Dok je
otvoren, red sme da menja samo `iznos`, `stanje_posle` i `ts_do`.

**Kasa** se vodi samo dok je smena otvorena, po istom pravilu po kom obračun
računa „očekivano u kasi“:
`početno + dopune - skidanja + keš porudžbine (bez otkazanih)`. Na zatvaranju
red `zatvaranje_smene` ima stanje pre (po knjizi), posle (prebrojano) i iznos
(manjak ili višak). Obračun vraća `kasaPoKnjizi` uz `expectedCash`, i te dve
brojke moraju da budu iste.

**Prvo pokretanje.** Baza iz igraonice već ima naloge sa kreditom. Pri
pokretanju `knjiga.pripremi()` upisuje jednom `pocetno_stanje` za svaki takav
nalog i za smenu koja je otvorena, da lanac ne počne od nule.

## 4. Naplata vremena je sada tačna

Svaki prolaz od 5 s se zaokruživao na celu paru: pri 120 din/h to je 0,1667, a
upisivalo se 0,17. Sat je tako koštao **122,40 umesto 120**, i to 2% više pri
svakoj ceni. Sada se skida cela para, a ostatak ispod pare prelazi u sledeći
prolaz (`zaNaplatu`). Sat košta tačno 120. Restart servera izgubi najviše jednu
paru, u korist igrača.

## 5. Šta svesno ostaje

- **Početni kredit pri otvaranju naloga ne ulazi u kasu smene.** Obračun
  smene ga ni ranije nije brojao (log `nalozi`, ne `novac`), a Izveštaji ga
  broje kao dopunu. Knjiga kase prati obračun. Da li je početni kredit keš preko
  pulta, poslovna je odluka; ako jeste, oba mesta treba promeniti zajedno.
- **Otkazana keš porudžbina iz ranije smene** ne menja kasu tekuće smene, isto
  kao u obračunu, iako radnik keš vraća iz današnje kase.
- **Panel nema ekran za knjigu.** Za sada su tu samo API rute (`/api/audit`
  sa filterima `player`, `smena`, `tip`, `racun`, `od`, `do` i
  `/api/audit/provera`).
- **Rast.** Oko 600 redova dnevno (13 računara, 12 h). To je otprilike
  40 MB godišnje, i knjiga se ne seče sa logovima.

## 6. Testovi

| Suita | Šta pokriva |
|---|---|
| `paralelna-kupovina` | pet istovremenih kupovina sa naloga koji ima za jednu: kroz kasu (HTTP), launcher (WebSocket) i mešano; pet niti sa svojim vezama ka bazi i zajedničkom barijerom; kontrola sa starim obrascem koja stvarno gubi upise; vreme i porudžbina nad istim kreditom; okidači u bazi |
| `audit-log` | cela smena kroz sve vrste zapisa: polja, stanja pre i posle, potpis operatera, zbirno vreme, lanac, kasa jednaka obračunu, tačna naplata na dugom roku, prvo pokretanje, API |
