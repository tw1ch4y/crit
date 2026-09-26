import { radniFolder, podigniServer, citajIzvor, brojac } from "./_okruzenje.mjs";
// Jedna kategorija, jedna polica.
//
//   1. server sam spaja zapise koji su sigurno ista rec (veliko/malo slovo,
//      razmak, kvacica) i uzima postojeci
//   2. panel nudi postojece kategorije, jer stvarno drugaciji zapis ("Pice" i
//      "Pica") racun ne moze da razlikuje od namere
const BASE = "http://127.0.0.1:8191";
await podigniServer(radniFolder("kategorije-data"), 8191);
const { proveri, kraj } = brojac();
const svc = await import("../server/src/service.js");

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

// ---- 1) RACUN SAM PO SEBI ----
const postoji = ["Piće", "Grickalice", "Topli napici"];
proveri("isto se poklapa", svc.uskladiKategoriju("piće", postoji) === "Piće");
proveri("veliko slovo ne pravi novu", svc.uskladiKategoriju("PIĆE", postoji) === "Piće");
proveri("razmak ne pravi novu", svc.uskladiKategoriju("  Piće  ", postoji) === "Piće");
proveri("dvostruki razmak unutra ne pravi novu",
  svc.uskladiKategoriju("Topli  napici", postoji) === "Topli napici");
proveri("bez kvačice se poklapa", svc.uskladiKategoriju("pice", postoji) === "Piće",
  "ko kuca 'pice' misli 'Piće' - inace dobija svoju policu");

// STVARNO DRUGACIJA REC SE NE DIRA.
//
// "Pića" i "Piće" jesu ista stvar u glavi, ali racun to ne moze da zna, a moze
// da bude i namera (npr. "Sok" i "Soko"). Zato prolazi kako je otkucano; tu
// pomaze spisak u panelu.
proveri("druga reč prolazi kako je otkucana", svc.uskladiKategoriju("Pića", postoji) === "Pića",
  "program ne odlucuje sta sme da postoji, samo ne zapisuje istu stvar dvaput");
proveri("nova kategorija prolazi", svc.uskladiKategoriju("Slatko", postoji) === "Slatko");
proveri("prazno ostaje prazno", svc.uskladiKategoriju("   ", postoji) === "");
proveri("pokvaren ulaz ne puca",
  svc.uskladiKategoriju(null, postoji) === "" && svc.uskladiKategoriju("Piće", null) === "Piće");

// ---- 2) KROZ SERVER, KAO IZ PANELA ----
const dodaj = (n, k) => api("/api/shop", "POST", { name: n, price: 100, category: k });
await dodaj("Coca-Cola", "Piće");
await dodaj("Fanta", "pice");
await dodaj("Sprite", "  PIĆE ");
const shop = (await api("/api/shop")).body;
const nase = shop.filter((x) => ["Coca-Cola", "Fanta", "Sprite"].includes(x.name));
proveri("tri artikla su u ISTOJ kategoriji", new Set(nase.map((x) => x.category)).size === 1,
  JSON.stringify(nase.map((x) => `${x.name}: ${x.category}`)));
proveri("i to u onoj koja je prva upisana", nase.every((x) => x.category === "Piće"),
  "uzima se zapis koji je vlasnik vec video u launcheru, ne poslednji otkucani");

// Izmena ide kroz isto pravilo - inace bi se kategorija razisla tek pri prvoj ispravci.
const fanta = nase.find((x) => x.name === "Fanta");
await api(`/api/shop/${fanta.id}`, "PUT", { name: "Fanta", price: 150, category: "pIĆe" });
proveri("i izmena ide kroz isto pravilo",
  (await api("/api/shop")).body.find((x) => x.id === fanta.id)?.category === "Piće");

// Igre imaju svoje kategorije, odvojene od shopa.
await api("/api/games", "POST", { name: "CS2", path: "C:/a.exe", category: "Pucačine" });
await api("/api/games", "POST", { name: "Valorant", path: "C:/b.exe", category: "pucacine" });
const igre = (await api("/api/games")).body.filter((g) => ["CS2", "Valorant"].includes(g.name));
proveri("isto vazi i za igre", new Set(igre.map((g) => g.category)).size === 1,
  JSON.stringify(igre.map((g) => g.category)));
