# CRIT - postavljanje u igraonici

Uputstvo za pravu instalaciju na svim računarima. Podeljeno na: glavni računar (server), računari igrača (launcher), i zaključavanje sistema.

---

## 1. Glavni računar - server

### 1.1 Instalacija
```
cd server
npm install
npm start
```
Zapamti IP adresu glavnog računara sa LAN mreže (piše se pri pokretanju, npr. `192.168.0.10`).
Preporuka: postavi **fiksnu (statičku) IP adresu** glavnog računara u ruteru/mreži da se ne menja.

### 1.2 Otvaranje porta u firewall-u
Da bi računari igrača i telefon mogli da pristupe, dozvoli port **8095**:
```
netsh advfirewall firewall add rule name="Crit Server" dir=in action=allow protocol=TCP localport=8095
```
(pokreni PowerShell/CMD kao administrator)

### 1.3 Automatsko pokretanje servera pri paljenju
Napravi `server/start-server.bat`:
```bat
@echo off
cd /d "%~dp0"
node src\index.js
```
Zatim: `Win + R` > `shell:startup` > napravi prečicu do `start-server.bat`.
(ili preko Task Scheduler: "At startup", pokreni bat)

### 1.4 Pristup sa telefona
Telefon mora biti na **istoj mreži** (WiFi koji ide na isti switch/ruter).
U browseru telefona otvori `http://IP_GLAVNOG:8095` (npr. `http://192.168.0.10:8095`).

---

## 2. Računari igrača - launcher

### 2.1 Dodaj računare u panel
Panel > **Računari** > za svaki fizički računar klikni "Dodaj računar" (PC-01, PC-02, ...).
Svaki dobija svoj **token**. Token ide u launcher tog računara.

### 2.2 Instalacija launchera
Kopiraj `client/` folder na računar igrača (ili na mrežni disk). Zatim:
```
cd client
npm install
npm start
```
Prvi put unesi:
- **Adresa servera**: `http://IP_GLAVNOG:8095`
- **Token računara**: iz panela > Računari

Podešavanje se pamti (`config.json` u user data folderu), tako da sledeći put ide direktno na login.

> **Ovako se radi samo na razvojnom računaru.** U igraonici ide gotov instaler:
> `Crit Launcher Setup X.Y.Z.exe` (pravi se sa `npm run build` u `client/`), pa
> na računarima igrača ne treba ni Node ni npm. Postupak je u
> [POKRETANJE.md](POKRETANJE.md), korak 2.

> **Za DRUGU igraonicu prvo se menja ime**, pa tek onda gradi:
> `node igraonica.mjs "Ime igraonice"`. Bez toga ta igraonica dobija instaler
> koji se zove tuđim imenom, a njeni alati za oporavak (`POPRAVI-RACUNAR.bat` i
> ostali) gase proces koji na njenim mašinama ne postoji - i pri tom jave da je
> sve prošlo. Bez argumenta alat samo pokaže gde koje ime stoji.

### 2.3 Automatsko pokretanje launchera pri paljenju
Napravi `client/start-launcher.bat`:
```bat
@echo off
cd /d "%~dp0"
npm start
```
`Win + R` > `shell:startup` > prečica do `start-launcher.bat`.

---

## 3. Zaključavanje računara igrača

Zaštita ide u dva sloja: ono što radi **sam launcher** (uvek aktivno) i ono što se
podešava **u Windows-u** (jednom po računaru).

### 3.1 Šta launcher radi sam

| Zaštita | Ponašanje |
|---|---|
| Preko celog ekrana | Kiosk prozor bez naslovne trake, uvek u prvom planu dok se ne pokrene igra |
| **Desktop se nikad ne vidi** | Kad se pokrene igra, launcher se ne minimizuje - samo propušta igru ispred sebe i ostaje raširen **iza nje** |
| Nadzor prozora | Provera svake sekunde: ako je prozor minimizovan ili sakriven (Win+D, "minimize all", pad procesa) odmah se vraća |
| Ne može da se ugasi | Zatvaranje prozora, Alt+F4 i "ugasi sve prozore" ne gase launcher; ako prozor nekako nestane, pravi se novi |
| Blokirane prečice | `Ctrl+Shift+Esc`, `Ctrl+Esc`, `Alt+Esc`, `Win+D/E/R/L/M/Tab/X/I/S/A`, `Win+strelice`, `F11` |
| Kraj sesije čisti sve | Odjava, zaključavanje i istek vremena gase igre **i pregledač** (sledeći igrač ne zatiče tuđe kartice) |
| Jedna instanca | Drugi pokušaj pokretanja samo vraća postojeći launcher u prvi plan |

