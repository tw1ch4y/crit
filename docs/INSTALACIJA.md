# Instalacija u igraonici

Postupak za prvo postavljanje: mreža, glavni računar sa serverom i računari
igrača. Svakodnevni rad, kopije i nadogradnje su u [ODRZAVANJE.md](ODRZAVANJE.md),
a spisak za proveru pred otvaranje u [PROVERA.md](PROVERA.md).

Paket za USB (`CRIT-ZA-IGRAONICU`, pravi ga `napravi-paket.mjs`) ima tri foldera:

| Folder | Namena |
|---|---|
| `0 - PROBA NA JEDNOM RACUNARU` | server i launcher na istom računaru, bez zaštite kioska |
| `1 - SERVER (glavni racunar)` | server, panel i alati za glavni računar |
| `2 - LAUNCHER (racunari igraca)` | instaler launchera i spisak tokena (`TOKENI.txt`) |
| `3 - NADOGRADNJA SA PANELA` | paket servera (`.srvpak`) za nadogradnju iz panela |

---

## 1. Mreža

- Glavni računar dobija **stalnu IP adresu** (DHCP rezervacija u ruteru).
  Launcheri je pamte pri prvom podešavanju.
- Računari igrača su na **kablu**. Paljenje preko mreže (Wake-on-LAN) preko
  WiFi-ja ne radi pouzdano.
- **Gosti na posebnoj mreži.** Panel i launcheri komuniciraju preko HTTP-a, bez
  šifrovanja. Ko je na istoj mreži i prisluškuje saobraćaj, može da uhvati
  lozinku osoblja. Na većini rutera to je opcija *Guest network* / *izolacija
  gostiju*. Ako nije moguća, panel se otvara samo sa glavnog računara ili sa
  uređaja na kablu.

## 2. Glavni računar (server)

### 2.1 Priprema

