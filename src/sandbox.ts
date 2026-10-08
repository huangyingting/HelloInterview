import type { Problem } from '../shared/types';

export interface TestResult { label: string; passed: boolean; actual: string; expected: string; error?: string }

export function runCode(code: string, cases: NonNullable<Problem['testCases']>): Promise<TestResult[]> {
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
        const {code, cases, token} = event.data;
        const workerSource = \`onmessage = event => {
          const {code, cases} = event.data;
          try {
            const solve = new Function(code + '\\\\n; return solve;')();
            const results = cases.map(test => {
              try {
                const input = JSON.parse(JSON.stringify(test.input));
                const actual = solve(input);
                if (actual && typeof actual.then === 'function') throw new Error('Use a synchronous solve(input) function.');
                return {label: test.label, passed: JSON.stringify(actual) === JSON.stringify(test.expected), actual: JSON.stringify(actual) ?? 'undefined', expected: JSON.stringify(test.expected)};
              } catch(error) { return {label:test.label, passed:false, actual:'', expected:JSON.stringify(test.expected), error:String(error.message || error)}; }
            });
            postMessage({results});
          } catch(error) { postMessage({error:String(error.message || error)}); }
        }\`;
        let worker;
        try {
          worker = new Worker(URL.createObjectURL(new Blob([workerSource], {type:'text/javascript'})));
          const timeout = setTimeout(() => { worker.terminate(); parent.postMessage({token,error:'Execution exceeded the 2-second limit.'}, '*'); }, 2000);
          worker.onmessage = result => { clearTimeout(timeout); worker.terminate(); parent.postMessage({token,...result.data}, '*'); };
          worker.onerror = error => { clearTimeout(timeout); worker.terminate(); parent.postMessage({token,error:error.message || 'Code execution failed.'}, '*'); };
          worker.postMessage({code,cases});
        } catch(error) { parent.postMessage({token,error:String(error.message || error)}, '*'); }
      });
      parent.postMessage({ready:true}, '*');
    <\/script>`;
    const timeout = setTimeout(() => finish(undefined, 'The isolated runner did not respond.'), 6000);
    function finish(results?: TestResult[], error?: string) {
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      frame.remove();
      if (error) reject(new Error(error));
      else resolve(results!);
    }
    function onMessage(event: MessageEvent) {
      if (event.source !== frame.contentWindow) return;
      if (event.data?.ready) frame.contentWindow?.postMessage({ code, cases, token }, '*');
      else if (event.data?.token === token) {
        if (event.data.error) finish(undefined, String(event.data.error));
        else if (Array.isArray(event.data.results) && event.data.results.length === cases.length) finish(event.data.results as TestResult[]);
        else finish(undefined, 'The code runner returned invalid results.');
      }
    }
    window.addEventListener('message', onMessage);
    document.body.append(frame);
  });
}
