# AI Career Coach

Compares a student's **demonstrated GitHub skills** with **real job requirements**, shows evidence-backed gaps, and **automatically reassesses** affected skills when the repositories change.

`job requirements -> repository evidence -> gaps -> new commit -> updated assessment`

Stack: React (Vite) + plain CSS, Node/Express, MongoDB (Mongoose), Gemini (`@google/genai`), Octokit, node-cron, Server-Sent Events. All free tier.

## Setup

Requirements: Node 18+, a free MongoDB Atlas cluster, a Gemini API key, a GitHub personal access token (no scopes needed for public repos).

```bash
# 1. Backend
cd server
cp .env.example .env        # fill in the values below
npm install
npm run dev                 # http://localhost:5000

# 2. Frontend (new terminal)
cd client
npm install
npm run dev                 # http://localhost:5173 (proxies /api to :5000)
```

## Environment variables (`server/.env`, never committed)

| Name | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio key |
| `GEMINI_MODEL` | Model name, e.g. `gemini-2.5-flash` |
| `GITHUB_TOKEN` | Raises GitHub rate limit to 5000 req/h |
| `MONGO_URI` | Atlas connection string |
| `WEBHOOK_SECRET` | HMAC secret for `/webhook/github` |
| `PORT` | Defaults to 5000 |

## How it works

1. **Job skills**: Gemini returns strict JSON `[{skill, importance, jobSnippet}]` (keyword fallback if Gemini fails).
2. **Scan**: latest 8 public non-fork repos; file tree plus up to 30 small files per repo (<= 60 KB each).
3. **Cheap signals first**: file extensions/names (`.sql`, `Dockerfile`, `*.test.js`, `.jsx`), `package.json`/`requirements.txt` dependencies, code patterns (`SELECT ... FROM`, `app.get(...)`).
4. **Gemini confirms** only candidate files (max 3 files / ~90 KB per skill), with exponential backoff on 429. If Gemini fails, rule-based signals are used and the card says so.
5. **Gaps** are shown as "not demonstrated in this scope", never as absence of skill.
6. **Change detection**: `node-cron` runs every 30 s, reads the latest commit per repo (ETag conditional requests, so unchanged repos cost no rate limit), and on change fetches the diff. Only changed files are re-scanned and only affected skills re-evaluated. A history record `{time, repo, commit, changedFiles, skillChanges}` is stored and pushed over SSE (`/api/events`).
7. **Webhook** (optional, faster): `POST /webhook/github` verifies `X-Hub-Signature-256`, replies 200 immediately, then runs the same pipeline for pushes to the default branch.

### Optional webhook setup
Expose the server (e.g. `ngrok http 5000`), then in the GitHub repo: Settings -> Webhooks -> Payload URL `https://<host>/webhook/github`, content type `application/json`, secret = `WEBHOOK_SECRET`, event: Push.

## API
`POST /api/analyze {jobUrl, jobText, githubLink}` | `GET /api/profile/:username` | `GET /api/events` (SSE) | `GET /api/jobs?provider=greenhouse|lever&company=slug` | `POST /webhook/github` | `GET /api/health`

## Demo script
1. Open the app. Use "Fetch jobs" (e.g. Greenhouse, company `stripe`) or paste a real posting that requires SQL, with its **source link**.
2. Analyse a demo GitHub account whose repos contain no SQL. The **SQL** card is under Gaps as "not demonstrated in this scope".
3. In one of those repos, commit and push `db/queries.sql` (e.g. `SELECT id, name FROM users;`).
4. Within ~30 seconds the dashboard updates **without a refresh**: SQL moves to "Demonstrated", cites `db/queries.sql`, the card briefly highlights, and Live activity shows `SQL: not demonstrated -> demonstrated, changed: db/queries.sql`.

## Limits
Only the default branch is tracked; the compare API returns up to 100 changed files per poll; new repositories created after analysis are picked up on re-analysis. Gemini free tier is rate limited, so the first analysis can take a minute.
