import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyState } from '../shared/domain';
import { nextPreparationStep } from '../shared/preparation';
import { courses, problems, tracks } from '../shared/public-catalog';
import { communityParticipationEnabled } from '../server/next/capabilities';

test('a fresh workspace suggests real material without fabricating user activity', () => {
  const state = emptyState();
  assert.equal(nextPreparationStep(state).to, '/learn/system-design/introduction');
  assert.equal(state.activity.length, 0);
  assert.equal(state.attempts.length, 0);
  assert.deepEqual(state, emptyState());
});

test('saved drafts take priority, then enrolled courses, then the next unfinished lesson', () => {
  const state = emptyState();
  const course = courses[0];
  state.enrollments.push(course.id);
  assert.equal(nextPreparationStep(state).to, course.units[0].steps[0].to);
  state.attempts.push({ id: 'saved-draft', problemId: problems[0].id, answer: '', code: '', nodes: [], edges: [],
    elapsed: 0, level: 'Senior', updatedAt: '2026-01-01T12:00:00Z', completed: false });
  assert.equal(nextPreparationStep(state).to, `/practice/${problems[0].track}/${problems[0].id}?attempt=saved-draft`);
  state.attempts[0].completed = true;
  state.enrollments = [];
  const coding = tracks.find(track => track.id === 'code')!;
  state.read.push(`code/${coding.lessons[0].id}`);
  assert.equal(nextPreparationStep(state).to, `/learn/code/${coding.lessons[1].id}`);
});

test('community publishing is an explicit deployment capability and invalid flags fail closed', () => {
  assert.equal(communityParticipationEnabled({}), false);
  assert.equal(communityParticipationEnabled({ COMMUNITY_WRITES_ENABLED: 'false' }), false);
  assert.equal(communityParticipationEnabled({ COMMUNITY_WRITES_ENABLED: 'true' }), true);
  assert.throws(() => communityParticipationEnabled({ COMMUNITY_WRITES_ENABLED: 'yes' }), /COMMUNITY_WRITES_ENABLED/);
});

test('finishing a track recommends another unfinished track rather than abandoning unread lessons', () => {
  const state = emptyState();
  for (const track of tracks) {
    const next = nextPreparationStep(state);
    assert.equal(next.to, `/learn/${track.id}/${track.lessons[0].id}`);
    assert.equal(next.kind, 'lesson');
    if (state.read.length) assert.equal(next.label, 'EXPLORE ANOTHER TRACK');
    state.read.push(...track.lessons.map(lesson => `${track.id}/${lesson.id}`));
  }
  assert.equal(nextPreparationStep(state).to, '/practice');
});

test('the original behavioral course retains its six saved steps without retroactively adding new quizzes', () => {
  const course = courses.find(item => item.id === 'behavioral')!;
  assert.deepEqual(course.units.flatMap(unit => unit.steps).map(step => [step.type, step.resource]), [
    ['lesson', 'behavioral/introduction'], ['video', 'behavioral'],
    ['lesson', 'behavioral/conflict'], ['practice', 'conflict-story'],
    ['lesson', 'behavioral/failure'], ['practice', 'setback-story'],
  ]);
});
