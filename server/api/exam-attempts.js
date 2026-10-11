// Exam attempt persistence + free-exam quota enforcement.
//
// Every exam (mock test or round exam) is stored server-side so students can
// resume after a reload or navigation, and mock exams are limited to
// FREE_MOCK_EXAMS attempts unless the student is VIP.
import { getCollection } from './_db.js';
import { verifyStudentToken } from './_auth.js';
import { setCors, parseBody, rateLimit, clientIp, rateLimited, serverError } from './_http.js';

const EXAM_DURATION_SEC = 20 * 60;
const ATTEMPT_TTL_MS = 6 * 60 * 60 * 1000; // resume window for an unfinished exam
const MAX_QUESTIONS_JSON_BYTES = 400_000;

function defaultFreeMockExams() {
  const fromEnv = Number(process.env.FREE_MOCK_EXAMS);
  if (Number.isFinite(fromEnv) && fromEnv >= 0) return Math.min(10, Math.round(fromEnv));
  return 1;
}

async function readSettings() {
  try {
    const col = await getCollection('settings');
    const doc = await col.findOne({ key: 'app_settings' });
    return doc || {};
  } catch {
    return {};
  }
}

async function getStudentDoc(email) {
  try {
    const col = await getCollection('students');
    return await col.findOne({ email });
  } catch {
    return null;
  }
}

function sanitizeAnswers(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw)) {
    const idx = Number(key);
    if (Number.isInteger(idx) && idx >= 0 && idx < 60 && typeof value === 'boolean') {
      out[idx] = value;
    }
  }
  return out;
}

function gradeAttempt(questions, answers) {
  const mistakeIds = [];
  let correctCount = 0;
  questions.forEach((q, idx) => {
    const userAns = answers[idx];
    if (userAns === q.isCorrect) {
      correctCount += 1;
    } else {
      mistakeIds.push(q.id);
    }
  });
  const errorCount = mistakeIds.length;
  const total = questions.length;
  return {
    mistakeIds,
    errorCount,
    correctCount,
    total,
    passed: errorCount <= 3,
    scorePercentage: total ? Math.round((correctCount / total) * 100) : 0,
  };
}

function timeLeftSeconds(attempt) {
  const startedAt = new Date(attempt.startedAt).getTime();
  if (!Number.isFinite(startedAt)) return EXAM_DURATION_SEC;
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  return Math.max(0, EXAM_DURATION_SEC - elapsed);
}

function publicAttempt(attempt) {
  if (!attempt) return null;
  return {
    attemptId: attempt.attemptId,
    type: attempt.type,
    roundId: attempt.roundId ?? null,
    questions: attempt.questions || [],
    answers: sanitizeAnswers(attempt.answers),
    currentIdx: Number.isFinite(attempt.currentIdx) ? attempt.currentIdx : 0,
    startedAt: attempt.startedAt,
    updatedAt: attempt.updatedAt,
    status: attempt.status,
    timeLeftSeconds: attempt.status === 'in_progress' ? timeLeftSeconds(attempt) : 0,
  };
}

async function expireStaleAttempts(attemptsCol, email) {
  const cutoff = new Date(Date.now() - ATTEMPT_TTL_MS).toISOString();
  await attemptsCol.updateMany(
    { email, status: 'in_progress', startedAt: { $lt: cutoff } },
    { $set: { status: 'expired', updatedAt: new Date().toISOString() } }
  );
}

