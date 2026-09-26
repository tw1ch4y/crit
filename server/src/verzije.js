// Verzije i numeracija, bez baze (koriste ih i alati za pakovanje i testovi).
//
// Numeracija je počela ispočetka od 1.0.0; verzije do 2.58.0 su brojem veće,
// pa nova numeracija nosi oznaku svuda kuda verzija putuje:
//   - instaler "... Setup v1.0.0.exe"      (client/package.json)
//   - launcher uz verziju javlja n=1       (client/main.js)
//   - paket servera, numeracija u opisu    (paket-servera.js)
//   - puštena verzija, sa oznakom          (nadogradnja.js)
// Sve bez oznake je iz stare numeracije: vidi se, ali se ne poredi i ne pušta.
//
// Isti broj je u client/nadogradnja-skripta.js (proverava
// test-nadogradnja-launchera).
export const NUMERACIJA = 1;

// Poređenje po brojevima, ne kao tekst (2.44.0 je novije od 2.9.0).
export function uporediVerzije(a, b) {
  const raspakuj = (v) => String(v || "").trim().split(/[.\-+]/).map((d) => parseInt(d, 10));
  const x = raspakuj(a), y = raspakuj(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = Number.isFinite(x[i]) ? x[i] : 0;
    const q = Number.isFinite(y[i]) ? y[i] : 0;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

// Verzija iz imena instalatera ("... Setup v1.0.0.exe" -> "1.0.0"); ostatak
// imena je slobodan.
export function verzijaIzImena(ime) {
  const m = String(ime || "").match(/(?:^|[^a-z0-9])v(\d+\.\d+\.\d+)(?!\d)/i);
  return m ? m[1] : null;
}

// Ime sa verzijom, ali bez "v": instaler iz stare numeracije.
export const izStareNumeracije = (ime) => !verzijaIzImena(ime) && /\d+\.\d+\.\d+/.test(String(ime || ""));

// Goli broj iz imena, za prikaz starih instalera.
export const brojIzImena = (ime) => (String(ime || "").match(/\d+\.\d+\.\d+/) || [null])[0];
