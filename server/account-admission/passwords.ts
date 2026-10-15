import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 32 * 1024 * 1024;
const DUMMY_SALT = Buffer.from('studio-account-admission-dummy-salt-01', 'utf8').subarray(0, 16);

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey as Buffer);
    });
  });
}

export function validatePasswordPolicy(
  password: unknown,
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof password !== 'string') {
    return { ok: false, message: 'Password is required.' };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return {
      ok: false,
      message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`,
    };
  }
  if (password.trim().length === 0) {
    return { ok: false, message: 'Password cannot be only whitespace.' };
  }
  return { ok: true, value: password };
}

export async function hashPassword(password: string): Promise<string> {
  const checked = validatePasswordPolicy(password);
  if (!checked.ok) {
    throw new Error(checked.message);
  }
  const salt = randomBytes(16);
  const derived = await scryptAsync(checked.value, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return [
    'scrypt',
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  if (typeof password !== 'string' || password.length === 0 || password.length > PASSWORD_MAX_LENGTH) {
    await scryptAsync('invalid-password', DUMMY_SALT, SCRYPT_KEYLEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: SCRYPT_MAXMEM,
    });
    return false;
  }

  const parts = encodedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    await scryptAsync(password, DUMMY_SALT, SCRYPT_KEYLEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: SCRYPT_MAXMEM,
    });
    return false;
  }

  const n = Number.parseInt(parts[1] ?? '', 10);
  const r = Number.parseInt(parts[2] ?? '', 10);
  const p = Number.parseInt(parts[3] ?? '', 10);
  const salt = Buffer.from(parts[4] ?? '', 'base64url');
  const expected = Buffer.from(parts[5] ?? '', 'base64url');
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p) || salt.length < 8 || expected.length < 32) {
    return false;
  }

  const actual = await scryptAsync(password, salt, expected.length, {
    N: n,
    r,
    p,
    maxmem: SCRYPT_MAXMEM,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function verifyPasswordOrDummy(
  password: string,
  encodedHash?: string | null,
): Promise<boolean> {
  if (!encodedHash) {
    await scryptAsync(
      typeof password === 'string' ? password.slice(0, PASSWORD_MAX_LENGTH) : 'missing-user',
      DUMMY_SALT,
      SCRYPT_KEYLEN,
      {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: SCRYPT_MAXMEM,
      },
    );
    return false;
  }
  return verifyPassword(password, encodedHash);
}

export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token.trim()).digest('base64url');
}
