import { useState, useEffect, lazy, Suspense } from 'react';
import { Header } from './components/Header';
import type { NavTab } from './components/Header';
import { AppNavigation } from './components/AppNavigation';
import type { AppTab } from './components/AppNavigation';
import { StudentDashboardView } from './components/StudentDashboardView';
import { EnrollmentModal } from './components/EnrollmentModal';
import { StudentAuthModal } from './components/StudentAuthModal';
import type { StudentUser } from './components/StudentAuthModal';
import { getAdminEmail, getAdminToken, clearAdminSession } from './utils/adminSession';
import {
  subscribeToAuthChanges,
  logoutStudent,
  syncStudentProgressToCloud,
  sanitizeStudentProfile,
  fetchStudentFromServerDb,
  refreshEmailVerification,
} from './services/studentService';
import type { ThemeMode } from './components/ThemeSwitcher';
import { Footer } from './components/Footer';
import confetti from 'canvas-confetti';
import { 
  getLatestInvoice, 
  createInvoiceRecord, 
  saveInvoice 
} from './services/paymentService';
import type { InvoiceRecord } from './services/paymentService';
import { trackPageView, trackThemeChange, trackWhatsAppJoin } from './services/analytics';
import { WHATSAPP_GROUP_URL } from './config/constants';
import { fetchActiveExamAttempt, loadLocalExamState } from './services/examAttemptService';
import type { ExamAttemptState } from './services/examAttemptService';
import { 
  getAppSettings, 
  fetchRemoteAppSettings, 
  SETTINGS_CHANGE_EVENT 
} from './services/appSettingsService';
import type { AppSettings } from './services/appSettingsService';
import { trackViewContent, trackPurchase } from './utils/metaPixel';

// Lazy-loaded heavy components (saves >2MB on initial mobile download!)
const TheorySummaryView = lazy(() => import('./components/TheorySummaryView').then(m => ({ default: m.TheorySummaryView })));
const RoundsCurriculumView = lazy(() => import('./components/RoundsCurriculumView').then(m => ({ default: m.RoundsCurriculumView })));
const MistakeReview = lazy(() => import('./components/MistakeReview').then(m => ({ default: m.MistakeReview })));
const AdminCrmDashboard = lazy(() => import('./components/AdminCrmDashboard').then(m => ({ default: m.AdminCrmDashboard })));
const AdminLoginModal = lazy(() => import('./components/AdminLoginModal').then(m => ({ default: m.AdminLoginModal })));
const AboutModal = lazy(() => import('./components/AboutModal').then(m => ({ default: m.AboutModal })));
const PatenteChatbot = lazy(() => import('./components/PatenteChatbot').then(m => ({ default: m.PatenteChatbot })));
const StudentProfileModal = lazy(() => import('./components/StudentProfileModal').then(m => ({ default: m.StudentProfileModal })));
const AcademyEnrollmentPage = lazy(() => import('./components/AcademyEnrollmentPage').then(m => ({ default: m.AcademyEnrollmentPage })));
const CoursePaymentModal = lazy(() => import('./components/CoursePaymentModal').then(m => ({ default: m.CoursePaymentModal })));
const CourseInvoiceModal = lazy(() => import('./components/CourseInvoiceModal').then(m => ({ default: m.CourseInvoiceModal })));
const StudentLeadModal = lazy(() => import('./components/StudentLeadModal').then(m => ({ default: m.StudentLeadModal })));
const ExamPage = lazy(() => import('./components/ExamPage').then(m => ({ default: m.ExamPage })));

// Calculate true sequential progress: a student can only reach Round N if rounds 1..N-1 are passed
export const getSequentialUnlockedRound = (completed?: Record<number, { passed: boolean }> | null): number => {
  if (!completed || typeof completed !== 'object') return 1;
  let r = 1;
  while (completed[r]?.passed === true && r < 240) {
    r++;
  }
  return r;
};

// ---------------------------------------------------------------------------
// Tiny hash-based router (no extra dependency): #/ = home, #/exam = exam page
// ---------------------------------------------------------------------------
type AppRoute = 'home' | 'exam';

