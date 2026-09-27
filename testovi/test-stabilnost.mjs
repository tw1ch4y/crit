// STABILNOST - revizija 2.48
//
// Svaka provera ovde je jedna greška nađena u reviziji, dokazana na živom
// serveru pre ispravke. Ako neka ikad ponovo padne, greška se vratila.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { KOREN, radniFolder, podigniServer, ucitajWebSocket, brojac, panelKlijent, citajIzvor } from "./_okruzenje.mjs";

const PORT = 8215;
const BASE = `http://127.0.0.1:${PORT}`;
const WSB = `ws://127.0.0.1:${PORT}`;
await podigniServer(radniFolder("stabilnost-data"), PORT);
const WebSocket = await ucitajWebSocket();
const svc = await import(pathToFileURL(path.join(KOREN, "server", "src", "service.js")).href);
const { proveri, kraj } = brojac();
const api = await panelKlijent(BASE);
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

async function racunar(token) {
  const poruke = [];
  const ws = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(token)}`);
  ws.on("message", (b) => { try { poruke.push(JSON.parse(b.toString())); } catch {} });
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  return { ws, poruke, posalji: async (m, ms = 400) => { ws.send(JSON.stringify(m)); await cekaj(ms); } };
}
const comps = (await api("/api/computers")).body;
const shop = (await api("/api/shop")).body;
const kola = shop.find((i) => i.name.startsWith("Coca-Cola"));

// ---- 1) POČETNI KREDIT JE DOPUNA ----
// Radnik uzme keš za nalog sa kreditom; obračun smene ga ranije nije video,
// pa je u kasi ostajao neobjašnjiv višak.
await api("/api/shift/open", "POST", { openingCash: 1000 });
await api("/api/players", "POST", { username: "mika", password: "mika1234", balance: 700 });
await api("/api/players/guests", "POST", { count: 2, balance: 150 });
let smena = (await api("/api/shift")).body;
proveri("početni kredit ulazi u dopune smene", smena.totals.topups === 700 + 300, JSON.stringify(smena.totals));
proveri("i u pazar", smena.totals.revenue === 1000, String(smena.totals.revenue));

// ---- 2) SMENA NE PRIMA BESMISLEN IZNOS ----
const zatv = await api("/api/shift/close", "POST", { closingCash: "abc" });
proveri("tekst kao prebrojana kasa se odbija", zatv.status === 400, JSON.stringify(zatv.body));
proveri("smena ostaje otvorena posle odbijanja", !!(await api("/api/shift")).body);
await api("/api/shift/close", "POST", { closingCash: 2000 });
const neg = await api("/api/shift/open", "POST", { openingCash: -500 });
proveri("negativno početno stanje kase se odbija", neg.status === 400, JSON.stringify(neg.body));
const ogromno = await api("/api/shift/open", "POST", { openingCash: 1e300 });
proveri("apsurdno početno stanje se odbija", ogromno.status === 400);
const prazno = await api("/api/shift/open", "POST", { openingCash: "" });
proveri("prazno početno stanje je nula", prazno.ok && prazno.shift.openingCash === 0, JSON.stringify(prazno.body));

// ---- 3) PORUDŽBINA + UKLANJANJE ARTIKLA I RAČUNARA SA ISTORIJOM ----
const igraci = (await api("/api/players")).body;
const mika = igraci.find((p) => p.username === "mika");
const k1 = await racunar(comps[0].token);
await k1.posalji({ t: "login", username: "mika", password: "mika1234" });
proveri("igrač se prijavljuje", k1.poruke.some((m) => m.t === "login_ok"));
await k1.posalji({ t: "order", items: [{ id: kola.id, qty: 1 }], payment: "credit", poId: "s1", note: { zlo: 1 } });
proveri("napomena koja nije tekst ne obara porudžbinu", k1.poruke.some((m) => m.t === "order_ok"), JSON.stringify(k1.poruke.map((m) => m.t)));
const logShop = ((await api("/api/logs?page=1&per=20")).body.items || []).find((l) => l.action === "order");
proveri("zapis porudžbine u logovima nosi iznos", logShop && logShop.amount === -kola.price, JSON.stringify(logShop));

const brisiRacunarUIgri = await api(`/api/computers/${comps[0].id}`, "DELETE");
proveri("računar za kojim se igra se ne uklanja", brisiRacunarUIgri.status === 400, JSON.stringify(brisiRacunarUIgri.body));
await api(`/api/computers/${comps[0].id}/logout`, "POST");
await cekaj(200);

const promet = (await api(`/api/stats?from=0&to=${Date.now() + 1000}`)).body;
const pre = (promet.byComputer || []).find((c) => c.name === comps[0].name);

const brisiArtikal = await api(`/api/shop/${kola.id}`, "DELETE");
proveri("prodat artikal se uklanja bez greške 500", brisiArtikal.status === 200 && brisiArtikal.arhiviran === true, JSON.stringify(brisiArtikal.body));
proveri("uklonjen artikal nestaje iz shopa", !(await api("/api/shop")).body.some((i) => i.id === kola.id));
const posUklonjen = await api("/api/pos", "POST", { items: [{ id: kola.id, qty: 1 }], payment: "cash" });
proveri("uklonjen artikal se ne može prodati ni na kasi", posUklonjen.status === 400, JSON.stringify(posUklonjen.body));

const brisiRacunar = await api(`/api/computers/${comps[0].id}`, "DELETE");
proveri("računar sa istorijom se uklanja bez greške 500", brisiRacunar.status === 200 && brisiRacunar.arhiviran === true, JSON.stringify(brisiRacunar.body));
proveri("uklonjen računar nestaje sa spiska", !(await api("/api/computers")).body.some((c) => c.id === comps[0].id));
await cekaj(200);
proveri("veza uklonjenog računara je prekinuta", k1.ws.readyState !== 1, String(k1.ws.readyState));
let odbijen = false;
try { const k = await racunar(comps[0].token); await cekaj(200); odbijen = k.poruke.some((m) => m.t === "error") || k.ws.readyState !== 1; }
catch { odbijen = true; }
proveri("stari token uklonjenog računara više ne važi", odbijen);
const posle = (await api(`/api/stats?from=0&to=${Date.now() + 1000}`)).body;
const posleR = (posle.byComputer || []).find((c) => c.name.startsWith(comps[0].name));
proveri("promet uklonjenog računara ostaje u izveštajima", !!pre && !!posleR && posleR.revenue === pre.revenue, JSON.stringify({ pre, posleR }));
const ponovo = await api("/api/computers", "POST", { name: comps[0].name });
proveri("ime uklonjenog računara je slobodno za nov", ponovo.ok === true, JSON.stringify(ponovo.body));

// ---- 4) OTKAZANA PORUDŽBINA JE ZATVORENA; XP SE VRAĆA ----
const pos = await api("/api/pos", "POST", { items: [{ id: shop[1].id, qty: 2 }], payment: "credit", playerId: mika.id });
const xpPre = (await api("/api/players")).body.find((p) => p.id === mika.id).xp;
await api(`/api/orders/${pos.orderId}/status`, "POST", { status: "cancelled" });
const xpPosle = (await api("/api/players")).body.find((p) => p.id === mika.id).xp;
proveri("otkazivanje vraća i iskustvo", xpPosle === xpPre - shop[1].price * 2, `${xpPre} -> ${xpPosle}`);
const vrati = await api(`/api/orders/${pos.orderId}/status`, "POST", { status: "pending" });
proveri("otkazana porudžbina se ne vraća u rad", vrati.status === 400, JSON.stringify(vrati.body));

// ---- 5) TOČAK: OTKAZANO NIJE POTROŠENO ----
await api("/api/tocak", "POST", { ukljucen: true, prag: 100 });
await api("/api/players", "POST", { username: "vrtilica", password: "vrti1234", balance: 1000 });
const vrtilica = (await api("/api/players")).body.find((p) => p.username === "vrtilica");
const p2 = await api("/api/pos", "POST", { items: [{ id: shop[2].id, qty: 1 }], payment: "credit", playerId: vrtilica.id });
await api(`/api/orders/${p2.orderId}/status`, "POST", { status: "cancelled" });
proveri("poruči-pa-otkaži ne puni prag točka", svc.tocakInfo(vrtilica.id).ispunjava === false, JSON.stringify(svc.tocakInfo(vrtilica.id)));

// ---- 6) BRISANJE NALOGA NE MENJA PROŠLOST ----
const k2 = await racunar(comps[1].token);
await k2.posalji({ t: "login", username: "mika", password: "mika1234" });
svc.billingTick(); await cekaj(1100); svc.billingTick();
await api(`/api/computers/${comps[1].id}/logout`, "POST");
await cekaj(200);
const statPre = (await api(`/api/stats?from=0&to=${Date.now() + 1000}`)).body;
const obrisan = await api(`/api/players/${mika.id}`, "DELETE");
proveri("nalog se briše", obrisan.ok === true, JSON.stringify(obrisan.body));
const statPosle = (await api(`/api/stats?from=0&to=${Date.now() + 1000}`)).body;
proveri("promet od vremena ostaje isti posle brisanja naloga", statPosle.revenue.session === statPre.revenue.session, `${statPre.revenue.session} -> ${statPosle.revenue.session}`);
proveri("dopune ostaju iste posle brisanja naloga", statPosle.revenue.topups === statPre.revenue.topups);
proveri("broj sesija ostaje isti", statPosle.sessions.count === statPre.sessions.count);
const spisak = (await api("/api/players")).body;
proveri("arhivski nalog se ne vidi na spisku", !spisak.some((p) => p.username.startsWith("__")));
const strana = (await api("/api/players?page=1&per=100")).body;
proveri("ni na stranici igrača", !strana.items.some((p) => p.username.startsWith("__")));
const lazni = await api("/api/players", "POST", { username: "__obrisani__", password: "x1234" });
proveri("ime arhivskog naloga se ne može zauzeti", lazni.status === 400, JSON.stringify(lazni.body));
const k3 = await racunar(comps[2].token);
await k3.posalji({ t: "login", username: "__obrisani__", password: "" });
proveri("u arhivski nalog se ne ulazi", k3.poruke.some((m) => m.t === "login_err"));

// ---- 7) PODEŠAVANJA ----
const prazanPin = await api("/api/settings", "POST", { unlockPin: "" });
proveri("prazan PIN za otključavanje se odbija", prazanPin.status === 400, JSON.stringify(prazanPin.body));
const slovaPin = await api("/api/settings", "POST", { unlockPin: "abcd" });
proveri("PIN od slova se odbija", slovaPin.status === 400);
proveri("PIN je ostao star", svc.settingsObj().unlockPin === "1234", svc.settingsObj().unlockPin);
const prazanNaziv = await api("/api/settings", "POST", { cafeName: "   " });
proveri("prazan naziv igraonice se odbija", prazanNaziv.status === 400);
const dobarPin = await api("/api/settings", "POST", { unlockPin: " 5678 " });
proveri("ispravan PIN prolazi (i razmaci se skidaju)", dobarPin.ok && svc.settingsObj().unlockPin === "5678");

// ---- 8) PORUKA NA UGAŠEN RAČUNAR ----
const ugasen = (await api("/api/computers")).body.find((c) => !c.online);
const poruka = await api(`/api/computers/${ugasen.id}/message`, "POST", { text: "zdravo" });
proveri("poruka na ugašen računar ne javlja uspeh", poruka.status === 400, JSON.stringify(poruka.body));
const praznaPoruka = await api(`/api/computers/${comps[2].id}/message`, "POST", { text: "  " });
proveri("prazna poruka se odbija", praznaPoruka.status === 400);

// ---- 9) ZAMENJENA VEZA NE BRIŠE NOVU ----
// Launcher se poveže ponovo pre nego što server primeti da je prva veza pukla.
const staraVeza = await racunar(comps[3].token);
const novaVeza = await racunar(comps[3].token);
await cekaj(400);
const snap = (await api("/api/snapshot")).body.computers.find((c) => c.id === comps[3].id);
proveri("posle zamene veze računar je i dalje povezan", snap.online === true && !!snap.connectedAt, JSON.stringify({ online: snap.online, od: snap.connectedAt }));
void staraVeza; void novaVeza;

// ---- 10) IZVOR: novac i log u istom poslu; launcher razlikuje povratak veze ----
const srv = citajIzvor("server/src/service.js");
proveri("log porudžbine je u poslu sa novcem", /zapis = upisiLog\(\{ category: "shop", action: "order"/.test(srv));
proveri("log kase je u poslu sa novcem", /zapis = upisiLog\(\{ category: "shop", action: "pos"/.test(srv));
proveri("jedna sesija koja pukne ne zaustavlja naplatu ostalih", /try \{ naplatiSesiju\(s, r, now\); \}/.test(srv));
const main = citajIzvor("client/main.js");
proveri("launcher ne snima 'stanje pre sesije' pri povratku veze", /const nova = !sesijaAktivna \|\| sesijaId !== trenutnaSesija;/.test(main));
proveri("to_login bez sesije ne briše tragove", /if \(biloJe \|\| msg\.t === "locked"\) zavrsiSesiju\(\);/.test(main));
proveri("ime instalacije ne izlazi iz fascikle", /base = base\.replace\(\/\[\^\\w\.\\-\]\/g, "_"\)/.test(main));
const rend = citajIzvor("client/renderer/js/launcher.js");
proveri("ekran launchera ne ponavlja pozdrav pri povratku veze", /const istaSesija = !!S\.player && S\.sesijaId != null/.test(rend));
const app = citajIzvor("server/public/js/app.js");
proveri("strana koja ne može da se učita to kaže", /Strana nije mogla da se učita/.test(app));

for (const k of [k1, k2, k3, staraVeza, novaVeza]) { try { k.ws.close(); } catch {} }
await kraj();
