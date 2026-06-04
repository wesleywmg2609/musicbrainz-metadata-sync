const { app, BrowserWindow, dialog, ipcMain, Menu } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { applyLibraryWorkflow, getFolderAlbums } = require("./main/folderWorkflow");
const { fetchMusicBrainzAlbumMetadata } = require("./main/musicbrainz");

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

function createAppMenu() {
  const template = [
    {
      label: "File",
      submenu: [
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
  const albums = await getFolderAlbums(folderPath);

  return {
    folderPath,
    albums,
    files: albums.flatMap((album) => album.files)
  };
});

ipcMain.handle("folder:apply", async (_event, payload) => {
  return applyLibraryWorkflow(payload);
});

ipcMain.handle("musicbrainz:album", async (_event, payload) => {
  return fetchMusicBrainzAlbumMetadata(payload);
});

ipcMain.handle("report:write", async (_event, payload) => {
  const content = String(payload?.content || "");
  const reportPath = path.join(process.cwd(), "log.txt");

  await fs.writeFile(reportPath, content, "utf8");

  return {
    reportPath
  };
});

app.whenReady().then(() => {
  createWindow();
  createAppMenu();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      createAppMenu();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
