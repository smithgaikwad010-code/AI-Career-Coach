import { Octokit } from '@octokit/rest';

export class AppError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

let octokit;
const o = () => (octokit ??= new Octokit({ auth: process.env.GITHUB_TOKEN, userAgent: 'ai-career-coach' }));
const split = (full) => { const [owner, repo] = full.split('/'); return { owner, repo }; };

export function isRateLimit(e) {
  return e?.status === 429 || (e?.status === 403 && (/rate limit/i.test(e.message || '') || e.response?.headers?.['x-ratelimit-remaining'] === '0'));
}

export function parseUsername(input = '') {
  const s = String(input).trim().replace(/^@/, '');
  const m = s.match(/github\.com\/([^/?#\s]+)/i);
  const name = m ? m[1] : s;
  if (!m && /[/.:]/.test(s)) return null;
  return /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(name) ? name : null;
}

/** Latest 8 public, non-fork repos (most recently pushed). */
export async function listRepos(username) {
  try {
    const { data } = await o().repos.listForUser({ username, type: 'owner', sort: 'pushed', per_page: 100 });
    return data.filter((r) => !r.fork && !r.private).slice(0, 8)
      .map((r) => ({ fullName: r.full_name, defaultBranch: r.default_branch, contributed: false }));
  } catch (e) {
    if (e.status === 404) throw new AppError(404, `GitHub user "${username}" was not found.`, 'USER_NOT_FOUND');
    if (isRateLimit(e)) throw new AppError(429, 'GitHub API rate limit reached. Add a GITHUB_TOKEN or try again later.', 'GITHUB_RATE_LIMIT');
    throw e;
  }
}

// ---------- push events (server-side timestamps that a commit author cannot forge) ----------
const pushCache = new Map();

/** From the user's public Events API (last ~90 days): head commit SHA -> time GitHub received the push,
 *  plus the repositories the user pushed to. Cached for 45 s. Never throws (returns empty on failure). */
export async function getPushInfo(username) {
  const key = username.toLowerCase();
  const hit = pushCache.get(key);
  if (hit && Date.now() - hit.at < 45_000) return hit.info;
  const pushTimes = new Map();
  const repos = new Set();
  try {
    for (let page = 1; page <= 3; page++) {
      const { data } = await o().activity.listPublicEventsForUser({ username, per_page: 100, page });
      for (const ev of data) {
        if (ev.type !== 'PushEvent') continue;
        repos.add(ev.repo.name);
        const shas = [ev.payload?.head, ...(ev.payload?.commits || []).map((c) => c.sha)].filter(Boolean);
        for (const sha of shas) if (!pushTimes.has(sha)) pushTimes.set(sha, ev.created_at);
      }
      if (data.length < 100) break;
    }
  } catch (e) {
    if (isRateLimit(e)) console.warn('[github] rate limited while reading push events');
  }
  const info = { pushTimes, repos };
  pushCache.set(key, { at: Date.now(), info });
  return info;
}

/** Up to 3 repositories the user pushed to but does not own (from push events). Marked contributed. */
export async function listContributedRepos(username, ownedFullNames = []) {
  const { repos } = await getPushInfo(username);
  const own = new Set(ownedFullNames.map((n) => n.toLowerCase()));
  const names = [...repos].filter((n) => !n.toLowerCase().startsWith(`${username.toLowerCase()}/`) && !own.has(n.toLowerCase())).slice(0, 3);
  const out = [];
  for (const n of names) {
    try {
      const { data } = await o().repos.get(split(n));
      if (!data.private) out.push({ fullName: data.full_name, defaultBranch: data.default_branch, contributed: true });
    } catch (e) { if (isRateLimit(e)) break; }
  }
  return out;
}

// ---------- authorship ----------
/** Latest commit BY THIS USER that touched `path`. Returns null when the user never committed that file
 *  (so the code was written by someone else). Throws on API errors so callers can tell the difference. */
export async function fileAuthorship(fullName, path, username, ref) {
  try {
    const { data } = await o().repos.listCommits({ ...split(fullName), sha: ref, path, author: username, per_page: 1 });
    const c = data[0];
    if (!c) return null;
    return {
      commitSha: c.sha,
      commitUrl: c.html_url,
      authorLogin: c.author?.login || username,
      committedAt: c.commit?.committer?.date || c.commit?.author?.date,
      verified: Boolean(c.commit?.verification?.verified),
    };
  } catch (e) {
    if (e.status === 409) return null; // empty repository
    throw e;
  }
}

/** Paths touched by the user's most recent commits in a repo they do not own. */
export async function authoredPaths(fullName, username, limit = 15) {
  const { data } = await o().repos.listCommits({ ...split(fullName), author: username, per_page: limit });
  const paths = new Set();
  for (let i = 0; i < data.length; i += 5) {
    const batch = await Promise.all(data.slice(i, i + 5).map((c) =>
      o().repos.getCommit({ ...split(fullName), ref: c.sha }).then((r) => r.data.files || []).catch(() => [])));
    batch.flat().forEach((f) => paths.add(f.filename));
  }
  return paths;
}

// ---------- polling ----------
const etags = new Map(); // conditional requests: 304 responses do not count against the rate limit
export async function latestSha(fullName, branch) {
  const k = `${fullName}#${branch}`;
  try {
    const r = await o().repos.listCommits({
      ...split(fullName), sha: branch, per_page: 1,
      headers: etags.has(k) ? { 'if-none-match': etags.get(k).etag } : {},
    });
    const sha = r.data[0]?.sha || null;
    etags.set(k, { etag: r.headers.etag, sha });
    return sha;
  } catch (e) {
    if (e.status === 304) return etags.get(k).sha;
    if (e.status === 409) return null; // empty repository
    throw e;
  }
}

export async function getTree(fullName, sha) {
  const { data } = await o().git.getTree({ ...split(fullName), tree_sha: sha, recursive: 'true' });
  return data.tree.filter((t) => t.type === 'blob').map((t) => ({ path: t.path, sha: t.sha, size: t.size ?? 0 }));
}

export async function getBlobText(fullName, blobSha, maxBytes) {
  const { data } = await o().git.getBlob({ ...split(fullName), file_sha: blobSha });
  if (data.size > maxBytes) return null;
  return Buffer.from(data.content, data.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
}

export async function getFileText(fullName, path, ref) {
  const { data } = await o().repos.getContent({ ...split(fullName), path, ref, mediaType: { format: 'raw' } });
  return typeof data === 'string' ? data : null;
}

// Files now keep the diff patch and line counts, so trivial changes can be detected.
const norm = (files = []) => files.map((f) => ({
  path: f.filename, previous: f.previous_filename, status: f.status, sha: f.sha,
  patch: f.patch, additions: f.additions, deletions: f.deletions,
}));
const meta = (commits = []) => commits.map((c) => ({ sha: c.sha, author: c.author?.login || null, date: c.commit?.committer?.date }));

/** Returns { files, commitCount, commits }. commitCount lets the timeline say "1 file, 100 commits". */
export async function compare(fullName, base, head) {
  const { data } = await o().repos.compareCommits({ ...split(fullName), base, head, per_page: 100 });
  return { files: norm(data.files), commitCount: data.total_commits ?? data.commits?.length ?? 1, commits: meta(data.commits) };
}
export async function commitFiles(fullName, sha) {
  const { data } = await o().repos.getCommit({ ...split(fullName), ref: sha });
  return { files: norm(data.files), commitCount: 1, commits: meta([data]) };
}