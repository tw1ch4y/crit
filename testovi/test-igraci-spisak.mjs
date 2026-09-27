// SPISAK IGRACA: redosled i filteri
//
// Osoblje trazi "ko ima kredita", "ko je skoro bio", "koji su blokirani".
// Filter i redosled idu kroz SQL, pa se ovde cuva i da nepoznata vrednost ne
// moze da udje u upit - pada na podrazumevano.
import { radniFolder, podigniServer, brojac, panelKlijent } from "./_okruzenje.mjs";

const PORT = 8213;
const BASE = `http://127.0.0.1:${PORT}`;
await podigniServer(radniFolder("igraci-spisak-data"), PORT);
const { proveri, kraj } = brojac();
const api = await panelKlijent(BASE);

for (const [u, kredit] of [["ana", 0], ["bojan", 900], ["ceca", 300], ["dule", 50]]) {
  await api("/api/players", "POST", { username: u, password: "lozinka1", balance: kredit });
}
await api("/api/players/guests", "POST", { count: 2, balance: 100 });
const svi = (await api("/api/players")).body;
await api(`/api/players/${svi.find((p) => p.username === "dule").id}/ban`, "POST", { banned: true });

const strana = async (q) => (await api(`/api/players?page=1&per=50&${q}`)).body;
const imena = (d) => d.items.map((p) => p.username);

const poImenu = await strana("sort=ime");
proveri("podrazumevano po imenu", imena(poImenu)[0] === "ana", imena(poImenu).join(","));
const poKreditu = await strana("sort=kredit");
proveri("po kreditu - najvise prvo", imena(poKreditu)[0] === "bojan", imena(poKreditu).join(","));
const saKreditom = await strana("filter=kredit");
proveri("filter 'sa kreditom' izbacuje prazne", !imena(saKreditom).includes("ana") && saKreditom.total === 5, imena(saKreditom).join(","));
proveri("zbir neiskoriscenog kredita", saKreditom.ukupnoKredita === 900 + 300 + 50 + 200, String(saKreditom.ukupnoKredita));
const gosti = await strana("filter=gosti");
proveri("filter 'gosti' vidi samo brze goste", gosti.total === 2 && imena(gosti).every((u) => u.startsWith("gost-")), imena(gosti).join(","));
const stalni = await strana("filter=stalni");
proveri("filter 'stalni' izbacuje goste", stalni.total === 4, imena(stalni).join(","));
const blok = await strana("filter=blokirani");
proveri("filter 'blokirani'", blok.total === 1 && imena(blok)[0] === "dule", imena(blok).join(","));
const kombinovano = await strana("filter=kredit&search=c");
proveri("filter i pretraga zajedno", kombinovano.total === 1 && imena(kombinovano)[0] === "ceca", imena(kombinovano).join(","));

const zlo = await strana("sort=" + encodeURIComponent("username; DROP TABLE players") + "&filter=" + encodeURIComponent("1=1 OR 1"));
proveri("nepoznat redosled/filter pada na podrazumevano", zlo.sort === "ime" && zlo.filter === "svi" && zlo.total === 6, JSON.stringify({ s: zlo.sort, f: zlo.filter, t: zlo.total }));
proveri("tabela igraca i dalje postoji", (await api("/api/players")).body.length === 6);

await kraj();
