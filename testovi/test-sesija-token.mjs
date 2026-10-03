import path from "node:path";
import { pathToFileURL } from "node:url";
import { KOREN, radniFolder, podigniServer, ucitajWebSocket, panelKlijent, brojac, citajIzvor } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// TOKEN SESIJE: KO SME DA RADI U IME IGRACA
//
// Token racunara kaze samo "ja sam PC-01". Stoji u podesavanjima na samoj
// masini, pa ga ima svako ko je sedeo za njom. Do sada je to bilo dovoljno da se
// sa drugog mesta poruci na tudji kredit, zavrti tudji tocak ili odjavi tudja
// sesija.
//
// Sada u ime igraca radi samo veza na kojoj se prijavio, ili nova veza koja
// pokaze token njegove sesije - potpisan (HMAC) i vezan za sesiju, racunar i
// igraca. Ovde se proverava i sam token i ono sto on stiti.

const PORT = 8213, BASE = `http://127.0.0.1:${PORT}`, WSB = `ws://127.0.0.1:${PORT}`;
const b = brojac();
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

await podigniServer(radniFolder("sesija-token-data"), PORT);
const sesija = await import(pathToFileURL(path.join(KOREN, "server", "src", "sesija.js")).href);
const dbm = await import(pathToFileURL(path.join(KOREN, "server", "src", "db.js")).href);
const api = await panelKlijent(BASE);

await api("/api/players", "POST", { username: "marko", password: "marko1234", balance: 5000 });
await api("/api/players", "POST", { username: "ana", password: "ana12345", balance: 5000 });
const kola = (await api("/api/shop")).body.find((i) => i.name.startsWith("Coca-Cola"));
const racunari = (await api("/api/computers")).body;
const [pc0, pc1, pc2] = racunari;
const igrac = async (ime) => (await api("/api/players")).body.find((p) => p.username === ime);
const brojPorudzbina = async () => (await api("/api/orders?all=1")).body.length;
const dogadjaji = async (vrsta) => (await api(`/api/bezbednost?vrsta=${vrsta}&limit=50`)).body;
const racunar = async (id) => (await api("/api/computers")).body.find((c) => c.id === id);

const spoji = (pc, { token = null, p = 2 } = {}) => new Promise((res, rej) => {
  const url = `${WSB}/ws?kind=client&token=${encodeURIComponent(pc.token)}&v=proba&p=${p}` +
    (token ? `&sesija=${encodeURIComponent(token)}` : "");
  const w = new WebSocket(url);
  const poruke = [];
  w.on("message", (d) => { try { poruke.push(JSON.parse(d.toString())); } catch {} });
  w.on("error", () => {});
  w.once("open", async () => { await cekaj(300); res({ w, poruke }); });
  setTimeout(() => rej(new Error("veza nije otvorena")), 3000);
});
const posalji = async (k, m, ms = 500) => { k.poruke.length = 0; k.w.send(JSON.stringify(m)); await cekaj(ms); };
const zadnja = (k, t) => [...k.poruke].reverse().find((m) => m.t === t);

// ---- 1. prijava izdaje token, samo vezi koja se prijavila ----
const A = await spoji(pc0);
await posalji(A, { t: "login", username: "marko", password: "marko1234" }, 700);
const loA = zadnja(A, "login_ok");
const token = loA?.sesija;
b.proveri("prijava vraca token sesije", typeof token === "string" && /^s1\.\d+\.[A-Za-z0-9_-]{43}$/.test(token), String(token));
b.proveri("token ne nosi lozinku ni ime", !String(token).includes("marko"));
b.proveri("ostatak prijave je isti kao ranije (igrac, kredit, vreme)",
  loA?.player?.username === "marko" && loA.balance === 5000 && Number.isFinite(loA.remainingSeconds), JSON.stringify(loA).slice(0, 160));

await posalji(A, { t: "order", items: [{ id: kola.id, qty: 1 }], payment: "credit" }, 600);
b.proveri("veza koja se prijavila sme da poruci", !!zadnja(A, "order_ok"), JSON.stringify(A.poruke.map((m) => m.t)));

