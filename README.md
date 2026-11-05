# seed-laptop

**▶ Live: https://sjgant80-hub.github.io/seed-laptop/** · the office itself: https://sjgant80-hub.github.io/seed-laptop/office/

THE SEED LAPTOP, Stage 1: plant one signed seed on a machine with a minimal base, and a whole working office grows
from it (documents, sheets, slides, calendar, notes and tasks, contacts and deals, accounts, PDF, a knowledge notebook,
an image editor, page layout, and Kar the conductor), owned and local, from the estate's own gear. Old-world files are
translated only at the edges. Everything is backed up to an encrypted vault whose key stays with the owner.

Claims were sealed before any code (`measure/claims.json`, seal 1) and their instruments, seed and corpus before any
measured run (`measure/seal2.md`, seal 2); each is measured once, and a failed claim is kept. The receipts are in
`receipts/`; the live page reads them.

| | |
|---|---|
| plant on a laptop | `node tools/plant.mjs --seed seeds/stock.full --home <empty folder>` (Node 25, no network permission) |
| the tests and the fuzz | `node --test test/*.test.mjs` |
| the mutation gate | `node witness-all.mjs` (one kernel: `node witness-all.mjs pdf`) |
| a claim's measurement | `node measure/l1.mjs` … `node measure/l6.mjs local` (each refuses to run on data that differs from seal 2) |
| the office reopening with the network gone (L1e) | `node measure/l1e.mjs` (headless Chrome; serves HEAD and 76c2f67 exactly as committed, then stops the server) |
| the devices panel, three browsers (a development check, not a sealed claim) | `node tools/devices-check.mjs <commit> …` → `receipts/devices-check.json` |
| mail in, from your own account | `node tools/imap.mjs --host <imap host> --user <you> --pass-env <ENV VAR> --out <folder>` |

Layers: `base/` (the minimal base, defined), `src/runtime.mjs`, `vendor/fall-kit-core` (the foundation), `blocks/`
(seven estate blocks, pinned), `src/` (the kernels: seed, office, store, Kar, edges, immune memory, vault, devices,
cost, and the cost case over the years), `office/` (the office in a browser), `tools/`, `measure/` (the sealed
claims, their instruments, and `measure/judge.mjs`, which turns measured facts into verdicts and is mutation-gated like
the kernels), `receipts/`.

The page's cost case reads every external figure (UK CPI, vendors' list prices) from `vendor/sovereign-enterprise/data/basis.json`,
copied byte for byte from the estate's sourced basis (commit and SHA-256 in its `SOURCES.json`); `src/rentcase.mjs` does the sums,
gated like every other kernel. The amounts and choices are the reader's own; no price of ours appears anywhere.

Powered by the Konomi architecture, created by Thomas Frumkin.

The behaviour watch follows Gary W. Floyd, Lumiea Systems Research Division — ThunderStruck Service, LLC — "GEP-Based
Security: Behavioral Entropy Signatures for Cybersecurity and DevOps," 2025 (CC BY 4.0). The knowledge notebook
(seedmind) dreams with Gary W. Floyd's dream-cycle design, from his Nexus system.

Supplied by AI Native Solutions (https://www.ai-nativesolutions.com). MIT, no licence fee.
