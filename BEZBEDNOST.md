# Bezbednost: launcher, server i panel

Ovaj dokument opisuje kako server veruje (i ne veruje) onome što stiže sa
računara igrača i iz panela. Tu je i šta je pregledano, šta je bilo
otvoreno i kako je zatvoreno. Mehanizmi su u četiri fajla u `server/src/`:

| Fajl | Šta radi |
|---|---|
| `seme.js` | Zod šeme za svaku poruku launchera i za tela HTTP zahteva |
| `sesija.js` | potpisan token sesije (HMAC-SHA256), vezan za sesiju, računar i igrača |
| `brzina.js` | kočnica brzine po vezi i straža protiv pogađanja tokena računara |
| `bezbednost.js` | strukturisan dnevnik sumnjivih događaja |

## 1. Šta je pregledano

### WebSocket `/ws`

**`kind=client`** je launcher na računaru igrača. Parametri adrese su
`token` (token računara), `v` (verzija), `p` (protokol, `2` = launcher zna za
tokene sesije) i `sesija` (token sesije, samo kad se nastavlja započeta sesija).

| Poruka | Ko sme | Napomena |
|---|---|---|
| `login` | svako sa tokenom računara | lozinka igrača; kočnica 5 promašaja pa 30 s |
| `order` | **samo potvrđena veza** | troši kredit |
| `tocak_spin` | **samo potvrđena veza** | deli kredit; poruka nema nijedno polje |
| `change_password` | **samo potvrđena veza** | i dalje traži staru lozinku, sa kočnicom |
| `moja_tekstura`, `moj_profil` | **samo potvrđena veza** | menja nalog igrača |
| `game_start` | potvrđena veza dok traje sesija | bez sesije se beleži bez igrača, kao ranije |
| `logout`, `heartbeat.mirovanje` | potvrđena veza; stariji launcher (`p=1`) i bez nje | završavaju sesiju, niko na tome ne zarađuje |
| `unlock_pin`, `verify_pin` | svako sa tokenom računara | PIN osoblja, kočnica po računaru |
| `hello`, `heartbeat`, `sys_info`, `install_status`, `nadogradnja_status`, `igra_ne_radi`, `klijent_problem`, `log_klijent`, `procesi_lista`, `proces_ugasen` | svako sa tokenom računara | stanje računara, ne igrača |

„Potvrđena veza“ je veza na kojoj je igrač uneo lozinku, ili nova veza koja je
pokazala token njegove sesije (vidi §3).

**`kind=panel`** je panel osoblja (token iz `/api/login`). Server sa te veze
ne čita poruke. Veza sa tuđe strane (pogrešan `Origin`) se odbija.

### HTTP

- `/api/login` je jedina javna ruta panela, sa kočnicom po računaru i nalogu.
- `/nadogradnja/launcher.exe?token=` je jedina ruta van `/api`, sa tokenom
  računara i istom stražom kao WebSocket.
- Svih ostalih ~120 ruta pod `/api` traže token panela. Vlasničke i
  serviserske rute traže još i ulogu (`requireOwner`, `requireServiser`).

## 2. Šta je bilo otvoreno

1. **Token računara je bio dovoljan da se radi u ime igrača.** Taj token stoji
   u podešavanjima na samoj mašini. Ko ga uzme, mogao je sa druge mašine da
   poruči na tuđi kredit, zavrti tuđi točak, promeni izgled tuđeg naloga ili
   ga odjavi.
2. **`login` na zauzetom računaru vraćao je prijavu igrača koji sedi**, bez
   ikakve lozinke.
3. **Broj pokušaja porudžbine (`poId`) bio je zajednički za sve računare.**
   Računar koji pošalje tuđi broj dobijao je tuđi odgovor: broj porudžbine i
   stanje kredita drugog igrača.
4. **Točak:** ishod iz `Math.random`. Otkazana porudžbina se i dalje računala
   kao potrošnja, pa je radilo „poruči za 1200, zavrti, zamoli da se otkaže“.
5. **Nije bilo granice veličine ni brzine poruka.** `ws` podrazumevano prima
   100 MB u jednoj poruci, a `change_password` je radio scrypt na svaku
   poruku, bez kočnice.
