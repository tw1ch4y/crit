import path from "node:path";
import fs from "node:fs";
import { KOREN, radniFolder, podigniServer, citajIzvor } from "./_okruzenje.mjs";
// Omoti i baneri igara i slike precica: kacenje, uklanjanje, i da panel tacno
// zna kojoj stavci slika fali. Ugradjeni logoi u launcheru i spisak u panelu
// moraju da se poklapaju, inace bi panel trazio sliku koja nije potrebna.
const BASE = "http://127.0.0.1:8111";
const DATA = radniFolder("slike-data");
await podigniServer(DATA, 8111);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, body: j }; });

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const uploads = path.join(KOREN, "server", "public", "uploads");
const napravljeni = [];

// ---- omot i baner igre ----
await api("/api/games", "POST", { name: "Proba Igra", path: "C:\\igre\\proba.exe" });
const igra = (await api("/api/games")).body.find((g) => g.name === "Proba Igra");
proveri("igra je napravljena bez slika", igra && !igra.image && !igra.banner, JSON.stringify(igra));

const ro = await api(`/api/games/${igra.id}/image`, "POST", { image: PNG });
proveri("omot se kaci", ro.status === 200 && /^\/uploads\/game-/.test(ro.body.image || ""), JSON.stringify(ro.body));
napravljeni.push(ro.body.image);

const rb = await api(`/api/games/${igra.id}/banner`, "POST", { image: PNG });
proveri("baner se kaci", rb.status === 200 && /^\/uploads\/banner-/.test(rb.body.image || ""), JSON.stringify(rb.body));
napravljeni.push(rb.body.image);

const posle = (await api("/api/games")).body.find((g) => g.id === igra.id);
proveri("obe slike su na igri", !!posle.image && !!posle.banner, JSON.stringify({ image: posle.image, banner: posle.banner }));
proveri("omot i baner su razliciti fajlovi", posle.image !== posle.banner);
proveri("obe su dostupne preko servera",
  (await fetch(BASE + posle.image)).status === 200 && (await fetch(BASE + posle.banner)).status === 200);

// launcher dobija obe
const zaKlijenta = (await api("/api/games")).body.find((g) => g.id === igra.id);
proveri("katalog nosi baner", !!zaKlijenta.banner);

// uklanjanje banera ne dira omot
await api(`/api/games/${igra.id}/banner`, "DELETE");
const bezBanera = (await api("/api/games")).body.find((g) => g.id === igra.id);
proveri("uklanjanje banera ne dira omot", !bezBanera.banner && !!bezBanera.image, JSON.stringify({ image: bezBanera.image, banner: bezBanera.banner }));
proveri("fajl banera je obrisan sa diska", !fs.existsSync(path.join(KOREN, "server", "public", rb.body.image)));

// ---- slika precice ----
await api("/api/tools", "POST", { name: "Proba Alat", kind: "web", target: "https://primer.rs" });
const alat = (await api("/api/tools")).body.find((t) => t.name === "Proba Alat");
const rt = await api(`/api/tools/${alat.id}/image`, "POST", { image: PNG });
proveri("slika precice se kaci", rt.status === 200 && /^\/uploads\/tool-/.test(rt.body.image || ""), JSON.stringify(rt.body));
napravljeni.push(rt.body.image);
await api(`/api/tools/${alat.id}/image`, "DELETE");
proveri("slika precice se uklanja", !(await api("/api/tools")).body.find((t) => t.id === alat.id).image);

// ---- spiskovi brendova moraju da se poklapaju ----
// Ime alata se poredi bez razmaka, tacaka i crtica - "Team Speak" i "Battlenet"
// moraju da pogode ugradjeni logo.
const kljuc = (i) => String(i || "").toLowerCase().replace(/[\s._-]/g, "");
const launcher = citajIzvor("client/renderer/js/launcher.js");
const pocetak = launcher.indexOf("const BRANDS");
const deo = launcher.slice(pocetak, launcher.indexOf("const BRAND_LOGOS"));
const uLauncheru = [...deo.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1].toLowerCase()).sort();

