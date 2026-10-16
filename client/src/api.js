async function req(path, opts) {
  let res;
  try { res = await fetch(path, opts); }
  catch { throw new Error('Cannot reach the server. Is the backend running on port 5000?'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export const analyze = (data) => req('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
export const getProfile = (u) => req(`/api/profile/${encodeURIComponent(u)}`);
export const fetchJobs = (provider, company, q) => req(`/api/jobs?provider=${provider}&company=${encodeURIComponent(company)}&q=${encodeURIComponent(q || '')}`);

export function parseGithubUser(v = '') {
  const s = v.trim().replace(/^@/, '');
  const m = s.match(/github\.com\/([^/?#\s]+)/i);
  if (!m && /[/.:]/.test(s)) return null;
  const name = m ? m[1] : s;
  return /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(name) ? name : null;
}
