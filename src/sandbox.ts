import type { Problem } from '../shared/types';

export interface TestResult { label: string; passed: boolean; actual: string; expected: string; error?: string }

export const browserRunnerLimits = Object.freeze({
  codeUnits:40_000,
  cases:50,
  inputBytes:256*1024,
  responseBytes:256*1024,
  valueBytes:64*1024,
  valueDepth:20,
  valueNodes:10_000,
  labelUnits:200,
  diagnosticUnits:500,
  executionMilliseconds:2_000,
  responseMilliseconds:6_000,
});

const encoder=new TextEncoder();
function bytes(value:string){return encoder.encode(value).byteLength}

function requestPayload(code:string,cases:NonNullable<Problem['testCases']>) {
  if(code.length>browserRunnerLimits.codeUnits)
    throw new Error(`Code exceeds the ${browserRunnerLimits.codeUnits.toLocaleString()}-character browser-runner limit.`);
  if(!Array.isArray(cases)||cases.length>browserRunnerLimits.cases)
    throw new Error(`Example checks exceed the ${browserRunnerLimits.cases}-case browser-runner limit.`);
  for(const value of cases){
    if(!value||typeof value!=='object'||typeof value.label!=='string'||value.label.length<1||
      value.label.length>browserRunnerLimits.labelUnits)
      throw new Error(`Every example check needs a 1-${browserRunnerLimits.labelUnits} character label.`);
  }
  let casesJson:string;
  try{
    casesJson=JSON.stringify(cases);
  }catch{
    throw new Error('Example inputs must be JSON-compatible.');
  }
  if(bytes(casesJson)>browserRunnerLimits.inputBytes)
    throw new Error('Example inputs exceed the 256 KiB serialized browser-runner limit.');
  return casesJson;
}

function resultPayload(value:unknown,cases:NonNullable<Problem['testCases']>):TestResult[] {
  if(typeof value!=='string'||bytes(value)>browserRunnerLimits.responseBytes)
    throw new Error('The code runner returned an oversized result.');
  let parsed:unknown;
  try{parsed=JSON.parse(value);}catch{throw new Error('The code runner returned invalid results.');}
  if(!Array.isArray(parsed)||parsed.length!==cases.length)throw new Error('The code runner returned invalid results.');
  return parsed.map((item,index)=>{
    if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('The code runner returned invalid results.');
    const record=item as Record<string,unknown>,keys=Object.keys(record);
    if(keys.some(key=>!['label','passed','actual','expected','error'].includes(key))||
      record.label!==cases[index].label||typeof record.passed!=='boolean'||typeof record.actual!=='string'||
      typeof record.expected!=='string'||bytes(record.actual)>browserRunnerLimits.valueBytes||
      bytes(record.expected)>browserRunnerLimits.valueBytes||
      (record.error!==undefined&&(typeof record.error!=='string'||record.error.length>browserRunnerLimits.diagnosticUnits)))
      throw new Error('The code runner returned invalid results.');
    return {label:record.label,passed:record.passed,actual:record.actual,expected:record.expected,
      ...(record.error===undefined?{}:{error:record.error})} as TestResult;
  });
}

