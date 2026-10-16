import * as gh from './github.js';
import * as gemini from './gemini.js';
import { Job, Profile, Assessment, AssessmentHistory } from '../models/index.js';
import { broadcast } from '../events.js';
import { stripComments, isTrivialChange, decorate } from './evidenceQuality.js';
import * as audit from './commitAudit.js';

export const YES = 'demonstrated';
export const NOT = 'not demonstrated in this scope';
const MAX_FILE = 60_000;        // max bytes per file sent to Gemini
const MAX_PROMPT = 90_000;      // max total file bytes per Gemini call
const MAX_FETCH_PER_REPO = 30;  // files whose content we download per repo
const MAX_CANDIDATES = 12;
const MAX_DIFF_SAMPLE = 6;      // diffs fetched per evidence file for the integrity audit

// ---------- cheap signals ----------
const SKIP = /(^|\/)(node_modules|vendor|dist|build|\.next|__pycache__|coverage|\.venv)\/|\.min\.|package-lock\.json$|yarn\.lock$|pnpm-lock\.yaml$/i;
const MANIFESTS = /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|pom\.xml|build\.gradle|Gemfile|go\.mod|Cargo\.toml|composer\.json|Pipfile)$/i;
const CODE_EXT = /\.(jsx?|tsx?|mjs|cjs|py|java|go|rb|php|cs|rs|kt|swift|c|cpp|h|sql|html|css|scss|sh|tf|prisma|graphql|gql)$/i;
const isEligible = (p) => !SKIP.test(p) && (MANIFESTS.test(p) || CODE_EXT.test(p) || /(^|\/)Dockerfile$/i.test(p) || /docker-compose\.ya?ml$/i.test(p) || /\.github\/workflows\/.+\.ya?ml$/i.test(p));

