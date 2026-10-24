import { ArrowLeft, ArrowRight, RotateCcw } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { LearningFlow as Flow } from '../../shared/types';

export function LearningFlow({ flow }: { flow: Flow }) {
  const [step, setStep] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const id = useId(), marker = `${id}-arrow`, detail = `${id}-detail`;
  const current = flow.steps[step];
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const width = element.scrollWidth / flow.steps.length;
    const left = step * width, right = left + width;
    if (left < element.scrollLeft) element.scrollLeft = left;
    else if (right > element.scrollLeft + element.clientWidth) element.scrollLeft = right - element.clientWidth;
  }, [step, flow.steps.length]);
  return <figure className="learning-flow" aria-label={flow.title}>
    <figcaption><span className="eyebrow">TRACE THE SYSTEM</span><h3>{flow.title}</h3><p>{flow.summary}</p></figcaption>
    <div className="learning-flow-scroll" ref={viewport} tabIndex={0} role="group" aria-label={`${flow.title} diagram; scroll horizontally if needed`}>
      <svg viewBox={`0 0 ${flow.steps.length * 180} 105`} role="img" aria-label={`${flow.title}: ${flow.steps.map(item => item.title).join(' → ')}`}>
        <defs><marker id={marker} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="var(--accent)"/></marker></defs>
        {flow.steps.map((item, index) => <g key={item.id}>
          {index > 0 && <line x1={index * 180 - 10} x2={index * 180 + 6} y1="48" y2="48" stroke="var(--accent)" strokeWidth="2" markerEnd={`url(#${marker})`}/>}
          <rect x={index * 180 + 10} y="12" width="155" height="72" rx="6" fill={index === step ? 'var(--accent-light)' : 'var(--surface)'} stroke={index === step ? 'var(--accent)' : 'var(--border)'} strokeWidth="2"/>
          <text x={index * 180 + 22} y="35" fill="var(--accent)" fontSize="11">{String(index + 1).padStart(2, '0')}</text>
          <text x={index * 180 + 22} y="61" fill="var(--text)" fontSize="12" fontWeight="600">{item.title}</text>
        </g>)}
      </svg>
    </div>
    <ol className="learning-flow-steps" aria-label={`${flow.title} steps`}>{flow.steps.map((item, index) => <li key={item.id}><button aria-current={step === index ? 'step' : undefined} aria-controls={detail} onClick={() => setStep(index)}>{index + 1}. {item.title}</button></li>)}</ol>
    <p className="learning-flow-detail" id={detail} aria-live="polite"><strong>{current.title}: </strong>{current.detail}</p>
    <div className="visual-actions">
      <button className="icon-button" aria-label={`Reset ${flow.title}`} onClick={() => setStep(0)}><RotateCcw size={16} aria-hidden="true"/></button>
      <button className="button secondary small" disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft size={14} aria-hidden="true"/> Back</button>
      <button className="button secondary small" disabled={step === flow.steps.length - 1} onClick={() => setStep(step + 1)}>Next step <ArrowRight size={14} aria-hidden="true"/></button>
      <span className="fine-print">Step {step + 1} of {flow.steps.length}</span>
    </div>
  </figure>;
}
