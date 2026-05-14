# Music Metadata Sync

Electron app for matching local music files with Spotify metadata.

## Features

- Choose a local music folder.
- Read existing audio metadata with `ffprobe`.
- Sort files by disc and track number.
- Fetch Spotify album metadata from artist and album search.
- Preview Spotify title, album, artist, album artist, disc, and track data.
- Preview the target folder name from Spotify metadata.
- Apply folder cleanup by renaming the album folder and moving nested audio files into the folder root.

The app currently previews Spotify metadata. It does not write Spotify tags into audio files yet.

## Requirements

- Node.js
- npm
- FFmpeg / `ffprobe`
- FLAC tools / `metaflac` for removing FLAC metadata fields
- Spotify Developer app credentials

## Setup

Install dependencies:

```powershell
npm.cmd install
```

Create a local `.env` file:

```env
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
```

You can use `.env.example` as the template. The real `.env` file is ignored by git.

## Run

```powershell
npm.cmd start
```

For development with auto-restart:

```powershell
npm.cmd run dev
```

## Workflow

1. Start the app.
2. Choose a music folder.
3. Confirm or edit the Artist and Album fields.
4. Click **Fetch Spotify**.
5. Review the preview table.
6. Click **Apply Changes** only when the preview looks correct.

## Project Structure

```text
src/
  main.js                 Electron window and IPC setup
  preload.js              Safe bridge between renderer and main process
  main/
    audio.js              ffprobe metadata reading and file sorting
    env.js                .env loading
    folderWorkflow.js     folder rename and audio flatten workflow
    spotify.js            Spotify auth, album search, and metadata fetch
  renderer/
    index.html            UI markup
    renderer.js           UI behavior and preview rendering
    styles.css            UI styling
```
