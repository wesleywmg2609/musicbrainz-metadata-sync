const chooseFolderButton = document.querySelector("#chooseFolderButton");
const applyButton = document.querySelector("#applyButton");
const folderLabel = document.querySelector("#folderLabel");
const fetchSpotifyButton = document.querySelector("#fetchSpotifyButton");
const fetchLastfmButton = document.querySelector("#fetchLastfmButton");
const spotifyStatus = document.querySelector("#spotifyStatus");
const folderPreviewName = document.querySelector("#folderPreviewName");
const removeMetadataCount = document.querySelector("#removeMetadataCount");
const removeMetadataOptions = document.querySelector("#removeMetadataOptions");
const fileCount = document.querySelector("#fileCount");
const fileTableBody = document.querySelector("#fileTableBody");

const xiphDefaultMetadataFields = [
  "VERSION",
  "PERFORMER",
  "COPYRIGHT",
  "LICENSE",
  "ORGANIZATION",
  "DESCRIPTION",
  "LOCATION",
  "CONTACT",
  "ISRC"
].map((value) => ({
  value,
  label: value
}));

const metadataLabelOverrides = new Map(
  [
    ["ISRC", "ISRC"]
  ].map(([value, label]) => [
    normalizeMetadataKey(value),
    label
  ])
);

function formatMetadataLabel(key) {
  const normalizedKey = normalizeMetadataKey(key);

  if (metadataLabelOverrides.has(normalizedKey)) {
    return metadataLabelOverrides.get(normalizedKey);
  }

  return String(key || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

let selectedFiles = [];
let selectedFolderPath = "";
let spotifyAlbum = null;
let selectedRemoveMetadataFields = new Set();
let activeMetadataTooltip = null;
let lastPointerPosition = null;

function hideActiveMetadataTooltip() {
  if (!activeMetadataTooltip) {
    return;
  }

  activeMetadataTooltip.element.classList.remove("is-visible");
  activeMetadataTooltip.element.remove();
  activeMetadataTooltip = null;
}

function positionMetadataTooltip(tooltip, rect) {
  const margin = 12;
  const centeredTop = rect.top + (rect.height / 2) - (tooltip.offsetHeight / 2);
  const maxTop = window.innerHeight - tooltip.offsetHeight - margin;
  const top = Math.min(Math.max(margin, centeredTop), maxTop);
  const left = Math.max(margin, rect.left - tooltip.offsetWidth - margin);

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function isPointerOverElement(element) {
  if (!lastPointerPosition) {
    return false;
  }

  const rect = element.getBoundingClientRect();

  return (
    lastPointerPosition.x >= rect.left &&
    lastPointerPosition.x <= rect.right &&
    lastPointerPosition.y >= rect.top &&
    lastPointerPosition.y <= rect.bottom
  );
}

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
  const metadata = spotifyAlbum || selectedFiles.find(
    (file) =>
      file.metadata?.album &&
      (file.metadata?.albumArtist || file.metadata?.artist)
  )?.metadata;

  const artist = metadata?.albumArtist || metadata?.artist;
  const album = metadata?.album;

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
  const metadata = file.spotifyMetadata;

  if (!metadata?.title) {
    return file.name;
  }

  const extension = file.extension || "";
  const track = String(metadata.track || metadata.trackNumber || "").padStart(2, "0");
  const title = cleanFileName(metadata.title);

  if (!track || !title) {
    return file.name;
  }

  return `${track}. ${title}${extension}`;
}

function getPreviewMetadata(file) {
  return file?.spotifyMetadata || file?.metadata || {};
}

function formatMetadataValue(value, options = {}) {
  if (value === null || value === undefined || value === "") {
    return options.blankEmpty ? "" : "empty";
  }

  return String(value);
}

function createMetadataLine(label, currentValue, targetValue, options = {}) {
  const row = document.createElement("div");
  const labelElement = document.createElement("span");
  const valueElement = document.createElement("strong");
  const currentText = formatMetadataValue(currentValue, options);
  const targetText = formatMetadataValue(targetValue, options);

  row.className = "metadata-tooltip-row";
  labelElement.textContent = label.toUpperCase();

  if (targetValue !== undefined && currentText !== targetText) {
    const oldValue = document.createElement("span");

    row.classList.add("metadata-change");
    valueElement.className = "metadata-change-values";
    oldValue.className = "metadata-old-value";
    oldValue.textContent = currentText;

    if (targetText === "empty") {
      valueElement.append(oldValue);
    } else {
      const newValue = document.createElement("span");

      newValue.className = "metadata-new-value";
      newValue.textContent = targetText;
      valueElement.append(oldValue, newValue);
    }
  } else {
    valueElement.textContent = currentText;
  }

  row.append(labelElement, valueElement);
  return row;
}

function createMetadataSection(title) {
  const section = document.createElement("div");
  const heading = document.createElement("h3");

  section.className = "metadata-tooltip-section";
  heading.textContent = title;
  section.append(heading);
  return section;
}

function renderRemoveMetadataOptions() {
  const options = getAvailableRemoveMetadataFields();

  selectedRemoveMetadataFields = new Set(
    [...selectedRemoveMetadataFields].filter((field) =>
      options.some((option) => normalizeMetadataKey(option.value) === normalizeMetadataKey(field))
    )
  );

  options.forEach((field) => {
    selectedRemoveMetadataFields.add(field.value);
  });

  removeMetadataOptions.replaceChildren();

  options.forEach((field) => {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    const text = document.createElement("span");

    label.className = "checkbox-option";
    checkbox.type = "checkbox";
    checkbox.value = field.value;
    checkbox.checked = selectedRemoveMetadataFields.has(field.value);
    text.textContent = field.label;

    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedRemoveMetadataFields.add(field.value);
      } else {
        selectedRemoveMetadataFields.delete(field.value);
      }

      renderFiles();
    });

    label.append(checkbox, text);
    removeMetadataOptions.append(label);
  });
}

