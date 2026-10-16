import { useState } from 'react';
import { fetchJobs } from '../api.js';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

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
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [pdfName, setPdfName] = useState('');

  const d = (k) => ({ 'aria-invalid': !!errors[k], 'aria-describedby': errors[k] ? `${k}-err` : undefined });

  async function handlePdfUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setPdfError('');
    setPdfName('');

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setPdfError('Please select a PDF file.');
      e.target.value = '';
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setPdfError('PDF must be 15 MB or smaller.');
      e.target.value = '';
      return;
    }

    setPdfLoading(true);
    try {
      const buffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
      const pages = [];

      for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
        const page = await pdf.getPage(pageNo);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
      }

      const text = pages.join('\n\n').trim();
      if (!text) {
        setPdfError('No selectable text found. This may be a scanned PDF; OCR would be needed.');
        return;
      }

      onChange('jobText', text);
      setPdfName(file.name);
    } catch (error) {
      console.error('Could not extract PDF text:', error);
      setPdfError('Could not read this PDF. Please try another file.');
    } finally {
      setPdfLoading(false);
      e.target.value = '';
    }
  }

  return (
    <form className="panel" onSubmit={onSubmit} noValidate>
      <h2>Analyse a profile</h2>
      <JobFinder onPick={onPickJob} />

      <Field id="jobUrl" label="Job source link" error={errors.jobUrl}>
        <input id="jobUrl" type="url" placeholder="https://boards.greenhouse.io/…" value={values.jobUrl} onChange={(e) => onChange('jobUrl', e.target.value)} {...d('jobUrl')} />
      </Field>

      <Field id="jobText" label="Job description" error={errors.jobText} hint="Paste the description or upload a PDF to fill this field automatically.">
        <div className="pdf-upload" style={{ marginBottom: '10px' }}>
          <label htmlFor="jobPdf" className="btn secondary" style={{ display: 'inline-block', cursor: pdfLoading ? 'wait' : 'pointer' }}>
            {pdfLoading ? 'Reading PDF…' : '📄 Upload JD PDF'}
          </label>
          <input
            id="jobPdf"
            type="file"
            accept=".pdf,application/pdf"
            disabled={pdfLoading}
            onChange={handlePdfUpload}
            style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 }}
          />
        </div>
        {pdfName && <p className="muted" role="status">✓ Loaded: {pdfName}</p>}
        {pdfError && <p className="field-error" role="alert">{pdfError}</p>}
        <textarea id="jobText" rows="8" placeholder="Paste the full job description or upload a PDF above" value={values.jobText} onChange={(e) => onChange('jobText', e.target.value)} {...d('jobText')} />
      </Field>

      <Field id="githubLink" label="GitHub profile link or username" error={errors.githubLink}>
        <input id="githubLink" placeholder="https://github.com/username" value={values.githubLink} onChange={(e) => onChange('githubLink', e.target.value)} {...d('githubLink')} />
      </Field>

      <button className="btn" type="submit" disabled={loading || pdfLoading}>{loading ? 'Analysing…' : 'Analyse'}</button>
    </form>
  );
}
