import { authClient } from "../lib/auth-client";
import { studentAuthHeaders } from "./authToken";

export interface StudentProfile {
  uid: string;
  name: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  unlockedRound: number;
  totalQuestionsAnswered: number;
  completedRounds: Record<number, { errors: number; passed: boolean }>;
  mistakeIds: string[];
  isVip: boolean;
  emailVerified?: boolean;
  createdAt?: any;
  lastLoginAt?: any;
}

const LOCAL_STORAGE_KEY = "patente_student_user";
const LOCAL_STUDENTS_LIST_KEY = "patente_registered_students";

export const sanitizeStudentProfile = (raw: any): StudentProfile => {
  if (!raw || typeof raw !== "object") {
    return {
      uid: `std_${Date.now()}`,
      name: "Student",
      email: "",
      unlockedRound: 1,
      totalQuestionsAnswered: 0,
      completedRounds: {},
      mistakeIds: [],
      isVip: false,
      emailVerified: true,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };
  }

  const email = (typeof raw.email === "string" ? raw.email : "").trim().toLowerCase();
  const name =
    (typeof raw.name === "string" && raw.name.trim()) ||
    (typeof raw.displayName === "string" && raw.displayName.trim()) ||
    (email ? email.split("@")[0] : "Student");

  return {
    uid: String(raw.uid || raw.id || `std_${Date.now()}`),
    name,
    email,
    phone: typeof raw.phone === "string" ? raw.phone : "",
    address: typeof raw.address === "string" ? raw.address : "",
    city: typeof raw.city === "string" ? raw.city : "",
    unlockedRound: Number.isFinite(raw.unlockedRound) ? Math.max(1, raw.unlockedRound) : 1,
    totalQuestionsAnswered: Number.isFinite(raw.totalQuestionsAnswered)
      ? Math.max(0, raw.totalQuestionsAnswered)
      : 0,
    completedRounds:
      raw.completedRounds && typeof raw.completedRounds === "object" && !Array.isArray(raw.completedRounds)
        ? raw.completedRounds
        : {},
    mistakeIds: Array.isArray(raw.mistakeIds) ? raw.mistakeIds : [],
    isVip: Boolean(raw.isVip),
    emailVerified: raw.emailVerified == null ? true : Boolean(raw.emailVerified),
    createdAt: raw.createdAt || new Date().toISOString(),
    lastLoginAt: raw.lastLoginAt || new Date().toISOString(),
  };
};

const profileFromAuthUser = (user: {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  phone?: string | null;
}): StudentProfile =>
  sanitizeStudentProfile({
    uid: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone || "",
    emailVerified: user.emailVerified,
  });

