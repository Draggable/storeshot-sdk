export interface RecordedCall {
  method: string;
  url: string;
  headers: Headers;
  body: BodyInit | null | undefined;
  signal: AbortSignal | null | undefined;
}

export type Reply = Response | Error | ((call: RecordedCall) => Response | Promise<Response>);

/** A fetch that records every call and answers from a queue (the last reply repeats). */
export function recordingFetch(...replies: Reply[]) {
  const calls: RecordedCall[] = [];
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call: RecordedCall = {
      method: init.method ?? 'GET',
      url: String(input),
      headers: new Headers(init.headers),
      body: init.body,
      signal: init.signal,
    };
    calls.push(call);
    const reply = replies.length > 1 ? replies.shift()! : replies[0];
    if (reply instanceof Error) throw reply;
    if (typeof reply === 'function') return reply(call);
    return reply.clone();
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-test', ...headers },
  });

export const envelope = (status: number, code: string, headers: Record<string, string> = {}) =>
  json(
    status,
    {
      error: {
        code,
        message: `${code} message`,
        requestId: 'req-env',
        docUrl: `https://storeshot.art/docs/errors/#${code.toLowerCase()}`,
      },
    },
    headers,
  );

/** The rejection of a promise that must reject (fails the test when it resolves). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const rejection = (promise: Promise<unknown>): Promise<any> =>
  promise.then(
    () => {
      throw new Error('expected the promise to reject');
    },
    (error: unknown) => error,
  );
