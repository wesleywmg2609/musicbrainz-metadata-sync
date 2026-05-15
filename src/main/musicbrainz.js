const { compareNullableNumbers } = require("./audio");
const packageJson = require("../../package.json");

const musicBrainzBaseUrl = "https://musicbrainz.org/ws/2";
let lastMusicBrainzRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getMusicBrainzUserAgent() {
  return `${packageJson.name}/${packageJson.version} (local metadata sync app)`;
}

async function fetchMusicBrainzJson(path, searchParams = {}) {
  const elapsed = Date.now() - lastMusicBrainzRequestAt;

  if (elapsed < 1000) {
    await sleep(1000 - elapsed);
  }

  const params = new URLSearchParams({
    ...searchParams,
    fmt: "json"
  });
  const response = await fetch(`${musicBrainzBaseUrl}${path}?${params}`, {
    headers: {
      "User-Agent": getMusicBrainzUserAgent(),
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`MusicBrainz request failed: ${response.status}`);
  }

  lastMusicBrainzRequestAt = Date.now();

  return response.json();
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getArtistCreditName(artistCredit) {
  return Array.isArray(artistCredit)
    ? artistCredit.map((item) => item.name).filter(Boolean).join(", ")
    : "";
}

function scoreMusicBrainzRelease(candidate, artist, album) {
  const wantedArtist = normalizeSearchText(artist);
  const wantedAlbum = normalizeSearchText(album);
  const candidateAlbum = normalizeSearchText(candidate.title);
  const candidateArtist = normalizeSearchText(getArtistCreditName(candidate["artist-credit"]));

  if (!wantedArtist || !wantedAlbum || !candidateArtist.includes(wantedArtist)) {
    return -1;
  }

  let score = Number.parseInt(candidate.score, 10) || 0;

  if (candidateAlbum === wantedAlbum) {
    score += 100;
  } else if (candidateAlbum.includes(wantedAlbum)) {
    score += 70;
  } else if (wantedAlbum.includes(candidateAlbum)) {
    score += 45;
  } else {
    const wantedWords = wantedAlbum.split(" ").filter((word) => word.length > 2);
    const matchedWords = wantedWords.filter((word) => candidateAlbum.includes(word));

    score += matchedWords.length * 8;
  }

  if (candidate.status === "Official") {
    score += 15;
  }

  return score;
}

async function searchMusicBrainzReleases(artist, album) {
  const queries = [
    `artist:"${artist}" AND release:"${album}"`,
    `"${artist}" "${album}"`,
    `${artist} ${album}`
  ];
  const seen = new Set();
  const candidates = [];

  for (const query of queries) {
    const data = await fetchMusicBrainzJson("/release", {
      query,
      limit: "20"
    });

    for (const candidate of data.releases || []) {
      if (seen.has(candidate.id)) {
        continue;
      }

      seen.add(candidate.id);

      const score = scoreMusicBrainzRelease(candidate, artist, album);

      if (score >= 0) {
        candidates.push({
          ...candidate,
          score
        });
      }
    }

    if (candidates.some((candidate) => candidate.score >= 180)) {
      break;
    }
  }

  candidates.sort((a, b) => (
    b.score - a.score ||
    String(a.date || "").localeCompare(String(b.date || ""))
  ));

  return candidates;
}

function normalizeMusicBrainzTrack(track, release, medium, isMultiDisc, fallbackTrackNumber) {
  const recording = track.recording || {};
  const trackNumber = Number.isFinite(track.position)
    ? track.position
    : fallbackTrackNumber;
  const discNumber = isMultiDisc
    ? (medium.position || 1)
    : null;
  const artist = getArtistCreditName(recording["artist-credit"]) ||
    getArtistCreditName(track["artist-credit"]) ||
    getArtistCreditName(release["artist-credit"]);
  const albumArtist = getArtistCreditName(release["artist-credit"]);

  return {
    musicbrainzReleaseId: release.id || "",
    musicbrainzRecordingId: recording.id || "",
    disc: discNumber ? String(discNumber) : "",
    discNumber,
    track: String(trackNumber || track.number || ""),
    trackNumber: trackNumber || null,
    title: recording.title || track.title || "",
    artist,
    albumArtist,
    album: release.title || "",
    date: release.date || "",
    genre: ""
  };
}

function normalizeMusicBrainzTracks(release) {
  const media = Array.isArray(release.media) ? release.media : [];
  const isMultiDisc = media.length > 1;

  return media.flatMap((medium, mediumIndex) =>
    (medium.tracks || []).map((track, trackIndex) =>
      normalizeMusicBrainzTrack(track, release, {
        ...medium,
        position: medium.position || mediumIndex + 1
      }, isMultiDisc, trackIndex + 1)
    )
  ).filter((track) => track.title);
}

async function fetchMusicBrainzAlbumMetadata(payload) {
  const artist = String(payload.artist || "").trim();
  const album = String(payload.album || "").trim();

  if (!artist || !album) {
    throw new Error("Artist and album are required before fetching MusicBrainz metadata.");
  }

  const musicBrainzRelease = (await searchMusicBrainzReleases(artist, album))[0];

  if (!musicBrainzRelease) {
    throw new Error(`No MusicBrainz release found for "${artist} - ${album}". Try simplifying the artist or album text.`);
  }

  const releaseData = await fetchMusicBrainzJson(`/release/${musicBrainzRelease.id}`, {
    inc: "recordings+artist-credits+release-groups"
  });
  const tracks = normalizeMusicBrainzTracks(releaseData);

  if (tracks.length === 0) {
    throw new Error(`MusicBrainz did not return tracks for "${artist} - ${album}".`);
  }

  tracks.sort((a, b) => (
    compareNullableNumbers(a.discNumber, b.discNumber) ||
    compareNullableNumbers(a.trackNumber, b.trackNumber)
  ));

  return {
    album: releaseData.title || album,
    albumArtist: getArtistCreditName(releaseData["artist-credit"]) || artist,
    musicbrainzUrl: `https://musicbrainz.org/release/${releaseData.id}`,
    tracks
  };
}

module.exports = {
  fetchMusicBrainzAlbumMetadata
};
