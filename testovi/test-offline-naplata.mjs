import { createRequire } from "node:module";
import { radniFolder, podigniServer, ucitajWebSocket, brojac } from "./_okruzenje.mjs";
// SERVER SE VRATIO - KOLIKO SE NAPLAĆUJE
//
// Launcher vodi sesiju i dok servera nema, a kad se veza vrati, javi koliko je
// sekundi sesija ukupno trajala (vidi client/lokalna-sesija.js). Ovde se to
// izvodi nad PRAVIM serverom, preko pravog WebSocket-a, i gleda se novac:
//
//   - server ne vraća sesiju dok izveštaj ne stigne, i za to vreme ne naplaćuje
//   - naplaćuje tačno razliku, a isti izveštaj poslat dvaput - ništa
//   - prepravljen izveštaj ili izveštaj sa tuđim potpisom ne naplaćuje ništa
//   - odjava bez servera oslobađa računar, isteklo vreme ga zaključava
//   - sesija koju je osoblje zatvorilo dok računar nije bio na vezi se ne dira
//   - nikad više od kredita, i po nižoj od dve cene
//   - najavljen izveštaj koji ne stigne ne ostavlja računar da visi
//   - stariji launcher (bez najave) radi kao i do sada
//   - stara veza koja se zatvori posle nove ne prekida čekanje
process.env.OFFLINE_IZVESTAJ_CEKA_MS = "8000";
const WebSocket = await ucitajWebSocket();
const require = createRequire(import.meta.url);
const { potpisi } = require("../client/lokalna-sesija.js");
const { proveri, kraj } = brojac();

const PORT = 8215;
const BASE = `http://127.0.0.1:${PORT}`;
const WSB = `ws://127.0.0.1:${PORT}`;
await podigniServer(radniFolder("offline-naplata-data"), PORT);
const { db } = await import("../server/src/db.js");
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

// Dinar u sekundi, da se svaka sekunda vidi na kreditu.
await api("/api/settings", "POST", { ratePerHour: 3600 });
for (const [u, kredit] of [["mile", 3000], ["zika", 3000], ["pera", 3000], ["mali", 5]]) {
  await api("/api/players", "POST", { username: u, password: u + "1234", displayName: u });
  const p = (await api("/api/players")).find((x) => x.username === u);
  await api(`/api/players/${p.id}/topup`, "POST", { amount: kredit, note: "keš" });
}
const pcs = await api("/api/computers");
const igrac = async (u) => (await api("/api/players")).find((p) => p.username === u);
const kredit = async (u) => Number((await igrac(u)).balance);
const racunar = async (id) => (await api("/api/computers")).find((c) => c.id === id);
const logovi = async () => JSON.stringify(await api("/api/logs?limit=500"));
const sekundiUBazi = (id) => Number(db.prepare("SELECT sekundi FROM sessions WHERE id=?").get(id).sekundi);
const sesijaUBazi = (id) => db.prepare("SELECT * FROM sessions WHERE id=?").get(id);
const xp = (id) => Number(db.prepare("SELECT xp FROM players WHERE id=?").get(id).xp);
const blizu = (a, b, t = 0.011) => Math.abs(Number(a) - Number(b)) < t;

function klijent(pc, { offline = false } = {}) {
  const ws = new WebSocket(`${WSB}/ws?kind=client&token=${pc.token}&v=proba${offline ? "&offline=1" : ""}`);
  const poruke = [];
  ws.on("message", (b) => { try { poruke.push(JSON.parse(b.toString())); } catch {} });
  ws.on("error", () => {});
  return {
    ws, poruke,
    otvoren: new Promise((r) => ws.on("open", r)),
    ima: (t) => poruke.some((m) => m.t === t),
    async cekajPoruku(t, ms = 4000, uslov = () => true) {
      const doKad = Date.now() + ms;
      while (Date.now() < doKad) {
        const m = poruke.find((x) => x.t === t && uslov(x));
        if (m) return m;
        await cekaj(40);
      }
      return null;
    },
    posalji: (o) => ws.send(JSON.stringify(o)),
    async zatvori() { try { ws.close(); } catch {} await cekaj(400); },
  };
}
const zapis = (o) => ({ v: 1, kraj: null, krajKad: null, offlineOd: Date.now() - 1000, poslato: Date.now(), ...o });
const izvestaj = (pc, z) => ({ t: "offline_izvestaj", zapis: z, potpis: potpisi(z, pc.token) });

const mile = await igrac("mile");
const pc1 = pcs[0];

