import { GoogleGenAI } from '@google/genai';

let ai;
export const geminiAvailable = () => Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL);
const client = () => (ai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseJSON(text = '') {
  const clean = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(clean);
}

/** Calls Gemini expecting strict JSON. Retries with exponential backoff on 429/503. */
async function generateJSON(prompt, attempts = 5) {
  if (!geminiAvailable()) throw new Error('Gemini is not configured');
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await client().models.generateContent({
        model: process.env.GEMINI_MODEL,
        contents: prompt,
        config: { responseMimeType: 'application/json', temperature: 0 },
      });
      return parseJSON(res.text);
    } catch (e) {
      const retriable = e?.status === 429 || e?.status === 503 || /429|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded/i.test(String(e?.message));
      if (!retriable || i === attempts - 1) throw e;
      await sleep(1500 * 2 ** i + Math.random() * 500);
    }
  }
}

export async function extractSkills(jobText) {
  const prompt = `Extract the technical skills a candidate needs from this job posting.
Return ONLY a JSON array, no prose: [{"skill": string, "importance": "required" | "preferred", "jobSnippet": string}]
Rules: max 12 items; short skill names (e.g. "SQL", "React", "Docker"); "required" unless the text says preferred / nice to have / bonus; jobSnippet is a short verbatim excerpt (max 200 chars) from the posting.

JOB POSTING:
${jobText.slice(0, 15000)}`;
  const arr = await generateJSON(prompt);
  if (!Array.isArray(arr)) throw new Error('Gemini returned non-array skills');
  const seen = new Set();
  return arr
    .filter((s) => s && typeof s.skill === 'string' && s.skill.trim())
    .map((s) => ({
      skill: s.skill.trim().slice(0, 60),
      importance: s.importance === 'preferred' ? 'preferred' : 'required',
      jobSnippet: String(s.jobSnippet || '').slice(0, 240),
    }))
    .filter((s) => !seen.has(s.skill.toLowerCase()) && seen.add(s.skill.toLowerCase()))
    .slice(0, 12);
}

/** Confirms (or rejects) pre-detected candidate evidence using a few small files. */
export async function confirmSkill({ skill, jobSnippet, candidates, files }) {
  const cands = candidates.map((c, i) => `[${i}] ${c.repo}/${c.file}:${c.line} - ${c.reason}`).join('\n');
  const body = files.map((f) => `=== ${f.path} ===\n${f.text.split('\n').map((l, i) => `${i + 1}| ${l}`).join('\n')}`).join('\n\n');
  const prompt = `You verify whether a student's GitHub code demonstrates ONE skill required by a job.
Skill: ${skill}
Job text: ${jobSnippet || '(n/a)'}
Be strict: trivial mentions, empty files, or boilerplate do not demonstrate a skill. Judge only from the material below.

CANDIDATE EVIDENCE (index, location, signal):
${cands}

FILE CONTENTS:
${body || '(only file names / dependency signals available)'}

Return ONLY JSON: {"demonstrated": boolean, "confidence": number 0-1, "explanation": "1-3 sentences citing file paths", "supporting": [{"index": number, "reason": "short reason"}]}`;
  const r = await generateJSON(prompt);
  return {
    demonstrated: Boolean(r.demonstrated),
    confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0.5)),
    explanation: String(r.explanation || '').slice(0, 600),
    supporting: Array.isArray(r.supporting) ? r.supporting.filter((s) => Number.isInteger(s?.index) && s.index >= 0 && s.index < candidates.length) : [],
  };
}
