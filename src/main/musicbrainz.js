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

function getArtistCreditIds(artistCredit) {
  return Array.isArray(artistCredit)
    ? artistCredit.map((item) => item.artist?.id).filter(Boolean)
    : [];
}

function getGenreNames(...sources) {
  const names = sources.flatMap((source) =>
    (Array.isArray(source?.genres) ? source.genres : [])
      .map((genre) => genre.name)
      .filter(Boolean)
  );

  return [...new Set(names)];
}

function getLabelInfo(release) {
  const labelInfo = Array.isArray(release["label-info"])
    ? release["label-info"]
    : [];

  return {
    labels: [...new Set(labelInfo.map((item) => item.label?.name).filter(Boolean))],
    catalogNumbers: [...new Set(labelInfo.map((item) => item["catalog-number"]).filter(Boolean))]
  };
}

function getReleaseGroupTypes(releaseGroup) {
  const secondaryTypes = Array.isArray(releaseGroup?.["secondary-types"])
    ? releaseGroup["secondary-types"]
    : [];

  return [
    releaseGroup?.["primary-type"],
    ...secondaryTypes
  ].filter(Boolean);
}

function getTrackArtist(track, release) {
  const recording = track.recording || {};

  return getArtistCreditName(recording["artist-credit"]) ||
    getArtistCreditName(track["artist-credit"]) ||
    getArtistCreditName(release["artist-credit"]);
}

function appendTag(tags, field, value) {
  const values = (Array.isArray(value) ? value : [value])
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  if (values.length > 0) {
    tags[field] = values.length === 1 ? values[0] : [...new Set(values)];
  }
}

function appendTags(tags, entries) {
  entries.forEach(([field, value]) => {
    appendTag(tags, field, value);
  });
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

function buildMusicBrainzFlacTags(track, release, medium, disc, discNumber, genre) {
  const recording = track.recording || {};
  const releaseGroup = release["release-group"] || {};
  const { labels, catalogNumbers } = getLabelInfo(release);
  const recordingArtistIds = getArtistCreditIds(recording["artist-credit"]);
  const artistIds = recordingArtistIds.length > 0
    ? recordingArtistIds
    : getArtistCreditIds(track["artist-credit"]);
  const albumArtistIds = getArtistCreditIds(release["artist-credit"]);
  const releaseTypes = getReleaseGroupTypes(releaseGroup);
  const artist = getTrackArtist(track, release);
  const albumArtist = getArtistCreditName(release["artist-credit"]);
  const tags = {};

  appendTags(tags, [
    ["TITLE", recording.title || track.title],
    ["ARTIST", artist],
    ["ALBUM", release.title],
    ["ALBUMARTIST", albumArtist],
    ["DATE", release.date],
    ["GENRE", genre],
    ["TRACKNUMBER", track.number],
    ["DISC", disc],
    ["MUSICBRAINZ_ALBUMID", release.id],
    ["MUSICBRAINZ_RELEASEGROUPID", releaseGroup.id],
    ["MUSICBRAINZ_TRACKID", recording.id],
    ["MUSICBRAINZ_RELEASETRACKID", track.id],
    ["MUSICBRAINZ_ARTISTID", artistIds],
    ["MUSICBRAINZ_ALBUMARTISTID", albumArtistIds],
    ["MUSICBRAINZ_ALBUMSTATUS", release.status],
    ["MUSICBRAINZ_ALBUMTYPE", releaseTypes],
    ["RELEASETYPE", releaseTypes],
    ["RELEASESTATUS", release.status],
    ["RELEASECOUNTRY", release.country],
    ["RELEASEDATE", release.date],
    ["ORIGINALDATE", releaseGroup["first-release-date"]],
    ["BARCODE", release.barcode],
    ["ASIN", release.asin],
    ["LABEL", labels],
    ["CATALOGNUMBER", catalogNumbers],
    ["MEDIA", medium.format],
    ["TOTALTRACKS", medium["track-count"]],
    ["TOTALDISCS", Array.isArray(release.media) ? release.media.length : ""],
    ["TRACKTOTAL", medium["track-count"]],
    ["DISCTOTAL", Array.isArray(release.media) ? release.media.length : ""],
    ["DISCNUMBER", discNumber],
    ["ISRC", recording.isrcs]
  ]);

  return tags;
}

function normalizeMusicBrainzTrack(track, release, medium, isMultiDisc) {
  const recording = track.recording || {};
  const trackNumber = Number.isFinite(track.position)
    ? track.position
    : null;
  const trackTag = String(track.number || "");
  const discNumber = isMultiDisc && Number.isFinite(medium.position)
    ? medium.position
    : null;
  const artist = getTrackArtist(track, release);
  const albumArtist = getArtistCreditName(release["artist-credit"]);
  const genre = getGenreNames(recording, release, release["release-group"]).join(", ");

  return {
    musicbrainzReleaseId: release.id || "",
    musicbrainzRecordingId: recording.id || "",
    disc: discNumber ? String(discNumber) : "",
    discNumber,
    track: trackTag,
    trackNumber,
    title: recording.title || track.title || "",
    artist,
    albumArtist,
    album: release.title || "",
    date: release.date || "",
    genre,
    flacTags: buildMusicBrainzFlacTags(track, release, medium, discNumber ? String(discNumber) : "", discNumber, genre)
  };
}

function normalizeMusicBrainzTracks(release) {
  const media = Array.isArray(release.media) ? release.media : [];
  const isMultiDisc = media.length > 1;

  return media.flatMap((medium) =>
    (medium.tracks || []).map((track) =>
      normalizeMusicBrainzTrack(track, release, medium, isMultiDisc)
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
    inc: "recordings+artist-credits+release-groups+labels+isrcs+genres"
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
    album: releaseData.title || "",
    albumArtist: getArtistCreditName(releaseData["artist-credit"]),
    musicbrainzUrl: `https://musicbrainz.org/release/${releaseData.id}`,
    tracks
  };
}

module.exports = {
  fetchMusicBrainzAlbumMetadata
};