// ---- 2. sam token: potpis, racunar, igrac, kraj sesije ----
b.proveri("ispravan token prolazi na svom racunaru", sesija.proveriToken(token, pc0.id).ok);
b.proveri("isti token na drugom racunaru: tudji_racunar", sesija.proveriToken(token, pc1.id).razlog === "tudji_racunar");
const izmenjen = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
b.proveri("izmenjen potpis: potpis", sesija.proveriToken(izmenjen, pc0.id).razlog === "potpis");
const s = dbm.db.prepare("SELECT * FROM sessions WHERE status='active' AND computer_id=?").get(pc0.id);
const ana = await igrac("ana");
const zaDrugog = sesija.izdajToken({ ...s, player_id: ana.id });
b.proveri("token napravljen za drugog igraca (isti broj sesije) ne prolazi", sesija.proveriToken(zaDrugog, pc0.id).razlog === "potpis");
const zaDrugiRacunar = sesija.izdajToken({ ...s, computer_id: pc1.id });
b.proveri("token napravljen za drugi racunar ne prolazi", sesija.proveriToken(zaDrugiRacunar, pc0.id).razlog === "potpis");
const drugiPocetak = sesija.izdajToken({ ...s, started_at: s.started_at + 1 });
b.proveri("token vezan i za trenutak pocetka sesije", sesija.proveriToken(drugiPocetak, pc0.id).razlog === "potpis");
b.proveri("nepostojeca sesija: nepoznata", sesija.proveriToken(`s1.987654.${"A".repeat(43)}`, pc0.id).razlog === "nepoznata");
for (const [naziv, t] of [["prazno", ""], ["null", null], ["smece", "abc"], ["SQL", "s1.1 OR 1=1.x"], ["predugo", "s1.1." + "A".repeat(500)]]) {
  b.proveri(`neispravan oblik (${naziv}) se odbija bez upita`, sesija.proveriToken(t, pc0.id).razlog === "oblik");
}
const tajna = dbm.getSetting("sesija_tajna");
b.proveri("tajna je 256 bita iz kriptografskog izvora i stoji u bazi", /^[0-9a-f]{64}$/.test(String(tajna)));
sesija.zaboraviTajnu(); // kao restart servera: tajna se cita ponovo iz baze
b.proveri("token prezivi restart servera", sesija.proveriToken(token, pc0.id).ok);

// ---- 3. veza bez tokena: vidi, ali ne radi u ime igraca ----
const kreditPre = (await igrac("marko")).balance;
const porudzbinaPre = await brojPorudzbina();
const B = await spoji(pc0); // zameni vezu A, kao skripta sa ukradenim tokenom racunara
const loB = B.poruke.find((m) => m.t === "login_ok");
b.proveri("nova veza bez tokena vidi stanje (kao posle restarta)", loB?.player?.username === "marko", JSON.stringify(B.poruke.map((m) => m.t)));
b.proveri("...ali NE dobija token sesije", loB && !("sesija" in loB));
b.proveri("preuzimanje bez tokena je zabelezeno",
  (await dogadjaji("sesija_preuzeta_bez_tokena")).some((d) => d.racunarId === pc0.id && d.nivo === "upozorenje"));

await posalji(B, { t: "order", items: [{ id: kola.id, qty: 3 }], payment: "credit" });
b.proveri("porudzbina sa nepotvrdjene veze se odbija", /nije potvrđena/.test(zadnja(B, "order_err")?.message || ""), JSON.stringify(B.poruke));
await posalji(B, { t: "order", items: [{ id: kola.id, qty: 1 }], payment: "cash" });
b.proveri("ni kes porudzbina ne prolazi", !!zadnja(B, "order_err") && !zadnja(B, "order_ok"));
await posalji(B, { t: "tocak_spin" });
b.proveri("tocak sa nepotvrdjene veze se odbija", /nije potvrđena/.test(zadnja(B, "tocak_err")?.message || ""));
await posalji(B, { t: "change_password", oldPassword: "marko1234", newPassword: "preoteto" });
b.proveri("promena lozinke sa nepotvrdjene veze se odbija", !!zadnja(B, "pw_err") && !zadnja(B, "pw_ok"));
await posalji(B, { t: "moja_tekstura", kljuc: "kuca" });
b.proveri("promena pozadine sa nepotvrdjene veze se odbija", !!zadnja(B, "moja_tekstura_err"));
await posalji(B, { t: "moj_profil", boja: "bela" });
b.proveri("promena profila sa nepotvrdjene veze se odbija", !!zadnja(B, "profil_err"));
b.proveri("nijedna porudzbina nije nastala", (await brojPorudzbina()) === porudzbinaPre);
b.proveri("kredit nije dirnut (osim naplate vremena)", Math.abs((await igrac("marko")).balance - kreditPre) < 1,
  `${kreditPre} -> ${(await igrac("marko")).balance}`);
