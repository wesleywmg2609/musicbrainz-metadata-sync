const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("musicMetadataSync", {
  chooseFolder: () => ipcRenderer.invoke("folder:choose"),
  applyFolderWorkflow: (payload) => ipcRenderer.invoke("folder:apply", payload),
  fetchMusicBrainzAlbum: (payload) => ipcRenderer.invoke("musicbrainz:album", payload)
});
