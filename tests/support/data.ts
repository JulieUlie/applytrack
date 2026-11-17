import { randomUUID } from 'node:crypto';
import type { ApplicationInput } from './types';

/** A unique suffix so parallel tests never collide on names. */
export const uid = () => randomUUID().slice(0, 8);

export const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/** Test data builder: a valid application, override only what the test cares about. */
export function anApplication(overrides: Partial<ApplicationInput> = {}): ApplicationInput {
  return {
    company: `Acme ${uid()}`,
    role: 'Test Automation Engineer',
    status: 'applied',
    appliedOn: isoDaysAgo(3),
    location: 'Antwerp',
    link: 'https://example.com/jobs/123',
    notes: 'Created by an automated test',
    ...overrides,
  };
}