`Alt+Tab` i `Alt+F4` namerno **nisu** blokirani - trebaju igraču da zatvori ili prebaci igru,
a bezopasni su jer je launcher raširen ispod svega i ne može da se zatvori.

Prečice za osoblje: `Ctrl+Alt+U` otključavanje (PIN), `Ctrl+Alt+Home` povratak u launcher,
`Ctrl+Alt+Shift+Q` izlaz iz launchera (PIN).

### 3.2 Windows podešavanje (jednom po računaru)

1. Napravi **poseban Windows nalog za igrače** - obavezno *standardni*, ne administrator.
   Time igrač ne može da instalira, menja sistem ni da ugasi zaštitu.
2. Prijavi se na taj nalog i pokreni **`client\zastita-ukljuci.bat`** (desni klik > *Run as administrator*).
   Gasi: Task Manager, Registry Editor, promenu lozinke, zaključavanje, odjavu, Windows taster,
   `Win+R` i gašenje iz Start menija. Usput gasi i Fast Startup (smeta Wake-on-LAN-u).
3. Odjavi se i prijavi ponovo da podešavanja stupe na snagu.

4. **Odloži Windows Update van radnog vremena.** Ovo launcher namerno ne dira -
   isključivanje ažuriranja ostavlja mašine nezakrpljene, a nasilno odlaganje se
   teško vraća u normalu. Umesto toga, u Windows-u:
   *Settings > Windows Update > Advanced options > **Active hours*** i upiši
   vreme kad igraonica radi (npr. 10:00-02:00). Windows tada neće sam
   restartovati računar - a restart nasred turnira je najskuplji kvar koji
   ovde može da se desi.
   Ako treba potpuni mir tokom vikenda: *Pause updates* (do 5 nedelja).

Za servis računara: **`client\zastita-iskljuci.bat`** (isto kao administrator) vraća sve u normalu.

> **Plan napajanja** launcher menja sam: dok radi, računar ne ide na spavanje i
> ekran se ne gasi (Windows to fabrički radi posle par minuta, pa bi se ekran
> ugasio nasred filma ili striminga). Pri admin izlazu se vraća na *Balanced*.

> Launcher pokušava da postavi ova podešavanja i sam pri pokretanju, ali na nekim
> računarima Windows odbije upis bez admin prava. Zato pokreni `.bat` - to je pouzdan način.

### 3.3 Launcher dira Windows samo kad je INSTALIRAN

Ovo je namerno i važno je da se zna, jer menja šta radi `npm start`.

Četiri stvari koje launcher radi ne tiču se samo njegovog prozora nego menjaju
sam Windows: **politike u registru**, **plan napajanja**, **gašenje pokrenutih
programa** i **čišćenje tragova sesije** (profili pregledača, prijave na Steam i
ostale, korpa za otpatke). Poslednje je nepovratno.

Zato launcher to radi **samo kad je pokrenut iz instalacije** (`Crit Launcher
Setup .exe`). Pokrenut iz izvornog koda — `npm start`, `electron .`, ili bilo
koji alat iz `testovi/` — ne dira ništa od toga i to ispiše u konzoli.

| Kako je pokrenut | Kiosk prozor | Menja Windows |
|---|---|---|
| Instaler (računari igrača) | da | **da** |
| `npm start` iz izvornog koda | da | ne |
| `npm run dev` | ne (u prozoru) | ne |
| alati iz `testovi/` | zavisi od alata | ne |

Raniji način je zavisio samo od zastavice `--no-lock`. Dovoljno je bilo da je
jedan alat zaboravi i **računar na kom se program piše ostane bez svih prijava
na pregledače i Steam**. Zastavica koja se pamti nije zaštita.

Ako baš treba probati zaključavanje bez pravljenja instalera, na mašini u
igraonici: `npm start -- --zakljucaj`. Podrazumevano je bezbedno, opasno se traži.

