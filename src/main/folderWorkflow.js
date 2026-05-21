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

function buildFetchedFileName(metadata, extension) {
  const track = String(metadata.track || "").padStart(2, "0");
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

async function clearFlacMetadata(filePath) {
  if (path.extname(filePath).toLowerCase() !== ".flac") {
    return;
  }

  try {
    await execFileAsync("metaflac", ["--remove-all-tags", filePath]);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("metaflac is required to write FLAC metadata.");
    }

    throw error;
  }
}

async function writeFlacMetadata(filePath, metadata) {
  if (path.extname(filePath).toLowerCase() !== ".flac") {
    return;
  }

  await clearFlacMetadata(filePath);

  const tags = Object.entries(metadata.flacTags || {})
    .map(([field, value]) => [
      String(field || "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_"),
      value
    ])
    .filter(([field]) => field && !field.includes("="));

  for (const [field, value] of tags) {
    const values = (Array.isArray(value) ? value : [value])
      .map((item) => String(item || "").trim())
      .filter(Boolean);

    if (values.length === 0) {
      continue;
    }

    try {
      for (const item of values) {
        await execFileAsync("metaflac", [
          `--set-tag=${field}=${item}`,
          filePath
        ]);
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error("metaflac is required to write FLAC metadata.");
      }

      throw error;
    }
  }
}

async function applyFolderWorkflow({ folderPath, folderName, files = [] }) {
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

  const audioFiles = await walkAudioFiles(targetFolderPath);

  let movedCount = 0;

  for (const file of audioFiles) {
    if (file.folder.toLowerCase() === targetFolderPath.toLowerCase()) {
      continue;
    }

    const destinationPath = path.join(targetFolderPath, file.name);

    await renamePath(file.path, destinationPath, "file");
    movedCount += 1;
  }

  for (const file of files) {
    if (!file.fetchedMetadata) {
      continue;
    }

    const currentPath = path.join(
      targetFolderPath,
      path.basename(file.path)
    );

    await writeFlacMetadata(currentPath, file.fetchedMetadata);

    const newFileName = buildFetchedFileName(
      file.fetchedMetadata,
      path.extname(currentPath)
    );

    if (!newFileName) {
      continue;
    }

    const destinationPath = path.join(targetFolderPath, newFileName);

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

async function applyLibraryWorkflow({ albums = [] }) {
  const updatedAlbums = [];
  let movedCount = 0;

  for (const album of albums) {
    const result = await applyFolderWorkflow(album);

    updatedAlbums.push({
      folderPath: result.folderPath,
      folderName: path.basename(result.folderPath),
      files: result.files
    });
    movedCount += result.movedCount;
  }

  return {
    albums: updatedAlbums,
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

function getAlbumMetadataKey(file) {
  const metadata = file.metadata || {};
  const artist = metadata.albumArtist || metadata.artist;
  const album = metadata.album;

  if (!artist || !album) {
    return "";
  }

  return `${artist}\u0000${album}`.toLowerCase();
}

function getTopLevelAlbumFolder(rootFolderPath, file) {
  const relativeFolder = path.relative(rootFolderPath, file.folder);

  if (!relativeFolder || relativeFolder.startsWith("..") || path.isAbsolute(relativeFolder)) {
    return rootFolderPath;
  }

  return path.join(rootFolderPath, relativeFolder.split(path.sep)[0]);
}

function groupFilesByFolder(rootFolderPath, files) {
  const albumsByPath = new Map();

  for (const file of files) {
    const albumFolderPath = getTopLevelAlbumFolder(rootFolderPath, file);
    const key = albumFolderPath.toLowerCase();

    if (!albumsByPath.has(key)) {
      albumsByPath.set(key, {
        folderPath: albumFolderPath,
        folderName: path.basename(albumFolderPath),
        files: []
      });
    }

    albumsByPath.get(key).files.push(file);
  }

  return [...albumsByPath.values()];
}

function isDiscFolderName(folderName) {
  return /^(cd|disc|disk|vol|volume|part)\s*\d+$/i.test(folderName.trim());
}

async function getFolderAlbums(folderPath) {
  const files = await getFolderAudioFiles(folderPath);
  const albumKeys = new Set(files.map(getAlbumMetadataKey).filter(Boolean));
  const folderGroups = groupFilesByFolder(folderPath, files);
  const hasOnlyDiscFolders = folderGroups.length > 1 &&
    folderGroups.every((album) => isDiscFolderName(album.folderName));
  const albums = albumKeys.size === 1 || folderGroups.length <= 1 || hasOnlyDiscFolders
    ? [{
      folderPath,
      folderName: path.basename(folderPath),
      files
    }]
    : folderGroups;

  albums.forEach((album) => {
    sortFilesByMetadata(album.files);
  });

  albums.sort((a, b) => a.folderPath.localeCompare(b.folderPath));

  return albums;
}

module.exports = {
  applyFolderWorkflow,
  applyLibraryWorkflow,
  getFolderAlbums,
  getFolderAudioFiles
};
