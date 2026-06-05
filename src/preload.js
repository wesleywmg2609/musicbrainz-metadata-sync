const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("musicMetadataSync", {
  chooseFolder: () => ipcRenderer.invoke("folder:choose"),
  applyFolderWorkflow: (payload) => ipcRenderer.invoke("folder:apply", payload),
  onApplyProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);

    ipcRenderer.on("folder:apply-progress", listener);
    return () => ipcRenderer.removeListener("folder:apply-progress", listener);
  },
  fetchMusicBrainzAlbum: (payload) => ipcRenderer.invoke("musicbrainz:album", payload),
  writeReport: (payload) => ipcRenderer.invoke("report:write", payload)
});
