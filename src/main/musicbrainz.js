const { compareNullableNumbers } = require("./audio");
const packageJson = require("../../package.json");

const musicBrainzBaseUrl = "https://musicbrainz.org/ws/2";
const coverArtArchiveBaseUrl = "https://coverartarchive.org";
const retryableMusicBrainzStatuses = new Set([429, 502, 503, 504]);
const cp437ExtendedCharacters = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
const cp437ByteByCharacter = new Map(
  [...cp437ExtendedCharacters].map((character, index) => [character, index + 0x80])
);
let lastMusicBrainzRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getMusicBrainzUserAgent() {
  return `${packageJson.name}/${packageJson.version} (local metadata sync app)`;
}

function getRetryAfterMs(response) {
  const retryAfter = response.headers.get("retry-after");

  if (!retryAfter) {
    return null;
  }

  const retryAfterSeconds = Number.parseInt(retryAfter, 10);

  return Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : null;
}

function getMusicBrainzRequestError(status) {
  if (status === 503) {
    return "MusicBrainz is temporarily unavailable. Please try again in a few minutes.";
  }

  if (status === 429) {
    return "MusicBrainz is rate limiting requests. Please wait a moment and try again.";
  }

  return `MusicBrainz request failed with status ${status}. Please try again later.`;
}

async function fetchMusicBrainzJson(path, searchParams = {}, attempt = 1) {
  const elapsed = Date.now() - lastMusicBrainzRequestAt;

  if (elapsed < 1000) {
    await sleep(1000 - elapsed);
  }

  const params = new URLSearchParams({
    ...searchParams,
    fmt: "json"
  });
  let response;

  try {
    response = await fetch(`${musicBrainzBaseUrl}${path}?${params}`, {
      headers: {
        "User-Agent": getMusicBrainzUserAgent(),
        Accept: "application/json"
      }
    });
  } catch (error) {
    lastMusicBrainzRequestAt = Date.now();

    if (attempt < 3) {
      await sleep(1000 * attempt);
      return fetchMusicBrainzJson(path, searchParams, attempt + 1);
    }

    throw new Error("Could not connect to MusicBrainz after 3 attempts. Check your network connection and try again.", {
      cause: error
    });
  }

  lastMusicBrainzRequestAt = Date.now();

  if (!response.ok) {
    if (retryableMusicBrainzStatuses.has(response.status) && attempt < 3) {
      const retryAfterMs = getRetryAfterMs(response);
      const retryDelayMs = retryAfterMs ?? 1000 * attempt;

      await sleep(retryDelayMs);
      return fetchMusicBrainzJson(path, searchParams, attempt + 1);
    }

    throw new Error(getMusicBrainzRequestError(response.status));
  }

  return response.json();
}

