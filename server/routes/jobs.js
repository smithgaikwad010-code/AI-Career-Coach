import { Router } from 'express';
import { AppError } from '../services/github.js';

const router = Router();
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const htmlToText = (h = '') => decode(decode(h).replace(/<\/(p|li|div|h\d|ul|ol)>|<br\s*\/?>/gi, '\n').replace(/<li>/gi, '- ').replace(/<[^>]+>/g, '')).replace(/\n{3,}/g, '\n\n').trim();

async function getJSON(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (r.status === 404) throw new AppError(404, 'Company board not found. Check the company slug.', 'BOARD_NOT_FOUND');
  if (!r.ok) throw new AppError(502, `Job source returned ${r.status}`, 'JOB_SOURCE');
  return r.json();
}

// Optional helper: real postings from public Greenhouse / Lever APIs (no key). Always returns each job's source URL.
router.get('/jobs', async (req, res, next) => {
  try {
    const { provider, company = '', q = '' } = req.query;
    if (!/^[a-z0-9_-]+$/i.test(company)) throw new AppError(400, 'Enter a valid company slug, e.g. "stripe".');
    let jobs;
    if (provider === 'greenhouse') {
      const d = await getJSON(`https://boards-api.greenhouse.io/v1/boards/${company}/jobs?content=true`);
      jobs = (d.jobs || []).map((j) => ({ id: String(j.id), title: j.title, location: j.location?.name || '', url: j.absolute_url, text: htmlToText(j.content) }));
    } else if (provider === 'lever') {
      const d = await getJSON(`https://api.lever.co/v0/postings/${company}?mode=json`);
      jobs = d.map((j) => ({
        id: j.id, title: j.text, location: j.categories?.location || '', url: j.hostedUrl,
        text: [j.descriptionPlain, ...(j.lists || []).map((l) => `${l.text}\n${htmlToText(l.content)}`), j.additionalPlain].filter(Boolean).join('\n\n'),
      }));
    } else throw new AppError(400, 'provider must be "greenhouse" or "lever".');
    const needle = String(q).toLowerCase();
    res.json({ jobs: jobs.filter((j) => !needle || j.title.toLowerCase().includes(needle)).slice(0, 40) });
  } catch (e) { next(e); }
});

export default router;
