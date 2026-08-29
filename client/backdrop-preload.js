const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("critBackdrop", {
  focusLauncher: () => ipcRenderer.invoke("focus-launcher"),
});
