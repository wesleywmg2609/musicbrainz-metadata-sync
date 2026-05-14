const { app, BrowserWindow, dialog, ipcMain, Menu } = require("electron");
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
  return mainWindow;
}

function createAppMenu(mainWindow) {
  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "Preferences",
          accelerator: "CmdOrCtrl+,",
          click: () => {
            mainWindow.webContents.send("preferences:open");
          }
        },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
  const mainWindow = createWindow();
  createAppMenu(mainWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const newWindow = createWindow();
      createAppMenu(newWindow);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
