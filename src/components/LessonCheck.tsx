import { useId, useState } from 'react';
import type { UnderstandingCheck } from '../../shared/types';

export function LessonCheck({ check }: { check: UnderstandingCheck }) {
  const name = useId(), [selected, setSelected] = useState<number | null>(null), [submitted, setSubmitted] = useState(false);
  return <form className="lesson-check" aria-label="Lesson understanding check" onSubmit={event => { event.preventDefault(); if (selected !== null) setSubmitted(true); }}>
    <span className="eyebrow">PREDICT BEFORE REVEALING</span>
    <fieldset disabled={submitted}><legend>{check.prompt}</legend>{check.options.map((option, index) => <label key={option}><input type="radio" name={name} checked={selected === index} onChange={() => setSelected(index)}/><span>{option}</span></label>)}</fieldset>
    {submitted ? <><div className="lesson-check-feedback" role="status"><strong>{selected === check.correct ? 'Correct.' : 'Not quite.'} {selected !== check.correct && `The answer is: ${check.options[check.correct]}`}</strong><p>{check.explanation}</p></div><button type="button" className="button secondary small" onClick={() => { setSubmitted(false); setSelected(null); }}>Try again</button></> : <button className="button secondary small" type="submit" disabled={selected === null}>Check reasoning</button>}
    <p className="fine-print">Local practice only. This does not save a quiz score or mark the lesson complete. Use the lesson quiz to save a result.</p>
  </form>;
}
