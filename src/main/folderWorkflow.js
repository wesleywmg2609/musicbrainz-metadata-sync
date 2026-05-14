const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { addMetadata, sortFilesByMetadata, walkAudioFiles } = require("./audio");

const execFileAsync = promisify(execFile);

function cleanFileName(name) {
  return name
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*']/g, "")
    .replace(/\p{C}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSpotifyFileName(metadata, extension) {
  const track = String(metadata.track || metadata.trackNumber || "").padStart(2, "0");
  const title = cleanFileName(metadata.title || "");

  if (!track || !title) {
    return "";
  }

  return `${track}. ${title}${extension}`;
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
  return filePath;
}

async function removeMetadataFields(filePath, fields) {
  if (path.extname(filePath).toLowerCase() !== ".flac" || fields.length === 0) {
    return;
  }

  const fieldsToRemove = [...new Set(
    fields
      .map((field) => String(field || "").trim())
      .filter(Boolean)
      .flatMap((field) => [field, field.toUpperCase()])
  )];

  for (const field of fieldsToRemove) {
    try {
      await execFileAsync("metaflac", [`--remove-tag=${field}`, filePath]);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error("metaflac is required to remove FLAC metadata fields. Install FLAC tools and try again.");
      }

      throw error;
    }
  }
}

async function writeFlacMetadata(filePath, metadata) {
  if (path.extname(filePath).toLowerCase() !== ".flac") {
    return;
  }

  await removeMetadataFields(filePath, ["TRACK", "DISCNUMBER"]);

  const tags = [
    ["TITLE", metadata.title],
    ["ARTIST", metadata.artist],
    ["ALBUM", metadata.album],
    ["ALBUMARTIST", metadata.albumArtist],
    ["DATE", metadata.date],
    ["GENRE", metadata.genre],
    ["TRACKNUMBER", metadata.track],
    ["DISC", metadata.disc]
  ];

  for (const [field, value] of tags) {
    if (!value) {
      continue;
    }

    try {
      await execFileAsync("metaflac", [
        `--remove-tag=${field}`,
        `--set-tag=${field}=${value}`,
        filePath
      ]);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error("metaflac is required to write FLAC metadata.");
      }

      throw error;
    }
  }
}

async function applyFolderWorkflow({ folderPath, folderName, metadataFieldsToRemove = [], files = [] }) {
  let targetFolderPath = folderPath;
  const safeFolderName = cleanFileName(folderName || "");

  if (safeFolderName) {
    targetFolderPath = path.join(path.dirname(folderPath), safeFolderName);

    if (targetFolderPath.toLowerCase() !== folderPath.toLowerCase()) {
      if (await pathExists(targetFolderPath)) {
        throw new Error(`Target folder already exists: ${targetFolderPath}`);
      }

      await renamePath(folderPath, targetFolderPath, "folder");
    }
  }

  const fieldsToRemove = Array.isArray(metadataFieldsToRemove)
    ? metadataFieldsToRemove
    : [];

  const audioFiles = await walkAudioFiles(targetFolderPath);

  let movedCount = 0;

  for (const file of audioFiles) {
    if (file.folder.toLowerCase() === targetFolderPath.toLowerCase()) {
      continue;
    }

    const destinationPath = await getAvailablePath(
      path.join(targetFolderPath, file.name)
    );

    await renamePath(file.path, destinationPath, "file");
    movedCount += 1;
  }

  if (fieldsToRemove.length > 0) {
    const currentFiles = await walkAudioFiles(targetFolderPath);

    for (const file of currentFiles) {
      await removeMetadataFields(file.path, fieldsToRemove);
    }
  }

  for (const file of files) {
    if (!file.spotifyMetadata) {
      continue;
    }

    const currentPath = path.join(
      targetFolderPath,
      path.basename(file.path)
    );

    await writeFlacMetadata(currentPath, file.spotifyMetadata);

    const newFileName = buildSpotifyFileName(
      file.spotifyMetadata,
      path.extname(currentPath)
    );

    if (!newFileName) {
      continue;
    }

    const destinationPath = await getAvailablePath(
      path.join(targetFolderPath, newFileName)
    );

    if (destinationPath.toLowerCase() !== currentPath.toLowerCase()) {
      await renamePath(currentPath, destinationPath, "file");
    }
  }

  const updatedFiles = await addMetadata(
    await walkAudioFiles(targetFolderPath)
  );

  sortFilesByMetadata(updatedFiles);

  return {
    folderPath: targetFolderPath,
    files: updatedFiles,
    movedCount
  };
}

async function renamePath(sourcePath, destinationPath, type = "path") {
  try {
    await fs.rename(sourcePath, destinationPath);
  } catch (error) {
    if (error.code === "EPERM") {
      throw new Error(
        `Failed to rename ${type}. Windows blocked the operation.\n\n` +
        `From: ${sourcePath}\n` +
        `To: ${destinationPath}\n\n` +
        `Close File Explorer, MusicBee, terminal, or any app using this folder/file, then try again.`
      );
    }

    throw error;
  }
}

async function getFolderAudioFiles(folderPath) {
  const files = await addMetadata(await walkAudioFiles(folderPath));
  sortFilesByMetadata(files);

  return files;
}

module.exports = {
  applyFolderWorkflow,
  getFolderAudioFiles
};
