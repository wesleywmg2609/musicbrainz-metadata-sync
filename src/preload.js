const { contextBridge, ipcRenderer } = require("electron");

// This file is the bridge between renderer.js and main.js.
// The renderer is a web page, so it should not directly access Node.js or the
// filesystem. contextBridge exposes only the small API we choose.
contextBridge.exposeInMainWorld("musicRenamer", {
  // renderer.js calls window.musicRenamer.chooseFolder().
  // ipcRenderer.invoke sends a request to ipcMain.handle("folder:choose")
  // in main.js and waits for the folder/file result.
  chooseFolder: () => ipcRenderer.invoke("folder:choose"),

  // Runs the real folder rename + audio flatten workflow in main.js.
  applyFolderWorkflow: (payload) => ipcRenderer.invoke("folder:apply", payload),

  // Fetches album metadata through main.js so Spotify credentials stay out of
  // direct renderer networking code.
  fetchSpotifyAlbum: (payload) => ipcRenderer.invoke("spotify:album", payload)
});
