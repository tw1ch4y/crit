import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { radniFolder, podigniServer, ucitajWebSocket, brojac } from "./_okruzenje.mjs";
import { DOSTIGNUCA, stepenZa, nizNedelja } from "../server/src/nivoi.js";
const WebSocket = await ucitajWebSocket();
// DOSTIGNUCA I NIZ NEDELJA
//
// Nivo meri potrosnju; dostignuca mere dolaske. Ovde se proverava ono sto
// igraca vraca u igraonicu, i ono sto bi ga oteralo kad bi puklo:
//
//   - stepen se javlja ODMAH, dok igrac sedi (ne sledeci put)
//   - ista cestitka ne stize dvaput
//   - osvojen stepen NE NESTAJE kad odrzavanje obrise stara pokretanja igara
//   - niz nedelja ne puca usred nedelje, i ne gubi nedelju zbog pomeranja sata
const PORT = 8231;
const BASE = `http://127.0.0.1:${PORT}`, WSB = `ws://127.0.0.1:${PORT}`;
const DATA = radniFolder("dostignuca-data");
await podigniServer(DATA, PORT);
const { proveri, kraj } = brojac();
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;

// ---- 1) pravila, bez servera ----
const D = 86400000;
const sreda = new Date(2026, 8, 30, 15).getTime();
proveri("stepen raste sa vrednoscu", stepenZa(DOSTIGNUCA[0], 0) === 0 && stepenZa(DOSTIGNUCA[0], 1) === 1 && stepenZa(DOSTIGNUCA[0], 9999) === 4);
proveri("pokvarena vrednost je nula stepeni", stepenZa(DOSTIGNUCA[0], "abc") === 0 && stepenZa(DOSTIGNUCA[0], null) === 0);
proveri("svako dostignuce ima stepene koji rastu",
  DOSTIGNUCA.every((d) => d.stepeni.length >= 3 && d.stepeni.every((s, i) => i === 0 || s > d.stepeni[i - 1])));
proveri("dostignuca imaju razlicite kljuceve", new Set(DOSTIGNUCA.map((d) => d.kljuc)).size === DOSTIGNUCA.length);
{
  const n = nizNedelja([sreda - D, sreda - 8 * D, sreda - 15 * D], sreda);
  proveri("tri nedelje zaredom daju niz 3", n.niz === 3 && n.ovaNedelja, J(n));
  const bezOve = nizNedelja([sreda - 8 * D, sreda - 15 * D], sreda);
  proveri("NIZ NE PUCA USRED NEDELJE", bezOve.niz === 2 && !bezOve.ovaNedelja,
    "ko je bio prosle nedelje ima rok do nedelje uvece - " + J(bezOve));
  const rupa = nizNedelja([sreda - 15 * D, sreda - 22 * D], sreda);
  proveri("preskocena nedelja prekida niz", rupa.niz === 0 && rupa.najduzi === 2, J(rupa));
  // Pomeranje sata (29. mart 2026): nedelja od 23. do 29. marta ima 167 sati.
  const leto = nizNedelja([new Date(2026, 2, 23, 12).getTime(), new Date(2026, 2, 30, 12).getTime(), new Date(2026, 3, 6, 12).getTime()],
    new Date(2026, 3, 8, 12).getTime());
  proveri("POMERANJE SATA NE BRISE NEDELJU", leto.niz === 3 && leto.najduzi === 3, J(leto));
  const vise = nizNedelja([sreda, sreda - D, sreda - 2 * D], sreda);
  proveri("vise dolazaka u istoj nedelji je jedna nedelja", vise.niz === 1, J(vise));
  proveri("traka poslednjih nedelja ima 12 polja, danas na kraju", n.poslednje.length === 12 && n.poslednje[11] === true);
  proveri("smece u vremenima se preskace", nizNedelja([null, "x", -5, NaN], sreda).najduzi === 0);
}

// ---- 2) na serveru ----
const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: J({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? J(b) : undefined }).then((r) => r.json());

await api("/api/shift/open", "POST", { openingCash: 0 });
const igrac = await api("/api/players", "POST", { username: "mika", password: "mika1234", balance: 5000 });
const igre = [];
for (const ime of ["Counter-Strike 2", "Valorant", "Fortnite"]) igre.push(await api("/api/games", "POST", { name: ime, path: "C:\\igre\\" + ime + ".exe" }));
const pc = (await api("/api/computers"))[0];

// Istorija stalnog gosta: devet nedelja zaredom, dva dolaska posle 22h, i
// dovoljno potrosenog vremena za pet sati.
{
  const db = new DatabaseSync(path.join(DATA, "crit.db"));
  const sad = Date.now();
  const ins = db.prepare("INSERT INTO sessions (player_id, computer_id, started_at, ended_at, cost, status) VALUES (?,?,?,?,?, 'ended')");
  for (let i = 1; i <= 9; i++) {
    const d = new Date(sad - i * 7 * D);
    if (i <= 2) d.setHours(23, 10, 0, 0); else d.setHours(16, 0, 0, 0);
    ins.run(igrac.id, pc.id, d.getTime(), d.getTime() + 7200000, 240);
  }
  db.close();
}

