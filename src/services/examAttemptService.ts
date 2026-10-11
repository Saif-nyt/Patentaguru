// Exam attempt persistence: server (MongoDB via /api/exam-attempts) + device
// (localStorage) so an exam survives reloads, crashes and navigation.
import type { QuizQuestion } from '../data/quizData';
import { studentAuthHeaders } from './authToken';

export type ExamType = 'mock' | 'round';

export interface ExamAttemptState {
  attemptId: string;
  type: ExamType;
  roundId: number | null;
  questions: QuizQuestion[];
  answers: Record<number, boolean>;
  currentIdx: number;
  startedAt: string;
  updatedAt: string;
  timeLeftSeconds: number;
  status: 'in_progress' | 'completed' | 'expired';
}

export interface ExamStatus {
  canStart: boolean;
  reason: string | null;
  requiresPayment: boolean;
  attemptsUsed: number;
  freeLimit: number;
  isVip: boolean;
  activeAttempt: ExamAttemptState | null;
}

const LOCAL_KEY = 'patente_exam_state_v1';
const LOCAL_TTL_MS = 6 * 60 * 60 * 1000;

async function api(path: string, init?: RequestInit): Promise<Response> {
  const headers = await studentAuthHeaders();
  return fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}), ...headers },
  });
}

export async function fetchExamStatus(type: ExamType, roundId?: number | null): Promise<ExamStatus> {
  const params = new URLSearchParams({ type });
  if (type === 'round' && roundId) params.set('roundId', String(roundId));
  const res = await api(`/api/exam-attempts?${params.toString()}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'status_failed');
  }
  return {
    canStart: Boolean(data.canStart),
    reason: data.reason || null,
    requiresPayment: Boolean(data.requiresPayment) || data.reason === 'payment_required',
    attemptsUsed: Number(data.attemptsUsed || 0),
    freeLimit: Number.isFinite(data.freeLimit) ? data.freeLimit : 1,
    isVip: Boolean(data.isVip),
    activeAttempt: data.activeAttempt || null,
  };
}

/**
 * Latest unfinished attempt of ANY type (mock or round) — used by the
 * dashboard to offer a "continue where you left off" button. Falls back to
 * the device copy when the server is unreachable.
 */
export async function fetchActiveExamAttempt(): Promise<ExamAttemptState | null> {
  try {
    const res = await api('/api/exam-attempts?scope=active');
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    const attempt = data.activeAttempt || null;
    if (attempt && Array.isArray(attempt.questions) && attempt.questions.length > 0) {
      return attempt as ExamAttemptState;
    }
    return null;
  } catch {
    return null;
  }
}

export type StartResult =
  | { ok: true; attempt: ExamAttemptState; resumed: boolean }
  | { ok: false; requiresPayment: boolean; error: string };

export async function startExamAttempt(payload: {
  type: ExamType;
  roundId?: number | null;
  questions: QuizQuestion[];
}): Promise<StartResult> {
  try {
    const res = await api('/api/exam-attempts', {
      method: 'POST',
      body: JSON.stringify({ action: 'start', ...payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 402 || data.requiresPayment) {
      return { ok: false, requiresPayment: true, error: 'payment_required' };
    }
    if (!res.ok || !data.attempt) {
      return { ok: false, requiresPayment: false, error: data.error || 'start_failed' };
    }
    return { ok: true, attempt: data.attempt, resumed: Boolean(data.resumed) };
  } catch {
    return { ok: false, requiresPayment: false, error: 'network' };
  }
}

export async function saveExamAttempt(
  attemptId: string,
  answers: Record<number, boolean>,
  currentIdx: number
): Promise<void> {
  try {
    await api('/api/exam-attempts', {
      method: 'POST',
      body: JSON.stringify({ action: 'save', attemptId, answers, currentIdx }),
    });
  } catch {
    // Best effort — the local copy still protects against reloads.
  }
}

export async function submitExamAttempt(
  attemptId: string,
  answers: Record<number, boolean>
): Promise<{ ok: boolean; result?: Record<string, unknown> }> {
  try {
    const res = await api('/api/exam-attempts', {
      method: 'POST',
      body: JSON.stringify({ action: 'submit', attemptId, answers }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && Boolean(data.success), result: data.result };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Device-local copy (localStorage)
// ---------------------------------------------------------------------------

export function loadLocalExamState(): ExamAttemptState | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.questions)) return null;
    const updatedAt = Date.parse(parsed.updatedAt || '');
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > LOCAL_TTL_MS) {
      localStorage.removeItem(LOCAL_KEY);
      return null;
    }
    if (parsed.status && parsed.status !== 'in_progress') return null;
    return parsed as ExamAttemptState;
  } catch {
    return null;
  }
}

export function saveLocalExamState(state: Partial<ExamAttemptState> & { attemptId: string }): void {
  try {
    const existing = loadLocalExamState();
    const merged: ExamAttemptState = {
      attemptId: state.attemptId,
      type: state.type ?? existing?.type ?? 'mock',
      roundId: state.roundId ?? existing?.roundId ?? null,
      questions: state.questions ?? existing?.questions ?? [],
      answers: state.answers ?? existing?.answers ?? {},
      currentIdx: state.currentIdx ?? existing?.currentIdx ?? 0,
      startedAt: state.startedAt ?? existing?.startedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      timeLeftSeconds: state.timeLeftSeconds ?? existing?.timeLeftSeconds ?? 20 * 60,
      status: 'in_progress',
    };
    localStorage.setItem(LOCAL_KEY, JSON.stringify(merged));
  } catch {
    // Storage full/unavailable — exam continues in memory.
  }
}

export function clearLocalExamState(): void {
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch {}
}
