# Crit - puštanje u rad

Kratko uputstvo. Detalji su u [DEPLOY.md](DEPLOY.md).

---

> **Adresa servera je već upisana u instaler:** `http://192.168.1.100:8095`.
> Pri podešavanju launchera unosiš samo **token**. Ako glavni računar dobije drugu
> adresu, promeni je u `podesavanja.json` (podfolder `resources` u instalaciji).

## Korak 1 - Glavni računar (server)

**1.1** Instaliraj Node.js - [nodejs.org](https://nodejs.org), dugme **LTS**, sve dalje/dalje. (Samo jednom, na ovom računaru.)

**1.2** Otvori folder `server` i pokreni **`Pokreni server.bat`**.
Prvi put mu treba minut da se pripremi. Kad je gotov, u prozoru piše:

```
Crit server radi na portu 8095
  ovaj racunar:  http://localhost:8095
  mreza/telefon: http://192.168.1.100:8095
```

**Proveri da piše `192.168.1.100`** - to je adresa upisana u launchere. Ako piše drugu, promeni je u `podesavanja.json`.
Prozor servera ostavi otvoren dok igraonica radi.

**1.3** Pokreni **`Otvori port u firewall-u.bat`** (desni klik > *Run as administrator*).
Bez ovoga se drugi računari **ne mogu** povezati - launcher će stajati na "Povezivanje...".

**1.4** Pokreni **`Podesi autostart.bat`** - da se server sam diže kad upališ računar.

**1.5** Otvori panel: `http://localhost:8095` > prijava **admin / admin**.
Odmah idi na **Podešavanja** i promeni lozinku i PIN.

> Preporuka: u ruteru zakuj IP adresu glavnog računara (Static IP / DHCP reservation),
> da se ne promeni pa da moraš da prepodešavaš launchere.

---

## Korak 2 - Prvi računar igrača (launcher)

**2.1** U panelu idi na **Računari** i prepiši **token** za `PC-01`.

**2.2** Na tom računaru napravi **poseban Windows nalog za igrače** - obavezno *standardni*, ne administrator.

**2.3** Prijavi se **na nalog igrača** i odatle pokreni `Crit Launcher Setup.exe`.
Instalacija ide u profil tog naloga i ne traži administratora - zato mora da se
pokrene sa njegovog naloga, a ne sa administratorskog. Tako launcher kasnije ume
sam da se nadogradi sa panela, bez obilaska mašina.

**2.4** Pokreni **Crit Launcher**. Adresa servera je već popunjena
(`http://192.168.1.100:8095`) - unesi samo **token** iz koraka 2.1 i klikni *Sačuvaj i poveži*.

Kad se poveže, u panelu će `PC-01` preći iz *Offline* u *Standby*.

**2.5** Uključi zaštitu. Dok je **nalog igrača prijavljen**, iz paketa (USB ili računar
osoblja), folder `2 - LAUNCHER\ALATI OSOBLJA`, desni klik na **`zastita-ukljuci.bat`** >
*Run as administrator* i upiši lozinku administratora. Skripta sama nađe nalog igrača i
zaštitu upiše **njemu**, ne administratoru. Zatim se odjavi i prijavi ponovo na nalog igrača.

Provera: na nalogu igrača `Ctrl+Shift+Esc` **ne sme** da otvori Task Manager. Ako se
zaštita zaboravi, launcher to sam javi u panel (vidi [Bezbednost kioska](#bezbednost-kioska)).

> Alati osoblja se **ne kopiraju** na računar igrača. Launcher je instaliran u profil
> igrača i igrač sme da menja taj folder. Skripta odatle bi bila poziv da je izmeni i
> sačeka da je neko pokrene kao administrator.

---

## Korak 3 - Proba

1. U panelu **Igrači > Novi nalog** (npr. `proba` / lozinka, kredit 300).
2. Na PC-01 se prijavi tim nalogom - kartica u panelu postaje **Online** i kreće odbrojavanje (300 din = 2h 30min pri 120/h).
3. Pokreni neku igru > proveri da se **desktop nigde ne vidi**.
4. Poruči nešto iz Shopa > stiže u **Porudžbine**.
5. Zaključaj računar iz panela > otključaj sa `Ctrl+Alt+U` i PIN-om.

Ako sve ovo prođe, isti postupak ponovi na ostalim računarima (svaki ima **svoj** token).

---

## Prečice za osoblje (na računaru igrača)

| Prečica | Šta radi |
|---|---|
| `Ctrl + Alt + U` | Otključaj računar (traži PIN) |
| `Ctrl + Alt + Home` | Vrati launcher u prvi plan |
| `Ctrl + Alt + Shift + Q` | Izlaz iz launchera (traži PIN) |
| `Ctrl + Alt + Shift + R` | Promena adrese servera, samo kad nema veze (traži **servisni** PIN) |

## Svakodnevni rad

- **Početak smene:** upali server (sam se diže) > radnik se prijavi na panel > unese početno stanje kase.
- **Tokom rada:** dopune kredita i porudžbine idu kroz panel; sa telefona isto, preko mrežne adrese.
- **Kraj smene:** *Zatvori smenu* (dobiješ obračun) > **Ugasi sve (kraj smene)** na kontrolnoj tabli.

## Ponovno podešavanje launchera

Adresa servera i token ostaju sačuvani i posle deinstalacije, pa reinstalacija sama
po sebi ne pomaže. Ako treba da ih promeniš ili si pogrešio pri unosu:

**Iz samog launchera (najlakše)** - kad server ne odgovara, posle par sekundi se na ekranu
pojavi dugme **"Promeni adresu servera"**. Isto radi i prečica `Ctrl + Alt + Shift + R`
(radi samo kad nema veze sa serverom). Oba traže **servisni PIN**.

**Skriptom** - `resetuj-launcher.bat` iz paketa (`2 - LAUNCHER\ALATI OSOBLJA`), desni klik >
*Run as administrator*, dok je nalog igrača prijavljen (ili `resetuj-launcher.bat IME-NALOGA`).
Briše podešavanje na nalogu igrača i vraća launcher na prvo pokretanje.

**Ručno** - sa administratorskog naloga zatvori launcher, pa obriši folder
`C:\Users\<nalog igrača>\AppData\Roaming\crit-launcher`.

## Ako nešto zapne

- **Launcher piše "Nema veze sa serverom"** - proveri da je server prozor otvoren i da je adresa tačna.
- **Launcher je izašao preko igre: "Računar je zaključan dok se veza ne vrati"** - launcher
  15 sekundi nije čuo server. Vreme se tada ne naplaćuje. Čim se veza vrati, otključava se
  sam i sesija se nastavlja. Vidi [Nadzor veze](#nadzor-veze-heartbeat).
- **Računar je zaključan, a launcher ne može ni da se pokrene** - sa administratorskog
  naloga pokreni `POPRAVI-RACUNAR.bat` iz `ALATI OSOBLJA` (skida svu zaštitu sa svih naloga).
- **Računar se ne pali na daljinu** - Wake-on-LAN traži podešavanje u BIOS-u, vidi DEPLOY.md, sekcija 8.
- **Vraćanje starih podataka** - kopije baze su u `server/data/backups/`, uputstvo u DEPLOY.md, sekcija 5.

---

## Bezbednost kioska

Launcher je jedini program koji igrač vidi. Ovaj deo opisuje ko šta sme na računaru
igrača, šta launcher sam brani i šta treba podesiti da bi to držalo.

### Dozvole: ko šta sme

| Ko | Kao koji nalog | Sme | Ne sme |
|---|---|---|---|
| **Igrač** | standardni Windows nalog (korak 2.2) | igre i sajtove iz kataloga, dok traje sesija | Task Manager, komandna linija, PowerShell, Registry, Control Panel i Podešavanja, Win taster, Win+R, odjava i gašenje iz Start menija, deinstalacija launchera |
| **Launcher** | nalog igrača (ništa više od igrača) | sopstveni prozor, pokretanje igara iz kataloga, gašenje onoga što je igrač pokrenuo, svoja podešavanja u profilu igrača | da piše politike na standardnom nalogu (to radi `zastita-ukljuci.bat`) |
| **Osoblje u launcheru** | PIN osoblja (panel) ili servisni PIN | otključavanje (`Ctrl+Alt+U`), admin izlaz (`Ctrl+Alt+Shift+Q`), promena adrese servera bez veze (`Ctrl+Alt+Shift+R`) | ništa bez PIN-a: izlaz odobrava glavni proces launchera tek kad PIN potvrdi server ili lokalna provera |
| **Alati osoblja** (`.bat`) | administrator (*Run as administrator*) | zaštita naloga igrača, popravka, reset, deinstalacija | ne rade bez administratora; ne stoje na računaru igrača |
| **Server / panel** | vlasnik i radnici (prijava na panel) | katalog, PIN-ovi, zaključavanje, daljinske komande | |

### Alati osoblja

Svi su u paketu, u folderu `2 - LAUNCHER\ALATI OSOBLJA`, zajedno sa `zastita.ps1` koji
radi sav posao (fajlovi moraju da ostanu zajedno). Svaki traži administratora i na
početku pita koji je nalog igrača.

Kad standardni nalog pokrene skriptu *kao administrator*, skripta radi pod
**administratorom**: `HKCU` i `%APPDATA%` su tada njegovi, ne igračevi. Zato alati rade nad
nalogom igrača po SID-u (`HKEY_USERS\<SID>`) i nad njegovim profilom (`C:\Users\<igrač>`).

| Skripta | Kad | Nad kim radi |
|---|---|---|
| `zastita-ukljuci.bat` | jednom po računaru, korak 2.5 | nalog prijavljen na ekranu, ili `zastita-ukljuci.bat IME-NALOGA` (može i odjavljen) |
| `zastita-iskljuci.bat` | servis računara | isto; kad je nalog igrača zaključan, pokreni je sa administratorskog naloga uz ime naloga |
| `resetuj-launcher.bat` | nova adresa servera ili token | podešavanje launchera na nalogu igrača (pita za potvrdu) |
| `POPRAVI-RACUNAR.bat` | računar zaključan, launcher ne radi | **svi** nalozi, i prijavljeni i odjavljeni; gasi launcher i vadi ga iz autostarta (pita za potvrdu) |
| `DEINSTALIRAJ-LAUNCHER.bat` | uklanjanje launchera | instalacija i prečice na nalogu igrača (pita za potvrdu) |

`POPRAVI-RACUNAR.bat` više ne pokreće Explorer ponovo. Explorer pokrenut iz prozora
administratora može da ostane sa pravima administratora na ekranu igrača. Posle
popravke se odjavi i prijavi ponovo.

**Šta `zastita-ukljuci.bat` upisuje** na nalog igrača:

| Podešavanje | Šta gasi |
|---|---|
| `DisableTaskMgr`, `DisableRegistryTools`, `DisableLockWorkstation`, `DisableChangePassword` | Task Manager, Registry, zaključavanje, promenu lozinke |
| `NoWinKeys`, `NoRun`, `NoClose`, `NoLogoff` | Win taster, Win+R, gašenje i odjavu iz Start menija |
| `NoControlPanel` | Control Panel i Podešavanja (odatle bi se launcher deinstalirao bez administratora) |
| `DisableCMD = 2` | komandnu liniju; `.bat` skripte i dalje rade jer ih launcher koristi za nadogradnju |
| `DisallowRun` | pokretanje iz Explorer-a i prozora za izbor fajla u igri: `cmd`, `powershell`, `pwsh`, `wscript`, `cscript`, `mshta`, `regedit`, `mmc`, `msconfig`, `taskmgr`, `control`, `Uninstall Crit Launcher.exe` |
| `DontShowUI` (Windows Error Reporting) | prozor "program je prestao da radi" posle pada igre |

Launcher svoje alate i igre pokreće sam, mimo Explorer-a, pa ga `DisallowRun` ne dira.
Igre upisane kao `.bat` launcher pokreće kroz komandni interpreter, ne kroz Windows
"otvori", pa i one rade.

### Šta launcher sam brani

- **Razvojni alati** su isključeni u svim prozorima (ekran, zastor, obaveštenje). Ako se
  ipak otvore, odmah se zatvaraju. Podrazumevani Electron meni je uklonjen, a sa njim i
  njegove prečice za osvežavanje, razvojne alate i zum.
- **Tastatura u prozoru launchera:** blokirani su F5, F11, F12, `Ctrl+R`, `Ctrl+Shift+I/J/C`,
  `Ctrl+P/O/S/U/W/Q/N/T`, zum (`Ctrl +/-/0`), `Alt+F4`, `Alt+Space` i tasteri "nazad/napred".
  Kucanje i `Ctrl+A/C/V/X/Z/Y` u poljima rade. Sistemske prečice (`Win+...`,
  `Ctrl+Shift+Esc`, `Ctrl+Esc`) launcher "guta" dok radi. Pravila su u `client/kiosk.js`.
- **Navigacija:** prozor prikazuje samo svoje strane. Nov prozor, webview, prevučen link i
  preusmerenje se odbijaju. Sajtovi se otvaraju samo kao prava `http`/`https` adresa
  (`file:`, `ms-settings:`, mrežne putanje se odbijaju). Igre i sajtovi se otvaraju samo
  dok traje sesija.
- **Komandna linija:** instaliran launcher ne sluša `--dev` ni `--no-lock`. Ako je pokrenut
  sa `--remote-debugging-port`, `--inspect`, `--proxy-server`, `--disable-web-security` i
  sličnim (prečica u autostartu je u folderu igrača), sam se pokreće ponovo bez njih i
  javlja to u panel. U samom programu su ugašeni `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`
  i `--inspect`, a aplikacija se učitava samo iz `app.asar` (Electron fuses,
  `client/fuses.js`).
- **`bez-zakljucavanja.txt`** (proba na jednom računaru) važi samo ako ga je napravio
  administrator. Fajl koji napravi sam nalog igrača launcher zanemaruje i javlja u panel.
- **PIN:** kad je servisni PIN upisan u panelu, važi **samo on**. PIN iz `podesavanja.json`
  tada prestaje da važi, jer je taj fajl u folderu koji igrač može da menja. Posle 5
  pogrešnih PIN-ova zaredom launcher čeka 30 s, pa svaki sledeći promašaj duplo (najviše 15 min).
- **Druga kopija launchera** odmah izlazi i ne dira zaštitu prve.

### Pad igre

Kad se igra koju je launcher pokrenuo sruši (Windows kod greške, npr. `0xC0000005`),
launcher:

1. gasi prozor "program je prestao da radi" (a zaštita ga i ne prikazuje),
2. vraća se ispred zastora sa porukom igraču, ako ne radi neka druga igra,
3. javlja osoblju u panel (`igra_pala`, ime igre i kod greške).

Običan izlaz igre ili pokretača (Steam, Riot izlaze sa 0 ili 1 a igra nastavlja pod
drugim imenom) **nije** pad. Tada o povratku odlučuje zastor, kao i ranije.

### Nadzor veze (heartbeat)

Ugovor između servera i launchera je **15 sekundi**:

- server pinguje svaki računar na 5 s i gasi vezu sa koje 15 s nije stiglo ništa
  (naplata tada staje);
- launcher i sam pinguje server na 5 s. Ako 15 s ne čuje server (ni ping, ni poruku),
  prekida vezu i **zaključava računar**: izlazi ispred igre i drži ceo ekran. Igrač vidi
  da mu se vreme ne troši.
- posle `gasiIgreBezVezeSekundi` (podrazumevano **120 s**) bez veze gase se i igre i
  pregledači koji rade iza zaključanog ekrana, da računar ne radi nenaplaćeno;
- čim se server javi, zaključavanje se skida samo od sebe i sesija se nastavlja (token
  sesije). Ako je server u međuvremenu završio sesiju, launcher ostaje na prijavi.

Kratak prekid (restart servera, zagrcnuta mreža kraća od 15 s) ne zaključava ništa. Ako
server stoji duže od 15 s zbog sopstvenog zastoja, ne gasi veze računara.

### Podešavanja (`podesavanja.json`, podfolder `resources` u instalaciji)

| Polje | Podrazumevano | Značenje |
|---|---|---|
| `gasiIgreBezVezeSekundi` | `120` | posle koliko sekundi bez veze se gase igre iza zaključanog ekrana; `0` = nikad |
| `servisniPin` | `1234` | važi samo dok servisni PIN nije upisan u panelu; obavezno ga upiši u panelu |
| `blokirajPreuzeteProgram` | `true` | gasi programe pokrenute iz Preuzimanja, Temp i sa radne površine |

### Šta launcher javlja u panel (Logovi, "klijent_problem")

| Vrsta | Značenje |
|---|---|
| `zastita_nepotpuna` | na ovom nalogu fali deo zaštite ili je nalog igrača administrator: pokreni `zastita-ukljuci.bat` |
| `argumenti_odbijeni` | launcher je pokrenut sa zabranjenim argumentima: proveri prečicu u autostartu |
| `zastava_odbijena` | igrač je napravio `bez-zakljucavanja.txt` |
| `pin_pogadjanje` | 5 ili više pogrešnih servisnih PIN-ova zaredom |
| `izlaz_odbijen` | admin izlaz bez potvrđenog PIN-a |
| `navigacija_odbijena`, `adresa_odbijena` | pokušaj da se u launcheru otvori tuđa strana ili adresa |
| `igra_pala` | igra se srušila |
| `greska_launchera`, `proces_pukao` | greška u samom launcheru (ako se ponavlja na istoj mašini, kvar je na njoj) |

### Šta ostaje (zna se, nije rešeno ovde)

- Launcher je instaliran **u profil igrača** (bez toga ne bi mogao sam da se nadogradi
  sa panela). Igrač koji dođe do prozora za izbor fajla može da briše i menja fajlove
  instalacije. Zaštita (`DisallowRun`, `NoControlPanel`, bez komandne linije) mu oduzima
  alate za to, ali ga ne sprečava potpuno. Najjača zaštita je Windows **Assigned Access**
  ili **Shell Launcher**, van ovog programa.
- `DisallowRun` gleda **ime** programa. Preimenovan `cmd.exe` prolazi, ali igrač bez
  komandne linije i bez Explorer-ovog "Run" teško dolazi do kopiranja i preimenovanja.
- Provera integriteta `app.asar` (fuse `EnableEmbeddedAsarIntegrityValidation`) nije
  uključena. Uključiti je tek posle probe na jednom računaru sa pravim instalerom i
  jednom nadogradnjom: greška u njoj znači launcher koji se ne pokreće nigde.
- Gašenje programa iz Preuzimanja i sa radne površine je "najbolje što može", ne garancija.

### Provera posle podešavanja (na nalogu igrača)

1. `Ctrl+Shift+Esc`, `Win+R`, `Win+E`: ništa se ne otvara.
2. U launcheru `F12`, `Ctrl+Shift+I`, `Ctrl+R`, `Ctrl +`: ništa se ne dešava.
3. Prijavi igrača, pokreni igru, izvuci mrežni kabl: posle oko 15 s launcher izlazi
   ispred igre sa porukom da je računar zaključan. Vrati kabl: otključava se sam.
4. U panelu, Logovi: nema zapisa `zastita_nepotpuna` za ovaj računar.
