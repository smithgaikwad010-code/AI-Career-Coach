import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import webhook from './routes/webhook.js';
import api from './routes/api.js';
import jobs from './routes/jobs.js';
import { startPoller } from './services/poller.js';

const app = express();
app.use(cors());
// Webhook needs the RAW body for HMAC verification, so mount it before express.json().
app.use('/webhook/github', webhook);
app.use(express.json({ limit: '1mb' }));
app.use('/api', jobs);
app.use('/api', api);

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Server error', code: err.code });
});

const port = process.env.PORT || 5000;
for (const k of ['MONGO_URI', 'GITHUB_TOKEN']) if (!process.env[k]) console.warn(`[warn] ${k} is not set`);
if (!process.env.GEMINI_API_KEY || !process.env.GEMINI_MODEL) console.warn('[warn] Gemini not configured: rule-based fallback will be used');

try {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('MongoDB connected');
} catch (e) {
  console.error('MongoDB connection failed:', e.message);
  process.exit(1);
}
app.listen(port, () => console.log(`API listening on :${port}`));
startPoller();