const nepotvrdjene = await dogadjaji("sesija_nepotvrdjena");
b.proveri("pokusaj porudzbine u tudje ime je kritican dogadjaj",
  nepotvrdjene.some((d) => d.podaci?.tip === "order" && d.nivo === "kriticno"), JSON.stringify(nepotvrdjene.slice(0, 2)));

// Odjava i mirovanje zavrsavaju sesiju. Launcher koji zna za tokene (p=2) ih
// salje samo sa potvrdjene veze - ovo je onda neko drugi.
await posalji(B, { t: "logout" });
b.proveri("odjava sa nepotvrdjene veze (novi launcher) se odbija", !!zadnja(B, "error") && (await racunar(pc0.id)).status === "in_use");
await posalji(B, { t: "heartbeat", mirovanje: 99999 }, 600);
b.proveri("lazno mirovanje ne odjavljuje igraca", (await racunar(pc0.id)).status === "in_use");

// ---- 4. preostalo vreme racuna samo server ----
await posalji(B, { t: "heartbeat", mirovanje: 0, remainingSeconds: 999999, balance: 999999 });
b.proveri("otkucaj sa 'preostalim vremenom' se odbija i belezi",
  (await dogadjaji("poruka_neispravna")).some((d) => d.racunarId === pc0.id && d.podaci?.tip === "heartbeat"));
const m = await igrac("marko");
const cena = (await api("/api/settings")).body.ratePerHour;
b.proveri("kredit je i dalje samo ono sto server zna", m.balance <= kreditPre, `${kreditPre} -> ${m.balance}`);
const loPonovo = (await spoji(pc0)).poruke.find((x) => x.t === "login_ok");
b.proveri("preostalo vreme = kredit / cena po satu, racunato na serveru",
  Math.abs(loPonovo.remainingSeconds - Math.floor((loPonovo.balance / cena) * 3600)) <= 1, `${loPonovo.remainingSeconds} za ${loPonovo.balance}`);

// ---- 5. nastavak sa tokenom ----
const C = await spoji(pc0, { token });
const loC = C.poruke.find((x) => x.t === "login_ok");
b.proveri("veza sa tokenom nastavlja sesiju i dobija token nazad", loC?.sesija === token, JSON.stringify(loC?.sesija));
await posalji(C, { t: "order", items: [{ id: kola.id, qty: 1 }], payment: "credit" }, 600);
b.proveri("posle nastavka porudzbina radi", !!zadnja(C, "order_ok"), JSON.stringify(C.poruke.map((x) => x.t)));

// ---- 6. tudji i lazni tokeni ----
const D = await spoji(pc1, { token });
b.proveri("token sa PC-01 na PC-02 ne daje nista", !D.poruke.some((x) => x.t === "login_ok"), JSON.stringify(D.poruke.map((x) => x.t)));
b.proveri("token sa drugog racunara je kritican dogadjaj",
  (await dogadjaji("token_sesije_tudji_racunar")).some((d) => d.racunarId === pc1.id && d.nivo === "kriticno"));
D.w.close();
const E = await spoji(pc0, { token: izmenjen });
const loE = E.poruke.find((x) => x.t === "login_ok");
b.proveri("lazan token: vidi stanje, bez tokena", !!loE && !("sesija" in loE));
b.proveri("lazan potpis je kritican dogadjaj", (await dogadjaji("token_sesije_lazan")).some((d) => d.racunarId === pc0.id && d.nivo === "kriticno"));
await posalji(E, { t: "order", items: [{ id: kola.id, qty: 1 }], payment: "credit" });
b.proveri("lazan token ne daje porudzbinu", !!zadnja(E, "order_err"));

