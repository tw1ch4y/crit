import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { KOREN, radniFolder, podigniServer, ucitajWebSocket, panelKlijent, brojac } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// BEZBEDNOSNI DNEVNIK
//
// Sumnjiv dogadjaj koji se ne zapise nije se ni desio. Ovde se proverava:
//   - oblik zapisa: jedan JSON po redu, uvek ista polja
//   - u zapis nikad ne ulaze lozinke, PIN-ovi ni tokeni
//   - isti dogadjaj u petlji ne puni disk (prigusivanje + okretanje fajla)
//   - stvarni dogadjaji sa servera: neispravan token racunara i panela,
//     neispravan zahtev, dupla naplata, tudji broj porudzbine, blokada
//     adrese koja pogadja tokene

const PORT = 8217, BASE = `http://127.0.0.1:${PORT}`, WSB = `ws://127.0.0.1:${PORT}`;
const b = brojac();
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const DATA = radniFolder("bezbednosni-log-data");

// ---- 1. modul sam, bez servera ----
const bz = await import(pathToFileURL(path.join(KOREN, "server", "src", "bezbednost.js")).href);
const fajl = path.join(DATA, "proba-bezbednost.jsonl");
const uLogove = [];
const uKonzolu = [];
bz.povezi({ logEvent: (o) => uLogove.push(o), konzola: (red) => uKonzolu.push(red), putanja: fajl });

const T = 1_800_000_000_000;
const z1 = bz.zabelezi({ vrsta: "proba", nivo: "upozorenje", opis: "Prvi dogadjaj", ip: "10.0.0.9", racunar: "PC-04", racunarId: 4,
  igrac: "marko", podaci: { password: "TAJNA-1", ugnezdeno: { pin: "TAJNA-2", token: "TAJNA-3", sesija: "TAJNA-4" }, korisno: 7 }, sada: T });
const redovi = fs.readFileSync(fajl, "utf8").trim().split("\n");
const zapis = JSON.parse(redovi[0]);
b.proveri("zapis je jedan JSON u jednom redu", redovi.length === 1 && zapis.vrsta === "proba");
b.proveri("zapis ima sva polja",
  ["ts", "nivo", "vrsta", "opis", "ip", "racunar", "racunarId", "igrac", "podaci", "ponovljeno"].every((k) => k in zapis), Object.keys(zapis).join(","));
b.proveri("vreme je ISO 8601", zapis.ts === new Date(T).toISOString());
b.proveri("lozinka, PIN, token i token sesije su skriveni", !fs.readFileSync(fajl, "utf8").includes("TAJNA")
  && zapis.podaci.password === "[skriveno]" && zapis.podaci.ugnezdeno.pin === "[skriveno]" && zapis.podaci.ugnezdeno.sesija === "[skriveno]");
b.proveri("ostali podaci ostaju", zapis.podaci.korisno === 7);
b.proveri("isti zapis ide i u konzolu", uKonzolu.length === 1 && JSON.parse(uKonzolu[0]).vrsta === "proba");
b.proveri("upozorenje ide u Logove panela pod 'bezbednost'", uLogove.length === 1 && uLogove[0].category === "bezbednost"
  && uLogove[0].action === "proba" && uLogove[0].target === "PC-04", JSON.stringify(uLogove[0]));
b.proveri("zabelezi vraca zapis", z1?.vrsta === "proba");

// prigusivanje: isti dogadjaj sa istog racunara najvise jednom u minutu
const ponovo = [];
for (let i = 1; i <= 50; i++) ponovo.push(bz.zabelezi({ vrsta: "proba", racunarId: 4, sada: T + i * 100 }));
b.proveri("50 istih u minutu se ne upisuje", ponovo.every((x) => x === null) && fs.readFileSync(fajl, "utf8").trim().split("\n").length === 1);
const drugi = bz.zabelezi({ vrsta: "proba", racunarId: 5, sada: T + 6000 });
b.proveri("isti dogadjaj sa DRUGOG racunara se upisuje", drugi !== null);
const posleMinuta = bz.zabelezi({ vrsta: "proba", racunarId: 4, opis: "opet", sada: T + 61_000 });
b.proveri("posle minuta se upisuje uz broj preskocenih", posleMinuta?.ponovljeno === 50, JSON.stringify(posleMinuta));
b.proveri("broj preskocenih stoji i u Logovima panela", /još 50 puta/.test(uLogove.at(-1)?.detail || ""), uLogove.at(-1)?.detail);

