# CRIT - od igraonice do proizvoda

Strateški plan. `PLAN.md` je dnevnik razvoja (šta je urađeno); ovaj dokument je
odgovor na drugo pitanje: **kuda dalje i kojim redom**.

Pisano posle punog pregleda koda, dokumentacije i pokretanja kompletne provere
(1377 tvrdnji, 0 palo, verzija 2.44.0).

---

## Deo 1 - Šta si već napravio

Da se odmah zna odakle krećemo, jer se plan gradi na tome.

### Brojke

| | |
|---|---|
| Kod | ~27.000 linija (server 3.700, panel 4.600, launcher 4.100, testovi 11.000) |
| API | 110 ruta |
| Provere | 54 suite + 12 alata koji puštaju **pravi Electron** |
| Rezultat | **1377 prošlo, 0 palo** |
| Dokumentacija | README, DEPLOY, POKRETANJE, PROVERI, PLAN - pisano za vlasnika, ne za programera |
| Zavisnosti servera | **dve** (`express`, `ws`). Baza je ugrađena u Node. |

### Šta je ovde iznad proseka - i zašto to nije kompliment iz pristojnosti

**1. Komentari objašnjavaju CENU, ne mehaniku.**
Većina koda na svetu ima komentare tipa "// šalje ping". Tvoji imaju ovo:

> *Za igraonicu je to skupo dvaput: panel pokazuje računar kao ZAUZET pa radnik
> tamo ne posadi nikoga, a naplata teče za praznu stolicu.* (`hub.js`, PING_MS)

To je razlika između koda koji se održava i koda koji se posle šest meseci
prepisuje jer niko ne zna zašto je broj baš 15.

**2. Kvarovi su izvučeni iz fizičkog sveta, ne iz teorije.**
Sat koji preskoči jer Windows sinhronizuje RTC. Iščupan LAN kabl koji ostavlja
TCP vezu živu satima. OneDrive koji bi čišćenje Desktopa preneo u oblak. Disk
koji stane pa server ne može da piše. Instaler koji tiho vrati PIN na `1234`.
Ovo nisu stvari koje se smisle za stolom - to je spisak koji nastane kad neko
stvarno zamisli mašinu u uglu prostorije u devet uveče.

**3. Testovi znaju svoja ograničenja.**
Rečenica iz `testovi/README.md`:

> *U suitama je oko 40% tvrdnji provera izvornog koda - hvataju da je neko
> obrisao liniju, ali ne dokazuju da funkcija radi.*

Vrlo malo iskusnih inženjera to napiše o sopstvenim testovima. Još manje njih
onda napravi drugi sloj alata koji **otvara pravi prozor i klikne dugme** da
pokrije tu rupu. I taj sloj je našao dva prava kvara (točak se nije mogao
zavrteti, animacije mrtve uz isključene Windows animacije).

**4. Novac je urađen tačno tamo gde se najčešće greši.**
Kredit je jedini izvor istine, vreme se izvodi (`kredit ÷ cena`). Popust na
paket ne ulazi u pazar. Zatvorena smena se zamrzava umesto da se preračunava iz
logova. Naplata ne prelazi raspoloživi kredit. Jedan prolaz naplate ne sme
preko 60 s. Porudžbina je jedan SAVEPOINT. Svaka od ovih pet stavki je klasičan
izvor "manjka koji radnik ne ume da objasni".

**5. Reverzibilnost kao princip.**
Sve što launcher dira u Windows-u se vraća - politike, plan napajanja, miš i
zvuk pri odjavi. Uz to `POPRAVI-RACUNAR.bat` za slučaj kad se launcher ni ne
pokrene. To je razmišljanje o **servisiranju**, ne samo o radu.

**6. "Nije urađeno, i evo zašto."**
PLAN.md ima stavke sa objašnjenjem zašto namerno nisu urađene (bloatware,
Windows Update, profil po igri). To je zrelost. Loš inženjer ćuti o tome što
nije uradio; dobar zapiše odluku da se za pola godine ne raspravlja ponovo.

**Iskreno: ovo je kvalitetnije od većine komercijalnog softvera za igraonice.**
Nedostaje mu nekoliko stvari, ali nijedna nije u domenu "ne znaš da programiraš".
Sve su u domenu "još nisi prešao iz projekta u proizvod".

---

