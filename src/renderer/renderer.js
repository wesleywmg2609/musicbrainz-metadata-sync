const chooseFolderButton = document.querySelector("#chooseFolderButton");
const applyButton = document.querySelector("#applyButton");
const folderLabel = document.querySelector("#folderLabel");
const artistInput = document.querySelector("#artistInput");
const albumInput = document.querySelector("#albumInput");
const trackStartInput = document.querySelector("#trackStartInput");
const folderPreviewName = document.querySelector("#folderPreviewName");
const fileCount = document.querySelector("#fileCount");
const fileTableBody = document.querySelector("#fileTableBody");

let selectedFiles = [];
let selectedFolderPath = "";

// This file runs in Electron's renderer process.
// The renderer process behaves like browser JavaScript: it reads inputs,
// handles button clicks, and updates the HTML. It does not directly read
// folders; it asks main.js through window.musicRenamer from preload.js.
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

// Build the new folder name from metadata.
// Artist and album should change the folder name, not each audio filename.
function buildFolderName() {
  const artist = artistInput.value.trim();
  const album = albumInput.value.trim();

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

function buildTargetFilePath(file) {
  const separator = getPathSeparator(selectedFolderPath || file.folder);
  return `${buildTargetFolderPath()}${separator}${file.name}`;
}

// Filenames are intentionally unchanged. The workflow moves audio files to the
// target folder root instead of renaming each audio file.
function buildPreviewName(file) {
  return file.name;
}

function getPaddedTrackNumber(index) {
  const metadataTrack = selectedFiles[index]?.metadata?.trackNumber;

  if (Number.isFinite(metadataTrack)) {
    return String(metadataTrack).padStart(2, "0");
  }

  const trackStart = Number.parseInt(trackStartInput.value, 10);
  const trackNumber = Number.isFinite(trackStart) ? trackStart + index : index + 1;

  return String(trackNumber).padStart(2, "0");
}

function getPaddedDiscNumber(file) {
  const metadataDisc = file.metadata?.discNumber;

  if (Number.isFinite(metadataDisc)) {
    return String(metadataDisc).padStart(2, "0");
  }

  return "";
}

// Re-render the table whenever the selected folder or metadata inputs change.
// replaceChildren clears old rows so the preview always matches current state.
function renderFiles() {
  fileCount.textContent = `${selectedFiles.length} ${selectedFiles.length === 1 ? "file" : "files"}`;
  folderPreviewName.textContent = buildFolderName() || "Selected folder name stays unchanged until artist and album are set.";
  applyButton.disabled = !selectedFolderPath || selectedFiles.length === 0;
  fileTableBody.replaceChildren();

  if (selectedFiles.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.className = "empty-state";
    cell.colSpan = 4;
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

    discCell.className = "disc-cell";
    discCell.textContent = getPaddedDiscNumber(file);
    trackCell.className = "track-cell";
    trackCell.textContent = getPaddedTrackNumber(index);
    currentFileName.textContent = file.name;
    currentFileLocation.textContent = file.folder;
    targetFileName.textContent = buildPreviewName(file);
    targetFileLocation.textContent = buildTargetFilePath(file);
    titleCell.textContent = file.metadata?.title || "";
    albumCell.textContent = file.metadata?.album || "";
    artistCell.textContent = file.metadata?.artist || "";
    albumArtistCell.textContent = file.metadata?.albumArtist || "";

    // file data came from main.js after it scanned the selected folder.
    currentCell.append(currentFileName, currentFileLocation);
    targetCell.append(targetFileName, targetFileLocation);

    row.append(discCell, trackCell, currentCell, targetCell, titleCell, albumCell, artistCell, albumArtistCell);
    fileTableBody.append(row);
  });
}

// Ask the main process to open a folder picker and return audio files.
// The full route is:
// renderer.js -> preload.js -> ipcMain handler in main.js -> back to renderer.js.
chooseFolderButton.addEventListener("click", async () => {
  chooseFolderButton.disabled = true;
  chooseFolderButton.textContent = "Choosing...";

  try {
    const result = await window.musicRenamer.chooseFolder();

    if (result) {
      folderLabel.textContent = result.folderPath;
      selectedFolderPath = result.folderPath;
      selectedFiles = result.files;
      renderFiles();
    }
  } finally {
    chooseFolderButton.disabled = false;
    chooseFolderButton.textContent = "Choose Folder";
  }
});

applyButton.addEventListener("click", async () => {
  applyButton.disabled = true;
  applyButton.textContent = "Applying...";

  try {
    const result = await window.musicRenamer.applyFolderWorkflow({
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
  // Typing in any metadata input updates the preview immediately.
  input.addEventListener("input", renderFiles);
});
