# Provera sistema

Pokreni **`PROVERI-SISTEM.bat`** (ili `node pokreni-sve.mjs`) posle svake izmene u kodu.
Prolazi kroz preko 1400 provera i na kraju kaže drži li sistem.

Svaka suita diže **svoj server na svom portu i svoju praznu bazu** u `testovi/.radno/`.
Prava baza iz `server/data/` se ne dira ni u jednom testu.

## Šta se proverava

| Suita | Šta pokriva |
|---|---|
| `kasa` | obračun smene: dopune, ispravke, keš i kupovina sa naloga, pazar, manjak, zamrznuta zatvorena smena, otkazana porudžbina |
| `neispravni-unosi` | šta se desi kad u polja uđe glupost: minus, tekst, ogroman broj, HTML, duple smene |
| `mirovanje` | odjava igrača koji je ustao: prag, odbrojavanje, otkazivanje, oslobađanje računara |
| `odbrojavanje` | brojanje na ekranu igrača (bez pokretanja launchera, sa lažnim Windows brojačem) |
| `gosti` | brzo otvaranje naloga za grupu, redosled imena, prijava izdiktiranom lozinkom |
| `ciscenje-gostiju` | brisanje potrošenih gostiju bez diranja redovnih igrača |
| `igre` | beleženje pokretanja, statistika najigranijih, redosled po igraču |
| `poredak` | redosled police u launcheru |
| `porudzbine` | igrač bira kredit ili keš, otkazivanje, pazar smene, logovi |
| `zalihe` | javljanje kad piće ide ka kraju i kad nestane, pregled za dopunu |
| `moje-porudzbine` | igrač vidi svoje porudžbine i status uživo, ne vidi tuđe |
| `kopije` | spisak i preuzimanje rezervnih kopija, radnik nema pristup, ime fajla ne izlazi iz foldera |
| `restart` | nestanak struje: server se stvarno gasi i diže, pa se proverava šta je preživelo (smena, obračun, sesije, kredit, zalihe, naplata bez nadoknade unazad) |
| `pozadine` | kačenje pozadina ekrana, trenutna primena na launcherima, radnik nema pristup, test čisti za sobom |
| `slike` | omoti i baneri igara, slike prečica, i da spisak ugrađenih logoa u panelu prati onaj u launcheru |
| `promo` | promo baneri: kačenje, redosled, skrivanje, brisanje, trenutna primena na launcherima |
| `veza` | namerno gađanje WebSocketa: pokvarene poruke, tuđi tokeni, brzo prekidanje veze, dve veze za isti računar |
| `seme` | Zod šeme bez servera: prave poruke launchera prolaze, višak polja i pogrešni tipovi ne prolaze, greška ne nosi lozinku, svaka poruka launchera ima šemu |
| `brzina` | kočnica brzine na WebSocketu: kofa sa lažnim satom, rafal, zatrpavanje (prekid 1008), ogromna poruka (1009), skupe poruke |
| `sesija-token` | token sesije vezan za sesiju, računar i igrača: šta veza bez potvrde ne sme, nastavak posle prekida, tuđi i lažni tokeni, preostalo vreme samo sa servera |
| `tocak-zastita` | varanje na točku: kriptografski izbor, spin koji izgubi trku, „poruči, zavrti, otkaži“, nametanje ishoda |
| `paralelna-kupovina` | pet istovremenih kupovina sa naloga koji ima za jednu: kasa, launcher, mešano, pet niti sa svojim vezama ka bazi (barijera), kontrola sa starim obrascem, vreme i porudžbina nad istim kreditom, okidači u bazi |
| `audit-log` | glavna knjiga kroz celu smenu: sve vrste zapisa, stanje pre i posle, operater, zbirno vreme, neprekinut lanac, kasa jednaka obračunu, tačna naplata vremena |
| `bezbednosni-log` | bezbednosni dnevnik: oblik zapisa, skrivanje tajni, prigušivanje, okretanje fajla, stvarni događaji sa servera, blokada adrese koja pogađa tokene |
| `nadogradnja` | postojeća baza iz igraonice preživljava novu verziju servera |

## Alati koji gledaju pravi launcher

Suite iznad proveravaju server. Ovi alati puštaju **pravi launcher u pravom
Electronu** i mere ono što se ne vidi iz koda — raspored na ekranu, da li
animacija stvarno radi, da li font ima naša slova, da li porudžbina prođe od
klika do baze.

**Pokreni ih sve odjednom:** `node pokreni-probe.mjs` (sam diže server i katalog,
traje nekoliko minuta). Za jedan alat: `node pokreni-probe.mjs klikova`.

Pojedinačno traže da server već radi na 8096.

> **Zašto ovo nije isto što i suite.** U suitama je oko 40% tvrdnji provera
> izvornog koda - hvataju da je neko obrisao liniju, ali ne dokazuju da funkcija
> radi. Alati ispod otvaraju pravi prozor, kliknu dugme i mere šta se desilo.
> Baš su oni našli da se nagradni točak ne može ni zavrteti ni zatvoriti, i da
> animacije stoje mrtve na računaru sa isključenim Windows animacijama - a
> nijedan test to nije prijavio.

