const chooseFolderButton = document.querySelector("#chooseFolderButton");
const applyButton = document.querySelector("#applyButton");
const folderStatus = document.querySelector("#folderStatus");
const fetchMusicBrainzButton = document.querySelector("#fetchMusicBrainzButton");
const metadataStatus = document.querySelector("#metadataStatus");
const albumCount = document.querySelector("#albumCount");
const fileTableBody = document.querySelector("#fileTableBody");
const fileTableWrap = fileTableBody.closest(".table-wrap");
const trackDetailsFileName = document.querySelector("#trackDetailsFileName");
const trackDetailsContent = document.querySelector("#trackDetailsContent");
const editTrackAlbumButton = document.querySelector("#editTrackAlbumButton");
const applyConfirmDialog = document.querySelector("#applyConfirmDialog");
const cancelApplyButton = document.querySelector("#cancelApplyButton");
const errorDialog = document.querySelector("#errorDialog");
const errorDialogMessage = document.querySelector("#errorDialogMessage");
const closeErrorDialogButton = document.querySelector("#closeErrorDialogButton");
const albumEditDialog = document.querySelector("#albumEditDialog");
const albumEditForm = document.querySelector("#albumEditForm");
const albumEditDialogDescription = document.querySelector("#albumEditDialogDescription");
const albumEditFields = document.querySelector("#albumEditFields");
const cancelAlbumEditButton = document.querySelector("#cancelAlbumEditButton");
const folderPathCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base"
});
const embeddedArtworkCache = new Map();

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
let selectedFolderPaths = [];
let fetchedAlbum = null;
let busyCount = 0;
let editingAlbum = null;
let editingTrackIndex = -1;
let selectedTrackPath = "";

function setBusy(isBusy) {
  busyCount = Math.max(0, busyCount + (isBusy ? 1 : -1));
  document.body.classList.toggle("is-busy", busyCount > 0);
}

function getErrorMessage(error) {
  return String(error?.message || error || "Something went wrong.")
    .replace(/^Error invoking remote method '[^']+': Error:\s*/u, "")
    .trim();
}

function setMetadataStatus(message, isError = false) {
  metadataStatus.textContent = message;
  metadataStatus.classList.toggle("is-error", isError);
}

function setFolderStatus(message, isError = false) {
  const selectionLabel = selectedFolderPaths.length === 1
    ? `Folder: ${selectedFolderPaths[0]}`
    : selectedFolderPaths.length > 1
      ? `Folders (${selectedFolderPaths.length}):\n${selectedFolderPaths.join("\n")}`
      : "";

  folderStatus.textContent = selectionLabel
    ? `${selectionLabel}\n${message}`
    : message;
  folderStatus.classList.toggle("is-error", isError);
}

function confirmApplyChanges() {
  return new Promise((resolve) => {
    if (!applyConfirmDialog) {
      resolve(false);
      return;
    }

    const handleClose = () => {
      applyConfirmDialog.removeEventListener("close", handleClose);
      resolve(applyConfirmDialog.returnValue === "confirm");
    };

    applyConfirmDialog.addEventListener("close", handleClose);
    applyConfirmDialog.returnValue = "cancel";
    applyConfirmDialog.showModal();
    cancelApplyButton?.focus();
  });
}

function showErrorDialog(message) {
  return new Promise((resolve) => {
    if (!errorDialog || !errorDialogMessage) {
      resolve();
      return;
    }

    const handleClose = () => {
      errorDialog.removeEventListener("close", handleClose);
      resolve();
    };

    errorDialogMessage.textContent = message;
    errorDialog.addEventListener("close", handleClose);
    errorDialog.showModal();
    closeErrorDialogButton?.focus();
  });
}

function createAlbumEditField(labelText, control) {
  const field = document.createElement("label");
  const label = document.createElement("span");

  field.className = "album-edit-field";
  label.textContent = labelText;
  field.append(label, control);
  return field;
}

function getAlbumTrackIndex(album, file) {
  const tracks = album?.fetchedAlbum?.tracks || [];
  const directIndex = tracks.indexOf(file?.fetchedMetadata);

  if (directIndex >= 0) {
    return directIndex;
  }

  const metadataKey = getLocalMetadataKey(file);
  const keyedIndex = tracks.findIndex((track) => getFetchedMetadataKey(track) === metadataKey);

  if (keyedIndex >= 0) {
    return keyedIndex;
  }

  return album?.files?.findIndex((albumFile) => albumFile.path === file?.path) ?? -1;
}