// nivoi
const pre = uLogove.length;
bz.zabelezi({ vrsta: "samo_info", nivo: "info", sada: T });
b.proveri("'info' ide u fajl, ali ne u Logove panela", uLogove.length === pre && fs.readFileSync(fajl, "utf8").includes("samo_info"));
const nepoznat = bz.zabelezi({ vrsta: "nivo_proba", nivo: "strasno", sada: T });
b.proveri("nepoznat nivo postaje 'upozorenje'", nepoznat?.nivo === "upozorenje");
const dug = bz.zabelezi({ vrsta: "dugo", opis: "x".repeat(5000), podaci: { s: "y".repeat(5000), n: Array.from({ length: 100 }, (_, i) => i) }, sada: T });
b.proveri("dugacak tekst se skracuje", dug.opis.length === 300 && dug.podaci.s.length < 210 && dug.podaci.n.length === 20);
b.proveri("zabelezi bez vrste ne radi nista", bz.zabelezi({ opis: "x" }) === null);

const poslednji = bz.poslednjiZapisi({ limit: 3 });
b.proveri("poslednji zapisi: najnoviji prvi", poslednji[0].vrsta === "dugo" && poslednji.length === 3);
b.proveri("poslednji zapisi: filter po vrsti i nivou", bz.poslednjiZapisi({ vrsta: "samo_info" }).length === 1
  && bz.poslednjiZapisi({ nivo: "info" }).every((x) => x.nivo === "info"));

// okretanje fajla
bz.povezi({ najveci: 3000 });
for (let i = 0; i < 40; i++) bz.zabelezi({ vrsta: "punjenje", racunarId: i, opis: "z".repeat(100), sada: T });
b.proveri("fajl se okrece kad naraste (stari ide u .1)", fs.existsSync(fajl + ".1") && fs.statSync(fajl).size <= 3000,
  `${fs.existsSync(fajl + ".1")} / ${fs.statSync(fajl).size}`);

// pun ili nedostupan disk ne obara server
bz.povezi({ putanja: path.join(DATA, "nema-ovog-foldera", "x", "b.jsonl") });
let palo = false;
try { bz.zabelezi({ vrsta: "bez_diska", sada: T }); } catch { palo = true; }
b.proveri("upis koji ne uspe ne baca gresku", !palo && bz.poslednjiZapisi({ vrsta: "bez_diska" }).length === 1);

bz.povezi({ najveci: 5 * 1024 * 1024, konzola: () => {} });
bz.zaboravi();

// ---- 2. pravi server ----
await podigniServer(DATA, PORT);
const api = await panelKlijent(BASE);
const dogadjaji = async (vrsta) => (await api(`/api/bezbednost?vrsta=${vrsta}&limit=100`)).body;
const DNEVNIK = path.join(DATA, "bezbednost.jsonl");
const izFajla = () => (fs.existsSync(DNEVNIK) ? fs.readFileSync(DNEVNIK, "utf8").trim().split("\n").filter(Boolean).map((r) => JSON.parse(r)) : []);

const spoji = (url, opcije) => new Promise((res) => {
  const w = new WebSocket(url, opcije);
  const poruke = [];
  let zatvoren = null;
  w.on("message", (d) => { try { poruke.push(JSON.parse(d.toString())); } catch {} });
  w.on("close", (k) => { zatvoren = k; });
  w.on("error", () => {});
  w.once("open", async () => { await cekaj(300); res({ w, poruke, zatvoren: () => zatvoren }); });
  setTimeout(() => res({ w, poruke, zatvoren: () => zatvoren }), 2000);
});

// 2a) neispravan token racunara
const LAZNI = "pc-izmisljen-0123456789";
const los = await spoji(`${WSB}/ws?kind=client&token=${LAZNI}`);
b.proveri("neispravan token racunara: veza odbijena", los.poruke.some((m) => m.t === "error"));
const tok = await dogadjaji("token_racunara_neispravan");
b.proveri("neispravan token racunara je zabelezen sa adresom", tok.some((d) => d.ip === "127.0.0.1" && d.nivo === "upozorenje"), JSON.stringify(tok[0]));
b.proveri("zapis je i u fajlu pored baze", izFajla().some((z) => z.vrsta === "token_racunara_neispravan"));
b.proveri("sam token NE stoji u dnevniku", !fs.readFileSync(DNEVNIK, "utf8").includes(LAZNI));
const kategorija = (await api("/api/logs?page=1&per=50&category=bezbednost")).body.items || [];
b.proveri("vlasnik ga vidi u Logovima (kategorija bezbednost)", kategorija.some((l) => l.action === "token_racunara_neispravan"));

