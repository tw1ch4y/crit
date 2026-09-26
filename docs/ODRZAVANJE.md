# Rad i održavanje

## 1. Svakodnevni rad

**Početak dana.** Glavni računar se pali prvi; server se diže sam. Računari
igrača se pale iz panela (*Upali sve*) ili rukom, a launcher kreće sam.

**Smena.** Radnik otvara smenu i upisuje početno stanje kase. Obračun broji
samo ono što je naplaćeno dok je smena otvorena. Naplata posle zatvaranja
smene stoji kao upozorenje na kontrolnoj tabli, sa iznosom.

**Kraj dana.** *Zatvori smenu*, prebrojati kasu i upisati iznos; obračun
odmah pokazuje razliku i traži objašnjenje za manjak. Zatim *Ugasi sve (kraj
smene)*. Gašenje sa panela zatvara sesije koje su još otvorene, pa se ujutru
ništa ne nastavlja i ne naplaćuje.

**Uloge.** *Radnik* radi kontrolnu tablu, igrače, porudžbine i kasu.
*Vlasnik* uz to menja cene, podešavanja, katalog i radnike. *Serviser*
postavlja nadogradnje; nalog mu pravi `node alati/serviser.mjs <ime> <lozinka>`
na glavnom računaru. Radnik koji ode gasi se na strani *Radnici*: prijava
prestaje odmah, a smene i dopune ostaju potpisane njegovim imenom.

## 2. Upozorenja u panelu

| Upozorenje | Značenje |
|---|---|
| fabrička lozinka | nalog `admin` još ima lozinku `admin` |
| fabrički servisni PIN | navedeni računari još primaju `1234` |
| kopija van računara | nije podešena ili poslednje kopiranje nije uspelo |
| *Bez veze* na kartici računara | sesija je otvorena, a računar se ne javlja; posle minut stiže zvučno upozorenje |
| kvar launchera | pukao ekran launchera, izlaz bez PIN-a, program van kataloga |
| malo mesta na disku | manje od 1 GB slobodno; kopije se preskaču dok se ne oslobodi |

*Bez veze* znači izvučen kabl, ugašen launcher ili pad računara. Naplata za
to vreme stoji; ako je kabl izvučen, launcher broji sam i server posle naplati
odigrano, ali ugašen launcher ne broji ništa.

## 3. Rezervne kopije

### 3.1 Automatske kopije