function openAlbumEditDialog(album, file) {
  const albumData = album.fetchedAlbum;
  const trackIndex = getAlbumTrackIndex(album, file);
  const track = albumData?.tracks?.[trackIndex];

  if (!albumEditDialog || !albumEditFields || !albumData || !track) {
    return;
  }

  editingAlbum = album;
  editingTrackIndex = trackIndex;
  albumEditDialogDescription.textContent = getBaseName(album.folderPath);
  albumEditFields.replaceChildren();

  const artistOptions = albumData.albumArtistOptions || [];
  const selectedArtist = albumData.selectedAlbumArtist || albumData.albumArtist || "";
  let artistControl;

  if (artistOptions.length > 1) {
    artistControl = document.createElement("select");

    artistOptions.forEach((option) => {
      const optionElement = document.createElement("option");
      const details = [option.locale, option.source].filter(Boolean).join(", ");

      optionElement.value = option.name;
      optionElement.textContent = details
        ? `${option.name} (${details})`
        : option.name;
      artistControl.append(optionElement);
    });

    if (![...artistControl.options].some((option) => option.value === selectedArtist)) {
      const selectedOption = document.createElement("option");

      selectedOption.value = selectedArtist;
      selectedOption.textContent = selectedArtist;
      artistControl.prepend(selectedOption);
    }
  } else {
    artistControl = document.createElement("input");
    artistControl.type = "text";
  }

  artistControl.name = "albumArtist";
  artistControl.value = selectedArtist;
  artistControl.required = true;

  const albumTitleInput = document.createElement("input");
  albumTitleInput.type = "text";
  albumTitleInput.name = "albumTitle";
  albumTitleInput.value = albumData.album || "";
  albumTitleInput.required = true;

  const albumSection = document.createElement("div");
  const albumHeading = document.createElement("h3");

  albumSection.className = "album-edit-section";
  albumHeading.className = "album-edit-preview";
  albumSection.append(
    albumHeading,
    createAlbumEditField("Album artist", artistControl),
    createAlbumEditField("Album title", albumTitleInput)
  );

  const trackSection = document.createElement("div");
  const trackHeading = document.createElement("h3");
  const trackTitleInput = document.createElement("input");
  const trackArtistInput = document.createElement("input");

  trackSection.className = "album-edit-section album-edit-track";
  trackHeading.className = "album-edit-preview";
  trackHeading.textContent = `Track ${track.track || trackIndex + 1}`;
  trackTitleInput.type = "text";
  trackTitleInput.name = "trackTitle";
  trackTitleInput.value = track.title || "";
  trackTitleInput.required = true;
  trackArtistInput.type = "text";
  trackArtistInput.name = "trackArtist";
  trackArtistInput.value = track.artist || "";
  trackArtistInput.required = true;

  const updatePreviews = () => {
    const albumArtist = artistControl.value.trim();
    const albumTitle = albumTitleInput.value.trim();
    const trackTitle = trackTitleInput.value.trim();
    const trackNumber = track.track || trackIndex + 1;

    albumHeading.textContent = [albumArtist, albumTitle].filter(Boolean).join(" - ") || "Album";
    trackHeading.textContent = trackTitle
      ? `${trackNumber}. ${trackTitle}`
      : `Track ${trackNumber}`;
  };

  artistControl.addEventListener("input", updatePreviews);
  artistControl.addEventListener("change", updatePreviews);
  albumTitleInput.addEventListener("input", updatePreviews);
  trackTitleInput.addEventListener("input", updatePreviews);
  trackSection.append(
    trackHeading,
    createAlbumEditField("Track title", trackTitleInput),
    createAlbumEditField("Track artist", trackArtistInput)
  );

  albumEditFields.append(albumSection, trackSection);
  updatePreviews();
  albumEditDialog.returnValue = "cancel";
  albumEditDialog.showModal();
  cancelAlbumEditButton?.focus();
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

function buildTrackDisplayName(metadata = {}) {
  const track = String(metadata.track || metadata.trackNumber || "").trim();
  const title = String(metadata.title || "").trim();

  if (track && title) {
    return `${track}. ${title}`;
  }

  return title || (track ? `Track ${track}` : "Unknown track");
}

function getAlbumMetadata(album) {
  return album?.files.find(
    (file) =>
      file.metadata?.album &&
      (file.metadata?.albumArtist || file.metadata?.artist)
  )?.metadata || null;
}

function getAlbumDisplayName(metadata) {
  const artist = metadata?.albumArtist || metadata?.artist;
  const album = metadata?.album;

  return [artist, album].filter(Boolean).join(" - ") || "unknown album";
}

function getFetchedAlbumDisplayName(album) {
  if (album.fetchError) {
    return `failed: ${album.fetchError}`;
  }

  if (!album.fetchedAlbum) {
    return "not fetched";
  }

  return getAlbumDisplayName({
    albumArtist: album.fetchedAlbum.albumArtist,
    album: album.fetchedAlbum.album
  });
}

function buildMusicBrainzFetchReport() {
  const lines = [
    "Album folder comparison report",
    `Generated: ${new Date().toLocaleString()}`,
    `Root folders: ${selectedFolderPaths.length || "unknown"}`,
    ...selectedFolderPaths.map((folderPath) => `  ${folderPath}`),
    "",
    `Albums: ${selectedAlbums.length}`,
    ""
  ];

  selectedAlbums.forEach((album, albumIndex) => {
    const metadata = getAlbumMetadata(album);
    const currentFolderName = getBaseName(album.folderPath);
    const targetFolderName = buildFolderName(album) || currentFolderName;
    const currentFolderPath = album.folderPath || "";
    const targetFolderPath = buildTargetFolderPath(album);
    const folderComparison = normalizeComparableFileName(currentFolderName) ===
      normalizeComparableFileName(targetFolderName)
      ? "same"
      : "changed";

    lines.push(
      `Album ${albumIndex + 1}`,
      `Folder: ${folderComparison}`,
      `  current name: ${currentFolderName}`,
      `  target name:  ${targetFolderName}`,
      `  current path: ${currentFolderPath}`,
      `  target path:  ${targetFolderPath}`,
      `Local album: ${getAlbumDisplayName(metadata)}`,
      `Fetched album: ${getFetchedAlbumDisplayName(album)}`,
      `MusicBrainz URL: ${album.fetchedAlbum?.musicbrainzUrl || ""}`,
      "Filename comparison:"
    );

    album.files.forEach((file, fileIndex) => {
      const targetName = file.fetchedMetadata ? buildPreviewName(file) : "not fetched";
      const comparison = file.fetchedMetadata && file.name !== targetName
        ? "changed"
        : (file.fetchedMetadata ? "same" : "missing");

      lines.push(
        `  ${fileIndex + 1}. ${comparison}`,
        `     current: ${file.name}`,
        `     target:  ${targetName}`
      );
    });

    lines.push("");
  });

  return `${lines.join("\n")}\n`;
}

async function writeMusicBrainzFetchReport() {
  return window.musicMetadataSync.writeReport({
    folderPaths: selectedFolderPaths,
    content: buildMusicBrainzFetchReport()
  });
}

function formatMetadataValue(value, options = {}) {
  if (value === null || value === undefined || value === "") {
    return options.blankEmpty ? "" : "empty";
  }

  return Array.isArray(value) ? value.join(";") : String(value);
}

function normalizeMetadataComparisonValue(value) {
  const values = Array.isArray(value)
    ? value
    : String(value ?? "")
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean);

  return values.length > 0
    ? values.join("\u0000")
    : String(value ?? "").trim();
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
  const currentComparable = normalizeMetadataComparisonValue(currentValue);
  const targetComparable = normalizeMetadataComparisonValue(targetValue);
  const hasTargetValue = targetValue !== undefined;
  const hasCurrentValue = hasMetadataValue(currentValue);
  const isRemovingValue = hasTargetValue && (
    targetValue === null ||
    targetValue === ""
  );

  row.className = "track-details-row";
  labelElement.textContent = label.toUpperCase();

  if (hasTargetValue && currentComparable !== targetComparable) {
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

  section.className = "track-details-section";
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
    "track",
    "discnumber",
    "tracknumber"
  ]);

  return keyMetadataTags.has(normalizeMetadataKey(key));
}