// ---- 1) PRIJAVA I NAPLATA NOSE SEKUNDE ----
let k = klijent(pc1);
await k.otvoren; await cekaj(300);
k.posalji({ t: "login", username: "mile", password: "mile1234" });
const lok = await k.cekajPoruku("login_ok");
const S = lok?.session?.id;
proveri("prijava javlja koliko je sekundi već naplaćeno", lok?.session?.sekundi === 0, JSON.stringify(lok?.session));
proveri("nova prijava nije nastavak", lok?.nastavak === false);
const bal = await k.cekajPoruku("balance", 9000, (m) => m.sekundi > 0);
proveri("naplata javlja sesiju i sekunde", bal?.sesija === S && bal.sekundi > 0, JSON.stringify(bal));

// ---- 2) BEZ VEZE SE NE NAPLAĆUJE ----
await k.zatvori();
const kA = await kredit("mile"), sA = sekundiUBazi(S);
await cekaj(5600);
proveri("dok računar nije na vezi, server ne naplaćuje", blizu(await kredit("mile"), kA) && sekundiUBazi(S) === sA,
  `${kA} -> ${await kredit("mile")}`);

// ---- 3) POVRATAK SA NAJAVOM ----
k = klijent(pc1, { offline: true });
await k.otvoren; await cekaj(1200);
proveri("stiže katalog", k.ima("welcome"));
proveri("ali sesija se ne vraća pre izveštaja", !k.ima("login_ok") && !k.ima("to_login"),
  "login_ok bi vratio igrača na radnu površinu i kad se u međuvremenu odjavio");
const kB = await kredit("mile");
await cekaj(5600);
proveri("dok se čeka izveštaj, ne naplaćuje se", blizu(await kredit("mile"), kB) && sekundiUBazi(S) === sA);

const S0 = sekundiUBazi(S);
const xpPre = xp(mile.id);
const zap1 = zapis({ sesija: S, igrac: mile.id, sekundi: Math.round((S0 + 20) * 10) / 10, cena: 3600 });
k.posalji(izvestaj(pc1, zap1));
const p1 = await k.cekajPoruku("offline_primljen");
proveri("server potvrđuje izveštaj", p1?.stanje === "nastavljeno" && p1.sesija === S, JSON.stringify(p1));
proveri("naplaćeno je tačno 20 sekundi", blizu(p1?.naplaceno, 20), String(p1?.naplaceno));
proveri("kredit posle obračuna je 20 manji", blizu(p1?.balance, kB - 20), `${kB} -> ${p1?.balance}`);
proveri("brojač u bazi je poravnat", blizu(p1?.sekundi, S0 + 20, 0.11) && blizu(sekundiUBazi(S), S0 + 20, 0.11));
proveri("iskustvo raste kao i za svaku drugu potrošnju", xp(mile.id) >= xpPre + 19.99, `${xpPre} -> ${xp(mile.id)}`);
const nast = await k.cekajPoruku("login_ok");
proveri("posle obračuna sesija se vraća", nast?.session?.id === S);
proveri("i to kao nastavak, bez pozdrava", nast?.nastavak === true);
proveri("u logovima piše koliko je igrao bez servera", (await logovi()).includes("offline_naplata"));

// ---- 4) ISTI IZVEŠTAJ DRUGI PUT ----
// Potvrda se izgubila jer je veza opet pukla - launcher šalje isto.
await k.zatvori();
k = klijent(pc1, { offline: true });
await k.otvoren; await cekaj(300);
k.posalji(izvestaj(pc1, zap1));
const p2 = await k.cekajPoruku("offline_primljen");
proveri("isti izveštaj drugi put ne naplaćuje ništa", p2?.stanje === "nastavljeno" && p2.naplaceno === 0, JSON.stringify(p2));
await k.cekajPoruku("login_ok");

// ---- 5) PREPRAVLJEN I TUĐI IZVEŠTAJ ----
await k.zatvori();
k = klijent(pc1, { offline: true });
await k.otvoren; await cekaj(300);
const S1 = sekundiUBazi(S);
const kE = await kredit("mile");
const pravi = zapis({ sesija: S, igrac: mile.id, sekundi: S1 + 600, cena: 3600 });
k.posalji({ t: "offline_izvestaj", zapis: { ...pravi, sekundi: S1 + 1 }, potpis: potpisi(pravi, pc1.token) });
const p3 = await k.cekajPoruku("offline_primljen");
proveri("prepravljen izveštaj se odbija", p3?.stanje === "odbijeno", JSON.stringify(p3));
proveri("i ne naplaćuje ništa", sekundiUBazi(S) - S1 < 5.5 && kE - (await kredit("mile")) < 5.5);
proveri("odbijanje je zapisano za osoblje", (await logovi()).includes("offline_odbijen"));
proveri("sesija ide dalje", !!(await k.cekajPoruku("login_ok")));

