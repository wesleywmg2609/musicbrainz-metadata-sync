const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("node:path");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const audioExtensions = new Set([".flac", ".mp3", ".m4a", ".wav", ".ogg"]);

function loadDotEnv() {
  const envPath = path.join(__dirname, "..", ".env");

  if (!fsSync.existsSync(envPath)) {
    return;
  }

  const lines = fsSync.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const value = trimmedLine.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");

    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

function getTagValue(tags = {}, tagName) {
  const match = Object.entries(tags).find(([key]) => key.toLowerCase() === tagName);
  return match ? String(match[1]).trim() : "";
}

function getFirstTagValue(tags, tagNames) {
  for (const tagName of tagNames) {
    const value = getTagValue(tags, tagName);

    if (value) {
      return value;
    }
  }

  return "";
}

function parseTrackNumber(value) {
  const match = String(value || "").match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : null;
}

function compareNullableNumbers(left, right) {
  if (left === null && right === null) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return left - right;
}

// ffprobe reads real metadata from the audio file.
// This is where track/title/artist/album data enters the Electron app.
async function readAudioMetadata(filePath) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format_tags",
      "-of",
      "json",
      filePath
    ]);
    const data = JSON.parse(stdout);
    const tags = data.format?.tags || {};
    const track = getFirstTagValue(tags, ["track", "tracknumber"]);
    const disc = getFirstTagValue(tags, ["disc", "discnumber", "disc_number"]);

    return {
      track,
      trackNumber: parseTrackNumber(track),
      disc,
      discNumber: parseTrackNumber(disc),
      title: getFirstTagValue(tags, ["title"]),
      artist: getFirstTagValue(tags, ["artist"]),
      albumArtist: getFirstTagValue(tags, ["album_artist", "albumartist"]),
      album: getFirstTagValue(tags, ["album"])
    };
  } catch {
    return {
      track: "",
      trackNumber: null,
      disc: "",
      discNumber: null,
      title: "",
      artist: "",
      albumArtist: "",
      album: ""
    };
  }
}

async function addMetadata(files) {
  return Promise.all(files.map(async (file) => ({
    ...file,
    metadata: await readAudioMetadata(file.path)
  })));
}

function sortFilesByMetadata(files) {
  files.sort((a, b) => (
    compareNullableNumbers(a.metadata.discNumber, b.metadata.discNumber) ||
    compareNullableNumbers(a.metadata.trackNumber, b.metadata.trackNumber) ||
    a.path.localeCompare(b.path)
  ));
}

function getSpotifyCredentials(payload = {}) {
  return {
    clientId: String(payload.clientId || process.env.SPOTIFY_CLIENT_ID || "").trim(),
    clientSecret: String(payload.clientSecret || process.env.SPOTIFY_CLIENT_SECRET || "").trim()
  };
}

async function fetchSpotifyToken(credentials) {
  if (!credentials.clientId || !credentials.clientSecret) {
    throw new Error("Spotify Client ID and Client Secret are required.");
  }

  const auth = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64");
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials"
    })
  });

  if (!response.ok) {
    throw new Error(`Spotify auth failed: ${response.status}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function fetchSpotifyJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`Spotify request failed: ${response.status}`);
  }

  return response.json();
}

function normalizeSpotifyTrack(track, album) {
  const artist = track.artists.map((item) => item.name).join(", ");
  const albumArtist = album.artists.map((item) => item.name).join(", ");

  return {
    spotifyId: track.id,
    disc: String(track.disc_number || ""),
    discNumber: track.disc_number || null,
    track: String(track.track_number || ""),
    trackNumber: track.track_number || null,
    title: track.name,
    artist,
    albumArtist,
    album: album.name
  };
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreSpotifyAlbum(candidate, artist, album) {
  const wantedArtist = normalizeSearchText(artist);
  const wantedAlbum = normalizeSearchText(album);
  const candidateAlbum = normalizeSearchText(candidate.name);
  const candidateArtists = normalizeSearchText(candidate.artists.map((item) => item.name).join(" "));
  let score = 0;

  if (candidateAlbum === wantedAlbum) {
    score += 100;
  } else if (candidateAlbum.includes(wantedAlbum) || wantedAlbum.includes(candidateAlbum)) {
    score += 60;
  }

  if (candidateArtists.includes(wantedArtist)) {
    score += 40;
  }

  return score;
}

async function searchSpotifyAlbums(token, artist, album) {
  const queries = [
    `album:"${album}" artist:"${artist}"`,
    `${album} ${artist}`,
    `album:"${album}"`,
    album
  ];
  const seen = new Set();
  const candidates = [];

  for (const query of queries) {
    const searchParams = new URLSearchParams({
      q: query,
      type: "album",
      limit: "10"
    });
    const search = await fetchSpotifyJson(`https://api.spotify.com/v1/search?${searchParams}`, token);

    for (const candidate of search.albums?.items || []) {
      if (seen.has(candidate.id)) {
        continue;
      }

      seen.add(candidate.id);
      candidates.push(candidate);
    }

    if (candidates.some((candidate) => scoreSpotifyAlbum(candidate, artist, album) >= 100)) {
      break;
    }
  }

  candidates.sort((a, b) => (
    scoreSpotifyAlbum(b, artist, album) - scoreSpotifyAlbum(a, artist, album) ||
    String(b.release_date || "").localeCompare(String(a.release_date || ""))
  ));

  return candidates;
}

async function fetchAllSpotifyAlbumTracks(albumData, token) {
  const tracks = [...albumData.tracks.items];
  let nextUrl = albumData.tracks.next;

  while (nextUrl) {
    const page = await fetchSpotifyJson(nextUrl, token);
    tracks.push(...page.items);
    nextUrl = page.next;
  }

  return tracks;
}

