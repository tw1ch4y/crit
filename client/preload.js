const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("crit", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  saveConfig: (c) => ipcRenderer.invoke("save-config", c),
  resetConfig: (pin) => ipcRenderer.invoke("reset-config", pin),
  toServer: (msg) => ipcRenderer.invoke("to-server", msg),
  launchGame: (g) => ipcRenderer.invoke("launch-game", g),
  openBrowser: (url) => ipcRenderer.invoke("open-browser", url),
  focusLauncher: () => ipcRenderer.invoke("focus-launcher"),
  adminExit: () => ipcRenderer.invoke("admin-exit"),
  ready: () => ipcRenderer.invoke("renderer-ready"),
  onServerMsg: (cb) => ipcRenderer.on("server-msg", (e, m) => cb(m)),
  onWsStatus: (cb) => ipcRenderer.on("ws-status", (e, s) => cb(s)),
  onNeedSetup: (cb) => ipcRenderer.on("need-setup", () => cb()),
  onHotkey: (cb) => ipcRenderer.on("hotkey", (e, h) => cb(h)),
  onGameError: (cb) => ipcRenderer.on("game-error", (e, d) => cb(d)),
  // Vreme istice. Ide kroz svoj kanal, a ne kroz obavestenje preko igre, jer se
  // zvuk cuje i kad je launcher iza igre u punom ekranu - a prozor se tada cesto
  // ne vidi uopste.
  onVremeIstice: (cb) => ipcRenderer.on("vreme-istice", (e, d) => cb(d)),
  onBlokirano: (cb) => ipcRenderer.on("blokirano", (e, d) => cb(d)),
  sysStats: () => ipcRenderer.invoke("sys-stats"),
  programIcon: (putanja) => ipcRenderer.invoke("program-icon", putanja),
  verzija: () => ipcRenderer.invoke("verzija"),
  // Servisni PIN se proverava LOKALNO, bez servera - da osoblje može da uđe u
  // podešavanja i izađe iz launchera i kad server ne radi.
  proveriServisniPin: (pin) => ipcRenderer.invoke("proveri-servisni-pin", pin),
  // Otključavanje posle isteklog vremena dok servera nema - vidi main.js.
  otkljucajBezServera: (pin) => ipcRenderer.invoke("otkljucaj-bez-servera", pin),
  // Miš i zvuk koje igrač namešta sa svog naloga. Važi dok traje sesija; kad se
  // odjavi, launcher vraća ono što je zatekao.
  podesavanjaCitaj: () => ipcRenderer.invoke("podesavanja-citaj"),
  podesavanjaPrimeni: (sta) => ipcRenderer.invoke("podesavanja-primeni", sta),
});
