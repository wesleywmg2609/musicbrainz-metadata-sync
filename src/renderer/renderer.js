const chooseFolderButton = document.querySelector("#chooseFolderButton");
const applyButton = document.querySelector("#applyButton");
const folderLabel = document.querySelector("#folderLabel");
const artistInput = document.querySelector("#artistInput");
const albumInput = document.querySelector("#albumInput");
const trackStartInput = document.querySelector("#trackStartInput");
const fetchSpotifyButton = document.querySelector("#fetchSpotifyButton");
const spotifyStatus = document.querySelector("#spotifyStatus");
const folderPreviewName = document.querySelector("#folderPreviewName");
const fileCount = document.querySelector("#fileCount");
const fileTableBody = document.querySelector("#fileTableBody");

let selectedFiles = [];
let selectedFolderPath = "";
let spotifyAlbum = null;

function cleanFileName(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getPathSeparator(folderPath) {
  return folderPath.includes("\\") ? "\\" : "/";
}

function getParentFolderPath(folderPath) {
  const separator = getPathSeparator(folderPath);
  const normalizedPath = folderPath.replace(/[\\/]+$/, "");
  const separatorIndex = normalizedPath.lastIndexOf(separator);

  return separatorIndex >= 0 ? normalizedPath.slice(0, separatorIndex) : normalizedPath;
}

function buildFolderName() {
  const artist = spotifyAlbum?.albumArtist || artistInput.value.trim();
  const album = spotifyAlbum?.album || albumInput.value.trim();

  if (!artist || !album) {
    return "";
  }

  return cleanFileName(`${artist} - ${album}`);
}

function buildTargetFolderPath() {
  const folderName = buildFolderName();

  if (!selectedFolderPath || !folderName) {
    return selectedFolderPath;
  }

  const separator = getPathSeparator(selectedFolderPath);
  return `${getParentFolderPath(selectedFolderPath)}${separator}${folderName}`;
}

function buildPreviewName(file) {
  return file.name;
}

function getPreviewMetadata(file) {
  return file?.spotifyMetadata || file?.metadata || {};
}

function getPaddedTrackNumber(index) {
  const metadataTrack = getPreviewMetadata(selectedFiles[index])?.trackNumber;

  if (Number.isFinite(metadataTrack)) {
    return String(metadataTrack).padStart(2, "0");
  }

  const trackStart = Number.parseInt(trackStartInput.value, 10);
  const trackNumber = Number.isFinite(trackStart) ? trackStart + index : index + 1;

  return String(trackNumber).padStart(2, "0");
}

function getPaddedDiscNumber(file) {
  const metadataDisc = getPreviewMetadata(file)?.discNumber;

  if (Number.isFinite(metadataDisc)) {
    return String(metadataDisc).padStart(2, "0");
  }

  return "";
}

function renderFiles() {
  fileCount.textContent = `${selectedFiles.length} ${selectedFiles.length === 1 ? "file" : "files"}`;
  folderPreviewName.textContent = buildFolderName() || "Selected folder name stays unchanged until artist and album are set.";
  applyButton.disabled = !selectedFolderPath || selectedFiles.length === 0;
  fileTableBody.replaceChildren();

  if (selectedFiles.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.className = "empty-state";
    cell.colSpan = 8;
    cell.textContent = "No audio files found in this folder.";
    row.append(cell);
    fileTableBody.append(row);
    return;
  }

  selectedFiles.forEach((file, index) => {
    const row = document.createElement("tr");
    const discCell = document.createElement("td");
    const trackCell = document.createElement("td");
    const currentCell = document.createElement("td");
    const targetCell = document.createElement("td");
    const titleCell = document.createElement("td");
    const albumCell = document.createElement("td");
    const artistCell = document.createElement("td");
    const albumArtistCell = document.createElement("td");
    const currentFileName = document.createElement("strong");
    const currentFileLocation = document.createElement("span");
    const targetFileName = document.createElement("strong");
    const targetFileLocation = document.createElement("span");
    const metadata = getPreviewMetadata(file);

    discCell.className = "disc-cell";
    discCell.textContent = getPaddedDiscNumber(file);
    trackCell.className = "track-cell";
    trackCell.textContent = getPaddedTrackNumber(index);
    currentFileName.textContent = file.name;
    currentFileLocation.textContent = file.folder;
    targetFileName.textContent = buildPreviewName(file);
    targetFileLocation.textContent = buildTargetFolderPath();
    titleCell.textContent = metadata.title || "";
    albumCell.textContent = metadata.album || "";
    artistCell.textContent = metadata.artist || "";
    albumArtistCell.textContent = metadata.albumArtist || "";

    currentCell.append(currentFileName, currentFileLocation);
    targetCell.append(targetFileName, targetFileLocation);

    row.append(discCell, trackCell, currentCell, targetCell, titleCell, albumCell, artistCell, albumArtistCell);
    fileTableBody.append(row);
  });
}

chooseFolderButton.addEventListener("click", async () => {
  chooseFolderButton.disabled = true;
  chooseFolderButton.textContent = "Choosing...";

  try {
    const result = await window.musicMetadataSync.chooseFolder();

    if (result) {
      folderLabel.textContent = result.folderPath;
      selectedFolderPath = result.folderPath;
      selectedFiles = result.files;
      spotifyAlbum = null;
      spotifyStatus.textContent = "Spotify metadata not loaded.";
      fillSearchFieldsFromLocalMetadata(selectedFiles);
      renderFiles();
    }
  } finally {
    chooseFolderButton.disabled = false;
    chooseFolderButton.textContent = "Choose Folder";
  }
});

function getLocalMetadataKey(file) {
  const metadata = file.metadata || {};

  if (!Number.isFinite(metadata.discNumber) || !Number.isFinite(metadata.trackNumber)) {
    return "";
  }

  return `${metadata.discNumber}:${metadata.trackNumber}`;
}

function getSpotifyMetadataKey(track) {
  if (!Number.isFinite(track.discNumber) || !Number.isFinite(track.trackNumber)) {
    return "";
  }

  return `${track.discNumber}:${track.trackNumber}`;
}

function applySpotifyMetadata(albumData) {
  const tracksByKey = new Map();

  albumData.tracks.forEach((track) => {
    const key = getSpotifyMetadataKey(track);

    if (key) {
      tracksByKey.set(key, track);
    }
  });

  selectedFiles = selectedFiles.map((file, index) => {
    const matchingTrack = tracksByKey.get(getLocalMetadataKey(file)) || albumData.tracks[index] || null;

    return {
      ...file,
      spotifyMetadata: matchingTrack
    };
  });
}

function fillSearchFieldsFromLocalMetadata(files) {
  const metadata = files.find((file) => file.metadata?.album || file.metadata?.albumArtist || file.metadata?.artist)?.metadata;

  if (!metadata) {
    return;
  }

  artistInput.value = artistInput.value || metadata.albumArtist || metadata.artist || "";
  albumInput.value = albumInput.value || metadata.album || "";
}

fetchSpotifyButton.addEventListener("click", async () => {
  fetchSpotifyButton.disabled = true;
  fetchSpotifyButton.textContent = "Fetching...";
  spotifyStatus.textContent = "Searching Spotify...";

  try {
    spotifyAlbum = await window.musicMetadataSync.fetchSpotifyAlbum({
      artist: artistInput.value,
      album: albumInput.value
    });

    artistInput.value = artistInput.value || spotifyAlbum.albumArtist;
    albumInput.value = albumInput.value || spotifyAlbum.album;
    applySpotifyMetadata(spotifyAlbum);
    spotifyStatus.textContent = `Loaded ${spotifyAlbum.tracks.length} Spotify tracks from ${spotifyAlbum.albumArtist} - ${spotifyAlbum.album}.`;
    renderFiles();
  } catch (error) {
    spotifyStatus.textContent = error.message;
    window.alert(error.message);
  } finally {
    fetchSpotifyButton.disabled = false;
    fetchSpotifyButton.textContent = "Fetch Spotify";
  }
});

applyButton.addEventListener("click", async () => {
  applyButton.disabled = true;
  applyButton.textContent = "Applying...";

  try {
    const result = await window.musicMetadataSync.applyFolderWorkflow({
      folderPath: selectedFolderPath,
      folderName: buildFolderName()
    });

    selectedFolderPath = result.folderPath;
    folderLabel.textContent = result.folderPath;
    selectedFiles = result.files;
    renderFiles();
  } catch (error) {
    window.alert(error.message);
  } finally {
    applyButton.textContent = "Apply Changes";
    renderFiles();
  }
});

[artistInput, albumInput, trackStartInput].forEach((input) => {
  input.addEventListener("input", renderFiles);
});