6. **Lažan otkucaj sa velikim „mirovanjem“** je mogao da odjavi tuđu sesiju.
7. **Poruke su proveravane usput**, svaka funkcija za sebe. Nepoznata polja
   su prolazila tiho.
8. **Token računara je pravljen iz `Math.random`**, 10 znakova. Pogađanje nije
   ostavljalo trag i nije ništa blokiralo.
9. **Nije bilo bezbednosnog dnevnika.**

## 3. Kako je zatvoreno

### Šeme (`seme.js`)

Svaka poruka launchera prolazi kroz Zod šemu **pre** nego što stigne do
servisa (redosled u `hub.js`: veličina, pa brzina, pa šema).

- **Strogo na vrhu poruke.** Za svaki tip tačno se zna koja polja launcher
  šalje. Poruka sa viškom se odbija cela i beleži. `tocak_spin` sa `index` ili
  `nagrada` je kritičan događaj (`tocak_nametanje_ishoda`).
- **Stavke porudžbine** su jedini izuzetak. Višak (`price`, `total`) se
  odbacuje i beleži (`porudzbina_visak_polja`), a porudžbina ide dalje po ceni
  iz baze, kao i ranije.
- **Greška nikad ne nosi vrednost**, samo polje i vrstu greške, jer u
  odbijenoj poruci može da stoji lozinka.
- **HTTP se proverava po tipu.** Panel šalje vrednosti iz polja za unos
  (`" 150 "`), a servis ih sam čisti i proverava opseg. Šema zatvara ono što
  servis ne očekuje: objekat ili niz umesto broja ili teksta, predugačak tekst,
  nepoznatu komandu ili status, i link za instalaciju koji nije `http(s)`. Šeme
  imaju rute za novac, vreme, smene, komande računarima, lozinke, naloge,
  podešavanja, točak, pakete, kasu, instalaciju i nadogradnju. Broj u adresi
  (`:id`, `:pid`) mora da bude pozitivan ceo broj na svim rutama.

Test `test-seme.mjs` proverava da svaka poruka koju launcher šalje ima šemu.
Nova poruka bez šeme bi inače bila tiho odbačena na serveru.

### Token sesije (`sesija.js`)

```
s1.<broj sesije>.<HMAC-SHA256 u base64url>
HMAC(tajna, "s1|<sesija>|<računar>|<igrač>|<početak sesije>")
```

- Izdaje se uz `login_ok` (polje `sesija`) **samo vezi koja je ovlašćena**.
- Važi tačno dok traje sesija. Ne čuva se u bazi nego se proverava računom,
  pa kad sesija završi, token pada sam od sebe.
- Tajna ima 256 bita, pravi se jednom i stoji u `settings.sesija_tajna`, da
  tokeni prežive restart servera. Brisanjem tog ključa poništavaju se svi
  tokeni odjednom: sesije teku dalje, a igrači se jednom ponovo prijave.
- Provera razlikuje `oblik`, `nepoznata`, `potpis` (token je napravljen, što je
  kritično), `tudji_racunar` (token je odnet sa druge mašine, što je kritično) i
  `zavrsena` (normalno posle odjave, nivo info).

**Sesiju nosi veza.** Veza koja se otvori samo sa tokenom računara vidi stanje
(ko igra i koliko mu je ostalo, kao i do sada posle restarta servera), ali ne
može ništa u ime igrača. Sesiju potvrđuje na jedan od dva načina: tokenom ili
lozinkom igrača koji sedi. Ispravna lozinka **drugog** igrača ne preuzima
tuđu sesiju.

Launcher (`client/main.js`) čuva token u `userData/sesija.json`, šalje ga pri
svakom povezivanju i briše ga čim sesija prestane. Ekran launchera ga ne dobija.

### Nagradni točak

- Ishod bira server iz `crypto.randomInt` nad zbirom težina, bez zaokruživanja.
- „Već je vrteo“ se proverava i upisuje **jednim iskazom**
  (`oznaciSpin`: `UPDATE ... WHERE last_spin_at IS NULL OR last_spin_at <= ?`).
  Spin koji izgubi trku ne isplaćuje ništa i beleži se kao `tocak_dupli_spin`.