## Deo 2 - Rizici, poređani po tome koliko bole

Ne po tome koliko su zanimljivi. Po tome koliko košta ako se dese.

### R1. Nemaš nijedan commit. 184 fajla stoje "staged" i to je sve.

`git log` kaže: *your current branch 'master' does not have any commits yet*.

Meseci rada žive u jednom folderu na OneDrive-u. Jedan loš potez, jedan sync
konflikt, jedan slučajno obrisan folder i nema ničega. Nema ni `git bisect` -
kad se za tri meseca pojavi bag, ne možeš da nađeš kad je ušao.

**Ovo je najveći rizik u celom projektu i rešava se za deset minuta.**

### R2. Rezervne kopije su na istom disku kao baza.

`server/data/crit.db` i `server/data/backups/` dele fizički disk. Sistem
odlično brine o *prostoru* (proređivanje, granice, provera slobodnog mesta) -
ali sve to ne pomaže kad disk otkaže. Tada nestaje i baza i svih 30 kopija.

Panel ume da preuzme kopiju ručno. Ručno = neko mora da se seti. Neće.

### R3. Fiskalizacija.

Kasa u panelu izdaje porudžbinu, ali **ne izdaje fiskalni račun**. U Srbiji je
promet robe i usluga u maloprodaji predmet Zakona o fiskalizaciji (ESIR + PFR
kroz SUF). Piće, grickalice i vreme za računarom se prodaju gostu za novac.

Proveri sa knjigovođom šta tačno važi za tvoju delatnost - ali računaj sa dve
posledice:
- Za **tvoju** igraonicu: verovatno već imaš fiskalnu kasu i sada kucaš svaki
  račun dvaput. Duplo unošenje = greške u pazaru.
- Za **prodaju drugima**: bez ovoga se ne može ni razgovarati sa ozbiljnim
  vlasnikom. Sa ovim - to je zid koji nijedan strani konkurent neće preskočiti.

### R4. Servisni PIN je `1234` i proverava se lokalno.

Tvoj sopstveni komentar u `podesavanja.json` opisuje napad savršeno:

> *OBAVEZNO promeni pre otvaranja - bez toga igrac koji iscupa mrezni kabl moze
> da preusmeri racunar na svoj server.*

Zaštita koja zavisi od toga da se neko seti ručnog koraka nije zaštita. Ovo
mora da postane nemoguće da se zaboravi: launcher preuzme PIN sa servera pri
prvom povezivanju i čuva ga heširanog, a fabrički PIN stoji crveno u panelu -
isto kao već postojeće upozorenje za `admin/admin`.

### R5. Nema HTTPS.

Lozinka vlasnika ide u čistom tekstu preko LAN-a pri prijavi na panel. Isto i
lozinka igrača kroz WebSocket. Token računara stoji u adresi (`?token=...`).

Igrači sede na **istoj mreži** kao server. Laptop na tom switch-u dovoljan je da
se to pročita. Za jednu igraonicu sa poznatim gostima to je nizak rizik; za
proizvod koji prodaješ, to je pitanje koje ćeš dobiti odmah.

### R6. Nadogradnja 13 mašina je ručna, preko admin naloga.

Verzija ti je 2.44.0 - dakle izdaješ često. Svako izdanje = 13 prijava na
administratorski nalog. To se uradi dvaput, treći put se preskoči, i za mesec
dana imaš pet različitih verzija u prostoriji. Panel već pokazuje verziju po
računaru; ta kolona će postati spisak srama umesto alata.

### R7. Monoliti počinju da koštaju.

| Fajl | Linija |
|---|---|
| `server/public/js/app.js` | 3298 |
| `server/src/service.js` | 2441 (116 export-a) |
| `client/renderer/js/launcher.js` | 2325 |

Još uvek se snalaziš u njima jer si ih ti pisao. Ne gori - ali ovo je tačka
posle koje svaka nova funkcija košta više nego prethodna.

### R8. 1377 provera koje niko ne pokreće automatski.

Nema CI-ja, nema hook-a, nema lint-a. Najbolji test paket koji sam video na
projektu ove veličine zavisi od toga da se setiš da otkucaš komandu.

### R9. Sitno, ali ispravi u prolazu.

- `auth.js`: `issuePlayerToken` / `getPlayer` / `revokePlayerToken` se **nigde ne
  pozivaju**. Mrtav kod u fajlu koji čuva bezbednost - najgore moguće mesto za njega.
