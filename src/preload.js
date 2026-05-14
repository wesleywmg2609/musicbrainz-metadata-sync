const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("musicMetadataSync", {
  chooseFolder: () => ipcRenderer.invoke("folder:choose"),
  applyFolderWorkflow: (payload) => ipcRenderer.invoke("folder:apply", payload),
  fetchSpotifyAlbum: (payload) => ipcRenderer.invoke("spotify:album", payload)
});
