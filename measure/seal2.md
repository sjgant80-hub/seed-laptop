# Seal 2 — the instruments, the stock seed and the corpus, fixed before any measured run

Seal 1 (`a86742a`) committed the claims before any code. This seal commits, before the first measured run of each claim
it covers, exactly what will be measured and how. Nothing here loosens a bound of seal 1. Where a word of seal 1 needed a
precise instrument, the instrument is stated here and the reason given.

## What is fixed

| claim | measured by | data fixed by |
|---|---|---|
| L1a–L1d | `measure/l1.mjs`, `measure/judge.mjs`, `tools/plant.mjs`, `tools/serve.mjs`, `tools/cdp.mjs`, `office/*` | the stock seed `seeds/stock.genome.json` (genome `9b3cf788…`), `seeds/stock.full`, `mirror/*`, the publisher key in `seeds/publisher.json` |
| L2a–L2c | `measure/l2.mjs`, `measure/fidelity.mjs`, `measure/hostile.mjs`, `measure/judge.mjs`, `tools/sandbox.mjs`, `src/edge-in.mjs`, `src/parse/*` | `corpus/*` (20 files and `truth.json`, written once on GitHub's runner by `.github/workflows/corpus.yml` run 40910728433; SHA-256 of every file in `measure/params.json`) |
| L3 | `measure/l3.mjs`, `measure/readers.py`, `measure/judge.mjs`, `src/edge-out.mjs`, `src/leak.mjs` | `measure/out-content.json` |
| L4 | `measure/l4.mjs`, `tools/regrow.mjs`, `src/vault.mjs`, `src/regrow.mjs`, `vendor/bes-inward` (eca438d) | the stock seed, the public test phrase, `planSession` in `measure/l4.mjs`, two corpus originals |
| L5 | `measure/l5.mjs`, `measure/l5-script.mjs` (seed 51), `tools/device.mjs`, `tools/relay-run.mjs`, `src/sync.mjs`, `measure/webrtc.mjs`, `measure/webrtc-tab.mjs`, `measure/webrtc.html` | the stock seed, the public test phrase |
| L6 | `measure/l6.mjs`, `measure/l6-tab.mjs`, `measure/netns-day.sh`, `tools/day.mjs` (`planDay`, seed 20261029), `tools/trap.mjs`, `tools/smtp.mjs`, `vendor/airgap-prover` (828383b) | the stock seed, the corpus |
| L7 | `src/cost.mjs` (`COVERAGE`, the block coverage map) | the owner's own list, when the owner gives one |
| G1 | `witness-all.mjs`, `.witness/` (witness v0.6), `test/fuzz.test.mjs`, `test/hostile.mjs`, `test/kernels.mjs` | — |

The stock office's seven blocks, every one estate gear at a pinned commit: falloffice (Words, Sheets, Slides, Calendar,
Notes, Tasks), fallcrm (contacts and deals), fallledger (accounts), fallpdf (PDF writer), seedmind (knowledge notebook,
two files), fallmage (image editor), fallpage (page layout). All seven started clean in a sandbox in dev runs, so none was
dropped.

## How seal 1's words are measured (no bound changed)

1. **L1a, "from process start to Kar's first receipt".** The harness's wall clock from spawning the planting process to
   that process's exit. The process exits only after Kar's first receipt is written, so this includes Node's own start.
2. **L1b, "the network emulated offline before the seed is read".** The office page is opened first (it must be, to show
   the seed picker) and its service worker installed; then DevTools switches the network off; then the seed file is chosen
   (`DOM.setFileInputFiles`). The 20 s run from choosing the file to the last block reporting loaded.
3. **L1b, "every block loads … and its own startup code runs with no uncaught exception".** For each block: the bridge's
   `loaded` message, more than 0 elements in the block's own body (read inside its frame over DevTools), and 0 uncaught
   exceptions (DevTools `Runtime.exceptionThrown` in that frame, plus every exception the bridge caught), with 1.5 s left
   after the last block for late errors.
