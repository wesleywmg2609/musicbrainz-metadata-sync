const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("musicMetadataSync", {
  chooseFolder: () => ipcRenderer.invoke("folder:choose"),
  applyFolderWorkflow: (payload) => ipcRenderer.invoke("folder:apply", payload),
  fetchSpotifyAlbum: (payload) => ipcRenderer.invoke("spotify:album", payload),
  fetchLastfmAlbum: (payload) => ipcRenderer.invoke("lastfm:album", payload),
  fetchMusicBrainzAlbum: (payload) => ipcRenderer.invoke("musicbrainz:album", payload)
});
