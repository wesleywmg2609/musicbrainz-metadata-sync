const chooseFolderButton = document.querySelector("#chooseFolderButton");
const applyButton = document.querySelector("#applyButton");
const folderLabel = document.querySelector("#folderLabel");
const fetchSpotifyButton = document.querySelector("#fetchSpotifyButton");
const spotifyStatus = document.querySelector("#spotifyStatus");
const folderPreviewName = document.querySelector("#folderPreviewName");
const preferencesModal = document.querySelector("#preferencesModal");
const closePreferencesButton = document.querySelector("#closePreferencesButton");
const removeMetadataCount = document.querySelector("#removeMetadataCount");
const removeMetadataOptions = document.querySelector("#removeMetadataOptions");
const fileCount = document.querySelector("#fileCount");
const fileTableBody = document.querySelector("#fileTableBody");

const removableMetadataFields = [
  { label: "COMMENT", value: "COMMENT" },
  { label: "DESCRIPTION", value: "DESCRIPTION" },
  { label: "ENCODER", value: "ENCODER" },
  { label: "WEBSITE", value: "WEBSITE" },
  { label: "URL", value: "URL" },
  { label: "SOURCE", value: "SOURCE" },
  { label: "ORGANIZATION", value: "ORGANIZATION" },
  { label: "COPYRIGHT", value: "COPYRIGHT" },
  { label: "PUBLISHER", value: "PUBLISHER" },
  { label: "LABEL", value: "LABEL" }
];

let selectedFiles = [];
let selectedFolderPath = "";
let spotifyAlbum = null;
let selectedRemoveMetadataFields = new Set();

function openPreferences() {
  preferencesModal.hidden = false;
  closePreferencesButton.focus();
}

function closePreferences() {
  preferencesModal.hidden = true;
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

  removableMetadataFields.forEach((field) => {
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

  [...selectedRemoveMetadataFields].forEach((field) => {
    const normalizedKey = normalizeMetadataKey(field);

    if (!fieldsByKey.has(normalizedKey)) {
      fieldsByKey.set(normalizedKey, {
        label: formatMetadataLabel(field),
        value: field
      });
    }
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
    "disc",
    "date",
    "discnumber",
    "track",
    "tracknumber"
  ]);

  return keyMetadataTags.has(normalizeMetadataKey(key));
}

function formatMetadataLabel(key) {
  const labelOverrides = new Map([
    ["barcode", "Barcode"],
    ["catalognumber", "Catalog number"],
    ["comment", "Comment"],
    ["compilation", "Compilation"],
    ["composer", "Composer"],
    ["conductor", "Conductor"],
    ["copyright", "Copyright"],
    ["description", "Description"],
    ["disctotal", "Disc total"],
    ["discnumber", "Disc number"],
    ["encodedby", "Encoded by"],
    ["encoder", "Encoder"],
    ["genre", "Genre"],
    ["isrc", "ISRC"],
    ["label", "Label"],
    ["lyricist", "Lyricist"],
    ["musicbrainzalbumartistid", "MusicBrainz album artist ID"],
    ["musicbrainzalbumid", "MusicBrainz album ID"],
    ["musicbrainzartistid", "MusicBrainz artist ID"],
    ["musicbrainzreleasegroupid", "MusicBrainz release group ID"],
    ["musicbrainztrackid", "MusicBrainz track ID"],
    ["musicbrainzworkid", "MusicBrainz work ID"],
    ["organization", "Organization"],
    ["publisher", "Publisher"],
    ["replaygainalbumgain", "ReplayGain album gain"],
    ["replaygainalbumpeak", "ReplayGain album peak"],
    ["replaygaintrackgain", "ReplayGain track gain"],
    ["replaygaintrackpeak", "ReplayGain track peak"],
    ["spotifyalbumid", "Spotify album ID"],
    ["spotifyartistid", "Spotify artist ID"],
    ["spotifytrackid", "Spotify track ID"],
    ["titlesort", "Title sort"],
    ["tracktotal", "Track total"],
    ["tracknumber", "Track number"],
    ["upc", "UPC"],
    ["url", "URL"],
    ["website", "Website"]
  ]);
  const normalizedKey = normalizeMetadataKey(key);

  if (labelOverrides.has(normalizedKey)) {
    return labelOverrides.get(normalizedKey).toUpperCase();
  }

  return String(key || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .toUpperCase();
}

function createMetadataTooltip(file) {
  const wrapper = document.createElement("div");
  const button = document.createElement("button");
  const tooltip = document.createElement("div");
  const currentMetadata = file.metadata || {};
  const targetMetadata = file.spotifyMetadata || {};
  const keySection = createMetadataSection("PRIMARY METADATA");
  const otherSection = createMetadataSection("ADDITIONAL METADATA");
  const keyRows = [
    ["Title", currentMetadata.title, targetMetadata.title],
    ["Album", currentMetadata.album, targetMetadata.album],
    ["Artist", currentMetadata.artist, targetMetadata.artist],
    ["Album artist", currentMetadata.albumArtist, targetMetadata.albumArtist],
    ["Date", currentMetadata.date, targetMetadata.date],
    ["Disc", currentMetadata.discNumber, targetMetadata.discNumber],
    ["Track", currentMetadata.trackNumber, targetMetadata.trackNumber]
  ];
  const rawTags = getSortedRawTags(currentMetadata.rawTags).filter(([key]) => !isKeyMetadataTag(key));

  wrapper.className = "metadata-popover";
  button.className = "metadata-button";
  button.type = "button";
  button.setAttribute("aria-label", `View metadata for ${file.name}`);
  button.textContent = "i";
  tooltip.className = "metadata-tooltip";
  tooltip.setAttribute("role", "tooltip");

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

fetchSpotifyButton.addEventListener("click", async () => {
  fetchSpotifyButton.disabled = true;
  fetchSpotifyButton.textContent = "Fetching...";
  spotifyStatus.textContent = "Searching Spotify...";

  try {
    const metadata = selectedFiles.find(
      (file) =>
        file.metadata?.album &&
        (file.metadata?.albumArtist || file.metadata?.artist)
    )?.metadata;

    spotifyAlbum = await window.musicMetadataSync.fetchSpotifyAlbum({
      artist: metadata?.albumArtist || metadata?.artist,
      album: metadata?.album
    });
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

closePreferencesButton.addEventListener("click", closePreferences);

preferencesModal.addEventListener("click", (event) => {
  if (event.target === preferencesModal) {
    closePreferences();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !preferencesModal.hidden) {
    closePreferences();
  }
});

window.musicMetadataSync.onOpenPreferences(openPreferences);

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