await k.zatvori();
k = klijent(pc1, { offline: true });
await k.otvoren; await cekaj(300);
const S1b = sekundiUBazi(S);
k.posalji(izvestaj(pcs[1], zapis({ sesija: S, igrac: mile.id, sekundi: S1b + 300, cena: 3600 })));
const p3b = await k.cekajPoruku("offline_primljen");
proveri("izveštaj potpisan tokenom drugog računara se odbija", p3b?.stanje === "odbijeno" && sekundiUBazi(S) - S1b < 5.5);
await k.cekajPoruku("login_ok");

// ---- 6) ODJAVA BEZ SERVERA ----
await k.zatvori();
const S2 = sekundiUBazi(S);
const kF = await kredit("mile");
k = klijent(pc1, { offline: true });
await k.otvoren; await cekaj(300);
k.posalji(izvestaj(pc1, zapis({ sesija: S, igrac: mile.id, sekundi: S2 + 10, cena: 3600, kraj: "odjava", krajKad: Date.now() })));
const p4 = await k.cekajPoruku("offline_primljen");
proveri("odjava bez servera završava sesiju", p4?.stanje === "zavrseno" && blizu(p4.naplaceno, 10), JSON.stringify(p4));
proveri("računar ide na prijavu, ne na zaključan ekran", !!(await k.cekajPoruku("to_login")) && !k.ima("locked"));
proveri("za zatvorenu sesiju ne stiže login_ok", !k.ima("login_ok"));
proveri("sesija je zatvorena u bazi", sesijaUBazi(S).status === "ended");
proveri("igraču ostaje ostatak kredita", blizu(await kredit("mile"), kF - 10), `${kF} -> ${await kredit("mile")}`);
proveri("računar je slobodan", (await racunar(pc1.id)).status === "idle");

// ---- 7) ISTEKLO VREME BEZ SERVERA ----
k.posalji({ t: "login", username: "mile", password: "mile1234" });
const l2 = await k.cekajPoruku("login_ok", 4000, (m) => m.session?.id !== S);
const S3 = l2?.session?.id;
await k.zatvori();
k = klijent(pc1, { offline: true });
await k.otvoren; await cekaj(300);
k.posalji(izvestaj(pc1, zapis({ sesija: S3, igrac: mile.id, sekundi: sekundiUBazi(S3) + 5, cena: 3600, kraj: "vreme", krajKad: Date.now() })));
const p5 = await k.cekajPoruku("offline_primljen");
proveri("isteklo vreme bez servera završava sesiju", p5?.stanje === "zavrseno", JSON.stringify(p5));
proveri("i zaključava računar", (await k.cekajPoruku("locked"))?.reason === "time");
proveri("panel ga vidi zaključanog", (await racunar(pc1.id)).status === "locked");
await k.zatvori();

// ---- 7b) OSOBLJE OTKLJUČALO BEZ SERVERA ----
// Vreme je isteklo dok servera nije bilo, pa je osoblje servisnim PIN-om vratilo
// računar na prijavu. Posle povratka veze ne sme ponovo da se zaključa.
await api(`/api/computers/${pc1.id}/unlock`, "POST");
k = klijent(pc1);
await k.otvoren; await cekaj(300);
k.posalji({ t: "login", username: "mile", password: "mile1234" });
const l3 = await k.cekajPoruku("login_ok", 4000, (m) => m.session?.id !== S3);
await k.zatvori();
k = klijent(pc1, { offline: true });
await k.otvoren; await cekaj(300);
k.posalji(izvestaj(pc1, zapis({ sesija: l3?.session?.id ?? 0, igrac: mile.id, sekundi: l3 ? sekundiUBazi(l3.session.id) + 5 : 5,
  cena: 3600, kraj: "vreme", krajKad: Date.now(), otkljucano: true })));
const p5b = await k.cekajPoruku("offline_primljen");
proveri("otključano bez servera: sesija je završena", p5b?.stanje === "zavrseno", JSON.stringify(p5b));
proveri("ali računar ide na prijavu, ne ponovo na zaključan ekran", !!(await k.cekajPoruku("to_login")) && !k.ima("locked"));
proveri("i panel ga vidi slobodnog", (await racunar(pc1.id)).status === "idle");
await k.zatvori();

// ---- 8) OSOBLJE ZATVORILO SESIJU DOK RAČUNAR NIJE BIO NA VEZI ----
const pc2 = pcs[1];
const zika = await igrac("zika");
let k2 = klijent(pc2);
await k2.otvoren; await cekaj(300);
k2.posalji({ t: "login", username: "zika", password: "zika1234" });
const lz = await k2.cekajPoruku("login_ok");
await k2.zatvori();
await api(`/api/computers/${pc2.id}/logout`, "POST");
const kZ = await kredit("zika");
k2 = klijent(pc2, { offline: true });
await k2.otvoren; await cekaj(300);
k2.posalji(izvestaj(pc2, zapis({ sesija: lz.session.id, igrac: zika.id, sekundi: 900, cena: 3600 })));
const p6 = await k2.cekajPoruku("offline_primljen");
proveri("sesija zatvorena u panelu se ne naplaćuje", p6?.stanje === "odbijeno" && blizu(await kredit("zika"), kZ), JSON.stringify(p6));
proveri("računar ide na prijavu", !!(await k2.cekajPoruku("to_login")));
proveri("i to je zapisano", (await logovi()).includes("zatvorena dok računar nije bio na vezi"));
await k2.zatvori();

