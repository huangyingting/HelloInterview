import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const periodSeconds = 30;
const digits = 6;

function base32Encode(value: Buffer) {
  let bits = 0;
  let accumulator = 0;
  let output = '';
  for (const byte of value) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(accumulator >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(accumulator << (5 - bits)) & 31];
  return output;
}

function base32Decode(value: string) {
  if (!/^[A-Z2-7]{32}$/.test(value)) throw new Error('Stored TOTP secret is invalid.');
  let bits = 0;
  let accumulator = 0;
  const output: number[] = [];
  for (const character of value) {
    accumulator = (accumulator << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      output.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function hotp(secret: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits);
  return value.toString().padStart(digits, '0');
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: string, now = Date.now()) {
  return hotp(secret, Math.floor(now / 1000 / periodSeconds));
}

export function verifyTotp(secret: string, code: string, now: number, lastUsedStep = -1) {
  const current = Math.floor(now / 1000 / periodSeconds);
  const supplied = Buffer.from(code);
  const matches = [current - 1, current, current + 1].filter(step => {
    const expected = Buffer.from(hotp(secret, step));
    return step > lastUsedStep && supplied.byteLength === expected.byteLength && timingSafeEqual(supplied, expected);
  });
  return matches.length === 0 ? null : Math.max(...matches);
}

export function encryptTotpSecret(secret: string, key: Buffer, owner: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(owner));
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url')].join('.');
}

export function decryptTotpSecret(envelope: string, key: Buffer, owner: string) {
  const [version, encodedIv, encodedTag, encodedCiphertext, extra] = envelope.split('.');
  if (version !== 'v1' || extra !== undefined || !encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error('Stored TOTP secret envelope is invalid.');
  }
  const iv = Buffer.from(encodedIv, 'base64url');
  const tag = Buffer.from(encodedTag, 'base64url');
  const ciphertext = Buffer.from(encodedCiphertext, 'base64url');
  if (iv.byteLength !== 12 || tag.byteLength !== 16 || ciphertext.byteLength !== 32) {
    throw new Error('Stored TOTP secret envelope is invalid.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(owner));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function generateRecoveryCodes() {
  const codes = new Set<string>();
  while (codes.size < 10) {
    const compact = base32Encode(randomBytes(12)).slice(0, 20);
    codes.add(compact.match(/.{5}/g)!.join('-'));
  }
  return [...codes];
}

export function recoveryCodeHash(secret: string, owner: string, code: string) {
  const compact = code.toUpperCase().replaceAll('-', '');
  if (!/^[A-Z2-7]{20}$/.test(compact)) return null;
  return createHmac('sha256', secret).update(`studio.mfa.recovery.v1:${owner}:${compact}`).digest('hex');
}