> **Zaštita razvojnog računara.** Napravi prazan fajl **`CRIT-NE-DIRAJ.txt`** u
> svom korisničkom folderu (`%USERPROFILE%`, npr. `C:\Users\tvoje-ime\`). Dok on
> stoji, taj računar se ne čisti nikad, bez obzira na sve ostalo — ni ako se
> sve druge zaštite zaobiđu. Na računarima igrača tog fajla nema, pa tamo
> čišćenje radi normalno.

### 3.4 Šta se ne može blokirati

Budi svestan granica, da ne računaš na nešto što ne postoji:

- **`Ctrl+Alt+Del` se ne može ugasiti** - Windows ga rezerviše za sebe i nijedan program
  ga ne može presresti. `.bat` iz koraka 3.2 gasi opcije na tom ekranu (Task Manager,
  zaključavanje, odjava, promena lozinke), ali **dugme za gašenje računara ostaje**.
  Najgore što igrač tu može je da ugasi ili restartuje računar - a launcher se pri
  paljenju sam vraća, pa nema štete.
- **Igra sa svojim pregledačem** (npr. Steam ugrađeni browser) ne prolazi kroz naša ograničenja.

### 3.5 Najjača varijanta (kad budeš spreman)

Launcher umesto Explorer-a kao Windows "shell" na nalogu igrača - tada nema ni desktopa
ni Start menija, čak ni ispod launchera. Radi se preko `Winlogon\Shell` po nalogu.
Traži pažljivo testiranje (lako je zaključati samog sebe), pa to radimo tek kad prvi
računar prođe probni rad.

---

## 4. Redosled pri otvaranju igraonice

1. Upali glavni računar > server se sam pokrene > otvori panel.
2. **Otvori smenu** (dugme dole levo, na telefonu gore desno) i upiši koliko para
   ima u kasi na početku. Obračun broji **samo ono što je naplaćeno dok je smena
   otvorena**, pa novac uzet pre toga na kraju dana stoji u kasi kao višak koji
   obračun ne pominje.
   Sistem radi i bez smene i ništa se ne gubi - sve se vidi u Izveštajima - ali
   se onda kasa ne može uredno prebrojati. Ako se to ipak desi, panel te upozori
   na kontrolnoj tabli i ponovo pri zatvaranju smene, sa tačnim iznosom.
3. Upali računare igrača > launcher se sam pokrene > login ekran.
4. Ako je neki računar zaključan (isteklo vreme ili ručno), osoblje seda i kuca `Ctrl+Alt+U` > PIN.
   Polje za PIN se namerno ne vidi igraču; pojavi se na tu prečicu, a ako je neki
   drugi program preotme, isto radi i klik na napomenu "Osoblje" na dnu ekrana.

Na kraju smene: **Zatvori** (isto mesto), prebroj kasu i upiši iznos. Obračun
odmah pokaže da li se poklapa.

## 5. Reset / backup

- Cela baza je u `server/data/crit.db`.
- **Automatski backup** - server sam pravi konzistentan snapshot baze u `server/data/backups/` (pri pokretanju i na svakih 15 min, čuva poslednjih 30). Spisak se vidi u panelu (Podešavanja > Rezervne kopije), odatle svaka kopija može i da se **preuzme** i odnese van računara.
- **Kopija van računara (uradi ovo prvog dana)** - sve gore je na **istom disku**
  kao i baza. Kad taj disk otkaže, nestaje i baza i svih trideset kopija
  odjednom: nalozi, kredit koji su gosti uplatili, promet, cela evidencija.
  U panelu *Podešavanja > Kopija van računara* upiši odredište - **USB koji
  stalno stoji u računaru**, drugi disk, ili mrežni folder. Server tamo jednom
  dnevno odnese najsvežiju kopiju i drži poslednjih sedam.
  Panel proverava odredište odmah pri čuvanju i stoji **crveno** dok kopija ne
  izađe napolje, kao i kad kasnije prestane da izlazi (iščupan USB, odjavljen
  mrežni disk). Isto ide i u *Logove*, jer prozor servera niko ne gleda.
  > Odredište mora da postoji u trenutku kopiranja. Ako ga nema, server **neće**
  > napraviti nov folder da bi kopija "prošla" - javiće grešku. Kopija koja tiho
  > završi u praznom folderu na istom disku gora je od nikakve, jer izgleda kao
  > zaštita koja radi.
- **Vraćanje kopije** - ugasi server pa pokreni **`VRATI-KOPIJU.bat`** u folderu servera. Skripta izlista kopije, traži potvrdu, **snimi trenutnu bazu u `data/pre-vracanja/`** pre nego što je prepiše, i sama obriše `crit.db-wal`/`crit.db-shm`. Ako se predomisliš, kopija od pre vraćanja je tu.
- Za potpuni reset - ugasi server, obriši `server/data/crit.db*`, pokreni ponovo (čist start).

**Prostor na disku - ne treba da ga održavaš**

Kad disk stane, server ne može da piše: prijava, kasa i naplata sesija prestaju
da rade. Zato sistem sam pazi na prostor, a stanje se vidi u
*Podešavanja > Prostor na disku*.

Izmereno na napunjenoj bazi (13 računara, alat `testovi/godina-rada.mjs`):

| | posle 1 godine | posle 5 godina |
|---|---|---|
| baza | 35 MB | **48 MB** (ne raste dalje) |
| rezervne kopije | 1.0 GB | 1.4 GB |
| najsporija pretraga logova | 77 ms | 76 ms |

Baza se ustali jer se logovi i zapisi o pokretanju igara seku na godinu dana.
Promet, sesije i porudžbine se **ne brišu nikad** - to je poslovna evidencija i
bez nje obračun nema smisla, a ona raste svega desetak megabajta godišnje.

Tri kočnice rade same, jednom dnevno i pri svakom pokretanju servera:

1. **Logovi** se seku po starosti (godina dana) i po broju (400.000 zapisa).
   Kad se dođe do granice, briše se najstariji zapis da bi novi imao mesto.
   Zapisi smene koja je još otvorena se ne diraju ni ako su stari.
2. **Rezervne kopije** se proređuju: poslednjih 12 se čuva uvek, pa po jedna
   dnevno za dve nedelje, pa po jedna nedeljno za dva meseca. Isti broj fajlova
   time pokriva **46 dana unazad umesto 7.5 sati**. Preko granice ukupne
   veličine (2 GB) briše se najstarija, ali nikad ispod pet najsvežijih.
3. **Slobodan prostor** se proverava pre svake kopije. Ako ga je manje od 1 GB,
   kopija se preskače, u panelu se pojavi upozorenje i zapis ode u Logove.

Sve granice se menjaju u *Podešavanja > Prostor na disku*, tu je i dugme
*Očisti sada* ako ne želiš da čekaš dnevno čišćenje.

## 5.1 Nadogradnja na novu verziju

**Server (glavni računar) - prvo on.** Radi se **posle zatvaranja**: server u
toku rada drži naplatu.

1. Ugasi server.
2. Napravi kopiju celog `server/data/` foldera sa strane (server i sam pravi
   kopiju pri pokretanju, ali ova je tvoja).
3. Prepiši `server/src/` i `server/public/` novom verzijom. **`server/data/` ne
   diraj** - tu su baza, slike i podešavanja.
4. Pokreni server. Bazu sam prilagodi novoj verziji pri prvom pokretanju,
   ništa se ne unosi ručno.
5. U panelu otvori Podešavanja i proveri da piše nova verzija.

**Računari igrača - odjednom, sa panela.**

Instalater se postavlja **jednom**, na server, a računari ga preuzimaju sami.
Strana *Instalacije*, kartica **Nadogradnja launchera**:

1. **Postavi instalater** - izaberi `Crit Launcher Setup X.Y.Z.exe` iz `dist/`.
   Ime mora da sadrži verziju; po njoj se zna šta je novije. Postavlja ga
   **serviser** - on ga je i napravio, pa jedini može da zna da li valja.
2. Proveri šta piše: verzija, veličina, i koliko računara zaostaje.
3. **Pusti verziju u rad**. Dok to ne uradiš, nijedan računar je ne preuzima -
   ni sa ispravnim tokenom. Prekopiran fajl sam po sebi ne znači ništa.
4. Dalje ide samo. Svaki računar se nadogradi **čim se oslobodi**.

**Računar na kom neko igra se ne dira.** Nadogradnja gasi launcher; usred
plaćenog sata to je oduzeto vreme gostu. Zauzeta mašina stoji u spisku kao
*zauzet* i dolazi na red kad gost ustane. Ne moraš da čekaš i gledaš.

Ako ti treba odmah, *Pošalji slobodnima odmah* pogura sve koji su slobodni.
*Povuci iz rada* zaustavlja dalje preuzimanje (već nadograđene ne vraća).

**Šta računar radi kad dobije poruku.** Preuzme instalater sa tvog servera,
svojim tokenom - adresa ne dolazi u poruci nego je računar sam sklapa, pa
podmetnuta poruka ne može da mu pokrene tuđi program. Proveri da se poklapaju
veličina i otisak (sha256) sa onim što je server najavio; ako ne, briše fajl i
ne pokreće ništa. Tek onda instalira i vraća se. Ceo taj put je pokriven
probama (`testovi/test-nadogradnja-launchera.mjs`,
`testovi/test-pomocnik-nadogradnje.mjs`).

**Računar se vraća i kad nadogradnja ne uspe.** Instalaciju vodi kratka skripta
koja živi duže od launchera, a uz nju ide i *osigurač* - druga skripta koja
posle pet minuta vraća launcher bez obzira na sve. Računar bez launchera je
računar sa otvorenim Windowsom, i to ne sme da potraje.

> **JEDAN POSLEDNJI OBILAZAK.** Sve gore radi tek od verzije koja to ume, a ta
> verzija se instalira **drugačije nego dosadašnje** (vidi ispod). Zato jednom
> moraš na svih 13 mašina. Posle toga više nikad.

**Zašto se instalacija promenila.** Do sada je launcher išao u `Program Files`
(`perMachine: true`), pa je instaler tražio **administratora**. Pod nalogom
igrača Windows tada podigne UAC prozor i čeka klik - a za kasom niko ne gleda
ekran računara broj sedam. Nadogradnja tako ne bi prošla nigde, a razlog se ne bi
video ni u jednoj poruci.

Od sada je instalacija **po korisniku** (`perMachine: false`): launcher ide u
profil naloga igrača i instaler ne traži administratora.

Launcheru administrator ionako nije ni trebao - politike piše u `HKCU`,
`powercfg` menja plan tog korisnika, a autostart je prečica u njegovom `Startup`
folderu. `Program Files` je čuvao samo **sam fajl launchera** od igrača. Igrač
koji ume da pokrene svoj program pod svojim nalogom i danas može da ugasi
launcher i obriše prečicu iz autostarta - kiosk padne bez diranja
`Program Files`-a. Prava brana je spisak dozvoljenog za pokretanje (main.js), ne
mesto na disku.

> Kad nabaviš **sertifikat za potpisivanje koda** (trebaće ti ionako, zbog
> SmartScreen upozorenja pred prodaju), otvara se i treći put: `Program Files` uz
> zakazani zadatak sa punim pravima koji instalira umesto igrača. Tada se ovo
> vraća na `perMachine: true`.

**Ručno, na jednoj mašini** (poslednji obilazak, ili kad nešto zapne):

1. Prijavi se na **administratorski** nalog i **deinstaliraj staru verziju** -
   `DEINSTALIRAJ-LAUNCHER.bat` (radi i za staru iz `Program Files` i za novu iz
   profila). Ovaj korak se preskače samo ako na mašini nikad nije ni bilo
   launchera.
2. Prijavi se na **nalog igrača** - nova instalacija ide u njegov profil, pa se
   pokreće **odatle**, ne sa administratorskog naloga.
3. Pokreni `Crit Launcher Setup X.Y.Z.exe`. Ne traži administratora.
4. Proveri da prečica u `Startup` folderu tog naloga pokazuje na novu putanju
   (`%LOCALAPPDATA%\Programs\Crit Launcher\`), pa restartuj računar i vidi da se
   launcher digao sam.
5. U panelu, na strani Računari, kolona *verzija* mora da pokaže novu.

Adresa servera i token ostaju - stoje u nalogu korisnika, a instaler ih ne dira.


> **Verzije smeju da se razlikuju dok traje nadogradnja.** Stariji launcheri rade
> normalno dok im ne dođe red. Panel pokazuje verziju svakog računara, tako da se
> lako vidi ko je ostao.

> **Servisni PIN ostaje tvoj.** Upisan je u panelu i čuva se na svakoj mašini
> odvojeno od instalacije, pa ga nadogradnja ne dira.

## 5.2 Servisni PIN - upisuje se jednom, u panelu

Servisni PIN otvara **podešavanja launchera** i **izlaz iz kioska kad server ne
radi**. To je jedini izlaz koji osoblje ima kad glavni računar padne, pa mora da
se proveri lokalno, na samoj mašini.

Upisuje se u **Podešavanja > Servisni PIN launchera** i odatle stiže na sve
računare **odmah**, dok gledaš u ekran. Ne kuca se ni na jednoj mašini posebno.

- Dok nije upisan, na mašinama važi fabrički **`1234`** i panel stoji crveno.
  Dok je tako, igrač koji iščupa mrežni kabl može da sačeka dugme *Promeni
  adresu servera*, ukuca `1234` i preusmeri računar na svoj server.
- Čim ga upišeš, **fabrički prestaje da važi na svima odjednom**.
- Radi i kad server ne radi: launcher ga pamti u svom `config.json` (u nalogu
  korisnika, koji nadogradnja ne dira).
- Šalje se kao **heš, ne kao sam PIN** - ne putuje mrežom i ne stoji u čitljivom
  obliku na računaru igrača.

> Ručno upisivanje u `podesavanja.json` pored programa i dalje radi kao rezerva
> i preživljava nadogradnju, ali više nije potrebno. Ako je tamo upisan PIN koji
> nije fabrički, prolazi i on - namerno, jer pogrešna strogost ovde zaključava
> osoblje na svih trinaest mašina.

## 6. Bezbednost

- **Odmah promeni admin šifru** (Podešavanja) i **PIN za otključavanje**.
- Panel je dostupan svima na mreži ko zna adresu - drži glavni računar i WiFi šifru kod osoblja.
- Za pristup samo osoblju: ne deli WiFi šifru sa igračima, ili stavi glavni računar na odvojen VLAN.

**Kad radnik ode**

*Radnici > ikona kante* mu oduzima pristup. Prijava prestaje da radi odmah, a
panel koji je ostavio otvoren se zatvara sam, tako da ne mora da se ide do
mašine na kojoj je bio prijavljen.

Nalog se pri tom **gasi, ne briše**. Smene koje je otvarao i dopune koje je
upisivao ostaju potpisane njegovim imenom, jer bez toga obračun smene nema
smisla: manjak u kasi mora da ima ime. Ugašen nalog ostaje na spisku, precrtan,
i može da se vrati dugmetom *Vrati* ako se radnik vrati na posao.

Nalog koji nikad ništa nije uradio (napravljen greškom) se briše skroz.

> Ako mu je smena bila otvorena, panel te upozori: pošto više ne može da uđe,
> tu smenu moraš sam da zatvoriš i prebrojiš kasu.

**Kočnica protiv pogađanja lozinki**

Pet pogrešnih pokušaja i sledi 30 sekundi pauze. Važi za prijavu na panel, za
prijavu igrača u launcheru i za PIN osoblja. Bez toga se lozinka pogađa
hiljadama pokušaja u sekundi, a igrači sede na istoj mreži kao server.

- Pauza je **po računaru i po nalogu**. Ako se neko zaključa na jednoj mašini,
  osoblje sa druge i dalje ulazi normalno.
- Uredna odbijanja se **ne broje**: nema kredita, nalog blokiran, već je
  prijavljen na drugom računaru. Inače bi igrač koji svaki dan uredno ulazi
  završio zaključan bez razloga.
- Svako zaključavanje se upisuje u **Logovi**. Ako tamo vidiš niz takvih
  zapisa sa jedne adrese, neko pokušava da uđe.

## 7. Zaštitne mere / pouzdanost (nestanak struje, mreže)

Server je na jednom café računaru, pa je bitno da sve nastavi glatko posle prekida.

**Računar kome je iščupan kabl**

Kad se računaru prekine mreža nasilno - iščupan kabl, zamrznut Windows, ruter se
resetovao - TCP veza ne umire odmah. Ostaje otvorena i po nekoliko sati, jer
nijedna strana nema šta da pošalje pa niko ne primeti da druge nema.

Za igraonicu je to skupo dvaput: panel pokazuje računar kao **zauzet** pa radnik
tamo ne posadi nikoga, a **naplata teče** iako za tim računarom niko ne sedi.

Zato server pinguje svaku vezu na 15 sekundi i gasi onu koja ne odgovori do
sledećeg ping-a. Gubitak se vidi za najviše pola minuta, računar odmah pređe u
*van mreže*, a naplata staje sama. Kad se vrati, nastavlja se bez nadoknadnog
računa za vreme dok ga nije bilo.

Launcher se sam vraća na vezu svake 3 sekunde, tako da niko ne mora da obilazi
mašine posle restarta servera ili rutera.

**Automatski restart servera**
- Pokreći server preko `server/start-server.bat` - on ima **restart petlju**: ako se node sruši, server se sam ponovo pokrene za 3s.
- Da se pokrene i posle paljenja računara: `Win+R` > `shell:startup` > prečica do `start-server.bat` (ili Task Scheduler "At startup").

**Nestanak struje na serveru**
- Posle paljenja, server se sam digne (startup) i **nastavi aktivne sesije** čim se launcheri ponovo povežu.
- Vreme dok je server bio ugašen se **NE naplaćuje** igračima (nema "catch-up" naplate).
- Baza je u WAL režimu + checkpoint na 2 min > otpornija na nagli prekid; uz to postoje automatski backup-i.
- **Preporuka: UPS** (besprekidno napajanje) na glavni računar i mrežnu opremu (ruter/switch) - dobija se par minuta da se sve uredno ugasi.

**Nestanak struje / mreže na računaru igrača**
- Dok je taj računar odsečen (nema veze sa serverom), njegova sesija se **ne naplaćuje** (naplata se pauzira).
- Kad se računar vrati i launcher ponovo poveže, sesija se **nastavlja** i naplata kreće dalje.
- Launcher sam pokušava ponovno povezivanje svake 2-3s.

**Internet nije potreban za rad**
- Ceo osnovni rad (prijava, sesije, naplata, shop, panel) ide preko **lokalne mreže (LAN)** - radi i bez interneta.
- Internet treba samo za: daljinsku instalaciju preko URL-a i pristup internetu iz launchera. Ako net padne, sve ostalo radi normalno.

**Bitno**
- Glavni (server) računar **ne treba** da bude i igračka stanica sa launcherom - neka radi samo server + panel.
- Statička IP adresa glavnog računara (da se ne menja adresa panela/servera).

## 8. Paljenje računara na daljinu (Wake-on-LAN)

Na kontrolnoj tabli, svaki **offline** računar dobija dugme **"Upali"**, a gore stoji **"Upali sve (N)"** - jednim klikom se ujutru dižu sve mašine. Server šalje "magic packet" preko lokalne mreže na mrežnu karticu tog računara.

**Da bi radilo, treba jednom podesiti svaki računar igrača:**

1. **Ethernet kabl (obavezno).** WoL preko Wi-Fi-ja je nepouzdan - računari igrača neka su na žičnoj mreži.
2. **BIOS/UEFI.** Uđi u BIOS (obično `Del` ili `F2` pri paljenju) i uključi opciju pod imenom tipa **"Wake on LAN"**, "Power On By PCIE/PCI", "Resume by LAN" ili "ErP" postaviti na Disabled (ErP Enabled zna da ugasi napajanje kartice). Naziv zavisi od ploče.
3. **Windows - mrežna kartica.** `Device Manager` > `Network adapters` > desni klik na karticu > `Properties`:
   - tab **Power Management**: čekiraj "Allow this device to wake the computer" i "Only allow a magic packet to wake the computer".
   - tab **Advanced**: "Wake on Magic Packet" > `Enabled` (i "Wake on pattern match" > Disabled).
4. **Isključi Fast Startup.** `Control Panel` > `Power Options` > "Choose what the power buttons do" > "Change settings that are currently unavailable" > odčekiraj **"Turn on fast startup"**. (Windows Fast Startup ume da spreči WoL iz potpuno ugašenog stanja.)

**Kako server sazna MAC:** ništa se ne kuca ručno. Čim se launcher poveže dok je računar upaljen, javi svoje mrežne kartice i server sam zapamti MAC prave LAN kartice. Posle toga dugme "Upali" radi i kad je računar ugašen. U modalu "Detalji" računara vidi se zabeležen MAC.

**Ograničenja:** radi samo unutar iste lokalne mreže (isti switch/broadcast domen kao server). Ako je računar bio potpuno bez struje (iskopčan), WoL ne može da ga probudi.
