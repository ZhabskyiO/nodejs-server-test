import type { FastifyRequest } from 'fastify';
import type { Container } from '../../platform/container.js';
import type { RequestIdentity } from '../../adapters/ports.js';

/**
 * Resolve tenant + actor for a request. Every handler starts with this, and the
 * resulting `workspaceId` is threaded into every service/repository call —
 * that's the tenancy guard.
 */
export async function getContext(
  container: Container,
  req: FastifyRequest,
): Promise<RequestIdentity> {
  return container.auth.resolve(req.headers);
}