- `service.js` ~1288: `javljeni.poslednje` je obično svojstvo zakačeno na `Set`.
  Radi, ali je zamka za sledećeg čitaoca (uključujući tebe za godinu dana).
- `README.md` kaže "preko 900 provera", `PROVERI.md` kaže "1300+", stvarno stanje
  je 1377. `DEPLOY.md` §2.2 još kaže *"To radimo u sledećoj verziji"* za
  `electron-builder` koji je odavno gotov. Netačna dokumentacija uči čitaoca da
  joj ne veruje.

---

## Deo 3 - Plan

Pet faza. **Redosled nije predlog** - svaka sledeća se oslanja na prethodnu.

---

### FAZA 0 - Temelji (jedno popodne, pre bilo čega drugog)

Ništa od ovoga nije funkcija za korisnika. Sve je osiguranje.

**0.1 Prvi commit. Danas.**

```bash
git commit -m "CRIT 2.44.0 - kompletan sistem pred otvaranje"
```

Zatim privatni repo (GitHub/GitLab) i `git push`. OneDrive nije rezervna kopija
koda - on sinhronizuje i grešku.

**0.2 Commit po završenoj celini, ne po danu.** Poruka odgovara na *zašto*, ne
na *šta* - isto pravilo koje već primenjuješ u komentarima. Tvoji unosi u
PLAN.md su već skoro savršene commit poruke.

**0.3 Kopija van računara.** Server jednom dnevno kopira poslednji snapshot na
drugo mesto - USB koji stalno stoji, mrežni disk, ili oblak. Kod je trivijalan
(kopiranje jednog fajla), a rešava jedini scenario u kome gubiš sve. Uz to: u
panelu prikaži **datum poslednje uspešne kopije van računara**, crveno ako je
starija od dva dana.

**0.4 Testovi na svaki commit.**
- `.git/hooks/pre-commit` -> `node testovi/pokreni-sve.mjs`
- GitHub Actions workflow sa istim pozivom

**0.5 Verzija na jednom mestu.** `server/package.json`, `client/package.json` i
provera u `napravi-paket.mjs` moraju da se poklope. Sada se usklađuju ručno.
Jedna skripta `verzija.mjs 2.45.0` koja upiše sve tri.

**Ishod:** rad ne može da nestane, kvar ne može da prođe neprimećeno.

---

### FAZA A - Do prvog radnog dana

Cilj: igraonica radi 30 dana bez tvoje intervencije.

**A.1 Servisni PIN se ne može zaboraviti** (R4). Najvažnija bezbednosna stavka.

**A.2 Auto-update launchera** (R6). `electron-updater`, a kanal ažuriranja je
**tvoj sopstveni server** - on već servira statičke fajlove i već zna verziju
svake mašine. Tok: okačiš instaler u panelu -> launcheri se sami nadograde pri
sledećem paljenju -> panel pokaže ko je ostao. Funkcija koja ti štedi sate
svakog meseca, doživotno.

**A.3 Zdravlje mašina u panelu.** Launcher već meri CPU, RAM i temperaturu za
donju traku - neka taj podatak stigne i do servera. Panel dobija tihi red:
*PC-07: disk 94% pun*, *PC-03: 89°C duže od 10 min*. Kvar koji se vidi dan
ranije je jedini kvar koji ne košta smenu.

**A.4 Rezervacije** - jedina veća stavka iz PLAN.md koja fali. Sad je pravi
trenutak: pre otvaranja se dizajnira, posle otvaranja se krpi.

**A.5 Osveži dokumentaciju** (R9).

---

### FAZA B - Prvih 90 dana rada

Cilj: pretvoriti stvarni rad u dokaz i u podatke.

**B.1 Dnevnik kvarova.** Jedan fajl, `KVAROVI.md`. Svaki put kad nešto pukne:
datum, šta se videlo, šta je bio uzrok, šta je promenjeno. Za tri meseca to je
najvredniji dokument u projektu - i tvoja lista funkcija za sledeću godinu,
napisana od strane stvarnosti umesto od strane pretpostavke.

**B.2 Turniri.** Igraonice žive od njih. Grupe, parovi, tabela, nagradni fond u
kreditu (mehaniku već imaš kroz točak). Ovo je jedina funkcija koja **dovodi
goste**, a ne samo opslužuje one koji su već tu.

