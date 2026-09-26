# Provere

```bash
node testovi/pokreni-sve.mjs      # ili PROVERI-SISTEM.bat
```

Pokreće sve suite `test-*.mjs` jednu za drugom i na kraju ispisuje zbir. Svaka
suita diže svoj server na svom portu i svoju praznu bazu u `testovi/.radno/`;
prava baza iz `server/data/` se ne dira. Radne baze ostaju samo kad nešto
padne, da bi mogle da se pregledaju.

## Suite

Deo suita diže pravi server i razgovara sa njim preko HTTP-a i WebSocket-a kao
panel i launcher; deo proverava izvorni kod (pravila koja se ne mogu pustiti
na razvojnom računaru, npr. šta launcher upisuje u registar).

| Oblast | Suite |
|---|---|
| novac i smene | `kasa`, `kraj-dana`, `obracun-shopa`, `promet-danas`, `izvestaj`, `jedan-posao`, `dvostruka-naplata`, `naplata-otporna`, `poklonjen-kredit`, `paketi`, `kredit-vreme` |
| igrači | `gosti`, `igre`, `poredak`, `upozorenje-vreme`, `ciscenje-gostiju`, `mirovanje`, `odbrojavanje`, `nivoi`, `xp`, `znacke`, `rang-lista`, `vip`, `vip-clanarina`, `tocak`, `pogadjanje` |
| shop | `porudzbine`, `moje-porudzbine`, `porudzbina-zloupotreba`, `zalihe`, `kategorije` |
| računari i veza | `veza`, `mrtva-veza`, `gasenje-racunara`, `daljinski-procesi`, `internet`, `sat`, `restart`, `otpornost`, `opterecenje` |
| rad bez servera | `lokalna-sesija`, `offline-naplata`, `rad-bez-servera`, `kad-pukne` |
| launcher i kiosk | `kiosk-beg`, `kiosk-oporavak`, `kiosk-windows`, `launcher-ne-pada`, `bez-zamrzavanja`, `prvi-plan`, `optimizacija`, `igracka-podesavanja`, `igra-ne-radi`, `razvojni-racunar` |
| nadogradnje | `nadogradnja`, `nadogradnja-launchera`, `pomocnik-nadogradnje`, `nadogradnja-vidljiva`, `paket-servera`, `zamena-servera`, `nadogradnja-servera-uzivo`, `verzija` |
| server i nadzornik | `nadzornik`, `nadzornik-uzivo`, `autostart-servera`, `zastitna-zaglavlja`, `neispravni-unosi`, `prava-radnika`, `uklanjanje`, `serviser`, `servisni-pin`, `fabricka-lozinka`, `izolacija` |
| kopije i disk | `kopije`, `kopija-van`, `vracanje-kopije`, `skladiste`, `kopija-koda` |
| izgled | `panel`, `raspored`, `citljivost`, `znacenje-boja`, `boja-kuce`, `css-promenljive`, `font`, `tekst-na-ekranu`, `pozadine`, `tekstura`, `slike`, `promo`, `baner`, `brend`, `ime-igraonice` |
| paket | `paket`, `preuzimanje`, `prvi-dan`, `zivo` |

## Alati sa pravim launcherom

Alati `proba-*.mjs` i `pregled-*.mjs` puštaju pravi launcher u Electronu i
mere ono što se iz koda ne vidi: raspored na ekranu, animacije, font, tok
porudžbine od klika do baze. Otvaraju prozore i traju duže, pa nisu deo
`pokreni-sve.mjs`.

```bash
node testovi/pokreni-probe.mjs            # svi alati
node testovi/pokreni-probe.mjs klikova    # alati čije ime sadrži "klikova"
```

| Alat | Namena |
|---|---|
| `pregled-electron.mjs` | slike svih ekrana na 1920x1080 i 1366x768, sa merenjem onoga što ispada ili se seče |
| `pregled-panela.mjs` | isto za sve strane panela; traži `server-za-pregled.mjs` na portu 8096 |
| `pregled-launchera.mjs` | ekran launchera u običnom pregledaču, za doradu CSS-a |
| `proba-klikova.mjs` | svako dugme na svakom ekranu stiže do svog koda |
| `proba-admin-izlaz.mjs` | otključavanje računara ne gasi launcher, a izlaz traži PIN |
| `proba-pokretanje-igre.mjs`, `proba-precica.mjs` | klik na igru stiže do baze; putanja bez nastavka nalazi prečicu |
| `proba-pokretanje-van-kataloga.mjs` | launcher odbija da pokrene ono što nije u katalogu |
| `proba-servisni-pin-server.mjs` | servisni PIN iz panela stiže na launcher i važi bez servera |
| `proba-tocak-zaglavljen.mjs` | točak čiji odgovor ne stigne ne zamrzava kredit |
| `proba-porudzbine.mjs` | porudžbina kroz launcher preko pravog WebSocket-a do baze |
| `proba-police.mjs`, `proba-kretanja.mjs`, `proba-tocka.mjs` | animacije police, šara i točka, i sa isključenim Windows animacijama |
| `proba-fonta.mjs` | ugrađeni font ima č, ć, š, ž, đ |
| `proba-obavestenja.mjs` | obaveštenje preko igre pri isteku vremena i poruci osoblja |
| `proba-bez-servera.mjs` | server se ugasi usred igranja: sat ide, odjava i zaključavanje rade, posle se naplati odigrano |
| `proba-veza.mjs` | launcher preživljava otkucaje servera i vraća se posle njegovog pada |
| `proba-procesa.mjs` | daljinski spisak procesa gasi pravi pokrenut program |
| `proba-straze.mjs` | straža nad preuzetim programima sa pravim PowerShell-om |
| `proba-nadogradnja-pin.mjs` | servisni PIN preživljava prepisan `podesavanja.json` |
| `proba-podesavanja.mjs` | miš i zvuk kroz launcher; **menja podešavanja računara** i vraća ih na kraju; odbija da radi na računaru sa `CRIT-NE-DIRAJ.txt` |
| `godina-rada.mjs` | puni bazu obimom rada igraonice (`--dana 1825` za pet godina) i meri veličinu i brzinu |
| `server-za-pregled.mjs` | server na odvojenim podacima (`.radno/pregled-data`), napunjen kao prava igraonica |

Slike ostaju u `testovi/.slike*/`, radne baze u `testovi/.radno/`; ni jedno
ni drugo ne ide u git ni u paket.
