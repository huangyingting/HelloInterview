import { useState } from 'react';
import type { AlgorithmExperimentKind, LessonLab } from '../../shared/types';
import { algorithmExperiment, algorithmFixtureLabels } from '../../shared/algorithm-experiments';
import { cachedRead, capacityEstimate, featureAvailability, queueEstimate, releaseGate, retrievalMetrics, storyBudget, tokenBucket, versionedWrite, vestingEstimate } from '../../shared/curriculum-models';
import { LabMetrics, LabSlider as Slider } from './LabControls';
import { Select } from './Select';

const titles: Record<LessonLab['kind'], string> = {
  capacity: 'Workload and capacity assumptions', queue: 'Backlog and spare service rate', cache: 'TTL versus authoritative freshness',
  'token-bucket': 'Burst and refill experiment', 'versioned-write': 'Competing versioned writes',
  'retrieval-metrics': 'Evidence membership and ranking', 'feature-time': 'Point-in-time feature availability',
  'release-gate': 'Quality and critical release gates', 'story-budget': 'Story structure and time budget',
  'offer-vesting': 'Cash and hypothetical vesting', algorithm: 'Algorithm state experiment',
};
const fraction = (value: number | null) => value === null ? 'N/A' : value.toFixed(3);

function Capacity() {
  const [daily, setDaily] = useState(1000000), [peak, setPeak] = useState(6), [bytes, setBytes] = useState(800), [replicas, setReplicas] = useState(3);
  const result = capacityEstimate(daily, peak, bytes, replicas);
  return <><div className="visual-inputs"><Slider label="Daily operations" value={daily} min={0} max={10000000} step={100000} onChange={setDaily}/><Slider label="Peak factor" value={peak} min={1} max={20} onChange={setPeak}/><Slider label="Payload bytes" value={bytes} min={100} max={10000} step={100} onChange={setBytes}/><Slider label="Stored replicas" value={replicas} min={1} max={5} onChange={setReplicas}/></div>
    <LabMetrics items={[['Average operations/s', result.average.toFixed(2)], ['Peak operations/s', result.peak.toFixed(2)], ['Peak payload Mb/s', result.payloadMbps.toFixed(3)], ['30-day stored payload GB', result.storedGB.toFixed(3)]]}/>
    <p className="fine-print">Hypothetical independent views: every operation transfers one payload; the storage view assumes each operation creates one retained record. Decimal GB and Mb. Excludes indexes, protocol overhead, backup copies, skew, and capacity during failure. Not a device or shard-fit guarantee.</p></>;
}
function Queue() {
  const [arrival, setArrival] = useState(100), [service, setService] = useState(80), [seconds, setSeconds] = useState(10), [initial, setInitial] = useState(200);
  const result = queueEstimate(arrival, service, seconds, initial);
  return <><div className="visual-inputs"><Slider label="Arrivals per second" value={arrival} min={0} max={200} step={10} onChange={setArrival}/><Slider label="Completions per second" value={service} min={0} max={200} step={10} onChange={setService}/><Slider label="Elapsed seconds" value={seconds} min={0} max={60} onChange={setSeconds}/><Slider label="Initial pending jobs" value={initial} min={0} max={1000} step={50} onChange={setInitial}/></div>
    <LabMetrics items={[['Pending jobs', result.pending], ['Drain time at current rates', result.drainSeconds === null ? 'Cannot drain' : `${result.drainSeconds.toFixed(1)} s`]]}/>
    <p className="fine-print">Constant-rate fluid model: max(0, initial + (arrivals − completions) × seconds). Drain time is additional time at unchanged rates. No job-cost variance, scheduling, retries, oldest-job age, or measured latency is inferred.</p></>;
}
function Cache() {
  const [ttl, setTtl] = useState(20), [read, setRead] = useState(10), [invalidate, setInvalidate] = useState(false);
  const result = cachedRead(ttl, read, invalidate);
  return <><p>Cache version 1 at second 0. The origin changes to version 2 at second 5, before this read.</p><div className="visual-inputs"><Slider label="Cache TTL seconds" value={ttl} min={1} max={60} onChange={setTtl}/><Slider label="Read at second" value={read} min={5} max={60} onChange={setRead}/></div><label className="checkbox-label"><input type="checkbox" checked={invalidate} onChange={event => setInvalidate(event.target.checked)}/> Invalidate the copy when the origin changes</label>
    <LabMetrics items={[['Read path', result.hit ? 'Cache hit' : 'Origin refresh'], ['Returned version', result.returnedVersion], ['Authoritative version', 2], ['Content status', result.stale ? 'Obsolete copy' : 'Current'] ]}/>
    <p className="fine-print">At the exact TTL boundary the copy expires. This single-copy fixture models TTL and immediate invalidation only, not ETag validation, shared HTTP directives, distributed invalidation races, or production authorization.</p></>;
}
function Bucket() {
  const [capacity, setCapacity] = useState(10), [refill, setRefill] = useState(2), [wait, setWait] = useState(3), [requests, setRequests] = useState(10);
  const result = tokenBucket(capacity, refill, wait, requests);
  return <><p>A first burst of capacity + 2 requests consumes a full bucket and rejects two requests. Start the next wait with zero tokens.</p><div className="visual-inputs"><Slider label="Bucket capacity" value={capacity} min={1} max={30} onChange={setCapacity}/><Slider label="Tokens refilled per second" value={refill} min={0} max={10} onChange={setRefill}/><Slider label="Seconds before second burst" value={wait} min={0} max={20} onChange={setWait}/><Slider label="Second burst requests" value={requests} min={1} max={40} onChange={setRequests}/></div>
    <LabMetrics items={[['Refilled tokens', result.replenished], ['Second burst accepted', result.accepted], ['Second burst rejected', result.rejected], ['Remaining tokens', result.remaining]]}/>
    <p className="fine-print">One token per request, whole-second refill, and a capped bucket. This local arithmetic does not establish atomic updates, distributed clock behavior, or tenant identity.</p></>;
}
function Versioned() {
  const [expected, setExpected] = useState(1);
  const [state, setState] = useState({ version: 1, value: 'Original', events: [] as string[] });
  const commit = (writer: string) => setState(current => {
    const result = versionedWrite(current, expected, writer);
    return { ...result.state, events: [...current.events, `${writer} expected v${expected}: ${result.accepted ? `accepted → v${result.state.version}` : `rejected; remains v${current.version}`}`].slice(-8) };
  });
  return <><p>Both writers can use the same observed version. Try writer A, then writer B without updating the precondition.</p><Slider label="Expected version" value={expected} min={1} max={10} onChange={setExpected}/><div className="visual-actions"><button className="button secondary small" disabled={state.version >= 10} onClick={() => commit('Writer A')}>Commit writer A</button><button className="button secondary small" disabled={state.version >= 10} onClick={() => commit('Writer B')}>Commit writer B</button></div>
    <LabMetrics items={[['Current version', state.version], ['Stored value', state.value]]}/><ol className="lab-event-log" aria-label="Recent write outcomes" aria-live="polite">{state.events.map((event, index) => <li key={index}>{event}</li>)}</ol>
    <p className="fine-print">Sequential compare-and-swap model, capped at version 10 and the latest eight observations. Reset to start again. It does not implement database locks, operation deduplication, schema validation, authorization, or remote effects.</p></>;
}
function Retrieval() {
  const [selected, setSelected] = useState(['b', 'a']), [reverse, setReverse] = useState(false), [answerable, setAnswerable] = useState(true);
  const candidates = ['b', 'a', 'd', 'c', 'e'], relevant = answerable ? ['a', 'c', 'e'] : [];
  const returned = candidates.filter(id => selected.includes(id));
  if (reverse) returned.reverse();
  const result = retrievalMetrics(returned, relevant);
  return <><p>Fixed candidate order: b, a, d, c, e. Judged relevant identities for the answerable fixture: a, c, e.</p><div className="lab-choice-grid">{candidates.map(id => <label className="checkbox-label" key={id}><input type="checkbox" checked={selected.includes(id)} onChange={event => setSelected(current => event.target.checked ? [...current, id] : current.filter(item => item !== id))}/> Return {id}</label>)}</div>
    <label className="checkbox-label"><input type="checkbox" checked={reverse} onChange={event => setReverse(event.target.checked)}/> Reverse the returned order</label><label className="checkbox-label"><input type="checkbox" checked={!answerable} onChange={event => setAnswerable(!event.target.checked)}/> Fixture has no known relevant evidence</label>
    <p className="lab-state" role="status">Returned: {returned.join(', ') || 'none'}. Relevant: {relevant.join(', ') || 'none'}.</p>
    <LabMetrics items={[['Precision', fraction(result.precision)], ['Recall', fraction(result.recall)], ['Reciprocal rank', result.reciprocalRank.toFixed(3)]]}/>
    <p className="fine-print">Unique synthetic identities. Precision is N/A with no returned items; recall is N/A with no known relevant items. Reciprocal rank is zero if no relevant item is returned. Unanswerable cases need a separate abstention evaluation, not a fabricated recall denominator.</p></>;
}
function Features() {
  const [prediction, setPrediction] = useState(10), names = ['Prior activity', 'Delayed event feature', 'Later cancellation'];
  const available = [6, 12, 30], usable = featureAvailability(prediction, available);
  return <><Slider label="Prediction at second" value={prediction} min={0} max={40} onChange={setPrediction}/><div className="visual-table-scroll" tabIndex={0} role="region" aria-label="Feature availability table"><table className="lab-table"><caption>Availability, not just occurrence, controls this point-in-time fixture.</caption><thead><tr><th scope="col">Feature</th><th scope="col">Event time</th><th scope="col">Available at</th><th scope="col">At prediction</th></tr></thead><tbody>{names.map((name, index) => <tr key={name}><th scope="row">{name}</th><td>{[5, 8, 25][index]}</td><td>{available[index]}</td><td>{usable[index] ? 'Available' : 'Exclude'}</td></tr>)}</tbody></table></div>
    <p role="status">{usable.filter(Boolean).length} of 3 features available by second {prediction}.</p><p className="fine-print">At exact equality, a feature is available. This only checks supplied timestamps; feature-label validity, temporal splits, transformation parity, real serving availability, and product usefulness need separate evidence.</p></>;
}
function Release() {
  const [passed, setPassed] = useState(19), [critical, setCritical] = useState(0), [latency, setLatency] = useState(400), [empty, setEmpty] = useState(false);
  const result = releaseGate(empty ? 0 : passed, empty ? 0 : 20, critical, latency, 500);
  return <><div className="visual-inputs"><Slider label="Passing evaluation cases out of 20" value={passed} min={0} max={20} onChange={setPassed}/><Slider label="Critical regressions" value={critical} min={0} max={3} onChange={setCritical}/><Slider label="Measured latency milliseconds" value={latency} min={0} max={1000} step={50} onChange={setLatency}/></div><label className="checkbox-label"><input type="checkbox" checked={empty} onChange={event => setEmpty(event.target.checked)}/> No evaluation data ran</label>
    <LabMetrics items={[['Passing fraction', fraction(result.rate)], ['Release decision', result.allowed ? 'Eligible' : 'Blocked']]}/>
    <p className="fine-print">Declared synthetic policy: at least 95% pass, zero critical regressions, and latency ≤500 ms, with at least one evaluated case. This is policy arithmetic, not statistical significance, calibrated judging, a benchmark, or permission to deploy.</p></>;
}
function Story() {
  const [parts, setParts] = useState([25, 60, 20, 15]);
  const names = ['Context and task seconds', 'Personal action seconds', 'Observed result seconds', 'Reflection seconds'], result = storyBudget(parts, 120);
  return <><div className="visual-inputs">{parts.map((value, index) => <Slider key={names[index]} label={names[index]} value={value} min={0} max={120} step={5} onChange={value => setParts(current => current.map((part, at) => at === index ? value : part))}/>)}</div><LabMetrics items={[['Total duration', `${result.total} s`], ['Time left in 2-minute rehearsal', `${result.remaining} s`], ['Personal action fraction', fraction(result.actionShare)]]}/>
    <p className="fine-print">A rehearsal planning aid, not an ideal timing ratio or an automated assessment of your story, honesty, leadership, or hiring readiness. Use real examples and qualified attribution. No story text or personal information is requested or saved.</p></>;
}
function Offer() {
  const [base, setBase] = useState(120000), [units, setUnits] = useState(4800), [months, setMonths] = useState(12), [price, setPrice] = useState(10);
  const result = vestingEstimate(base, units, months, price);
  return <><p>Invented schedule: 48 months, 12-month cliff with catch-up, then monthly vesting. Base and grant values use one hypothetical currency unit.</p><div className="visual-inputs"><Slider label="Annual gross base" value={base} min={0} max={240000} step={10000} onChange={setBase}/><Slider label="Equity grant units" value={units} min={0} max={9600} step={480} onChange={setUnits}/><Slider label="Completed service months" value={months} min={0} max={48} onChange={setMonths}/><Slider label="Hypothetical price per unit" value={price} min={0} max={100} step={5} onChange={setPrice}/></div>
    <LabMetrics items={[['Gross base over modeled months', result.grossBase.toFixed(2)], ['Vested grant units', result.vestedUnits.toFixed(2)], ['Hypothetical vested value', result.hypotheticalEquity.toFixed(2)]]}/>
    <p className="fine-print">Scenario arithmetic only, not guaranteed cash, liquidity, a forecast, financial advice, tax advice, or legal advice. Excludes options exercise price, tax, dilution, bonus, departures, settlement, and actual grant terms. Check the written instrument; real schedules can differ.</p></>;
}
function Algorithm({ kind }: { kind: AlgorithmExperimentKind }) {
  const [fixture, setFixture] = useState(0), [step, setStep] = useState(0), result = algorithmExperiment(kind, fixture);
  const current = result.frames[step];
  return <><Select aria-label="Algorithm fixture" value={String(fixture)} onValueChange={value => { setFixture(Number(value)); setStep(0); }} options={algorithmFixtureLabels[kind].map((label, index) => ({ value: String(index), label }))}/>
    <pre className="lab-input"><code>Input: {result.input}</code></pre><div className="lab-state" aria-live="polite"><strong>{current.title}</strong><div className="lab-cells">{current.values.length ? current.values.map((value, index) => <span key={index}>{value}</span>) : <span>Empty state</span>}</div><p>{current.detail}</p></div>
    <div className="visual-actions"><button className="button secondary small" disabled={step === 0} onClick={() => setStep(current => current - 1)}>Previous state</button><button className="button secondary small" disabled={step === result.frames.length - 1} onClick={() => setStep(current => current + 1)}>Next state</button><span className="fine-print">State {step + 1} of {result.frames.length}</span></div>
    <details className="lab-result"><summary>Reveal final result</summary><pre><code>{result.output}</code></pre></details><p className="fine-print">{result.note} Presets are computed by fixed trusted local algorithms, not submitted user code. No autoplay.</p></>;
}
function Experiment({ lab }: { lab: LessonLab }) {
  switch (lab.kind) {
    case 'capacity': return <Capacity/>;
    case 'queue': return <Queue/>;
    case 'cache': return <Cache/>;
    case 'token-bucket': return <Bucket/>;
    case 'versioned-write': return <Versioned/>;
    case 'retrieval-metrics': return <Retrieval/>;
    case 'feature-time': return <Features/>;
    case 'release-gate': return <Release/>;
    case 'story-budget': return <Story/>;
    case 'offer-vesting': return <Offer/>;
    case 'algorithm': return <Algorithm kind={lab.algorithm}/>;
  }
}
export default function CurriculumLab({ lab }: { lab: LessonLab }) {
  const [revision, setRevision] = useState(0), title = titles[lab.kind];
  return <section className="curriculum-lab" aria-label={title}><header><div><span className="eyebrow">CHANGE THE ASSUMPTION. CHECK THE RESULT.</span><h3>{title}</h3></div><button className="button secondary small" aria-label={`Reset ${title}`} onClick={() => setRevision(current => current + 1)}>Reset lab</button></header>
    <Experiment key={revision} lab={lab}/><p className="fine-print">Local, temporary exploration. No provider calls, account writes, saved score, or automatic lesson completion.</p>
  </section>;
}