1. Instalirati **Node.js LTS** sa [nodejs.org](https://nodejs.org).
2. Folder `1 - SERVER (glavni racunar)` kopirati u **`C:\Crit\server`**.
   Ne na radnu površinu i ne u Dokumente: te foldere često sinhronizuje
   OneDrive, a sinhronizacija ume da zaključa bazu.
3. Pokrenuti **`Pokreni server.bat`**. Prvi put instalira zavisnosti (oko
   minut), zatim ispisuje adrese panela. Proveriti da adresa mreže odgovara
   stalnoj IP adresi iz koraka 1. Prozor zatvoriti.
4. **`Otvori port u firewall-u.bat`** (desni klik > *Run as administrator*).
   Otvara TCP port 8095 za sve mrežne profile.

### 2.2 Autostart

**`Podesi autostart.bat`** (sam traži administratora) pravi dva zakazana
zadatka:

- **pokretanje** - nadzornik servera se diže pri paljenju računara, pre
  prijave na Windows, kao SYSTEM i bez prozora;
- **provera na 5 minuta** - diže nadzornika ako je ugašen silom.

Nadzornik (`nadzornik.mjs`) drži server u radu:

| Događaj | Ponašanje |
|---|---|
| server padne | ponovo ga diže posle 1, 2, 5, 10, 30 pa 60 s; posle 10 minuta mirnog rada broji ispočetka |
| server ne odgovara | posle tri propuštene provere zaredom (oko minut i po) gasi ga i diže |
| port je zauzet | ne diže ga u krug, proba ponovo na 30 s |
| pokrenut drugi nadzornik | drugi odmah izlazi |
| nadzornik ugašen silom | server se gasi sa njim; provera ih diže za najviše 5 minuta |
| restart ili nestanak struje | zakazani zadatak diže server pri paljenju |

Skripta posle pravljenja zadataka čeka da se server javi. Ako se ne javi za
30 sekundi, uklanja zadatke i ispisuje poslednje redove iz
`data\nadzor.log`. Uklanjanje: `Ukloni autostart.bat`.

Namerno gašenje servera (zamena diska i sl.): prazan fajl
**`data\nadzor-stani`**. Ponovno pokretanje bez restarta: prazan fajl
**`data\nadzor-pokreni`** - provera ga diže za najviše 5 minuta.

### 2.3 Panel

1. `http://localhost:8095`, prijava **admin / admin**.
2. *Podešavanja*:
   - promeniti lozinku (dok je fabrička, tabla stoji crveno);
   - **Servisni PIN launchera** - važi odmah na svim računarima, fabrički
     `1234` tada prestaje da važi;
   - **Kopija van računara** - USB, drugi disk ili mrežni folder;
   - cena po satu, naziv igraonice, valuta.
3. *Računari* - po jedan unos za svaki računar igrača. Svaki ima svoj token
   (spisak je i u `TOKENI.txt` u paketu).

### 2.4 Windows na glavnom računaru

- **BIOS:** *Restore on AC Power Loss* (negde *After Power Failure*) na
  **Power On** - računar se pali sam kad se struja vrati.
- **Napajanje:** *Sleep: Never*. Računar koji spava ne pušta ni server.
- **Windows Update:** *Advanced options > Active hours* na radno vreme.
- **UPS** na glavni računar, ruter i switch.
- Glavni računar služi samo kao server, ne i kao igračka stanica.

## 3. Računari igrača

### 3.1 Windows nalog

Na svakom računaru poseban nalog za igrače, **standardni** (ne administrator).
Launcher se instalira i radi na tom nalogu.

### 3.2 Launcher

1. Prijaviti se **na nalog igrača**.
2. Pokrenuti `Crit Launcher Setup vX.Y.Z.exe`. Instalacija ide u profil
   naloga (`%LOCALAPPDATA%\Programs\Crit Launcher`) i ne traži administratora.
   Zato launcher kasnije može sam da se nadogradi sa panela.
3. Pri prvom pokretanju adresa servera je već popunjena iz
   `resources\podesavanja.json`. Upisati **token** tog računara.
4. U panelu računar prelazi iz *Offline* u *Standby*.

Launcher se pri svakom pokretanju sam upisuje u automatsko pokretanje naloga
(`HKCU\...\Run`), pa ručna prečica u *Startup* folderu nije potrebna.

### 3.3 Zaštita kioska

Dvoklik na **`zastita-ukljuci.bat`** (u instalaciji, podfolder `resources`),
prijavljen **kao igrač**. Ne pokretati sa *Run as administrator*: sa
standardnog naloga to pokreće skriptu pod administratorskim nalogom i
ograničenja bi otišla njemu. Deo koji važi za ceo računar skripta sama traži
od administratora.

**Nalog igrača:**

| Ograničenje | Posledica |
|---|---|
| `DisableTaskMgr`, `DisableLockWorkstation`, `DisableChangePassword` | Task Manager i opcije na Ctrl+Alt+Del ekranu |
| `NoWinKeys`, `NoRun` | Windows taster i Win+R |
| `NoClose`, `NoLogoff` | gašenje i odjava iz Start menija |
| `NoControlPanel` | Podešavanja i Kontrolna tabla, pa ni deinstalacija launchera |
| prečice pristupačnosti | pet puta Shift, dugo držanje desnog Shift-a i Num Lock ne otvaraju prozor sa vezom ka Podešavanjima |

Launcher ista ograničenja upisuje i sam pri svakom pokretanju, a vraća ih pri
izlazu sa PIN-om.

**Ceo računar (administrator):**

| Podešavanje | Posledica |
|---|---|
| Chrome i Edge: `AllowFileSelectionDialogs = 0` | nema dijaloga za čuvanje i otvaranje fajla; iz njega bi se pokretao bilo koji program |
| Chrome i Edge: `URLBlocklist file://*` | pregledač ne otvara lokalne fajlove |
| Chrome i Edge: `PasswordManagerEnabled = 0` | pregledač ne nudi čuvanje lozinki |
| ekrani dobrodošlice isključeni | profil pregledača se briše posle svakog igrača |
| hibernacija isključena | Fast Startup ne ometa paljenje preko mreže |

Posle skripte: odjava i ponovna prijava. Servis računara:
`zastita-iskljuci.bat` na isti način (prethodno izaći iz launchera sa
`Ctrl+Alt+Shift+Q`).

### 3.4 Wake-on-LAN

1. **BIOS:** *Wake on LAN* (ili *Power On By PCI-E*, *Resume by LAN*)
   uključeno; *ErP* isključeno.
2. **Device Manager > Network adapters > kartica > Properties:**
   - *Power Management*: *Allow this device to wake the computer* i *Only
     allow a magic packet to wake the computer*;
   - *Advanced*: *Wake on Magic Packet* = Enabled.
3. Fast Startup je isključen skriptom iz 3.3.

MAC adresu server pamti sam kad se launcher prvi put poveže. Dugme *Upali*
radi samo unutar iste lokalne mreže i ne budi računar koji je bez struje.

### 3.5 Igre i Windows Update

- Igre podesiti na **Borderless / Windowed Fullscreen**, ne *Exclusive
  Fullscreen*. Preko ekskluzivnog punog ekrana Windows ne garantuje prikaz
  drugog prozora, pa se upozorenje o isteku vremena tada samo čuje.
- *Windows Update > Active hours* na radno vreme igraonice.

## 4. Proba

1. *Igrači > Novi nalog*, kredit 300.
2. Prijava na računaru igrača: kartica u panelu postaje *Online* i kreće
   odbrojavanje.
3. Pokrenuti igru: radna površina se ne vidi ni u jednom trenutku.
4. Porudžbina iz launchera stiže u *Porudžbine* uz zvučni signal.
5. Zaključavanje iz panela, otključavanje sa `Ctrl+Alt+U` i PIN-om.

Isto se ponavlja na ostalim računarima, svaki sa svojim tokenom.

## 5. Prečice za osoblje

| Prečica | Namena |
|---|---|
| `Ctrl+Alt+U` | otključavanje računara (PIN) |
| `Ctrl+Alt+Home` | launcher u prvi plan |
| `Ctrl+Alt+Shift+Q` | izlaz iz launchera (PIN; bez servera servisni PIN) |
| `Ctrl+Alt+Shift+R` | nova adresa servera i token (samo bez veze sa serverom, servisni PIN) |

## 6. Granice zaštite

- **Ctrl+Alt+Del** se ne može presresti. Na tom ekranu ostaje samo dugme za
  gašenje; launcher se posle paljenja vraća sam.
- Programi sa sopstvenim pregledačem ili dijalogom za fajlove (Steam
  ugrađeni pregledač, *Add a Non-Steam Game*) nisu pod politikama Chrome-a i
  Edge-a.
- Najjača varijanta je launcher kao Windows *shell* naloga igrača
  (`Winlogon\Shell`) ili AppLocker sa spiskom dozvoljenih programa. Oba traže
  probu na jednom računaru pre primene na sve.