const panel = citajIzvor("server/public/js/app.js");
const red = /const ALATI_SA_LOGOM = \[([^\]]+)\]/.exec(panel);
const uPanelu = red ? [...red[1].matchAll(/"([^"]+)"/g)].map((m) => m[1].toLowerCase()).sort() : [];

proveri("panel zna za ugradjene logoe", uPanelu.length > 0, JSON.stringify(uPanelu));
proveri("spiskovi brendova se poklapaju",
  JSON.stringify(uLauncheru) === JSON.stringify(uPanelu),
  `launcher: ${JSON.stringify(uLauncheru)}\n         panel:    ${JSON.stringify(uPanelu)}`);
proveri("Twitch ima ugradjen logo", uLauncheru.includes("twitch"));
proveri("FACEIT ima ugradjen logo", uLauncheru.includes("faceit"), JSON.stringify(uLauncheru));

// ---- prava ikona iz .exe fajla ----
// Precica na program ne treba da ceka da neko rucno okaci logo: Windows nosi
// ikonu unutar .exe fajla i launcher je uzima odatle. Zato panel ne sme da
// javlja "nema sliku" za takve precice.
const main = citajIzvor("client/main.js");
const preload = citajIzvor("client/preload.js");
const css = citajIzvor("client/renderer/css/launcher.css");
proveri("glavni proces ume da izvuce ikonu iz .exe", main.includes("app.getFileIcon"));
proveri("ikona se trazi samo za fajl koji postoji", main.includes("const n = nadjiPutanju(p);"),
  "bez toga Windows vrati genericku ikonu nepoznatog fajla");
proveri("ikone se pamte da se disk ne cita stalno", main.includes("ikoneProgramaKes"));
proveri("most propusta zahtev za ikonom", preload.includes("programIcon"));
proveri("launcher trazi ikonu samo za programe", launcher.includes('t.kind === "app"'));
// Zvanicni vektorski znak ide ISPRED ikone iz .exe: ostar je na svakoj
// rezoluciji i ceo red izgleda ujednaceno, dok su izvucene ikone bitmape od
// 48 px razlicitog kvaliteta. Ikona iz .exe pokriva sve van spiska brendova.
// Gleda se samo unutar toolCardHtml - "const izExe" postoji i u plocici igre,
// koja je ranije u fajlu, pa bi trazenje po celom fajlu poredilo pogresna mesta.
const uKarticiAlata = launcher.slice(launcher.indexOf("function toolCardHtml"), launcher.indexOf("const IKONE_PROGRAMA"));
proveri("zvanicni znak brenda ima prednost nad ikonom iz .exe",
  uKarticiAlata.indexOf("if (brand)") >= 0 && uKarticiAlata.indexOf("if (brand)") < uKarticiAlata.indexOf("const izExe"),
  "ikona iz .exe bi pregazila zvanicni znak");
proveri("boja kartice se vadi iz same ikone", launcher.includes("obojiIkoneAlata"));

