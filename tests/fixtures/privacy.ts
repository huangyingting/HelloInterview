import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { PrivacyExports } from '../../server/privacy';
import type { PrivacyExportHistory } from '../../shared/types';
import type { IdentityBrowser } from './identity';

export async function completedPrivacyExport(browser:IdentityBrowser,privacy:PrivacyExports) {
  const requestId=randomUUID();
  const requested=await browser.request('/api/privacy/exports',{requestId});
  assert.equal(requested.status,202,await requested.clone().text());
  let claim;
  const deadline=Date.now()+2000;
  while(!claim&&Date.now()<deadline){claim=await privacy.jobs.claim('privacy.process');if(!claim)await delay(10);}
  assert.ok(claim,'Privacy export job was not available to its worker.');
  await privacy.runClaim(claim);
  const history=await browser.request('/api/privacy/exports');
  assert.equal(history.status,200);
  const item=(await history.json() as PrivacyExportHistory).exports.find(value=>value.id===requestId);
  assert.equal(item?.status,'ready');
  const response=await browser.request(`/api/privacy/exports/${requestId}/download`);
  assert.equal(response.status,200,await response.clone().text());
  return {requestId,item: item!,artifact:await response.json() as Record<string,unknown>,response};
}
