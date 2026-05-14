const fs = require("node:fs/promises");
const path = require("node:path");
const { addMetadata, sortFilesByMetadata, walkAudioFiles } = require("./audio");

function cleanFileName(name) {
  return name.replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, " ").trim();
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
  if (!await pathExists(filePath)) {
    return filePath;
  }

  const parsedPath = path.parse(filePath);
  let index = 1;
  let candidatePath = "";

  do {
    candidatePath = path.join(parsedPath.dir, `${parsedPath.name} (${index})${parsedPath.ext}`);
    index += 1;
  } while (await pathExists(candidatePath));

  return candidatePath;
}

async function applyFolderWorkflow({ folderPath, folderName }) {
  let targetFolderPath = folderPath;
  const safeFolderName = cleanFileName(folderName || "");

  if (safeFolderName) {
    targetFolderPath = path.join(path.dirname(folderPath), safeFolderName);

    if (targetFolderPath.toLowerCase() !== folderPath.toLowerCase()) {
      if (await pathExists(targetFolderPath)) {
        throw new Error(`Target folder already exists: ${targetFolderPath}`);
      }

      await fs.rename(folderPath, targetFolderPath);
    }
  }

  const files = await walkAudioFiles(targetFolderPath);
  let movedCount = 0;

  for (const file of files) {
    if (file.folder.toLowerCase() === targetFolderPath.toLowerCase()) {
      continue;
    }

    const destinationPath = await getAvailablePath(path.join(targetFolderPath, file.name));
    await fs.rename(file.path, destinationPath);
    movedCount += 1;
  }

  const updatedFiles = await addMetadata(await walkAudioFiles(targetFolderPath));
  sortFilesByMetadata(updatedFiles);

  return {
    folderPath: targetFolderPath,
    files: updatedFiles,
    movedCount
  };
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
