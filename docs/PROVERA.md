# Provera pred otvaranje

Stavke koje se proveravaju na pravim računarima u igraonici, redom kojim se
dešavaju u radu. Uz svaku piše očekivani ishod; sve drugo je nalaz koji treba
zapisati (šta je urađeno, šta se desilo, vreme) i proveriti u *Logovima*.

Automatske provere (`node testovi/pokreni-sve.mjs`) pokrivaju server i logiku
launchera; ovde je ono što traži pravi Windows, pravu mrežu i pravi telefon.

## 1. Server i panel

- [ ] `Pokreni server.bat` ispisuje adresu računara i mreže.
- [ ] Panel na `http://localhost:8095`, prijava `admin` / `admin`.
- [ ] Kontrolna tabla odmah upozorava na fabričku lozinku; posle promene
      upozorenje nestaje.
- [ ] Panel sa telefona na mrežnoj adresi: traka sa stranama se pomera
      prstom, a gore desno stoje ime i *Otvori smenu*.
- [ ] Restart glavnog računara **bez prijave na Windows**: panel sa telefona
      radi.
- [ ] Ubijen server (`Stop-Process -Id (Get-Content data\nadzor.json | ConvertFrom-Json).dete -Force`,
      PowerShell kao administrator u folderu servera): panel se vraća za
      nekoliko sekundi, a u *Logovi > Sistem* piše da je server ponovo pokrenut.
- [ ] Ubijen nadzornik (isto, sa `.pid`): server se vraća za najviše 5 minuta.

## 2. Računar igrača

- [ ] Launcher se instalira sa naloga igrača i sam se diže posle restarta.
- [ ] Prijava igrača; gornja traka pokazuje kredit i preostalo vreme.
- [ ] `Ctrl+Alt+Shift+Q` traži PIN i bez njega ne pušta.
- [ ] Posle `zastita-ukljuci.bat` i ponovne prijave: `Alt+Tab`, Windows
      taster i `Ctrl+Shift+Esc` ne vode van launchera.
- [ ] Pet puta Shift ne otvara prozor za lepljive tastere.
- [ ] `ms-settings:` iz pregledača ne otvara Podešavanja.
- [ ] U Chrome-u *Ctrl+S* ne otvara dijalog za čuvanje, a `file:///C:/` je
      blokiran.
- [ ] Drugo pokretanje launchera (prečica na radnoj površini) samo vraća
      postojeći u prvi plan; u *Task Manager*-u ostaje jedan primerak.

### Steam

- [ ] Steam se pokreće iz launchera i igra kreće.
- [ ] Steam-ov ugrađeni pregledač (Shift+Tab > Web) ostaje u kiosku i ne
      otvara Explorer ni dijalog za fajlove.
- [ ] Posle odjave igrača Steam traži prijavu i ne nudi prethodni nalog.
- [ ] Discord i Spotify iz prečica posle odjave igrača traže prijavu.

## 3. Tokom dana

- [ ] *Otvori smenu* sa početnim stanjem kase.
- [ ] Dopuna kredita sa telefona i sa računara.
- [ ] Porudžbina iz launchera stiže u panel uz zvuk.
- [ ] Poruka osoblja se vidi **preko igre** u punom ekranu.
- [ ] Upozorenje o vremenu na 5 i na 1 minut, preko igre i zvukom.
- [ ] Kad kredit istekne, računar se zaključa i panel to pokazuje.
- [ ] *Računari > tri tačke > Procesi* prikazuje programe na toj mašini i
      gasi izabrani.

## 4. Kvarovi

- [ ] **Izvučen kabl** tokom sesije: za najviše pola minuta kartica pokazuje
      *Bez veze*, a posle minut stiže zvučno upozorenje. Po vraćanju kabla
      računar se vraća sam i naplaćuje se odigrano vreme.
- [ ] **Ugašen server** dok igrači rade: launcheri pokazuju da nema veze, ali
      ne izbacuju igrača. Po paljenju servera svi se vraćaju sami.
- [ ] **Ugašen ruter** na minut: isto ponašanje.

## 5. Kraj dana

- [ ] Kasa prebrojana, smena zatvorena; obračun pokazuje očekivano i
      prebrojano.
- [ ] Namerno pogrešan iznos (npr. 300 manje): obračun pokazuje manjak i
      traži objašnjenje.
- [ ] Strana *Smene*: manjak crveno, višak žuto, poklapanje zeleno.
- [ ] *Logovi* sadrže *Manjak u kasi* sa oba iznosa i imenom radnika.
- [ ] Naplata posle zatvaranja smene: tabla upozorava sa tačnim iznosom.
- [ ] *Ugasi sve (kraj smene)* sa igračem na računaru: sesija se zatvara, a
      ujutru se ništa ne nastavlja.

## 6. Posle nekoliko dana

- [ ] *Podešavanja > Prostor na disku* pokazuje veličinu baze, broj kopija i
      slobodan prostor.
- [ ] *Podešavanja > Rezervne kopije* ima kopije i od ranijih dana.
- [ ] Na odredištu kopije van računara stoji sveža baza i folder `slike\`.
- [ ] `VRATI-KOPIJU.bat` vraća izabranu kopiju i server posle radi sa njom.
