export class SecurityError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export function assertRole(actual: 'admin' | 'member' | 'viewer', required: 'admin' | 'member' | 'viewer') {
  const level = { viewer: 0, member: 1, admin: 2 };
  if (level[actual] < level[required]) throw new SecurityError(403, 'access_denied', 'Your account cannot perform this action.');
}

export function assertSameOrigin(request: Request, expectedOrigin: string) {
  if (request.headers.get('origin') !== expectedOrigin) {
    throw new SecurityError(403, 'invalid_origin', 'The request origin could not be verified.');
  }
}

export async function readJsonLimited(request: Request, maximumBytes = 65_536): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new SecurityError(415, 'json_required', 'Send an application/json request.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new SecurityError(400, 'body_required', 'A request body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new SecurityError(413, 'request_too_large', 'The request is too large.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function securityResponse(error: unknown): Response | null {
  if (!(error instanceof SecurityError)) return null;
  return Response.json({error:error.message, code:error.code}, {status:error.status, headers:{'Cache-Control':'no-store', ...(error.status === 429 ? {'Retry-After':'60'} : {})}});
}

export function logOperation(operation: string, requestId: string, outcome: string, startedAt: number) {
  // Deliberately no prompts, identifiers, result rows, tokens or provider errors.
  console.info(JSON.stringify({type:'morph_operation', operation, requestId, outcome, durationMs:Math.round(performance.now()-startedAt)}));
}
