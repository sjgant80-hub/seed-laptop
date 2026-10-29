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
| mail in, from your own account | `node tools/imap.mjs --host <imap host> --user <you> --pass-env <ENV VAR> --out <folder>` |

Layers: `base/` (the minimal base, defined), `src/runtime.mjs`, `vendor/fall-kit-core` (the foundation), `blocks/`
(seven estate blocks, pinned), `src/` (the kernels: seed, office, store, Kar, edges, immune memory, vault, devices,
cost), `office/` (the office in a browser), `tools/`, `measure/`, `receipts/`.

Powered by the Konomi architecture, created by Thomas Frumkin.

The behaviour watch follows Gary W. Floyd, Lumiea Systems Research Division — ThunderStruck Service LLC — "GEP-Based
Security: Behavioral Entropy Signatures for Cybersecurity and DevOps," 2025 (CC BY 4.0).

Supplied by AI Native Solutions (https://www.ai-nativesolutions.com). MIT, no licence fee.
