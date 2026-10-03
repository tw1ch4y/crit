# Šta proveriti pre otvaranja

Spisak za tebe, redom kojim se stvari i dešavaju. Uz svaku stavku piše **šta
treba da se desi** - ako se desi nešto drugo, to je nalaz.

Sve što se moglo proveriti programski već je pokriveno (preko 1400 automatskih
provera i 12 alata koji puštaju pravi launcher). Ovde je ostalo ono što traži
**pravu mašinu, pravi telefon i tvoje oči**.

Za probu na jednom računaru vidi `0 - PROBA NA JEDNOM RACUNARU/PROCITAJ PRVO.txt`.

---

## 1. Prvo pokretanje

- [ ] **Server se diže.** Pokreni `Pokreni server.bat`. U prozoru piše adresa
      računara i mreže.
- [ ] **Panel se otvara** na `http://localhost:8095`, prijava `admin` / `admin`.
- [ ] **Odmah te upozori na fabričku lozinku.** Na kontrolnoj tabli stoji crveno
      upozorenje sa dugmetom *Promeni lozinku*. Promeni je i proveri da
      upozorenje nestane.
- [ ] **Panel sa telefona.** Otvori adresu koja piše kao "mreža/telefon" na
      telefonu, na istoj WiFi mreži.
      Proveri: traka sa stranama se pomera prstom levo-desno, a **gore desno**
      stoji tvoje ime i dugme *Otvori smenu*. Preko imena idu *Promeni lozinku*
      i *Odjavi se*.

> Ovo je jedina stvar oko rasporeda koju ne mogu da proverim umesto tebe -
> emulacija pokazuje raspored, ali ne i kako izgleda na staklu u ruci.

## 2. Launcher na računaru igrača

- [ ] **Instalira se** i sam se pokreće posle restarta.
- [ ] **Prijava igrača** radi, HUD pokazuje kredit i preostalo vreme.
- [ ] **Ctrl+Alt+Q** traži PIN i ne pušta bez njega.
- [ ] **Alt+Tab, Win taster, Ctrl+Shift+Esc** ne izlaze iz launchera
      (posle `zastita-ukljuci.bat` kao administrator i ponovne prijave).

### Sa instaliranim Steam-om

Ovo ne mogu da proverim - na ovom računaru nema Steam-a.

- [ ] **Steam se pokreće** iz launchera i igra kreće.
- [ ] **Steam-ov ugrađeni pregledač** (Shift+Tab pa Web) se otvara i **ostaje
      unutar kioska** - ne otvara Windows Explorer ni dijalog za fajlove.
- [ ] **Preuzimanje fajla iz Steam pregledača** ne otvara prozor za snimanje.
- [ ] Posle odjave igrača **Steam nalog je odjavljen** (ako je čišćenje sesije
      upaljeno).

## 3. Tokom dana

- [ ] **Otvori smenu** i upiši početno stanje kase.
- [ ] **Dopuna kredita** radi sa telefona i sa računara.
- [ ] **Porudžbina iz launchera** stiže u panel uz zvuk.
- [ ] **Poruka sa panela** se pojavi **preko igre** dok je igrač u punom ekranu.
- [ ] **Upozorenje o vremenu** se pojavi preko igre na 5 i na 1 minut.
- [ ] **Kad kredit padne na nulu** računar se zaključa, a u panelu se to vidi.
- [ ] **Daljinski spisak procesa** (Računari > tri tačke > Procesi) pokaže šta
      radi na toj mašini i ugasi izabrani program.

## 4. Kad nešto pukne

- [ ] **Iščupaj mrežni kabl** iz računara igrača dok mu teče sesija.
      Za najviše pola minuta panel ga pokaže kao **van mreže**, a naplata staje.
      Vrati kabl: računar se sam vraća, bez naknadnog računa za to vreme.
- [ ] **Ugasi server** dok igrači rade. Launcheri pokažu da nema veze, ali ne
      izbacuju igrača. Upali server: svi se sami vrate, bez obilaska mašina.
- [ ] **Isključi ruter** na minut. Isto ponašanje.

## 5. Kraj dana

- [ ] **Prebroj kasu i zatvori smenu.** Obračun pokaže očekivano i prebrojano.
- [ ] **Namerno upiši pogrešan iznos** (npr. 300 manje). Obračun pokaže manjak i
      **odmah pita zašto**. Upiši objašnjenje.
- [ ] **Strana Smene** pokazuje kolonu *Razlika u kasi*: manjak crveno, višak
      žuto, *poklapa se* zeleno. Napomena stoji uz smenu.
- [ ] **Logovi** sadrže zapis `Manjak u kasi` sa prebrojanim i očekivanim
      iznosom, i ko je zatvorio smenu.
- [ ] **Naplati nešto posle zatvaranja smene.** Kontrolna tabla te upozori da
      taj novac ne ulazi ni u jedan obračun, sa tačnim iznosom.

## 6. Posle nekoliko dana rada

- [ ] **Podešavanja > Prostor na disku** pokazuje veličinu baze, broj rezervnih
      kopija i koliko je diska ostalo.
- [ ] **Rezervne kopije** se same prave (Podešavanja > Rezervne kopije) i ima ih
      i od pre nekoliko dana, ne samo od danas.
- [ ] **Vraćanje kopije**: ugasi server, pokreni `VRATI-KOPIJU.bat`, izaberi
      kopiju. Server posle toga radi sa podacima iz te kopije.

---

## Ako nešto ne valja

Zapiši **šta si radio** i **šta se desilo umesto očekivanog**. Ako je greška u
panelu, otvori Logove i pogledaj poslednje zapise u tom trenutku. Ako je u
launcheru, `POPRAVI-RACUNAR.bat` je u paketu (`2 - LAUNCHER - racunari igraca\ALATI OSOBLJA`), pokreće se kao administrator.
