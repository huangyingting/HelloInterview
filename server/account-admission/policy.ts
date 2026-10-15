export type AccountAdmissionMode = 'invitation-only' | 'public';

export const DEFAULT_ACCOUNT_ADMISSION_MODE: AccountAdmissionMode = 'invitation-only';
export const DEFAULT_ACCOUNT_ADMISSION_RETENTION_DAYS = 90;

export function getAccountAdmissionMode(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AccountAdmissionMode {
  const raw = env.ACCOUNT_ADMISSION_MODE?.trim().toLowerCase();
  if (!raw || raw === 'invitation-only') {
    return 'invitation-only';
  }
  if (raw === 'public') {
    return 'public';
  }
  return DEFAULT_ACCOUNT_ADMISSION_MODE;
}

export function isInvitationOnlyMode(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return getAccountAdmissionMode(env) === 'invitation-only';
}

export function getAccountAdmissionRetentionDays(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const raw = env.ACCOUNT_ADMISSION_RETENTION_DAYS?.trim();
  if (!raw) return DEFAULT_ACCOUNT_ADMISSION_RETENTION_DAYS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_ACCOUNT_ADMISSION_RETENTION_DAYS;
  }
  return Math.min(parsed, 3650);
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  const normalized = normalizeEmail(value);
  return normalized.length >= 3 && normalized.length <= 320 && SIMPLE_EMAIL_RE.test(normalized);
}

export function maskEmail(value: string): string {
  const normalized = normalizeEmail(value);
  const atIndex = normalized.indexOf('@');
  if (atIndex <= 0) return '***';
  const local = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);
  const visibleLocal = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visibleLocal}***@${domain}`;
}
