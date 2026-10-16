const month = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
const full = (d) => new Date(d).toLocaleString();

const SOURCE = {
  observed: 'seen by this app when pushed',
  'push-event': 'push date from GitHub events',
  'commit-metadata': 'date from commit metadata (can be edited by the author)',
};
const RECENCY = { recent: 'Recent', dated: 'Dated (1-3 years)', old: 'Old (3+ years)' };

export default function EvidenceList({ evidence }) {
  if (!evidence?.length) return null;
  return (
    <ul className="evidence" aria-label="Evidence">
      {evidence.map((e, i) => (
        <li key={`${e.repo}${e.file}${e.line}${i}`}>
          <a href={e.url} target="_blank" rel="noopener noreferrer"><code>{e.repo}/{e.file}:{e.line}</code></a>
          <span className="reason">{e.reason}</span>
          <span className="ev-meta">
            {e.commitSha ? (
              <>
                <a href={e.commitUrl} target="_blank" rel="noopener noreferrer"><code>{e.commitSha.slice(0, 7)}</code></a>
                {e.authorLogin && <span> by @{e.authorLogin}</span>}
                {e.committedAt && <time dateTime={e.committedAt} title={`${full(e.committedAt)} - ${SOURCE[e.dateSource] || ''}`}> · {month(e.committedAt)}</time>}
              </>
            ) : (
              <span>{e.authorUnverified ? 'Authorship could not be checked' : 'No commit details'}</span>
            )}
            {e.verified && <span className="tag solid" title="Signed commit, verified by GitHub">Verified</span>}
            {e.recency && e.recency !== 'recent' && <span className="tag outline">{RECENCY[e.recency]}</span>}
            {e.dateSource === 'commit-metadata' && <span className="tag outline" title={SOURCE['commit-metadata']}>Date unconfirmed</span>}
            {e.claimedAt && <span className="tag outline" title={`Commit says ${full(e.claimedAt)}`}>Commit date differs from push date</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}