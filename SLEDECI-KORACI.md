# Šta ostaje tebi

Sve što se moglo uraditi sa razvojnog računara je urađeno i provereno. Provera
se pušta ovde, traje oko dva minuta i sama ispiše koliko ih je prošlo:

```
node testovi/pokreni-sve.mjs
```

Ovde je ostalo ono što traži tvoj nalog, tvoju mrežu ili tvoje ruke. Redosled
nije proizvoljan - svaki korak se oslanja na prethodni.

Paket za USB je već napravljen: **`Desktop\CRIT-ZA-IGRAONICU`** (105 MB,
instaler `Crit Launcher Setup 2.57.0.exe`).

---

## 1. Odmah - 10 minuta, sa ovog laptopa

### 1.1 Kopija koda van računara

28 commita i cela istorija programa postoje **samo na ovom disku**. Ako disk
otkaže večeras, igraonica nastavi da radi (server je na drugoj mašini), ali se
program više ne može ni ispraviti ni nadograditi.

Priključi USB pa:

```
node alati/kopija-koda.mjs D:\kopije
```

Jedan fajl, sve grane i svi commitovi. Vraćanje na bilo kom računaru sa git-om:
`git clone "D:\kopije\crit-kod-2.57.0-....bundle" crit`

> Odredište koje ne postoji alat **odbija**. Namerno: folder napravljen na
> lokalnom disku izgledao bi kao uspela kopija, a bio bi na istom disku od kog
> čuva.

### 1.2 Privatni repozitorijum

1. Na github.com → **New repository**
   - ime: `crit`
   - **Private**
   - **ne** čekiraj README, .gitignore ni licencu

   > Repo mora da bude **potpuno prazan**. Ako dodaš i jedan fajl, prvi push
   > bude odbijen i moraš da ga rešavaš.

2. Ovde, zameni `<korisnik>` svojim imenom naloga:

```
git remote add origin https://github.com/<korisnik>/crit.git
git push -u origin master
```

Git na ovoj mašini koristi credential manager - otvoriće ti se prozor za prijavu
na GitHub, nema tokena za prekucavanje.

Posle push-a CI se pokreće sam i pušta ceo isti skup provera. Provereno na
pravom klonu da je zelen.

---

## 2. Pre nego što kreneš u obilazak

### 2.1 Fabrička lozinka vlasnika

Panel to javlja crveno na kontrolnoj tabli. Dok stoji `admin` / `admin`, panel se
otvara sa svakog telefona na mreži, a preko njega se upisuje kredit.

**Podešavanja → promeni lozinku.**

### 2.2 Servisni PIN

Fabrički je `1234`. Taj PIN čuva ulaz u podešavanja launchera i izlaz iz kioska
kad server ne radi - dok je fabrički, igrač koji iščupa mrežni kabl može da
preusmeri mašinu na svoj server.

**Podešavanja → Servisni PIN launchera.** Upisuje se **jednom** i odmah važi na
svim mašinama.

### 2.3 Kopija baze van računara

**Podešavanja → Kopija van računara** → USB ili mrežni folder. Baza i sve
rezervne kopije inače stoje na istom disku; kad taj disk otkaže, nestaje i jedno
i drugo.

