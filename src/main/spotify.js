const { compareNullableNumbers } = require("./audio");

function getSpotifyCredentials() {
  return {
    clientId: String(process.env.SPOTIFY_CLIENT_ID || "").trim(),
    clientSecret: String(process.env.SPOTIFY_CLIENT_SECRET || "").trim()
  };
}

async function fetchSpotifyToken(credentials) {
  if (!credentials.clientId || !credentials.clientSecret) {
    throw new Error("Spotify Client ID and Client Secret are required.");
  }

  const auth = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64");
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials"
    })
  });

  if (!response.ok) {
    throw new Error(`Spotify auth failed: ${response.status}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function fetchSpotifyJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`Spotify request failed: ${response.status}`);
  }

  return response.json();
}

function normalizeSpotifyTrack(track, album) {
  const artist = track.artists.map((item) => item.name).join(", ");
  const albumArtist = album.artists.map((item) => item.name).join(", ");

  return {
    spotifyId: track.id,
    disc: String(track.disc_number || ""),
    discNumber: track.disc_number || null,
    track: String(track.track_number || ""),
    trackNumber: track.track_number || null,
    title: track.name,
    artist,
    albumArtist,
    album: album.name,
    date: album.release_date || "",
    genre: album.genres?.join(", ") || ""
  };
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

function scoreSpotifyAlbum(candidate, artist, album) {
  const wantedArtist = normalizeSearchText(artist);
  const wantedAlbum = normalizeSearchText(album);
  const candidateAlbum = normalizeSearchText(candidate.name);
  const candidateArtists = normalizeSearchText(candidate.artists.map((item) => item.name).join(" "));
  let score = 0;

  if (candidateAlbum === wantedAlbum) {
    score += 100;
  } else if (candidateAlbum.includes(wantedAlbum) || wantedAlbum.includes(candidateAlbum)) {
    score += 60;
  }

  if (candidateArtists.includes(wantedArtist)) {
    score += 40;
  }

  return score;
}

async function searchSpotifyAlbums(token, artist, album) {
  const queries = [
    `album:"${album}" artist:"${artist}"`,
    `${album} ${artist}`,
    `album:"${album}"`,
    album
  ];
  const seen = new Set();
  const candidates = [];

  for (const query of queries) {
    const searchParams = new URLSearchParams({
      q: query,
      type: "album",
      limit: "10"
    });
    const search = await fetchSpotifyJson(`https://api.spotify.com/v1/search?${searchParams}`, token);

    for (const candidate of search.albums?.items || []) {
      if (seen.has(candidate.id)) {
        continue;
      }

      seen.add(candidate.id);
      candidates.push(candidate);
    }

    if (candidates.some((candidate) => scoreSpotifyAlbum(candidate, artist, album) >= 100)) {
      break;
    }
  }

  candidates.sort((a, b) => (
    scoreSpotifyAlbum(b, artist, album) - scoreSpotifyAlbum(a, artist, album) ||
    String(b.release_date || "").localeCompare(String(a.release_date || ""))
  ));

  return candidates;
}

async function fetchAllSpotifyAlbumTracks(albumData, token) {
  const tracks = [...albumData.tracks.items];
  let nextUrl = albumData.tracks.next;

  while (nextUrl) {
    const page = await fetchSpotifyJson(nextUrl, token);
    tracks.push(...page.items);
    nextUrl = page.next;
  }

  return tracks;
}

async function fetchSpotifyAlbumMetadata(payload) {
  const credentials = getSpotifyCredentials(payload);
  const artist = String(payload.artist || "").trim();
  const album = String(payload.album || "").trim();

  if (!artist || !album) {
    throw new Error("Artist and album are required before fetching Spotify metadata.");
  }

  const token = await fetchSpotifyToken(credentials);
  const spotifyAlbum = (await searchSpotifyAlbums(token, artist, album))[0];

  if (!spotifyAlbum) {
    throw new Error(`No Spotify album found for "${artist} - ${album}". Try simplifying the artist or album text.`);
  }

  const albumData = await fetchSpotifyJson(`https://api.spotify.com/v1/albums/${spotifyAlbum.id}`, token);
  const albumTracks = await fetchAllSpotifyAlbumTracks(albumData, token);
  const tracks = albumTracks.map((track) => normalizeSpotifyTrack(track, albumData));

  tracks.sort((a, b) => (
    compareNullableNumbers(a.discNumber, b.discNumber) ||
    compareNullableNumbers(a.trackNumber, b.trackNumber)
  ));

  return {
    album: albumData.name,
    albumArtist: albumData.artists.map((item) => item.name).join(", "),
    spotifyUrl: albumData.external_urls?.spotify || "",
    tracks
  };
}

module.exports = {
  fetchSpotifyAlbumMetadata
};
