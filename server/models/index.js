import mongoose from 'mongoose';
const { Schema } = mongoose;

const Evidence = new Schema({
  repo: String, file: String, line: Number, url: String, reason: String,
  // who wrote it, and when (see analyzer.js stamp())
  commitSha: String, commitUrl: String, authorLogin: String, verified: Boolean,
  committedAt: Date,       // effective date used for recency
  claimedAt: Date,         // commit's own date, only stored when it differs from the push date
  dateSource: { type: String, enum: ['observed', 'push-event', 'commit-metadata'] },
  authorUnverified: Boolean, // authorship lookup failed (not a rejection)
}, { _id: false });
const ReqSkill = new Schema({
  skill: String,
  importance: { type: String, enum: ['required', 'preferred'] },
  jobSnippet: String,
}, { _id: false });

export const Job = mongoose.model('Job', new Schema({
  title: String,
  company: String,
  sourceUrl: { type: String, required: true },
  text: { type: String, required: true },
  requiredSkills: [ReqSkill],
  extractedBy: String, // 'gemini' | 'rules'
}, { timestamps: true }));

export const Profile = mongoose.model('Profile', new Schema({
  username: { type: String, required: true, unique: true, lowercase: true },
  jobId: { type: Schema.Types.ObjectId, ref: 'Job' },
  repos: [new Schema({ fullName: String, defaultBranch: String, contributed: Boolean, lastCheckedCommit: String }, { _id: false })],
}, { timestamps: true }));

const assessmentSchema = new Schema({
  profileId: { type: Schema.Types.ObjectId, ref: 'Profile', index: true },
  skill: String,
  importance: String,
  jobSnippet: String,
  status: { type: String, enum: ['demonstrated', 'not demonstrated in this scope'] },
  confidence: Number,
  evidence: [Evidence],
  explanation: String,
  source: String, // 'gemini' | 'rules'
  updatedAt: { type: Date, default: Date.now },
});
assessmentSchema.index({ profileId: 1, skill: 1 }, { unique: true });
export const Assessment = mongoose.model('Assessment', assessmentSchema);

export const AssessmentHistory = mongoose.model('AssessmentHistory', new Schema({
  profileId: { type: Schema.Types.ObjectId, ref: 'Profile', index: true },
  time: { type: Date, default: Date.now },
  repo: String,
  commit: String,
  changedFiles: [String],
  commitCount: Number,
  commitUrl: String,
  authors: [String],
  ignoredTrivial: Boolean,
  note: String,
  skillChanges: [new Schema({ skill: String, from: String, to: String }, { _id: false })],
}));