function getAvailableRemoveMetadataFields() {
  const fieldsByKey = new Map();

  xiphDefaultMetadataFields.forEach((field) => {
    fieldsByKey.set(normalizeMetadataKey(field.value), field);
  });

  selectedFiles.forEach((file) => {
    Object.keys(file.metadata?.rawTags || {}).forEach((key) => {
      const normalizedKey = normalizeMetadataKey(key);

      if (isKeyMetadataTag(key)) {
        return;
      }

      if (!fieldsByKey.has(normalizedKey)) {
        fieldsByKey.set(normalizedKey, {
          label: formatMetadataLabel(key),
          value: key
        });
      }
    });
  });

  return [...fieldsByKey.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function getSortedRawTags(rawTags = {}) {
  return Object.entries(rawTags)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
}

function normalizeMetadataKey(key) {
  return String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function shouldRemoveMetadataField(key) {
  const normalizedKey = normalizeMetadataKey(key);

  return [...selectedRemoveMetadataFields].some((field) => normalizeMetadataKey(field) === normalizedKey);
}

function isKeyMetadataTag(key) {
  const keyMetadataTags = new Set([
    "title",
    "album",
    "artist",
    "albumartist",
    "date",
    "track"
  ]);

  return keyMetadataTags.has(normalizeMetadataKey(key));
}

function renderMetadataTooltipContent(tooltip, file) {
  const currentMetadata = file.metadata || {};
  const targetMetadata = file.spotifyMetadata || {};
  const keySection = createMetadataSection("PRIMARY METADATA");
  const otherSection = createMetadataSection("ADDITIONAL METADATA");
  const keyRows = [
    ["Title", currentMetadata.title, targetMetadata.title],
    ["Album", currentMetadata.album, targetMetadata.album],
    ["Artist", currentMetadata.artist, targetMetadata.artist],
    ["Album Artist", currentMetadata.albumArtist, targetMetadata.albumArtist],
    ["Date", currentMetadata.date, targetMetadata.date],
    ["TRACK", currentMetadata.track, targetMetadata.track]
  ];
  const rawTags = getSortedRawTags(currentMetadata.rawTags).filter(([key]) => !isKeyMetadataTag(key));

  tooltip.replaceChildren();

  keyRows.forEach(([label, currentValue, targetValue]) => {
    keySection.append(createMetadataLine(label, currentValue, file.spotifyMetadata ? targetValue : undefined, {
      blankEmpty: true
    }));
  });

  tooltip.append(keySection);

  if (rawTags.length > 0) {
    rawTags.forEach(([key, value]) => {
      const targetValue = shouldRemoveMetadataField(key)
        ? ""
        : undefined;

      otherSection.append(
        createMetadataLine(
          formatMetadataLabel(key),
          value,
          targetValue
        )
      );
    });

    tooltip.append(otherSection);
  }
}

function createMetadataTooltip(file, fileIndex) {
  const wrapper = document.createElement("div");
  const button = document.createElement("button");
  const tooltip = document.createElement("div");

  wrapper.className = "metadata-popover";
  button.className = "metadata-button";
  button.type = "button";
  button.setAttribute("aria-label", `View metadata for ${file.name}`);
  button.textContent = "i";
  tooltip.className = "metadata-tooltip";
  tooltip.setAttribute("role", "tooltip");
  renderMetadataTooltipContent(tooltip, file);

  function showTooltip() {
    const rect = button.getBoundingClientRect();

    hideActiveMetadataTooltip();
    document.body.append(tooltip);
    tooltip.classList.add("is-visible");
    activeMetadataTooltip = {
      element: tooltip,
      fileIndex
    };
    positionMetadataTooltip(tooltip, rect);
  }

  function hideTooltip() {
    if (activeMetadataTooltip?.element === tooltip) {
      hideActiveMetadataTooltip();
      return;
    }

    tooltip.remove();
  }

  button.addEventListener("mouseenter", showTooltip);
  button.addEventListener("focus", showTooltip);
  button.addEventListener("mouseleave", hideTooltip);
  button.addEventListener("blur", hideTooltip);

  wrapper.showMetadataTooltip = showTooltip;
  wrapper.isMetadataButtonHovered = () => isPointerOverElement(button);
  wrapper.append(button);
  return wrapper;
}

function renderFiles(options = {}) {
  const tooltipIndexToRestore = options.restoreActiveTooltip
    ? activeMetadataTooltip?.fileIndex
    : null;
  let tooltipToRestore = null;

  if (!options.restoreActiveTooltip) {
    hideActiveMetadataTooltip();
  }

  fileCount.textContent = `${selectedFiles.length} ${selectedFiles.length === 1 ? "file" : "files"}`;
  removeMetadataCount.textContent = `${selectedRemoveMetadataFields.size} ${selectedRemoveMetadataFields.size === 1 ? "field" : "fields"} selected`;
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
    const metadataTooltip = createMetadataTooltip(file, index);
    metadataCell.append(metadataTooltip);

    currentCell.append(currentFileName, currentFileLocation);
    targetCell.append(targetFileName, targetFileLocation);

    row.append(currentCell, targetCell, metadataCell);
    fileTableBody.append(row);

    if (index === tooltipIndexToRestore && metadataTooltip.isMetadataButtonHovered()) {
      tooltipToRestore = metadataTooltip;
    }
  });

  if (tooltipToRestore) {
    tooltipToRestore.showMetadataTooltip();
  } else if (options.restoreActiveTooltip) {
    hideActiveMetadataTooltip();
  }
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
      spotifyStatus.textContent = "Metadata not loaded.";
      renderRemoveMetadataOptions();
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

async function fetchExternalAlbumMetadata(source) {
  const isSpotify = source === "spotify";
  const button = isSpotify ? fetchSpotifyButton : fetchLastfmButton;
  const idleText = isSpotify ? "Fetch Spotify" : "Fetch Last.fm";
  const sourceName = isSpotify ? "Spotify" : "Last.fm";

  button.disabled = true;
  fetchSpotifyButton.disabled = true;
  fetchLastfmButton.disabled = true;
  button.textContent = "Fetching...";
  spotifyStatus.textContent = `Searching ${sourceName}...`;

  try {
    const metadata = selectedFiles.find(
      (file) =>
        file.metadata?.album &&
        (file.metadata?.albumArtist || file.metadata?.artist)
    )?.metadata;

    const payload = {
      artist: metadata?.albumArtist || metadata?.artist,
      album: metadata?.album,
      files: isSpotify ? undefined : selectedFiles
    };

    spotifyAlbum = isSpotify
      ? await window.musicMetadataSync.fetchSpotifyAlbum(payload)
      : await window.musicMetadataSync.fetchLastfmAlbum(payload);
    applySpotifyMetadata(spotifyAlbum);
    spotifyStatus.textContent = spotifyAlbum.trackSource === "local"
      ? `Loaded ${sourceName} album metadata from ${spotifyAlbum.albumArtist} - ${spotifyAlbum.album}; using ${spotifyAlbum.tracks.length} local track rows.`
      : `Loaded ${spotifyAlbum.tracks.length} ${sourceName} tracks from ${spotifyAlbum.albumArtist} - ${spotifyAlbum.album}.`;
    renderFiles({ restoreActiveTooltip: true });
  } catch (error) {
    spotifyStatus.textContent = error.message;
    window.alert(error.message);
  } finally {
    fetchSpotifyButton.disabled = false;
    fetchLastfmButton.disabled = false;
    button.textContent = idleText;
  }
}

fetchSpotifyButton.addEventListener("click", async () => {
  await fetchExternalAlbumMetadata("spotify");
});

fetchLastfmButton.addEventListener("click", async () => {
  await fetchExternalAlbumMetadata("lastfm");
});

window.addEventListener("pointermove", (event) => {
  lastPointerPosition = {
    x: event.clientX,
    y: event.clientY
  };
});

applyButton.addEventListener("click", async () => {
  applyButton.disabled = true;
  applyButton.textContent = "Applying...";

  try {
    const result = await window.musicMetadataSync.applyFolderWorkflow({
      folderPath: selectedFolderPath,
      folderName: buildFolderName(),
      metadataFieldsToRemove: [...selectedRemoveMetadataFields],
      files: selectedFiles
    });

    selectedFolderPath = result.folderPath;
    folderLabel.textContent = result.folderPath;
    selectedFiles = result.files;
    renderRemoveMetadataOptions();
    renderFiles();
  } catch (error) {
    window.alert(error.message);
  } finally {
    applyButton.textContent = "Apply Changes";
    renderFiles();
  }
});

renderRemoveMetadataOptions();
