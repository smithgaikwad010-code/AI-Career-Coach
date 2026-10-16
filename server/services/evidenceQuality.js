// Evidence-quality helpers: comment stripping, trivial-change detection, recency.
// Pure functions, no network. Used by analyzer.js.

const DAY = 86_400_000;

/** Minimum number of REAL changed lines (after removing blanks, comments, re-indents, duplicates)
 *  for a file change to count. Default 1 so a one-line `SELECT id, name FROM users;` still counts
 *  in the demo. Raise it with MIN_REAL_LINES=3 for stricter filtering. */
export const MIN_REAL_LINES = Math.max(1, Number(process.env.MIN_REAL_LINES) || 1);

// ---------- comment stripping (line numbers are preserved) ----------
const FAMILIES = {
  c: { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'", '`'] },
  hash: { line: ['#'], block: [], quotes: ['"', "'"], triple: true },
  sql: { line: ['--'], block: [['/*', '*/']], quotes: ["'", '"'] },
  markup: { line: [], block: [['<!--', '-->']], quotes: [] },
  css: { line: [], block: [['/*', '*/']], quotes: [] },
};
const EXT_FAMILY = {
  js: 'c', jsx: 'c', mjs: 'c', cjs: 'c', ts: 'c', tsx: 'c', java: 'c', go: 'c', c: 'c', cpp: 'c', h: 'c',
  cs: 'c', rs: 'c', kt: 'c', swift: 'c', php: 'c', scss: 'c', prisma: 'c',
  py: 'hash', rb: 'hash', sh: 'hash', yml: 'hash', yaml: 'hash', toml: 'hash', txt: 'hash', tf: 'hash', graphql: 'hash', gql: 'hash',
  sql: 'sql', html: 'markup', htm: 'markup', xml: 'markup', css: 'css',
};

function familyOf(path = '') {
  const p = path.toLowerCase();
  if (/(^|\/)(dockerfile|gemfile|pipfile)$/.test(p)) return 'hash';
  if (/(^|\/)jenkinsfile$/.test(p)) return 'c';
  const ext = p.match(/\.([a-z0-9]+)$/)?.[1];
  return EXT_FAMILY[ext] || null;
}

/** Replaces comments with spaces (newlines kept, so line numbers still match the original file).
 *  Strings are NOT blanked on purpose: real SQL very often lives inside string literals. */
export function stripComments(code, path = '') {
  const fam = FAMILIES[familyOf(path)];
  if (!fam || !code) return code || '';
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  const n = code.length;
  let out = '';
  let i = 0;
  while (i < n) {
    const b = fam.block.find(([open]) => code.startsWith(open, i));
    if (b) {
      const end = code.indexOf(b[1], i + b[0].length);
      const stop = end === -1 ? n : end + b[1].length;
      out += blank(code.slice(i, stop)); i = stop; continue;
    }
    if (fam.line.some((x) => code.startsWith(x, i))) {
      let end = code.indexOf('\n', i); if (end === -1) end = n;
      out += blank(code.slice(i, end)); i = end; continue;
    }
    const triple = fam.triple && (code.startsWith('"""', i) ? '"""' : code.startsWith("'''", i) ? "'''" : null);
    if (triple) {
      const end = code.indexOf(triple, i + 3);
      const stop = end === -1 ? n : end + 3;
      out += code.slice(i, stop); i = stop; continue;
    }
    const c = code[i];
    if (fam.quotes.includes(c)) {
      let j = i + 1;
      while (j < n) {
        if (code[j] === '\\') { j += 2; continue; }
        if (code[j] === c) break;
        if (code[j] === '\n' && c !== '`') break; // unterminated string: stop at end of line
        j++;
      }
      const stop = Math.min(n, j + 1);
      out += code.slice(i, stop); i = stop; continue;
    }
    out += c; i++;
  }
  return out;
}

// ---------- trivial change detection ----------
// Lines that carry no logic: lone brackets, or comment-looking lines.
const NOISE = /^([{}()[\];,]+|\/\/.*|#(?!include|!).*|--.*|\/\*.*|\*(\s.*)?|\*\/|<!--.*)$/;

/** Number of REAL changed lines in a unified-diff patch. Blank lines, comments, brackets,
 *  duplicate lines and pure re-indentation (same text removed and added) do not count.
 *  Returns null when GitHub gave no patch (binary or very large file). */
export function substantiveChange(patch) {
  if (typeof patch !== 'string') return null;
  const added = new Set();
  const removed = new Set();
  for (const raw of patch.split('\n')) {
    const sign = raw[0];
    if (sign !== '+' && sign !== '-') continue;
    const t = raw.slice(1).trim().replace(/\s+/g, ' ');
    if (!t || NOISE.test(t)) continue;
    (sign === '+' ? added : removed).add(t);
  }
  let n = 0;
  for (const t of added) if (!removed.has(t)) n++;
  for (const t of removed) if (!added.has(t)) n++;
  return n;
}

/** True when EVERY file in the change is whitespace/comment/format-only.
 *  Deleted or renamed files are never trivial (they invalidate old evidence). */
export function isTrivialChange(files, min = MIN_REAL_LINES) {
  if (!files.length) return false;
  return files.every((f) => {
    if (f.status === 'removed' || f.status === 'renamed') return false;
    const n = substantiveChange(f.patch);
    return (n ?? (f.additions || 0) + (f.deletions || 0)) < min;
  });
}

// ---------- recency ----------
export function recency(date) {
  const t = new Date(date).getTime();
  if (!Number.isFinite(t)) return null;
  const months = (Date.now() - t) / (30 * DAY);
  if (months <= 12) return 'recent';
  if (months <= 36) return 'dated';
  return 'old';
}
const FACTOR = { recent: 1, dated: 0.5, old: 0.3 };

/** Adds recency to every evidence item and lowers confidence for older evidence.
 *  Computed when read, so an item turns "dated"/"old" over time without a re-scan. */
export function decorate(a) {
  const evidence = (a.evidence || []).map((e) => ({ ...e, recency: e.committedAt ? recency(e.committedAt) : null }));
  const times = evidence.map((e) => new Date(e.committedAt).getTime()).filter(Number.isFinite);
  const lastEvidenceAt = times.length ? new Date(Math.max(...times)) : null;
  const rec = lastEvidenceAt ? recency(lastEvidenceAt) : null;
  const factor = a.status === 'demonstrated' && rec ? FACTOR[rec] : 1;
  return {
    ...a,
    evidence,
    lastEvidenceAt,
    recency: a.status === 'demonstrated' ? rec : null,
    rawConfidence: a.confidence,
    confidence: Math.round((a.confidence || 0) * factor * 100) / 100,
  };
}