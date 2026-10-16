const label = (s) => (s === 'demonstrated' ? 'demonstrated' : 'not demonstrated');

function entries(history) {
  const out = [];
  for (const h of history) {
    const files = h.changedFiles.slice(0, 3);
    const more = h.changedFiles.length - files.length;
    const t = new Date(h.time).toLocaleTimeString();
    const sha = h.commit.slice(0, 7);
    const n = h.commitCount || 1;
    const group = `${h.changedFiles.length} file${h.changedFiles.length === 1 ? '' : 's'}, ${n} commit${n === 1 ? '' : 's'}`;
    if (h.ignoredTrivial) { out.push({ id: `${h._id}-trivial`, t, text: `Trivial change ignored in ${h.repo} (${sha}): whitespace, comments or formatting only`, files, more, group }); continue; }
    if (!h.skillChanges.length) out.push({ id: `${h._id}-none`, t, text: `Commit ${sha} in ${h.repo}: no tracked skills affected`, files, more, group });
    for (const c of h.skillChanges) {
      out.push({
        id: `${h._id}-${c.skill}`, t, files, more, group,
        text: c.from === c.to ? `${c.skill}: re-checked, still ${label(c.to)}` : `${c.skill}: ${label(c.from)} → ${label(c.to)}`,
      });
    }
  }
  return out;
}

export default function Timeline({ history, watching, connected, lastPoll, active }) {
  const list = entries(history);
  return (
    <div className="panel">
      <h2>Live activity</h2>
      {active ? (
        <p className="muted small" role="status">
          {connected ? `Watching ${watching} repositories for new commits.` : 'Reconnecting to live updates…'}
          {lastPoll && connected && ` Last check ${new Date(lastPoll).toLocaleTimeString()}.`}
        </p>
      ) : (
        <p className="muted small">Live updates start after your first analysis.</p>
      )}
      {active && list.length === 0 && <p className="muted">No changes yet. Push a commit to a scanned repository and it will appear here within about 30 seconds.</p>}
      <ol className="timeline">
        {list.map((e) => (
          <li key={e.id}>
            <time>{e.t}</time>
            <span>{e.text}</span>
            {e.group && <span className="files">{e.group}</span>}
            {e.files.length > 0 && <span className="files">changed: <code>{e.files.join(', ')}</code>{e.more > 0 && ` +${e.more} more`}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}