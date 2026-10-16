import { Router } from 'express';
import express from 'express';
import crypto from 'crypto';
import { Profile } from '../models/index.js';
import { applyChange } from '../services/analyzer.js';

const router = Router();
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

router.post('/', express.raw({ type: '*/*', limit: '5mb' }), (req, res) => {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'WEBHOOK_SECRET is not configured' });
  const sig = Buffer.from(req.get('x-hub-signature-256') || '');
  const expected = Buffer.from('sha256=' + crypto.createHmac('sha256', secret).update(req.body).digest('hex'));
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  res.status(200).json({ ok: true }); // respond fast, process afterwards
  if (req.get('x-github-event') !== 'push') return;

  setImmediate(async () => {
    try {
      const p = JSON.parse(req.body.toString('utf8'));
      const fullName = p.repository?.full_name;
      if (!fullName || !p.after || /^0+$/.test(p.after)) return;
      if (p.ref !== `refs/heads/${p.repository.default_branch}`) return; // we track the default branch
      const profiles = await Profile.find({ 'repos.fullName': { $regex: `^${escapeRegex(fullName)}$`, $options: 'i' } });
      for (const prof of profiles) await applyChange(prof._id, fullName, p.after);
    } catch (e) { console.error('[webhook] processing failed:', e.message); }
  });
});

export default router;
