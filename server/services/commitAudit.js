import { isTrivialChange } from './evidenceQuality.js';

const DAY = 864e5;
const monthsAgo = (d) => (Date.now() - new Date(d).getTime()) / (30.44 * DAY);

/** Recent evidence counts fully; 2+ year old evidence counts much less. */
export const freshness = (months) => (months <= 6 ? 1 : months <= 24 ? 0.8 : months <= 60 ? 0.4 : 0.25);

/** Repo-wide patterns: bursts, repeated messages, rewritten dates. */
export function auditRepoCommits(commits = []) {
  const flags = [];
  if (commits.length < 10) return flags;

  const perMinute = new Map(); const msgs = new Map(); let rewritten = 0;
  for (const c of commits) {
    const minute = (c.authorDate || '').slice(0, 16);
    perMinute.set(minute, (perMinute.get(minute) || 0) + 1);
    const m = c.message.toLowerCase().replace(/\d+/g, '#').trim();
    msgs.set(m, (msgs.get(m) || 0) + 1);
    if (Math.abs(new Date(c.committerDate) - new Date(c.authorDate)) > 7 * DAY) rewritten++;
  }
  const burst = Math.max(...perMinute.values());
  if (burst >= 10) flags.push({ code: 'burst', severity: 'review', text: `${burst} commits in the same minute (bulk upload or scripted history?)` });

  const [topMsg, topN] = [...msgs.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topN >= 8 && topN / commits.length > 0.4) flags.push({ code: 'repeated-message', severity: 'review', text: `"${topMsg}" is the message of ${topN} of ${commits.length} commits` });

  if (rewritten >= 3) flags.push({ code: 'date-gap', severity: 'info', text: `${rewritten} commits have author and committer dates more than a week apart (rebase/cherry-pick, or edited dates)` });
  return flags;
}

/** One evidence file: history = commits touching it, sample = [{sha, files}] diffs of the newest few. */
export function auditFile(path, history, sample, repoFlags = []) {
  const flags = [...repoFlags];
  const times = history.map((h) => new Date(h.authorDate).getTime()).sort((a, b) => a - b);
  const firstCommitAt = new Date(times[0]).toISOString();
  const lastCommitAt = new Date(times.at(-1)).toISOString();
  const ageMonths = monthsAgo(lastCommitAt);

  if (ageMonths > 24) flags.push({ code: 'stale', severity: 'stale', text: `Last change to this file was ${(ageMonths / 12).toFixed(1)} years ago` });

  // Many commits on one file: judge by diff quality, not by count.
  let meaningfulRatio = null;
  const checked = sample.map((s) => s.files.filter((f) => f.path === path)).filter((f) => f.length);
  if (checked.length) {
    meaningfulRatio = checked.filter((f) => !isTrivialChange(f)).length / checked.length;
    if (history.length >= 20 && meaningfulRatio < 0.3) {
      flags.push({ code: 'low-impact-churn', severity: 'review', text: `${history.length} commits on this file, but most sampled diffs are whitespace/comment/tiny edits` });
    }
  }
  if (history.length >= 30 && times.at(-1) - times[0] < DAY) {
    flags.push({ code: 'file-burst', severity: 'review', text: `${history.length} commits on this file within one day` });
  }

  const status = flags.some((f) => f.severity === 'review') ? 'review'
    : flags.some((f) => f.severity === 'stale') ? 'stale' : 'ok';
  return { status, flags, commitCount: history.length, firstCommitAt, lastCommitAt, meaningfulRatio, freshness: freshness(ageMonths) };
}