proveri("spisak kategorija igara ne mesa se sa shopom",
  !svc.kategorije("igre").includes("Piće") && !svc.kategorije("shop").includes("Pucačine"),
  JSON.stringify({ igre: svc.kategorije("igre"), shop: svc.kategorije("shop") }));

// ---- 3) PANEL NUDI POSTOJECE ----
const panel = citajIzvor("server/public/js/app.js");
proveri("panel nudi postojeće kategorije", /function ponudaKategorija\(/.test(panel));
proveri("ponuda stoji uz polje za shop", /id="siCat" list="siCatLista"/.test(panel));
proveri("ponuda stoji uz polje za igre", /id="giCat" list="giCatLista"/.test(panel));
proveri("polje i dalje prima novu kategoriju", !/<select id="siCat"/.test(panel),
  "spisak koji ne da da se upise nova bi ogranicio igraonicu na ono sto je zateceno");

// ---- ISTO IME ARTIKLA: PITANJE, NE ZABRANA ----
//
// Dva artikla istog imena se ne spajaju (svaki ima svoju cenu, zalihu i
// istoriju), ali panel pita pre upisa. Ime je izmisljeno jer fabricki sank vec
// nosi Coca-Colu.
const prvi = await api("/api/shop", "POST", { name: "Probni napitak 0.5", price: 130, category: "Sokovi", stock: 10 });
proveri("prvi artikal prolazi", prvi.status === 200, JSON.stringify(prvi.body));

const opet = await api("/api/shop", "POST", { name: "Probni napitak 0.5", price: 150, category: "Pica" });
proveri("isto ime se ne upisuje cutke", opet.status === 409, String(opet.status));
proveri("i kaze STA vec postoji",
  opet.body?.kod === "duplikat" && opet.body?.postojeci?.kategorija === "Sokovi",
  JSON.stringify(opet.body));

// Isto pravilo kao kod kategorija: razmak, veliko/malo slovo i kvacice.
const drugacije = await api("/api/shop", "POST", { name: "  probni napitak 0.5 ", price: 150 });
proveri("razlika u slovu i razmaku se hvata", drugacije.status === 409, String(drugacije.status));
proveri("stvarno drugo ime prolazi",
  (await api("/api/shop", "POST", { name: "Probni napitak Zero", price: 130 })).status === 200);

// Zabrana bi bila pogresna: ponekad vlasnik bas hoce dva reda.
const svejedno = await api("/api/shop", "POST", { name: "Probni napitak 0.5", price: 150, svejedno: true });
proveri("moze svejedno, kad vlasnik tako kaze", svejedno.status === 200, JSON.stringify(svejedno.body));

// Preimenovanje u tudje ime pita isto. Sam artikal se ne poredi sa sobom -
// inace se sopstveni naziv ne bi mogao ni sacuvati bez pitanja.
const spisakArtikala = (await api("/api/shop")).body;
const zero = spisakArtikala.find((x) => x.name === "Probni napitak Zero");
proveri("preimenovanje u tudje ime pita",
  (await api(`/api/shop/${zero.id}`, "PUT", { name: "Probni napitak 0.5" })).status === 409);
proveri("cuvanje SOPSTVENOG imena ne pita",
  (await api(`/api/shop/${zero.id}`, "PUT", { name: "Probni napitak Zero", price: 140 })).status === 200,
  "inace se nijedan artikal ne bi mogao izmeniti bez pitanja");

// Panel pita, a ne samo ispise gresku - i kaze sta se tacno desava.
proveri("panel nudi da svejedno sacuva", /kod !== "duplikat"/.test(panel) && /svejedno sačuvaj/i.test(panel));
proveri("i objasni posledicu", /zaliha se deli na dve strane/.test(panel),
  "gola poruka o postojanju ne kaze zasto je to lose");
proveri("greska nosi ceo odgovor servera", /e\.podaci = data;/.test(panel),
  "bez toga pozivalac vidi samo recenicu, pa ne moze da razlikuje pitanje od greske");

kraj();
