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

**2.3** Prekopiraj `Crit Launcher Setup.exe` i pokreni instalaciju.

**2.4** Pokreni **Crit Launcher**. Adresa servera je već popunjena
(`http://192.168.1.100:8095`) - unesi samo **token** iz koraka 2.1 i klikni *Sačuvaj i poveži*.

Kad se poveže, u panelu će `PC-01` preći iz *Offline* u *Standby*.

**2.5** Uključi zaštitu: u folderu gde je instaliran launcher, u podfolderu `resources`,
desni klik na **`zastita-ukljuci.bat`** > *Run as administrator*. Zatim se odjavi i prijavi ponovo.

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

## Svakodnevni rad

- **Početak smene:** upali server (sam se diže) > radnik se prijavi na panel > unese početno stanje kase.
- **Tokom rada:** dopune kredita i porudžbine idu kroz panel; sa telefona isto, preko mrežne adrese.
- **Kraj smene:** *Zatvori smenu* (dobiješ obračun) > **Ugasi sve (kraj smene)** na kontrolnoj tabli.

## Ponovno podešavanje launchera

Adresa servera i token ostaju sačuvani i posle deinstalacije, pa reinstalacija sama
po sebi ne pomaže. Ako treba da ih promeniš ili si pogrešio pri unosu:

**Iz samog launchera (najlakše)** - kad server ne odgovara, posle par sekundi se na ekranu
pojavi dugme **"Promeni adresu servera"**. Isto radi i prečica `Ctrl + Alt + Shift + R`
(radi samo kad nema veze sa serverom).

**Skriptom** - pokreni `resetuj-launcher.bat` (u instalacionom folderu, podfolder `resources`).
Briše podešavanje i vraća launcher na prvo pokretanje.

**Ručno** - zatvori launcher, pa obriši folder:
```
%APPDATA%\crit-launcher
```
(Win+R > ukucaj `%APPDATA%` > nađi folder `crit-launcher` > obriši.)

## Ako nešto zapne

- **Launcher piše "Nema veze sa serverom"** - proveri da je server prozor otvoren i da je adresa tačna.
- **Računar se ne pali na daljinu** - Wake-on-LAN traži podešavanje u BIOS-u, vidi DEPLOY.md, sekcija 8.
- **Vraćanje starih podataka** - kopije baze su u `server/data/backups/`, uputstvo u DEPLOY.md, sekcija 5.