const poruke = [];
const w = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(pc.token)}`);
w.on("message", (b) => { try { poruke.push(JSON.parse(b.toString())); } catch {} });
await new Promise((res, rej) => { w.once("open", res); w.once("error", rej); });
const prijavi = async () => {
  poruke.length = 0;
  w.send(J({ t: "login", username: "mika", password: "mika1234" }));
  await cekaj(800);
  return poruke.find((m) => m.t === "login_ok");
};
const odjavi = async () => { await api(`/api/computers/${pc.id}/logout`, "POST"); await cekaj(400); };

const prijava = await prijavi();
const pf = prijava?.profil;
proveri("profil nosi dostignuca", Array.isArray(pf?.dostignuca) && pf.dostignuca.length === DOSTIGNUCA.length, J(Object.keys(pf || {})));
proveri("profil nosi niz nedelja", pf?.niz && Number.isFinite(pf.niz.nedelja) && Array.isArray(pf.niz.poslednje), J(pf?.niz));
proveri("danasnji dolazak se racuna u niz", pf?.niz?.nedelja === 10 && pf?.niz?.ovaNedelja === true, J(pf?.niz));
const dd = (k, izvor = pf) => izvor?.dostignuca?.find((x) => x.kljuc === k);
proveri("dolasci se broje sa danasnjim", dd("dolasci")?.vrednost === 10, J(dd("dolasci")));
proveri("sati se racunaju iz potrosnje", dd("sati")?.vrednost === 18, J(dd("sati")));
// Danasnji dolazak je i sam nocni ako se test pusta posle 22h.
const sadNoc = (() => { const h = new Date().getHours(); return h >= 22 || h < 4; })();
proveri("nocni dolasci se prepoznaju", dd("noc")?.vrednost === 2 + (sadNoc ? 1 : 0), J(dd("noc")));
proveri("uz stepen ide i sledeci cilj", dd("dolasci")?.stepen === 2 && dd("dolasci")?.sledeci === 50, J(dd("dolasci")));

const javljeno = poruke.find((m) => m.t === "dostignuce");
proveri("OSVOJENO SE JAVLJA ODMAH PO PRIJAVI", !!javljeno, J(poruke.map((m) => m.t)));
proveri("javljeni su svi novi stepeni", ["dolasci", "sati", "niz", "noc"].every((k) => javljeno?.nova?.some((n) => n.kljuc === k)),
  J(javljeno?.nova));
proveri("uz cestitku stize i osvezen spisak", Array.isArray(javljeno?.dostignuca) && !!javljeno?.niz);

// Pokretanje igara: tri razlicite daju prvi stepen Istrazivaca.
poruke.length = 0;
for (const g of igre) { w.send(J({ t: "game_start", gameId: g.id })); await cekaj(150); }
await cekaj(400);
const istrazivac = poruke.filter((m) => m.t === "dostignuce").flatMap((m) => m.nova);
proveri("treca razlicita igra donosi Istrazivaca", istrazivac.some((n) => n.kljuc === "igre" && n.stepen === 1), J(istrazivac));
proveri("stepen se javlja jednom, ne na svaku igru", istrazivac.filter((n) => n.kljuc === "igre").length === 1, J(istrazivac));

// Porudzbina iz shopa - Gurman.
poruke.length = 0;
const pice = (await api("/api/shop")).find((x) => x.price > 0 && x.available !== 0);
w.send(J({ t: "order", items: [{ id: pice.id, qty: 1 }], payment: "credit" }));
await cekaj(700);
proveri("prva porudzbina donosi Gurmana",
  poruke.some((m) => m.t === "dostignuce" && m.nova.some((n) => n.kljuc === "porudzbine")), J(poruke.map((m) => m.t)));

// ---- 3) ISTA CESTITKA NE STIZE DVAPUT ----
await odjavi();
await prijavi();
proveri("ponovna prijava ne ponavlja cestitke", !poruke.some((m) => m.t === "dostignuce"), J(poruke.filter((m) => m.t === "dostignuce")));

// ---- 4) OSVOJENO NE NESTAJE ----
// Odrzavanje brise stara pokretanja igara. Istrazivac je zaradjen i ostaje.
{
  const db = new DatabaseSync(path.join(DATA, "crit.db"));
  db.exec("DELETE FROM game_launches");
  db.close();
}
await odjavi();
const posle = await prijavi();
proveri("OSVOJEN STEPEN OSTAJE POSLE CISCENJA BAZE", dd("igre", posle?.profil)?.vrednost === 3 && dd("igre", posle?.profil)?.stepen === 1,
  J(dd("igre", posle?.profil)));
proveri("i ne javlja se kao nov", !poruke.some((m) => m.t === "dostignuce" && m.nova.some((n) => n.kljuc === "igre")));

// ---- 5) pokvaren zapis ne obara prijavu ----
{
  const db = new DatabaseSync(path.join(DATA, "crit.db"));
  db.prepare("UPDATE players SET dostignuca=? WHERE id=?").run("{ovo nije json", igrac.id);
  db.close();
}
await odjavi();
const pokvareno = await prijavi();
proveri("pokvaren zapis dostignuca ne obara prijavu", !!pokvareno && Array.isArray(pokvareno.profil?.dostignuca),
  J(poruke.map((m) => m.t)));

w.close();
await cekaj(200);
kraj();