Na odredište odlaze **dve stvari**: `crit-....db` (baza) i folder `slike\`
(omoti, slike pića, pozadine, baneri). Slike se prepisuju samo kad se promene,
pa USB ne prima iste megabajte svaki dan.

> **Ako ikad budeš vraćao sa nule** (nov disk, nov računar): prekopiraj `.db` u
> `server\data\crit.db`, a **ceo sadržaj `slike\` u `server\data\uploads\`**. Bez
> tog drugog koraka baza se otvori uredno, ali svaki omot i svaka pozadina budu
> prazni - u bazi stoje putanje do fajlova kojih više nema.

### 2.4 Ruter: gosti odvojeno od osoblja

Lozinke i token panela putuju mrežom **u čistom tekstu** (HTTPS još nije urađen).
Ko je na istoj mreži i ume da sluša saobraćaj, uhvati tvoju lozinku i onda sam
sebi upisuje kredit.

Na većini rutera je to jedan kvadratić: **Guest network** / **izolacija gostiju**.
Ako to nije moguće - panel otvaraj samo sa glavnog računara ili sa telefona na
kablu, nikad sa mreže koju koriste gosti.

---

## 3. Server (glavni računar) - pre mašina

Ova verzija donosi **nadzornika**: server se od nje diže sam posle pada, zastoja,
nestanka struje i gašenja silom, i nadograđuje se sa panela. Zato se **ona**
postavlja rukom - poslednji put.

1. Zatvori prozor servera.
2. Napravi kopiju celog `server\data\` foldera sa strane.
3. Iz paketa (`1 - SERVER (glavni racunar)`) prepiši sve u folder servera
   **osim `data\`**. Stari `start-server.bat` obriši ako postoji.
4. Dvoklik na **`Podesi autostart.bat`** (sam traži administratora). Napravi
   zadatke, digne server i sačeka da se javi - ako ne uspe, vrati sve kako je
   bilo i kaže zašto. Ako za proveru na 5 minuta ispiše **[PAZNJA]**, zapiši
   tačan tekst.
5. Panel → Podešavanja → mora da piše **2.57.0**.
6. **Proba koja se sa laptopa ne može pustiti** - zakazani zadatak menja Windows,
   pa se isprobava tek ovde:
   - Restartuj glavni računar i **ne prijavljuj se** na Windows. Sa telefona
     otvori panel - mora da radi.
   - PowerShell kao administrator, u folderu servera - ubij sam server:
     `Stop-Process -Id (Get-Content data\nadzor.json | ConvertFrom-Json).dete -Force`
     Panel mora da se vrati za nekoliko sekundi, a u **Logovi > Sistem** da piše
     da je server pao i ponovo pokrenut.
   - Isto, ali ubij nadzornika:
     `Stop-Process -Id (Get-Content data\nadzor.json | ConvertFrom-Json).pid -Force`
     Server nestaje sa njim. Za **najviše 5 minuta** mora da se vrati sam, a u
     `data\nadzor.log` da piše da je prethodni nadzornik nestao bez gašenja.
7. U BIOS-u glavnog računara *Restore on AC Power Loss* → **Power On**, a u
   Windows Update-u *Active hours* na radno vreme (DEPLOY.md §7.2).

> Od ove verzije otpremljene slike stoje uz bazu, u `server\data\uploads\`. Ako
> su na tvom serveru još u `server\public\uploads\`, server ih **prenese sam** pri
> prvom pokretanju i to ispiše u svom prozoru. Staro mesto ostaje netaknuto, pa
> se ništa ne gubi ako nešto pođe naopako.
>
> Zašto: dok su bile unutar programa, nisu ulazile ni u jednu rezervnu kopiju -
> vraćena baza je pokazivala na fajlove kojih nema.

---

## 4. Poslednji ručni obilazak - 13 mašina

Ovo je **poslednji put** da obilaziš mašine. Od sledeće verzije nadogradnja ide
sa panela i računari je preuzimaju sami.

Instalacija se promenila: ranije je išla u `Program Files` i tražila
administratora, sada ide u profil igrača i ne traži ga. Zato stara mora da se
skine, a nova da se instalira **sa naloga igrača**.

**Na svakoj mašini, ovim redom:**

1. **Administratorski nalog** → `Settings → Apps` → nađi *Crit Launcher* →
   **Uninstall**.

   > Koristi Windows deinstalaciju, **ne** `DEINSTALIRAJ-LAUNCHER.bat`. Windows
   > deinstalacija ostavlja podešavanja (adresu servera i token), pa ih ne moraš
   > ponovo kucati. `.bat` briše i njih - on je za slučaj kad hoćeš čisto.

2. **Odjavi se i prijavi na nalog igrača.** Nova instalacija ide u profil naloga
   sa kog je pokrenuta. Ako je pokreneš sa administratorskog, launchera na nalogu
   igrača **neće biti**.

3. Pokreni `Crit Launcher Setup 2.57.0.exe`. Ne traži administratora.

4. **Prepravi prečicu za automatsko pokretanje.** Stara pokazuje na
   `Program Files` - te putanje više nema.

   `Win + R` → `shell:startup` → obriši staru `Crit...` prečicu → prevuci tu novu
   prečicu sa radne površine.

   > Ovaj korak se najlakše preskoči, a posledica je najgora: računar se upali
   > **bez launchera**, sa otvorenim Windowsom i bez naplate.

5. Restartuj računar i sačekaj da se launcher digne sam.

6. U panelu, strana **Računari**, kolona *verzija* mora da pokaže **2.57.0**.

**Ako mašina još nije zaključana** (`zastita-ukljuci.bat` nikad pokrenut):
desni klik → *Run as administrator*, pa odjava i ponovna prijava.

**Windows Update:** `Settings → Windows Update → Advanced options → Active hours`
→ upiši radno vreme igraonice. Restart nasred turnira je najskuplji kvar ovde.

### 4.1 Igre podesi na „bez ivica", ne na pun ekran

U podešavanjima svake igre, gde postoji izbor: **Borderless / Windowed
Fullscreen**, a ne *Exclusive Fullscreen*.

Razlog nije ukus. Kad igra drži **ekskluzivan** pun ekran, Windows preuzima ceo
prikaz i **nijedan tuđi prozor preko nje nije zagarantovan** — ni naše
obaveštenje da vreme ističe, ni poruka koju osoblje pošalje. Uz to, svako
iskakanje prozora tada izbaci igru iz punog ekrana i ekran promeni rezoluciju.

Program je sa svoje strane sređen: obaveštenje se pozicionira po trenutnoj
rezoluciji, launcher više ne upada preko žive igre, a **upozorenje o vremenu ide
i zvukom** — zvuk se čuje bez obzira na to koji je prozor napred. Ali slika se
preko ekskluzivnog punog ekrana ne može obećati, i bolje je da to znaš unapred
nego da se pitaš zašto gost tvrdi da nije video upozorenje.

> Ako se neka igra baš tuca na „bez ivica" (retko, kod starijih naslova),
> ostavi joj pun ekran — gost će upozorenje čuti, a računar se i dalje zaključava
> uredno.

---

## 5. Kako izgleda svaka sledeća nadogradnja

Bez ustajanja od kase:

1. Ovde: `node verzija.mjs <nova>` → `cd client && npm run build` → `node napravi-paket.mjs`
2. Panel → **Instalacije** → **Nadogradnja servera** → *Postavi paket* → fajl
   `.srvpak` iz `3 - NADOGRADNJA SA PANELA` → *Nadogradi*. Server se vrati za
   dvadesetak sekundi; ako nova verzija ne proradi, sam vrati prethodnu.
3. Panel → **Instalacije** → *Postavi instalater* → izaberi `.exe` iz `dist\`
4. *Pusti verziju u rad*

Računari je preuzimaju sami čim se oslobode. **Mašina na kojoj neko igra se ne
dira** - dolazi na red kad gost ustane. Ako nešto ne prođe, u panelu piše zašto,
a launcher se u svakom slučaju vraća.

### 5.1 Pre nego što USB krene - pusti ovo

Kad praviš nov paket (`node napravi-paket.mjs`), proveri ga pre puta:

```
node alati/proveri-paket.mjs
```

Diže server **iz same kutije** i radi ono što igraonica radi prvog dana: otvara
panel, traži katalog i povlači svaku sliku koju baza pominje. Traje dvadesetak
sekundi.

> Zašto: jednom je paket otišao sa bazom bez poslednjih izmena - SQLite ih je
> držao u svom radnom fajlu, a kopiranje je uzelo samo bazu. Čišćenje je odmah
> zatim obrisalo i omote igara kojih u toj bazi nema. Sve je izgledalo uredno
> dok se ne stigne na lice mesta.

---

## 6. Kad zatreba - nije sada

- **Sertifikat za potpisivanje koda.** Bez njega Windows na svakoj tuđoj mašini
  upozorava na tvoj instaler. Kad ga nabaviš, launcher se vraća u `Program Files`
  uz zakazani zadatak koji instalira umesto igrača (PLAN.md).
- **HTTPS.** Dok ga nema, važi 2.4.
- **Rezervacije računara.** Jedina veća funkcija iz plana koja nije urađena;
  radi se kad se ukaže potreba.
- **Nova prijava dok server ne radi.** Igrači koji već igraju igraju dalje, ali
  novi gost ne može da sedne dok se server ne vrati. Sledeće na redu: osoblje
  servisnim PIN-om pušta sesiju za keš (PLAN.md).
- **Druga igraonica.** Pre gradnje instalera: `node igraonica.mjs "Ime"`.