- Otkazana porudžbina (`refund`) se odbija od nedeljne potrošnje.
- Isplata je u istom poslu sa oznakom spina, kao i ranije.

### Preostalo vreme

Računa ga isključivo server, iz stanja kredita u bazi i cene po satu.
Launcher ga samo prikazuje i ne može da ga pošalje: otkucaj sa poljem
`remainingSeconds` ili `balance` ne odgovara šemi. Lažno „mirovanje“ sa
nepotvrđene veze ne odjavljuje igrača.

### Kočnica brzine (`brzina.js`)

Kofa sa žetonima po vezi:

| Šta | Rafal | Dopuna |
|---|---|---|
| sve poruke zajedno | 40 | 10/s |
| `login` | 10 | 1/s |
| `change_password` | 3 | 1 na 20 s |
| `hello` (ceo katalog) | 4 | 1 na 4 s |
| `order` | 6 | 1/s |
| `tocak_spin` | 3 | 1 na 2 s |
| `unlock_pin`, `verify_pin` | 6 | 1 na 2 s |
| `moja_tekstura`, `moj_profil` | 10 | 2/s |

Višak se odbacuje i beleži jednom u minutu. Posle 200 odbijenih poruka u 10 s
veza se prekida (kod 1008); pravi launcher se vraća sam. Poruka veća od 512 KB
prekida vezu (kod 1009).

**Pogađanje tokena računara:** 10 neispravnih tokena sa iste adrese u minutu
blokira tu adresu na 5 minuta, i na WebSocketu i na preuzimanju launchera. Novi
tokeni računara se prave iz `crypto.randomInt`, sa 16 znakova. Postojeći tokeni
rade dalje.

### Bezbednosni dnevnik (`bezbednost.js`)

Svaki zapis ide na tri mesta:

1. `server/data/bezbednost.jsonl`: jedan JSON po redu. Kad pređe 5 MB, ide u `.1`.
2. Konzola servera (isti JSON).
3. **Logovi** u panelu, kategorija *Bezbednost*, ali samo nivoi `upozorenje` i `kriticno`.

```json
{"ts":"2026-10-03T18:02:11.204Z","nivo":"kriticno","vrsta":"token_sesije_tudji_racunar",
 "opis":"PC-02: token sesije sa drugog računara (sesija je na PC-01)","ip":"192.168.1.42",
 "racunar":"PC-02","racunarId":2,"igrac":"marko","podaci":{"razlog":"tudji_racunar","sesijaId":118},"ponovljeno":0}
```

- Lozinke, PIN-ovi i tokeni se brišu iz `podaci` pre upisa, na bilo kojoj dubini.
- Isti događaj (vrsta + računar ili adresa) upisuje se najviše jednom u minutu.
  Broj preskočenih ide uz sledeći upis (`ponovljeno`).
- Vlasnik vidi poslednjih 300 zapisa na `GET /api/bezbednost`
  (`?nivo=`, `?vrsta=`, `?limit=`).

| Vrsta | Nivo | Kada |
|---|---|---|
| `token_racunara_neispravan` | upozorenje | povezivanje ili preuzimanje sa nepostojećim tokenom računara |
| `ip_blokiran`, `ip_blokiran_pokusaj` | kritično, upozorenje | adresa je pogađala tokene |
| `token_panela_neispravan` | info | istekao ili izmišljen token panela |
| `token_sesije_lazan`, `token_sesije_tudji_racunar` | kritično | napravljen ili odnet token sesije |
| `token_sesije_neispravan`, `token_sesije_istekao` | upozorenje, info | smeće ili token završene sesije |
| `sesija_nepotvrdjena` | kritično (novac), upozorenje | radnja u ime igrača sa nepotvrđene veze |
| `sesija_preuzeta_bez_tokena` | upozorenje (`p=2`), info | nova veza bez tokena zamenila je vezu igrača |
| `sesija_potvrda_neuspela`, `sesija_ponovo_potvrdjena` | upozorenje, info | potvrda sesije lozinkom |
| `sesija_dug_prekid` | upozorenje | računar je usred sesije bio van mreže duže od 2 min |
| `dupla_naplata_sprecena` | upozorenje | isti broj pokušaja porudžbine, sa launchera ili sa kase |
| `porudzbina_tudji_broj` | kritično | broj pokušaja koji je već iskoristio drugi računar |
| `porudzbina_visak_polja` | upozorenje | porudžbina sa `price`/`total` u stavkama |
| `tocak_nametanje_ishoda` | kritično | `tocak_spin` sa poljima |
| `tocak_dupli_spin` | upozorenje | drugi spin iste nedelje |
| `lozinka_pogadjanje` | upozorenje | kočnica na promeni lozinke |
| `poruka_neispravna`, `poruka_nepoznata`, `poruka_prevelika` | upozorenje | poruka ne odgovara protokolu |
| `brzina_prekoracena`, `veza_prekinuta_spam` | upozorenje, kritično | zatrpavanje |
| `zahtev_neispravan` | upozorenje | telo HTTP zahteva ne odgovara šemi |
| `panel_tudji_izvor` | upozorenje | veza ka panelu sa tuđe strane |
| `pristup_bez_prava` | info | radnik je gađao vlasničku rutu |

