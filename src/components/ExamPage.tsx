import React, { useEffect, useState, useCallback } from 'react';
import { Clock, GraduationCap, Lock, LogIn, RefreshCw, ShieldCheck } from 'lucide-react';
import { ExamSimulator } from './ExamSimulator';
import type { StudentUser } from './StudentAuthModal';
import {
  fetchExamStatus,
  type ExamAttemptState,
  type ExamStatus,
} from '../services/examAttemptService';

interface ExamPageProps {
  roundId: number | null;
  currentUser: StudentUser | null;
  isVip: boolean;
  academyPriceEur: number;
  onRequireLogin: (action?: string) => void;
  onOpenPayment: () => void;
  onSaveMistakes: (questionIds: string[], roundId?: number | null) => void;
  onGoToTopics: () => void;
  onBackToRounds: () => void;
  onSelectRound: (roundId: number) => void;
  onGoHome: () => void;
  /** Reports whether a live exam is on screen (e.g. for the shell's FAB size). */
  onExamRunningChange?: (running: boolean) => void;
}

type PageState = 'checking' | 'login' | 'payment' | 'ready';

/**
 * Dedicated exam page (route: #/exam).
 *
 * - requires a student login,
 * - checks the free-exam quota server-side and shows the VIP paywall after it
 *   is used up,
 * - resumes an unfinished exam from the server (or the device copy).
 */
