// Ugasi "ExperimentalWarning" za ugradjeni node:sqlite modul, da konzola bude cista.
const origEmit = process.emitWarning.bind(process);
process.emitWarning = (warning, ...args) => {
  const name = typeof args[0] === "string" ? args[0] : args[0]?.type;
  const text = typeof warning === "string" ? warning : warning?.message || "";
  if (name === "ExperimentalWarning" && /SQLite/i.test(text)) return;
  return origEmit(warning, ...args);
};
