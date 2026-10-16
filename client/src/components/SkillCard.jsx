import EvidenceList from './EvidenceList.jsx';

export default function SkillCard({ a, flash }) {
  const ok = a.status === 'demonstrated';
  return (
    <article className={`card ${ok ? 'ok' : 'gap'} ${flash ? 'flash' : ''}`}>
      <header>
        <h3>{a.skill}</h3>
        <span className={`badge ${ok ? 'on' : 'off'}`}>{ok ? 'Demonstrated' : 'Not demonstrated in this scope'}</span>
      </header>
      <p className="meta">
        {a.importance === 'preferred' ? 'Preferred' : 'Required'} by the job · Confidence {Math.round((a.confidence || 0) * 100)}%
        {a.source === 'rules' && ' · rule-based signal (AI confirmation unavailable)'}
        {flash && <strong className="updated"> · Reassessed just now</strong>}
      </p>
      {a.jobSnippet && <p className="snippet">Job text: “{a.jobSnippet}”</p>}
      {ok && <EvidenceList evidence={a.evidence} />}
      <p className="explain">{a.explanation}</p>
      {!ok && <p className="muted small">This does not prove the student lacks the skill. It was not found in the scanned repositories.</p>}
    </article>
  );
}
