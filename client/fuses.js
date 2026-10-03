// ELECTRON FUSES - prekidaci upisani u sam program launchera pri pravljenju
// instalera (electron-builder "afterPack"). Ne ide u instaler kao fajl.
//
// Neke mogucnosti Electron-a ne mogu da se ugase iz main.js, jer deluju pre
// njega: promenljiva okruzenja ELECTRON_RUN_AS_NODE pretvara launcher u obican
// Node (bilo koja skripta, sa pravima igraca), NODE_OPTIONS i --inspect kace
// razvojne alate na glavni proces. Fuse ih gasi u samom .exe fajlu.
//
// OnlyLoadAppFromAsar: launcher se ucitava SAMO iz resources\app.asar. Bez toga
// Electron prvo trazi folder resources\app - a folder instalacije je u profilu
// igraca, pa bi igrac podmetnuo svoj "launcher".
//
// Namerno NIJE ukljuceno EnableEmbeddedAsarIntegrityValidation: tada se
// launcher ne pokrece ako zapis integriteta u .exe ne odgovara app.asar-u, a
// greska u tom lancu (electron-builder upisuje zapis, nadogradnja menja asar)
// znaci launcher koji ne radi ni na jednoj masini. Pre ukljucivanja: proba na
// jednom racunaru sa pravim instalerom i jednom nadogradnjom.
const path = require("node:path");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");

const FUSES = {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
};

function izvrsniFajl(context) {
  const ime = context.packager.appInfo.productFilename;
  if (context.electronPlatformName === "win32") return path.join(context.appOutDir, `${ime}.exe`);
  if (context.electronPlatformName === "darwin") return path.join(context.appOutDir, `${ime}.app`);
  return path.join(context.appOutDir, context.packager.executableName || ime);
}

exports.FUSES = FUSES;
exports.izvrsniFajl = izvrsniFajl;
exports.default = async function postaviFuses(context) {
  await flipFuses(izvrsniFajl(context), FUSES);
};
