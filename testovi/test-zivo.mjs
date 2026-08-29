import { citajIzvor } from "./_okruzenje.mjs";
// Stvari koje su "napisane u kodu" ali u igraonici nisu radile. Obe su prosle
// kroz sve dosadasnje provere jer se ne vide iz koda koji se cita red po red -
// vide se tek kad se klikne, ili tek na racunaru podesenom kao u igraonici.
//
// Puni vizuelni test kretanja je zaseban alat (radi pravi Electron prozor):
//   node proba-kretanja.mjs 8096            (server mora da radi)
//   node proba-kretanja.mjs 8096 --reduced  (kao racunar u igraonici)

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

const css = citajIzvor("client/renderer/css/launcher.css");
const jedanRed = css.replace(/\s+/g, " ");
const launcher = citajIzvor("client/renderer/js/launcher.js");
const html = citajIzvor("client/renderer/index.html");

// ---- 1) POP-UP NAGRADNOG TOCKA ----
// Delegacija klikova visi na #content. Pop-up tocka stoji IZVAN njega, kao i
// ostali overlay-i, pa dugmad u njemu nisu stizala do slusalaca: pop-up se
// otvarao, ali se nije mogao ni zavrteti ni zatvoriti. Jedini izlaz je bio
// gasenje launchera.
const izvanContenta = html.indexOf('id="tocakOverlay"') > html.indexOf('id="content"');
proveri("pop-up tocka stoji izvan #content", izvanContenta,
  "ako se ikad vrati unutra, ova provera vise ne znaci nista");
proveri("tocak ima svoj slusalac, ne oslanja se na #content",
  /\$\("#tocakOverlay"\)\.addEventListener\("click"/.test(launcher));
for (const [sta, sablon] of [
  ["zavrti", /#tocakSpin"\)\) return zavrtiTocakKlik/],
  ["X", /#tocakX"\)/],
  ["dugme Zatvori", /#tocakGotovo"\)/],
  ["klik na tamnu podlogu", /e\.target === e\.currentTarget\) return zatvoriTocak/],
]) {
  const deo = launcher.slice(launcher.indexOf('$("#tocakOverlay").addEventListener'));
  proveri(`na tocku radi: ${sta}`, sablon.test(deo.slice(0, 600)));
}
proveri("Escape zatvara pop-up", /e\.key !== "Escape"/.test(launcher) && /tocakOverlay"\)\.classList\.contains\("active"\)/.test(launcher));
// Dugmad tocka NE smeju da ostanu i u #content delegaciji - tamo ne rade, a
// dupla veza kasnije zavara onog ko trazi gde se sta obradjuje.
const contentDeo = launcher.slice(launcher.indexOf('$("#content").addEventListener'), launcher.indexOf('$("#tocakOverlay").addEventListener'));
proveri("dugmad tocka nisu ostala u #content delegaciji",
  !contentDeo.includes("#tocakSpin") && !contentDeo.includes("#tocakX") && !contentDeo.includes("#tocakGotovo"));
proveri("widget u baneru i dalje otvara pop-up", contentDeo.includes("#heroTocak") && contentDeo.includes("otvoriTocak()"));

// ---- 2) ANIMACIJE NA RACUNARU BEZ WINDOWS ANIMACIJA ----
// Racunari u igraonici se podesavaju za igre: Windows animacije iskljucene.
// Takav Windows javlja prefers-reduced-motion: reduce. Pravilo koje je sa
// !important gasilo SVE animacije je na tim racunarima ubijalo i saru u
// pozadini i vrtnju nagradnog tocka - a vlasnik ih je izricito upalio.
const blokovi = [...jedanRed.matchAll(/@media \(prefers-reduced-motion: reduce\) \{(.*?)\} \}/g)].map((m) => m[1]);
proveri("postoji pravilo za smanjen motion", blokovi.length > 0);
for (const b of blokovi) {
  proveri("smanjen motion ne gasi SVE animacije", !/\*, \*::before, \*::after/.test(b), b.slice(0, 120));
  proveri("smanjen motion ne dira saru u pozadini", !/body::after/.test(b), b.slice(0, 120));
  proveri("smanjen motion ne dira nagradni tocak", !/tocak/.test(b), b.slice(0, 120));
  proveri("smanjen motion ne gasi iskre", !/iskre-sloj/.test(b), b.slice(0, 120));
}

// Same animacije moraju da postoje - ovo hvata slucaj da neko obrise keyframes.
for (const [vrsta, kf] of [["klizanje", "tekstura-klizi"], ["talas", "tekstura-talas"], ["dubina", "tekstura-dubina"]]) {
  proveri(`kretanje "${vrsta}" ima svoju animaciju`,
    new RegExp(`body\\[data-kretanje="${vrsta}"\\]::after \\{[^}]*animation: ${kf}`).test(jedanRed));
  proveri(`animacija "${kf}" je definisana`, jedanRed.includes(`@keyframes ${kf}`));
}
// Trajanje dolazi sa servera; 0s znaci "Mirno" i tada animacija stoji - to je
// jedini ispravan nacin da se kretanje ugasi.
proveri("trajanje kretanja dolazi iz promenljive, ne zakucano",
  /animation: tekstura-talas var\(--tekstura-sekundi/.test(jedanRed));

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
