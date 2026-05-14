const { compareNullableNumbers } = require("./audio");

function getLastfmCredentials() {
  return {
    apiKey: String(process.env.LASTFM_API_KEY || "").trim()
  };
}

async function fetchLastfmJson(searchParams) {
  const credentials = getLastfmCredentials();

  if (!credentials.apiKey) {
    throw new Error("Last.fm API key is required.");
  }

  const params = new URLSearchParams({
    ...searchParams,
    api_key: credentials.apiKey,
    format: "json"
  });
  const response = await fetch(`https://ws.audioscrobbler.com/2.0/?${params}`);

  if (!response.ok) {
    throw new Error(`Last.fm request failed: ${response.status}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(data.message || `Last.fm request failed: ${data.error}`);
  }

  return data;
}

function normalizeList(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function normalizeTrackNumber(track, index) {
  const rank = track["@attr"]?.rank;
  const parsedRank = Number.parseInt(rank, 10);

  return Number.isFinite(parsedRank) ? parsedRank : index + 1;
}

function getLastfmAlbumGenre(album) {
  return normalizeList(album.tags?.tag)
    .map((tag) => tag.name)
    .filter(Boolean)
    .join(", ");
}

function applyDiscMetadata(tracks) {
  const maxDiscNumber = Math.max(
    1,
    ...tracks.map((track) => track.discNumber || 1)
  );

  const isMultiDisc = maxDiscNumber > 1;

  return tracks.map((track) => {
    const discNumber = isMultiDisc
      ? (track.discNumber || 1)
      : null;

    return {
      ...track,
      disc: discNumber ? String(discNumber) : "",
      discNumber
    };
  });
}

function normalizeLastfmTrack(track, album, index) {
  const trackNumber = normalizeTrackNumber(track, index);
  const artist = track.artist?.name || album.artist || "";
  const genre = getLastfmAlbumGenre(album);

  return {
    lastfmUrl: track.url || "",
    disc: "",
    discNumber: null,
    track: String(trackNumber),
    trackNumber,
    title: track.name || "",
    artist,
    albumArtist: album.artist || "",
    album: album.name || "",
    date: "",
    genre
  };
}

function stripExtension(fileName, extension) {
  if (!extension || !fileName.toLowerCase().endsWith(extension.toLowerCase())) {
    return fileName;
  }

  return fileName.slice(0, -extension.length);
}

function normalizeFallbackTrack(file, album, index) {
  const metadata = file.metadata || {};
  const fallbackTrackNumber = index + 1;
  const trackNumber = Number.isFinite(metadata.trackNumber)
    ? metadata.trackNumber
    : fallbackTrackNumber;
  const discNumber = Number.isFinite(metadata.discNumber)
    ? metadata.discNumber
    : null;

  return {
    lastfmUrl: album.url || "",
    disc: metadata.disc || (discNumber ? String(discNumber) : ""),
    discNumber,
    track: metadata.track || String(trackNumber),
    trackNumber,
    title: metadata.title || stripExtension(file.name || "", file.extension || ""),
    artist: metadata.artist || album.artist || "",
    albumArtist: album.artist || metadata.albumArtist || metadata.artist || "",
    album: album.name || metadata.album || "",
    date: metadata.date || "",
    genre: getLastfmAlbumGenre(album) || metadata.genre || ""
  };
}

function normalizeFallbackTracks(files, album) {
  if (!Array.isArray(files)) {
    return [];
  }

  return files
    .map((file, index) => normalizeFallbackTrack(file, album, index))
    .filter((track) => track.title);
}

async function fetchLastfmAlbumMetadata(payload) {
  const artist = String(payload.artist || "").trim();
  const album = String(payload.album || "").trim();

  if (!artist || !album) {
    throw new Error("Artist and album are required before fetching Last.fm metadata.");
  }

  const data = await fetchLastfmJson({
    method: "album.getinfo",
    artist,
    album,
    autocorrect: "1"
  });
  const albumData = data.album;

  if (!albumData) {
    throw new Error(`No Last.fm album found for "${artist} - ${album}". Try simplifying the artist or album text.`);
  }

  let trackSource = "lastfm";
  let tracks = normalizeList(albumData.tracks?.track)
    .map((track, index) => normalizeLastfmTrack(track, albumData, index))
    .filter((track) => track.title);

  if (tracks.length === 0) {
    trackSource = "local";
    tracks = normalizeFallbackTracks(payload.files, albumData);
  }

  if (tracks.length === 0) {
    throw new Error(`Last.fm did not return tracks for "${artist} - ${album}" and no local tracks were available.`);
  }

  tracks = applyDiscMetadata(tracks);

  tracks.sort((a, b) => (
    compareNullableNumbers(a.discNumber, b.discNumber) ||
    compareNullableNumbers(a.trackNumber, b.trackNumber)
  ));

  return {
    album: albumData.name || album,
    albumArtist: albumData.artist || artist,
    lastfmUrl: albumData.url || "",
    trackSource,
    tracks
  };
}

module.exports = {
  fetchLastfmAlbumMetadata
};