// 2b) neispravan i ugasen token panela
const r401 = await fetch(BASE + "/api/computers", { headers: { authorization: "Bearer izmisljen-token" } });
b.proveri("neispravan token panela: 401", r401.status === 401);
b.proveri("neispravan token panela je zabelezen (info)", (await dogadjaji("token_panela_neispravan")).some((d) => d.nivo === "info"));
await api("/api/admins", "POST", { username: "radnik1", password: "radnik1234", role: "staff" });
const radnikToken = (await (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "radnik1", password: "radnik1234" }) })).json()).token;
const radnik = (await api("/api/admins")).body.find((a) => a.username === "radnik1");
const r403 = await fetch(BASE + "/api/bezbednost", { headers: { authorization: "Bearer " + radnikToken } });
b.proveri("radnik ne vidi bezbednosni dnevnik", r403.status === 403);
await api(`/api/admins/${radnik.id}`, "DELETE");
const ugasen = await fetch(BASE + "/api/computers", { headers: { authorization: "Bearer " + radnikToken } });
b.proveri("token ugasenog naloga ne radi", ugasen.status === 401);
b.proveri("i njegov pokusaj ostaje u dnevniku", (await dogadjaji("token_panela_neispravan")).length >= 1);

// 2c) neispravni zahtevi panela
await api("/api/players", "POST", { username: "marko", password: "marko1234", balance: 5000 });
await api("/api/players", "POST", { username: "ana", password: "ana12345", balance: 5000 });
const marko = (await api("/api/players")).body.find((p) => p.username === "marko");
const objekat = await api(`/api/players/${marko.id}/topup`, "POST", { amount: { $gt: 0 } });
b.proveri("dopuna sa objektom umesto iznosa: 400", objekat.status === 400 && typeof objekat.body.error === "string", JSON.stringify(objekat.body));
b.proveri("neispravan zahtev je zabelezen sa imenom radnika", (await dogadjaji("zahtev_neispravan")).some((d) => d.igrac === "admin"));
const abc = await api("/api/players/abc/topup", "POST", { amount: 100 });
b.proveri("slova umesto broja u adresi: 400", abc.status === 400 && /broj u adresi/.test(abc.body.error || ""), JSON.stringify(abc.body));
const komanda = await api("/api/computers/1/command", "POST", { cmd: "format c:" });
b.proveri("nepoznata komanda racunaru: 400", komanda.status === 400);
const fileLink = await api("/api/install", "POST", { name: "X", url: "file:///C:/Windows/System32/cmd.exe" });
b.proveri("instalacija sa file: linkom: 400 sa jasnom porukom", fileLink.status === 400 && /http/.test(fileLink.body.error || ""), JSON.stringify(fileLink.body));
b.proveri("stanje kredita nije dirnuto", (await api("/api/players")).body.find((p) => p.username === "marko").balance === 5000);

// 2d) protokol: smece, nepoznato, visak u porudzbini
const racunari = (await api("/api/computers")).body;
const kola = (await api("/api/shop")).body.find((i) => i.name.startsWith("Coca-Cola"));
const pc0 = await spoji(`${WSB}/ws?kind=client&token=${encodeURIComponent(racunari[0].token)}&p=2`);
const posalji = async (k, m, ms = 500) => { k.poruke.length = 0; k.w.send(typeof m === "string" ? m : JSON.stringify(m)); await cekaj(ms); };
await posalji(pc0, "ovo nije json");
b.proveri("poruka koja nije JSON je zabelezena", (await dogadjaji("poruka_neispravna")).some((d) => d.racunarId === racunari[0].id));
await posalji(pc0, { t: "daj_kredit", iznos: 1000 });
b.proveri("nepoznata poruka je zabelezena sa tipom", (await dogadjaji("poruka_nepoznata")).some((d) => d.podaci?.tip === "daj_kredit"));
await posalji(pc0, { t: "login", username: "marko", password: "marko1234" }, 700);
await posalji(pc0, { t: "order", items: [{ id: kola.id, qty: 1, price: 1 }], payment: "credit" }, 600);
const ok = pc0.poruke.find((m) => m.t === "order_ok");
b.proveri("porudzbina sa 'price' prolazi po ceni iz baze", ok?.total === kola.price, JSON.stringify(ok));
b.proveri("pokusaj nametanja cene je zabelezen", (await dogadjaji("porudzbina_visak_polja")).some((d) => d.racunarId === racunari[0].id));

