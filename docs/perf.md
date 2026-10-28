# Perf results

Reference run: Settings → _Benchmark this device_. It runs 10,000 sessions × 500 rounds of the warm → mart → flat strategy, with seed 1, digest `ecb1b8c9…a157` (harness-data-analysis.md §14). Budgets (PLAYBOOK §7.2): under 20 s on a 4-core laptop, under 90 s on a mid-range phone. A phone result over 90 s blocks a release.

| Date       | Device                           | Browser               | Workers (P) | ms        | Rounds/s | Source                    |
| ---------- | -------------------------------- | --------------------- | ----------- | --------- | -------- | ------------------------- |
| 2026-10-28 | Build VM (shared, 4 vCPU class)  | Headless Chromium     | 3           | 6,800–9,100 | 550k–730k | `npm run test:perf` (#19) |
| 2026-10-28 | Pixel 11 Pro (flagship)          | Chrome (current)      | 6           | 3,976     | 1,256,807 | Owner, Settings → Benchmark on Pages |
| _pending_  | Mid-range Android (Pixel 6a class) | Chrome              |             |           |          | Run by the owner on Pages |
