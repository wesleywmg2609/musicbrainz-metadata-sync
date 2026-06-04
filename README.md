# MusicBrainz Metadata Sync

Electron app for matching local music files with MusicBrainz metadata.

## Features

- Choose a local album folder or a parent folder containing multiple album folders.
- Read existing audio metadata with `ffprobe`.
- Sort files by disc and track number.
- Fetch MusicBrainz release metadata from artist and album search.
- Fetch MusicBrainz Cover Art Archive artwork.
- Preview fetched title, album, artist, album artist, disc, and track data.
- Preview the target folder name from fetched metadata.
- Apply folder cleanup by renaming each album folder and moving nested audio files into that album folder root.
- Save 1200px album artwork as `cover.jpg`, embed it in FLAC files, and save original artwork as `original.jpg`.
- Remove non-audio sidecar files and empty folders from the album folder after applying changes.

The app previews fetched metadata before applying folder and FLAC tag changes.

## Requirements

- Node.js
- npm
- FFmpeg / `ffprobe`
- FLAC tools / `metaflac` for replacing FLAC metadata fields and embedded artwork

## Setup

Install dependencies:

```powershell
npm.cmd install
```

No API key is required for MusicBrainz.

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
2. Choose an album folder, or choose a parent folder that contains multiple album folders.
3. Confirm or edit the Artist and Album fields.
4. Click **MusicBrainz**.
5. Review the preview table.
6. Click **Apply Changes** only when the preview looks correct.

## Project Structure

```text
src/
  main.js                 Electron window and IPC setup
  preload.js              Safe bridge between renderer and main process
  main/
    audio.js              ffprobe metadata reading and file sorting
    folderWorkflow.js     folder rename and audio flatten workflow
    musicbrainz.js        MusicBrainz release lookup and metadata fetch
  renderer/
    index.html            UI markup
    renderer.js           UI behavior and preview rendering
    styles.css            UI styling
```