export const syncStudentToServerDb = async (student: StudentProfile): Promise<boolean> => {
  try {
    const headers = await studentAuthHeaders();
    const res = await fetch("/api/students", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(student),
    });
    if (!res.ok) {
      console.warn("Student profile sync failed:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.warn("Student profile sync failed:", err);
    return false;
  }
};

export const fetchStudentFromServerDb = async (email: string): Promise<Partial<StudentProfile> | null> => {
  if (!email) return null;
  try {
    const cleanEmail = email.trim().toLowerCase();
    const headers = await studentAuthHeaders();
    const res = await fetch(`/api/students?email=${encodeURIComponent(cleanEmail)}`, { headers });
    if (res.status === 404) return null;
    if (!res.ok) {
      console.warn("Student profile fetch failed:", res.status, await res.text());
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn("Student profile fetch failed:", err);
    return null;
  }
};

export const getCachedStudent = (): StudentProfile | null => {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? sanitizeStudentProfile(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

const saveCachedStudent = (profile: StudentProfile): void => {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(profile));
    const registered: StudentProfile[] = JSON.parse(localStorage.getItem(LOCAL_STUDENTS_LIST_KEY) || "[]");
    const remaining = registered.filter((student) => student.email?.toLowerCase() !== profile.email);
    remaining.unshift(profile);
    localStorage.setItem(LOCAL_STUDENTS_LIST_KEY, JSON.stringify(remaining));
  } catch (err) {
    console.warn("Could not cache student profile:", err);
  }
};

const callbackURL = (): string =>
  typeof window === "undefined" ? "/" : `${window.location.origin}/?emailVerified=true`;
const homeURL = (): string => (typeof window === "undefined" ? "/" : window.location.origin);

export const registerStudent = async (
  name: string,
  email: string,
  phone: string,
  password: string
): Promise<StudentProfile> => {
  const cleanEmail = email.trim().toLowerCase();
  const result = await authClient.signUp.email({
    name: name.trim(),
    email: cleanEmail,
    phone: phone.trim(),
    password,
    callbackURL: callbackURL(),
  });
  if (result.error) throw result.error;
  if (!result.data?.user) throw new Error("Account registration did not return a user.");

  const profile = profileFromAuthUser(result.data.user);
  profile.emailVerified = false;
  saveCachedStudent(profile);
  return profile;
};

export const loginStudent = async (email: string, password: string): Promise<StudentProfile> => {
  const result = await authClient.signIn.email({
    email: email.trim().toLowerCase(),
    password,
    callbackURL: homeURL(),
  });
  if (result.error) throw result.error;
  if (!result.data?.user) throw new Error("Sign-in did not return a user.");

  const sessionProfile = profileFromAuthUser(result.data.user);
  const remote = await fetchStudentFromServerDb(sessionProfile.email);
  const profile = sanitizeStudentProfile({
    ...sessionProfile,
    ...remote,
    uid: sessionProfile.uid,
    email: sessionProfile.email,
    emailVerified: sessionProfile.emailVerified,
    lastLoginAt: new Date().toISOString(),
  });
  saveCachedStudent(profile);
  await syncStudentToServerDb(profile);
  return profile;
};

export const loginStudentWithGoogle = async (): Promise<void> => {
  const result = await authClient.signIn.social({
    provider: "google",
    callbackURL: homeURL(),
  });
  if (result.error) throw result.error;
};

export const logoutStudent = async (): Promise<void> => {
  const result = await authClient.signOut();
  if (result.error) throw result.error;
  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  } catch (err) {
    console.warn("Could not clear cached student profile:", err);
  }
};

export const syncStudentProgressToCloud = async (
  uid: string,
  progress: Partial<StudentProfile>
): Promise<void> => {
  const current = getCachedStudent();
  if (!current || current.uid !== uid) return;

  const updated = sanitizeStudentProfile({ ...current, ...progress });
  saveCachedStudent(updated);
  await syncStudentToServerDb(updated);
};

const loadCurrentProfile = async (): Promise<StudentProfile | null> => {
  const result = await authClient.getSession();
  if (result.error) throw result.error;
  const user = result.data?.user;
  if (!user) return null;

  const sessionProfile = profileFromAuthUser(user);
  const remote = await fetchStudentFromServerDb(sessionProfile.email);
  const profile = sanitizeStudentProfile({
    ...sessionProfile,
    ...remote,
    uid: sessionProfile.uid,
    email: sessionProfile.email,
    emailVerified: sessionProfile.emailVerified,
  });
  saveCachedStudent(profile);
  await syncStudentToServerDb(profile);
  return profile;
};

export const subscribeToAuthChanges = (
  callback: (student: StudentProfile | null) => void
): (() => void) => {
  let active = true;
  let requestId = 0;
  const refresh = async () => {
    const currentRequest = ++requestId;
    try {
      const profile = await loadCurrentProfile();
      if (active && currentRequest === requestId) callback(profile);
    } catch (err) {
      console.error("Could not load Better Auth session:", err);
      if (active && currentRequest === requestId) callback(null);
    }
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") void refresh();
  };

  void refresh();
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", onVisibilityChange);
  return () => {
    active = false;
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
};

export const resendVerificationEmail = async (email?: string): Promise<void> => {
  const targetEmail = (email || getCachedStudent()?.email || "").trim().toLowerCase();
  if (!targetEmail) throw new Error("An email address is required to resend verification.");
  const result = await authClient.sendVerificationEmail({
    email: targetEmail,
    callbackURL: callbackURL(),
  });
  if (result.error) throw result.error;
};

export const refreshEmailVerification = async (): Promise<{
  verified: boolean;
  profile: StudentProfile | null;
}> => {
  const profile = await loadCurrentProfile();
  return {
    verified: Boolean(profile?.emailVerified),
    profile,
  };
};