const parseHashRoute = (): AppRoute => {
  const hash = window.location.hash.replace(/^#/, '');
  if (hash === '/exam' || hash.startsWith('/exam?') || hash.startsWith('/exam/')) return 'exam';
  return 'home';
};

export function App() {
  const [appTab, setAppTab] = useState<AppTab | 'admin' | 'enrollment'>('dashboard');
  const [route, setRoute] = useState<AppRoute>(() => parseHashRoute());
  const [examRoundId, setExamRoundId] = useState<number | null>(null);
  // True while a live exam is on screen (used to shrink the support FAB on phones)
  const [isExamRunning, setIsExamRunning] = useState(false);
  const [isPaywallOpen, setIsPaywallOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isStudentProfileOpen, setIsStudentProfileOpen] = useState(false);

  // Direct Online Payment & Invoicing State
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [activeInvoice, setActiveInvoice] = useState<InvoiceRecord | null>(() => getLatestInvoice());
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);

  // Theme State: 'light' | 'sepia' | 'dark'
  const [currentTheme, setCurrentTheme] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem('patente_bangla_theme') as ThemeMode;
      if (saved === 'light' || saved === 'sepia' || saved === 'dark') {
        return saved;
      }
    } catch {}
    return 'dark';
  });

  // Theme switch feedback notification
  const [themeToast, setThemeToast] = useState<{ message: string; subtext: string; icon: string } | null>(null);

  const handleThemeChange = (newTheme: ThemeMode) => {
    setCurrentTheme(newTheme);
    trackThemeChange(newTheme);
    if (newTheme === 'light') {
      setThemeToast({
        message: 'Daytime Light Mode',
        subtext: 'উজ্জ্বল আলো ও হাই-কন্ট্রাস্ট মোড চালু হয়েছে',
        icon: '☀️',
      });
    } else if (newTheme === 'sepia') {
      setThemeToast({
        message: 'Reader Eye-Comfort Mode',
        subtext: 'চোখের সুরক্ষায় উষ্ণ বই পড়ার সেপিয়া মোড চালু হয়েছে',
        icon: '📖',
      });
    } else {
      setThemeToast({
        message: 'Adobe Dark Night Mode',
        subtext: 'রাতের নির্ঝঞ্ঝাট প্রফেশনাল ব্ল্যাক মোড চালু হয়েছে',
        icon: '🌙',
      });
    }
  };

  useEffect(() => {
    trackPageView(appTab);
  }, [appTab]);

  // Keep the route in sync with the URL hash (back/forward + direct links)
  useEffect(() => {
    const onHashChange = () => setRoute(parseHashRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (themeToast) {
      const timer = setTimeout(() => {
        setThemeToast(null);
      }, 2600);
      return () => clearTimeout(timer);
    }
  }, [themeToast]);

  // Sync theme with HTML document class
  useEffect(() => {
    try {
      localStorage.setItem('patente_bangla_theme', currentTheme);
    } catch {}
    const root = document.documentElement;
    root.classList.remove('dark', 'theme-sepia', 'theme-light');
    if (currentTheme === 'dark') {
      root.classList.add('dark');
    } else if (currentTheme === 'sepia') {
      root.classList.add('theme-sepia');
    } else {
      root.classList.add('theme-light');
    }
  }, [currentTheme]);

  // Dynamic App Policy & Marketing Settings (free rounds limit, promo banners, etc.)
  const [appSettings, setAppSettings] = useState<AppSettings>(() => getAppSettings());

  useEffect(() => {
    fetchRemoteAppSettings().then((s) => {
      if (s) setAppSettings(s);
    });

    const handleSettingsChanged = (e: any) => {
      if (e?.detail) {
        setAppSettings(e.detail);
      }
    };

    window.addEventListener(SETTINGS_CHANGE_EVENT, handleSettingsChanged);
    return () => window.removeEventListener(SETTINGS_CHANGE_EVENT, handleSettingsChanged);
  }, []);

  // The Better Auth session is loaded from the server after mount.
  const [currentUser, setCurrentUser] = useState<StudentUser | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authForcedMessage, setAuthForcedMessage] = useState('');
  // Which view the auth modal should open on: login/register forms, or the
  // email-verification pending screen (for unverified signed-in students).
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register' | 'verify'>('login');

  // Unfinished exam (server first, device copy as fallback) — the dashboard
  // uses it for the "Continue Exam" button so students resume where they left.
  const [resumeExam, setResumeExam] = useState<ExamAttemptState | null>(null);

  useEffect(() => {
    if (!currentUser || route !== 'home' || appTab !== 'dashboard') return;
    let cancelled = false;
    (async () => {
      const serverAttempt = await fetchActiveExamAttempt();
      const attempt = serverAttempt || loadLocalExamState();
      if (cancelled) return;
      setResumeExam(attempt && attempt.questions && attempt.questions.length > 0 ? attempt : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser, route, appTab]);

  const handleLogout = async () => {
    await logoutStudent();
    setCurrentUser(null);
  };

  const requireLogin = (action = 'কুইজ ও রাউন্ড শুরু করতে'): boolean => {
    if (!currentUser) {
      setAuthForcedMessage(`${action} দয়া করে আপনার ফ্রি স্টুডেন্ট অ্যাকাউন্টে সাইন ইন করুন অথবা নতুন ফ্রি অ্যাকাউন্ট খুলুন। কোনো প্রশ্ন দেখতে বা সমাধান করতে লগইন বাধ্যতামূলক।`);
      setAuthModalMode('login');
      setIsAuthModalOpen(true);
      return false;
    }
    // Email must be verified before accessing rounds, exams, or the mistake notebook.
    // (Legacy profiles without the field are treated as verified by sanitizeStudentProfile.)
    if (currentUser.emailVerified === false) {
      setAuthForcedMessage(`${action} দয়া করে প্রথমে আপনার ইমেইল ভেরিফাই করুন। ভেরিফিকেশন লিংক ইমেইলে পাঠানো হয়েছে।`);
      setAuthModalMode('verify');
      setIsAuthModalOpen(true);
      return false;
    }
    return true;
  };

  // ---- Navigation helpers (hash router) ---------------------------------
  const goHome = (tab?: AppTab) => {
    if (tab) setAppTab(tab);
    if (window.location.hash !== '#/' && window.location.hash !== '') {
      window.location.hash = '#/';
    } else {
      setRoute('home');
    }
  };

  const goToExam = (roundId?: number | null) => {
    if (!requireLogin('অফিসিয়াল পরীক্ষা শুরু করতে')) return;
    setCurrentRoundId(roundId ?? null);
    setExamRoundId(roundId ?? null);
    window.location.hash = '#/exam';
  };


  // Student Lead Registration State
  const [isLeadModalOpen, setIsLeadModalOpen] = useState(false);
  const [studentLead, setStudentLead] = useState<{ name: string; email: string; phone: string } | null>(() => {
    try {
      const saved = localStorage.getItem('patente_bangla_student_lead');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Admin session (signed token issued by /api/admin-auth, stored in sessionStorage)
  const [adminEmail, setAdminEmail] = useState<string | null>(() => getAdminEmail());
  const [isAdminLoginOpen, setIsAdminLoginOpen] = useState(false);

  // Validate the stored admin token against the server on startup
  useEffect(() => {
    const validateAdmin = async () => {
      const email = getAdminEmail();
      if (!email) return;
      try {
        const token = getAdminToken();
        if (!token) {
          clearAdminSession();
          setAdminEmail(null);
          return;
        }
        const res = await fetch('/api/admin-auth', {
          headers: { 'X-Admin-Token': token },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.valid) {
            setAdminEmail(data.email || email);
            return;
          }
        }
        if (res.status === 401 || res.status === 403) {
          clearAdminSession();
          setAdminEmail(null);
        }
      } catch {
        // Network error: keep the local session (server check happens on next load)
      }
    };
    validateAdmin();
  }, []);

  // Deferred startup work: once the app is interactive, mount the chatbot and
  // warm up the lazy chunks (exam, payment, theory, mistakes) so opening them
  // never flashes a loading spinner. First paint stays fast; the heavy data
  // chunk downloads in the background instead of blocking startup.
  const [isIdleReady, setIsIdleReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const warmup = () => {
      if (cancelled) return;
      setIsIdleReady(true);
      void Promise.all([
        import('./components/ExamPage'),
        import('./components/RoundsCurriculumView'),
        import('./components/CoursePaymentModal'),
        import('./components/CourseInvoiceModal'),
        import('./components/TheorySummaryView'),
        import('./components/MistakeReview'),
        import('./components/PatenteChatbot'),
      ]).catch(() => {});
    };
    if (w.requestIdleCallback) {
      const handle = w.requestIdleCallback(warmup, { timeout: 3000 });
      return () => {
        cancelled = true;
        w.cancelIdleCallback?.(handle);
      };
    }
    const timer = window.setTimeout(warmup, 1800);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  // Auto-detect #admin or ?admin=true
  useEffect(() => {
    const checkAdmin = () => {
      if (window.location.hash === '#admin' || window.location.hash === '#/admin' || window.location.search.includes('admin=true')) {
        if (adminEmail) {
          setAppTab('admin');
        } else {
          setIsAdminLoginOpen(true);
        }
      }
    };
    checkAdmin();
    window.addEventListener('hashchange', checkAdmin);
    return () => window.removeEventListener('hashchange', checkAdmin);
  }, [adminEmail]);

  // VIP State
  const [isVip, setIsVip] = useState<boolean>(() => {
    try {
      return localStorage.getItem('patente_bangla_is_vip') === 'true';
    } catch {
      return false;
    }
  });

  // Total questions answered count
  const [totalQuestionsAnswered, setTotalQuestionsAnswered] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('patente_bangla_answered_count');
      const val = saved ? parseInt(saved, 10) : 0;
      return Number.isFinite(val) && val >= 0 ? val : 0;
    } catch {
      return 0;
    }
  });

  // Highest unlocked round (default 1)
  const [unlockedRound, setUnlockedRound] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('patente_bangla_unlocked_round');
      const val = saved ? parseInt(saved, 10) : 1;
      return Number.isFinite(val) && val >= 1 ? val : 1;
    } catch {
      return 1;
    }
  });

  // Completed rounds history
  const [completedRounds, setCompletedRounds] = useState<Record<number, { errors: number; passed: boolean }>>(() => {
    try {
      const saved = localStorage.getItem('patente_bangla_completed_rounds');
      const val = saved ? JSON.parse(saved) : {};
      return val && typeof val === 'object' && !Array.isArray(val) ? val : {};
    } catch {
      return {};
    }
  });

  // Mistakes bank
  const [mistakeIds, setMistakeIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('patente_bangla_mistakes');
      const val = saved ? JSON.parse(saved) : [];
      return Array.isArray(val) ? val : [];
    } catch {
      return [];
    }
  });

  // Load the Better Auth session and refresh it when the tab becomes active.
  useEffect(() => {
    const unsubscribe = subscribeToAuthChanges((profile) => {
      try {
        setCurrentUser(profile ? sanitizeStudentProfile(profile) : null);
        if (profile) {
          if (profile.unlockedRound && Number.isFinite(profile.unlockedRound)) {
            setUnlockedRound((prev) => Math.max(prev || 1, profile.unlockedRound));
          }
          if (profile.totalQuestionsAnswered && Number.isFinite(profile.totalQuestionsAnswered)) {
            setTotalQuestionsAnswered((prev) => Math.max(prev || 0, profile.totalQuestionsAnswered));
          }
          if (profile.completedRounds && typeof profile.completedRounds === 'object' && !Array.isArray(profile.completedRounds)) {
            setCompletedRounds((prev) => ({ ...(prev || {}), ...profile.completedRounds }));
          }
          if (Array.isArray(profile.mistakeIds)) {
            setMistakeIds((prev) => Array.from(new Set([...(prev || []), ...profile.mistakeIds])));
          }
          if (profile.isVip) {
            setIsVip(true);
          }
        }
      } catch (err) {
        console.warn('Error in auth change handler:', err);
      }
    });

    return () => unsubscribe();
  }, []);

  // Cross-device check with MongoDB Atlas for VIP status
  useEffect(() => {
    if (currentUser?.email) {
      fetchStudentFromServerDb(currentUser.email)
        .then((remote) => {
          if (remote) {
            if (remote.isVip) {
              setIsVip(true);
              try {
                localStorage.setItem('patente_bangla_is_vip', 'true');
              } catch {}
            }
            const remoteRound = remote.unlockedRound;
            if (typeof remoteRound === 'number') {
              setUnlockedRound((prev) => (remoteRound > prev ? remoteRound : prev));
            }
          }
        })
        .catch(() => {});
    }
  }, [currentUser?.email]);

  // Persist VIP
  useEffect(() => {
    localStorage.setItem('patente_bangla_is_vip', String(isVip));
  }, [isVip]);

  // Persist answered count
  useEffect(() => {
    localStorage.setItem('patente_bangla_answered_count', String(totalQuestionsAnswered));
  }, [totalQuestionsAnswered]);

  // Effective sequential unlocked round derived strictly from passed rounds
  const effectiveUnlockedRound = getSequentialUnlockedRound(completedRounds);

  // Sync unlockedRound with real sequential progress (cleans up any previous bug data)
  useEffect(() => {
    setUnlockedRound(effectiveUnlockedRound);
    try {
      localStorage.setItem('patente_bangla_unlocked_round', String(effectiveUnlockedRound));
    } catch {}
  }, [effectiveUnlockedRound]);

  // Persist completed rounds
  useEffect(() => {
    localStorage.setItem('patente_bangla_completed_rounds', JSON.stringify(completedRounds));
  }, [completedRounds]);

  // Persist mistakes
  useEffect(() => {
    localStorage.setItem('patente_bangla_mistakes', JSON.stringify(mistakeIds));
  }, [mistakeIds]);

  // Sync student progress to Cloud Firestore / MongoDB — debounced so answering
  // questions doesn't fire a network write on every single change (jank + battery).
  // Local copies are persisted instantly by the effects above.
  useEffect(() => {
    const uid = currentUser?.uid;
    if (!uid) return;
    const progress = { unlockedRound, totalQuestionsAnswered, completedRounds, mistakeIds, isVip };
    const timer = window.setTimeout(() => {
      void syncStudentProgressToCloud(uid, progress);
    }, 4000);
    const flush = () => {
      window.clearTimeout(timer);
      void syncStudentProgressToCloud(uid, progress);
    };
    // Flush when the tab is hidden or the page is being closed/refreshed
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [unlockedRound, totalQuestionsAnswered, completedRounds, mistakeIds, isVip, currentUser?.uid]);

  const incrementAnsweredCount = (amount: number = 1) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const lastDate = localStorage.getItem('patente_last_study_date');
      const savedStreak = parseInt(localStorage.getItem('patente_study_streak') || '0', 10);
      if (lastDate !== today) {
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        if (lastDate === yesterday) {
          localStorage.setItem('patente_study_streak', String(savedStreak + 1));
        } else {
          localStorage.setItem('patente_study_streak', '1');
        }
        localStorage.setItem('patente_last_study_date', today);
      }
    } catch {}

    // Compute new total outside the state updater (no side effects inside updaters)
    const prevTotal = totalQuestionsAnswered;
    const updated = prevTotal + amount;
    const freeQuestionsLimit = appSettings.freeRoundsLimit * 30;
    if (!isVip && freeQuestionsLimit > 0 && prevTotal < freeQuestionsLimit && updated >= freeQuestionsLimit) {
      setIsPaywallOpen(true);
    }
    // Prompt registration after first 60 questions (round 2) if not registered yet
    if (!studentLead && prevTotal < 60 && updated >= 60) {
      setIsLeadModalOpen(true);
    }
    setTotalQuestionsAnswered(updated);
  };

  const handleSaveExamMistakes = (newIds: string[], finishedRoundId?: number | null) => {
    incrementAnsweredCount(30);

    setMistakeIds((prev) => {
      const set = new Set([...prev, ...newIds]);
      return Array.from(set);
    });

    const activeRoundNum = finishedRoundId || currentRoundId;

    if (activeRoundNum) {
      // Check if current round passed (<= 3 errors)
      const errorCount = newIds.length;
      const passed = errorCount <= 3;

      setCompletedRounds((prev) => ({
        ...prev,
        [activeRoundNum]: { errors: errorCount, passed }
      }));

      if (passed) {
        setUnlockedRound((prev) => Math.max(prev, activeRoundNum + 1));
        // If student passed the dynamic free round limit, prompt the €49 lifetime paywall for next round!
        if (activeRoundNum === appSettings.freeRoundsLimit && !isVip && appSettings.freeRoundsLimit < 240) {
          setTimeout(() => {
            setIsPaywallOpen(true);
          }, 1800);
        }
      }
    }
  };

  const [currentRoundId, setCurrentRoundId] = useState<number | null>(null);

  const handleStartRound = (roundId: number) => {
    // Strict authentication gate: nobody can access questions without login
    if (!requireLogin('রাউন্ড শুরু করতে')) {
      return;
    }
    // If round is not free (round > dynamic freeRoundsLimit) and user is not VIP, show paywall!
    if (roundId > appSettings.freeRoundsLimit && !isVip) {
      setIsPaywallOpen(true);
      return;
    }
    // Sequential locking only applies to non-VIP students:
    // VIP students (who paid or were granted the 240 Free VIP pass) can practice ANY round from 1 to 240!
    if (!isVip && roundId > effectiveUnlockedRound) {
      alert(`🔒 রাউন্ড #${roundId} এখনও লক করা। দয়া করে প্রথমে পূর্ববর্তী রাউন্ড #${roundId - 1} সফলভাবে পাস করুন (সর্বোচ্চ ৩টি ভুল)।`);
      return;
    }
    // Open the dedicated exam page for this round
    trackViewContent(`Round #${roundId}`, roundId <= appSettings.freeRoundsLimit ? 'Free Quiz Round' : 'Pro Round');
    goToExam(roundId);
  };

  const handleSelectTab = (tab: NavTab) => {
    if (['exam', 'hotshot', 'topics', 'mistakes'].includes(tab)) {
      if (!requireLogin('কুইজ ও পরীক্ষা শুরু করতে')) {
        return;
      }
    }
    if (tab === 'exam' || tab === 'hotshot') {
      goToExam(null);
    } else if (tab === 'rounds') {
      goHome('curriculum');
    } else if (tab === 'topics' || tab === 'vocab') {
      goHome('theory');
    } else if (tab === 'mistakes') {
      goHome('errors');
    } else if (tab === 'admin') {
      goHome();
      setAppTab('admin');
    }
  };

  const handlePaymentSuccess = (invoice: InvoiceRecord) => {
    setIsVip(true);
    try {
      localStorage.setItem('patente_bangla_is_vip', 'true');
    } catch {}
    // DO NOT force jump to round 240! Maintain student's legitimate sequential progress
    setUnlockedRound(effectiveUnlockedRound);
    try {
      localStorage.setItem('patente_bangla_unlocked_round', String(effectiveUnlockedRound));
    } catch {}
    setActiveInvoice(invoice);
    setIsPaymentModalOpen(false);
    setIsInvoiceModalOpen(true);
    trackPurchase(invoice?.amount || appSettings.academyPriceEur || 49, 'EUR', 'Patente Bangla Pro Pass - 240 Rounds');

    if (currentUser?.uid) {
      syncStudentProgressToCloud(currentUser.uid, {
        isVip: true,
        unlockedRound: effectiveUnlockedRound,
      });
    }

    try {
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 },
      });
    } catch {}
  };

  // Auto-detect and handle Stripe Checkout return (?payment_success=true&session_id=...)
  useEffect(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const isSuccess = urlParams.get('payment_success') === 'true';
      const sessionId = urlParams.get('session_id');

      if (isSuccess && sessionId) {
        // Clean URL query parameters smoothly
        const cleanUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, document.title, cleanUrl);

        // Verify session status with Stripe backend
        fetch(`/api/verify-payment?session_id=${encodeURIComponent(sessionId)}`)
          .then((res) => {
            const ct = res.headers.get('content-type') || '';
            if (res.ok && ct.includes('application/json')) {
              return res.json();
            }
            return null;
          })
          .then((data) => {
            if (data?.success && data?.paid && data?.invoice) {
              handlePaymentSuccess(data.invoice);
            }
          })
          .catch((err) => {
            console.warn('Stripe payment verification notice:', err);
          });
      }
    } catch {}
  }, []);

  // Better Auth redirects here after confirming the email address.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('emailVerified') !== 'true') return;

      // Remove the verification marker so refreshing does not reopen the modal.
      const cleanUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({}, document.title, cleanUrl);

      (async () => {
        const { verified, profile } = await refreshEmailVerification();
        if (verified && profile) {
          const safe = sanitizeStudentProfile(profile);
          setCurrentUser(safe);
          try {
            localStorage.setItem('patente_student_user', JSON.stringify(safe));
          } catch {}
        }
        trackWhatsAppJoin('email_verification_success');
        window.location.replace(WHATSAPP_GROUP_URL);
      })().catch((err) => {
        console.warn('Email verification link error:', err);
        trackWhatsAppJoin('email_verification_success');
        window.location.replace(WHATSAPP_GROUP_URL);
      });
    } catch {}
  }, []);

  // Return OAuth account-linking failures to the auth modal with actionable
  // guidance instead of leaving the user on Better Auth's raw error URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get('error');
    if (!authError) return;

    const accountLinkMessages: Record<string, string> = {
      unable_to_link_account:
        'এই ইমেইলে আগে থেকেই অ্যাকাউন্ট আছে, কিন্তু সেটি ভেরিফাই করা নেই অথবা সার্ভারের Google account-linking সেটিং আপডেট হয়নি। আগে ইমেইল ও পাসওয়ার্ড দিয়ে সাইন ইন করে ইমেইল ভেরিফাই করুন, তারপর Google দিয়ে আবার চেষ্টা করুন।',
      account_already_linked_to_different_user:
        'এই Google অ্যাকাউন্টটি অন্য একটি স্টুডেন্ট প্রোফাইলে যুক্ত আছে। সঠিক Google অ্যাকাউন্ট ব্যবহার করুন অথবা সাপোর্টে যোগাযোগ করুন।',
      email_does_not_match:
        'আপনার Google অ্যাকাউন্টের ইমেইলটি বিদ্যমান স্টুডেন্ট অ্যাকাউন্টের ইমেইলের সঙ্গে মেলেনি। একই ইমেইল ব্যবহার করে আবার চেষ্টা করুন।',
    };
    const message = accountLinkMessages[authError];
    if (!message) return;

    const cleanUrl = window.location.pathname + window.location.hash;
    window.history.replaceState({}, document.title, cleanUrl);
    setAuthForcedMessage(message);
    setAuthModalMode('login');
    setIsAuthModalOpen(true);
  }, []);

  const handleOpenInvoice = () => {
    let inv = activeInvoice || getLatestInvoice(currentUser?.email);
    if (!inv) {
      inv = createInvoiceRecord({
        studentName: currentUser?.name || studentLead?.name || 'Studente Ufficiale Patente B',
        studentEmail: currentUser?.email || studentLead?.email || 'khshifat@gmail.com',
        studentPhone: studentLead?.phone || '+39 351 000 0000',
        codiceFiscale: 'REGOLARE',
        address: 'Italia',
        city: 'Bolzano',
        paymentMethod: 'card',
      });
      saveInvoice(inv);
      setActiveInvoice(inv);
    }
    setIsInvoiceModalOpen(true);
  };

  return (
    <div
      className={`min-h-screen flex flex-col transition-colors duration-300 font-sans relative overflow-x-hidden ${
        currentTheme === 'sepia'
          ? 'theme-sepia bg-[#F5EEDB] text-[#2F1B0B] selection:bg-[#B45309] selection:text-white'
          : currentTheme === 'dark'
          ? 'dark bg-[#0D1117] text-[#F8FAFC] selection:bg-[#E52E2D] selection:text-white'
          : 'theme-light bg-[#F8FAFC] text-slate-900 selection:bg-[#FB6C00] selection:text-white'
      }`}
    >
      {/* Theme ambient accents are painted by the html/body background gradients.
          The old fixed + filter:blur() blobs here were fully hidden behind this
          wrapper's opaque background anyway, while adding 7 composited layers
          that made scrolling janky. */}

      {/* Navigation Header */}
      <Header
        totalQuestionsAnswered={totalQuestionsAnswered}
        isVip={isVip}
        freeRoundsLimit={appSettings.freeRoundsLimit}
        academyPriceEur={appSettings.academyPriceEur}
        regularPriceEur={appSettings.regularPriceEur}
        onOpenPaywall={() => setIsPaymentModalOpen(true)}
        onOpenAbout={() => setIsAboutOpen(true)}
        currentTheme={currentTheme}
        onThemeChange={handleThemeChange}
        currentUser={currentUser}
        onOpenAuth={() => {
          setAuthForcedMessage('');
          setAuthModalMode(currentUser?.emailVerified === false ? 'verify' : 'login');
          setIsAuthModalOpen(true);
        }}
        onLogout={handleLogout}
        onOpenAdmin={() => {
          if (adminEmail) {
            goHome();
            setAppTab('admin');
          } else {
            setIsAdminLoginOpen(true);
          }
        }}
        onOpenInvoice={handleOpenInvoice}
        onGoToCurriculum={() => setAppTab('curriculum')}
        onOpenStudentProfile={() => setIsStudentProfileOpen(true)}
      />

      {/* Floating Theme Switch Feedback Toast */}
      {themeToast && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[100] animate-fadeIn pointer-events-none">
          <div className="flex items-center gap-3 px-5 py-2.5 rounded-full bg-slate-900/95 dark:bg-white/95 text-white dark:text-slate-950 shadow-2xl backdrop-blur-md border border-white/20 dark:border-slate-800 text-xs font-bold transition-all transform scale-100">
            <span className="text-lg shrink-0">{themeToast.icon}</span>
            <div className="text-left">
              <div className="font-black text-xs leading-tight tracking-wide">{themeToast.message}</div>
              <div className="text-[10.5px] opacity-80 mt-0.5 leading-tight">{themeToast.subtext}</div>
            </div>
          </div>
        </div>
      )}

      {/* 5-Tab Educational Navigation */}
      <AppNavigation
        currentTab={
          route === 'exam'
            ? 'exam'
            : appTab === 'admin' || appTab === 'enrollment'
            ? 'dashboard'
            : appTab
        }
        onTabChange={(tab) => {
          if (['exam', 'errors'].includes(tab)) {
            if (!requireLogin('অফিসিয়াল পরীক্ষা শুরু করতে')) return;
          }
          if (tab === 'exam') {
            goToExam(null);
            return;
          }
          goHome(tab);
        }}
        errorCount={mistakeIds.length}
        activeRound={unlockedRound}
      />

      {/* Main Content */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-[15px] pt-4 sm:pt-6 pb-28 sm:pb-24 md:pb-12">
        {/* Unauthenticated Student Welcome Banner */}
        {route === 'home' && !currentUser && (
          <div className="mb-4 p-3 sm:px-4 sm:py-3 rounded-2xl bg-white dark:bg-[#12161F] border border-slate-200 dark:border-white/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 sm:gap-4 shadow-sm">
            <div className="space-y-1">
              <span className="inline-block text-[9px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-white/10 px-2 py-0.5 rounded-full border border-slate-200 dark:border-white/15">
                🔒 Free Student Sign-In
              </span>
              <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                {appSettings.freeRoundsLimit === 0
                  ? 'Official Academy Curriculum • 240 Rounds'
                  : appSettings.freeRoundsLimit >= 240
                  ? 'Open Curriculum (Rounds 1–240) • 7,165 Questions Free'
                  : `Foundation Assessment (Rounds 1–${appSettings.freeRoundsLimit}) • ${appSettings.freeRoundsLimit * 30} Questions Free`}
              </h4>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                Sign in to track your progress, practice with oral exam audio, and unlock your free rounds.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setAuthForcedMessage(
                  appSettings.freeRoundsLimit === 0
                    ? 'কুইজ ও রাউন্ড শুরু করতে অনুগ্রহ করে সাইন ইন বা ফ্রি রেজিস্টার করুন।'
                    : `${appSettings.freeRoundsLimit}টি ফ্রি রাউন্ড শুরু করতে অনুগ্রহ করে সাইন ইন বা ফ্রি রেজিস্টার করুন।`
                );
                setAuthModalMode('login');
                setIsAuthModalOpen(true);
              }}
              className="px-4 py-2 rounded-full bg-gradient-to-r from-[#E52E2D] to-[#FB6C00] hover:from-[#d02524] hover:to-[#e55e00] text-white font-black text-[11px] shrink-0 cursor-pointer shadow-md shadow-[#FB6C00]/25 transition active:scale-95 self-stretch sm:self-auto"
            >
              Sign In / Register Free
            </button>
          </div>
        )}

        {/* Email Verification Required Banner (signed in, but email not verified yet) */}
        {route === 'home' && currentUser && currentUser.emailVerified === false && (
          <div className="mb-6 p-4 sm:p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300/80 dark:border-amber-700/50 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left shadow-sm">
            <div className="space-y-1">
              <span className="inline-block text-[10px] font-black uppercase tracking-wider text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 px-2.5 py-0.5 rounded-full border border-amber-300 dark:border-amber-700">
                📧 Email Verification Pending
              </span>
              <h4 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                {currentUser.email ? `${currentUser.email} ঠিকানাটি ভেরিফাই করুন` : 'আপনার ইমেইল ভেরিফাই করুন'}
              </h4>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                রাউন্ড, পরীক্ষা ও ভুলের খাতা ব্যবহারের আগে ইমেইল ভেরিফিকেশন বাধ্যতামূলক। ইনবক্স এবং Spam ফোল্ডার চেক করুন।
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setAuthForcedMessage('ইমেইল ভেরিফিকেশন সম্পন্ন করতে নিচের ধাপগুলো অনুসরণ করুন।');
                setAuthModalMode('verify');
                setIsAuthModalOpen(true);
              }}
              className="px-5 py-2.5 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-black text-xs shrink-0 cursor-pointer shadow-md shadow-amber-500/25 transition active:scale-95"
            >
              Verify Email Now
            </button>
          </div>
        )}

        <Suspense fallback={
          <div className="flex flex-col items-center justify-center min-h-[350px] p-8 text-center space-y-4">
            <div className="w-12 h-12 border-4 border-[#FB6C00] border-t-transparent rounded-full animate-spin" />
            <div className="space-y-1">
              <p className="text-sm font-black text-slate-900 dark:text-white">লোড হচ্ছে...</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Patente Guru উপাদান প্রস্তুত হচ্ছে</p>
            </div>
          </div>
        }>
          {/* Dedicated exam page (route: #/exam) */}
          {route === 'exam' && (
            <ExamPage
              roundId={examRoundId}
              currentUser={currentUser}
              isVip={isVip}
              academyPriceEur={appSettings.academyPriceEur}
              onRequireLogin={(action) => {
                if (currentUser?.emailVerified === false) {
                  setAuthForcedMessage('পরীক্ষা শুরু করতে দয়া করে প্রথমে আপনার ইমেইল ভেরিফাই করুন।');
                  setAuthModalMode('verify');
                  setIsAuthModalOpen(true);
                  return;
                }
                setAuthForcedMessage(
                  action
                    ? `${action} দয়া করে আপনার ফ্রি স্টুডেন্ট অ্যাকাউন্টে সাইন ইন করুন অথবা নতুন ফ্রি অ্যাকাউন্ট খুলুন।`
                    : 'পরীক্ষা শুরু করতে দয়া করে সাইন ইন করুন।'
                );
                setAuthModalMode('login');
                setIsAuthModalOpen(true);
              }}
              onOpenPayment={() => setIsPaymentModalOpen(true)}
              onSaveMistakes={handleSaveExamMistakes}
              onGoToTopics={() => goHome('theory')}
              onBackToRounds={() => goHome('curriculum')}
              onSelectRound={handleStartRound}
              onGoHome={() => goHome('dashboard')}
              onExamRunningChange={setIsExamRunning}
            />
          )}

          {route === 'home' && appTab === 'dashboard' && (
            <StudentDashboardView
              student={currentUser}
              activeRound={effectiveUnlockedRound}
              completedRoundsCount={Object.values(completedRounds || {}).filter(r => r?.passed).length}
              totalQuestionsSolved={totalQuestionsAnswered}
              errorCount={mistakeIds.length}
              isVip={isVip}
              freeRoundsLimit={appSettings.freeRoundsLimit}
              academyPriceEur={appSettings.academyPriceEur}
              onContinueRound={(r) => handleStartRound(r)}
              resumeExam={
                resumeExam
                  ? {
                      type: resumeExam.type,
                      roundId: resumeExam.roundId ?? null,
                      currentIdx: resumeExam.currentIdx || 0,
                      total: resumeExam.questions.length,
                    }
                  : null
              }
              onContinueExam={() => goToExam(resumeExam?.roundId ?? null)}
        onGoToCurriculum={() => goHome('curriculum')}
              onGoToTheory={() => setAppTab('theory')}
              onGoToExam={() => goToExam(null)}
              onGoToErrors={() => {
                if (!requireLogin('ভুলের খাতা দেখতে')) return;
                setAppTab('errors');
              }}
              onOpenEnrollment={() => setIsPaymentModalOpen(true)}
            />
          )}

          {route === 'home' && appTab === 'curriculum' && (
            <RoundsCurriculumView
              currentRoundId={effectiveUnlockedRound}
              unlockedRound={effectiveUnlockedRound}
              isVip={isVip}
              freeRoundsLimit={appSettings.freeRoundsLimit}
              academyPriceEur={appSettings.academyPriceEur}
              regularPriceEur={appSettings.regularPriceEur}
              onSelectRound={handleStartRound}
              onTriggerEnrollment={(_r) => setIsPaymentModalOpen(true)}
              completedRounds={completedRounds}
            />
          )}

          {route === 'home' && appTab === 'theory' && (
            <TheorySummaryView
              onStartRound={handleStartRound}
              isVip={isVip}
              academyPriceEur={appSettings.academyPriceEur}
              regularPriceEur={appSettings.regularPriceEur}
              onOpenEnrollment={() => setIsPaymentModalOpen(true)}
              onOpenExamSim={() => goToExam(null)}
            />
          )}

          {/* Exam now lives on its own route: {route === 'exam' && <ExamPage ... />} */}

          {route === 'home' && appTab === 'errors' && (
            <MistakeReview
              mistakeIds={mistakeIds}
              onClearMistakes={() => setMistakeIds([])}
              onRemoveMistake={(id) => setMistakeIds((prev) => prev.filter((item) => item !== id))}
              onGoToTopics={() => setAppTab('theory')}
            />
          )}

          {route === 'home' && appTab === 'admin' && (
            adminEmail ? (
              <AdminCrmDashboard
                adminEmail={adminEmail}
                onExitAdmin={() => {
                  clearAdminSession();
                  setAdminEmail(null);
                  setAppTab('dashboard');
                }}
              />
            ) : (
              <div className="max-w-md mx-auto my-12 p-8 bg-white dark:bg-[#12161F] rounded-3xl border border-slate-200 dark:border-white/10 shadow-xl text-center space-y-5">
                <div className="w-16 h-16 rounded-2xl bg-[#FB6C00]/10 border border-[#FB6C00]/20 text-[#FB6C00] flex items-center justify-center mx-auto text-3xl">
                  🔒
                </div>
                <div className="space-y-1">
                  <h3 className="text-xl font-black text-slate-900 dark:text-white">Admin CRM & Control Panel</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Access restricted to authorized owners (khshifat@gmail.com / khshifatmanjum@gmail.com).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAdminLoginOpen(true)}
                  className="w-full py-3 rounded-xl bg-[#FB6C00] hover:bg-[#e05f00] text-white font-black text-sm shadow-lg shadow-[#FB6C00]/25 transition cursor-pointer"
                >
                  Log In as Admin
                </button>
              </div>
            )
          )}

          {route === 'home' && appTab === 'enrollment' && (
            <AcademyEnrollmentPage
              onBack={() => setAppTab('dashboard')}
              onOpenPayment={() => setIsPaymentModalOpen(true)}
              attemptedRound={unlockedRound > 20 ? unlockedRound : 21}
              academyPriceEur={appSettings.academyPriceEur}
              regularPriceEur={appSettings.regularPriceEur}
            />
          )}
        </Suspense>
      </main>

      {/* Mandatory Student Auth Modal */}
      <StudentAuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onLoginSuccess={(user) => {
          const safe = sanitizeStudentProfile(user);
          setCurrentUser(safe);
        }}
        forcedMessage={authForcedMessage}
        initialMode={authModalMode}
      />

      {/* Official Driving Academy Enrollment Modal */}
      <EnrollmentModal
        isOpen={isPaywallOpen}
        onClose={() => setIsPaywallOpen(false)}
        onContinueFree={() => setIsPaywallOpen(false)}
        onViewFullPage={() => {
          setIsPaywallOpen(false);
          goHome();
          setAppTab('enrollment');
        }}
        onOpenPayment={() => {
          setIsPaywallOpen(false);
          setIsPaymentModalOpen(true);
        }}
        attemptedRound={unlockedRound > appSettings.freeRoundsLimit ? unlockedRound : appSettings.freeRoundsLimit + 1}
        academyPriceEur={appSettings.academyPriceEur}
        regularPriceEur={appSettings.regularPriceEur}
        freeRoundsLimit={appSettings.freeRoundsLimit}
      />

      <Suspense fallback={null}>
        {/* Student Personal Profile & Data Modal */}
        <StudentProfileModal
          isOpen={isStudentProfileOpen}
          onClose={() => setIsStudentProfileOpen(false)}
          student={currentUser}
          isVip={isVip}
          onLogout={handleLogout}
          onOpenInvoice={handleOpenInvoice}
          onUpdateProfile={(updated) => {
            const safe = sanitizeStudentProfile(updated);
            setCurrentUser(safe);
            try {
              localStorage.setItem('patente_student_user', JSON.stringify(safe));
            } catch {}
          }}
        />

        {/* Direct Online Payment Checkout Modal */}
        <CoursePaymentModal
          isOpen={isPaymentModalOpen}
          onClose={() => setIsPaymentModalOpen(false)}
          onSuccess={handlePaymentSuccess}
          academyPriceEur={appSettings.academyPriceEur}
          regularPriceEur={appSettings.regularPriceEur}
          initialStudent={
            currentUser
              ? {
                  name: currentUser.name,
                  email: currentUser.email,
                }
              : studentLead
              ? {
                  name: studentLead.name,
                  email: studentLead.email,
                  phone: studentLead.phone,
                }
              : null
          }
          attemptedRound={unlockedRound > 20 ? unlockedRound : 21}
        />

        {/* Official Tax Invoice & Payment Receipt Modal (Printable/Downloadable PDF) */}
        <CourseInvoiceModal
          isOpen={isInvoiceModalOpen}
          onClose={() => setIsInvoiceModalOpen(false)}
          invoice={activeInvoice}
          onStartCourse={() => {
            setIsInvoiceModalOpen(false);
            goHome('curriculum');
          }}
        />

        {/* Student Lead Registration Modal */}
        <StudentLeadModal
          isOpen={isLeadModalOpen}
          onClose={() => setIsLeadModalOpen(false)}
          onSaveLead={(data) => {
            try {
              localStorage.setItem('patente_bangla_student_lead', JSON.stringify(data));
            } catch {}
            setStudentLead(data);
          }}
        />

        {/* About Us Modal (Shifat Manjum & Zentixx Story) */}
        <AboutModal
          isOpen={isAboutOpen}
          onClose={() => setIsAboutOpen(false)}
        />

        {/* Floating 24/7 AI Maestro Tutor Chatbot (mounted after first paint) */}
        {isIdleReady && (
          <PatenteChatbot
            currentTheme={currentTheme}
            currentUser={currentUser}
            isExamRunning={isExamRunning}
            onOpenPaywall={() => setIsPaymentModalOpen(true)}
          />
        )}

        {/* Admin Login Gate Modal */}
        <AdminLoginModal
          isOpen={isAdminLoginOpen}
          onClose={() => setIsAdminLoginOpen(false)}
          onAdminLoginSuccess={(email) => {
            setAdminEmail(email);
            setIsAdminLoginOpen(false);
            goHome();
            setAppTab('admin');
          }}
        />
      </Suspense>

      {/* Mobile Sticky Floating Pay Now Bar (hidden on the exam page so it never overlaps the exam controls) */}
      {route === 'home' && (
      <div className="md:hidden fixed bottom-[74px] sm:bottom-[78px] left-3 right-3 z-30 animate-fadeIn pointer-events-auto">
        <button
          type="button"
          onClick={() => {
            if (isVip) {
              handleOpenInvoice();
            } else {
              setIsPaymentModalOpen(true);
            }
          }}
          className="w-full py-2.5 px-4 rounded-2xl bg-gradient-to-r from-[#E52E2D] via-[#FB6C00] to-[#E52E2D] text-white font-black text-xs shadow-2xl shadow-[#FB6C00]/40 flex items-center justify-between border border-white/25 active:scale-95 transition cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping shrink-0" />
            <span className="truncate">
              {isVip
                ? '⭐ VIP সক্রিয় • অফিসিয়াল রসিদ দেখুন'
                : `🔥 ২৪০টি রাউন্ডের সম্পূর্ণ কোর্স আনলক (€${appSettings.academyPriceEur || 49})`}
            </span>
          </div>
          <span className="px-3 py-1 rounded-full bg-white text-slate-950 text-[11px] font-black shrink-0 shadow-sm ml-2">
            {isVip ? 'রসিদ' : '💳 Pay Now'}
          </span>
        </button>
      </div>
      )}

      {/* Footer */}
      <Footer
        setActiveTab={handleSelectTab}
        onOpenAbout={() => setIsAboutOpen(true)}
        onOpenAdmin={() => {
          if (adminEmail) {
            goHome();
            setAppTab('admin');
          } else {
            setIsAdminLoginOpen(true);
          }
        }}
      />
    </div>
  );
}

export default App;
