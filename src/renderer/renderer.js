const chooseFolderButton = document.querySelector("#chooseFolderButton");
const applyButton = document.querySelector("#applyButton");
const folderLabel = document.querySelector("#folderLabel");
const artistInput = document.querySelector("#artistInput");
const albumInput = document.querySelector("#albumInput");
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

function formatMetadataValue(value) {
  if (value === null || value === undefined || value === "") {
    return "empty";
  }

  return String(value);
}

function createMetadataLine(label, currentValue, targetValue) {
  const row = document.createElement("div");
  const labelElement = document.createElement("span");
  const valueElement = document.createElement("strong");
  const currentText = formatMetadataValue(currentValue);
  const targetText = formatMetadataValue(targetValue);

  row.className = "metadata-tooltip-row";
  labelElement.textContent = label;

  if (targetValue !== undefined && currentText !== targetText) {
    const oldValue = document.createElement("span");
    const newValue = document.createElement("span");

    row.classList.add("metadata-change");
    valueElement.className = "metadata-change-values";
    oldValue.className = "metadata-old-value";
    newValue.className = "metadata-new-value";
    oldValue.textContent = currentText;
    newValue.textContent = targetText;
    valueElement.append(oldValue, newValue);
  } else {
    valueElement.textContent = currentText;
  }

  row.append(labelElement, valueElement);
  return row;
}

function createMetadataTooltip(file) {
  const wrapper = document.createElement("div");
  const button = document.createElement("button");
  const tooltip = document.createElement("div");
  const currentMetadata = file.metadata || {};
  const targetMetadata = file.spotifyMetadata || {};
  const rows = [
    ["Title", currentMetadata.title, targetMetadata.title],
    ["Album", currentMetadata.album, targetMetadata.album],
    ["Artist", currentMetadata.artist, targetMetadata.artist],
    ["Album artist", currentMetadata.albumArtist, targetMetadata.albumArtist],
    ["Disc", currentMetadata.discNumber, targetMetadata.discNumber],
    ["Track", currentMetadata.trackNumber, targetMetadata.trackNumber]
  ];

  wrapper.className = "metadata-popover";
  button.className = "metadata-button";
  button.type = "button";
  button.setAttribute("aria-label", `View metadata for ${file.name}`);
  button.textContent = "i";
  tooltip.className = "metadata-tooltip";
  tooltip.setAttribute("role", "tooltip");

  rows.forEach(([label, currentValue, targetValue]) => {
    tooltip.append(createMetadataLine(label, currentValue, file.spotifyMetadata ? targetValue : undefined));
  });

  function showTooltip() {
    const rect = button.getBoundingClientRect();

    document.body.append(tooltip);
    tooltip.classList.add("is-visible");

    const margin = 12;
    const centeredTop = rect.top + (rect.height / 2) - (tooltip.offsetHeight / 2);
    const maxTop = window.innerHeight - tooltip.offsetHeight - margin;
    const top = Math.min(Math.max(margin, centeredTop), maxTop);
    const left = Math.max(margin, rect.left - tooltip.offsetWidth - margin);

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function hideTooltip() {
    tooltip.classList.remove("is-visible");
    tooltip.remove();
  }

  button.addEventListener("mouseenter", showTooltip);
  button.addEventListener("focus", showTooltip);
  button.addEventListener("mouseleave", hideTooltip);
  button.addEventListener("blur", hideTooltip);

  wrapper.append(button);
  return wrapper;
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
    cell.colSpan = 3;
    cell.textContent = "No audio files found in this folder.";
    row.append(cell);
    fileTableBody.append(row);
    return;
  }

  selectedFiles.forEach((file, index) => {
    const row = document.createElement("tr");
    const currentCell = document.createElement("td");
    const targetCell = document.createElement("td");
    const metadataCell = document.createElement("td");
    const currentFileName = document.createElement("strong");
    const currentFileLocation = document.createElement("span");
    const targetFileName = document.createElement("strong");
    const targetFileLocation = document.createElement("span");

    currentFileName.textContent = file.name;
    currentFileLocation.textContent = file.folder;
    targetFileName.textContent = buildPreviewName(file);
    targetFileLocation.textContent = buildTargetFolderPath();
    metadataCell.className = "metadata-cell";
    metadataCell.append(createMetadataTooltip(file));

    currentCell.append(currentFileName, currentFileLocation);
    targetCell.append(targetFileName, targetFileLocation);

    row.append(currentCell, targetCell, metadataCell);
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

[artistInput, albumInput].forEach((input) => {
  input.addEventListener("input", renderFiles);
});
