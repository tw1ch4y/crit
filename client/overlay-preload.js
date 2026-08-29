const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("critOverlay", {
  naPrikaz: (cb) => ipcRenderer.on("overlay-prikazi", (e, d) => cb(d)),
});
