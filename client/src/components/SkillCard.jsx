import { useEffect, useState } from 'react';
import EvidenceList from './EvidenceList.jsx';

export default function SkillCard({ a, flash }) {
  const ok = a.status === 'demonstrated';
  const [open, setOpen] = useState(false);
  const pct = Math.round((a.confidence || 0) * 100);
  const count = a.evidence?.length || 0;
  const stale = ok && (a.recency === 'dated' || a.recency === 'old');
  const last = a.lastEvidenceAt ? new Date(a.lastEvidenceAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : null;

  // A reassessed card opens by itself so the new evidence is visible
  useEffect(() => { if (flash) setOpen(true); }, [flash]);

  return (
    <details className={`card ${ok ? 'ok' : 'gap'} ${flash ? 'flash' : ''}`} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span className="row1">
          <h3>{a.skill}</h3>
          <span className={`badge ${ok ? 'on' : 'off'}`}>{ok ? 'Demonstrated' : 'Not demonstrated in this scope'}</span>
        </span>
        <span className="row2">
          <span className="conf" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
          <span className="meta">
            {a.importance === 'preferred' ? 'Preferred' : 'Required'} · {pct}% confidence
            {ok && count > 0 && ` · ${count} evidence`}
            {stale && ` · last evidence ${last} (${a.recency === 'old' ? 'old' : 'not recent'})`}
            {flash && <strong className="updated"> · Reassessed just now</strong>}
          </span>
          <span className="chev" aria-hidden="true">{open ? 'Hide' : 'Details'}</span>
        </span>
      </summary>
      <div className="body">
        {a.source === 'rules' && <p className="meta">Rule-based signal (AI confirmation unavailable).</p>}
        {a.jobSnippet && <p className="snippet">Job text: “{a.jobSnippet}”</p>}
        {stale && <p className="muted small">Confidence is reduced because the newest evidence is from {last}. Old work may not reflect current skills.</p>}
        {ok && <EvidenceList evidence={a.evidence} />}
        <p className="explain">{a.explanation}</p>
        {!ok && <p className="muted small">This does not prove the student lacks the skill. It was not found in the scanned repositories.</p>}
      </div>
    </details>
  );
}