4. **L1b and L6c, "no request leaves the page's own origin".** A request to another origin counts as having left unless
   Chrome refused it before sending it (DevTools `Network.loadingFailed` with a `blockedReason`). The blocks' own code
   asks for its CDN fonts and scripts; the frame policy refuses every one inside the browser. The number refused is
   reported beside the number that left.
5. **L1c, "every bit of the genome".** Every bit of `seeds/stock.genome.json`'s bytes, each flipped alone, read as text
   the way a file is read (an invalid byte becomes U+FFFD), planted as a light seed with a counting mirror: refused, and
   0 blocks fetched. "64 one-bit changes spread evenly over its bytes": a block's files in genome order are one byte
   sequence; bit `⌊k·total/64⌋` for k = 0…63; each planted as a FULL seed rebuilt around the changed bytes.
6. **L2a, "fields".** As `measure/fidelity.mjs` states them; the image types count as one format.
7. **L2b, "core parses = 0".** A module-loader hook registered before anything else in the measuring process (which is
   the office's core for the measurement) counts every module loaded from `src/parse/`. The hostile corpus is made by
   `measure/hostile.mjs` in a process of its own (it reads zips to add the macro part), so its reading is not the core's.
8. **L2b, "bits flipped".** Eight files per benign file, one bit each at `⌊(k + ½)·bits/8⌋`, k = 0…7: evenly spaced and
   not chosen for being detectable. A flip that changes no structure a format can check (a pixel in a JPEG, a letter
   in a text file) leaves a well-formed file; if any such file is read in the sandbox and admitted, L2b fails as
   sealed and is kept failed, with the count.
9. **L3, "the internal markers".** `src/leak.mjs` `markers()`: the planted owner's and device's public keys (whole and
   their first 16 characters), the genome's id, the publisher's key, every block file's SHA-256, the vault reference
   form, the names seed-laptop / seed laptop / fall-kit / fallkit / konomi / light vault / LVT1 / SLS1 / genome / Kar,
   the home folder and the OS user name. Seal 1 named "block ids": they are ordinary words (`office`, `pdf`, `image`,
   `layout`, `mind`, `crm`, `ledger`), and `pdf` is in every PDF's own first line, so the marker is each block's folder
   as the office's internals spell it, `blocks/<id>/`.

10. **L4, "the state after regrow equals the state before, entry for entry and byte for byte".** The store's digest
    (SHA-256 of its canonical form) and every key's value compared one by one. "Refuses none of the session's owner
    actions": the regrown watch is fed the session's owner actions in order and every verdict is read. "Every bit of
    the vault's header": every bit of its header; "4,096 bits spread evenly over its body": bit
    `⌊k·bodyBits/4096⌋` of the body, k = 0…4095. A flipped vault counts as refused only if it restores nothing.
11. **L5, "at least 10% to the same keys".** Measured per round as the share of each device's edits whose key the
    other device also edits that round; the bound holds if the lowest share over every round and both devices is at
    least 0.10 (the script makes each device's first two edits of a round on one key both edit). Rounds 1–6 are A and
    B; then A is destroyed, C regrown, and rounds 7–9 are B and C. "None silently dropped": every write either device
    made before a sync is read back on both, as the value or as a conflict copy.
12. **L6, "packets to the declared sink only inside the 2 send windows".** A window runs from the user's send action
    to 2 s after the message was accepted, so the connection's own closing packets (FIN, ACK) fall inside it. In (b),
    an attempt counts as "after the user's send action" if it falls inside such a window. In (c), a browser has no mail
    connection: the two sends are written out as EML files for the owner's mail app, so nothing is sent from the tab.
13. **G1, the vault.** The vault's mutants are judged by its own tests only: its 2,000-input fuzz (a 600,000-round
    key for each long phrase) takes about 90 s, so it runs once per test pass, not once per mutant.
14. **The readers on the corpus before measuring.** During the PDF reader's rework the readers were run over the
    corpus's PDFs once, only to see that each still opens (yes, and how many characters); nothing was scored and
    nothing was changed because of it.

## Amendments after this seal, each before the first run it touches

- **L6 (a), `measure/netns-day.sh`.** Its first dispatch (run 40941980946) was cancelled 45 ms into the namespace
  step, before the day started: the script's opening clean-up ran `kill ${SINK_PID:-0}`, and with no sink yet that is
  `kill 0`, which signals the whole process group, the runner's step included. Nothing was measured. The clean-up now
  kills the sink only once it exists. What is measured, and how, is unchanged.
- **L6 (c), `tools/day.mjs`.** Its first run stopped before the tab opened: importing the day's plan installed the
  network trap in the measuring process itself, which then refused its own loopback server. Nothing was measured. The
  trap is now installed only when the day runs as its own process (as in (a) and (b)); what is measured is unchanged.
- **L1b's probe, and L1b2.** L1b read 0 elements in all seven block frames: its probe named each frame by the URL it
  had when DevTools attached, before an isolated sandboxed frame has one. L1b stays FAILED as measured;
  `measure/claims-c.json` seals L1b2, the same steps with the frames named after loading (`measure/l1b2.mjs`).
- **L3's runner part ran twice.** The workflow then ran both runner jobs on every dispatch, so the re-dispatch for
  L6 (a) (run 40943679324) also ran the L3 readers again. L3's measurement is the first run's (40941980946),
  committed as it came; the workflow now runs only the job it is asked for.
- **L6 (a) failed on its reading, and L6b is sealed as the fix.** L6 (a)'s one run counted 22 packets to an
  undeclared destination, every one addressed to the guest itself (the mail stand-in's replies coming in): the reading
  took both directions of the link. L6 stays FAILED as measured. `measure/claims-b.json` seals L6b before its run:
  the same day, captured in the direction the guest sends only (`tcpdump -Q in` on the host end), read the same way.

## Design changes since seal 1, all made on dev data before this seal

- **The inbound edge's immune memory (`src/immune.mjs`).** The spec reads files in "with the immune system watching":
  a file kept out once becomes an antibody (its SHA-256, declared type, stage, reason, the edge's code version), and
  the same bytes are refused on sight after that. Only refusals the bytes alone decide are remembered, only under the
  same edge version, and another device's antibodies are shown, never acted on (no false immunity). L2 measures the
  edge itself, so it runs without this memory.
- **The readers, reworked by the mutation gate's review.** The PDF reader's lexer reads to the end of its text (an
  unused range argument removed), a stream whose `/Length` is wrong loses only its one end-of-line, a cyclic page tree
  is read once, text shown before the first move counts as at the start; `textIn` lost text inside nested elements
  (`s += (go(k), '')` read `s` before the recursion added to it) and is fixed; the DOCX reader reads paragraphs in any
  wrapper (sdt, customXml, ins…); shared strings skip phonetic guides; a calendar reads only an event's own properties
  (an alarm's DESCRIPTION is not the event's); a multipart message, a calendar or a card that is cut short (no closing
  boundary, no END) is refused; the JPEG frame header is read when its nine bytes are the file's last.

- **The block frame.** Planned as a sandboxed iframe; a dev run in Chrome 155 showed a sandboxed frame's own navigation is
  never served by the service worker, so it fails offline. The office's service worker now serves each block's frame with
  the sandbox as a response header (CSP `sandbox`), which works offline and on a single origin.
- **The bridge removes a sandbox's forbidden APIs.** seedmind registers a service worker; in a sandbox that throws a
  SecurityError at startup. The bridge now removes the service worker, cache storage and cookies before a block runs.
- **The store's writer id.** A device regrown from the same phrase reused the old device's counters (a silent-loss bug
  the mutation gate's review surfaced): every device now writes under its own random key.
- **The PDF reader's integrity check.** A dev test showed damage in a PDF's catalog passed; the reader now requires the
  catalog and every object to end at `endobj`, and tries every stream.
