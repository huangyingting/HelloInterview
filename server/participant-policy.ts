import { z } from 'zod';
import type { ParticipantPolicy } from '../shared/types';

export const privateBetaDurabilityNotice = 'This invite-only private beta has no backup, recovery point objective, or recovery time objective. Saved data may be lost, so participants must keep another copy of important information.';

export class ParticipantPolicyConfigurationError extends Error {
  constructor(setting: string, requirement: string) {
    super(`${setting} ${requirement}`);
    this.name = 'ParticipantPolicyConfigurationError';
  }
}

type ConfigurationFailure = (setting: string, requirement: string) => never;

export function loadParticipantPolicy(
  env: NodeJS.ProcessEnv = process.env,
  fail: ConfigurationFailure = (setting, requirement) => {
    throw new ParticipantPolicyConfigurationError(setting, requirement);
  },
): Readonly<ParticipantPolicy> | null {
  const settings = [
    'PRIVACY_CONTROLLER_NAME',
    'PRIVACY_CONTACT_URL',
    'PARTICIPANT_MINIMUM_AGE',
    'PRIVACY_RETENTION_NOTICE',
    'PRIVACY_DELETION_NOTICE',
    'PRIVATE_BETA_NO_DURABILITY_ACK',
  ] as const;
  if (!settings.some(key => env[key] !== undefined)) return null;
  const statement = (key: typeof settings[number], minimum: number, maximum: number) => {
    const value = env[key]?.trim();
    if (!value || value.length < minimum || value.length > maximum || /[\x00-\x1f\x7f]/.test(value)) {
      fail(key, `must be plain public text of ${minimum} to ${maximum} characters.`);
    }
    return value;
  };
  const controllerName = statement('PRIVACY_CONTROLLER_NAME', 2, 200);
  const contactText = env.PRIVACY_CONTACT_URL?.trim();
  let contactUrl: URL;
  try {
    if (!contactText || contactText.length > 2048 || /[\x00-\x20\x7f]/.test(contactText)) throw new Error('Invalid contact.');
    contactUrl = new URL(contactText);
    const email = contactUrl.protocol === 'mailto:' && !contactUrl.search && !contactUrl.hash
      && z.string().email().max(254).safeParse(contactUrl.pathname).success;
    const web = contactUrl.protocol === 'https:' && !contactUrl.username && !contactUrl.password;
    if (!email && !web) throw new Error('Invalid contact.');
  } catch {
    fail('PRIVACY_CONTACT_URL', 'must be a public HTTPS or mailto contact without credentials.');
  }
  const ageText = env.PARTICIPANT_MINIMUM_AGE;
  if (!ageText || !/^\d{2,3}$/.test(ageText) || Number(ageText) < 13 || Number(ageText) > 120) {
    fail('PARTICIPANT_MINIMUM_AGE', 'must be an integer from 13 through 120.');
  }
  if (env.PRIVATE_BETA_NO_DURABILITY_ACK !== 'true') {
    fail('PRIVATE_BETA_NO_DURABILITY_ACK', 'must explicitly acknowledge the approved no-backup and no-RPO/RTO boundary.');
  }
  return Object.freeze({
    controllerName,
    contactUrl: contactUrl!.href,
    minimumAge: Number(ageText),
    retentionNotice: statement('PRIVACY_RETENTION_NOTICE', 20, 1000),
    deletionNotice: statement('PRIVACY_DELETION_NOTICE', 20, 1000),
    durabilityNotice: privateBetaDurabilityNotice,
  });
}