**B.3 Napredak igrača.** Već beležiš svako pokretanje igre. Iz toga: nivo, sati
po igri, "stalni gost" status, popust posle X sati. Igrač koji ima broj koji
raste ne odlazi u igraonicu preko puta.

**B.4 Igrač na telefonu.** Stanje kredita, koliko mu je vremena ostalo,
rezervacija, poručivanje pića. Server već ima skoro sve; treba mu jedna web
strana i token po igraču - a `auth.js` već ima napisan (i neiskorišćen)
mehanizam baš za to (R9).

**B.5 Fiskalizacija** (R3). Počni od razgovora sa knjigovođom, ne od koda.
Najmanji koristan korak: izvoz prometa u obliku koji knjigovođa prihvata. Puna
ESIR integracija je faza C.

---

### FAZA C - Od alata do proizvoda

Ovde se odlučuje da li je ovo bio hobi ili posao.

**Prvo iskreno o tržištu.** Konkurencija postoji i deo nje je besplatan -
Gizmo, SENET, CafeSuite, Antamedia. Na broju funkcija se protiv njih ne
pobeđuje. Ali imaš **tri stvari koje oni nemaju i neće imati**:

1. **Domaći jezik i domaća podrška.** Vlasnik igraonice u Nišu koji zove i
   dobije odgovor na srpskom istog dana - to strana firma ne prodaje.
2. **Fiskalizacija za Srbiju.** Nijedan globalni proizvod neće raditi ESIR
   integraciju za Balkan. To je jedini pravi zid koji možeš da podigneš.
3. **Radi bez interneta.** Konkurencija je uglavnom u oblaku. Kad padne net,
   tvoja igraonica radi, njihova staje. To je prodajna rečenica, ne tehnički detalj.

**C.1 Odvoji brend od koda.** Sada je "Crit" ušiven u seed (13 računara, RSD,
srpski, `rs.crit.launcher`). Sve ide u podešavanja: naziv, valuta, broj računara,
logo, jezik. Ovo je najveći refaktor u planu i uslov za sve ostalo.

**C.2 Refaktor monolita** (R7), uz isto pravilo komentara koje već imaš:
- `service.js` -> `naplata.js`, `smene.js`, `shop.js`, `racunari.js`, `igraci.js`, `izgled.js`
- `app.js` -> jedan modul po strani panela

Bez alata za pakovanje, bez okvira - ES moduli su dovoljni. Radi to **jedan
modul po commit-u**, uz pun test paket posle svakog.

**C.3 Instalacija u jednom potezu.** Danas je puštanje igraonice pet dokumenata
i deset ručnih koraka. Cilj: jedan instaler za server (ugrađen Node, servis
umesto `.bat` petlje, firewall sam), jedan za launcher, i **QR kod ili
šestocifreni kod** umesto ručnog prepisivanja tokena po mašini.

**C.4 HTTPS** (R5). Sertifikat koji server sam generiše pri prvom pokretanju,
plus lozinka koja se nikad ne šalje u čistom tekstu.

**C.5 Prva tri kupca.** Ne reklama, ne sajt. Tri igraonice u tvom gradu, ti
lično postavljaš, ti lično dežuraš prve dve nedelje. Model naplate: **ne prodaj
softver, prodaj mir** - mesečno po računaru, uz postavljanje i podršku. Ono što
najviše vredi u tvom paketu nije kod nego `DEPLOY.md` i `PROVERI.md`.

---

### FAZA D - Skaliranje (samo ako faza C uspe)

- Više lokacija pod jednim vlasnikom, zajednički nalog igrača
- Nadzorna tabla u oblaku (lokalni server ostaje glavni - oblak samo gleda)
- Hrvatski, bosanski, makedonski, engleski
- Kartično plaćanje i dopuna sa telefona
- Otvoreni API za integracije

---

## Deo 4 - Kako da budeš bolji

Ovo tražiš, pa odgovaram bez ublažavanja.

### Šta već radiš bolje od većine profesionalaca - nemoj to izgubiti

- **Pišeš zašto, ne šta.** Nastavi. Ovo je jedina navika koja se ne može naučiti
  iz knjige i jedina po kojoj se ozbiljan kod razlikuje od običnog.
