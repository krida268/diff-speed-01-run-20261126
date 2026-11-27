// A faster drop-in for makefun-diff 1.0.0: run(input) returns, for every input
// { old, new }, exactly the answer makefun-diff 1.0.0 returns — make.fun's own
// patch of the two texts as one JSON string — only faster.
//
// The patch rule (competition.yaml): lines cut after every "\n" (a "\r" is part
// of the line; a last line with no "\n" is a line too); the common prefix is
// kept, then the common suffix of what is left; between them Myers's greedy
// search, keeping on each diagonal the path reaching furthest into the old
// text, the deletion when a deletion and an insertion reach the same point,
// never past either text's end, no edge pruning, every run of equal lines
// followed as far as it goes; the first path to reach both ends is the script.
// Hunks hold every change run with up to 3 kept lines before and after it;
// two runs at most 6 kept lines apart share a hunk; deletions before
// insertions in a run; a line with no newline is written with one and followed
// by "%". Identical texts are the first line alone.
//
// How it is faster than the house baseline (which walks the same search with
// one heap object per path step and compares whole line strings at every
// snake step):
//   - Lines are tokenized once per case into integer ids (one Map lookup per
//     line), so every later comparison is an integer comparison.
//   - The search keeps only the furthest-x value per (depth, diagonal) in
//     flat Int32Arrays — no per-step objects, no linked lists — and rebuilds
//     the one winning script by walking those values back down. The choice
//     at each step is recomputed with the baseline's own rule (deletion when
//     its reach is at least the insertion's), so the script it rebuilds is
//     the baseline's script, step for step.
//   - The patch is built with plain array pushes and one join.
// Nothing is cached from one case to the next: every run() call tokenizes
// its own two texts and runs its own search.

const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/** The kept lines a hunk shows before and after each change run. */
const CONTEXT = 3;

/**
 * A text's lines as integer ids, each with its "\n" (the last one without,
 * when the text does not end in one). The empty text has no lines; "\n" has
 * one, an empty line. `ids` maps each distinct line to its id and is shared
 * by the two texts of one case, so equal lines get equal ids.
 */
function tokenize(text, ids) {
  const parts = text.split('\n');
  const last = parts.length - 1;
  const count = last + (parts[last] !== '' ? 1 : 0);
  const out = new Int32Array(count);
  let next = ids.next;
  for (let i = 0; i < last; i++) {
    const line = `${parts[i]}\n`;
    let id = ids.map.get(line);
    if (id === undefined) {
      id = next++;
      ids.map.set(line, id);
    }
    out[i] = id;
  }
  if (parts[last] !== '') {
    const line = parts[last];
    let id = ids.map.get(line);
    if (id === undefined) {
      id = next++;
      ids.map.set(line, id);
    }
    out[last] = id;
  }
  ids.next = next;
  return out;
}

/**
 * The runs of the edit script of the middle slices a into b: [{ kind, count }]
 * in order, kind one of KEEP, DELETE, INSERT. The search is Myers's greedy
 * search with make.fun's rule: for depth d = 0, 1, 2, ... and each diagonal
 * k = x - y from -d to d in steps of 2, the furthest point a path of d edits
 * reaches on k is one old line past the furthest (d-1)-point on diagonal
 * k - 1 (a deletion) or one new line past the furthest (d-1)-point on
 * diagonal k + 1 (an insertion), whichever lies further into the old text,
 * and the deletion when both reach the same point; a move past the end of
 * either text is no candidate. From that point the path keeps every line
 * equal in both texts as far as it can. The first path to reach the ends of
 * both texts is the script.
 *
 * Only the furthest-x value per (d, k) is kept (Vs[d][k + d]); the winning
 * script is rebuilt by walking those values back down from the end, choosing
 * at each step with the same rule, so it is the baseline's script.
 */