export const ExamPage: React.FC<ExamPageProps> = ({
  roundId,
  currentUser,
  isVip,
  academyPriceEur,
  onRequireLogin,
  onOpenPayment,
  onSaveMistakes,
  onGoToTopics,
  onBackToRounds,
  onSelectRound,
  onGoHome,
  onExamRunningChange,
}) => {
  const [pageState, setPageState] = useState<PageState>('checking');
  const [status, setStatus] = useState<ExamStatus | null>(null);
  const [resumeAttempt, setResumeAttempt] = useState<ExamAttemptState | null>(null);
  const [effectiveRoundId, setEffectiveRoundId] = useState<number | null>(roundId);
  const [reloadKey, setReloadKey] = useState(0);

  const checkAccess = useCallback(async () => {
    if (!currentUser) {
      setPageState('login');
      return;
    }
    setPageState('checking');
    try {
      const type = roundId ? 'round' : 'mock';
      const result = await fetchExamStatus(type, roundId);
      setStatus(result);

      if (result.activeAttempt) {
        setResumeAttempt(result.activeAttempt);
        setEffectiveRoundId(result.activeAttempt.roundId ?? roundId);
        setPageState('ready');
        return;
      }

      setResumeAttempt(null);
      setEffectiveRoundId(roundId);

      if (!result.canStart && !isVip && (result.reason === 'payment_required' || result.requiresPayment)) {
        setPageState('payment');
        return;
      }
      setPageState('ready');
    } catch {
      // Server unreachable — allow the exam to continue (it still saves locally
      // and re-syncs when the API is reachable again).
      setResumeAttempt(null);
      setEffectiveRoundId(roundId);
      setPageState('ready');
    }
  }, [currentUser, roundId, isVip]);

  useEffect(() => {
    checkAccess();
  }, [checkAccess, reloadKey]);

  const handleNeedPayment = useCallback(() => {
    setPageState('payment');
  }, []);

  if (pageState === 'checking') {
    return (
      <div className="max-w-2xl mx-auto bg-white dark:bg-[#12161F] rounded-3xl p-10 text-center space-y-4 animate-fadeIn border border-slate-200 dark:border-white/10">
        <div className="w-12 h-12 border-4 border-[#FB6C00] border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm font-black text-slate-900 dark:text-white">পরীক্ষার প্রস্তুতি যাচাই হচ্ছে...</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">আপনার ফ্রি পরীক্ষার স্ট্যাটাস লোড হচ্ছে</p>
      </div>
    );
  }

  if (pageState === 'login') {
    return (
      <div className="max-w-2xl mx-auto bg-white dark:bg-[#12161F] rounded-3xl p-8 sm:p-10 text-center space-y-5 animate-fadeIn border border-slate-200 dark:border-white/10 shadow-sm">
        <div className="w-16 h-16 rounded-2xl bg-orange-50 dark:bg-white/5 border border-orange-200 dark:border-white/10 text-[#FB6C00] flex items-center justify-center mx-auto">
          <LogIn className="w-8 h-8" />
        </div>
        <div className="space-y-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[11px] font-black text-slate-700 dark:text-slate-300">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Login Required • লগইন বাধ্যতামূলক
          </span>
          <h2 className="text-2xl font-black text-slate-900 dark:text-white">অফিশিয়াল পরীক্ষা দিতে লগইন করুন</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto">
            আপনার পরীক্ষার উত্তর, সময় ও ফলাফল নিরাপদে সংরক্ষিত থাকে — তাই পরীক্ষা শুরু করতে ফ্রি স্টুডেন্ট অ্যাকাউন্টে সাইন ইন আবশ্যক।
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => onRequireLogin('পরীক্ষা শুরু করতে')}
            className="py-3 px-7 rounded-full bg-gradient-to-r from-[#E52E2D] to-[#FB6C00] text-white font-black text-sm shadow-lg shadow-[#FB6C00]/25 hover:scale-105 active:scale-95 transition cursor-pointer"
          >
            Sign In / Register Free
          </button>
          <button
            type="button"
            onClick={onGoHome}
            className="py-3 px-6 rounded-full bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-200 font-bold text-sm border border-slate-200 dark:border-white/10 transition cursor-pointer"
          >
            হোমে ফিরুন
          </button>
        </div>
      </div>
    );
  }

  if (pageState === 'payment') {
    const attemptsUsed = status?.attemptsUsed ?? 1;
    const freeLimit = status?.freeLimit ?? 1;
    return (
      <div className="max-w-2xl mx-auto bg-white dark:bg-[#12161F] rounded-3xl p-8 sm:p-10 text-center space-y-5 animate-fadeIn border-2 border-orange-300 dark:border-orange-700/60 shadow-lg">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-[#E52E2D] to-[#FB6C00] text-white flex items-center justify-center mx-auto shadow-lg">
          <Lock className="w-8 h-8" />
        </div>
        <div className="space-y-2">
          <span className="inline-block px-3 py-1 rounded-full bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/30 text-[11px] font-black text-orange-700 dark:text-orange-300 uppercase tracking-wider">
            Free Exam Used • ফ্রি পরীক্ষা সম্পন্ন
          </span>
          <h2 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">
            আপনার {freeLimit}টি ফ্রি সিমুলেশন পরীক্ষা শেষ হয়েছে
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 max-w-lg mx-auto leading-relaxed">
            আপনি ইতোমধ্যে {attemptsUsed}টি পরীক্ষা দিয়েছেন ({freeLimit}টি ফ্রি)। আরও পরীক্ষা দিতে এবং ২৪০টি রাউন্ডের সম্পূর্ণ
            কোর্স আনলক করতে €{academyPriceEur} এককালীন লাইফটাইম VIP পাস নিন — কোনো সাবস্ক্রিপশন নেই।
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3 max-w-md mx-auto text-left">
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 space-y-0.5">
            <Clock className="w-4 h-4 text-[#FB6C00]" />
            <span className="text-xs font-black text-slate-900 dark:text-white block">২০ মিনিট</span>
            <span className="text-[10px] text-slate-500 block">প্রতি পরীক্ষায়</span>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 space-y-0.5">
            <GraduationCap className="w-4 h-4 text-[#FB6C00]" />
            <span className="text-xs font-black text-slate-900 dark:text-white block">আনলিমিটেড</span>
            <span className="text-[10px] text-slate-500 block">VIP পরীক্ষা</span>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 space-y-0.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-black text-slate-900 dark:text-white block">২৪০ রাউন্ড</span>
            <span className="text-[10px] text-slate-500 block">সম্পূর্ণ কোর্স</span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            type="button"
            onClick={onOpenPayment}
            className="w-full sm:w-auto py-3.5 px-8 rounded-full bg-gradient-to-r from-[#E52E2D] to-[#FB6C00] text-white font-black text-base shadow-lg shadow-[#FB6C00]/30 hover:scale-105 active:scale-95 transition cursor-pointer"
          >
            💳 VIP পেমেন্ট করুন (€{academyPriceEur})
          </button>
          <button
            type="button"
            onClick={onGoHome}
            className="w-full sm:w-auto py-3.5 px-6 rounded-full bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-200 font-bold text-sm border border-slate-200 dark:border-white/10 transition cursor-pointer"
          >
            পরে দেখব
          </button>
        </div>

        {isVip && (
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="mx-auto flex items-center gap-1.5 text-xs font-bold text-emerald-600 hover:underline cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" /> VIP স্ট্যাটাস রিফ্রেশ করুন
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ExamSimulator
        roundId={effectiveRoundId}
        isVip={isVip}
        studentEmail={currentUser?.email || null}
        resumeAttempt={resumeAttempt}
        academyPriceEur={academyPriceEur}
        onNeedPayment={handleNeedPayment}
        onOpenEnrollment={onOpenPayment}
        onBackToRounds={onBackToRounds}
        onSelectRound={onSelectRound}
        onSaveMistakes={onSaveMistakes}
        onGoToTopics={onGoToTopics}
        onRunningChange={onExamRunningChange}
      />
    </div>
  );
};

export default ExamPage;