function getEmbeddedArtwork(filePath) {
  if (!embeddedArtworkCache.has(filePath)) {
    embeddedArtworkCache.set(
      filePath,
      window.musicMetadataSync.readEmbeddedArtwork(filePath).catch(() => "")
    );
  }

  return embeddedArtworkCache.get(filePath);
}

function renderTrackDetailsContent(container, file) {
  const currentMetadata = file.metadata || {};
  const targetMetadata = file.fetchedMetadata || {};
  const fetchedArtworkUrl = targetMetadata.coverArt?.embed || targetMetadata.coverArt?.original || "";
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

  container.replaceChildren();

  const artworkPreview = document.createElement("div");
  const artwork = document.createElement("img");
  const artworkTabs = document.createElement("div");
  const originalArtworkTab = document.createElement("button");
  const fetchedArtworkTab = document.createElement("button");
  const artworkPath = file.path;
  let embeddedArtworkUrl = "";

  artworkPreview.className = "track-details-artwork-preview";
  artwork.className = "track-details-artwork";
  artworkTabs.className = "track-details-artwork-tabs";
  originalArtworkTab.className = "track-details-artwork-tab";
  originalArtworkTab.type = "button";
  originalArtworkTab.textContent = "Original";
  originalArtworkTab.hidden = true;
  fetchedArtworkTab.className = "track-details-artwork-tab";
  fetchedArtworkTab.type = "button";
  fetchedArtworkTab.textContent = "MusicBrainz";
  fetchedArtworkTab.hidden = !fetchedArtworkUrl;
  artwork.alt = (targetMetadata.album || currentMetadata.album)
    ? `${targetMetadata.album || currentMetadata.album} cover artwork`
    : "Album cover artwork";
  artworkPreview.hidden = !fetchedArtworkUrl;
  artwork.addEventListener("error", () => {
    artworkPreview.hidden = true;
  });

  if (fetchedArtworkUrl) {
    artwork.src = fetchedArtworkUrl;
    fetchedArtworkTab.classList.add("is-active");
  }

  originalArtworkTab.addEventListener("click", () => {
    if (!embeddedArtworkUrl) {
      return;
    }

    artwork.src = embeddedArtworkUrl;
    originalArtworkTab.classList.add("is-active");
    fetchedArtworkTab.classList.remove("is-active");
  });
  fetchedArtworkTab.addEventListener("click", () => {
    if (!fetchedArtworkUrl) {
      return;
    }

    artwork.src = fetchedArtworkUrl;
    fetchedArtworkTab.classList.add("is-active");
    originalArtworkTab.classList.remove("is-active");
  });

  artworkTabs.append(originalArtworkTab, fetchedArtworkTab);
  artworkPreview.append(artwork, artworkTabs);
  container.append(artworkPreview);

  getEmbeddedArtwork(artworkPath).then((loadedEmbeddedArtworkUrl) => {
    if (
      loadedEmbeddedArtworkUrl &&
      selectedTrackPath === artworkPath &&
      artworkPreview.isConnected
    ) {
      embeddedArtworkUrl = loadedEmbeddedArtworkUrl;
      artwork.src = embeddedArtworkUrl;
      originalArtworkTab.hidden = false;
      originalArtworkTab.classList.add("is-active");
      fetchedArtworkTab.classList.remove("is-active");
      artworkPreview.hidden = false;
    }
  });

  keyRows.forEach(([label, currentValue, targetValue]) => {
    keySection.append(createMetadataLine(label, currentValue, file.fetchedMetadata ? targetValue : undefined, {
      blankEmpty: true
    }));
  });

  container.append(keySection);

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
          ? flacTag[1]
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
        targetValue: value
      });
    });

    additionalRows
      .sort((a, b) => a.label.localeCompare(b.label))
      .forEach((row) => {
        otherSection.append(
          createMetadataLine(row.label, row.currentValue, row.targetValue)
        );
      });

    container.append(otherSection);
  }
}