async function fetchCoverArtArchiveJson(path) {
  const response = await fetch(`${coverArtArchiveBaseUrl}${path}`, {
    headers: {
      "User-Agent": getMusicBrainzUserAgent(),
      Accept: "application/json"
    }
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Cover Art Archive request failed: ${response.status}`);
  }

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

function containsJapaneseText(value) {
  return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(value);
}

function decodeCp437Mojibake(value) {
  const text = String(value || "");

  if (!text || containsJapaneseText(text)) {
    return text;
  }

  const bytes = [];
  let hasExtendedCharacter = false;

  for (const character of text) {
    const codePoint = character.codePointAt(0);

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
      continue;
    }

    const byte = cp437ByteByCharacter.get(character);

    if (byte === undefined) {
      return text;
    }

    hasExtendedCharacter = true;
    bytes.push(byte);
  }

  if (!hasExtendedCharacter) {
    return text;
  }

  const decoded = Buffer.from(bytes).toString("utf8");

  return decoded.includes("\uFFFD") || !containsJapaneseText(decoded)
    ? text
    : decoded;
}

function repairSearchText(value) {
  return decodeCp437Mojibake(value).trim();
}

function stripTrailingEpSuffix(value) {
  return String(value || "")
    .replace(/\s+-\s*EP$/iu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTrailingReleaseTypeSuffix(value) {
  return String(value || "")
    .replace(/\s+-\s*(?:album|ep|single)$/iu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTrailingParenthetical(value) {
  const text = String(value || "").trim();
  const stripped = text.replace(/\s*[\(\uFF08][^\)\uFF09]+[\)\uFF09]\s*$/u, "").trim();

  return stripped || text;
}

function getQuotedAlbumTitles(value) {
  const titles = [];
  const text = String(value || "");
  const quotePattern = /[\u300C"]([^"\u300D]+)[\u300D"]/gu;
  let match = quotePattern.exec(text);

  while (match) {
    titles.push(match[1]);
    match = quotePattern.exec(text);
  }

  return titles;
}

function compactStylizedLetterSpacing(value) {
  const text = String(value || "").trim();

  if (!/[\u200B-\u200D\u2060\uFEFF]/u.test(text)) {
    return text;
  }

  return text
    .split(/\s*[\u200B-\u200D\u2060\uFEFF]+\s*/u)
    .map((word) => word.replace(/\s+/g, ""))
    .filter(Boolean)
    .join(" ");
}

function getAlbumSearchVariants(album) {
  const repairedAlbum = repairSearchText(album);
  const withoutReleaseType = stripTrailingReleaseTypeSuffix(repairedAlbum);
  const withoutEp = stripTrailingEpSuffix(withoutReleaseType);
  const withoutParenthetical = stripTrailingParenthetical(repairedAlbum);
  const withoutReleaseDetails = stripTrailingParenthetical(withoutReleaseType);
  const compactTitle = compactStylizedLetterSpacing(withoutParenthetical);
  const quotedTitles = getQuotedAlbumTitles(withoutParenthetical);
  const variants = [
    { text: album, isSimplified: false },
    { text: repairedAlbum, isSimplified: false },
    { text: withoutReleaseType, isSimplified: withoutReleaseType !== repairedAlbum },
    { text: withoutReleaseDetails, isSimplified: withoutReleaseDetails !== repairedAlbum },
    { text: withoutEp, isSimplified: withoutEp !== repairedAlbum },
    { text: withoutParenthetical, isSimplified: withoutParenthetical !== repairedAlbum },
    { text: compactTitle, isSimplified: compactTitle !== withoutParenthetical },
    { text: stripTrailingParenthetical(withoutEp), isSimplified: true },
    { text: stripTrailingEpSuffix(withoutParenthetical), isSimplified: true },
    ...quotedTitles.slice(-1).map((text) => ({
      text,
      isSimplified: true
    }))
  ];
  const seen = new Set();

  return variants
    .map((variant) => ({
      ...variant,
      text: String(variant.text || "").trim()
    }))
    .filter((variant) => {
      const key = normalizeSearchText(variant.text);

      if (!key || seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

function getUniqueSearchTexts(...values) {
  const seen = new Set();
  const results = [];

  values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .forEach((value) => {
      const key = normalizeSearchText(value);

      if (!key || seen.has(key)) {
        return;
      }

      seen.add(key);
      results.push(value);
    });

  return results;
}

function getArtistSearchTexts(artist) {
  const repairedArtist = repairSearchText(artist);
  const artistParts = repairedArtist
    .split(/\s*(?:,|&|\uFF06|\/|\u3001|\uFF0C)\s*/u)
    .filter(Boolean);

  return getUniqueSearchTexts(artist, repairedArtist, ...artistParts);
}

function quoteMusicBrainzQueryValue(value) {
  return String(value || "").replace(/["\\]/g, " ");
}

function getSearchTokens(value) {
  const ignoredTokens = new Set(["and", "cv", "feat", "featuring", "the", "x"]);

  return normalizeSearchText(value)
    .split(" ")
    .filter((token) => token.length > 1 && !ignoredTokens.has(token));
}

function hasArtistMatch(artist, candidateArtist) {
  const wantedArtist = normalizeSearchText(artist);
  const normalizedCandidateArtist = normalizeSearchText(candidateArtist);

  if (!wantedArtist || !normalizedCandidateArtist) {
    return false;
  }

  if (
    normalizedCandidateArtist.includes(wantedArtist) ||
    wantedArtist.includes(normalizedCandidateArtist)
  ) {
    return true;
  }

  const wantedTokens = getSearchTokens(artist);

  if (wantedTokens.length === 0) {
    return false;
  }

  const matchedTokens = wantedTokens.filter((token) => normalizedCandidateArtist.includes(token));

  return matchedTokens.length >= Math.min(2, wantedTokens.length);
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

function getArtistNameOptions(artistCredit, artistDetails) {
  if (!Array.isArray(artistCredit) || artistCredit.length !== 1) {
    return [];
  }

  const credit = artistCredit[0];
  const options = [
    {
      name: credit.name,
      locale: "",
      source: "release credit"
    },
    {
      name: artistDetails?.name || credit.artist?.name,
      locale: "",
      source: "canonical"
    },
    ...(Array.isArray(artistDetails?.aliases) ? artistDetails.aliases : []).map((alias) => ({
      name: alias.name,
      locale: alias.locale || "",
      source: "alias"
    }))
  ];
  const seen = new Set();

  return options.filter((option) => {
    const key = normalizeSearchText(option.name);

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

async function fetchArtistDetails(artistId) {
  if (!artistId) {
    return null;
  }

  try {
    return await fetchMusicBrainzJson(`/artist/${artistId}`, {
      inc: "aliases"
    });
  } catch {
    return null;
  }
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

function scoreMusicBrainzRelease(candidate, artist, albumVariant, localTrackCount = null) {
  const wantedAlbum = normalizeSearchText(albumVariant.text);
  const candidateAlbum = normalizeSearchText(candidate.title);
  const artistMatches = hasArtistMatch(artist, getArtistCreditName(candidate["artist-credit"]));
  const candidateTrackCount = Number.parseInt(candidate["track-count"], 10);
  const trackCountMatches = Number.isFinite(localTrackCount) &&
    localTrackCount > 0 &&
    Number.isFinite(candidateTrackCount) &&
    candidateTrackCount === localTrackCount;

  if (!wantedAlbum || !candidateAlbum) {
    return -1;
  }

  const albumExactlyMatches = candidateAlbum === wantedAlbum;
  const shorterAlbumLength = Math.min(
    wantedAlbum.replace(/\s/g, "").length,
    candidateAlbum.replace(/\s/g, "").length
  );
  const albumStronglyMatches = albumExactlyMatches ||
    (
      shorterAlbumLength >= 3 &&
      (
        candidateAlbum.includes(wantedAlbum) ||
        wantedAlbum.includes(candidateAlbum)
      )
    );

  if (!albumStronglyMatches) {
    return -1;
  }

  let score = Number.parseInt(candidate.score, 10) || 0;

  if (!artistMatches) {
    const exactTitleIsDistinctive = albumExactlyMatches &&
      wantedAlbum.replace(/\s/g, "").length >= 8;

    if (!trackCountMatches || (!exactTitleIsDistinctive && shorterAlbumLength < 12)) {
      return -1;
    }

    if (exactTitleIsDistinctive) {
      score += 25;
    }
  }

  if (candidateAlbum === wantedAlbum) {
    score += 100;
  } else if (candidateAlbum.includes(wantedAlbum)) {
    score += 70;
  } else if (wantedAlbum.includes(candidateAlbum)) {
    score += 45;
  }

  score += albumVariant.isSimplified ? 0 : 45;

  if (artistMatches) {
    score += 70;
  } else {
    score -= 90;
  }

  if (Number.isFinite(localTrackCount) && localTrackCount > 0 && Number.isFinite(candidateTrackCount)) {
    score += candidateTrackCount === localTrackCount ? 35 : -60;
  }

  if (candidate.status === "Official") {
    score += 15;
  }

  return score;
}

async function searchMusicBrainzReleases(artist, album, options = {}) {
  const artists = getUniqueSearchTexts(artist, repairSearchText(artist));
  const artistQueries = getArtistSearchTexts(artist);
  const albumVariants = getAlbumSearchVariants(album);
  const titleQueries = albumVariants.flatMap((albumVariant) => {
    const quotedAlbum = quoteMusicBrainzQueryValue(albumVariant.text);

    return [
      `release:"${quotedAlbum}"`,
      `"${quotedAlbum}"`
    ];
  });
  const combinedQueries = albumVariants.flatMap((albumVariant) => {
    const quotedAlbum = quoteMusicBrainzQueryValue(albumVariant.text);

    return artistQueries.flatMap((artistText) => {
      const quotedArtist = quoteMusicBrainzQueryValue(artistText);

      return [
        `artist:"${quotedArtist}" AND release:"${quotedAlbum}"`,
        `"${quotedArtist}" "${quotedAlbum}"`,
        `${quotedArtist} ${quotedAlbum}`
      ];
    });
  });
  const queries = [...titleQueries, ...combinedQueries];
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

      const score = Math.max(
        ...artists.flatMap((artistText) =>
          albumVariants.map((albumVariant) =>
            scoreMusicBrainzRelease(candidate, artistText, albumVariant, options.trackCount)
          )
        )
      );

      if (score >= 120) {
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
    ["TRACK", track.number],
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

function getCoverArtUrls(image) {
  if (!image) {
    return null;
  }

  return {
    original: image.image || "",
    embed: image.thumbnails?.["1200"] || ""
  };
}

async function fetchReleaseCoverArt(releaseId) {
  if (!releaseId) {
    return null;
  }

  try {
    const data = await fetchCoverArtArchiveJson(`/release/${releaseId}`);
    const images = Array.isArray(data?.images) ? data.images : [];
    const frontImage = images.find((image) => image.front) || images[0];
    const coverArt = getCoverArtUrls(frontImage);

    return coverArt?.original || coverArt?.embed ? coverArt : null;
  } catch {
    return null;
  }
}

function normalizeMusicBrainzTrack(track, release, medium, isMultiDisc, coverArt) {
  const recording = track.recording || {};
  const trackNumber = Number.isFinite(track.position)
    ? track.position
    : null;
  const trackTag = String(track.number || "");
  const discNumber = Number.isFinite(medium.position)
    ? medium.position
    : null;
  const discTag = discNumber ? String(discNumber) : "";
  const artist = getTrackArtist(track, release);
  const albumArtist = getArtistCreditName(release["artist-credit"]);
  const genre = getGenreNames(recording, release, release["release-group"]).join(", ");

  return {
    musicbrainzReleaseId: release.id || "",
    musicbrainzRecordingId: recording.id || "",
    disc: discTag,
    discNumber,
    track: trackTag,
    trackNumber,
    title: recording.title || track.title || "",
    artist,
    albumArtist,
    album: release.title || "",
    date: release.date || "",
    genre,
    coverArt,
    flacTags: buildMusicBrainzFlacTags(track, release, medium, discTag, discNumber, genre)
  };
}

function normalizeMusicBrainzTracks(release, coverArt) {
  const media = Array.isArray(release.media) ? release.media : [];
  const isMultiDisc = media.length > 1;

  return media.flatMap((medium) =>
    (medium.tracks || []).map((track) =>
      normalizeMusicBrainzTrack(track, release, medium, isMultiDisc, coverArt)
    )
  ).filter((track) => track.title);
}

async function fetchMusicBrainzAlbumMetadata(payload) {
  const artist = repairSearchText(payload.artist);
  const album = repairSearchText(payload.album);
  const trackCount = Number.parseInt(payload.trackCount, 10) || null;

  if (!artist || !album) {
    throw new Error("Artist and album are required before fetching MusicBrainz metadata.");
  }

  const musicBrainzRelease = (await searchMusicBrainzReleases(artist, album, {
    trackCount
  }))[0];

  if (!musicBrainzRelease) {
    throw new Error(`No MusicBrainz release found for "${artist} - ${album}". Try simplifying the artist or album text.`);
  }

  const releaseData = await fetchMusicBrainzJson(`/release/${musicBrainzRelease.id}`, {
    inc: "recordings+artist-credits+release-groups+labels+isrcs+genres"
  });
  const albumArtistIds = getArtistCreditIds(releaseData["artist-credit"]);
  const albumArtistId = albumArtistIds.length === 1 ? albumArtistIds[0] : "";
  const artistDetails = await fetchArtistDetails(albumArtistId);
  const coverArt = await fetchReleaseCoverArt(releaseData.id);
  const tracks = normalizeMusicBrainzTracks(releaseData, coverArt);

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
    albumArtistId,
    albumArtistOptions: getArtistNameOptions(releaseData["artist-credit"], artistDetails),
    musicbrainzUrl: `https://musicbrainz.org/release/${releaseData.id}`,
    coverArt,
    tracks
  };
}

module.exports = {
  fetchMusicBrainzAlbumMetadata
};
