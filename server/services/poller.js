import cron from 'node-cron';
import { Profile } from '../models/index.js';
import * as gh from './github.js';
import { applyChange } from './analyzer.js';
import { broadcast } from '../events.js';

let running = false;

async function tick() {
  if (running) return; // never overlap runs
  running = true;
  try {
    const profiles = await Profile.find();
    for (const p of profiles) {
      for (const r of p.repos) {
        try {
          const sha = await gh.latestSha(r.fullName, r.defaultBranch);
          if (sha && sha !== r.lastCheckedCommit) await applyChange(p._id, r.fullName, sha);
        } catch (e) {
          console.warn(`[poller] ${r.fullName}: ${e.message}`);
          if (gh.isRateLimit(e)) return;
        }
      }
    }
    broadcast('poll', { time: new Date().toISOString(), profiles: profiles.length });
  } catch (e) {
    console.error('[poller] tick failed:', e.message);
  } finally {
    running = false;
  }
}

export function startPoller() {
  cron.schedule('*/30 * * * * *', tick); // every 30 seconds
  console.log('Poller started (every 30s)');
}
