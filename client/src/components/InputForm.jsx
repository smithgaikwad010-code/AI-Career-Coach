import { useState } from 'react';
import { fetchJobs } from '../api.js';

function Field({ id, label, error, children, hint }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <span className="hint" id={`${id}-hint`}>{hint}</span>}
      {children}
      {error && <p className="field-error" id={`${id}-err`} role="alert">Error: {error}</p>}
    </div>
  );
}

function JobFinder({ onPick }) {
  const [provider, setProvider] = useState('greenhouse');
  const [company, setCompany] = useState('');
  const [q, setQ] = useState('');
  const [jobs, setJobs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function search() {
    setBusy(true); setErr(''); setJobs(null);
    try { setJobs((await fetchJobs(provider, company.trim(), q)).jobs); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <details className="finder">
      <summary>Fetch jobs from a company board (optional)</summary>
      <div className="finder-row">
        <label className="sr" htmlFor="provider">Job board</label>
        <select id="provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="greenhouse">Greenhouse</option>
          <option value="lever">Lever</option>
        </select>
        <label className="sr" htmlFor="company">Company slug</label>
        <input id="company" placeholder="company slug, e.g. stripe" value={company} onChange={(e) => setCompany(e.target.value)} />
        <label className="sr" htmlFor="q">Title filter</label>
        <input id="q" placeholder="title contains (optional)" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="btn secondary" onClick={search} disabled={busy || !company.trim()}>{busy ? 'Fetching…' : 'Fetch jobs'}</button>
      </div>
      {err && <p className="field-error" role="alert">Error: {err}</p>}
      {jobs && jobs.length === 0 && <p className="muted">No matching postings on this board.</p>}
      {jobs && jobs.length > 0 && (
        <ul className="job-list">
          {jobs.map((j) => (
            <li key={j.id}>
              <div><strong>{j.title}</strong><span className="muted"> {j.location}</span></div>
              <button type="button" className="btn secondary small" onClick={() => onPick(j)}>Use this job</button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

export default function InputForm({ values, errors, loading, onChange, onSubmit, onPickJob }) {
  const d = (k) => ({ 'aria-invalid': !!errors[k], 'aria-describedby': errors[k] ? `${k}-err` : undefined });
  return (
    <form className="panel" onSubmit={onSubmit} noValidate>
      <h2>Analyse a profile</h2>
      <JobFinder onPick={onPickJob} />
      <Field id="jobUrl" label="Job source link" error={errors.jobUrl}>
        <input id="jobUrl" type="url" placeholder="https://boards.greenhouse.io/…" value={values.jobUrl} onChange={(e) => onChange('jobUrl', e.target.value)} {...d('jobUrl')} />
      </Field>
      <Field id="jobText" label="Job description" error={errors.jobText}>
        <textarea id="jobText" rows="8" placeholder="Paste the full job description" value={values.jobText} onChange={(e) => onChange('jobText', e.target.value)} {...d('jobText')} />
      </Field>
      <Field id="githubLink" label="GitHub profile link or username" error={errors.githubLink}>
        <input id="githubLink" placeholder="https://github.com/username" value={values.githubLink} onChange={(e) => onChange('githubLink', e.target.value)} {...d('githubLink')} />
      </Field>
      <button className="btn" type="submit" disabled={loading}>{loading ? 'Analysing…' : 'Analyse'}</button>
    </form>
  );
}
