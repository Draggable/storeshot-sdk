// SS-018 consumer fixture (moduleResolution: bundler, lib ES2022 + DOM, no Node types): what a
// browser or edge project compiles. The public types must not need @types/node.
import { Storeshot, constructWebhookEvent, type WebhookEvent } from '@draggable/storeshot-sdk';

export async function handle(request: Request, secret: string): Promise<Response> {
  const event: WebhookEvent = await constructWebhookEvent({
    payload: await request.arrayBuffer(),
    signature: request.headers.get('Storeshot-Signature'),
    secret,
  });
  if (event.type === 'generation.succeeded') console.log(event.data.id);
  const client = new Storeshot({ apiKey: 'ss_test_x', fetch });
  const stream: ReadableStream<Uint8Array> = await client.screenshotSets.archiveStream('s');
  await client.uploads.create({ file: new Blob([]), filename: 'a.png' });
  return new Response(stream);
}
