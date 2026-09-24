const AUTH_TOKEN_KEY = 'spidy-auth-token-v1';
const GUEST_DEVICE_ID_KEY = 'spidy-guest-device-id-v1';

export function loadAuthToken(): string | null {
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    return token && token.trim() ? token : null;
  } catch {
    return null;
  }
}

export function saveAuthToken(token: string): void {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch (error) {
    console.error('[auth] Failed to persist token:', error);
  }
}

export function clearAuthToken(): void {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch (error) {
    console.error('[auth] Failed to clear token:', error);
  }
}

let guestVisitId: string | null = null;

export function getGuestVisitId(): string {
  if (!guestVisitId) {
    guestVisitId = crypto.randomUUID();
  }
  return guestVisitId;
}

export function getGuestDeviceId(): string {
  try {
    const existing = localStorage.getItem(GUEST_DEVICE_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(GUEST_DEVICE_ID_KEY, id);
    return id;
  } catch {
    return `guest-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}
