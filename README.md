# DSH Sidebar Video Player

A video player that lives in the **right Sidebar** of DeepSeek Harness (`dsh`), with live
playback telemetry and a small, read-only MP4/MOV container reader.

Open it once and you can play a local video beside the conversation while reading its
resolution, exact frame count, average frame rate, per-track bitrate, codec profile/level,
buffer health and dropped frames — numbers a plain `<video>` element does not expose.

## Install

GitHub source install (works without npm):

```sh
dsh plugin --profile web add github:XIANGDEEN/dsh-sidebar-video-player
```

For the desktop profile used by the DSH desktop app:

```sh
dsh plugin --profile desktop add github:XIANGDEEN/dsh-sidebar-video-player
```

If the package is later published to npm, the same profile can install it by name:

```sh
dsh plugin --profile web add dsh-sidebar-video-player
```

Restart or reload the Web UI after installing. The plugin appears as an enabled bundle
row named `dsh-sidebar-video-player`.

## Open it

- Right Sidebar → **Start** (the guide) → **Video player**.
- Or click the video icon beside Settings at the left Sidebar foot.

The player is a right-Sidebar tab. It needs an open Session, because the right column
is session-scoped; the footer icon is disabled while no Session is on screen.

## Features

- Play a local video by picker or drag-and-drop, or load an HTTP(S) video URL.
- **Folder playlist**: choose a folder and every video inside it is listed in a column to
  the right of the player. Each card shows a **first-frame thumbnail** and a duration
  badge; click an item to switch. The active item is highlighted, and the next item starts
  automatically when one ends.
- **Sorting**: order the playlist by name, duration, modified time or size, ascending or
  descending.
- Custom transport: play/pause, seek, volume, mute, playback rate, picture-in-picture,
  fullscreen.
- Keyboard shortcuts while the player has focus: `Space` / `K`, `J` / `L`, arrow keys,
  `M`, `F`.
- Live playback telemetry:
  - current time, duration, progress, buffered range and buffer ahead;
  - measured decoded FPS from `requestVideoFrameCallback`;
  - presented frames, dropped frames and total video frames from
    `getVideoPlaybackQuality()`;
  - playback rate and player state (playing, paused, buffering, ended).
- Deep MP4/MOV inspection without decoding media:
  - container: major/compatible brands, timescale, duration, `moov` position,
    fragmentation, track count;
  - video: codec fourcc, H.264/HEVC profile and level, coded/display size, aspect ratio,
    rotation, exact frame count, average FPS, per-track bitrate, bit depth, duration;
  - audio: codec, AAC profile, sample rate, channel count, bitrate, duration.
- Other browser-decodable containers (WebM, Ogg, …) still play and report measured
  resolution, FPS and frame counters. Container-level inspection is MP4/MOV only.
- A collapsible **Raw probe data** panel shows the exact parsed JSON.
- English and Simplified Chinese copy, using the host theme tokens.

## How the MP4/MOV reader works

The reader never loads a whole file into memory. It walks top-level ISO-BMFF boxes with
`Blob.slice`, reads `moov` once (capped at 64 MiB), and extracts:

- `mvhd` for the movie timescale/duration;
- each `trak` → `tkhd` (display size, rotation), `mdhd` (track timescale/duration,
  language), `hdlr` (video/audio handler), `stsd` (sample entry, codec fourcc,
  `avcC`/`hvcC`/`av1C`, `esds`), `stts` (sample count and timing) and `stsz`
  (sample bytes for the per-track bitrate).

It reports average values over the track, not instantaneous bitrate. Fragmented MP4
files are detected; when sample tables are empty, the player falls back to the measured
metrics from the `<video>` element.

## Compatibility

- Requires DSH `>=0.2.1-rc.3 <0.3.0-0`; built and tested against the Web client.
- Requires a browser that can decode the chosen container/codec. MP4/H.264/AAC is the
  safest choice; HEVC/AV1 support depends on the browser.
- The player is a view surface. It registers no agent tool, writes no Session events,
  and requests no file-system authority from the Host.

## Permissions and privacy

- A selected local file is read through a browser Blob URL; it is not uploaded.
- A remote URL is fetched by the browser only for playback. The plugin does not proxy
  remote media or read remote container metadata.
- No analytics, telemetry, external service, or credentials are used.
- The only Host-side surface is the plugin bundle row; all player state stays in the
  Web page.

## Verification

The MP4 reader was checked against `ffprobe` on two real files:

| File | Resolution | Frames | Avg FPS | Video bitrate | Audio |
| --- | --- | --- | --- | --- | --- |
| `boot.mp4` | 1280 × 720 | 193 | 24.000 | 2.50 Mbps | AAC LC, 32 kHz, stereo |
| `background.mp4` | 1600 × 914 | 3766 | 30.000 | 0.68 Mbps | none |

Those values match the `ffprobe` stream metadata for the same files. The plugin also
passes module-factory, manifest/locale/patch, and registration contract checks in the
source repository.

No screenshot is declared. The player is a view surface; adding a staged screenshot that
the code does not produce would be worse than an empty card. The numeric evidence above
is reproducible from the reader.

## Known limitations

- Deep container parsing covers `.mp4`, `.m4v` and `.mov`. Other formats are played but
  only expose what the browser reports.
- Remote video is not container-probed (cross-origin reads are not assumed).
- Encrypted sample entries (`encv`/`enca`) are not decrypted or inspected.
- The per-track bitrate is an average over the track, not a live network bitrate.
- The right Sidebar is session-scoped; there is no player without an open Session.

## License

MIT. See [LICENSE](LICENSE).