function renderTrackDetailsPanel() {
  const selectedFile = selectedFiles.find((file) => file.path === selectedTrackPath);
  const selectedAlbum = selectedAlbums.find((album) =>
    album.files.some((file) => file.path === selectedTrackPath)
  );

  if (!trackDetailsContent || !trackDetailsFileName) {
    return;
  }

  if (!selectedFile) {
    selectedTrackPath = "";
    trackDetailsFileName.textContent = "No track selected";
    editTrackAlbumButton.disabled = true;
    editTrackAlbumButton.onclick = null;

    const emptyMessage = document.createElement("p");

    emptyMessage.className = "track-details-empty";
    emptyMessage.textContent = "Select a track to view its metadata.";
    trackDetailsContent.replaceChildren(emptyMessage);
    return;
  }

  trackDetailsFileName.textContent = selectedFile.name;
  editTrackAlbumButton.disabled = !selectedAlbum?.fetchedAlbum;
  editTrackAlbumButton.onclick = selectedAlbum?.fetchedAlbum
    ? () => openAlbumEditDialog(selectedAlbum, selectedFile)
    : null;
  renderTrackDetailsContent(trackDetailsContent, selectedFile);
}

function renderFiles(options = {}) {
  const scrollTopToRestore = options.preserveScroll
    ? fileTableWrap?.scrollTop
    : null;

  function restoreScrollPosition() {
    if (scrollTopToRestore !== null && fileTableWrap) {
      fileTableWrap.scrollTop = scrollTopToRestore;
    }
  }

  selectedFiles = selectedAlbums.flatMap((album) => album.files);
  albumCount.textContent = selectedAlbums.length === 0
    ? "No album selected"
    : `${selectedAlbums.length} ${selectedAlbums.length === 1 ? "album" : "albums"}`;

  applyButton.disabled = selectedAlbums.length === 0 || selectedFiles.length === 0;
  fileTableBody.replaceChildren();
  fileTableBody.classList.toggle("is-empty", selectedFiles.length === 0);
  fileTableBody.closest(".preview-table")?.classList.toggle(
    "is-empty",
    selectedFiles.length === 0
  );

  if (selectedFiles.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.className = "empty-state";
    cell.colSpan = 1;
    cell.textContent = "No audio files found in this folder.";
    row.append(cell);
    fileTableBody.append(row);
    renderTrackDetailsPanel();
    restoreScrollPosition();
    return;
  }

  selectedAlbums.forEach((album) => {
    const albumRow = document.createElement("tr");
    const albumCell = document.createElement("td");
    const albumHeader = document.createElement("div");
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
    albumCell.colSpan = 1;
    albumHeader.className = "album-group-header";
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
      renderFiles({
        preserveScroll: true
      });
    });

    albumHeader.append(toggleButton);

    albumCell.append(albumHeader);
    albumRow.append(albumCell);
    fileTableBody.append(albumRow);

    if (!isExpanded) {
      return;
    }

    album.files.forEach((file) => {
      const row = document.createElement("tr");
      const fileNameCell = document.createElement("td");
      const currentFileName = document.createElement("strong");
      const targetFileName = document.createElement("strong");
      const currentTrackName = buildTrackDisplayName(file.metadata);
      const targetTrackName = file.fetchedMetadata
        ? buildTrackDisplayName(file.fetchedMetadata)
        : currentTrackName;
      const isTrackNameChanged = currentTrackName.localeCompare(
        targetTrackName,
        undefined,
        { sensitivity: "base" }
      ) !== 0;

      row.className = "track-row";
      row.classList.toggle("is-selected", file.path === selectedTrackPath);
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-pressed", String(file.path === selectedTrackPath));
      currentFileName.textContent = currentTrackName;
      targetFileName.textContent = targetTrackName;

      if (isTrackNameChanged) {
        currentFileName.className = "file-name-old";
        targetFileName.className = "file-name-new";
        fileNameCell.append(currentFileName, targetFileName);
      } else {
        targetFileName.className = "file-name-unchanged";
        fileNameCell.append(targetFileName);
      }

      const selectTrack = () => {
        selectedTrackPath = file.path;
        renderFiles({
          preserveScroll: true
        });
      };

      row.addEventListener("click", selectTrack);
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectTrack();
        }
      });

      row.append(fileNameCell);
      fileTableBody.append(row);
    });
  });

  renderTrackDetailsPanel();
  restoreScrollPosition();
}

