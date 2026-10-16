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
      .map((r) => ({ fullName: r.full_name, defaultBranch: r.default_branch }));
  } catch (e) {
    if (e.status === 404) throw new AppError(404, `GitHub user "${username}" was not found.`, 'USER_NOT_FOUND');
    if (isRateLimit(e)) throw new AppError(429, 'GitHub API rate limit reached. Add a GITHUB_TOKEN or try again later.', 'GITHUB_RATE_LIMIT');
    throw e;
  }
}

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

const norm = (files = []) => files.map((f) => ({ path: f.filename, previous: f.previous_filename, status: f.status, sha: f.sha }));

export async function compare(fullName, base, head) {
  const { data } = await o().repos.compareCommits({ ...split(fullName), base, head, per_page: 100 });
  return norm(data.files);
}
export async function commitFiles(fullName, sha) {
  const { data } = await o().repos.getCommit({ ...split(fullName), ref: sha });
  return norm(data.files);
}
