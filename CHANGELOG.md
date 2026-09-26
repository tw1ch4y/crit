# Izmene

Format prati [Keep a Changelog](https://keepachangelog.com/). Numeracija je
počela ispočetka sa 1.0.0, pre prve upotrebe u igraonici; verzije do 2.58.0
pripadaju razvoju i ne porede se sa novima.

## [Neobjavljeno]

### Ispravljeno
- Drugi primerak launchera (osigurač posle nadogradnje, autostart, dvoklik na
  prečicu) nije izlazio, pa su dva launchera sa istim tokenom otimala vezu.
  Sada vraća postojeći u prvi plan i izlazi, bez diranja politika.
- *Ugasi* i *Ugasi sve (kraj smene)* ostavljali su sesiju otvorenu; kad se
  računar ujutru upali, naplata se nastavljala igraču koga nema. Gašenje i
  odjava sa Windows-a sada prvo zatvaraju sesiju, a launcher sa gašenjem čeka
  da obriše tragove igrača.
- `zastita-ukljuci.bat` pokrenut sa *Run as administrator* sa standardnog
  naloga upisivao je ograničenja administratorskom nalogu umesto igraču. Sada se
  pokreće dvoklikom sa naloga igrača, a deo za ceo računar sam traži
  administratora.
- `DEINSTALIRAJ-LAUNCHER.bat` nije nalazio instalaciju u profilu igrača, a
  `POPRAVI-RACUNAR.bat` nije skidao autostart sa naloga igrača.
- `POPRAVI-RACUNAR.bat` i `VRATI-KOPIJU.bat` koristili su `wmic`, koga na novim
  instalacijama Windows 11 nema.

### Dodato
- Launcher gasi prečice pristupačnosti (pet puta Shift, filter i zvučni
  tasteri), čiji prozor vodi u Podešavanja.
- Politika `NoControlPanel`: igrač ne otvara Podešavanja ni Kontrolnu tablu, pa
  ni deinstalaciju launchera.
- Politike pregledača za ceo računar: bez dijaloga za fajlove, bez `file://`,
  bez čuvanja lozinki, bez ekrana dobrodošlice.
- Launcher se sam upisuje u automatsko pokretanje naloga.
- Posle igrača se brišu i prijave na Discord, Spotify, Minecraft i Roblox, kao
  i zapamćena prijava novijeg Steam-a.
- Status *Bez veze* i zvučno upozorenje u panelu kad računar sa otvorenom
  sesijom nestane sa mreže duže od minuta. Kvarovi koje javlja launcher sada se
  prikazuju i kao obaveštenje, ne samo u Logovima.

## [1.0.0] - 2026-09-16

Prvo izdanje za igraonicu.

- Server sa panelom za osoblje (računar i telefon), launcher za računare igrača.
- Naplata vremena po kreditu, vremenski paketi, brzi gosti, odjava zbog
  mirovanja, upozorenja pred istek preko igre i zvukom.
- Shop sa zalihama, porudžbine sa kredita ili kešom, kasa, smene sa obračunom
  kase, izveštaji i logovi.
- Rad launchera bez servera sa naknadnim obračunom odigranog vremena.
- Nadzornik servera, autostart pre prijave na Windows, nadogradnja servera i
  launchera iz panela sa automatskim vraćanjem.
- Kopije baze na 15 minuta, kopija van računara, alat za vraćanje kopije.
- Uloge radnik, vlasnik i serviser; servisni PIN iz panela.
- Iskustvo, nivoi, značke, rang lista, VIP članarina, nagradni točak.
- Izgled po igraonici: znak, boja, pozadine, promo baneri, šare.