| Alat | Šta radi |
|---|---|
| `pregled-electron.mjs` | slika **svih 9 ekrana** na 1920x1080 i 1366x768, plus 3 obaveštenja preko igre. Uz svaku sliku meri šta ispada iz ekrana, šta ulazi pod donju traku, koji je tekst odsečen i koji se font primenio. Slike u `.slike/` |
| `proba-porudzbine.mjs` | ceo tok porudžbine kroz launcher: dodavanje u korpu, izbor keš/kredit, slanje, provera šta je stiglo u bazu, promena statusa. Preko **pravog WebSocketa**, ne kroz lažni most |
| `proba-kretanja.mjs` | meri da li animacije šare stvarno rade — pozicija pozadine kroz vreme, maska kod talasa, dva sloja kod dubine, iskre. Sa `--reduced` pušta isto na računaru kakav je u igraonici (Windows sa isključenim animacijama) — pod tim uslovom su animacije jednom bile potpuno mrtve |
| `proba-klikova.mjs` | prolazi kroz sve ekrane i za **svako dugme** proverava da li klik uopšte stiže do koda. Nastao posle kvara u kom se nagradni točak otvarao, ali se nije mogao ni zavrteti ni zatvoriti: delegacija klikova visi na `#content`, a pop-up stoji izvan njega. Alat sam sebe proverava — ako presretač ne uhvati nijednog slušaoca ili launcher uopšte ne krene, javlja da provera nije ispravna umesto da kaže da je sve u redu |
| `proba-fonta.mjs` | da li ugrađeni font stvarno ima č ć š ž đ. Poredi širinu slova sa fontom i bez njega |
| `proba-procesa.mjs` | daljinski task manager: traži popis sa računara, gasi **pravi** pokrenut program i proverava da ga stvarno više nema. Diže i svoj server, ne treba mu spoljni |
| `proba-podesavanja.mjs` | miš i zvuk koje igrač menja sa svog naloga. Menja ih kroz PRAVI launcher, proverava da su stigli do Windows-a, pa odjavljuje igrača i proverava da je vraćeno zatečeno. **Menja podešavanja mašine na kojoj se pušta**, ali ih na kraju vraća bez obzira na ishod |
| `proba-obavestenja.mjs` | obaveštenje **preko igre**: igrač je u punom ekranu i ne vidi launcher, pa upozorenje o vremenu i poruka osoblja idu u zaseban prozor iznad svega. Prijavljuje igrača kroz sam launcher, spušta mu kredit ispod praga i čita šta je u tom prozoru stvarno pisalo. Do sada nije bilo pokriveno nijednom tvrdnjom, a to je najvidljivija zaštita koju igrač ima |
| `proba-veza.mjs` | pravi launcher i otkucaj servera. Server gasi vezu koja ne odgovori na ping - ovde se gleda da **pravi** launcher to preživi kroz tri kruga, jer bi inače svih 13 računara ispadalo svakih 30 sekundi. Zatim se server ubije i proverava da se launcher sam vrati |
| `proba-nadogradnja-pin.mjs` | servisni PIN posle nadogradnje. Tri puta pušta pravi launcher preko istog korisničkog naloga, a između pokretanja prepisuje `podesavanja.json` fabričkim — tačno kao instaler. Bez toga se PIN tiho vraćao na `1234` na svakoj mašini pri svakoj novoj verziji |
| `proba-beg.mjs` | *(u scratchpad-u)* pokušaj bega iz kioska preko „Promeni adresu servera" kad server ne odgovara |
| `pregled-launchera.mjs` | UI launchera u običnom pregledaču, bez Electrona, za brzu doradu CSS-a. Posle: `--obrisi` |
| `godina-rada.mjs` | puni bazu **stvarnim obimom** rada igraonice i meri šta se dešava kad naraste: veličina baze, brzina svake strane panela, koliko zauzmu rezervne kopije, i koliko se od svega toga vrati posle održavanja. `--dana 1825` za pet godina. Odatle su brojke u DEPLOY.md |
| `server-za-pregled.mjs` | diže server na **odvojenim podacima** (`.radno/pregled-data`, ne dira `server/data`) i puni ga kao pravu igraonicu: 13 računara, pun šank, igrači sa kreditom, otvorena smena. Treba ga za `pregled-panela.mjs` i za gledanje panela uživo. Na praznoj bazi se meri prazno stanje umesto pravog rasporeda |
| `pregled-panela.mjs` | slika svaku stranu panela na 1920x1080 i 1366x768 i meri šta ispada iz ekrana, koji je tekst odsečen i koliko je strana popunjena. Traži server na portu 8096 (gore). Namerno skraćen tekst (`text-overflow: ellipsis` uz `title`) ne prijavljuje — alat koji viče na isto pri svakom pokretanju prestane da se čita |

Zašto su odvojeni od suita: traže Electron i pokrenut server, traju duže, i
gledaju izgled — a suite moraju da budu brze i da rade bez ičega spolja.

**Ostavljaju za sobom** radne baze u `.radno/` i slike u `.slike*/`. Ni jedno
ni drugo ne ide u paket.

## Ako nešto padne

Ispis pokaže koja provera i sa kojim vrednostima. Radni folderi ostaju u
`testovi/.radno/` pa baza može da se otvori i pogleda.
