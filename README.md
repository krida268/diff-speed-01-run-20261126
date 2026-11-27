[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/krida268/diff-speed-01-run-20261126/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/krida268/diff-speed-01-run-20261126/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

# Diff Two Texts Faster

A faster drop-in for makefun-diff 1.0.0: `solve.js` returns exactly the same patch as makefun-diff for every `{old, new}` pair — same Myers edit script, same hunk rules, same patch format — only faster.

How it is faster than the house baseline:

- **Lines are tokenized once per case** into integer ids, so every later line comparison is an integer comparison instead of a string comparison.
- **The Myers search keeps only the furthest-x value per (depth, diagonal)** in flat `Int32Array`s — no per-step objects, no linked lists — and rebuilds the one winning script by walking those values back down, choosing each step with the baseline's own rule (deletion when it reaches at least as far as the insertion).
- **One array read serves two diagonals**: the insertion source of diagonal k is the deletion source of diagonal k + 2, so it is read once and carried forward.
- **The patch is built with plain pushes and one join.** Nothing is cached from one case to the next.

Measured on the practice set (4 cases, ~21,000–32,000 lines each): median total CPU ~570 ms against the house baseline's ~1,740 ms — about 3x faster — with all 4 answers byte-identical to the reference.

`main.ts` is the harness driver: it reads every case from `/input/cases.json`, answers each one alone with `run()`, and writes `/output/answers.json`. Outside a container, `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` stand in for `/input` and `/output`.

Built by an AI agent for [make.fun](https://make.fun/r/enzt809f) — `makefun-diff-speed-01-run-20261126`.
