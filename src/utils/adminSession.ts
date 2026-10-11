// Storage helpers for the signed admin session token issued by /api/admin-auth.
const KEY = 'patente_admin_token';
const EMAIL_KEY = 'patente_admin_auth';

export function getAdminToken(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function getAdminEmail(): string | null {
  try {
    return sessionStorage.getItem(EMAIL_KEY);
  } catch {
    return null;
  }
}

export function saveAdminSession(email: string, token: string): void {
  try {
    sessionStorage.setItem(KEY, token);
    sessionStorage.setItem(EMAIL_KEY, email);
  } catch {}
}

export function clearAdminSession(): void {
  try {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(EMAIL_KEY);
  } catch {}
}

/** Extra headers for admin API calls (empty when no session exists). */
export function adminHeaders(): Record<string, string> {
  const token = getAdminToken();
  return token ? { 'X-Admin-Token': token } : {};
}
