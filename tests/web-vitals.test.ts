import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fieldScreen, normalizeWebVital, webVitalRating } from '../shared/web-vitals';

test('field performance screens never preserve raw paths or opaque identifiers', () => {
  assert.equal(fieldScreen('/'), 'landing');
  assert.equal(fieldScreen('/practice/system-design/private-answer-id?ignored=true'), 'practice');
  assert.equal(fieldScreen('/community/post/private-resource-id'), 'community');
  assert.equal(fieldScreen('/account/security'), 'account');
  assert.equal(fieldScreen('/unrecognized/private-value'), 'other');
});

test('web vital values and standard ratings are bounded and normalized server-side', () => {
  assert.equal(normalizeWebVital('LCP', 2512.4), 2510);
  assert.equal(normalizeWebVital('CLS', 0.12345), 0.123);
  assert.equal(normalizeWebVital('INP', 504), 500);
  assert.equal(normalizeWebVital('CLS', 10.01), null);
  assert.equal(normalizeWebVital('LCP', Number.NaN), null);
  assert.equal(webVitalRating('LCP', 2500), 'good');
  assert.equal(webVitalRating('LCP', 2500.1), 'needs-improvement');
  assert.equal(webVitalRating('CLS', 0.251), 'poor');
  assert.equal(webVitalRating('INP', 500), 'needs-improvement');
});