// ---- 7. potvrda lozinkom na novoj vezi ----
await posalji(E, { t: "login", username: "marko", password: "pogresna" }, 600);
b.proveri("pogresna lozinka ne potvrdjuje sesiju", !!zadnja(E, "login_err") && !zadnja(E, "login_ok"));
b.proveri("neuspela potvrda je zabelezena", (await dogadjaji("sesija_potvrda_neuspela")).some((d) => d.racunarId === pc0.id));
const A2 = await spoji(pc1);
await posalji(A2, { t: "login", username: "ana", password: "ana12345" }, 600);
const E2 = await spoji(pc0);
await posalji(E2, { t: "login", username: "ana", password: "ana12345" }, 600);
b.proveri("ispravna lozinka DRUGOG igraca ne preuzima tudju sesiju", !zadnja(E2, "login_ok"), JSON.stringify(E2.poruke));
await posalji(E2, { t: "login", username: "marko", password: "marko1234" }, 700);
const potvrda = zadnja(E2, "login_ok");
b.proveri("lozinka igraca koji sedi potvrdjuje sesiju i daje token", potvrda?.sesija === token, JSON.stringify(potvrda?.sesija));
await posalji(E2, { t: "order", items: [{ id: kola.id, qty: 1 }], payment: "credit" }, 600);
b.proveri("posle potvrde porudzbina radi", !!zadnja(E2, "order_ok"));

// ---- 8. kraj sesije gasi token ----
await posalji(E2, { t: "logout" }, 600);
b.proveri("odjava sa potvrdjene veze radi", !!zadnja(E2, "to_login"));
b.proveri("token zavrsene sesije vise ne vazi", sesija.proveriToken(token, pc0.id).razlog === "zavrsena");
const F = await spoji(pc0, { token });
b.proveri("veza sa tokenom zavrsene sesije ide na prijavu", F.poruke.some((x) => x.t === "to_login") && !F.poruke.some((x) => x.t === "login_ok"));
const istekli = (await api("/api/bezbednost?vrsta=token_sesije_istekao")).body;
b.proveri("istekao token je samo 'info' (normalno posle odjave)", istekli.some((d) => d.nivo === "info"));
const logovi = (await api("/api/logs?page=1&per=100&category=bezbednost")).body.items || [];
b.proveri("'info' ne zatrpava Logove u panelu", !logovi.some((l) => l.action === "token_sesije_istekao"));
F.w.close();

// ---- 9. stariji launcher (bez tokena) i dalje sme da se odjavi ----
const G1 = await spoji(pc2, { p: 1 });
await posalji(G1, { t: "login", username: "marko", password: "marko1234" }, 700);
const G2 = await spoji(pc2, { p: 1 }); // stari launcher se vratio posle prekida - nema token
await posalji(G2, { t: "order", items: [{ id: kola.id, qty: 1 }], payment: "credit" });
b.proveri("stariji launcher bez potvrde ne sme da poruci", !!zadnja(G2, "order_err"));
await posalji(G2, { t: "logout" }, 600);
b.proveri("stariji launcher sme da se odjavi (inace bi igrac placao dalje)", !!zadnja(G2, "to_login") && (await racunar(pc2.id)).status !== "in_use");
G2.w.close();

// ---- 10. launcher cuva token i ne daje ga ekranu ----
const main = citajIzvor("client/main.js");
b.proveri("launcher javlja da zna za tokene (p=2)", main.includes('"&p=2"'));
b.proveri("launcher salje token pri povezivanju", /&sesija=" \+ encodeURIComponent\(sesijaToken\)/.test(main));
b.proveri("launcher pamti token iz prijave", /msg\.t === "login_ok"\) zapamtiSesiju\(msg\.sesija/.test(main));
b.proveri("launcher brise token kad sesija prestane", /"locked" \|\| msg\.t === "to_login" \|\| msg\.t === "force_logout"\) zapamtiSesiju\(null\)/.test(main));
b.proveri("ekran launchera ne dobija token", /const \{ sesija, \.\.\.zaEkran \} = msg/.test(main));
const ekran = citajIzvor("client/renderer/js/launcher.js");
b.proveri("ekran launchera nigde ne cita token", !/\.sesija\b/.test(ekran));

A2.w.close(); C.w.close(); E.w.close(); E2.w.close(); B.w.close();
await b.kraj();
