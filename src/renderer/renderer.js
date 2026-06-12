const chooseFolderButton = document.querySelector("#chooseFolderButton");
const applyButton = document.querySelector("#applyButton");
const folderStatus = document.querySelector("#folderStatus");
const fetchMusicBrainzButton = document.querySelector("#fetchMusicBrainzButton");
const metadataStatus = document.querySelector("#metadataStatus");
const fileCount = document.querySelector("#fileCount");
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

function openAlbumEditDialog(album) {
  const albumData = album.fetchedAlbum;

  if (!albumEditDialog || !albumEditFields || !albumData) {
    return;
  }

  editingAlbum = album;
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
  albumSection.className = "album-edit-section";
  albumSection.append(
    createAlbumEditField("Album artist", artistControl),
    createAlbumEditField("Album title", albumTitleInput)
  );

  const tracksSection = document.createElement("div");
  const tracksHeading = document.createElement("h3");

  tracksSection.className = "album-edit-section album-edit-tracks";
  tracksHeading.textContent = `Track titles (${albumData.tracks.length})`;
  tracksSection.append(tracksHeading);

  albumData.tracks.forEach((track, index) => {
    const trackTitleInput = document.createElement("input");
    const trackNumber = track.track || index + 1;

    trackTitleInput.type = "text";
    trackTitleInput.name = "trackTitle";
    trackTitleInput.value = track.title || "";
    trackTitleInput.required = true;
    tracksSection.append(createAlbumEditField(`Track ${trackNumber}`, trackTitleInput));
  });

  albumEditFields.append(albumSection, tracksSection);
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

function renderTrackDetailsContent(container, file) {
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

  container.replaceChildren();

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
    ? () => openAlbumEditDialog(selectedAlbum)
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
  fileCount.textContent = `${selectedFiles.length} ${selectedFiles.length === 1 ? "file" : "files"}`;

  applyButton.disabled = selectedAlbums.length === 0 || selectedFiles.length === 0;
  fileTableBody.replaceChildren();

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
      const targetPreviewName = buildPreviewName(file);
      const isFileNameChanged = normalizeComparableFileName(file.name) !==
        normalizeComparableFileName(targetPreviewName);

      row.className = "track-row";
      row.classList.toggle("is-selected", file.path === selectedTrackPath);
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-pressed", String(file.path === selectedTrackPath));
      currentFileName.textContent = file.name;
      targetFileName.textContent = targetPreviewName;

      if (isFileNameChanged) {
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

function isOnlyArtistId(value, artistId) {
  const values = (Array.isArray(value) ? value : [value]).filter(Boolean);

  return Boolean(artistId) && values.length === 1 && values[0] === artistId;
}

function applyAlbumEdit(album, albumArtist, albumTitle, trackTitles) {
  const albumData = album.fetchedAlbum;

  if (!albumData || !albumArtist || !albumTitle) {
    return;
  }

  const updatedTracks = albumData.tracks.map((track, index) => {
    const usesAlbumArtist = isOnlyArtistId(
      track.flacTags?.MUSICBRAINZ_ARTISTID,
      albumData.albumArtistId
    );
    const trackTitle = trackTitles[index] || track.title;

    return {
      ...track,
      artist: usesAlbumArtist ? albumArtist : track.artist,
      albumArtist,
      album: albumTitle,
      title: trackTitle,
      flacTags: {
        ...(track.flacTags || {}),
        ALBUMARTIST: albumArtist,
        ALBUM: albumTitle,
        TITLE: trackTitle,
        ...(usesAlbumArtist ? { ARTIST: albumArtist } : {})
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
    return;
  }

  event.preventDefault();

  if (!albumEditForm.reportValidity()) {
    return;
  }

  const formData = new FormData(albumEditForm);
  const albumArtist = String(formData.get("albumArtist") || "").trim();
  const albumTitle = String(formData.get("albumTitle") || "").trim();
  const trackTitleInputs = [...albumEditFields.querySelectorAll('[name="trackTitle"]')];
  const trackTitles = trackTitleInputs.map((input) => input.value.trim());

  if (!albumArtist || !albumTitle || trackTitles.some((title) => !title)) {
    const emptyControl = [...albumEditForm.elements].find((control) =>
      typeof control.value === "string" && !control.value.trim()
    );

    emptyControl?.focus();
    return;
  }

  applyAlbumEdit(editingAlbum, albumArtist, albumTitle, trackTitles);
  editingAlbum = null;
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
