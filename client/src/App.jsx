import { useCallback, useEffect, useRef, useState } from 'react';
import InputForm from './components/InputForm.jsx';
import Summary from './components/Summary.jsx';
import SkillCard from './components/SkillCard.jsx';
import Timeline from './components/Timeline.jsx';
import { analyze, getProfile, parseGithubUser, getCommitHistory } from './api.js';

const EMPTY = { jobUrl: '', jobText: '', githubLink: '' };
const store = {
  get: () => { try { return localStorage.getItem('acc:user'); } catch { return null; } },
  set: (v) => { try { localStorage.setItem('acc:user', v); } catch { /* ignore */ } },
};

function validate(v) {
  const e = {};
  try { if (!/^https?:$/.test(new URL(v.jobUrl.trim()).protocol)) throw 0; } catch { e.jobUrl = 'Enter the full job link, starting with https://'; }
  if (v.jobText.trim().length < 40) e.jobText = 'Paste the job description (at least 40 characters).';
  if (!v.githubLink.trim()) e.githubLink = 'Enter a GitHub username or profile link.';
  else if (!parseGithubUser(v.githubLink)) e.githubLink = 'That does not look like a GitHub username or profile link.';
  return e;
}

export default function App() {
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState('');
  const [view, setView] = useState(null);
  const [history, setHistory] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [flashed, setFlashed] = useState(new Set());
  const [connected, setConnected] = useState(false);
  const [lastPoll, setLastPoll] = useState(null);
  const [tab, setTab] = useState('all');
  const [commitData, setCommitData] = useState(null);
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitError, setCommitError] = useState('');
  const [commitUsername, setCommitUsername] = useState('');
  const flashTimer = useRef();
  const username = view?.profile.username;

  const load = useCallback((res) => { setView(res); setHistory(res.history || []); }, []);

  // Restore the last analysed user
  useEffect(() => {
    const u = store.get();
    if (u) getProfile(u).then(load).catch(() => {});
  }, [load]);

  // Live updates (SSE): no refresh button
  useEffect(() => {
    if (!username) return undefined;
    const es = new EventSource('/api/events');
    es.onopen = () => { setConnected(true); getProfile(username).then(load).catch(() => {}); }; // resync after (re)connect
    es.onerror = () => setConnected(false);
    es.addEventListener('poll', (e) => setLastPoll(JSON.parse(e.data).time));
    es.addEventListener('reassessment', (e) => {
      const d = JSON.parse(e.data);
      if (d.username !== username) return;
      setView((v) => v && ({ ...v, assessments: v.assessments.map((a) => d.assessments.find((u) => u.skill === a.skill) || a) }));
      setHistory((h) => [d.history, ...h.filter((x) => x._id !== d.history._id)]);
      setFlashed(new Set(d.assessments.map((a) => a.skill)));
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashed(new Set()), 3500);
    });
    return () => { es.close(); clearTimeout(flashTimer.current); };
  }, [username, load]);

  async function submit(e) {
    e.preventDefault();
    const errs = validate(values);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setLoading(true); setApiError(''); setWarnings([]);
    try {
      const res = await analyze({ jobUrl: values.jobUrl.trim(), jobText: values.jobText, githubLink: values.githubLink.trim() });
      load(res); setWarnings(res.warnings || []); store.set(res.profile.username);
    } catch (err) { setApiError(err.message); }
    finally { setLoading(false); }
  }

  const onChange = (k, val) => { setValues((v) => ({ ...v, [k]: val })); setErrors((er) => ({ ...er, [k]: undefined })); };
  const pickJob = (j) => setValues((v) => ({ ...v, jobUrl: j.url, jobText: j.text }));
  async function loadCommits() {
    const parsed = parseGithubUser(values.githubLink || username || '');
    if (!parsed) {
      setCommitError('Enter a valid GitHub username or profile link first.');
      return;
    }
    setCommitLoading(true);
    setCommitError('');
    setCommitData(null);
    setCommitUsername(parsed);
    try {
      setCommitData(await getCommitHistory(parsed));
    } catch (err) {
      setCommitError(err.message || 'Could not load GitHub commit history.');
    } finally {
      setCommitLoading(false);
    }
  }

  const demonstrated = view?.assessments.filter((a) => a.status === 'demonstrated') || [];
  const gaps = view?.assessments.filter((a) => a.status !== 'demonstrated') || [];

  return (
    <>
      <header className="masthead">
        <div className="masthead-in">
          <div className="logo"><div className="mark" aria-hidden="true">CC</div><h1>AI Career Coach</h1></div>
          <p>Show what your portfolio proves, and what it does not. Every claim links to a file or the job posting.</p>
        </div>
      </header>
      <main className="layout">
        <section className="col" aria-label="Input and live activity">
          <InputForm values={values} errors={errors} loading={loading} onChange={onChange} onSubmit={submit} onPickJob={pickJob} />
          <section className="panel commit-panel" aria-label="GitHub commit history">
            <h2>GitHub repository commits</h2>
            <p className="muted">Load the actual first and latest commit for every public, non-fork repository owned by this GitHub user.</p>
            <button type="button" className="btn secondary" onClick={loadCommits} disabled={commitLoading}>
              {commitLoading ? 'Loading repositories…' : `Load commit history${commitUsername ? ` for ${commitUsername}` : ''}`}
            </button>
            {commitError && <p className="field-error" role="alert">{commitError}</p>}
            {commitData && (
              <>
                <p className="muted">
                  Found {commitData.totalRepositories} public, non-fork repositories for @{commitData.username}.
                </p>
                {commitData.repositories.length === 0 && <p>No public repositories found.</p>}
                <div className="repo-commit-list">
                  {commitData.repositories.map((repo) => (
                    <article className="repo-commit-card" key={repo.fullName}>
                      <h3><a href={repo.url} target="_blank" rel="noreferrer">{repo.fullName}</a></h3>
                      {repo.error && <p className="field-error">{repo.error}</p>}
                      {!repo.error && !repo.firstCommit && !repo.latestCommit && <p className="muted">No commits yet (empty repository).</p>}
                      {repo.firstCommit && (
                        <p>
                          <strong>First commit:</strong>{' '}
                          {repo.firstCommit.date ? new Date(repo.firstCommit.date).toLocaleString() : 'Date unavailable'}
                          {' — '}
                          <a href={repo.firstCommit.url} target="_blank" rel="noreferrer">{repo.firstCommit.sha.slice(0, 7)}</a>
                          {' — '}{repo.firstCommit.message}
                        </p>
                      )}
                      {repo.latestCommit && (
                        <p>
                          <strong>Latest commit:</strong>{' '}
                          {repo.latestCommit.date ? new Date(repo.latestCommit.date).toLocaleString() : 'Date unavailable'}
                          {' — '}
                          <a href={repo.latestCommit.url} target="_blank" rel="noreferrer">{repo.latestCommit.sha.slice(0, 7)}</a>
                          {' — '}{repo.latestCommit.message}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>
          {apiError && <div className="alert" role="alert"><strong>Analysis failed.</strong> {apiError}</div>}
          {warnings.map((w) => <div className="alert" role="status" key={w}>{w}</div>)}
          <Timeline history={history} watching={view?.profile.repos.length || 0} connected={connected} lastPoll={lastPoll} active={!!view} />
        </section>

        <section className="col" aria-label="Assessment" aria-live="polite">
          {loading && (
            <div className="panel" role="status">
              <div className="bar" aria-hidden="true" />
              <p>Scanning repositories and confirming evidence. This can take a minute on the free Gemini tier.</p>
            </div>
          )}
          {!view && !loading && (
            <div className="panel empty">
              <h2>No assessment yet</h2>
              <p>Paste a job link and description, add a GitHub profile, then choose Analyse. Results appear here and update on their own when the repositories change.</p>
            </div>
          )}
          {view && (
            <>
              <Summary assessments={view.assessments} job={view.job} repos={view.profile.repos} username={view.profile.username} />
              <div className="tabs" role="group" aria-label="Filter skills">
                {[['all', `All (${view.assessments.length})`], ['ok', `Demonstrated (${demonstrated.length})`], ['gap', `Gaps (${gaps.length})`]].map(([k, t]) => (
                  <button key={k} type="button" className={`tab ${tab === k ? 'active' : ''}`} aria-pressed={tab === k} onClick={() => setTab(k)}>{t}</button>
                ))}
              </div>
              {tab !== 'gap' && (
                <>
                  <h2 className="section">Demonstrated skills <span className="count ok">{demonstrated.length}</span></h2>
                  {demonstrated.length === 0 && <p className="muted">No required skills are demonstrated in the scanned repositories yet.</p>}
                  <div className="grid">{demonstrated.map((a) => <SkillCard key={a.skill} a={a} flash={flashed.has(a.skill)} />)}</div>
                </>
              )}
              {tab !== 'ok' && (
                <>
                  <h2 className="section">Gaps <span className="count gap">{gaps.length}</span></h2>
                  {gaps.length === 0 && <p className="muted">No gaps: every extracted skill has evidence in the scanned scope.</p>}
                  <div className="grid">{gaps.map((a) => <SkillCard key={a.skill} a={a} flash={flashed.has(a.skill)} />)}</div>
                </>
              )}
              <div className="note">
                <span aria-hidden="true">ⓘ</span>
                <span>
                  <strong>About uncertainty.</strong> This assessment only covers the latest 8 public, non-fork repositories and the files scanned. The commit-history panel separately checks all public, non-fork repositories.
                  “Not demonstrated in this scope” does not prove the student lacks the skill: it may live in private work, older repositories, or experience outside code.
                </span>
              </div>
            </>
          )}
        </section>
      </main>
    </>
  );
}