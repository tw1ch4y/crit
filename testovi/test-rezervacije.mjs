// REZERVACIJE RACUNARA
//
// Sta se ovde cuva:
//  - dva termina se na istom racunaru ne preklapaju, i grupa se upisuje cela
//    ili nikako (pola grupe na rezervaciji je gore od nijedne)
//  - pred termin se za racunar ne prijavljuje niko drugi, a onaj na koga glasi
//    se prijavljuje normalno
//  - gost bez naloga ceka da osoblje klikne "Stigli"
//  - ko ne dodje, termin se sam oslobodi
//  - ko vec sedi za racunarom kad termin pocne NE izbacuje se - dobija poruku
//  - kartica racunara u panelu zna za termin
import path from "node:path";
import { pathToFileURL } from "node:url";
import { KOREN, radniFolder, podigniServer, ucitajWebSocket, brojac, panelKlijent } from "./_okruzenje.mjs";

const PORT = 8211;
const BASE = `http://127.0.0.1:${PORT}`;
const WSB = `ws://127.0.0.1:${PORT}`;
await podigniServer(radniFolder("rezervacije-data"), PORT);
const WebSocket = await ucitajWebSocket();
// Isti primerak modula kao u serveru koji je gore podignut - da se vreme moze
// pomeriti unapred bez cekanja 20 minuta.
const svc = await import(pathToFileURL(path.join(KOREN, "server", "src", "service.js")).href);
const { proveri, kraj } = brojac();
const api = await panelKlijent(BASE);
const MIN = 60000;

const comps = (await api("/api/computers")).body;
const [pc1, pc2, pc3, pc4] = comps;
await api("/api/players", "POST", { username: "vlasnik-termina", password: "lozinka1", balance: 500 });
await api("/api/players", "POST", { username: "uljez", password: "lozinka2", balance: 500 });
await api("/api/players", "POST", { username: "sedi-vec", password: "lozinka3", balance: 500 });
const igraci = (await api("/api/players")).body;
const idOd = (u) => igraci.find((p) => p.username === u).id;