// ---- zvanicni znakovi ----
// Ranije su ovde stajali moji priblizni crtezi (Steam je bio krug sa tackom).
// Sad su obrisi iz zbirke Simple Icons, pa svaki znak mora da bude ozbiljne
// duzine - kratka putanja znaci da se neko vratio na crtez od tri poteza.
// Blok se deli po brendovima pa se svaki gleda zasebno - Google ima cetiri
// odvojene putanje (jednu po boji), pa se duzine sabiraju.
const brendovi = deo.split(/\{\s*name:/).slice(1).map((komad) => ({
  ime: (/^\s*"([^"]+)"/.exec(komad) || [])[1] || "?",
  boja: (/boja:\s*"(#[0-9A-Fa-f]{6})"/.exec(komad) || [])[1] || "",
  duzina: [...komad.matchAll(/d="([^"]+)"/g)].reduce((z, m) => z + m[1].length, 0),
}));
proveri("svaki brend ima zvanicnu boju i obris", brendovi.length >= 9, JSON.stringify(brendovi.map((b) => b.ime)));
for (const b of brendovi) {
  proveri(`"${b.ime}" ima pravi obris, ne skicu`, b.duzina > 120, `duzina putanje ${b.duzina}`);
}
proveri("nijedna boja brenda nije crna",
  !brendovi.some((b) => /#0{6}/i.test(b.boja)), JSON.stringify(brendovi.filter((b) => /#0{6}/i.test(b.boja))));

// Ime cesto nosi nastavak: "Faceit AC", "Discord PTB", "Battle.net Launcher".
const kljucevi = brendovi.map((b) => kljuc(b.ime)).sort((a, b) => b.length - a.length);
const pogodi = (ime) => { const k = kljuc(ime); return kljucevi.includes(k) || kljucevi.some((b) => k.startsWith(b)); };
for (const ime of ["Faceit AC", "Discord PTB", "Battle.net Launcher", "Steam Client", "Team Speak 3"]) {
  proveri(`"${ime}" pogadja svoj brend`, pogodi(ime), kljuc(ime));
}
proveri("nepoznat alat i dalje ne pogadja nista", !pogodi("Notepad"), kljuc("Notepad"));
proveri("launcher gleda i pocetak imena", launcher.includes("function nadjiBrend") && launcher.includes("k.startsWith(b)"));
proveri("panel gleda isto pravilo", panel.includes("KLJUCEVI_LOGOA") && panel.includes("k.startsWith(b)"));
// ---- precice (.lnk) ----
// Osoblje drzi precice u C:\games i u panel cesto upise samo "C:\games\cs2",
// bez nastavka. Uz to sama precica NE daje ikonu programa - Windows za nju
// vrati sicusnu genericku slicicu, pa se mora procitati na sta pokazuje.
// Bez ovo dvoje bi igre pisale "nije instalirana" ili stajale bez ikone.
proveri("glavni proces trazi fajl i kad nastavak nije upisan", main.includes("function nadjiPutanju"));
proveri("proba se prvo .lnk", /NASTAVCI = \[".lnk"/.test(main), "precice se koriste najcesce");
proveri("folder umesto fajla daje jasnu poruku", main.includes("je upisan folder, a treba prečica"));
proveri("ikona se vadi iz onoga na sta precica pokazuje", main.includes("function izvorIkone"));
proveri("cita se sama precica", main.includes("shell.readShortcutLink"));
proveri("sopstvena ikona precice ima prednost", /veza\.icon \|\| veza\.target/.test(main));
proveri("launcher ne odbija putanju bez nastavka",
  !/jeProgramNaDisku = \(p\) => \/\\\.\(exe\|lnk\)/.test(launcher),
  "stara provera je trazila nastavak, pa precica bez njega nije dobijala ikonu");
proveri("postoji proba nad pravim precicama", citajIzvor("testovi/proba-precica.mjs").includes("readShortcutLink"));

proveri("panel zna da se precica na .exe sama snalazi", panel.includes("samSeSnalazi"));
// Panel ne sme da javlja "nema sliku" za precicu bez nastavka - launcher je
// sam nadje. Odbija se samo ono sto sigurno nije fajl (steam:// i slicno).
proveri("panel ne trazi sliku ni za precicu bez nastavka",
  panel.includes('samSeSnalazi = (t) => t.kind === "app"') && panel.includes("a-z0-9+.-"),
  "inace bi za C:\\games\\cs2 pisalo da fali slika, iako je ima");

// ---- ista ikona i za plocice igara ----
// Igra bez okacene korice uzima ikonu iz svog .exe fajla, isto kao precica.
proveri("plocica igre trazi ikonu iz .exe", launcher.includes("jeProgramNaDisku(g.path)"));
proveri("igra preko steam:// se ne pita za ikonu",
  launcher.includes("!/^[a-z][a-z0-9+.-]*:\\/\\//i.test(put)"),
  "za steam:// putanju nema fajla na disku, pa nema ni ikone");
proveri("spisak ikona je zajednicki za igre i precice",
  launcher.includes("IKONE_PROGRAMA") && !launcher.includes("IKONE_ALATA"));
proveri("plocica bez korice je smirena, ne obojen blok",
  css.includes(".tile-fallback") && /linear-gradient\(160deg, var\(--panel-2\), var\(--bg\)/.test(css) && !/\.tile-fallback::after/.test(css),
  "jak obojen blok bi u polici vikao glasnije od prave korice");
proveri("dva slova stoje na istom mestu kao ikona",
  /\.tile-fallback \.tile-emoji \{ margin-bottom: 26px; \}/.test(css),
  "inace red poskakuje kad neka igra ima ikonu a neka nema");

// ---- oznaka kategorije ne sme da kvari korice ----
// Podrazumevana kategorija je "Igre", a to vec pise iznad police. Oznaka na
// svakoj plocici je bila ponavljanje, i jos je stajala preko korice i sekla
// logo igre (Counter-Strike, Minecraft, League of Legends).
// Funkcija se izvlaci iz izvora i STVARNO pokrece, da se proveri ponasanje a ne
// samo da li neki tekst postoji u fajlu.
const izvorOznake = launcher.slice(launcher.indexOf("const PODRAZUMEVANE_KATEGORIJE"), launcher.indexOf("// Dok osoblje ne okaci korice"));
const oznakaKategorije = new Function("esc", izvorOznake + "\nreturn oznakaKategorije;")((s) => String(s));

for (const k of ["Igre", "igre", "  Igra  ", "Ostalo", "", null, undefined]) {
  proveri(`kategorija ${JSON.stringify(k)} se ne prikazuje`, oznakaKategorije({ category: k }) === "",
    JSON.stringify(oznakaKategorije({ category: k })));
}
for (const k of ["FPS", "MOBA", "Battle Royale"]) {
  const html = oznakaKategorije({ category: k });
  proveri(`kategorija "${k}" se prikazuje`, html.includes("tile-badge") && html.includes(k), JSON.stringify(html));
}
proveri("oznaka stoji dole, ne preko logotipa na korici",
  /\.tile-badge \{[^}]*bottom: 46px/.test(css.replace(/\n/g, " ")),
  "gore levo bi sekla naziv igre koji korice gotovo uvek nose pri vrhu");
proveri("plocica vise ne lepi oznaku bezuslovno",
  !launcher.includes('class="tile-badge">${esc(g.category || "Igra")}'),
  "stari bezuslovni ispis je i dalje u kodu");

// Kanal mora da se zove isto na sva cetiri mesta. Kad je preimenovan samo na
// nekima, pregled je tiho pokazivao sve na rezervnom izgledu - nijedna greska,
// samo je delovalo kao da izvlacenje ikona ne radi.
const pregledEl = citajIzvor("testovi/pregled-electron.mjs");
for (const [gde, izvor] of [["glavni proces", main], ["most", preload], ["launcher", launcher], ["pregled u Electronu", pregledEl]]) {
  proveri(`${gde} koristi kanal "program-icon"`, izvor.includes("program-icon") || izvor.includes("programIcon"),
    "kanal se ne zove isto svuda");
  proveri(`${gde} nema stari naziv kanala`, !izvor.includes("tool-icon") && !izvor.includes("toolIcon"));
}

// ---- panel prikazuje stanje slika ----
// Omot je oznaka stanja; baner je i dugme (klik pravi privremeni baner).
// Baner je IZBORAN - prijava ima svoju pozadinu, pa igra bez banera nije
// problem i oznaka ne sme da stoji zuto kao da nesto fali.
proveri("kartica igre pokazuje omot i baner",
  /class="ss \$\{g\.image \? "ima" : "fali"\}/.test(panel) && /class="ss ss-akcija \$\{g\.banner \? "ima" : "izborno"\}/.test(panel));
proveri("izborna slika nije oznacena kao greska",
  /\.ss\.izborno \{[^}]*color: var\(--text-3\)/.test(citajIzvor("server/public/css/style.css").replace(/\s+/g, " ")));
proveri("traka ne javlja igre bez banera", panel.includes("if (!bezOmota) return \"\";"),
  "baner je izboran, pa igra bez njega ne ide u traku upozorenja");
proveri("traka broji sta fali", panel.includes("function trakaSlika") && panel.includes("function trakaAlata"));
proveri("mere u panelu odgovaraju stvarnom odnosu",
  panel.includes("600 x 800 px") && panel.includes("2800 x 400 px") && panel.includes("256 x 256 px"));
proveri("stare pogresne mere su uklonjene",
  !panel.includes("1600 x 500") && !panel.includes("400 x 400 px"));

const skup = new Set(uLauncheru.map(kljuc));
for (const ime of ["Team Speak", "TeamSpeak", "Battlenet", "Battle.net", "Battle Net", "Epic Games"]) {
  proveri(`"${ime}" pogadja ugradjen logo`, skup.has(kljuc(ime)), kljuc(ime));
}
proveri("launcher poredi imena bez razmaka i tacaka", launcher.includes('replace(/[\\s._-]/g, "")'));
proveri("panel koristi isto pravilo", panel.includes('replace(/[\\s._-]/g, "")'));

// Traka na vrhu nosi znak kuce levo i tocak desno; kad osoblje okaci promo
// baner, on ide na mesto znaka. Sablon u panelu je 2800x400 (7:1), a mesto u
// traci je sire i nize od toga - zato slika mora da se UKLOPI, ne da popuni.
// Sa "cover" bi joj se odsecao vrh i dno.
const promoCss = css.slice(css.indexOf(".promo-slajd {"), css.indexOf(".promo-tacke"));
proveri("okacen baner se nikad ne sece", /background-size:\s*contain/.test(promoCss), promoCss.slice(0, 200));
proveri("baner se ne ponavlja u sirinu", /background-repeat:\s*no-repeat/.test(promoCss));
// Preko slike koju je osoblje napravilo ne sme nikakav ukras.
proveri("preko promo banera nema sare ni niti", /\.hero\.promo::before,\s*\.hero\.promo::after \{ display: none; \}/.test(css));

// ---- brisanje stavke mora da povuce i njenu sliku ----
// Igre i alati su to radili od pocetka, shop nije - pa je svaka obrisana
// limenka ostavljala fotografiju na disku zauvek. Provera ide za sva tri tipa
// zajedno, da se ne desi da se opet negde zaboravi.
const naDisku = (u) => fs.existsSync(path.join(KOREN, "server", "public", u));

const pice = await api("/api/shop", "POST", { name: "Proba Pice", category: "Pića", price: 100 });
const piceId = (await api("/api/shop")).body.find((s) => s.name === "Proba Pice")?.id;
const rp = await api(`/api/shop/${piceId}/image`, "POST", { image: PNG });
proveri("slika pica se kaci", rp.status === 200 && /^\/uploads\//.test(rp.body.image || ""), JSON.stringify(rp.body));
napravljeni.push(rp.body.image);
proveri("slika pica je na disku", naDisku(rp.body.image));

await api(`/api/shop/${piceId}`, "DELETE");
proveri("brisanje pica brise i njegovu sliku", !naDisku(rp.body.image),
  "obrisana limenka je ostavljala fotografiju zauvek");

const slikaIgre = posle.image;
await api(`/api/games/${igra.id}`, "DELETE");
proveri("brisanje igre brise i koricu", !naDisku(slikaIgre), slikaIgre);

const rta = await api(`/api/tools/${alat.id}/image`, "POST", { image: PNG });
napravljeni.push(rta.body.image);
await api(`/api/tools/${alat.id}`, "DELETE");
proveri("brisanje alata brise i sliku", !naDisku(rta.body.image), rta.body.image);

// ---- pociscenje ----
const ostalo = fs.readdirSync(uploads).filter((f) => napravljeni.some((u) => u && u.endsWith(f)));
proveri("test ne ostavlja slike u projektu", ostalo.length === 0, JSON.stringify(ostalo));

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
