const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const audioExtensions = new Set([".flac", ".mp3", ".m4a", ".wav", ".ogg"]);

function getTagValue(tags = {}, tagName) {
  const match = Object.entries(tags).find(([key]) => key.toLowerCase() === tagName);
  return match ? String(match[1]).trim() : "";
}

function getFirstTagValue(tags, tagNames) {
  for (const tagName of tagNames) {
    const value = getTagValue(tags, tagName);

    if (value) {
      return value;
    }
  }

  return "";
}

function parseTrackNumber(value) {
  const match = String(value || "").match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : null;
}

function compareNullableNumbers(left, right) {
  if (left === null && right === null) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return left - right;
}

async function readAudioMetadata(filePath) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format_tags",
      "-of",
      "json",
      filePath
    ]);
    const data = JSON.parse(stdout);
    const tags = data.format?.tags || {};
    const track = getFirstTagValue(tags, ["track", "tracknumber"]);
    const disc = getFirstTagValue(tags, ["disc", "discnumber", "disc_number"]);

    return {
      rawTags: tags,
      track,
      trackNumber: parseTrackNumber(track),
      disc,
      discNumber: parseTrackNumber(disc),
      title: getFirstTagValue(tags, ["title"]),
      artist: getFirstTagValue(tags, ["artist"]),
      albumArtist: getFirstTagValue(tags, ["album_artist", "albumartist"]),
      album: getFirstTagValue(tags, ["album"]),
      date: getFirstTagValue(tags, ["date", "year"]),
      genre: getFirstTagValue(tags, ["genre"])
    };
  } catch {
    return {
      rawTags: {},
      track: "",
      trackNumber: null,
      disc: "",
      discNumber: null,
      title: "",
      artist: "",
      albumArtist: "",
      album: "",
      date: "",
      genre: ""
    };
  }
}

async function walkAudioFiles(folderPath) {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(folderPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...await walkAudioFiles(fullPath));
      continue;
    }

    if (entry.isFile() && audioExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push({
        name: entry.name,
        path: fullPath,
        folder: path.dirname(fullPath),
        extension: path.extname(entry.name)
      });
    }
  }

  return files;
}

async function addMetadata(files) {
  return Promise.all(files.map(async (file) => ({
    ...file,
    metadata: await readAudioMetadata(file.path)
  })));
}

function sortFilesByMetadata(files) {
  files.sort((a, b) => (
    compareNullableNumbers(a.metadata.discNumber, b.metadata.discNumber) ||
    compareNullableNumbers(a.metadata.trackNumber, b.metadata.trackNumber) ||
    a.path.localeCompare(b.path)
  ));
}

module.exports = {
  addMetadata,
  compareNullableNumbers,
  sortFilesByMetadata,
  walkAudioFiles
};
