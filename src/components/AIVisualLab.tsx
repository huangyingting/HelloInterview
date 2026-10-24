import { useState, type ReactNode } from 'react';
import type { VisualLabKind } from '../../shared/types';
import { causalAttention, contextBudget, kvCacheBytes, samplingDistribution, streamMetrics } from '../../shared/ai-visuals';
import { Select } from './Select';
import { LabSlider as Slider } from './LabControls';
function Shell({ title, children, note }: { title: string; children: ReactNode; note: string }) {
  return <section className="ai-visual-lab" aria-label={title}><header><span className="eyebrow">CHANGE ONE ASSUMPTION</span><h3>{title}</h3></header>{children}<p className="fine-print">{note} These controls are local experiments, not saved course completion.</p></section>;
}
function AttentionLab() {
  const [query, setQuery] = useState(2), [boost, setBoost] = useState(2);
  const tokens = ['Plan', 'a', 'safe', 'retry'];
  const scores = tokens.map((_, row) => tokens.map((_, column) => row === column ? boost : (row + column) % 3 - 1));
  const weights = causalAttention(scores);
  return <Shell title="Causal attention explorer" note="Synthetic pre-scaled scores, not learned model weights. Rows normalize only across current and earlier positions; attention weights alone do not explain a model's decision.">
    <div className="visual-inputs"><Select aria-label="Query position" value={String(query)} onValueChange={value => setQuery(Number(value))} options={tokens.map((token, index) => ({ value: String(index), label: `Query ${index + 1}: ${token}` }))}/><Slider label="Self-attention score" value={boost} min={-2} max={4} onChange={setBoost}/></div>
    <div className="visual-table-scroll"><table className="attention-matrix"><caption>Probability by query row and key column. A dash means causally masked.</caption><thead><tr><th scope="col">Query / key</th>{tokens.map(token => <th scope="col" key={token}>{token}</th>)}</tr></thead><tbody>{weights.map((row, index) => <tr className={index === query ? 'selected' : ''} key={tokens[index]}><th scope="row">{tokens[index]}</th>{row.map((weight, column) => <td key={column} className={column > index ? 'masked' : ''} style={column > index ? undefined : { background: `color-mix(in srgb, var(--accent) ${Math.round(weight * 22)}%, var(--surface))` }}>{column > index ? <span aria-label="Masked">—</span> : `${(weight * 100).toFixed(1)}%`}</td>)}</tr>)}</tbody></table></div>
    <p role="status">Query {query + 1} can use {query + 1} of {tokens.length} positions. Allowed probability mass: {weights[query].reduce((sum, value) => sum + value, 0).toFixed(3)}.</p>
  </Shell>;
}
function SamplingLab() {
  const [temperature, setTemperature] = useState(1), [topK, setTopK] = useState(5), [topP, setTopP] = useState(1);
  const labels = ['inspect', 'retry', 'wait', 'stop', 'ask'];
  const result = samplingDistribution([3, 2, 1, 0, -1], temperature, topK, topP);
  return <Shell title="Decoding distribution" note="Fixed invented logits, not a live model. Apply temperature, then top-k, renormalize, then top-p and renormalize. Framework ordering can differ; probability is not factual confidence.">
    <div className="visual-inputs"><Slider label="Temperature" value={temperature} min={0.1} max={2} step={0.1} onChange={setTemperature}/><Slider label="Top k" value={topK} min={1} max={5} onChange={setTopK}/><Slider label="Top p" value={topP} min={0.1} max={1} step={0.05} onChange={setTopP}/></div>
    <div className="probability-bars" role="img" aria-label={`Filtered next-token probabilities: ${labels.map((label, index) => `${label} ${(result.after[index] * 100).toFixed(1)}%`).join(', ')}`}>{labels.map((label, index) => <div key={label}><strong>{label}</strong><span className="probability-track"><i style={{ width: `${result.after[index] * 100}%` }}/></span><output>{(result.after[index] * 100).toFixed(1)}%</output></div>)}</div>
    <p role="status">{result.after.filter(value => value > 0).length} {result.after.filter(value => value > 0).length === 1 ? 'candidate remains' : 'candidates remain'}. Total probability: {result.after.reduce((sum, value) => sum + value, 0).toFixed(3)}.</p>
    <details><summary>Compare before and after filtering</summary><ul>{labels.map((label, index) => <li key={label}>{label}: {(result.before[index] * 100).toFixed(2)}% before; {(result.after[index] * 100).toFixed(2)}% after.</li>)}</ul></details>
  </Shell>;
}
function KvLab() {
  const [tokens, setTokens] = useState(4096), [sequences, setSequences] = useState(1), [heads, setHeads] = useState(8), [bytes, setBytes] = useState(2);
  const memory = kvCacheBytes({ layers: 32, kvHeads: heads, headDimension: 128, tokens, sequences, bytesPerElement: bytes });
  const perSequence = memory / sequences;
  return <Shell title="KV cache memory budget" note="Dense full-attention estimate for 32 layers and head dimension 128; excludes weights, activations, allocator overhead, paging, replication and prefix sharing. Quantized elements have extra scale/metadata costs. This is not a device-fit claim.">
    <div className="visual-inputs"><Slider label="Cached tokens per sequence" value={tokens} min={1024} max={32768} step={1024} onChange={setTokens}/><Slider label="Active sequences" value={sequences} min={1} max={16} onChange={setSequences}/><Select aria-label="KV heads" value={String(heads)} onValueChange={value => setHeads(Number(value))} options={[1, 8, 32].map(value => ({ value: String(value), label: `${value} KV ${value === 1 ? 'head' : 'heads'}` }))}/><Select aria-label="KV bytes per element" value={String(bytes)} onValueChange={value => setBytes(Number(value))} options={[1, 2, 4].map(value => ({ value: String(value), label: `${value} ${value === 1 ? 'byte' : 'bytes'} / element` }))}/></div>
    <div className="visual-metrics" aria-live="polite"><div><span>Total KV memory</span><strong>{(memory / 2 ** 30).toFixed(3)} GiB</strong></div><div><span>Per sequence</span><strong>{(perSequence / 2 ** 20).toFixed(1)} MiB</strong></div></div>
    <pre><code>bytes = 2 × layers × KV heads × head dimension × tokens × sequences × bytes/element</code></pre>
  </Shell>;
}
function StreamingLab() {
  const [queue, setQueue] = useState(100), [prefill, setPrefill] = useState(400), [interval, setInterval] = useState(40), [tokens, setTokens] = useState(50), [deadline, setDeadline] = useState(3000);
  const result = streamMetrics(queue, prefill, interval, tokens, deadline), scale = Math.max(result.total, 1);
  return <Shell title="Streaming latency timeline" note="Synthetic constant token intervals. Prefill here includes first-token production; later tokens add n−1 intervals. Network, tokenization, hidden computation, validation and rendering are excluded. A deadline pass is not proof of answer quality or measured goodput.">
    <div className="visual-inputs"><Slider label="Queue milliseconds" value={queue} min={0} max={2000} step={50} onChange={setQueue}/><Slider label="Prefill milliseconds" value={prefill} min={0} max={2000} step={50} onChange={setPrefill}/><Slider label="Token interval milliseconds" value={interval} min={10} max={100} step={5} onChange={setInterval}/><Slider label="Output tokens" value={tokens} min={1} max={100} onChange={setTokens}/><Slider label="Deadline milliseconds" value={deadline} min={500} max={10000} step={100} onChange={setDeadline}/></div>
    <div className="stream-timeline" role="img" aria-label={`Queue ${queue} milliseconds, prefill ${prefill} milliseconds, remaining decode ${result.decode} milliseconds`}>
      {[['Queue', queue], ['Prefill', prefill], ['Decode', result.decode]].map(([label, value]) => <span key={label} style={{ flexBasis: `${Number(value) / scale * 100}%` }} title={`${label}: ${value} ms`}/>)}
    </div><p className="fine-print">Queue / prefill / remaining decode, in that order.</p>
    <div className="visual-metrics" aria-live="polite"><div><span>First token</span><strong>{result.firstToken} ms</strong></div><div><span>Completion</span><strong>{result.total} ms</strong></div><div><span>Latency target</span><strong>{result.meetsDeadline ? 'Met' : 'Missed'}</strong></div></div>
  </Shell>;
}
function ContextLab() {
  const [window, setWindow] = useState(4096), [output, setOutput] = useState(1024), [history, setHistory] = useState(1024), [restricted, setRestricted] = useState(false);
  const evidence = [{ id: 'current-policy', tokens: 900, eligible: true }, { id: 'restricted-note', tokens: 300, eligible: restricted }, { id: 'older-summary', tokens: 800, eligible: true }, { id: 'short-excerpt', tokens: 250, eligible: true }];
  const result = contextBudget(window, output, 512, history, evidence);
  return <Shell title="Context assembly budget" note="Invented token costs and server-owned eligibility fixtures, not tokenization or real authorization. Reserve 512 instruction/schema tokens and output first; pack eligible evidence greedily in order, skipping items that do not fit. No credential or live model is involved.">
    <div className="visual-inputs"><Slider label="Context window tokens" value={window} min={2048} max={8192} step={512} onChange={setWindow}/><Slider label="Output reserve tokens" value={output} min={0} max={2048} step={256} onChange={setOutput}/><Slider label="History tokens" value={history} min={0} max={4096} step={256} onChange={setHistory}/></div>
    <label className="checkbox-label"><input type="checkbox" checked={restricted} onChange={event => setRestricted(event.target.checked)}/> Simulate a server-authorized note (fixture only)</label>
    <div className="visual-metrics" aria-live="polite"><div><span>Evidence capacity</span><strong>{result.available} tokens</strong></div><div><span>Evidence packed</span><strong>{result.used} tokens</strong></div></div>
    {result.overcommitted && <p className="error-text" role="alert">Instructions, history, and output exceed the window. No evidence can be packed; reduce the reserves or history.</p>}
    <ul className="context-evidence">{evidence.map(item => <li key={item.id}><strong>{item.id}</strong><span>{item.tokens} tokens · {!item.eligible ? 'Ineligible' : result.selected.includes(item.id) ? 'Packed' : 'Skipped: no capacity'}</span></li>)}</ul>
  </Shell>;
}
export default function AIVisualLab({ kind }: { kind: VisualLabKind }) {
  switch (kind) {
    case 'attention': return <AttentionLab/>;
    case 'sampling': return <SamplingLab/>;
    case 'kv-cache': return <KvLab/>;
    case 'streaming': return <StreamingLab/>;
    case 'context-budget': return <ContextLab/>;
  }
}
