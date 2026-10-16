import { Router } from 'express';
import mongoose from 'mongoose';
import { analyzeProfile, getView } from '../services/analyzer.js';
import { AppError, isRateLimit, parseUsername, listPublicReposForHistory, getCommitBounds } from '../services/github.js';
import { addClient } from '../events.js';
import { geminiAvailable } from '../services/gemini.js';

const router = Router();

router.get('/health', (_req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1, gemini: geminiAvailable(), time: new Date().toISOString() }));

router.get('/events', (req, res) => addClient(req, res));

router.post('/analyze', async (req, res, next) => {
  try {
    const { jobUrl, jobText, githubLink } = req.body || {};
    let url;
    try { url = new URL(jobUrl); } catch { /* handled below */ }
    if (!url || !/^https?:$/.test(url.protocol)) throw new AppError(400, 'A valid job source link (http/https) is required.', 'BAD_JOB_URL');
    if (!jobText || String(jobText).trim().length < 40) throw new AppError(400, 'Paste the job description text (at least 40 characters).', 'BAD_JOB_TEXT');
    if (!githubLink) throw new AppError(400, 'A GitHub username or profile link is required.', 'BAD_USER');
    res.json(await analyzeProfile({ jobUrl: url.toString(), jobText: String(jobText), githubLink }));
  } catch (e) {
    if (isRateLimit(e)) return next(new AppError(429, 'GitHub API rate limit reached. Try again later.', 'GITHUB_RATE_LIMIT'));
    next(e);
  }
});


router.get('/commits/:username', async (req, res, next) => {
  try {
    const username = parseUsername(req.params.username);
    if (!username) throw new AppError(400, 'Enter a valid GitHub username.', 'BAD_USER');

    const repos = await listPublicReposForHistory(username);
    const results = [];

    // Keep concurrency modest to avoid bursting the unauthenticated GitHub API limit.
    for (let i = 0; i < repos.length; i += 4) {
      const batch = repos.slice(i, i + 4);
      const rows = await Promise.all(batch.map(async (repo) => {
        try {
          const bounds = await getCommitBounds(repo.fullName, repo.defaultBranch);
          return { ...repo, ...bounds, error: null };
        } catch (error) {
          if (isRateLimit(error)) throw error;
          return { ...repo, firstCommit: null, latestCommit: null, error: error.message || 'Could not load commits.' };
        }
      }));
      results.push(...rows);
    }

    res.json({ username, totalRepositories: results.length, repositories: results });
  } catch (e) {
    if (isRateLimit(e)) return next(new AppError(429, 'GitHub API rate limit reached. Add GITHUB_TOKEN to server/.env or try again later.', 'GITHUB_RATE_LIMIT'));
    next(e);
  }
});

router.get('/profile/:username', async (req, res, next) => {
  try {
    const view = await getView(req.params.username);
    if (!view) throw new AppError(404, 'No analysis found for this username yet.', 'NOT_FOUND');
    res.json(view);
  } catch (e) { next(e); }
});

export default router;
