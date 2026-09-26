import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { citajIzvor } from "./_okruzenje.mjs";
// Preuzimanje daljinske instalacije.
//
// Nedovrsen fajl ne sme da prodje kao gotov, jer se pokrece na racunaru igraca.
// HTTP server se ovde namerno lose ponasa (prekinuta veza, prazan odgovor, 404),
// a svaki slucaj mora da zavrsi kao greska, tacno jednom.
let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

// downloadFile nije izvezen iz main.js (main.js pri uvozu trazi Electron), pa
// se cita iz izvora i pusta u zasebnom dosegu. Tako se ipak proverava PRAVA
// funkcija, a ne njena kopija koja bi vremenom otisla u stranu.
const izvor = citajIzvor("client/main.js");
const pocetak = izvor.indexOf("function downloadFile(");
const kraj = izvor.indexOf("\nfunction runInstall(");
proveri("downloadFile se nasao u izvoru", pocetak > 0 && kraj > pocetak);
const kod = izvor.slice(pocetak, kraj);

const require2 = createRequire(import.meta.url);
const https = require2("node:https");
const downloadFile = new Function("http", "https", "fs", `${kod}; return downloadFile;`)(http, https, fs);

const RADNI = fs.mkdtempSync(path.join(os.tmpdir(), "crit-preuzimanje-"));
const SADRZAJ = Buffer.alloc(64 * 1024, 7); // 64 KB "instalacije"

// Server koji se ponasa onako kako se mreza stvarno ponasa.
const server = http.createServer((req, res) => {
  if (req.url === "/ceo") {
    res.writeHead(200, { "content-length": String(SADRZAJ.length) });
    return res.end(SADRZAJ);
  }
  if (req.url === "/pukne-nasred") {
    // Najavi pun fajl, posalji pola, pa preseci vezu. Ovako izgleda ruter koji
    // se resetuje ili net koji padne usred preuzimanja.
    res.writeHead(200, { "content-length": String(SADRZAJ.length) });
    res.write(SADRZAJ.subarray(0, SADRZAJ.length / 2));
    return setTimeout(() => res.destroy(), 60);
  }
  if (req.url === "/prazan") {
    res.writeHead(200, { "content-length": "0" });
    return res.end();
  }
  if (req.url === "/skretnica") {
    res.writeHead(302, { location: "/ceo" });
    return res.end();
  }
  res.writeHead(404); res.end("nema");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const adresa = (p) => `http://127.0.0.1:${PORT}${p}`;

// Skida i broji KOLIKO PUTA je javljeno - dupli odgovor je sam po sebi nalaz.
const skini = (put, ime) => new Promise((res) => {
  const dest = path.join(RADNI, ime);
  let odgovora = 0, greska;
  downloadFile(adresa(put), dest, (e) => { odgovora++; if (odgovora === 1) greska = e; });
  // Sacekaj i posle prvog odgovora - drugi bi stigao odmah za njim.
  setTimeout(() => res({ odgovora, greska, dest, postoji: fs.existsSync(dest) }), 1200);
});

// ---- 1) uredno preuzimanje ----
const ok = await skini("/ceo", "ceo.exe");
proveri("ceo fajl prolazi", ok.odgovora === 1 && !ok.greska, `${ok.odgovora} odgovora, ${ok.greska?.message}`);
proveri("fajl je cele velicine", ok.postoji && fs.statSync(ok.dest).size === SADRZAJ.length,
  ok.postoji ? String(fs.statSync(ok.dest).size) : "nema fajla");

// ---- 2) PREKINUTO PREUZIMANJE MORA DA BUDE GRESKA ----
// Velicina se poredi sa najavljenom, pa pola instalacije ne prolazi kao gotova.
const pola = await skini("/pukne-nasred", "pola.exe");
proveri("prekinuto preuzimanje je greska", !!pola.greska, "proslo bi kao gotovo i bilo bi POKRENUTO");
proveri("greska kaze da je veza pukla", /pukla|bajtova|socket|ECONN|aborted|prekinut/i.test(pola.greska?.message || ""), pola.greska?.message);
proveri("javlja se TACNO JEDNOM", pola.odgovora === 1, `${pola.odgovora} odgovora - panel bi dobio dva ishoda za isti posao`);
proveri("pola fajla se ne ostavlja na disku", !pola.postoji,
  "sledeci pokusaj bi naisao na njega, a i zauzima mesto koje niko ne cisti");

// ---- 3) prazan odgovor ----
const prazan = await skini("/prazan", "prazan.exe");
proveri("prazan fajl je greska", !!prazan.greska, "pokretanje praznog .exe-a nista ne kaze");
proveri("prazan fajl se ne ostavlja", !prazan.postoji);

// ---- 4) 404 ----
const nema = await skini("/nema-ga", "nema.exe");
proveri("404 je greska", !!nema.greska && /404/.test(nema.greska.message), nema.greska?.message);
proveri("javlja se jednom", nema.odgovora === 1, String(nema.odgovora));

// ---- 5) skretnica i dalje radi ----
// Steam, Discord i Firefox svi vracaju 302 na pravi fajl, pa bi ovo bilo
// najskuplje da se pokvari - biblioteka instalacija bi prestala da radi.
const skr = await skini("/skretnica", "skr.exe");
proveri("preusmerenje se prati do kraja", skr.odgovora === 1 && !skr.greska, `${skr.odgovora} odgovora, ${skr.greska?.message}`);
proveri("fajl preko skretnice je ceo", skr.postoji && fs.statSync(skr.dest).size === SADRZAJ.length);

// ---- 6) skinuta instalacija se brise posle instaliranja ----
proveri("skinuta instalacija se posprema", /const pospremi = \(\) => \{ try \{ fs\.unlinkSync\(dest\)/.test(izvor),
  "Steam + Chrome + Firefox su oko 300 MB po prolazu, a Temp niko ne cisti");

server.close();
fs.rmSync(RADNI, { recursive: true, force: true });
console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
