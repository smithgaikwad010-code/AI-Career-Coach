export default function Summary({ assessments, job, repos, username }) {
  const req = assessments.filter((a) => a.importance === 'required');
  const pool = req.length ? req : assessments;
  const done = pool.filter((a) => a.status === 'demonstrated').length;
  return (
    <div className="panel summary">
      <h2>{done} of {pool.length} {req.length ? 'required ' : ''}skills demonstrated</h2>
      <p>
        Job: <a href={job.sourceUrl} target="_blank" rel="noopener noreferrer">{job.title}</a>
        <span className="muted"> ({job.company})</span>
      </p>
      <p className="muted small">
        Scope: {repos.length} public non-fork repositories of <a href={`https://github.com/${username}`} target="_blank" rel="noopener noreferrer">{username}</a>
        {job.extractedBy === 'rules' && ' · skills extracted with a keyword fallback'}
      </p>
    </div>
  );
}