const RULES = [
  { label: 'SQL', re: /(^|[^o])sql\b|postgres|mysql|sqlite|relational database/i, ext: [/\.sql$/i],
    deps: ['pg', 'mysql', 'mysql2', 'sqlite3', 'better-sqlite3', 'sequelize', 'knex', 'typeorm', 'psycopg2', 'sqlalchemy', 'prisma'],
    pat: [[/\bSELECT\b.+\bFROM\b/i, 'SQL SELECT ... FROM query'], [/\bCREATE\s+TABLE\b/i, 'SQL CREATE TABLE statement'], [/\bINSERT\s+INTO\b/i, 'SQL INSERT INTO statement']] },
  { label: 'MongoDB', re: /mongo|nosql/i, deps: ['mongoose', 'mongodb', 'pymongo', 'motor'],
    pat: [[/mongoose\.(connect|model|Schema)|new\s+Schema\(/, 'Mongoose schema/model'], [/MongoClient|\.collection\(/, 'MongoDB client usage']] },
  { label: 'Docker', re: /docker|container/i, names: [/(^|\/)Dockerfile$/i, /docker-compose\.ya?ml$/i] },
  { label: 'Kubernetes', re: /kubernetes|k8s/i, names: [/(^|\/)(k8s|kubernetes)\//i] },
  { label: 'React', re: /react/i, ext: [/\.[jt]sx$/i], deps: ['react', 'react-dom', 'next'],
    pat: [[/from\s+['"]react['"]|\buse(State|Effect)\(/, 'React imports/hooks']] },
  { label: 'TypeScript', re: /typescript/i, ext: [/\.tsx?$/i], deps: ['typescript'], names: [/(^|\/)tsconfig\.json$/i] },
  { label: 'JavaScript', re: /javascript|\bjs\b|ecmascript|es6/i, ext: [/\.(jsx?|mjs|cjs)$/i],
    pat: [[/\b(const|let)\s+\w+\s*=\s*(async\s*)?\(.*\)\s*=>/, 'JavaScript arrow function']] },
  { label: 'Node.js', re: /\bnode(\.?js)?\b/i, deps: ['express', 'fastify', 'koa', '@nestjs/core'],
    pat: [[/require\(['"][\w@/.-]+['"]\)|process\.env\./, 'Node.js module/env usage']] },
  { label: 'Express / REST APIs', re: /\bexpress(\.?js)?\b|\brest(ful)?\b|\bapis?\b/i, deps: ['express', 'fastify', 'koa', 'flask', 'fastapi', 'django', 'djangorestframework'],
    pat: [[/\b(app|router)\.(get|post|put|patch|delete)\s*\(/, 'HTTP route handler'], [/@(app|router)\.(get|post|put|delete)\(|@(Get|Post|Put|Delete)Mapping/, 'HTTP route decorator']] },
  { label: 'Python', re: /python/i, ext: [/\.py$/i], deps: ['numpy', 'pandas', 'flask', 'django', 'fastapi'],
    pat: [[/^\s*(def|class)\s+\w+.*:\s*$/, 'Python function/class definition']] },
  { label: 'Java', re: /\bjava\b|\bspring\b/i, ext: [/\.java$/i], deps: ['spring-boot', 'springframework'],
    pat: [[/public\s+(static\s+)?(class|void|interface)\b/, 'Java class/method']] },
  { label: 'Testing', re: /\b(test(ing|s)?|jest|pytest|unit\s*test\w*|tdd|mocha|cypress)\b/i,
    ext: [/\.(test|spec)\.[jt]sx?$/i, /(^|\/)test_.*\.py$/i, /_test\.(py|go)$/i],
    deps: ['jest', 'mocha', 'vitest', 'pytest', 'cypress', 'junit', '@testing-library/react', 'supertest'],
    pat: [[/\b(describe|it|test)\(\s*['"`]/, 'Test case definition'], [/\bassert\w*\(|\bexpect\(/, 'Assertion']] },
  { label: 'CI/CD', re: /ci\/?cd|continuous integration|github actions|jenkins|pipelines?/i,
    names: [/\.github\/workflows\/.+\.ya?ml$/i, /(^|\/)Jenkinsfile$/i, /(^|\/)\.gitlab-ci\.yml$/i] },
  { label: 'AWS', re: /\baws\b|amazon web services|\bs3\b|\bec2\b/i, deps: ['aws-sdk', '@aws-sdk/client-s3', 'boto3'],
    pat: [[/aws-sdk|boto3|\bs3\.(put|get|upload)/i, 'AWS SDK usage']] },
  { label: 'Machine Learning', re: /machine learning|\bml\b|deep learning|tensorflow|pytorch|scikit/i,
    deps: ['tensorflow', 'torch', 'scikit-learn', 'sklearn', 'keras', 'transformers', 'xgboost'] },
  { label: 'HTML/CSS', re: /\bhtml\b|\bcss\b|front-?end/i, ext: [/\.(html|css|scss)$/i] },
  { label: 'GraphQL', re: /graphql/i, ext: [/\.(graphql|gql)$/i], deps: ['graphql', 'apollo-server', '@apollo/client', 'graphene'] },
  { label: 'Redis', re: /redis/i, deps: ['redis', 'ioredis'] },
  { label: 'Go', re: /\bgolang\b/i, ext: [/\.go$/i] },
  { label: 'Git', re: /\bgit(hub)?\b|version control/i, names: [/(^|\/)\.gitignore$/i, /(^|\/)\.github\//i] },
];

const STOP = new Set(['and', 'the', 'with', 'for', 'experience', 'knowledge', 'skills', 'strong', 'good', 'understanding', 'working', 'proficiency']);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function rulesFor(skill) {
  const matched = RULES.filter((r) => r.re.test(skill));
  if (matched.length) return matched;
  const tokens = skill.toLowerCase().split(/[^a-z0-9+#.]+/).filter((t) => t.length > 2 && !STOP.has(t));
  return tokens.length ? [{ label: skill, tokens, weak: true }] : [];
}

function depsOf(file) {
  if (/package\.json$/i.test(file.path)) {
    try { const j = JSON.parse(file.text); return new Set(Object.keys({ ...j.dependencies, ...j.devDependencies })); } catch { /* fall through */ }
  }
  return new Set(file.text.toLowerCase().match(/[a-z0-9_.@/-]+/g) || []);
}

export function findCandidates(skill, repo, ref, files) {
  const rules = rulesFor(skill);
  const out = [];
  const url = (p, line) => `https://github.com/${repo}/blob/${ref}/${p.split('/').map(encodeURIComponent).join('/')}#L${line}`;
  for (const f of files) {
    const perFile = [];
    const add = (line, reason, weak = false) => perFile.length < 2 && perFile.push({ repo, file: f.path, line, url: url(f.path, line), reason, weak });
    const clean = f.text ? stripComments(f.text, f.path) : null; // comments never count as evidence
    const lines = clean ? clean.split('\n') : null;
    for (const r of rules) {
      if (r.ext?.some((x) => x.test(f.path))) add(1, `File type matches ${r.label}: ${f.path}`);
      else if (r.names?.some((x) => x.test(f.path))) add(1, `${r.label}-related file: ${f.path}`);
      if (r.tokens?.some((t) => f.path.toLowerCase().includes(t))) add(1, `File path mentions "${skill}"`, true);
      if (!lines) continue;
      if (r.deps && MANIFESTS.test(f.path)) {
        const set = depsOf({ path: f.path, text: clean });
        const d = r.deps.find((x) => set.has(x));
        if (d) add(Math.max(1, lines.findIndex((l) => l.toLowerCase().includes(d)) + 1), `Dependency "${d}" declared in ${f.path.split('/').pop()}`);
      }
      for (const [re, desc] of r.pat || []) {
        const i = lines.findIndex((l) => l.length < 500 && re.test(l));
        if (i >= 0) add(i + 1, desc);
      }
      if (r.tokens) {
        const t = r.tokens.find((tk) => new RegExp(`\\b${esc(tk)}\\b`, 'i').test(clean));
        if (t) add(Math.max(1, lines.findIndex((l) => new RegExp(`\\b${esc(t)}\\b`, 'i').test(l)) + 1), `Source mentions "${t}"`, true);
      }
    }
    out.push(...perFile);
  }
  return out;
}

const dedupe = (cs) => { const s = new Set(); return cs.filter((c) => { const k = `${c.repo}|${c.file}|${c.line}`; return !s.has(k) && s.add(k); }); };

// ---------- evaluation (Gemini confirms cheap signals; rules are the fallback) ----------
async function assess(a, candidates, getText) {
  const cands = dedupe(candidates).slice(0, MAX_CANDIDATES);
  if (!cands.length) {
    return {
      status: NOT, confidence: 0.6, evidence: [], source: 'rules',
      explanation: `No files, dependencies or code patterns related to "${a.skill}" were found in the scanned scope (latest public non-fork repositories).`,
    };
  }
  const strip = ({ weak, ...c }) => c;
  try {
    if (!gemini.geminiAvailable()) throw new Error('Gemini not configured');
    const files = []; const seen = new Set(); let total = 0;
    for (const c of cands) {
      const k = `${c.repo}/${c.file}`;
      if (seen.has(k) || files.length >= 3) continue;
      seen.add(k);
      const t = await getText(c.repo, c.file);
      if (t == null) continue;
      const body = stripComments(t, c.file).slice(0, MAX_FILE);
      if (total + body.length > MAX_PROMPT) continue;
      total += body.length;
      files.push({ path: k, text: body });
    }
    const r = await gemini.confirmSkill({ skill: a.skill, jobSnippet: a.jobSnippet, candidates: cands, files });
    let evidence = [];
    if (r.demonstrated) {
      evidence = r.supporting.map((s) => ({ ...strip(cands[s.index]), reason: s.reason || cands[s.index].reason }));
      if (!evidence.length) evidence = cands.slice(0, 3).map(strip);
    }
    return { status: r.demonstrated ? YES : NOT, confidence: r.confidence, evidence, explanation: r.explanation || (r.demonstrated ? 'Evidence confirmed in the cited files.' : 'Signals were found but did not show real use of this skill.'), source: 'gemini' };
  } catch (err) {
    console.warn(`[analyzer] Gemini failed for "${a.skill}", using rule-based signals:`, err.message);
    const strong = cands.filter((c) => !c.weak);
    if (!strong.length) {
      return { status: NOT, confidence: 0.4, evidence: [], source: 'rules', explanation: `Only weak keyword mentions of "${a.skill}" were found, and AI confirmation was unavailable.` };
    }
    return {
      status: YES, confidence: Math.min(0.8, 0.4 + 0.1 * strong.length), evidence: strong.slice(0, 5).map(strip), source: 'rules',
      explanation: `Rule-based assessment (AI confirmation unavailable): ${strong.length} signal(s) found, e.g. ${strong[0].reason} in ${strong[0].file}.`,
    };
  }
}

// ---------- authorship, dates, dedupe ----------
const WEEK = 7 * 86_400_000;

/** Effective date for an evidence commit. Order of trust:
 *  observed (our poller saw the push) > push-event (GitHub's own record) > commit-metadata (author-editable). */
function stamp(au, ctx) {
  let at = au.committedAt; let dateSource = 'commit-metadata';
  if (ctx.observed?.shas.has(au.commitSha)) { at = ctx.observed.at; dateSource = 'observed'; }
  else if (ctx.pushTimes?.get(au.commitSha)) { at = ctx.pushTimes.get(au.commitSha); dateSource = 'push-event'; }
  const differs = dateSource !== 'commit-metadata' && Math.abs(new Date(at) - new Date(au.committedAt)) > WEEK;
  return {
    commitSha: au.commitSha, commitUrl: au.commitUrl, authorLogin: au.authorLogin, verified: au.verified,
    committedAt: new Date(at).toISOString(), dateSource, ...(differs ? { claimedAt: au.committedAt } : {}),
  };
}

/** Commit-history audit for one evidence file: age, bursts, repeated messages, low-impact churn.
 *  It only flags things for a human to review. It never declares a commit "fake". */
async function auditEvidence(e, ctx) {
  const history = await ctx.history(e.repo, e.file);
  if (!history.length) return {};
  const sample = [];
  for (const h of history.slice(0, MAX_DIFF_SAMPLE)) {
    try { sample.push({ sha: h.sha, ...(await gh.commitDetail(e.repo, h.sha)) }); }
    catch (err) { if (gh.isRateLimit(err)) throw err; }
  }
  const repoFlags = audit.auditRepoCommits(await ctx.repoCommits(e.repo));
  return { integrity: audit.auditFile(e.file, history, sample, repoFlags) };
}

/** Keeps only evidence the user actually committed (one item per file) and stamps commit/author/date.
 *  Evidence in files the user never touched is dropped; if nothing remains the skill becomes a gap. */
async function attribute(r, ctx) {
  if (r.status !== YES || !ctx) return r;
  const kept = []; const rejected = []; const seen = new Set();
  for (const e of r.evidence) {
    const k = `${e.repo}/${e.file}`;
    if (seen.has(k)) continue; // 100 changes in one file = one piece of evidence
    seen.add(k);
    if (e.commitSha) { kept.push(e); continue; } // already verified earlier and the file is unchanged
    let au;
    try { au = await ctx.authorship(e.repo, e.file); }
    catch (err) { if (gh.isRateLimit(err)) throw err; au = undefined; } // unknown, not a rejection
    if (au === null) rejected.push(k);
    else kept.push(au ? { ...e, ...stamp(au, ctx) } : { ...e, authorUnverified: true });
  }
  if (!kept.length) {
    return {
      ...r, status: NOT, confidence: 0.6, evidence: [],
      explanation: `Related code was found in ${rejected.length} file(s) (${rejected.slice(0, 3).join(', ')}), but no commits by @${ctx.username} touch them, so it is not counted as this student's work.`,
    };
  }

  // Commit integrity audit (history, age, suspicious patterns). Already-audited evidence is reused.
  const audited = await pool(kept, 3, async (e) => {
    if (e.integrity) return e;
    try { return { ...e, ...(await auditEvidence(e, ctx)) }; }
    catch (err) { if (gh.isRateLimit(err)) throw err; return e; } // audit is best-effort
  });

  const best = Math.max(...audited.map((e) => e.integrity?.freshness ?? 1));
  const staleOnly = audited.every((e) => e.integrity?.status === 'stale');
  const staleNote = staleOnly ? ' All matching evidence is more than 2 years old, so it is not treated as proof of current skill.' : '';
  const note = rejected.length ? ` ${rejected.length} other matching file(s) were ignored because @${ctx.username} did not commit them.` : '';
  return {
    ...r, evidence: audited, staleOnly,
    confidence: +(r.confidence * (0.5 + 0.5 * best)).toFixed(2),
    explanation: `${r.explanation}${note}${staleNote}`,
  };
}

const evaluateSkill = async (a, candidates, getText, ctx) => attribute(await assess(a, candidates, getText), ctx);

const once = (map, key, fn) => { if (!map.has(key)) map.set(key, fn()); return map.get(key); };

async function makeCtx(username, refOf, observed) {
  const info = await gh.getPushInfo(username);
  const memo = new Map();
  const hist = new Map();
  const repoC = new Map();
  return {
    username, pushTimes: info.pushTimes, observed,
    authorship: (repo, file) => once(memo, `${repo}:${file}`, () => gh.fileAuthorship(repo, file, username, refOf(repo))),
    history: (repo, file) => once(hist, `${repo}:${file}`, () => gh.fileHistory(repo, file, username, refOf(repo))),
    repoCommits: (repo) => once(repoC, repo, () => gh.userCommits(repo, username, refOf(repo))),
  };
}

async function pool(items, size, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

const makeGetText = (cache, refOf) => async (repo, path) => {
  const k = `${repo}:${path}`;
  if (cache.get(k) != null) return cache.get(k);
  let t = null;
  try { t = await gh.getFileText(repo, path, refOf(repo)); } catch { /* ignore */ }
  cache.set(k, t);
  return t;
};

// ---------- job skills ----------
function keywordSkills(text) {
  const lines = text.split('\n');
  const out = [];
  for (const r of RULES) {
    const line = lines.find((l) => r.re.test(l));
    if (line) out.push({ skill: r.label, importance: /nice to have|preferred|bonus|a plus/i.test(line) ? 'preferred' : 'required', jobSnippet: line.trim().slice(0, 200) });
  }
  return out.slice(0, 12);
}

async function extractJobSkills(text) {
  try {
    const skills = await gemini.extractSkills(text);
    if (skills.length) return { skills, by: 'gemini' };
  } catch (e) { console.warn('[analyzer] Gemini skill extraction failed:', e.message); }
  return { skills: keywordSkills(text), by: 'rules' };
}

// ---------- initial analysis ----------
async function scanRepo(repo, username) {
  const sha = await gh.latestSha(repo.fullName, repo.defaultBranch);
  if (!sha) return null;
  let tree = (await gh.getTree(repo.fullName, sha)).filter((t) => !SKIP.test(t.path));
  if (repo.contributed) { // someone else's repo: only look at files this user actually committed
    const mine = await gh.authoredPaths(repo.fullName, username);
    tree = tree.filter((t) => mine.has(t.path));
    if (!tree.length) return null;
  }
  const depth = (p) => p.split('/').length;
  const toFetch = tree.filter((t) => isEligible(t.path) && t.size <= MAX_FILE)
    .sort((a, b) => (MANIFESTS.test(b.path) - MANIFESTS.test(a.path)) || depth(a.path) - depth(b.path) || a.size - b.size)
    .slice(0, MAX_FETCH_PER_REPO);
  const texts = new Map();
  await pool(toFetch, 6, async (t) => { try { texts.set(t.path, await gh.getBlobText(repo.fullName, t.sha, MAX_FILE)); } catch { /* skip */ } });
  return { repo, sha, files: tree.map((t) => ({ path: t.path, text: texts.get(t.path) ?? null })) };
}

export async function analyzeProfile({ jobUrl, jobText, githubLink }) {
  const username = gh.parseUsername(githubLink);
  if (!username) throw new gh.AppError(400, 'Enter a valid GitHub username or profile link.', 'BAD_USER');
  const warnings = [];

  const owned = await gh.listRepos(username);
  const contributed = await gh.listContributedRepos(username, owned.map((r) => r.fullName));
  const repos = [...owned, ...contributed];
  if (!repos.length) throw new gh.AppError(422, 'This user has no public, non-fork repositories to analyse.', 'NO_REPOS');

  const { skills, by } = await extractJobSkills(jobText);
  if (!skills.length) throw new gh.AppError(422, 'No technical skills could be extracted from the job text. Paste the full job description.', 'NO_SKILLS');
  if (by === 'rules') warnings.push('Gemini was unavailable for skill extraction; skills were detected with a keyword list and may be incomplete.');

  let scans;
  try { scans = (await pool(repos, 3, (r) => scanRepo(r, username))).filter(Boolean); }
  catch (e) {
    if (gh.isRateLimit(e)) throw new gh.AppError(429, 'GitHub API rate limit reached while scanning repositories. Try again later.', 'GITHUB_RATE_LIMIT');
    throw e;
  }
  if (!scans.length) throw new gh.AppError(422, 'The repositories are empty, so there is nothing to scan.', 'NO_COMMITS');

  const cache = new Map();
  scans.forEach((s) => s.files.forEach((f) => f.text != null && cache.set(`${s.repo.fullName}:${f.path}`, f.text)));
  const refs = Object.fromEntries(scans.map((s) => [s.repo.fullName, s.sha]));
  const getText = makeGetText(cache, (r) => refs[r]);
  const ctx = await makeCtx(username, (r) => refs[r]);

  const firstLine = jobText.split('\n').map((l) => l.trim()).find(Boolean) || 'Job';
  let host = ''; try { host = new URL(jobUrl).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
  const job = await Job.create({ title: firstLine.slice(0, 120), company: host, sourceUrl: jobUrl, text: jobText, requiredSkills: skills, extractedBy: by });

  const profile = await Profile.findOneAndUpdate(
    { username: username.toLowerCase() },
    { username: username.toLowerCase(), jobId: job._id, repos: scans.map((s) => ({ fullName: s.repo.fullName, defaultBranch: s.repo.defaultBranch, contributed: Boolean(s.repo.contributed), lastCheckedCommit: s.sha })) },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  let docs;
  try {
    docs = await pool(skills, 2, async (s) => {
      const cands = scans.flatMap((sc) => findCandidates(s.skill, sc.repo.fullName, sc.sha, sc.files));
      const r = await evaluateSkill(s, cands, getText, ctx);
      return { profileId: profile._id, skill: s.skill, importance: s.importance, jobSnippet: s.jobSnippet, ...r, updatedAt: new Date() };
    });
  } catch (e) {
    if (gh.isRateLimit(e)) throw new gh.AppError(429, 'GitHub API rate limit reached while verifying authorship. Try again later.', 'GITHUB_RATE_LIMIT');
    throw e;
  }
  if (docs.some((d) => d.source === 'rules' && d.evidence.length && /unavailable/.test(d.explanation))) warnings.push('Gemini was unavailable for some skills; those were assessed with rule-based signals only.');

  await Assessment.deleteMany({ profileId: profile._id });
  await AssessmentHistory.deleteMany({ profileId: profile._id });
  await Assessment.insertMany(docs);
  return { ...(await getView(username)), warnings };
}

export async function getView(username) {
  const profile = await Profile.findOne({ username: username.toLowerCase() }).lean();
  if (!profile) return null;
  const [job, assessments, history] = await Promise.all([
    Job.findById(profile.jobId).lean(),
    Assessment.find({ profileId: profile._id }).sort({ importance: -1, skill: 1 }).lean(),
    AssessmentHistory.find({ profileId: profile._id }).sort({ time: -1 }).limit(50).lean(),
  ]);
  return { profile: { username: profile.username, repos: profile.repos }, job, assessments: assessments.map(decorate), history };
}

// ---------- incremental re-assessment ----------
const locks = new Set();

export async function applyChange(profileId, fullName, newSha) {
  const key = `${profileId}:${fullName}`;
  if (locks.has(key)) return;
  locks.add(key);
  try {
    const profile = await Profile.findById(profileId);
    const repo = profile?.repos.find((r) => r.fullName.toLowerCase() === fullName.toLowerCase());
    if (!repo || repo.lastCheckedCommit === newSha) return;

    let change;
    try {
      change = repo.lastCheckedCommit ? await gh.compare(repo.fullName, repo.lastCheckedCommit, newSha) : await gh.commitFiles(repo.fullName, newSha);
    } catch (e) {
      if (e.status === 404 || e.status === 422) change = await gh.commitFiles(repo.fullName, newSha); // e.g. force-push
      else throw e;
    }
    const { files, commitCount, commits } = change;
    const changed = new Set();
    files.forEach((f) => { changed.add(f.path); if (f.previous) changed.add(f.previous); });
    const base = {
      profileId, time: new Date(), repo: repo.fullName, commit: newSha, changedFiles: [...changed],
      commitCount, commitUrl: `https://github.com/${repo.fullName}/commit/${newSha}`,
      authors: [...new Set(commits.map((c) => c.author).filter(Boolean))],
    };
    const done = () => Profile.updateOne({ _id: profileId, 'repos.fullName': repo.fullName }, { $set: { 'repos.$.lastCheckedCommit': newSha } });

    // Fake-commit guard: whitespace / comment / re-indent only changes never trigger a reassessment.
    const relevant = files.filter((f) => isEligible(f.path) || (f.previous && isEligible(f.previous)));
    if (isTrivialChange(relevant)) {
      const history = await AssessmentHistory.create({ ...base, skillChanges: [], ignoredTrivial: true, note: 'Trivial change ignored: only whitespace, comments or formatting changed.' });
      await done();
      broadcast('reassessment', { username: profile.username, history: history.toObject(), assessments: [] });
      console.log(`[change] ${fullName}@${newSha.slice(0, 7)}: trivial change ignored (${commitCount} commit(s))`);
      return;
    }

    // Re-scan ONLY changed files that still exist
    const live = files.filter((f) => f.status !== 'removed' && !SKIP.test(f.path));
    const records = await pool(live, 6, async (f) => {
      let text = null;
      if (isEligible(f.path)) { try { text = await gh.getBlobText(repo.fullName, f.sha, MAX_FILE); } catch { /* skip */ } }
      return { path: f.path, text };
    });

    const refMap = Object.fromEntries(profile.repos.map((r) => [r.fullName, r.lastCheckedCommit]));
    refMap[repo.fullName] = newSha;
    const cache = new Map();
    records.forEach((r) => r.text != null && cache.set(`${repo.fullName}:${r.path}`, r.text));
    const getText = makeGetText(cache, (r) => refMap[r]);
    const ctx = await makeCtx(profile.username, (r) => refMap[r], { shas: new Set(commits.map((c) => c.sha)), at: new Date().toISOString() });

    const isChanged = (e) => e.repo === repo.fullName && changed.has(e.file);
    const skillChanges = []; const updated = [];
    for (const a of await Assessment.find({ profileId })) {
      const touched = a.evidence.some(isChanged);
      const retained = a.evidence.filter((e) => !isChanged(e)).map((e) => { const { _id, ...rest } = e.toObject ? e.toObject() : e; return rest; });
      const fresh = findCandidates(a.skill, repo.fullName, newSha, records);
      if (!touched && !fresh.length) continue; // skill unaffected by this commit
      const r = await evaluateSkill(a, [...retained, ...fresh], getText, ctx);
      const from = a.status;
      a.set({ ...r, updatedAt: new Date() });
      await a.save();
      skillChanges.push({ skill: a.skill, from, to: r.status });
      updated.push(decorate(a.toObject()));
    }

    const history = await AssessmentHistory.create({ ...base, skillChanges });
    await done();
    broadcast('reassessment', { username: profile.username, history: history.toObject(), assessments: updated });
    console.log(`[change] ${fullName}@${newSha.slice(0, 7)}: ${commitCount} commit(s), ${changed.size} file(s), ${skillChanges.length} skill(s) reassessed`);
  } catch (e) {
    console.error(`[change] failed for ${fullName}:`, e.message); // lastCheckedCommit not advanced, so it is retried next tick
  } finally {
    locks.delete(key);
  }
}