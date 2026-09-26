import { citajIzvor, brojac } from "./_okruzenje.mjs";
// Rad bez servera: veze u launcheru između računa (test-lokalna-sesija) i
// servera (test-offline-naplata). Kad bilo koja pukne, sat stoji i igra radi
// besplatno.
//
// Ponašanje u pravom Electronu, sa serverom koji se stvarno ugasi, meri
// proba-bez-servera.mjs.
const { proveri, kraj } = brojac();
const bezCR = (s) => s.replace(/\r\n/g, "\n");
const main = bezCR(citajIzvor("client/main.js"));
const rend = bezCR(citajIzvor("client/renderer/js/launcher.js"));
const preload = citajIzvor("client/preload.js");
const paket = JSON.parse(citajIzvor("client/package.json"));
const hub = citajIzvor("server/src/hub.js");

// ---- 1) INSTALER ----
// Modul koji nije u spisku fajlova za instaler postoji na ovom računaru, a na
// računaru u igraonici ne: launcher pukne na prvom `require` i mašina ostane
// bez kioska. Proverava se svaki lokalni modul, ne samo ovaj.
const trazeni = [...main.matchAll(/require\("\.\/([^"]+)"\)/g)].map((m) => m[1]);
const fale = trazeni.filter((f) => !paket.build.files.includes(f));
proveri("svaki modul koji main.js traži ide u instaler", trazeni.length >= 5 && fale.length === 0, fale.join(", "));
proveri("i modul lokalne sesije među njima", trazeni.includes("lokalna-sesija.js"));

// ---- 2) VEZA SA SERVEROM ----
proveri("launcher najavljuje izveštaj u adresi", /lokalna\.izvestaj\(\) \? "&offline=1" : ""/.test(main));
proveri("server čita najavu", /searchParams\.get\("offline"\) === "1"/.test(hub));
proveri("izveštaj ide prvi čim se veza otvori", /sveza\.on\("open"[\s\S]{0,300}offline_izvestaj/.test(main));
proveri("svaka poruka servera prolazi kroz lokalnu sesiju", /function handleServerMsg\(msg\) \{\s*pratiLokalnuSesiju\(msg\);/.test(main));
proveri("potvrda servera se prima", /case "offline_primljen": lokalna\.potvrdi\(msg\)/.test(main));

// ---- 3) SAT BEZ SERVERA ----
proveri("sat bez servera kuca svake sekunde", /setInterval\(tikLokalneSesije, 1000\)/.test(main));
proveri("upozorenja pred istek idu i bez servera", /function tikLokalneSesije\(\) \{[\s\S]{0,400}proveriVreme\(ostalo\)/.test(main));
proveri("računar se zaključa kad lokalno istekne", /if \(ostalo === 0\) zavrsiBezServera\("vreme"\)/.test(main));
proveri("dok je server tu, sat vodi server", /if \(!lokalna\.aktivna\(\) \|\| naVezi\(\)\) return;/.test(main));
proveri("odjava bez servera se ne baca", /msg\?\.t === "logout" && !naVezi\(\) && lokalna\.aktivna\(\)/.test(main),
  "wsSend bi je tiho bacio i igrač bi ostao prijavljen");

// ---- 4) LAUNCHER POKRENUT DOK SERVER ĆUTI ----
proveri("katalog se čuva za pokretanje bez servera", /snimiPotpisano\(KATALOG_PATH/.test(main));
proveri("i spisak dozvoljenog se puni iz njega", /zapamtiDozvoljeno\(k\.podaci\)/.test(main),
  "bez toga bi launcher pokrenut bez servera pustio da se pokrene bilo šta");
proveri("launcher pokrenut bez servera nastavlja sesiju", /if \(lokalna\.aktivna\(\)\) \{\s*sesijaAktivna = true;/.test(main));
proveri("prošla upozorenja se tada ne javljaju sva odjednom", /sesijaAktivna = true;\s*proveriVreme\(lokalna\.preostalo\(\), true\)/.test(main));
proveri("zapis koji ne prolazi proveru ostaje sa strane", /SESIJA_PATH \+ "\.neispravan"/.test(main));

// ---- 5) SESIJA SE VRAĆA ----
proveri("nastavak ne snima zatečene procese ponovo", /!\(msg\.nastavak && procesiPreSesije\)/.test(main),
  "igra pokrenuta u međuvremenu bi ušla u 'zatečeno' i ne bi se ugasila na kraju sesije");
proveri("nastavak ne pamti igračev miš kao zatečen", /!\(msg\.nastavak && podesavanjaPreSesije\)/.test(main));
proveri("novi server briše zapis starog", /config = \{ host: "", token: "", configured: false \};\s*[^\n]*\n\s*lokalna\.obrisi\(\);/.test(main));

// ---- 6) OTKLJUČAVANJE ----
proveri("otključavanje bez servera traži PIN u glavnom procesu",
  /"otkljucaj-bez-servera", \(e, pin\) => \{\s*if \(!proveriPin\(pin\)\) return \{ ok: false \};/.test(main));
proveri("most ga nudi ekranu", /otkljucajBezServera/.test(preload));
proveri("zaključan ekran bez servera se otključava servisnim PIN-om", /if \(!S\.wsOk && window\.crit\.otkljucajBezServera\)/.test(rend));

// ---- 7) EKRAN ----
proveri("igrač bez veze ostaje u sesiji", /if \(S\.player\) \{[\s\S]{0,900}S\.bezServera = true/.test(rend));
proveri("stanje sesije bez servera stiže u ekran", /case "lokalno_stanje":/.test(rend));
proveri("vraćena sesija ne vraća igrača na početnu", /if \(m\.nastavak && S\.player && S\.player\.id === m\.player\?\.id/.test(rend));
proveri("i ne pušta pozdrav usred igre", /if \(!m\.nastavak\) playBoot/.test(rend));
for (const [sta, uzorak] of [
  ["porudžbina", /function sendOrder\(\) \{[\s\S]{0,120}if \(!S\.wsOk\)/],
  ["točak", /function zavrtiTocakKlik\(\) \{[\s\S]{0,120}if \(!S\.wsOk\)/],
  ["VIP", /function kupiVip\(btn\) \{[\s\S]{0,80}if \(!S\.wsOk\)/],
  ["lozinka", /function saveAccountPassword\(\) \{\s*if \(!S\.wsOk\)/],
  ["pozadina", /function posaljiMojuPozadinu\(izmena\) \{\s*if \(!S\.wsOk\)/],
]) proveri(`bez servera ${sta} kaže da čeka server, umesto da ćuti`, uzorak.test(rend));

await kraj();