function myersRuns(a, b) {
  const N = a.length;
  const M = b.length;
  const Vs = [];
  // Depth 0: the snake from (0, 0) along diagonal 0.
  const v0 = new Int32Array(1);
  let x = 0;
  while (x < N && x < M && a[x] === b[x]) x++;
  v0[0] = x;
  Vs.push(v0);
  if (x >= N && x >= M) return [];
  let D = -1;
  let K = 0;
  // The insertion source of diagonal k (Vp[k + d]) is the deletion source of
  // diagonal k + 2 (Vp[(k + 2) + d - 2]), so one read serves both: vCarry
  // holds it from the previous step. Only the two edge diagonals lack a
  // source: k = -d has no deletion, k = d has no insertion.
  for (let d = 1; d <= N + M; d++) {
    const Vd = new Int32Array(2 * d + 1);
    Vs.push(Vd);
    const Vp = Vs[d - 1];
    let vCarry = -1;
    let k = -d;
    for (; k <= d - 2; k += 2) {
      const ki = k + d;
      const vInsRaw = Vp[ki];
      const vDelRaw = vCarry;
      vCarry = vInsRaw;
      let delCand = -1;
      let insCand = -1;
      if (vDelRaw >= 0 && vDelRaw < N) delCand = vDelRaw + 1;
      if (vInsRaw >= 0 && vInsRaw - (k + 1) < M) insCand = vInsRaw;
      if (delCand < 0 && insCand < 0) {
        Vd[ki] = -1;
        continue;
      }
      let xx = delCand >= insCand ? delCand : insCand;
      let y = xx - k;
      while (xx < N && y < M && a[xx] === b[y]) {
        xx++;
        y++;
      }
      Vd[ki] = xx;
      if (xx >= N && y >= M) {
        D = d;
        K = k;
        break;
      }
    }
    if (D >= 0) break;
    // k = d: only a deletion, from vCarry (Vp[2d - 2]).
    const ki = 2 * d;
    let delCand = -1;
    if (vCarry >= 0 && vCarry < N) delCand = vCarry + 1;
    if (delCand < 0) {
      Vd[ki] = -1;
    } else {
      let xx = delCand;
      let y = xx - d;
      while (xx < N && y < M && a[xx] === b[y]) {
        xx++;
        y++;
      }
      Vd[ki] = xx;
      if (xx >= N && y >= M) {
        D = d;
        K = d;
      }
    }
    if (D >= 0) break;
  }
  if (D < 0) throw new Error('diff-speed: the search ended without reaching both ends');
  // Walk the winning script back down from (D, K) at (N, M).
  const rev = [];
  let d = D;
  let k = K;
  let cx = N;
  let cy = M;
  while (d > 0) {
    const Vp = Vs[d - 1];
    let vDel = -1;
    let vIns = -1;
    if (k - 1 >= -(d - 1)) {
      const v = Vp[k + d - 2];
      if (v >= 0 && v < N) vDel = v;
    }
    if (k + 1 <= d - 1) {
      const v = Vp[k + d];
      if (v >= 0 && v - (k + 1) < M) vIns = v;
    }
    const delCand = vDel >= 0 ? vDel + 1 : -1;
    const insCand = vIns;
    let xStart;
    let prevX;
    let prevY;
    let prevK;
    let kind;
    if (delCand >= insCand) {
      xStart = delCand;
      prevX = vDel;
      prevY = vDel - (k - 1);
      prevK = k - 1;
      kind = DELETE;
    } else {
      xStart = insCand;
      prevX = vIns;
      prevY = vIns - (k + 1);
      prevK = k + 1;
      kind = INSERT;
    }
    const keep = cx - xStart;
    if (keep > 0) rev.push({ kind: KEEP, count: keep });
    rev.push({ kind, count: 1 });
    cx = prevX;
    cy = prevY;
    k = prevK;
    d--;
  }
  // Depth 0: the snake from (0, 0) to (cx, cy).
  if (cx > 0) rev.push({ kind: KEEP, count: cx });
  rev.reverse();
  // Merge runs of one kind that stand next to each other (the search never
  // makes them, but merging keeps the list canonical either way).
  const runs = [];
  for (const r of rev) {
    const last = runs.at(-1);
    if (last !== undefined && last.kind === r.kind) last.count += r.count;
    else runs.push({ kind: r.kind, count: r.count });
  }
  return runs;
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a line of its own when it had none. */
function written(op, line) {
  return line.endsWith('\n') ? `${op}${line}` : `${op}${line}\n%\n`;
}

/** A text's lines as strings, each with its "\n" (the last one without, when the text does not end in one). */
function linesOf(text) {
  const parts = text.split('\n');
  const last = parts.length - 1;
  const lines = [];
  for (let i = 0; i < last; i++) lines.push(`${parts[i]}\n`);
  if (parts[last] !== '') lines.push(parts[last]);
  return lines;
}

/** make.fun's own patch of input.old into input.new, as one string. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('diff-speed: the input is { old, new }, two strings');
  }
  const ids = { map: new Map(), next: 0 };
  const aIds = tokenize(input.old, ids);
  const bIds = tokenize(input.new, ids);
  const a = linesOf(input.old);
  const b = linesOf(input.new);
  const n = a.length;
  const m = b.length;
  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && aIds[prefix] === bIds[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && aIds[n - 1 - suffix] === bIds[m - 1 - suffix]) suffix++;
  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  runs.push(...myersRuns(aIds.subarray(prefix, n - suffix), bIds.subarray(prefix, m - suffix)));
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  // The change runs: each a stretch of deletions and insertions between two kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes.at(-1);
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks.at(-1);
    const prev = h?.at(-1);
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h.at(-1);
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written('=', a[at]));
      for (let i = 0; i < c.dels; i++) out.push(written('-', a[c.o + i]));
      for (let i = 0; i < c.ins; i++) out.push(written('+', b[c.p + i]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', a[at]));
  }
  return out.join('');
}
