const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("node:path");
const { loadDotEnv } = require("./main/env");
const { applyFolderWorkflow, getFolderAudioFiles } = require("./main/folderWorkflow");
const { fetchSpotifyAlbumMetadata } = require("./main/spotify");

loadDotEnv();

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: "#f6f4ef",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

ipcMain.handle("folder:choose", async () => {
  const result = await dialog.showOpenDialog({
    title: "Choose a music folder",
    properties: ["openDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const folderPath = result.filePaths[0];

  return {
    folderPath,
    files: await getFolderAudioFiles(folderPath)
  };
});

ipcMain.handle("folder:apply", async (_event, payload) => {
  return applyFolderWorkflow(payload);
});

ipcMain.handle("spotify:album", async (_event, payload) => {
  return fetchSpotifyAlbumMetadata(payload);
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
