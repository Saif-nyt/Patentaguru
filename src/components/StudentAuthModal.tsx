import React, { useState, useEffect } from 'react';
import {
  X,
  User,
  Mail,
  Lock,
  Phone,
  ArrowRight,
  CheckCircle2,
  Sparkles,
  LogIn,
  UserPlus,
  Loader2,
  AlertCircle,
  GraduationCap,
  Eye,
  EyeOff,
  MessageCircle,
  RefreshCw,
} from 'lucide-react';
import {
  registerStudent,
  loginStudent,
  loginStudentWithGoogle,
  getCachedStudent,
  resendVerificationEmail,
  refreshEmailVerification,
} from '../services/studentService';
import type { StudentProfile } from '../services/studentService';
import { WHATSAPP_GROUP_URL } from '../config/constants';
import { trackWhatsAppJoin } from '../services/analytics';

export type StudentUser = StudentProfile;

interface StudentAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (user: StudentUser) => void;
  initialMode?: 'login' | 'register' | 'verify';
  forcedMessage?: string;
}

export const StudentAuthModal: React.FC<StudentAuthModalProps> = ({
  isOpen,
  onClose,
  onLoginSuccess,
  initialMode = 'login',
  forcedMessage,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode === 'register' ? 'register' : 'login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneCountry, setPhoneCountry] = useState('+39');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Success screen state after successful registration
  const [registeredStudent, setRegisteredStudent] = useState<StudentUser | null>(null);

  // Email-verification pending state (shown after register or unverified login)
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null);
  const [pendingStudent, setPendingStudent] = useState<StudentUser | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isResending, setIsResending] = useState(false);
  const [isCheckingVerify, setIsCheckingVerify] = useState(false);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // When opened directly in verify mode (e.g. from the dashboard banner),
  // prefill the pending email from the cached Better Auth profile.
  useEffect(() => {
    if (!isOpen) return;
    if (initialMode === 'verify') {
      const currentEmail = (getCachedStudent()?.email || pendingStudent?.email || '').trim().toLowerCase();
      if (currentEmail) {
        setVerifyEmail(currentEmail);
        setError('');
      }
    }
  }, [isOpen, initialMode]);

  // Reset transient state shortly after the modal closes
  useEffect(() => {
    if (!isOpen) {
      setIsLoading(false);
      const t = window.setTimeout(() => {
        setVerifyEmail(null);
        setPendingStudent(null);
        setRegisteredStudent(null);
        setError('');
        setResendCooldown(0);
      }, 200);
      return () => window.clearTimeout(t);
    }
  }, [isOpen]);

  // Resend cooldown ticker (limits verification email spam)
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => setResendCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  if (!isOpen) return null;

  // Validation Policies
  const isNameValid = (val: string) => {
    const trimmed = val.trim();
    if (trimmed.length < 3) return false;
    return /^[\p{L}\s'-]+$/u.test(trimmed);
  };

  const isEmailValid = (val: string) => {
    return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(val.trim());
  };

  const isPhoneValid = (prefix: string, rawNumber: string) => {
    let digits = rawNumber.replace(/\D/g, '');
    if (!digits) return false;

    // Reject trivial short repetitive dummy numbers
    if (digits.length < 6 || /^(\d)\1+$/.test(digits) || digits === '123456' || digits === '12345678') {
      return false;
    }

    if (prefix === '+39') {
      // Italian mobile numbers start with 3 and have 9 to 10 digits (strip leading zero if entered)
      digits = digits.replace(/^0+/, '');
      return digits.length >= 9 && digits.length <= 10;
    }
    if (prefix === '+880') {
      // Bangladeshi mobile numbers start with 1 and have 10 digits
      digits = digits.replace(/^0+/, '');
      return digits.length === 10;
    }

    // Generic international format
    return digits.length >= 7 && digits.length <= 14;
  };

  const isPasswordValid = (val: string) => {
    // Strict password policy: at least 8 to 9 characters
    if (val.length < 8) return false;
    // Reject common trivial sequences
    const trivial = [
      '12345678', '123456789', '00000000', '11111111', 
      'password', 'password1', 'qwertyuiop', 'patente123'
    ];
    if (trivial.includes(val.toLowerCase())) return false;
    // Must contain both letters and numbers
    const hasLetters = /[a-zA-Z]/.test(val);
    const hasNumbers = /[0-9]/.test(val);
    return hasLetters && hasNumbers;
  };

  const getAuthErrorMessage = (err: any): string => {
    const code = String(err?.code || '').toUpperCase();
    const message = String(err?.message || '');
    if (code.includes('USER_ALREADY_EXISTS') || message.toLowerCase().includes('already exists')) {
      return 'এই ইমেইল দিয়ে ইতোমধ্যে অ্যাকাউন্ট রয়েছে। দয়া করে Sign In (লগইন) করুন।';
    }
    if (code.includes('INVALID_EMAIL_OR_PASSWORD') || code.includes('INVALID_CREDENTIAL')) {
      return 'ভুল ইমেইল বা পাসওয়ার্ড দেওয়া হয়েছে। দয়া করে আবার সঠিক তথ্য দিয়ে চেষ্টা করুন।';
    }
    if (code.includes('PASSWORD_TOO_SHORT') || code.includes('PASSWORD_TOO_WEAK')) {
      return 'পাসওয়ার্ড নীতি: পাসওয়ার্ড অন্তত ৮ বা ৯ অক্ষরের হতে হবে এবং অক্ষর ও সংখ্যা মিলিয়ে লিখুন (যেমন: Patente2026)।';
    }
    if (code.includes('INVALID_EMAIL')) {
      return 'সঠিক ইমেইল এড্রেস লিখুন (যেমন: name@gmail.com)।';
    }
    if (message.toLowerCase().includes('fetch')) {
      return 'ইন্টারনেট কানেকশন সমস্যা। অনুগ্রহ করে আবার চেষ্টা করুন।';
    }
    if (message.toLowerCase().includes('timeout') || message.toLowerCase().includes('timed out')) {
      return 'সার্ভার থেকে উত্তর পেতে দেরি হচ্ছে। আপনার ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।';
    }
    if (code.includes('RATE_LIMIT')) {
      return 'অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।';
    }
    return message || 'একটি ত্রুটি ঘটেছে। অনুগ্রহ করে আবার চেষ্টা করুন।';
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setError('');

    // 1. Validate Name Group Policy
    if (!isNameValid(name)) {
      setError('নথিপত্র অনুযায়ী আপনার পূর্ণ নাম (First Name ও Last Name) ইংরেজিতে লিখুন (অন্তত ৩ অক্ষর)।');
      return;
    }

    // 2. Validate Email Group Policy
    if (!isEmailValid(email)) {
      setError('সঠিক ইমেইল ঠিকানা দিন (যেমন: marco.rossi@gmail.com)।');
      return;
    }

    // 3. Validate Phone Group Policy (Strict Italian Mobile)
    if (!isPhoneValid(phoneCountry, phoneNumber)) {
      if (phoneCountry === '+39') {
        setError('সঠিক ইতালিয়ান মোবাইল নম্বর দিন (ইতালিয়ান মোবাইল ৩ দিয়ে শুরু এবং ৯-১০ ডিজিটের হয়, যেমন: 328 123 4567)। ভুয়া নম্বর গ্রহণযোগ্য নয়।');
      } else {
        setError('সঠিক WhatsApp নম্বর দিন (নম্বরটি অন্তত ৮-১০ ডিজিটের হতে হবে)।');
      }
      return;
    }

    // 4. Validate Password Policy (8-9+ chars, letters + numbers)
    if (!isPasswordValid(password)) {
      setError('পাসওয়ার্ড নীতি: পাসওয়ার্ড অন্তত ৮ বা ৯ অক্ষরের হতে হবে এবং অক্ষর ও সংখ্যা মিলিয়ে লিখুন (যেমন: Patente2026)।');
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = `${phoneCountry} ${phoneNumber.trim()}`;
    const rawDigits = phoneNumber.replace(/\D/g, '');

    // 5. Keep phone numbers unique for new accounts while allowing existing
    // student records to reconnect to Better Auth with their original email.
    setIsLoading(true);
    try {
      try {
        const localList: any[] = JSON.parse(localStorage.getItem('patente_registered_students') || '[]');
        let existingStudent = localList.some((student) => (student?.email || '').toLowerCase() === cleanEmail);
        const cloudCheck = await fetch(`/api/students?email=${encodeURIComponent(cleanEmail)}`, {
          signal: AbortSignal.timeout(15_000),
        });
        if (cloudCheck.ok) {
          const cloudUser = await cloudCheck.json();
          existingStudent = existingStudent || Boolean(cloudUser?.email);
        }

        if (!existingStudent) {
          const phoneTakenLocal = localList.some((student) => {
            const digits = (student?.phone || '').replace(/\D/g, '');
            return (student?.email || '').toLowerCase() !== cleanEmail &&
              digits.length >= 8 &&
              digits.endsWith(rawDigits.slice(-8));
          });
          if (phoneTakenLocal) {
            setError('এই মোবাইল নম্বরটি দিয়ে ইতোমধ্যে PatenteGuru-তে অন্য অ্যাকাউন্ট খোলা আছে। দয়া করে আপনার নিজস্ব সঠিক নম্বর দিন।');
            return;
          }

          const cloudPhoneCheck = await fetch(`/api/students?phone=${encodeURIComponent(rawDigits)}`, {
            signal: AbortSignal.timeout(15_000),
          });
          if (cloudPhoneCheck.ok) {
            const cloudPhoneUser = await cloudPhoneCheck.json();
            if (cloudPhoneUser && cloudPhoneUser.phone) {
              setError('এই মোবাইল নম্বরটি দিয়ে ইতোমধ্যে PatenteGuru-তে অন্য অ্যাকাউন্ট খোলা আছে। দয়া করে আপনার নিজস্ব সঠিক নম্বর দিন।');
              return;
            }
          }
        }
      } catch (checkErr) {
        console.warn('Duplicate check warning:', checkErr);
      }

      const student = await registerStudent(name.trim(), email.trim(), cleanPhone, password);
      if (student.emailVerified === false) {
        // Block access until Better Auth confirms the email address.
        setPendingStudent(student);
        setVerifyEmail(student.email);
        setResendCooldown(45);
        setError('');
        return;
      }
      setRegisteredStudent(student);
    } catch (err: any) {
      console.warn('Student registration failed:', err);
      setError(getAuthErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !email.includes('@')) {
      setError('দয়া করে আপনার নিবন্ধিত ইমেইল এড্রেস দিন');
      return;
    }
    if (!password) {
      setError('দয়া করে আপনার পাসওয়ার্ড দিন');
      return;
    }

    if (isLoading) return;
    try {
      setIsLoading(true);
      const student = await loginStudent(email, password);
      if (student.emailVerified === false) {
        // Signed in but email not verified yet → keep the modal open on the verify screen
        onLoginSuccess(student);
        setPendingStudent(student);
        setVerifyEmail(student.email);
        setError('');
        return;
      }
      onLoginSuccess(student);
      onClose();
    } catch (err: any) {
      setIsLoading(false);
      if (String(err?.code || '').toUpperCase().includes('EMAIL_NOT_VERIFIED')) {
        setVerifyEmail(email.trim().toLowerCase());
        setPendingStudent(getCachedStudent());
        setResendCooldown(45);
        setError('');
        return;
      }
      setError(getAuthErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (isLoading) return;
    setError('');
    setIsLoading(true);
    try {
      await loginStudentWithGoogle();
    } catch (err: any) {
      setError(getAuthErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (resendCooldown > 0 || isResending) return;
    setError('');
    setIsResending(true);
    try {
      await resendVerificationEmail(verifyEmail || undefined);
      setResendCooldown(45);
    } catch (err: any) {
      setError(getAuthErrorMessage(err));
    } finally {
      setIsResending(false);
    }
  };

  const handleVerifyContinue = async () => {
    if (isCheckingVerify) return;
    setError('');
    setIsCheckingVerify(true);
    try {
      const { verified, profile } = await refreshEmailVerification();
      if (verified) {
        const finalProfile = profile || pendingStudent;
        if (finalProfile) {
          onLoginSuccess({ ...finalProfile, emailVerified: true });
        }
        onClose();
        return;
      }
      setError('ইমেইল এখনো ভেরিফাই হয়নি। ইনবক্স এবং Spam ফোল্ডার চেক করে ভেরিফিকেশন লিংকে ক্লিক করুন, তারপর আবার চেষ্টা করুন।');
    } catch (err: any) {
      setError(getAuthErrorMessage(err));
    } finally {
      setIsCheckingVerify(false);
    }
  };

  const handleWelcomeContinue = () => {
    if (registeredStudent) {
      onLoginSuccess(registeredStudent);
    }
    onClose();
  };

  return (
    <div 
      className="fixed inset-0 z-50 overflow-y-auto p-3 sm:p-5 flex min-h-full items-center justify-center bg-black/75 backdrop-blur-md animate-fadeIn text-left"
      role="dialog"
      aria-modal="true"
    >
      {/* Click Outside Backdrop */}
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />

      {/* Modal Card */}
      <div 
        className="relative w-full max-w-md my-auto bg-white dark:bg-[#12161F] border border-slate-200 dark:border-white/10 rounded-3xl p-5 sm:p-6 shadow-2xl z-10 max-h-[92vh] flex flex-col overflow-hidden transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-white/10 dark:hover:bg-white/15 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition cursor-pointer z-20"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* EMAIL VERIFICATION PENDING VIEW */}
        {verifyEmail ? (
          <div className="py-2 space-y-4 text-center animate-fadeIn overflow-y-auto no-scrollbar pr-1 -mr-1">
            <div className="w-14 h-14 rounded-2xl bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto text-2xl shadow-lg shadow-amber-500/15">
              📧
            </div>

            <div className="space-y-1">
              <span className="inline-block px-3 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                Email Verification Required
              </span>
              <h3 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                ইমেইল ভেরিফাই করুন
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 max-w-sm mx-auto leading-relaxed">
                আমরা <strong className="text-slate-900 dark:text-white">{verifyEmail}</strong> ঠিকানায় একটি ভেরিফিকেশন লিংক পাঠিয়েছি। লিংকে ক্লিক করে ইমেইল ভেরিফাই করুন — তারপর নিচের বাটনে চাপ দিন।
              </p>
            </div>

            {error && (
              <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-xs font-bold text-rose-700 dark:text-rose-300 flex items-start gap-2 text-left">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span className="leading-snug">{error}</span>
              </div>
            )}

            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200/80 dark:border-white/10 text-left space-y-2">
              <div className="flex items-center gap-2 font-bold text-xs text-slate-900 dark:text-white">
                <GraduationCap className="w-4 h-4 text-[#FB6C00]" />
                <span>কীভাবে ভেরিফাই করবেন:</span>
              </div>
              <ol className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300 list-decimal list-inside marker:text-[#FB6C00] marker:font-bold">
                <li>আপনার ইমেইল ইনবক্স খুলুন (Gmail / Outlook ইত্যাদি)</li>
                <li>“PatenteBangla” থেকে নতুন ইমেইল খুঁজুন</li>
                <li>ইমেইলের ভেরিফিকেশন লিংকে ক্লিক করুন</li>
                <li>ইমেইল না পেলে <strong>Spam / Junk</strong> ফোল্ডার দেখুন</li>
              </ol>
            </div>

            <div className="space-y-2.5">
              <button
                type="button"
                onClick={handleVerifyContinue}
                disabled={isCheckingVerify}
                className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-[#E52E2D] to-[#FB6C00] hover:from-[#d02524] hover:to-[#e55e00] disabled:opacity-60 text-white font-black text-sm transition flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-[#FB6C00]/25 active:scale-98"
              >
                {isCheckingVerify ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Checking Verification...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>ভেরিফাই হয়েছে — Continue</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleResendVerification}
                disabled={resendCooldown > 0 || isResending}
                className="w-full py-2.5 px-4 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-white/10 dark:hover:bg-white/15 disabled:opacity-60 text-slate-800 dark:text-slate-200 font-bold text-xs transition flex items-center justify-center gap-2 cursor-pointer active:scale-98"
              >
                {isResending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Sending...</span>
                  </>
                ) : resendCooldown > 0 ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Resend in {resendCooldown}s</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>রিসেন্ড ভেরিফিকেশন ইমেইল (Resend)</span>
                  </>
                )}
              </button>
            </div>

            <div className="text-center pt-1">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                ভুল ইমেইল দিয়েছেন?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setVerifyEmail(null);
                    setPendingStudent(null);
                    setMode('register');
                    setError('');
                    setEmail('');
                    setPassword('');
                  }}
                  className="font-bold text-[#FB6C00] hover:underline cursor-pointer"
                >
                  সঠিক ইমেইল দিয়ে আবার রেজিস্টার করুন
                </button>
              </p>
            </div>
          </div>
        ) : registeredStudent ? (
          <div className="py-2 space-y-4 text-center animate-fadeIn overflow-y-auto no-scrollbar pr-1 -mr-1">
            <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto text-2xl shadow-lg shadow-emerald-500/15">
              🎉
            </div>

            <div className="space-y-1">
              <span className="inline-block px-3 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                Registration Successful • Welcome!
              </span>
              <h3 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                Benvenuto su Patente Bangla!
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 max-w-sm mx-auto">
                Welcome <strong>{registeredStudent.name}</strong>! Your student account is now active and ready.
              </p>
            </div>

            {/* Unlocked Benefits Banner */}
            <div className="p-3.5 rounded-2xl bg-orange-50/60 dark:bg-white/5 border border-orange-200/70 dark:border-white/10 text-left space-y-2">
              <div className="flex items-center gap-2 font-bold text-xs text-slate-900 dark:text-white">
                <GraduationCap className="w-4 h-4 text-[#FB6C00]" />
                <span>Active Account Benefits:</span>
              </div>
              <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span><strong>Round 1 Unlocked</strong> — Pass with ≤ 3 errors to unlock next round</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Up to <strong>20 Assessment Rounds (600 Questions)</strong> free progress tracking</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Cloud sync for mistake notebook & profile data</span>
                </li>
              </ul>
            </div>

            {/* Official WhatsApp Group Invite Card */}
            <div className="p-3.5 sm:p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300/80 dark:border-emerald-600/40 text-left space-y-2.5 shadow-sm">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#25D366] text-white flex items-center justify-center shrink-0 shadow-md shadow-[#25D366]/30">
                  <MessageCircle className="w-5 h-5 fill-current" />
                </div>
                <div>
                  <h4 className="text-xs sm:text-sm font-black text-slate-900 dark:text-white leading-tight">
                    অফিসিয়াল WhatsApp স্টুডেন্ট গ্রুপ 📢
                  </h4>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 pt-0.5 leading-tight">
                    সকল নতুন নোটিশ, লাইভ ক্লাস আপডেট ও জরুরি নোটিফিকেশন পেতে যুক্ত হোন
                  </p>
                </div>
              </div>

              <a
                href={WHATSAPP_GROUP_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackWhatsAppJoin('registration_success_modal')}
                className="w-full py-2.5 px-4 rounded-xl bg-[#25D366] hover:bg-[#20bd5a] text-white font-black text-xs sm:text-sm transition flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-[#25D366]/25 active:scale-95"
              >
                <MessageCircle className="w-4 h-4 fill-current" />
                <span>গ্রুপে যুক্ত হোন (Join WhatsApp Group)</span>
              </a>
            </div>

            <button
              type="button"
              onClick={handleWelcomeContinue}
              className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-[#E52E2D] to-[#FB6C00] hover:from-[#d02524] hover:to-[#e55e00] text-white font-black text-sm transition flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-[#FB6C00]/25 active:scale-98"
            >
              <span>Start Free Round 1 (প্রথম রাউন্ড শুরু করুন)</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            {/* Modal Header & Tab Switcher (Fixed at top) */}
            <div className="shrink-0 space-y-3 pb-2 border-b border-slate-100 dark:border-white/10">
              <div className="pr-8">
                <h3 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight">
                  {mode === 'login' ? 'Sign In to Student Portal' : 'Create Free Student Account'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                  {forcedMessage ||
                    (mode === 'login'
                      ? 'Log in to access your unlocked rounds and practice mistakes.'
                      : 'Register to unlock Round 1 and save your official exam progress.')}
                </p>
              </div>

              {/* Segmented Tab Switcher */}
              <div className="grid grid-cols-2 p-1 rounded-2xl bg-slate-100 dark:bg-white/5 border border-slate-200/80 dark:border-white/10 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError('');
                  }}
                  className={`py-2 rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer ${
                    mode === 'login'
                      ? 'bg-white dark:bg-white/15 text-[#FB6C00] dark:text-white shadow-xs font-black'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Sign In</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setError('');
                  }}
                  className={`py-2 rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer ${
                    mode === 'register'
                      ? 'bg-white dark:bg-white/15 text-[#FB6C00] dark:text-white shadow-xs font-black'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Create Account</span>
                </button>
              </div>
            </div>

            {/* Scrollable Form Body */}
            <div className="overflow-y-auto overflow-x-hidden pr-1 -mr-1 pt-3 space-y-3.5 no-scrollbar scrollbar-none flex-1">
              {/* Error Notification */}
              {error && (
                <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-xs font-bold text-rose-700 dark:text-rose-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span className="leading-snug">{error}</span>
                </div>
              )}

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isLoading}
                className="w-full py-2.5 px-4 rounded-xl border border-slate-200 dark:border-white/15 bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10 disabled:opacity-60 text-slate-800 dark:text-white font-bold text-sm transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <span className="font-black text-base text-[#4285F4]">G</span>
                <span>Continue with Google</span>
              </button>
              <div className="relative text-center text-[10px] font-bold text-slate-400">
                <span className="bg-white dark:bg-[#12161F] px-2 relative z-10">OR EMAIL</span>
                <span className="absolute left-0 right-0 top-1/2 border-t border-slate-200 dark:border-white/10" />
              </div>

              {/* LOGIN FORM */}
              {mode === 'login' && (
                <form onSubmit={handleLogin} className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Email Address *
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="yourname@gmail.com"
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-white/15 bg-slate-50 dark:bg-[#0D1117] text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#FB6C00] focus:border-[#FB6C00] transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Password *
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-200 dark:border-white/15 bg-slate-50 dark:bg-[#0D1117] text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#FB6C00] focus:border-[#FB6C00] transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-2.5 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition cursor-pointer"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-3 px-4 mt-2 rounded-2xl bg-[#FB6C00] hover:bg-orange-600 disabled:opacity-60 text-white font-black text-sm transition flex items-center justify-center gap-2 cursor-pointer shadow-md active:scale-98"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Signing In...</span>
                      </>
                    ) : (
                      <>
                        <span>Sign In</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>

                  <div className="text-center pt-2">
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      নতুন শিক্ষার্থী?{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setMode('register');
                          setError('');
                        }}
                        className="font-bold text-[#FB6C00] hover:underline cursor-pointer"
                      >
                        ফ্রি অ্যাকাউন্ট তৈরি করুন
                      </button>
                    </p>
                  </div>
                </form>
              )}

              {/* REGISTRATION FORM */}
              {mode === 'register' && (
                <form onSubmit={handleRegister} className="space-y-3">
                  {/* Full Legal Name */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                        Full Name *
                      </label>
                      {name && (
                        <span className={`text-[10px] font-bold ${isNameValid(name) ? 'text-emerald-600' : 'text-slate-400'}`}>
                          {isNameValid(name) ? '✓ Valid' : 'Min 3 chars'}
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="আপনার নাম (যেমন: Rock Man)"
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-white/15 bg-slate-50 dark:bg-[#0D1117] text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#FB6C00] focus:border-[#FB6C00] transition-colors"
                      />
                    </div>
                  </div>

                  {/* Email Address */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                        Email Address *
                      </label>
                      {email && (
                        <span className={`text-[10px] font-bold ${isEmailValid(email) ? 'text-emerald-600' : 'text-slate-400'}`}>
                          {isEmailValid(email) ? '✓ Valid' : 'Invalid format'}
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="info@example.it"
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-white/15 bg-slate-50 dark:bg-[#0D1117] text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#FB6C00] focus:border-[#FB6C00] transition-colors"
                      />
                    </div>
                  </div>

                  {/* WhatsApp Phone Number */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                        WhatsApp Phone *
                      </label>
                      {phoneNumber && (
                        <span className={`text-[10px] font-bold ${isPhoneValid(phoneCountry, phoneNumber) ? 'text-emerald-600' : 'text-slate-400'}`}>
                          {isPhoneValid(phoneCountry, phoneNumber) ? '✓ Valid' : 'Invalid number'}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <select
                        value={phoneCountry}
                        onChange={(e) => setPhoneCountry(e.target.value)}
                        aria-label="Country Code"
                        className="py-2.5 px-3 rounded-xl border border-slate-200 dark:border-white/15 bg-slate-50 dark:bg-[#0D1117] text-slate-900 dark:text-white text-xs font-bold focus:outline-none focus:ring-2 focus:ring-[#FB6C00] shrink-0 cursor-pointer"
                      >
                        <option value="+39">🇮🇹 +39</option>
                        <option value="+880">🇧🇩 +880</option>
                        <option value="+49">🇩🇪 +49</option>
                        <option value="+33">🇫🇷 +33</option>
                        <option value="+44">🇬🇧 +44</option>
                      </select>
                      <div className="relative flex-1">
                        <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                        <input
                          type="tel"
                          required
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value)}
                          placeholder="328 123 4567"
                          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-white/15 bg-slate-50 dark:bg-[#0D1117] text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#FB6C00] focus:border-[#FB6C00] transition-colors"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Password */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                        Password *
                      </label>
                      {password && (
                        <span className={`text-[10px] font-bold ${isPasswordValid(password) ? 'text-emerald-600' : 'text-amber-500'}`}>
                          {isPasswordValid(password) ? '✓ Strong' : 'Min 6 (Letters + Numbers)'}
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-200 dark:border-white/15 bg-slate-50 dark:bg-[#0D1117] text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#FB6C00] focus:border-[#FB6C00] transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-2.5 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition cursor-pointer"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Compact Benefits Checklist */}
                  <div className="p-3 rounded-2xl bg-orange-50/70 dark:bg-orange-950/20 border border-orange-200/70 dark:border-orange-900/40 space-y-1 text-xs">
                    <div className="flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-200">
                      <Sparkles className="w-3.5 h-3.5 text-[#FB6C00]" />
                      <span>Free Account Benefits:</span>
                    </div>
                    <div className="grid grid-cols-1 gap-1 pt-0.5 text-[11px] text-slate-600 dark:text-slate-400">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        Sequential Unlocking: Round 1 open, pass to unlock up to Round 20
                      </span>
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        Mistake Notebook &amp; progress synchronized to your profile
                      </span>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-3 px-4 rounded-2xl bg-[#FB6C00] hover:bg-orange-600 disabled:opacity-60 text-white font-black text-sm transition flex items-center justify-center gap-2 cursor-pointer shadow-md active:scale-98"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Creating Account & Unlocking Round 1...</span>
                      </>
                    ) : (
                      <>
                        <span>Create Account</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>

                  <div className="text-center pt-1 pb-1">
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      ইতোমধ্যে অ্যাকাউন্ট আছে?{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setMode('login');
                          setError('');
                        }}
                        className="font-bold text-[#FB6C00] hover:underline cursor-pointer"
                      >
                        সাইন ইন করুন (Sign In)
                      </button>
                    </p>
                  </div>
                </form>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
