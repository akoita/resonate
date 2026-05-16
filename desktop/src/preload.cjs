const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("resonateDesktop", {
  getRuntime: () => ipcRenderer.invoke("resonate-desktop:get-runtime"),
  selectAudioFiles: () =>
    ipcRenderer.invoke("resonate-desktop:select-audio-files"),
});