Server pravi kopiju baze pri pokretanju i na svakih 15 minuta, u
`server\data\backups\`. Kopije se proređuju: poslednjih 12 ostaje uvek, zatim
po jedna dnevno za dve nedelje i po jedna nedeljno za dva meseca. Ukupna
granica je 2 GB, a pet najnovijih se ne briše nikad. Spisak i preuzimanje:
*Podešavanja > Rezervne kopije*.

### 3.2 Kopija van računara

Sve u 3.1 je na istom disku kao baza. *Podešavanja > Kopija van računara*:
odredište na USB-u koji stalno stoji u računaru, drugom disku ili mrežnom
folderu. Jednom dnevno server tamo nosi najsvežiju kopiju (čuva poslednjih
sedam) i folder `slike\` (omoti, slike pića, pozadine, baneri; prepisuje se
samo ono što se promenilo).

Odredište mora da postoji. Server ne pravi nov folder da bi kopija "prošla";
javlja grešku u panelu i u *Logovima*. Server radi kao SYSTEM, pa mrežni
folder mora da bude dostupan i tom nalogu.

### 3.3 Vraćanje kopije

`VRATI-KOPIJU.bat` u folderu servera:

1. prikazuje poslednjih 15 kopija i traži broj i potvrdu (`DA`);
2. uredno gasi server;
3. trenutnu bazu snima u `data\pre-vracanja\`;
4. vraća izabranu kopiju i ostavlja zahtev za paljenje: sa autostartom server
   se diže za najviše 5 minuta, bez njega se pokreće `Pokreni server.bat`.

Sve što je upisano posle izabrane kopije se gubi; uporediti sa kasom.

**Vraćanje na novom disku ili računaru:** `.db` iz kopije van računara ide u
`server\data\crit.db`, a sadržaj foldera `slike\` u `server\data\uploads\`.
Bez slika baza radi, ali su omoti i pozadine prazni.

### 3.4 Prostor na disku

Logovi se čuvaju godinu dana i najviše 400.000 zapisa; zapisi otvorene smene
se ne diraju. Promet, sesije i porudžbine se ne brišu. Izmereno na punoj bazi
za 13 računara (`testovi/godina-rada.mjs`):

| | posle 1 godine | posle 5 godina |
|---|---|---|
| baza | 35 MB | 48 MB |
| rezervne kopije | 1,0 GB | 1,4 GB |
| najsporija pretraga logova | 77 ms | 76 ms |

Stanje, granice i dugme *Očisti sada*: *Podešavanja > Prostor na disku*.

## 4. Nadogradnja

Nova verzija se pravi na razvojnom računaru ([RAZVOJ.md](RAZVOJ.md)). U
paketu za USB su paket servera i instaler launchera.

### 4.1 Server

*Instalacije > Nadogradnja servera* (serviser):

1. **Postavi paket** - `server-vX.Y.Z.srvpak` iz `3 - NADOGRADNJA SA PANELA`.
   Server proverava otisak i putanju svakog fajla; neispravan paket se odbija.
2. **Nadogradi.** Server pravi kopiju baze, raspakuje novu verziju i gasi se;
   nadzornik menja kod i diže novu verziju. Panel se osvežava sam.

Server ne radi dvadesetak sekundi; launcheri za to vreme rade bez njega. Ako se
nova verzija ne javi svojim brojem za minut i po, nadzornik vraća prethodnu i
to piše u panelu i u *Logovima*. Prethodne dve verzije ostaju u
`server\data\nadogradnja-servera\`.

### 4.2 Launcher

*Instalacije > Nadogradnja launchera* (serviser):

1. **Postavi instalater** - `Crit Launcher Setup vX.Y.Z.exe`.
2. **Pusti verziju u rad.** Do tada je nijedan računar ne preuzima.
3. Računari se nadograđuju **čim se oslobode**; računar na kom se igra se ne
   dira. *Pošalji slobodnima odmah* pokreće sve slobodne, *Povuci iz rada*
   zaustavlja dalje preuzimanje.

Računar preuzima instaler sa svog servera, svojim tokenom, i pre pokretanja
proverava veličinu i sha256 otisak. Instalaciju vodi pomoćna skripta; ako ne
uspe, launcher se vraća na staru verziju i javlja razlog, a posle najviše pet
minuta se vraća u svakom slučaju.

Instaleri i paketi nose numeraciju verzija (`v` ispred broja). Instaler bez
nje (stara numeracija do 2.58.0) vidi se na spisku, ali se ne pušta.

### 4.3 Prelazak sa stare numeracije (jednom)

Nadogradnja iz panela radi od verzije v1.0.0. Igraonica u kojoj radi starija
verzija (do 2.58.0) prelazi jednom, rukom.

**Server:**

1. Zatvoriti prozor servera i napraviti kopiju celog `server\data\`.
2. Iz paketa (`1 - SERVER (glavni racunar)`) prepisati sve u folder servera
   **osim `data\`**. Stari `start-server.bat` obrisati.
3. `Podesi autostart.bat`, zatim u panelu (*Podešavanja*) proveriti verziju.
4. Proveriti autostart po [PROVERA.md](PROVERA.md), odeljak 1.

Slike iz starog mesta (`server\public\uploads\`) server pri prvom pokretanju
sam prenosi u `server\data\uploads\`; staro mesto ostaje netaknuto.

**Računari igrača:** stara verzija je instalirana u `Program Files`, nova ide
u profil naloga igrača.

1. Na administratorskom nalogu: *Settings > Apps > Crit Launcher > Uninstall*
   (ili `DEINSTALIRAJ-LAUNCHER.bat`). Adresa servera i token ostaju.
2. Prijava na nalog igrača i instalacija `Crit Launcher Setup vX.Y.Z.exe`.
3. Restart. Launcher se diže sam; staru prečicu iz *Startup* foldera briše
   sam.
4. `zastita-ukljuci.bat` dvoklikom sa naloga igrača ([INSTALACIJA.md](INSTALACIJA.md), 3.3).
5. U panelu, na strani *Računari*, kolona *verzija* pokazuje novu verziju.

## 5. Servisni PIN

Servisni PIN otvara podešavanja launchera i izlaz iz kioska kad server ne
radi, pa se proverava lokalno. Upisuje se u *Podešavanja > Servisni PIN
launchera* i stiže na sve računare odmah, kao heš. Čim se upiše, fabrički
`1234` prestaje da važi na svim računarima. Nadogradnja ga ne briše.

PIN upisan ručno u `resources\podesavanja.json` (ako nije fabrički) važi kao
rezerva.

## 6. Kvarovi

### 6.1 Server ne radi

Razlog nije bitan (ugašen računar, pad, izvučen kabl, nadogradnja):

- igrači koji igraju nastavljaju; launcher broji vreme, šalje upozorenja i
  zaključava računar kad kredit istekne;
- igrač može da se odjavi; ostatak kredita mu ostaje;
- zaključan računar se otključava servisnim PIN-om;
- stanje sesije je na disku, potpisano, i preživljava restart računara;
- shop, točak i izmene naloga čekaju server;
- **nova prijava nije moguća** dok se server ne vrati.

Kad se server vrati, svaki launcher javlja koliko je sesija trajala, a server
naplaćuje razliku: ne dvaput, ne više od kredita, po nižoj od dve cene. Sesija
koju je osoblje u međuvremenu zatvorilo se ne naplaćuje.

### 6.2 Nestanak struje

Baza je u WAL režimu (prepis na 2 minuta, kopija na 15), pa nagli prekid ne
kvari upisano. Na računarima igrača sesija se nastavlja posle paljenja; vreme
dok je računar bio ugašen se ne naplaćuje.

### 6.3 Glavni računar ne može da se upali

1. Igrači koji igraju ne primećuju ništa dok im ne istekne kredit (6.1).
2. Na drugom računaru instalirati Node.js i prekopirati folder servera iz
   paketa.
3. Kopiju baze (najsvežija je u `server\data\backups\` starog diska, inače
   kopija van računara) staviti u `server\data\backups\` i pokrenuti
   `VRATI-KOPIJU.bat`.
4. Dodeliti mu **istu IP adresu** koju je imao glavni. Tokeni računara su u
   bazi, pa se na računarima igrača ništa ne menja.
5. `Otvori port u firewall-u.bat` i `Podesi autostart.bat`.

### 6.4 Alati na računaru igrača

U instalaciji launchera, podfolder `resources`:

| Alat | Pokretanje | Namena |
|---|---|---|
| `zastita-iskljuci.bat` | dvoklik, nalog igrača | skida ograničenja za servis računara |
| `resetuj-launcher.bat` | dvoklik, nalog igrača | briše adresu servera i token; launcher traži podešavanje kao prvi put |
| `DEINSTALIRAJ-LAUNCHER.bat` | dvoklik, nalog igrača | uklanja launcher, autostart, podešavanja i ograničenja naloga |
| `POPRAVI-RACUNAR.bat` | *Run as administrator* | kad launcher ne može da se pokrene: gasi ga i skida ograničenja i autostart sa svih prijavljenih naloga |

## 7. Bezbednost

- Lozinka panela i servisni PIN menjaju se pre otvaranja.
- Pet pogrešnih pokušaja (panel, prijava igrača, PIN osoblja) daje pauzu od
  30 sekundi, posebno po računaru i nalogu. Svaka pauza je u *Logovima*.
- Panel i launcheri koriste HTTP; gosti moraju biti na odvojenoj mreži
  ([INSTALACIJA.md](INSTALACIJA.md), odeljak 1).
- Svaki potez osoblja sa novcem i računarima je u *Logovima*, sa imenom.