// ---- 9) NIŽA CENA, I NIKAD VIŠE OD KREDITA ----
const pc3 = pcs[2];
const pera = await igrac("pera");
let k3 = klijent(pc3);
await k3.otvoren; await cekaj(300);
k3.posalji({ t: "login", username: "pera", password: "pera1234" });
const lp = await k3.cekajPoruku("login_ok");
const SP = lp.session.id;
await k3.zatvori();
k3 = klijent(pc3, { offline: true });
await k3.otvoren; await cekaj(300);
k3.posalji(izvestaj(pc3, zapis({ sesija: SP, igrac: pera.id, sekundi: sekundiUBazi(SP) + 40, cena: 1800 })));
const p7 = await k3.cekajPoruku("offline_primljen");
proveri("naplaćuje se po ceni koju je igrač video kad je niža", blizu(p7?.naplaceno, 20), String(p7?.naplaceno));
await k3.cekajPoruku("login_ok");

const pc4 = pcs[3];
const mali = await igrac("mali");
let k4 = klijent(pc4);
await k4.otvoren; await cekaj(300);
k4.posalji({ t: "login", username: "mali", password: "mali1234" });
const lm = await k4.cekajPoruku("login_ok");
await k4.zatvori();
k4 = klijent(pc4, { offline: true });
await k4.otvoren; await cekaj(300);
k4.posalji(izvestaj(pc4, zapis({ sesija: lm.session.id, igrac: mali.id, sekundi: sekundiUBazi(lm.session.id) + 60, cena: 3600 })));
const p8 = await k4.cekajPoruku("offline_primljen");
proveri("nikad više nego što igrač ima", p8 && p8.naplaceno <= 5 && Number(p8.balance) === 0, JSON.stringify(p8));
proveri("i računar se zaključava kad kredita nema", p8?.stanje === "zavrseno" && (await k4.cekajPoruku("locked"))?.reason === "time");
proveri("a nenaplaćen višak je zapisan", (await logovi()).includes("nije naplaćeno još"));
await k4.zatvori();

// ---- 10) NAJAVA BEZ IZVEŠTAJA NE OSTAVLJA RAČUNAR DA VISI ----
await k3.zatvori();
k3 = klijent(pc3, { offline: true });
await k3.otvoren;
await cekaj(2000);
proveri("pre isteka čekanja sesija se ne vraća", !k3.ima("login_ok"));
const vracena = await k3.cekajPoruku("login_ok", 9000);
proveri("posle isteka čekanja sesija se ipak vraća", vracena?.session?.id === SP);
proveri("i to je zapisano", (await logovi()).includes("offline_bez_izvestaja"));

// ---- 11) STARIJI LAUNCHER, BEZ NAJAVE ----
await k3.zatvori();
k3 = klijent(pc3);
await k3.otvoren;
proveri("stariji launcher dobija sesiju odmah, kao i do sada", !!(await k3.cekajPoruku("login_ok", 1500)));

// ---- 12) STARA VEZA SE ZATVORI POSLE NOVE ----
// k3 je i dalje otvorena. Nova veza sa najavom je zatvara - a to zatvaranje
// stigne posle otvaranja nove i ne sme da prekine čekanje.
const k3b = klijent(pc3, { offline: true });
await k3b.otvoren;
await cekaj(1500);
proveri("zatvaranje stare veze ne prekida čekanje na izveštaj", !k3b.ima("login_ok"));
k3b.posalji(izvestaj(pc3, zapis({ sesija: SP, igrac: pera.id, sekundi: sekundiUBazi(SP), cena: 3600 })));
proveri("i izveštaj posle toga prolazi", (await k3b.cekajPoruku("offline_primljen"))?.stanje === "nastavljeno");

// ---- 13) SMEĆE ----
k3b.posalji({ t: "offline_izvestaj", zapis: "smece" });
k3b.posalji({ t: "offline_izvestaj", zapis: { v: 1, sesija: SP, sekundi: -1, cena: 1 }, potpis: "00" });
k3b.posalji({ t: "offline_izvestaj" });
await cekaj(600);
proveri("pokvaren izveštaj ne obara server", (await api("/api/computers")).length === pcs.length);
await k3b.zatvori();

await kraj();