async function loadStatus(attemptsCol, email, type, roundId) {
  await expireStaleAttempts(attemptsCol, email);

  // Only an attempt of the SAME exam (same type, and same round for round
  // exams) may be resumed — otherwise a leftover mock would hijack a round
  // exam (and vice versa), which looked like the dashboard "losing" progress.
  const activeQuery = { email, status: 'in_progress' };
  if (type) {
    activeQuery.type = type;
    if (type === 'round') {
      const round = Number(roundId);
      if (Number.isInteger(round)) activeQuery.roundId = round;
    }
  }
  const activeAttempt = await attemptsCol
    .find(activeQuery)
    .sort({ startedAt: -1 })
    .limit(1)
    .toArray();

  const settings = await readSettings();
  const studentDoc = await getStudentDoc(email);
  const isVip = Boolean(studentDoc?.isVip);
  const freeLimit = Number.isFinite(settings.freeMockExams)
    ? Math.round(settings.freeMockExams)
    : defaultFreeMockExams();

  const attemptsUsed = await attemptsCol.countDocuments({
    email,
    type: 'mock',
    status: { $in: ['completed', 'expired'] },
  });

  const active = activeAttempt[0] || null;
  let canStart;
  let reason = null;

  if (active) {
    canStart = true;
  } else if (type === 'mock') {
    if (isVip || attemptsUsed < freeLimit) {
      canStart = true;
    } else {
      canStart = false;
      reason = 'payment_required';
    }
  } else {
    // Round exams: enforce the admin-configured free-rounds limit (VIP skips it).
    const freeRoundsLimit = Number.isFinite(settings.freeRoundsLimit) ? settings.freeRoundsLimit : 20;
    const round = Number(roundId);
    if (!Number.isInteger(round) || round < 1 || round > 240) {
      canStart = false;
      reason = 'invalid_round';
    } else if (round > freeRoundsLimit && !isVip) {
      canStart = false;
      reason = 'payment_required';
    } else {
      canStart = true;
    }
  }

  return {
    success: true,
    email,
    isVip,
    freeLimit,
    attemptsUsed,
    canStart,
    reason,
    activeAttempt: publicAttempt(active),
  };
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const student = await verifyStudentToken(req);
    if (!student || !student.email) {
      return res.status(401).json({ error: 'Login required' });
    }
    const email = student.email;

    const limit = rateLimit(`exam-attempts:${clientIp(req)}`, 60, 60_000);
    if (!limit.ok) return rateLimited(res, limit.retryAfterSec);

    const attemptsCol = await getCollection('exam_attempts');

    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');

      // Lightweight discovery for the dashboard: latest unfinished attempt of
      // ANY type (mock or round), no quota logic involved.
      if (url.searchParams.get('scope') === 'active') {
        await expireStaleAttempts(attemptsCol, email);
        const active = await attemptsCol
          .find({ email, status: 'in_progress' })
          .sort({ startedAt: -1 })
          .limit(1)
          .toArray();
        return res.status(200).json({ success: true, activeAttempt: publicAttempt(active[0] || null) });
      }

      const type = url.searchParams.get('type') === 'round' ? 'round' : 'mock';
      const roundId = url.searchParams.get('roundId');
      const status = await loadStatus(attemptsCol, email, type, roundId);
      return res.status(200).json(status);
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = await parseBody(req);
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const action = String(body.action || '');

    // ---------------------------------------------------------------- START
    if (action === 'start') {
      const type = body.type === 'round' ? 'round' : 'mock';
      const roundId = Number.isInteger(body.roundId) ? body.roundId : null;

      const status = await loadStatus(attemptsCol, email, type, roundId);
      if (status.activeAttempt) {
        // Resume the unfinished exam instead of burning quota.
        return res.status(200).json({ success: true, resumed: true, attempt: status.activeAttempt });
      }
      if (!status.canStart) {
        return res.status(status.reason === 'payment_required' ? 402 : 403).json({
          success: false,
          reason: status.reason,
          requiresPayment: status.reason === 'payment_required',
          attemptsUsed: status.attemptsUsed,
          freeLimit: status.freeLimit,
        });
      }

      const questions = Array.isArray(body.questions) ? body.questions : [];
      if (questions.length < 1 || questions.length > 60) {
        return res.status(400).json({ error: 'Invalid question set' });
      }
      if (Buffer.byteLength(JSON.stringify(questions), 'utf8') > MAX_QUESTIONS_JSON_BYTES) {
        return res.status(400).json({ error: 'Question set too large' });
      }

      const now = new Date().toISOString();
      const attempt = {
        attemptId: `att_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        email,
        uid: student.uid,
        type,
        roundId,
        questions,
        answers: {},
        currentIdx: 0,
        status: 'in_progress',
        startedAt: now,
        updatedAt: now,
      };
      await attemptsCol.insertOne(attempt);
      return res.status(200).json({ success: true, resumed: false, attempt: publicAttempt(attempt) });
    }

    // ----------------------------------------------------------------- SAVE
    if (action === 'save') {
      const attemptId = String(body.attemptId || '');
      const attempt = await attemptsCol.findOne({ attemptId, email });
      if (!attempt) return res.status(404).json({ error: 'Attempt not found' });
      if (attempt.status !== 'in_progress') {
        return res.status(409).json({ error: 'Attempt already finished' });
      }

      const answers = sanitizeAnswers(body.answers);
      const currentIdx = Number.isFinite(body.currentIdx) ? Math.max(0, Math.round(body.currentIdx)) : attempt.currentIdx;

      await attemptsCol.updateOne(
        { attemptId, email },
        { $set: { answers, currentIdx, updatedAt: new Date().toISOString() } }
      );

      return res.status(200).json({
        success: true,
        timeLeftSeconds: timeLeftSeconds({ ...attempt, startedAt: attempt.startedAt }),
      });
    }

    // -------------------------------------------------------------- SUBMIT
    if (action === 'submit') {
      const attemptId = String(body.attemptId || '');
      const attempt = await attemptsCol.findOne({ attemptId, email });
      if (!attempt) return res.status(404).json({ error: 'Attempt not found' });

      if (attempt.status === 'completed') {
        return res.status(200).json({
          success: true,
          alreadyCompleted: true,
          result: attempt.result,
        });
      }

      const answers = sanitizeAnswers(body.answers ?? attempt.answers);
      const result = gradeAttempt(attempt.questions || [], answers);
      const now = new Date().toISOString();
      const timedOut = timeLeftSeconds(attempt) <= 0;

      await attemptsCol.updateOne(
        { attemptId, email },
        {
          $set: {
            answers,
            status: 'completed',
            completedAt: now,
            updatedAt: now,
            timedOut,
            result,
          },
        }
      );

      return res.status(200).json({ success: true, result, timedOut });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return serverError(res, 'exam-attempts', err);
  }
}
