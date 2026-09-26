import { radniFolder, podigniServer, ucitajWebSocket, citajIzvor } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// Znak i boja se podešavaju po igraonici, iz panela.
//
// Proverava se da izmena stigne do launchera i da ne dira boje sa znacenjem
// (zelena "ima kredita", zlatna "nagrada").
const BASE = "http://127.0.0.1:8177", WSB = "ws://127.0.0.1:8177";
await podigniServer(radniFolder("brend-data"), 8177);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b, t = token) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + t },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const x = await r.text(); let j; try { j = JSON.parse(x); } catch { j = x; } return { status: r.status, body: j }; });

// ---- 1) fabricko stanje ----
let b = (await api("/api/brend")).body;
// Fabricka boja je plava sa znaka (vidi banner.js).
proveri("nova igraonica krece od fabricke boje", b.akcenat === "#2f6ae8", b.akcenat);
proveri("nema svog znaka dok ga ne okaci", b.logo === null, String(b.logo));
proveri("iz jedne boje se izvode sve nijanse",
  !!b.hover && !!b.down && !!b.soft && !!b.line && !!b.rgb, JSON.stringify(b));

// ---- 2) BOJA SE MENJA I NIJANSE PRATE ----
// Vlasnik bira JEDNU boju; traziti od njega pet je isto sto i ne dati mu izbor.
const PLAVA = "#2f7de0";
let r = await api("/api/brend/boja", "POST", { akcenat: PLAVA });
proveri("boja se menja", r.status === 200 && r.body.akcenat === PLAVA, JSON.stringify(r.body));
proveri("svetlija nijansa je stvarno svetlija", r.body.hover > PLAVA, `${r.body.hover} vs ${PLAVA}`);
proveri("tamnija nijansa je stvarno tamnija", r.body.down < PLAVA, `${r.body.down} vs ${PLAVA}`);
proveri("prozirna nijansa nosi istu boju", r.body.soft.includes("47, 125, 224"), r.body.soft);

for (const loše of ["plava", "#12345", "e23b34", "", "#gggggg", "rgb(1,2,3)"]) {
  proveri(`neispravna boja se odbija: ${JSON.stringify(loše)}`,
    (await api("/api/brend/boja", "POST", { akcenat: loše })).status === 400);
}
proveri("posle odbijanja stoji poslednja ispravna", (await api("/api/brend")).body.akcenat === PLAVA);

// ---- 3) IZGLED STIZE DO LAUNCHERA ----
// Vlasnik menja boju u panelu, a gleda u svojih trinaest ekrana - promena mora
// da se vidi bez obilaska masina.
const pc = (await api("/api/computers")).body[0];
const ws = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(pc.token)}`);
const poruke = [];
ws.on("message", (d) => { try { poruke.push(JSON.parse(d.toString())); } catch {} });
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
await cekaj(700);

const welcome = poruke.find((m) => m.t === "welcome");
proveri("launcher dobija brend odmah pri povezivanju", !!welcome?.brend, JSON.stringify(welcome?.brend));
proveri("...sa vec izabranom bojom", welcome?.brend?.akcenat === PLAVA, welcome?.brend?.akcenat);

poruke.length = 0;
await api("/api/brend/boja", "POST", { akcenat: "#22aa66" });
await cekaj(500);
const push = poruke.find((m) => m.t === "brend");
proveri("izmena stize na vec povezan launcher", push?.brend?.akcenat === "#22aa66",
  "inace bi vlasnik menjao boju pa obilazio masine da vidi sta je dobio");

// ---- 4) ZNAK ----
// 1x1 providan PNG - dovoljan da se proveri put od panela do fajla.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
r = await api("/api/brend/logo", "POST", { image: PNG });
proveri("znak se prima", r.status === 200 && /^\/uploads\/logo-/.test(r.body.logo || ""), JSON.stringify(r.body.logo));
const putanja = r.body.logo;
proveri("znak se stvarno servira", (await fetch(BASE + putanja)).status === 200);
proveri("neispravan fajl se odbija", (await api("/api/brend/logo", "POST", { image: "data:text/html;base64,PGI+" })).status === 400);

poruke.length = 0;
await api("/api/brend/logo", "DELETE");
await cekaj(400);
proveri("uklonjen znak vraca ugradjeni", (await api("/api/brend")).body.logo === null);
proveri("i to stize do launchera", poruke.some((m) => m.t === "brend" && m.brend.logo === null));

// ---- 5) radnik ne menja izgled ----
await api("/api/admins", "POST", { username: "radnik", password: "radnik123", role: "staff" });
const rt = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "radnik", password: "radnik123" }) }).then((x) => x.json())).token;
proveri("radnik ne menja boju", (await api("/api/brend/boja", "POST", { akcenat: "#000000" }, rt)).status === 403);
proveri("radnik ne menja znak", (await api("/api/brend/logo", "DELETE", null, rt)).status === 403);
proveri("...ali sme da ga vidi", (await api("/api/brend", "GET", null, rt)).status === 200,
  "panel iz njega uzima znak i boju, pa mu treba i radniku");

// ---- 6) ZNACENJA SE NE BOJE ----
// Zelena je "ima kredita", zlatna je "nagrada", crvena u launcheru je "istice
// vreme". Kad bi se sve to vezalo za boju kuce, igraonica sa zelenim logom bi
// imala zeleno upozorenje - a to vise nista ne znaci.
const rend = citajIzvor("client/renderer/js/launcher.js");
proveri("launcher menja samo boju kuce", /s\.setProperty\("--brend", b\.akcenat\)/.test(rend));
// Odsjaji i senke se pisu kao rgba(var(--brend-rgb), x). Dok je boja stajala
// upisana u CSS-u, izbor vlasnika je menjao samo pola ekrana.
proveri("i odsjaji prate boju kuce", /setProperty\("--brend-rgb", b\.rgb\)/.test(rend),
  "inace bi senke i traka za pomeranje ostale u fabrickoj boji");
proveri("zelena i zlatna se ne diraju",
  !/setProperty\("--(green|gold)/.test(rend),
  "zelena znaci 'ima kredita', zlatna 'nagrada' - to su znacenja, ne ukras");

const app = citajIzvor("server/public/js/app.js");
proveri("panel primenjuje brend bez osvezavanja strane", /function primeniBrend\(b\)/.test(app));
proveri("brend stize i kroz snapshot i kroz zivu poruku",
  /primeniBrend\(d\.brend\)/.test(app) && /m\.t === "brend"\) primeniBrend/.test(app));
// Znak se okacuje, boja se bira sa spiska. Sistemski birac boje je ostao, ali
// sklopljen pod "Svoja boja" - zato se ovde vise ne trazi on, nego spisak i
// dugme za primenu. Sta taj izbor mora da radi cuva test-boja-kuce.mjs.
proveri("panel ima gde da se okaci znak", /id="brendFile"/.test(app));
proveri("panel ima gde da se izabere boja", /data-bk="/.test(app) && /id="bkPrimeni"/.test(app));

ws.close();
console.log(`\n${prosao}/${prosao + pao} proslo`);
await cekaj(300);
process.exit(pao ? 1 : 0);
