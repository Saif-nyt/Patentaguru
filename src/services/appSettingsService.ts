// Dynamic Application Policy & Marketing Settings Service
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../lib/firebase';
import { adminHeaders } from '../utils/adminSession';

export interface AppSettings {
  freeRoundsLimit: number; // e.g. 0 (all paid), 5, 10, 20 (standard), 240 (all free)
  academyPriceEur: number; // e.g. 49
  regularPriceEur?: number; // e.g. 120 (regular price before discount)
  promoBannerText?: string;
  isPromoActive?: boolean;
  lastUpdated?: string;
}

const SETTINGS_STORAGE_KEY = 'patente_app_settings';
export const SETTINGS_CHANGE_EVENT = 'patente_settings_changed';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  freeRoundsLimit: 20,
  academyPriceEur: 49,
  regularPriceEur: 120,
  promoBannerText: 'অফিসিয়াল ইতালিয়ান লাইসেন্স প্রস্তুতি • প্রথম প্রচেষ্টায় পাশের গ্যারান্টি',
  isPromoActive: false,
};

/**
 * Returns current application settings synchronously from local storage with fallback
 */
export const getAppSettings = (): AppSettings => {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        return {
          ...DEFAULT_APP_SETTINGS,
          ...parsed,
          freeRoundsLimit: Number.isFinite(parsed.freeRoundsLimit) && parsed.freeRoundsLimit >= 0
            ? Math.min(240, Math.max(0, parsed.freeRoundsLimit))
            : DEFAULT_APP_SETTINGS.freeRoundsLimit,
          academyPriceEur: Number.isFinite(parsed.academyPriceEur) && parsed.academyPriceEur > 0
            ? parsed.academyPriceEur
            : DEFAULT_APP_SETTINGS.academyPriceEur,
          regularPriceEur: Number.isFinite(parsed.regularPriceEur) && parsed.regularPriceEur > 0
            ? parsed.regularPriceEur
            : DEFAULT_APP_SETTINGS.regularPriceEur,
        };
      }
    }
  } catch {}

  // Fallback to legacy single key if present
  try {
    const legacyLimit = localStorage.getItem('patente_free_rounds_limit');
    if (legacyLimit !== null) {
      const num = parseInt(legacyLimit, 10);
      if (Number.isFinite(num) && num >= 0) {
        return {
          ...DEFAULT_APP_SETTINGS,
          freeRoundsLimit: Math.min(240, Math.max(0, num)),
        };
      }
    }
  } catch {}

  return DEFAULT_APP_SETTINGS;
};

/**
 * Save settings locally, dispatch real-time UI event, and sync to Cloud & Server
 */
export const saveAppSettings = async (newSettings: Partial<AppSettings>): Promise<AppSettings> => {
  const current = getAppSettings();
  const merged: AppSettings = {
    ...current,
    ...newSettings,
    lastUpdated: new Date().toISOString(),
  };

  // 1. Save to LocalStorage immediately
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged));
    localStorage.setItem('patente_free_rounds_limit', String(merged.freeRoundsLimit));
  } catch (err) {
    console.warn('LocalStorage save error:', err);
  }

  // 2. Dispatch real-time event so all components across the app update immediately (0ms)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SETTINGS_CHANGE_EVENT, { detail: merged }));
  }

  // 3. Non-blocking network sync with a strict 2-second timeout (guarantees UI NEVER hangs)
  const syncPromises: Promise<any>[] = [];

  // Sync to MongoDB serverless API (/api/settings) — server only accepts
  // writes that carry a valid admin session token.
  if (typeof window !== 'undefined') {
    const apiPromise = fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify(merged),
    }).catch((err) => {
      console.warn('Server API settings sync notice:', err);
    });
    syncPromises.push(apiPromise);
  }

  // Sync to Cloud Firestore if connected
  if (isFirebaseConfigured && db) {
    try {
      const settingsRef = doc(db, 'settings', 'general');
      const firestorePromise = setDoc(settingsRef, merged, { merge: true }).catch((err) => {
        console.warn('Firestore settings sync notice:', err);
      });
      syncPromises.push(firestorePromise);
    } catch (err) {
      console.warn('Firestore ref error:', err);
    }
  }

  // Wait max 1.8 seconds for network sync, then return immediately
  const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 1800));
  await Promise.race([Promise.allSettled(syncPromises), timeoutPromise]);

  return merged;
};

/**
 * Fetch latest settings with smart timestamp conflict resolution
 * (Prevents older remote data from overwriting freshly changed local settings)
 */
export const fetchRemoteAppSettings = async (): Promise<AppSettings> => {
  const local = getAppSettings();
  const localTime = local.lastUpdated ? new Date(local.lastUpdated).getTime() : 0;

  let remoteSettings: AppSettings | null = null;

  // 1. Try Server API (MongoDB Atlas) first with 2.5-second timeout
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch('/api/settings', { signal: controller.signal });
    clearTimeout(timer);
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      if (data && (typeof data.freeRoundsLimit === 'number' || typeof data.academyPriceEur === 'number')) {
        remoteSettings = data;
      }
    }
  } catch (err) {
    console.warn('Settings API fetch notice:', err);
  }

  // 2. Try Firestore if no server settings (with 2.5s race timeout)
  if (!remoteSettings && isFirebaseConfigured && db) {
    try {
      const firestorePromise = getDoc(doc(db, 'settings', 'general'));
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore timeout')), 2500)
      );
      const snap = await Promise.race([firestorePromise, timeoutPromise]);
      if (snap && snap.exists()) {
        const data = snap.data() as AppSettings;
        if (data && (typeof data.freeRoundsLimit === 'number' || typeof data.academyPriceEur === 'number')) {
          remoteSettings = data;
        }
      }
    } catch {}
  }

  // 3. Smart Conflict Resolution based on timestamps
  if (remoteSettings) {
    const remoteTime = remoteSettings.lastUpdated ? new Date(remoteSettings.lastUpdated).getTime() : 0;

    // Only adopt remote if it is genuinely NEWER than local
    if (remoteTime > localTime) {
      const merged: AppSettings = {
        ...local,
        ...remoteSettings,
        freeRoundsLimit: typeof remoteSettings.freeRoundsLimit === 'number' && remoteSettings.freeRoundsLimit >= 0
          ? Math.min(240, Math.max(0, remoteSettings.freeRoundsLimit))
          : local.freeRoundsLimit,
        academyPriceEur: typeof remoteSettings.academyPriceEur === 'number' && remoteSettings.academyPriceEur > 0
          ? remoteSettings.academyPriceEur
          : local.academyPriceEur,
        regularPriceEur: typeof remoteSettings.regularPriceEur === 'number' && remoteSettings.regularPriceEur > 0
          ? remoteSettings.regularPriceEur
          : local.regularPriceEur,
      };
      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged));
        localStorage.setItem('patente_free_rounds_limit', String(merged.freeRoundsLimit));
      } catch {}
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(SETTINGS_CHANGE_EVENT, { detail: merged }));
      }
      return merged;
    } else if (localTime > remoteTime && localTime > 0) {
      // Local has newer changes that were not yet synced to remote -> push local to remote in background
      saveAppSettings(local).catch(() => {});
      return local;
    }
  }

  return local;
};