async function fetchSpotifyAlbumMetadata(payload) {
  const credentials = getSpotifyCredentials(payload);
  const artist = String(payload.artist || "").trim();
  const album = String(payload.album || "").trim();

  if (!artist || !album) {
    throw new Error("Artist and album are required before fetching Spotify metadata.");
  }

  const token = await fetchSpotifyToken(credentials);
  const spotifyAlbum = (await searchSpotifyAlbums(token, artist, album))[0];

  if (!spotifyAlbum) {
    throw new Error(`No Spotify album found for "${artist} - ${album}". Try simplifying the artist or album text.`);
  }

  const albumData = await fetchSpotifyJson(`https://api.spotify.com/v1/albums/${spotifyAlbum.id}`, token);
  const albumTracks = await fetchAllSpotifyAlbumTracks(albumData, token);
  const tracks = albumTracks.map((track) => normalizeSpotifyTrack(track, albumData));

  tracks.sort((a, b) => (
    compareNullableNumbers(a.discNumber, b.discNumber) ||
    compareNullableNumbers(a.trackNumber, b.trackNumber)
  ));

  return {
    album: albumData.name,
    albumArtist: albumData.artists.map((item) => item.name).join(", "),
    spotifyUrl: albumData.external_urls?.spotify || "",
    tracks
  };
}

// This file runs in Electron's main process.
// The main process is the "desktop app" side: it can create windows, open
// native Windows dialogs, read folders, rename files, and later call APIs.
// The renderer should ask this file to do trusted OS work through IPC.
function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: "#f6f4ef",
    webPreferences: {
      // preload.js runs before the HTML page and exposes safe functions to it.
      preload: path.join(__dirname, "preload.js"),

      // Keep Electron/Node internals separate from the web page JavaScript.
      contextIsolation: true,

      // The renderer cannot use require("fs") or other Node APIs directly.
      nodeIntegration: false
    }
  });

  // Load the UI page into the desktop window.
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

// Recursively collect audio files from the selected folder.
// fs.readdir reads one folder level, and this function calls itself when it
// finds a subfolder. The renderer receives plain file data, not fs objects.
async function walkAudioFiles(folderPath) {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(folderPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...await walkAudioFiles(fullPath));
      continue;
    }

    if (entry.isFile() && audioExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push({
        name: entry.name,
        path: fullPath,
        folder: path.dirname(fullPath),
        extension: path.extname(entry.name)
      });
    }
  }

  return files;
}

function cleanFileName(name) {
  return name.replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, " ").trim();
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getAvailablePath(filePath) {
  if (!await pathExists(filePath)) {
    return filePath;
  }

  const parsedPath = path.parse(filePath);
  let index = 1;
  let candidatePath = "";

  do {
    candidatePath = path.join(parsedPath.dir, `${parsedPath.name} (${index})${parsedPath.ext}`);
    index += 1;
  } while (await pathExists(candidatePath));

  return candidatePath;
}

// Apply the workflow:
// 1. Rename the selected folder to "Artist - Album" when both values exist.
// 2. Move every audio file from nested subfolders into that folder root.
// 3. Keep audio filenames unchanged, except adding " (1)" if a duplicate exists.
async function applyFolderWorkflow({ folderPath, folderName }) {
  let targetFolderPath = folderPath;
  const safeFolderName = cleanFileName(folderName || "");

  if (safeFolderName) {
    targetFolderPath = path.join(path.dirname(folderPath), safeFolderName);

    if (targetFolderPath.toLowerCase() !== folderPath.toLowerCase()) {
      if (await pathExists(targetFolderPath)) {
        throw new Error(`Target folder already exists: ${targetFolderPath}`);
      }

      await fs.rename(folderPath, targetFolderPath);
    }
  }

  const files = await walkAudioFiles(targetFolderPath);
  let movedCount = 0;

  for (const file of files) {
    if (file.folder.toLowerCase() === targetFolderPath.toLowerCase()) {
      continue;
    }

    const destinationPath = await getAvailablePath(path.join(targetFolderPath, file.name));
    await fs.rename(file.path, destinationPath);
    movedCount += 1;
  }

  const updatedFiles = await addMetadata(await walkAudioFiles(targetFolderPath));
  sortFilesByMetadata(updatedFiles);

  return {
    folderPath: targetFolderPath,
    files: updatedFiles,
    movedCount
  };
}

// IPC means inter-process communication.
// preload.js sends "folder:choose", this handler receives it, opens the native
// folder picker, scans audio files, and returns the data to renderer.js.
ipcMain.handle("folder:choose", async () => {
  const result = await dialog.showOpenDialog({
    title: "Choose a music folder",
    properties: ["openDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const folderPath = result.filePaths[0];
  const files = await addMetadata(await walkAudioFiles(folderPath));
  sortFilesByMetadata(files);

  return {
    folderPath,
    files
  };
});

ipcMain.handle("folder:apply", async (_event, payload) => {
  return applyFolderWorkflow(payload);
});

ipcMain.handle("spotify:album", async (_event, payload) => {
  return fetchSpotifyAlbumMetadata(payload);
});

app.whenReady().then(() => {
  // Electron must finish booting before BrowserWindow can be created.
  createWindow();

  // macOS convention: clicking the dock icon should recreate a window.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // On Windows/Linux, close the app when every window is closed.
  // On macOS, apps usually stay active until the user quits them explicitly.
  if (process.platform !== "darwin") {
    app.quit();
  }
});
