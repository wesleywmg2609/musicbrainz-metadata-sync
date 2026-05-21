const chooseFolderButton = document.querySelector("#chooseFolderButton");
const applyButton = document.querySelector("#applyButton");
const folderLabel = document.querySelector("#folderLabel");
const fetchMusicBrainzButton = document.querySelector("#fetchMusicBrainzButton");
const metadataStatus = document.querySelector("#metadataStatus");
const fileCount = document.querySelector("#fileCount");
const fileTableBody = document.querySelector("#fileTableBody");

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
let selectedAlbums = [];
let selectedFolderPath = "";
let fetchedAlbum = null;
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
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*']/g, "")
    .replace(/\p{C}/gu, "")
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

function getBaseName(folderPath) {
  const separator = getPathSeparator(folderPath);
  const normalizedPath = String(folderPath || "").replace(/[\\/]+$/, "");
  const separatorIndex = normalizedPath.lastIndexOf(separator);

  return separatorIndex >= 0 ? normalizedPath.slice(separatorIndex + 1) : normalizedPath;
}

function normalizeComparableFileName(name) {
  return cleanFileName(name).toLowerCase();
}

function buildFolderName(albumGroup) {
  const metadata = albumGroup?.fetchedAlbum || albumGroup?.files.find(
    (file) =>
      file.metadata?.album &&
      (file.metadata?.albumArtist || file.metadata?.artist)
  )?.metadata;

  const artist = metadata?.albumArtist || metadata?.artist;
  const albumTitle = metadata?.album;

  if (!artist || !albumTitle) {
    return "";
  }

  return cleanFileName(`${artist} - ${albumTitle}`);
}

function buildTargetFolderPath(album) {
  const folderName = buildFolderName(album);
  const folderPath = album?.folderPath || "";

  if (!folderPath || !folderName) {
    return folderPath;
  }

  const separator = getPathSeparator(folderPath);
  return `${getParentFolderPath(folderPath)}${separator}${folderName}`;
}

function buildPreviewName(file) {
  const metadata = file.fetchedMetadata;

  if (!metadata?.title) {
    return file.name;
  }

  const extension = file.extension || "";
  const track = String(metadata.track || "").padStart(2, "0");
  const title = cleanFileName(metadata.title);

  if (!track || !title) {
    return file.name;
  }

  return `${track}. ${title}${extension}`;
}

function formatMetadataValue(value, options = {}) {
  if (value === null || value === undefined || value === "") {
    return options.blankEmpty ? "" : "empty";
  }

  return String(value);
}

function hasMetadataValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function createMetadataLine(label, currentValue, targetValue, options = {}) {
  const row = document.createElement("div");
  const labelElement = document.createElement("span");
  const valueElement = document.createElement("strong");
  const currentText = formatMetadataValue(currentValue, options);
  const targetText = formatMetadataValue(targetValue, options);
  const hasTargetValue = targetValue !== undefined;
  const hasCurrentValue = hasMetadataValue(currentValue);
  const isRemovingValue = hasTargetValue && (
    targetValue === null ||
    targetValue === ""
  );

  row.className = "metadata-tooltip-row";
  labelElement.textContent = label.toUpperCase();

  if (hasTargetValue && currentText !== targetText) {
    const oldValue = document.createElement("span");

    row.classList.add("metadata-change");
    valueElement.className = "metadata-change-values";
    oldValue.className = "metadata-old-value";
    oldValue.textContent = currentText;

    if (isRemovingValue) {
      row.classList.add("metadata-remove");

      if (hasCurrentValue) {
        valueElement.append(oldValue);
      }
    } else {
      const newValue = document.createElement("span");

      newValue.className = "metadata-new-value";
      newValue.textContent = targetText;

      if (hasCurrentValue) {
        valueElement.append(oldValue, newValue);
      } else {
        valueElement.append(newValue);
      }
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

function getSortedMetadataEntries(metadata = {}) {
  return Object.entries(metadata)
    .filter(([, value]) => {
      const values = Array.isArray(value) ? value : [value];

      return values.some((item) => item !== null && item !== undefined && item !== "");
    })
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
}

function formatFlacTagValue(value) {
  return Array.isArray(value) ? value.join(", ") : value;
}

function normalizeMetadataKey(key) {
  return String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isKeyMetadataTag(key) {
  const keyMetadataTags = new Set([
    "title",
    "album",
    "artist",
    "albumartist",
    "date",
    "genre",
    "disc",
    "track"
  ]);

  return keyMetadataTags.has(normalizeMetadataKey(key));
}

function renderMetadataTooltipContent(tooltip, file) {
  const currentMetadata = file.metadata || {};
  const targetMetadata = file.fetchedMetadata || {};
  const keySection = createMetadataSection("PRIMARY METADATA");
  const otherSection = createMetadataSection("ADDITIONAL METADATA");
  const keyRows = [
    ["Title", currentMetadata.title, targetMetadata.title],
    ["Album", currentMetadata.album, targetMetadata.album],
    ["Artist", currentMetadata.artist, targetMetadata.artist],
    ["Album Artist", currentMetadata.albumArtist, targetMetadata.albumArtist],
    ["Date", currentMetadata.date, targetMetadata.date],
    ["Genre", currentMetadata.genre, targetMetadata.genre],
    ["DISC", currentMetadata.disc, targetMetadata.disc],
    ["TRACK", currentMetadata.track, targetMetadata.track]
  ];
  const rawTags = getSortedMetadataEntries(currentMetadata.rawTags).filter(([key]) => !isKeyMetadataTag(key));
  const rawTagsByKey = new Map(rawTags.map(([key, value]) => [normalizeMetadataKey(key), value]));
  const flacTags = getSortedMetadataEntries(targetMetadata.flacTags).filter(([key]) => !isKeyMetadataTag(key));

  tooltip.replaceChildren();

  keyRows.forEach(([label, currentValue, targetValue]) => {
    keySection.append(createMetadataLine(label, currentValue, file.fetchedMetadata ? targetValue : undefined, {
      blankEmpty: true
    }));
  });

  tooltip.append(keySection);

  if (rawTags.length > 0 || flacTags.length > 0) {
    const additionalRows = [];

    rawTags.forEach(([key, value]) => {
      const flacTag = flacTags.find(
        ([tagKey]) => normalizeMetadataKey(tagKey) === normalizeMetadataKey(key)
      );

      additionalRows.push({
        label: formatMetadataLabel(key),
        currentValue: value,
        targetValue: flacTag
          ? formatFlacTagValue(flacTag[1])
          : (file.fetchedMetadata ? "" : undefined)
      });
    });

    flacTags.forEach(([key, value]) => {
      if (rawTagsByKey.has(normalizeMetadataKey(key))) {
        return;
      }

      additionalRows.push({
        label: formatMetadataLabel(key),
        currentValue: "",
        targetValue: formatFlacTagValue(value)
      });
    });

    additionalRows
      .sort((a, b) => a.label.localeCompare(b.label))
      .forEach((row) => {
        otherSection.append(
          createMetadataLine(row.label, row.currentValue, row.targetValue)
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

  button.addEventListener("click", (event) => {
    event.stopPropagation();

    const isAlreadyOpen =
      activeMetadataTooltip?.element === tooltip;

    if (isAlreadyOpen) {
      hideActiveMetadataTooltip();
      return;
    }

    showTooltip();
  });

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

  selectedFiles = selectedAlbums.flatMap((album) => album.files);
  fileCount.textContent = `${selectedFiles.length} ${selectedFiles.length === 1 ? "file" : "files"}`;

  applyButton.disabled = !selectedFolderPath || !selectedFiles.some((file) => file.fetchedMetadata);
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

  let fileIndex = 0;

  selectedAlbums.forEach((album) => {
    const albumRow = document.createElement("tr");
    const albumCell = document.createElement("td");
    const toggleButton = document.createElement("button");
    const toggleIcon = document.createElement("span");
    const folderNames = document.createElement("span");
    const oldFolderName = document.createElement("span");
    const newFolderName = document.createElement("span");
    const isExpanded = album.expanded !== false;
    const currentFolderName = getBaseName(album.folderPath);
    const targetFolderName = buildFolderName(album) || currentFolderName;
    const isFolderNameChanged = normalizeComparableFileName(currentFolderName) !==
      normalizeComparableFileName(targetFolderName);

    albumCell.className = "album-group-row";
    albumCell.colSpan = 3;
    toggleButton.className = "album-folder-toggle";
    toggleButton.type = "button";
    toggleButton.setAttribute("aria-expanded", String(isExpanded));
    toggleButton.setAttribute("aria-label", `${isExpanded ? "Collapse" : "Expand"} ${getBaseName(album.folderPath)}`);
    toggleIcon.className = "album-folder-toggle-icon";
    toggleIcon.classList.toggle("is-collapsed", !isExpanded);
    folderNames.className = "album-folder-names";

    if (isFolderNameChanged) {
      oldFolderName.className = "album-folder-old";
      oldFolderName.textContent = currentFolderName;
      newFolderName.className = "album-folder-new";
      newFolderName.textContent = targetFolderName;
      folderNames.append(oldFolderName, newFolderName);
    } else {
      newFolderName.className = "album-folder-unchanged";
      newFolderName.textContent = currentFolderName;
      folderNames.append(newFolderName);
    }

    toggleButton.append(toggleIcon, folderNames);
    toggleButton.addEventListener("click", () => {
      album.expanded = !isExpanded;
      renderFiles();
    });
    albumCell.append(toggleButton);
    albumRow.append(albumCell);
    fileTableBody.append(albumRow);

    if (!isExpanded) {
      return;
    }

    album.files.forEach((file) => {
      const row = document.createElement("tr");
      const currentCell = document.createElement("td");
      const targetCell = document.createElement("td");
      const metadataCell = document.createElement("td");
      const currentFileName = document.createElement("strong");
      const currentFileLocation = document.createElement("span");
      const targetFileName = document.createElement("strong");
      const targetFileLocation = document.createElement("span");
      const targetPreviewName = buildPreviewName(file);
      const targetPreviewFolder = buildTargetFolderPath(album);
      const isFileNameChanged = normalizeComparableFileName(file.name) !==
        normalizeComparableFileName(targetPreviewName);
      const isFileLocationChanged = normalizeComparableFileName(file.folder) !==
        normalizeComparableFileName(targetPreviewFolder);

      currentFileName.textContent = file.name;
      currentFileLocation.textContent = file.folder;
      targetFileName.textContent = targetPreviewName;
      targetFileLocation.textContent = targetPreviewFolder;

      if (isFileNameChanged) {
        currentFileName.className = "file-name-old";
        targetFileName.className = "file-name-new";
      } else {
        currentFileName.className = "file-name-unchanged";
        targetFileName.className = "file-name-unchanged";
      }

      if (isFileLocationChanged) {
        currentFileLocation.className = "file-location-old";
        targetFileLocation.className = "file-location-new";
      } else {
        currentFileLocation.className = "file-location-unchanged";
        targetFileLocation.className = "file-location-unchanged";
      }

      metadataCell.className = "metadata-cell";
      const metadataTooltip = createMetadataTooltip(file, fileIndex);
      metadataCell.append(metadataTooltip);

      currentCell.append(currentFileName, currentFileLocation);
      targetCell.append(targetFileName, targetFileLocation);

      row.append(currentCell, targetCell, metadataCell);
      fileTableBody.append(row);

      if (fileIndex === tooltipIndexToRestore && metadataTooltip.isMetadataButtonHovered()) {
        tooltipToRestore = metadataTooltip;
      }

      fileIndex += 1;
    });
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
      selectedAlbums = normalizeSelectedAlbums(result);
      selectedFiles = selectedAlbums.flatMap((album) => album.files);
      fetchedAlbum = null;
      metadataStatus.textContent = "Metadata not loaded.";
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

function getFetchedMetadataKey(track) {
  if (!Number.isFinite(track.discNumber) || !Number.isFinite(track.trackNumber)) {
    return "";
  }

  return `${track.discNumber}:${track.trackNumber}`;
}

function normalizeSelectedAlbums(result) {
  const albums = Array.isArray(result.albums) && result.albums.length > 0
    ? result.albums
    : [{
      folderPath: result.folderPath,
      folderName: getBaseName(result.folderPath),
      files: result.files || []
    }];

  return albums.map((album) => ({
    ...album,
    folderName: album.folderName || getBaseName(album.folderPath),
    expanded: album.expanded !== false,
    fetchedAlbum: album.fetchedAlbum || null,
    files: album.files || []
  }));
}

function applyFetchedMetadata(album, albumData) {
  const tracksByKey = new Map();

  albumData.tracks.forEach((track) => {
    const key = getFetchedMetadataKey(track);

    if (key) {
      tracksByKey.set(key, track);
    }
  });

  album.fetchedAlbum = albumData;
  album.files = album.files.map((file, index) => {
    const matchingTrack = tracksByKey.get(getLocalMetadataKey(file)) || albumData.tracks[index] || null;

    return {
      ...file,
      fetchedMetadata: matchingTrack
    };
  });
}

async function fetchAlbumMusicBrainzMetadata(album) {
  const metadata = album.files.find(
    (file) =>
      file.metadata?.album &&
      (file.metadata?.albumArtist || file.metadata?.artist)
  )?.metadata;

  const payload = {
    artist: metadata?.albumArtist || metadata?.artist,
    album: metadata?.album
  };

  const albumData = await window.musicMetadataSync.fetchMusicBrainzAlbum(payload);

  applyFetchedMetadata(album, albumData);
  return albumData;
}

async function fetchMusicBrainzMetadata() {
  fetchMusicBrainzButton.disabled = true;
  fetchMusicBrainzButton.textContent = "Fetching...";
  metadataStatus.textContent = "Searching MusicBrainz...";

  try {
    const loaded = [];
    const failed = [];

    for (const album of selectedAlbums) {
      metadataStatus.textContent = `Searching MusicBrainz for ${getBaseName(album.folderPath)}...`;

      try {
        loaded.push(await fetchAlbumMusicBrainzMetadata(album));
      } catch (error) {
        failed.push(`${getBaseName(album.folderPath)}: ${error.message}`);
      }
    }

    fetchedAlbum = selectedAlbums.length === 1 ? selectedAlbums[0].fetchedAlbum : null;

    if (loaded.length === 0 && failed.length > 0) {
      throw new Error(failed.join("\n"));
    }

    metadataStatus.textContent = failed.length > 0
      ? `Loaded ${loaded.length} album metadata set${loaded.length === 1 ? "" : "s"}. Failed: ${failed.join(" | ")}`
      : `Loaded ${loaded.length} album metadata set${loaded.length === 1 ? "" : "s"} from MusicBrainz.`;
    renderFiles({ restoreActiveTooltip: true });
  } catch (error) {
    metadataStatus.textContent = error.message;
    window.alert(error.message);
  } finally {
    fetchMusicBrainzButton.disabled = false;
    fetchMusicBrainzButton.textContent = "MusicBrainz";
  }
}

fetchMusicBrainzButton.addEventListener("click", async () => {
  await fetchMusicBrainzMetadata();
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
    const isSingleAlbumSelection = selectedAlbums.length === 1;
    const result = await window.musicMetadataSync.applyFolderWorkflow({
      albums: selectedAlbums.map((album) => ({
        folderPath: album.folderPath,
        folderName: buildFolderName(album),
        files: album.files
      }))
    });

    if (isSingleAlbumSelection && result.albums?.[0]?.folderPath) {
      selectedFolderPath = result.albums[0].folderPath;
      folderLabel.textContent = selectedFolderPath;
    }

    selectedAlbums = normalizeSelectedAlbums({
      folderPath: selectedFolderPath,
      albums: result.albums
    });
    selectedFiles = selectedAlbums.flatMap((album) => album.files);
    fetchedAlbum = null;
    metadataStatus.textContent = "Metadata applied.";
    renderFiles();
  } catch (error) {
    window.alert(error.message);
  } finally {
    applyButton.textContent = "Apply Changes";
    renderFiles();
  }
});

document.addEventListener("click", (event) => {
  if (!activeMetadataTooltip) {
    return;
  }

  if (
    activeMetadataTooltip.element.contains(event.target)
  ) {
    return;
  }

  hideActiveMetadataTooltip();
});

renderFiles();