export function runCode(code: string, cases: NonNullable<Problem['testCases']>): Promise<TestResult[]> {
  let casesJson:string;
  try{casesJson=requestPayload(code,cases);}catch(error){return Promise.reject(error);}
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    const token = crypto.randomUUID();
    frame.hidden = true;
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('title', 'Isolated code runner');
    frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; connect-src 'none'"><script>
      let active = false;
      addEventListener('message', event => {
        if (event.source !== parent || active) return;
        active = true;
        const {code, casesJson, token} = event.data;
        const workerSource = \`onmessage = event => {
          const {code, casesJson} = event.data, reply = event.ports[0];
          const send = reply.postMessage.bind(reply);
          const limits = ${JSON.stringify(browserRunnerLimits)};
          const safeParse = JSON.parse.bind(JSON), safeStringify = JSON.stringify.bind(JSON);
          const arrayIsArray = Array.isArray.bind(Array), objectKeys = Object.keys.bind(Object);
          const objectPrototype = Object.prototype, getPrototype = Object.getPrototypeOf.bind(Object);
          const objectCreate = Object.create.bind(Object), setPrototype = Object.setPrototypeOf.bind(Object);
          const SafeArray = Array, SafeWeakSet = WeakSet, RunnerError = Error, toString = String;
          const finite = Number.isFinite.bind(Number), utf8 = new TextEncoder();
          const encode = utf8.encode.bind(utf8), size = value => encode(value).byteLength;
          const slice = Function.call.bind(String.prototype.slice);
          const diagnostic = error => slice(toString(error && error.message || error), 0, limits.diagnosticUnits);
          function boundedJson(value) {
            if (value === undefined) return 'undefined';
            let nodes = 0;
            const seen = new SafeWeakSet();
            function visit(current, depth) {
              if (depth > limits.valueDepth) throw new RunnerError('Result exceeded the browser-runner structure depth limit.');
              if (++nodes > limits.valueNodes) throw new RunnerError('Result exceeded the browser-runner structure size limit.');
              if (current === null || typeof current === 'boolean') return current;
              if (typeof current === 'string') {
                if (size(current) > limits.valueBytes) throw new RunnerError('Result exceeded the 64 KiB per-value browser-runner limit.');
                return current;
              }
              if (typeof current === 'number') return finite(current) ? current : null;
              if (typeof current !== 'object') throw new RunnerError('Result must contain only JSON-compatible values.');
              if (seen.has(current)) throw new RunnerError('Result cannot contain circular references.');
              seen.add(current);
              let result;
              if (arrayIsArray(current)) {
                if (current.length > limits.valueNodes - nodes)
                  throw new RunnerError('Result exceeded the browser-runner structure size limit.');
                result = new SafeArray(current.length);
                setPrototype(result, null);
                for (let index = 0; index < current.length; index++) result[index] = visit(current[index], depth + 1);
              } else {
                const prototype = getPrototype(current);
                if (prototype !== objectPrototype && prototype !== null)
                  throw new RunnerError('Result must contain only plain JSON objects and arrays.');
                result = objectCreate(null);
                const keys = objectKeys(current);
                for (let index = 0; index < keys.length; index++) result[keys[index]] = visit(current[keys[index]], depth + 1);
              }
              seen.delete(current);
              return result;
            }
            const encoded = safeStringify(visit(value, 0));
            if (size(encoded) > limits.valueBytes) throw new RunnerError('Result exceeded the 64 KiB per-value browser-runner limit.');
            return encoded;
          }
          try {
            const cases = safeParse(casesJson);
            const solve = new Function(code + '\\\\n; return solve;')(), results = new SafeArray(cases.length);
            setPrototype(results, null);
            for (let index = 0; index < cases.length; index++) {
              const test = cases[index];
              try {
                const actual = solve(test.input);
                if (actual && typeof actual.then === 'function') throw new RunnerError('Use a synchronous solve(input) function.');
                const encodedActual = boundedJson(actual), encodedExpected = boundedJson(test.expected);
                const result = objectCreate(null);
                result.label = test.label; result.passed = encodedActual === encodedExpected;
                result.actual = encodedActual; result.expected = encodedExpected; results[index] = result;
              } catch(error) {
                let expected = '';
                try { expected = boundedJson(test.expected); } catch {}
                const result = objectCreate(null);
                result.label = test.label; result.passed = false; result.actual = ''; result.expected = expected;
                result.error = diagnostic(error); results[index] = result;
              }
            }
            const payload = safeStringify(results);
            if (size(payload) > limits.responseBytes) throw new RunnerError('Combined results exceeded the 256 KiB browser-runner limit.');
            send({payload});
          } catch(error) { send({error:diagnostic(error)}); }
        }\`;
        let worker, workerUrl, workerTimeout, settled = false;
        const channel = new MessageChannel();
        const finish = data => {
          if (settled) return;
          settled = true;
          clearTimeout(workerTimeout);
          channel.port1.close();
          worker && worker.terminate();
          if (workerUrl) URL.revokeObjectURL(workerUrl);
          parent.postMessage({token,...data}, '*');
        };
        try {
          workerUrl = URL.createObjectURL(new Blob([workerSource], {type:'text/javascript'}));
          worker = new Worker(workerUrl);
          URL.revokeObjectURL(workerUrl); workerUrl = undefined;
          workerTimeout = setTimeout(() => finish({error:'Execution exceeded the 2-second limit.'}), ${browserRunnerLimits.executionMilliseconds});
          channel.port1.onmessage = result => finish(result.data && typeof result.data === 'object'
            ? result.data : {error:'The code runner returned invalid results.'});
          worker.onerror = error => finish({error:String(error.message || 'Code execution failed.').slice(0, ${browserRunnerLimits.diagnosticUnits})});
          worker.postMessage({code,casesJson}, [channel.port2]);
        } catch(error) { finish({error:String(error && error.message || error).slice(0, ${browserRunnerLimits.diagnosticUnits})}); }
      });
      parent.postMessage({ready:true}, '*');
    <\/script>`;
    const timeout = setTimeout(() => finish(undefined, 'The isolated runner did not respond.'), browserRunnerLimits.responseMilliseconds);
    function finish(results?: TestResult[], error?: string) {
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      frame.remove();
      if (error) reject(new Error(error));
      else resolve(results!);
    }
    function onMessage(event: MessageEvent) {
      if (event.source !== frame.contentWindow) return;
      if (event.data?.ready) frame.contentWindow?.postMessage({ code, casesJson, token }, '*');
      else if (event.data?.token === token) {
        if (event.data.error) finish(undefined, String(event.data.error));
        else try{finish(resultPayload(event.data.payload,cases));}
        catch(error){finish(undefined,error instanceof Error?error.message:'The code runner returned invalid results.');}
      }
    }
    window.addEventListener('message', onMessage);
    document.body.append(frame);
  });
}