chooseFolderButton.addEventListener("click", async () => {
  setBusy(true);
  chooseFolderButton.disabled = true;
  chooseFolderButton.textContent = "Choosing...";
  setFolderStatus("Waiting for folder selection...");

  try {
    const result = await window.musicMetadataSync.chooseFolder();

    if (result) {
      embeddedArtworkCache.clear();
      selectedFolderPaths = result.folderPaths || [result.folderPath].filter(Boolean);
      selectedAlbums = normalizeSelectedAlbums(result, {
        defaultExpanded: false
      });
      selectedFiles = selectedAlbums.flatMap((album) => album.files);
      selectedTrackPath = "";
      fetchedAlbum = null;
      setMetadataStatus("Metadata not loaded.");
      setFolderStatus(
        `Loaded ${selectedAlbums.length} album${selectedAlbums.length === 1 ? "" : "s"} with ` +
        `${selectedFiles.length} audio file${selectedFiles.length === 1 ? "" : "s"}.`
      );
      renderFiles();
    } else {
      setFolderStatus("Folder selection canceled.");
    }
  } catch (error) {
    const message = getErrorMessage(error);

    setFolderStatus(message, true);
    await showErrorDialog(message);
  } finally {
    chooseFolderButton.disabled = false;
    chooseFolderButton.textContent = "Choose Folders";
    setBusy(false);
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

function normalizeSelectedAlbums(result, options = {}) {
  const defaultExpanded = options.defaultExpanded !== false;
  const albums = Array.isArray(result.albums) && result.albums.length > 0
    ? result.albums
    : [{
      folderPath: result.folderPath,
      folderName: getBaseName(result.folderPath),
      files: result.files || []
    }];

  return albums
    .map((album) => ({
      ...album,
      folderName: album.folderName || getBaseName(album.folderPath),
      expanded: album.expanded ?? defaultExpanded,
      fetchedAlbum: album.fetchedAlbum || null,
      files: album.files || []
    }))
    .sort((left, right) =>
      folderPathCollator.compare(
        String(left.folderPath || ""),
        String(right.folderPath || "")
      )
    );
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

function applyAlbumEdit(album, albumArtist, albumTitle, trackIndex, trackTitle, trackArtist) {
  const albumData = album.fetchedAlbum;

  if (
    !albumData ||
    !albumArtist ||
    !albumTitle ||
    !trackTitle ||
    !trackArtist ||
    trackIndex < 0
  ) {
    return;
  }

  const updatedTracks = albumData.tracks.map((track, index) => {
    const isSelectedTrack = index === trackIndex;
    const updatedTitle = isSelectedTrack ? trackTitle : track.title;
    const updatedArtist = isSelectedTrack ? trackArtist : track.artist;

    return {
      ...track,
      artist: updatedArtist,
      albumArtist,
      album: albumTitle,
      title: updatedTitle,
      flacTags: {
        ...(track.flacTags || {}),
        ALBUMARTIST: albumArtist,
        ALBUM: albumTitle,
        TITLE: updatedTitle,
        ARTIST: updatedArtist
      }
    };
  });

  applyFetchedMetadata(album, {
    ...albumData,
    albumArtist,
    selectedAlbumArtist: albumArtist,
    album: albumTitle,
    tracks: updatedTracks
  });
}

albumEditForm?.addEventListener("submit", (event) => {
  if (event.submitter?.value === "cancel" || !editingAlbum) {
    editingAlbum = null;
    editingTrackIndex = -1;
    return;
  }

  event.preventDefault();

  if (!albumEditForm.reportValidity()) {
    return;
  }

  const formData = new FormData(albumEditForm);
  const albumArtist = String(formData.get("albumArtist") || "").trim();
  const albumTitle = String(formData.get("albumTitle") || "").trim();
  const trackTitle = String(formData.get("trackTitle") || "").trim();
  const trackArtist = String(formData.get("trackArtist") || "").trim();

  if (!albumArtist || !albumTitle || !trackTitle || !trackArtist) {
    const emptyControl = [...albumEditForm.elements].find((control) =>
      typeof control.value === "string" && !control.value.trim()
    );

    emptyControl?.focus();
    return;
  }

  applyAlbumEdit(
    editingAlbum,
    albumArtist,
    albumTitle,
    editingTrackIndex,
    trackTitle,
    trackArtist
  );
  editingAlbum = null;
  editingTrackIndex = -1;
  albumEditDialog.close("save");
  renderFiles({
    preserveScroll: true
  });
});

async function fetchAlbumMusicBrainzMetadata(album) {
  const metadata = getAlbumMetadata(album);

  const payload = {
    artist: metadata?.albumArtist || metadata?.artist,
    album: metadata?.album,
    trackCount: album.files.length
  };

  const albumData = await window.musicMetadataSync.fetchMusicBrainzAlbum(payload);

  applyFetchedMetadata(album, albumData);
  album.fetchError = "";
  return albumData;
}

async function fetchMusicBrainzMetadata() {
  setBusy(true);
  fetchMusicBrainzButton.disabled = true;
  fetchMusicBrainzButton.textContent = "Fetching...";
  setMetadataStatus("Searching MusicBrainz...");

  try {
    const loaded = [];
    const failed = [];

    for (const [albumIndex, album] of selectedAlbums.entries()) {
      setMetadataStatus(
        `Searching MusicBrainz for ${getBaseName(album.folderPath)} ` +
        `(${albumIndex + 1}/${selectedAlbums.length})...`
      );
      album.fetchError = "";
      album.fetchedAlbum = null;
      album.files = album.files.map((file) => ({
        ...file,
        fetchedMetadata: null
      }));

      try {
        loaded.push(await fetchAlbumMusicBrainzMetadata(album));
      } catch (error) {
        const message = error.message;

        album.fetchError = message;
        failed.push(`${getBaseName(album.folderPath)}: ${message}`);
      }
    }

    fetchedAlbum = selectedAlbums.length === 1 ? selectedAlbums[0].fetchedAlbum : null;
    setMetadataStatus("Writing MusicBrainz fetch report...");
    const report = await writeMusicBrainzFetchReport();
    const reportLine = report?.reportPath
      ? `Report: ${report.reportPath}`
      : "";

    if (loaded.length === 0 && failed.length > 0) {
      throw new Error([
        "Failed:",
        ...failed.map((message, index) => `${index + 1}. ${message}`),
        reportLine
      ].filter(Boolean).join("\n"));
    }

    const loadedLine = `Loaded ${loaded.length} album metadata set${loaded.length === 1 ? "" : "s"} from MusicBrainz.`;
    const statusLines = failed.length > 0
      ? [
          loadedLine,
          "Failed:",
          ...failed.map((message, index) => `${index + 1}. ${message}`),
          reportLine
        ]
      : [loadedLine, reportLine];

    setMetadataStatus(statusLines.filter(Boolean).join("\n"), failed.length > 0);
    renderFiles();
  } catch (error) {
    const message = getErrorMessage(error);

    setMetadataStatus(message, true);
    await showErrorDialog(message);
  } finally {
    fetchMusicBrainzButton.disabled = false;
    fetchMusicBrainzButton.textContent = "MusicBrainz";
    setBusy(false);
  }
}

fetchMusicBrainzButton.addEventListener("click", async () => {
  await fetchMusicBrainzMetadata();
});

applyButton.addEventListener("click", async () => {
  const shouldApplyChanges = await confirmApplyChanges();

  if (!shouldApplyChanges) {
    return;
  }

  setBusy(true);
  applyButton.disabled = true;
  applyButton.textContent = "Applying...";
  setFolderStatus(
    `Applying changes to ${selectedAlbums.length} album${selectedAlbums.length === 1 ? "" : "s"}...`
  );
  const removeApplyProgressListener = window.musicMetadataSync.onApplyProgress((progress) => {
    setFolderStatus(
      `Applying changes for ${progress.folderName} ` +
      `(${progress.current}/${progress.total})...`
    );
  });

  try {
    const submittedAlbums = selectedAlbums.map((album) => ({
      folderPath: album.folderPath,
      folderName: buildFolderName(album),
      files: album.files
    }));
    const result = await window.musicMetadataSync.applyFolderWorkflow({
      albums: submittedAlbums
    });
    const updatedPathsByOriginalPath = new Map(
      submittedAlbums.map((album, index) => [
        album.folderPath.toLowerCase(),
        result.albums?.[index]?.folderPath || album.folderPath
      ])
    );

    selectedFolderPaths = selectedFolderPaths.map((folderPath) =>
      updatedPathsByOriginalPath.get(folderPath.toLowerCase()) || folderPath
    );

    selectedAlbums = normalizeSelectedAlbums({
      folderPath: selectedFolderPaths[0] || "",
      albums: result.albums
    });
    embeddedArtworkCache.clear();
    selectedFiles = selectedAlbums.flatMap((album) => album.files);
    fetchedAlbum = null;
    setMetadataStatus("Metadata applied.");
    setFolderStatus(
      `Applied changes to ${selectedAlbums.length} album${selectedAlbums.length === 1 ? "" : "s"} ` +
      `and ${selectedFiles.length} audio file${selectedFiles.length === 1 ? "" : "s"}.`
    );
    renderFiles();
  } catch (error) {
    const message = getErrorMessage(error);

    setFolderStatus(message, true);
    await showErrorDialog(message);
  } finally {
    removeApplyProgressListener();
    applyButton.textContent = "Apply Changes";
    renderFiles();
    setBusy(false);
  }
});

renderFiles();