// Racunar preko prave WebSocket veze, isto kao launcher.
async function racunar(pc) {
  const poruke = [];
  const ws = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(pc.token)}`);
  ws.on("message", (b) => { try { poruke.push(JSON.parse(b.toString())); } catch {} });
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  const prijava = async (username, password) => {
    poruke.length = 0;
    ws.send(JSON.stringify({ t: "login", username, password }));
    await new Promise((r) => setTimeout(r, 500));
    return poruke.find((m) => m.t === "login_ok" || m.t === "login_err") || null;
  };
  return { ws, poruke, prijava };
}

// ---- 1) upis i provera unosa ----
const sad = Date.now();
const r1 = await api("/api/rezervacije", "POST", {
  computerIds: [pc1.id], playerId: idOd("vlasnik-termina"), pocetak: sad + 5 * MIN, trajanjeMin: 60,
});
proveri("rezervacija na nalog se upisuje", r1.ok === true, JSON.stringify(r1.body));
proveri("ime se uzima sa naloga kad nije upisano", r1.ime === "vlasnik-termina", r1.ime);
proveri("pocetak se zaokruzuje na minut", r1.pocetak % MIN === 0, String(r1.pocetak));

const sudar = await api("/api/rezervacije", "POST", {
  computerIds: [pc2.id, pc1.id], ime: "Grupa", pocetak: sad + 30 * MIN, trajanjeMin: 60,
});
proveri("preklapanje na istom racunaru se odbija", sudar.status === 400 && /PC/.test(sudar.error || ""), JSON.stringify(sudar.body));
const naPc2 = (await api("/api/rezervacije")).body.filter((r) => r.computerId === pc2.id);
proveri("odbijena grupa ne ostavlja pola upisa", naPc2.length === 0, JSON.stringify(naPc2));

const odmahPosle = await api("/api/rezervacije", "POST", {
  computerIds: [pc1.id], ime: "Odmah posle", pocetak: r1.kraj, trajanjeMin: 30,
});
proveri("termin koji pocinje tacno kad prethodni zavrsi je dozvoljen", odmahPosle.ok === true, JSON.stringify(odmahPosle.body));

for (const [naziv, telo] of [
  ["bez racunara", { computerIds: [], ime: "x", pocetak: sad + 3600000, trajanjeMin: 60 }],
  ["bez imena i naloga", { computerIds: [pc3.id], ime: "  ", pocetak: sad + 3600000, trajanjeMin: 60 }],
  ["prekratko", { computerIds: [pc3.id], ime: "x", pocetak: sad + 3600000, trajanjeMin: 5 }],
  ["predugo", { computerIds: [pc3.id], ime: "x", pocetak: sad + 3600000, trajanjeMin: 13 * 60 }],
  ["u proslosti", { computerIds: [pc3.id], ime: "x", pocetak: sad - 3600000, trajanjeMin: 60 }],
  ["tekst umesto vremena", { computerIds: [pc3.id], ime: "x", pocetak: "sutra", trajanjeMin: 60 }],
  ["nepostojeci racunar", { computerIds: [999999], ime: "x", pocetak: sad + 3600000, trajanjeMin: 60 }],
]) {
  const r = await api("/api/rezervacije", "POST", telo);
  proveri(`odbija se: ${naziv}`, r.status === 400, JSON.stringify(r.body));
}

// ---- 2) zastita prijave ----
const k1 = await racunar(pc1);
const uljez = await k1.prijava("uljez", "lozinka2");
proveri("drugi igrac ne moze da sedne pred tudj termin", uljez?.t === "login_err" && /rezervisan/i.test(uljez.message), JSON.stringify(uljez));
const pravi = await k1.prijava("vlasnik-termina", "lozinka1");
proveri("onaj na koga glasi se prijavljuje normalno", pravi?.t === "login_ok", JSON.stringify(pravi));
const posle = (await api("/api/rezervacije")).body.find((r) => r.id === r1.ids[0]);
proveri("prijava vlasnika termina oznacava da je stigao", posle?.status === "stigao", posle?.status);

// ---- 3) gost bez naloga ceka osoblje ----
const g = await api("/api/rezervacije", "POST", {
  computerIds: [pc2.id, pc3.id], ime: "Rodjendan", telefon: "064 111", pocetak: sad + 10 * MIN, trajanjeMin: 90,
});
proveri("grupa se upisuje za sve racunare odjednom", g.ok && g.ids.length === 2 && !!g.grupa, JSON.stringify(g.body));
const k2 = await racunar(pc2);
const pre = await k2.prijava("uljez", "lozinka2");
proveri("pre dolaska gosta racunar je zatvoren i za stalne igrace", pre?.t === "login_err", JSON.stringify(pre));

const snap = (await api("/api/snapshot")).body.computers.find((c) => c.id === pc2.id);
proveri("kartica racunara zna za termin", snap?.rezervacija?.ime === "Rodjendan", JSON.stringify(snap?.rezervacija));

const st = await api(`/api/rezervacije/${g.ids[0]}/stigli`, "POST", { grupa: true });
proveri("'Stigli' vazi za celu grupu", st.ok && st.broj === 2, JSON.stringify(st.body));
const posleStigli = await k2.prijava("uljez", "lozinka2");
proveri("posle 'Stigli' se gost prijavljuje", posleStigli?.t === "login_ok", JSON.stringify(posleStigli));
const opet = await api(`/api/rezervacije/${g.ids[0]}/stigli`, "POST", { grupa: true });
proveri("dvaput 'Stigli' se odbija", opet.status === 400, JSON.stringify(opet.body));

// ---- 4) ko ne dodje, termin se sam oslobadja ----
const nd = await api("/api/rezervacije", "POST", {
  computerIds: [pc4.id], ime: "Nece doci", pocetak: sad + 2 * MIN, trajanjeMin: 120,
});
svc.rezervacijeTick(sad + 2 * MIN + 10 * MIN);
let ndR = (await api("/api/rezervacije")).body.find((r) => r.id === nd.ids[0]);
proveri("10 min posle pocetka termin i dalje ceka", ndR?.status === "aktivna", ndR?.status);
svc.rezervacijeTick(sad + 2 * MIN + 21 * MIN);
ndR = (await api("/api/rezervacije")).body.find((r) => r.id === nd.ids[0]);
proveri("posle 20 min bez dolaska termin se sam oslobadja", ndR?.status === "nije_dosao", ndR?.status);
const logovi = (await api("/api/logs?page=1&per=50")).body.items || [];
proveri("oslobadjanje je upisano u logove", logovi.some((l) => l.action === "rez_nije_dosao"), JSON.stringify(logovi.slice(0, 3)));

// ---- 5) ko vec sedi, ne izbacuje se, nego dobija poruku ----
const pc5 = comps[4];
const k5 = await racunar(pc5);
const sedi = await k5.prijava("sedi-vec", "lozinka3");
proveri("igrac sedi za racunarom pre nego sto je termin upisan", sedi?.t === "login_ok", JSON.stringify(sedi));
const kasni = await api("/api/rezervacije", "POST", {
  computerIds: [pc5.id], ime: "Dolazi uskoro", pocetak: sad + 30 * MIN, trajanjeMin: 60,
});
proveri("termin se moze upisati i na zauzet racunar", kasni.ok === true, JSON.stringify(kasni.body));
k5.poruke.length = 0;
svc.rezervacijeTick(sad + 30 * MIN - 8 * MIN);
await new Promise((r) => setTimeout(r, 300));
const poruka = k5.poruke.find((m) => m.t === "message");
proveri("igrac za racunarom dobija poruku pred tudj termin", !!poruka && /rezervisan/i.test(poruka.text), JSON.stringify(k5.poruke));
const i5 = (await api("/api/snapshot")).body.computers.find((c) => c.id === pc5.id);
proveri("igrac NIJE izbacen", i5?.player?.username === "sedi-vec", JSON.stringify(i5?.player));
k5.poruke.length = 0;
svc.rezervacijeTick(sad + 30 * MIN - 7 * MIN);
await new Promise((r) => setTimeout(r, 300));
proveri("poruka se salje samo jednom", !k5.poruke.some((m) => m.t === "message"), JSON.stringify(k5.poruke));

// ---- 6) izmena i otkazivanje ----
const iz = await api(`/api/rezervacije/${kasni.ids[0]}`, "PUT", { pocetak: sad + 3 * 3600000, trajanjeMin: 45, ime: "Pomereno" });
proveri("termin se pomera", iz.ok && iz.rezervacija.ime === "Pomereno" && iz.rezervacija.kraj - iz.rezervacija.pocetak === 45 * MIN, JSON.stringify(iz.body));
const izSudar = await api(`/api/rezervacije/${odmahPosle.ids[0]}`, "PUT", { pocetak: r1.pocetak, trajanjeMin: 30 });
proveri("izmena ne sme da napravi preklapanje", izSudar.status === 400, JSON.stringify(izSudar.body));
const ot = await api(`/api/rezervacije/${kasni.ids[0]}/otkazi`, "POST", {});
proveri("otkazivanje radi", ot.ok === true, JSON.stringify(ot.body));
const ot2 = await api(`/api/rezervacije/${kasni.ids[0]}/otkazi`, "POST", {});
proveri("otkazana se ne otkazuje ponovo", ot2.status === 400, JSON.stringify(ot2.body));
const slobodno = await api("/api/rezervacije", "POST", {
  computerIds: [pc5.id], ime: "Na mesto otkazanog", pocetak: sad + 3 * 3600000, trajanjeMin: 45,
});
proveri("otkazan termin oslobadja mesto", slobodno.ok === true, JSON.stringify(slobodno.body));

// ---- 7) radnik sme da upisuje (telefon zvoni za kasom) ----
await api("/api/admins", "POST", { username: "radnik-rez", password: "radnik123", role: "staff" });
const tr = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "radnik-rez", password: "radnik123" }) }).then((r) => r.json());
const odRadnika = await fetch(BASE + "/api/rezervacije", { method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer " + tr.token },
  body: JSON.stringify({ computerIds: [comps[6].id], ime: "Sa kase", pocetak: sad + 5 * 3600000, trajanjeMin: 60 }) }).then((r) => r.json());
proveri("radnik moze da upise rezervaciju", odRadnika.ok === true, JSON.stringify(odRadnika));
const bezTokena = await fetch(BASE + "/api/rezervacije").then((r) => r.status);
proveri("bez prijave nema spiska", bezTokena === 401, String(bezTokena));

// ---- 8) HTML u imenu ne prolazi kao HTML ----
const x = await api("/api/rezervacije", "POST", {
  computerIds: [comps[7].id], ime: "<img src=x onerror=alert(1)>", pocetak: sad + 6 * 3600000, trajanjeMin: 60,
});
proveri("ime se cuva kao tekst (panel ga bezi pri prikazu)", x.ok && x.ime.startsWith("<img"), JSON.stringify(x.body));

for (const k of [k1, k2, k5]) k.ws.close();
await kraj();
