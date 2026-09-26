// Puni server DEMO podacima da launcher odmah izgleda kompletno za probu:
// baneri, CRIT promo, vidljiv shop, upaljen točak, i demo igrač "test" sa
// kreditom i potrošnjom (da odmah sme da vrti točak).
//
// Pokreće se preko "3 - DEMO PODACI.bat" dok server radi. Ništa ne dira na
// pravoj igraonici - radi samo na lokalnom serveru na ovom računaru.
//
// NAPOMENA: ovo je za probu. Kad kreneš pravo postavljanje, iskopiraj svež
// folder "1 - SERVER" pa da baza bude čista.

const BASE = process.env.CRIT_BASE || "http://127.0.0.1:8095";

async function main() {
  let token;
  try {
    const r = await fetch(BASE + "/api/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    }).then((x) => x.json());
    token = r.token;
  } catch {
    console.log("\n  Ne mogu da se povežem na server (" + BASE + ").");
    console.log("  Prvo pokreni 'Pokreni server.bat' iz foldera '1 - SERVER', pa ovo ponovo.\n");
    process.exit(1);
  }
  if (!token) { console.log("\n  Prijava nije uspela (admin/admin). Da li si menjao lozinku?\n"); process.exit(1); }

  const api = (p, m = "GET", b) => fetch(BASE + p, {
    method: m, headers: { "content-type": "application/json", authorization: "Bearer " + token },
    body: b ? JSON.stringify(b) : undefined,
  }).then(async (x) => { const t = await x.text(); try { return JSON.parse(t); } catch { return t; } });

  const korak = (s) => process.stdout.write("  " + s + " ... ");
  const ok = (s = "gotovo") => console.log(s);

  console.log("\n  Punim demo podatke...\n");

  // Baza koja ide u paketu je vec podesena (baneri, promo, shop, tocak). Ovi
  // koraci to samo osiguraju: ako se pokrene na praznoj bazi, sve nameste; ako
  // je vec podeseno, ne diraju nista (ne prave duplikate).
  korak("Proveravam banere");
  const bg = await api("/api/games/banneri-auto", "POST", {});
  ok(bg.koliko ? `napravljeno ${bg.koliko}` : "vec postoje");

  korak("Proveravam CRIT promo");
  const promo = await api("/api/promo");
  if (!Array.isArray(promo) || !promo.length) { await api("/api/promo/crit", "POST", {}); ok("napravljen"); } else ok("vec postoji");

  korak("Prikazujem pića u shopu");
  const shop = await api("/api/shop");
  let skriveno = 0;
  for (const it of shop) if (!it.available) {
    await api(`/api/shop/${it.id}`, "PUT", { name: it.name, category: it.category, price: it.price, available: true, stock: it.stock == null ? "" : it.stock });
    skriveno++;
  }
  ok(skriveno ? `otkriveno ${skriveno}` : "vec vidljiv");

  korak("Palim nagradni točak");
  await api("/api/tocak", "POST", { ukljucen: true, prag: 1200 }); ok();

  // demo igrač "test" sa kreditom (ovo je glavni razlog skripte)
  korak("Pravim demo igrača 'test'");
  let test = (await api("/api/players?page=1&per=50&search=test")).items?.find((p) => p.username === "test");
  if (!test) test = await api("/api/players", "POST", { username: "test", password: "test1234", balance: 3000 });
  else await api(`/api/players/${test.id}/topup`, "POST", { amount: 3000 });
  ok();

  // 5) potrošnja preko 1200 (da odmah sme da vrti točak) + par porudžbina za istoriju
  korak("Pravim potrošnju (da točak bude spreman)");
  const vidljivi = (await api("/api/shop")).filter((s) => s.available);
  let potroseno = 0, i = 0;
  while (potroseno < 1400 && vidljivi.length) {
    const it = vidljivi[i % vidljivi.length]; i++;
    const r = await api("/api/pos", "POST", { items: [{ id: it.id, qty: 2 }], playerId: test.id, payment: "credit" });
    if (r.ok) potroseno += r.total; else break;
  }
  ok(`${Math.round(potroseno)} din`);

  // 6) prodaj mu i jedan paket (da se vidi kako izgleda u istoriji)
  korak("Prodajem demo paket");
  const paket = (await api("/api/paketi")).find((p) => p.available !== 0);
  if (paket) await api(`/api/players/${test.id}/paket`, "POST", { paketId: paket.id });
  ok(paket ? paket.name : "nema paketa");

  console.log(`
  =========================================================
   DEMO PODACI SU SPREMNI
  =========================================================

   U LAUNCHERU se prijavi kao:   test  /  test1234

   Šta ćeš videti odmah:
     - CRIT promo baner na vrhu početne
     - igre sa koricama i banerima
     - internet alate sa logotipima (Steam, Discord, ...)
     - shop pun pića
     - NALOG -> Nagradni točak spreman za spin (ZAVRTI)
     - NALOG -> istorija porudžbina i kupljen paket

   U PANELU (http://localhost:8095, admin/admin):
     - Izveštaji -> promet, keš/kredit, izvoz u CSV
     - Podešavanja -> Vremenski paketi i Nagradni točak
     - Igrači -> 'test' -> Dopuni -> vidiš dugme za paket

  `);
}

main().catch((e) => { console.log("\n  Greška: " + (e && e.message || e) + "\n"); process.exit(1); });