// 2e) dupla naplata: isti broj pokusaja dvaput
const POID = "proba-dupla-1";
await posalji(pc0, { t: "order", items: [{ id: kola.id, qty: 1 }], payment: "credit", poId: POID }, 600);
const prvi = pc0.poruke.find((m) => m.t === "order_ok");
await cekaj(1100); // kocnica brzine za porudzbine
await posalji(pc0, { t: "order", items: [{ id: kola.id, qty: 1 }], payment: "credit", poId: POID }, 600);
const drugiOdg = pc0.poruke.find((m) => m.t === "order_ok");
b.proveri("ponovljen broj pokusaja vraca ISTU porudzbinu", prvi && drugiOdg && prvi.orderId === drugiOdg.orderId, `${prvi?.orderId} / ${drugiOdg?.orderId}`);
const dupla = await dogadjaji("dupla_naplata_sprecena");
b.proveri("sprecena dupla naplata je zabelezena sa brojem porudzbine", dupla.some((d) => d.podaci?.orderId === prvi.orderId), JSON.stringify(dupla[0]));
const kasa1 = await api("/api/pos", "POST", { items: [{ id: kola.id, qty: 1 }], payment: "cash", poId: "kasa-dupla" });
const kasa2 = await api("/api/pos", "POST", { items: [{ id: kola.id, qty: 1 }], payment: "cash", poId: "kasa-dupla" });
b.proveri("i na kasi: isti broj, isti racun", kasa1.body.orderId === kasa2.body.orderId);
b.proveri("dupla naplata na kasi je zabelezena sa imenom radnika",
  (await dogadjaji("dupla_naplata_sprecena")).some((d) => d.podaci?.orderId === kasa1.body.orderId && d.igrac === "admin"));

// 2f) tudji broj pokusaja: drugi racunar ne sme da dobije tudji odgovor
const pc1 = await spoji(`${WSB}/ws?kind=client&token=${encodeURIComponent(racunari[1].token)}&p=2`);
await posalji(pc1, { t: "login", username: "ana", password: "ana12345" }, 700);
await posalji(pc1, { t: "order", items: [{ id: kola.id, qty: 1 }], payment: "credit", poId: POID }, 600);
const tudji = pc1.poruke.find((m) => m.t === "order_ok");
b.proveri("racunar sa tudjim brojem NE dobija tudju porudzbinu", tudji && tudji.orderId !== prvi.orderId, JSON.stringify(tudji));
b.proveri("...ni tudje stanje kredita", tudji && tudji.balance !== prvi.balance);
b.proveri("tudji broj pokusaja je kritican dogadjaj",
  (await dogadjaji("porudzbina_tudji_broj")).some((d) => d.racunarId === racunari[1].id && d.nivo === "kriticno"));

// 2g) panel sa tudje strane
const tudjaStrana = await spoji(`${WSB}/ws?kind=panel&token=x`, { origin: "http://zla-strana.example" });
b.proveri("veza ka panelu sa tudje strane se odbija", tudjaStrana.zatvoren() === 1008 || tudjaStrana.poruke.some((m) => m.t === "error"));
b.proveri("i belezi", (await dogadjaji("panel_tudji_izvor")).length >= 1);
const adminToken = (await (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) })).json()).token;
const svoja = await spoji(`${WSB}/ws?kind=panel&token=${adminToken}`, { origin: BASE });
b.proveri("panel sa svoje strane radi normalno", svoja.w.readyState === 1 && svoja.poruke.length > 0, JSON.stringify(svoja.poruke.map((m) => m.t)));
svoja.w.close();

// 2h) BLOKADA adrese koja pogadja tokene (na kraju - blokira i ovu adresu)
let blokirana = false;
for (let i = 0; i < 12 && !blokirana; i++) {
  const v = await spoji(`${WSB}/ws?kind=client&token=pogadjam-${i}`);
  if (v.poruke.some((m) => /Previše/.test(m.message || ""))) blokirana = true;
  else if ((await dogadjaji("ip_blokiran")).length) blokirana = true;
}
b.proveri("posle 10 neispravnih tokena adresa je blokirana", blokirana);
b.proveri("blokada je kritican dogadjaj", (await dogadjaji("ip_blokiran")).some((d) => d.ip === "127.0.0.1" && d.nivo === "kriticno"));
const ispravan = await spoji(`${WSB}/ws?kind=client&token=${encodeURIComponent(racunari[2].token)}`);
b.proveri("dok traje blokada ne prolazi ni ispravan token sa te adrese",
  ispravan.poruke.some((m) => /Previše/.test(m.message || "")) && !ispravan.poruke.some((m) => m.t === "welcome"),
  JSON.stringify(ispravan.poruke.map((m) => m.t)));
const preuzimanje = await fetch(`${BASE}/nadogradnja/launcher.exe?token=${encodeURIComponent(racunari[2].token)}`);
b.proveri("blokada vazi i za preuzimanje launchera", preuzimanje.status === 429, String(preuzimanje.status));
b.proveri("panel (HTTP) i dalje radi - blokada je samo za token racunara", (await api("/api/computers")).status === 200);

pc0.w.close(); pc1.w.close();
await b.kraj();
