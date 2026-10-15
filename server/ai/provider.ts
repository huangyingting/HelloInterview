import { z } from 'zod';
import type { ManagedAiConfig } from './config';
import { managedAiResultSchema, type ManagedAiResult } from './schema';
import { HttpError } from '../http-error';
import { digest, encodePayload } from '../jobs/schema';
import { inputEnvelopeSchema } from '../usage/schema';

const responseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().min(1).max(12000) }) })).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
  }),
});

export class ManagedAiProviderError extends Error {
  constructor(readonly code: 'unavailable' | 'timeout' | 'invalid-response' | 'cost-unavailable', message: string) {
    super(message);
    this.name = 'ManagedAiProviderError';
  }
}

function jsonContent(value: string) {
  const stripped = value.replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    return JSON.parse(stripped) as unknown;
  } catch {
    throw new ManagedAiProviderError('invalid-response', 'The managed AI provider returned invalid JSON.');
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json' || !response.body) {
    throw new ManagedAiProviderError('invalid-response', 'The managed AI provider did not return JSON.');
  }
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 262_144)) {
    throw new ManagedAiProviderError('invalid-response', 'The managed AI provider response exceeded its byte limit.');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 262_144) {
        await reader.cancel();
        throw new ManagedAiProviderError('invalid-response', 'The managed AI provider response exceeded its byte limit.');
      }
      chunks.push(part.value);
    }
    const body = Buffer.concat(chunks.map(chunk => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)), bytes);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown;
  } catch (error) {
    if (error instanceof ManagedAiProviderError) throw error;
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw new ManagedAiProviderError('invalid-response', 'The managed AI provider returned invalid JSON bytes.');
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export class ManagedAiProvider {
  constructor(private readonly config: ManagedAiConfig['provider']) {}

  async evaluate(input: unknown, signal?: AbortSignal): Promise<{
    result: ManagedAiResult;
    resultHash: string;
    actualCostMicros: number;
  }> {
    const envelope = inputEnvelopeSchema.parse(input);
    const body = {
      max_completion_tokens: this.config.maxCompletionTokens,
      messages: [
        { role: 'system', content: envelope.prompt.text },
        { role: 'user', content: encodePayload({ source: envelope.source, data: envelope.data }, 131072) },
      ],
    };
    let response: Response;
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    try {
      response = await fetch(
        `${this.config.endpoint}/openai/deployments/${encodeURIComponent(this.config.deployment)}/chat/completions?api-version=${encodeURIComponent(this.config.apiVersion)}`,
        {
          method: 'POST',
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          headers: { 'Content-Type': 'application/json', 'api-key': this.config.apiKey },
          body: JSON.stringify(body),
        },
      );
    } catch (error) {
      if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) {
        throw new ManagedAiProviderError('timeout', 'The managed AI provider request did not produce a known outcome.');
      }
      if (error instanceof TypeError) {
        throw new ManagedAiProviderError('unavailable', 'The managed AI provider could not be reached.');
      }
      throw error;
    }
    if (!response.ok) {
      throw new ManagedAiProviderError('unavailable', `The managed AI provider returned HTTP ${response.status}.`);
    }
    let parsed: z.infer<typeof responseSchema>;
    try {
      parsed = responseSchema.parse(await boundedJson(response));
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof z.ZodError) {
        throw new ManagedAiProviderError('invalid-response', 'The managed AI provider response shape was invalid.');
      }
      throw error;
    }
    const kind = envelope.source.kind;
    const output = jsonContent(parsed.choices[0].message.content);
    let result: ManagedAiResult;
    try {
      result = managedAiResultSchema.parse({ kind, output });
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ManagedAiProviderError('invalid-response', 'The managed AI provider output fields were invalid.');
      }
      throw error;
    }
    const actualCostMicros = Math.ceil((
      parsed.usage.prompt_tokens * this.config.inputPriceMicrosPerMillionTokens
      + parsed.usage.completion_tokens * this.config.outputPriceMicrosPerMillionTokens
    ) / 1_000_000);
    if (!Number.isSafeInteger(actualCostMicros) || actualCostMicros < 0) {
      throw new ManagedAiProviderError('cost-unavailable', 'The managed AI provider cost could not be measured.');
    }
    return { result, resultHash: digest(encodePayload(result)), actualCostMicros };
  }
}