- **Zamišljaš mašinu u prostoriji, ne funkciju u editoru.** Iščupan kabl, sat
  koji skoči, OneDrive, disk. To je razlika između programera i inženjera.
- **Zapisuješ šta NISI uradio i zašto.** Retko i vredno.
- **Napravio si drugi sloj testova jer si prozreo prvi.** To je sposobnost koju
  timovi plaćaju skupo.

### Pet navika koje ti fale

**1. Commit-uj. Danas.** Nemaš alat za rad sa vremenom. Bez istorije ne možeš da
odgovoriš na "kad je ovo prestalo da radi", a to je pitanje koje ćeš postaviti.

**2. Automatizuj svaku proveru koje moraš da se setiš.** Pravilo: *ako zavisi od
mog pamćenja, to je bag u procesu.* Važi za testove, za promenu PIN-a, za kopiju
van računara, za usklađivanje verzija.

**3. Deli fajlove pre nego što zaboli.** Danas nasumično otvoriš `service.js` na
liniji 1400 i znaš gde si. Za šest meseci nećeš. Podeli dok ti je kontekst još
u glavi - refaktor koji radiš sada je sat vremena, isti taj kroz godinu je dan.

**4. Dokumentacija se menja u istom commit-u kao kod.** Tvoja je odlična, ali
već zaostaje na tri mesta (R9). Netačna dokumentacija je gora od nikakve.

**5. Pusti ljude u to pre nego što misliš da je spremno.** Sve je gotovo osim
onoga što se ne može znati sa razvojnog računara - a to si i sam zapisao u
PROVERI.md. Jedna nedelja rada sa pravim gostima daje ti više nego mesec dorade.
Baza ti je trenutno prazna: 0 igrača, 0 sesija, 0 porudžbina. Ovaj sistem još
nije upoznao nijednog gosta, i to je sada najveći nedostajući podatak u projektu.

### Jedna zamka koju vidim

Ovaj projekat pokazuje sklonost ka **poliranju**. PLAN.md ima četiri uzastopna
redizajna launchera (v2 immersive, v3 feedback, v4 doživljaj) - a rezervacije,
koje gost traži telefonom, i dalje nisu urađene; kopija van računara ne postoji;
nema nijednog commit-a.

To je najlepša zamka u zanatu, jer poliranje **liči** na napredak i odmah se
vidi. Nije da su animacije pogrešne - one prave doživljaj po kome se igraonica
pamti. Ali za svaku sledeću stvar postavi jedno pitanje:

> **Ako ovo ne uradim, šta konkretno gubim - gosta, novac, ili noć sna?**

Coin-burst na porudžbinu: ništa od toga.
Kopija van računara: sve troje, odjednom, jednog dana.

---

## Deo 5 - Prva nedelja, konkretno

| Dan | Šta | Zašto |
|---|---|---|
| 1 | `git commit` + privatni repo + push | R1 - nestaje najveći rizik |
| 1 | Promeni servisni PIN na svim mašinama | R4 - odmah, dok se ne reši u kodu |
| 2 | Dnevna kopija van računara + prikaz u panelu | R2 |
| 2 | pre-commit hook + GitHub Actions | R8 |
| 3 | Servisni PIN sa servera, fabrički blokira rad | R4 trajno |
| 4-5 | `electron-updater` preko sopstvenog servera | R6 - vraća uloženo vreme prvog meseca |
| 5 | Obriši mrtav kod, uskladi brojeve u dokumentaciji | R9 |
| 6 | Prođi PROVERI.md na pravoj mašini sa Steam-om i na telefonu | jedino što se ne može proveriti odavde |
| 7 | **Otvori.** | ostatak plana piše stvarnost, ne pretpostavka |

---

## Zaključak

Kod je ozbiljan. Testovi su ozbiljni. Dokumentacija je ozbiljna. Ono što deli
ovaj projekat od "najozbiljnijeg" nisu funkcije - to je **disciplina oko rada
koji već postoji**: istorija verzija, kopija van računara, automatska provera,
automatska nadogradnja.

To je nedelja dana posla.

Sve posle toga - turniri, telefon, fiskalizacija, drugi kupci - gradi se na
tome. I gradi se mnogo brže nego što misliš, jer je teži deo, onaj koji većina
nikad ne savlada, već iza tebe.