## 4. Uvođenje

Server i launcher idu zajedno, ali **stari launcher radi i sa novim serverom**:

- prijava, naplata, odjava i mirovanje rade kao ranije;
- posle **prekida veze** stari launcher (`p=1`) nema token, pa porudžbina,
  točak i promena naloga javljaju „Sesija nije potvrđena“. Igrač se odjavi i
  prijavi, a porudžbinu do tada kuca radnik na kasi.

Nadogradnja launchera ide kao i do sada (panel, *Nadogradnja*). Računari je
uzimaju čim se oslobode.

## 5. Šta svesno ostaje

- **Iščupan kabl.** Dok računar nije na mreži, naplata stoji. To je postojeće
  pravilo (nestanak struje ne sme da se naplati) i test `restart` ga traži.
  Igrač koji iščupa kabl i igra igru koja ne traži mrežu ne plaća to vreme.
  Sada se svaki takav prekid duži od 2 minuta beleži (`sesija_dug_prekid`), pa
  se obrazac vidi. Pravo rešenje je na launcheru: da se posle N minuta bez
  servera usred sesije sam zaključa.
- **Stariji launcher (`p=1`) sme da završi sesiju bez potvrde.** `p` se može
  lažirati, ali time se može samo prekinuti tuđa sesija, ne i nešto dobiti.
- **Rute kataloga** (shop, igre, alati, promo, pozadine, tekstura, brend,
  programi, skladište, kopija van računara) i dalje imaju samo svoje provere,
  bez šeme. Sve izmene tamo su samo za vlasnika, a test `neispravni-unosi`
  proverava da smeće u njihovim poljima ne obara rutu.
- **Mreža nije šifrovana** (`ws://`, `http://`). Ko prisluškuje lokalnu mrežu,
  vidi tokene. Panel i računari moraju da budu na mreži na koju gosti nemaju
  pristup (DEPLOY.md).
- `npm audit` prijavljuje tri ranjivosti srednjeg nivoa u `qs` (preko
  `express`). One postoje od ranije i nisu deo ove izmene.

## 6. Testovi

| Suita | Šta pokriva |
|---|---|
| `seme` | šeme bez servera: prave poruke prolaze, višak i pogrešni tipovi ne prolaze, greška ne nosi lozinku, šema postoji za svaku poruku launchera |
| `brzina` | kofa i kočnica sa lažnim satom; rafal, zatrpavanje (1008), ogromna poruka (1009) i skupe poruke na pravom serveru |
| `sesija-token` | potpis i vezivanje tokena; šta nepotvrđena veza (ne) sme; nastavak sa tokenom; tuđi i lažni tokeni; potvrda lozinkom; preostalo vreme samo sa servera; stariji launcher |
| `tocak-zastita` | tačna raspodela i kriptografski izvor; spin koji izgubi trku ne isplaćuje; „poruči, zavrti, otkaži“; nametanje ishoda |
| `bezbednosni-log` | oblik zapisa, skrivanje tajni, prigušivanje, okretanje fajla; stvarni događaji sa servera; blokada adrese |
