import React, { useState } from 'react';
import { X, Lock, Mail, ShieldAlert, ArrowRight, ShieldCheck, KeyRound } from 'lucide-react';
import { saveAdminSession } from '../utils/adminSession';

interface AdminLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdminLoginSuccess: (email: string) => void;
}

// Authorized admin emails listed for UX purposes (the server enforces the
// real check against the ADMIN_PASSWORD / ADMIN_EMAILS environment variables).
const AUTHORIZED_ADMIN_EMAILS = [
  'khshifat@gmail.com',
  'khshifatmanjum@gmail.com',
  'saifulislamnyt@gmail.com',
];

export const AdminLoginModal: React.FC<AdminLoginModalProps> = ({
  isOpen,
  onClose,
  onAdminLoginSuccess,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const cleanEmail = email.trim().toLowerCase();

    if (!AUTHORIZED_ADMIN_EMAILS.some((adm) => cleanEmail === adm)) {
      setError('অননুমোদিত ইমেইল (Access Denied). শুধুমাত্র অনুমোদিত অ্যাডমিনরা এই পোর্টালে প্রবেশ করতে পারেন।');
      return;
    }

    if (!password) {
      setError('পাসওয়ার্ড দিন (Please enter admin password)');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/admin-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, password }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.token) {
        setError(
          data.error
            ? String(data.error)
            : 'ভুল পাসওয়ার্ড। দয়া করে আপনার সঠিক পাসওয়ার্ড দিন।'
        );
        setIsLoading(false);
        return;
      }

      saveAdminSession(data.email || cleanEmail, data.token);
      onAdminLoginSuccess(data.email || cleanEmail);
      onClose();
    } catch {
      setError('সার্ভারে সংযোগ করা যায়নি। ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।');
    }
    setIsLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn text-left">
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl overflow-hidden">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header Icon & Title */}
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs font-black text-red-700 dark:text-red-300">
            <KeyRound className="w-3.5 h-3.5 text-red-600" />
            <span>Restricted Access • অ্যাডমিন পোর্টাল</span>
          </div>

          <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            অ্যাডমিন CRM ড্যাশবোর্ড
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            স্টুডেন্টদের ডেটা, WhatsApp লিড তালিকা ও পেমেন্ট হিস্ট্রি দেখতে অনুমোদিত অ্যাডমিন ইমেইল দিয়ে লগইন করুন।
          </p>
        </div>

        {/* Authorized Emails Notice */}
        <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
          <div className="flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-200">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>অনুমোদিত অ্যাডমিন অ্যাকাউন্ট:</span>
          </div>
          <div className="flex flex-col gap-0.5 pl-5 font-mono text-[10px] text-[#FB6C00]">
            <span>• khshifat@gmail.com</span>
            <span>• khshifatmanjum@gmail.com</span>
            <span>• saifulislamnyt@gmail.com</span>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs font-bold text-rose-700 dark:text-rose-300 flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              অ্যাডমিন ইমেইল (Admin Email)
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="saifulislamnyt@gmail.com বা khshifat@gmail.com"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              অ্যাডমিন পাসওয়ার্ড (Admin Password)
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="আপনার পাসওয়ার্ড দিন"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-red-600 via-orange-600 to-amber-500 hover:opacity-95 text-white font-black text-sm transition flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-50"
          >
            <span>{isLoading ? 'যাচাই করা হচ্ছে...' : 'লগইন করুন (Access CRM)'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
