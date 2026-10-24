# Paper Voice

Read and listen to PDF papers. Paper Voice opens a PDF locally, reads it aloud with Cartesia Sonic 3.6 or OpenAI text-to-speech while highlighting the passage being spoken, and offers a reflowed **Reading view** — a single scrolling column in which display equations, figures and tables appear exactly as typeset in the paper rather than as the scrambled text of their text layer.

It runs as a macOS desktop app (Electron, Apple Silicon) and as a web app served by a Cloudflare worker. Both use the same React reader.

**Install on macOS:** download `Paper-Voice-<version>-arm64.dmg` from the [Releases](https://github.com/tingyuansen/pdf-voice/releases) page and follow [INSTALL.md](INSTALL.md).

## What it does

- **Two views of the same document.** *PDF view* shows the pages as printed, scrolling continuously, with fit-width and 50–300 % zoom (buttons, trackpad pinch, or ctrl/⌘ + scroll) and sharp rendering at the display's pixel ratio. *Reading view* reflows the text into one comfortable column (18–40 px) that runs across page boundaries. Itemize and enumerate items are kept whole: a wrapped item is one paragraph, and every marked line starts a new item.
- **Equations, figures and tables as set in the paper.** Reading view detects display equations from their labels and geometry, and figures and tables from their captions, then rasterises those regions from the PDF page and shows them inline at the reading size. Inline sub- and superscripts are rendered as such. Running heads, page numbers and draft line numbers are recognised and dropped.
- **Listen.** Two speech engines, switchable in the sidebar: OpenAI `gpt-4o-mini-tts` (the default; 13 voices, roughly a quarter of the price per character) and Cartesia `sonic-3.6` (14 voices, the more natural reader). Playback speed 0.75–2×. Read a selection, the current page, or the whole document; playback buffers ahead, continues across pages, and the passage being read is highlighted in either view. The pause button pauses at any moment — including while a passage is still being prepared, where the clip waits ready and resumes — so a slow first passage or the silence at a page turn no longer risks dropping the reading. Every clip generated in a session is kept in memory (up to 256 MB, oldest evicted first), so replaying a passage, re-reading an earlier page, or reloading a revised PDF only sends text that has not been spoken yet; nothing is written to disk and the store empties when the app closes. Equations are announced by number rather than read symbol by symbol; figures are skipped and their captions read.
- **Clean mode** is the default once a document opens: every control hidden except a small floating group — voice, Open PDF, reload, and a light/dark toggle. Dropping a PDF anywhere still opens it; Esc or the restore button brings the full window back. Dark mode inverts the page with hues preserved, so figures keep their colours.
- **Selections snap to sentences.** A drag is cut at the page's own passage boundaries: any sentence it covers by at least half is read verbatim, so overlapping or superset selections reuse the clips already generated, in either view; a short phrase inside a sentence is read as dragged. Selecting while listening leaves playback running and queues the selection for **Read selection**.
- **Reload.** A **Reload** button re-reads the open file from disk and keeps your page, so a re-exported paper is picked up without hunting for it again. The desktop app and Chromium browsers re-read the file through a file handle; other browsers hold only a snapshot and ask you to open the new version instead.
- **Private by construction.** The PDF never leaves the machine; only the passages you play are sent to the selected speech engine. The API key stays on the server side (the Cloudflare worker, or the app's loopback-only local server), never in the browser.

The layout analysis is geometric — column edges from clusters of long lines, the modal line end as the margin, glyph size and baseline offsets for scripts, caption anchors and vertical bands for floats — and is not tuned to any particular paper. It has been checked against two-column astronomy manuscripts (including a numbered draft with full-width captions), a Word-exported proposal with image-only figures, and prose-only documents, where nothing is detected.

## Run the web version

Requires Node 22.13 or newer.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173 and drop a PDF anywhere, or use **Open PDF**. `predev` copies `SONIC` (a Cartesia key) and `OPENAI` from `~/.env` into the git-ignored `.dev.vars`. An engine without a configured key offers a password field for a session-only key. `npm run build` produces the deployable worker in `dist/`.

## Build the macOS app

```sh
npm run desktop:build      # bundle the reader and PDF.js assets into desktop-dist/
npm run desktop:dev        # …and launch it in Electron
npm run desktop:package    # …and build the DMG into work/mac-release/
```

The app bundles Electron, the built reader, PDF.js worker, CMaps and standard fonts, and a small local HTTP server that serves the reader on a loopback port and proxies speech requests. It reads `SONIC` and `OPENAI` from `~/.env` at request time; documents are opened with Open PDF or by dropping them onto the window. The DMG is ad-hoc signed for local use; Developer ID signing and notarization are not configured.

## Checks

```sh
npm test            # layout, phrase, decimal, buffer, selection and playback checks (pure Node)
npm run test:desktop  # packaged local server: assets, key handling, one live speech request
npx tsc --noEmit
npm run lint
```

The checks that need a real PDF look for `public/examples/manuscript.pdf` and skip with a note when it is absent; any two-column paper placed there will exercise them, and the equation and figure census in `tests/verify-equations.mjs` is written for the paper it was developed on.

## Layout

```
app/          React reader (page.tsx), continuous PDF surface, styles, worker API route
lib/          reflow.ts (layout analysis), page-crop.ts (equation/figure rasteriser),
              phrase-boundaries.ts, passages.ts, number-runs.ts, speech-buffer.ts, playback.ts
desktop/      Electron main process, local server, packaging config, icon sources
public/       PDF.js worker, CMaps and standard fonts served to the reader
scripts/      local key import for the dev worker, CI install helper
tests/        verification scripts run by npm test
work/         (ignored) packaging output, logs and scratch
```

How a page becomes Reading view: text items from PDF.js are grouped into lines by baseline and gap; columns are inferred; numbered equations are anchored by their right-aligned labels and their fraction parts, limits and delimiters absorbed; captions define bands for figures and tables, split at the widest gap when a table sits over a figure; unnumbered equations are then sought outside figures; the remaining lines become paragraphs and headings with hyphenation repaired, and every text item stays mapped to a speech passage so highlights line up in both views.

## License

MIT — see [LICENSE](LICENSE). Speech is generated by the Cartesia or OpenAI API and billed to your account; see [Cartesia pricing](https://cartesia.ai/pricing) and [OpenAI pricing](https://developers.openai.com/api/docs/pricing).


## Apollo 14 — Professor IA (experimental)

When a PDF or EPUB is open, choose **Professor IA** or the raised-hand button in full or compact reading mode.
The reading engine pauses without losing its current page and sentence. The professor dialog can answer spoken questions via WebRTC or typed questions and reply with natural OpenAI Realtime audio. **Retomar leitura** closes the voice session and returns to the paused point.

The professor receives only the currently open page/chapter text, the current passage and any selected text, not the full local document. Voice turns and written questions are sent to OpenAI while the Realtime session is active. Audio and microphone tracks are disposed of when the teacher dialog is closed. Teacher profiles and instructions are stored locally under versioned `meu-foco-apollo-14-teacher-*` keys.

Profiles include independent settings for personality, didactic method, diagnostic questions before an explanation, answers, practical examples, reinforcement questions after an explanation, and a free-text instruction field. Create, rename and delete copies. Changes are saved automatically and update an ongoing session.

Set the server-side `OPENAI` secret (also used by the existing speech engine). `POST /api/teacher-session` mints a temporary Realtime credential; the permanent key is never sent to the browser. The client establishes WebRTC directly with OpenAI. Microphone input requires a secure origin and browser permission. On iPad Safari, use **Reproduzir áudio** if automatic remote audio playback is blocked. API Realtime and transcription traffic is metered separately from conventional text-to-speech.

The Apollo 14 work is isolated on `apollo-14-professor-realtime` until end-to-end Safari/iPad tests and deployment checks have been completed. The stable release is unchanged.
