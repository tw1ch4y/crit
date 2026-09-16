// VERZIJE I NUMERACIJA
//
// Bez baze i bez ičega iz servera: ovo uvoze i alati za pakovanje i testovi, a
// oni ne smeju da otvore nijednu bazu.
//
// NUMERACIJA. Brojevi su 2026-09-16 vraćeni na 1.0.0 - sve do 2.58.0 pravljeno
// je pre nego što je sistem ušao u upotrebu. Ali ti stari brojevi su VEĆI od
// novih, a nadogradnja bira "najveće":
//   - stari instaler 2.57.0 zaostao u folderu servera bi pobedio v1.0.0
//   - launcher 2.57.0 bi izgledao kao da je ispred svih
//   - kad nova numeracija jednom stigne do 2.57.0, stara odluka "puštena
//     2.57.0" bi pustila novu verziju bez ičije odluke
//
// Zato nova numeracija nosi znak na svakom mestu kuda verzija putuje:
//   - instaler se zove "... Setup v1.0.0.exe"      (client/package.json)
//   - launcher uz verziju javlja n=1                (client/main.js)
//   - paket servera ima numeraciju u opisu          (paket-servera.js)
//   - puštena verzija se pamti sa oznakom           (nadogradnja.js)
// Sve bez znaka je STARO: vidi se i sme da se obriše, ali se ne poredi, ne
// pušta i ne šalje. Launcher iz stare numeracije se ionako ne nadograđuje sam
// (odbija "manji" broj), pa ide ručno i tako piše u panelu.
//
// Isti broj stoji u client/nadogradnja-skripta.js; test-nadogradnja-launchera
// proverava da se poklapaju.
export const NUMERACIJA = 1;

// Verzije se porede po BROJEVIMA, ne kao tekst.
//
// "2.9.0" i "2.44.0": kao tekst je "2.9" veće, jer je "9" > "4". Po tom
// poređenju bi cela igraonica ostala na 2.9.0 i nikad ne bi uzela 2.44.0 -
// nadogradnja bi tiho stala, a niko ne bi imao razloga da posumnja.
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

// Verzija iz imena instalatera: "Crit Launcher Setup v1.0.0.exe" -> "1.0.0".
// Traži se "v" pa tri broja; ostatak imena je svejedno, pa igraonica sme da
// preimenuje instalater po svom brendu.
export function verzijaIzImena(ime) {
  const m = String(ime || "").match(/(?:^|[^a-z0-9])v(\d+\.\d+\.\d+)(?!\d)/i);
  return m ? m[1] : null;
}

// Ime sa verzijom, ali bez "v": instaler iz stare numeracije.
export const izStareNumeracije = (ime) => !verzijaIzImena(ime) && /\d+\.\d+\.\d+/.test(String(ime || ""));

// Goli broj iz imena, za prikaz starih instalera.
export const brojIzImena = (ime) => (String(ime || "").match(/\d+\.\d+\.\d+/) || [null])[0];
