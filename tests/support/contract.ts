import { readFileSync } from 'node:fs';
import { expect as baseExpect } from '@playwright/test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

/**
 * Contract checks: responses are validated against the schemas in the published OpenAPI spec
 * (site/openapi.json), so the docs and the API cannot drift apart without a test failing.
 */
const spec = JSON.parse(readFileSync(new URL('../../site/openapi.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(spec, 'openapi');

export type SchemaName = keyof typeof spec.components.schemas;

export const expect = baseExpect.extend({
  toMatchSchema(received: unknown, name: string) {
    const validate = ajv.getSchema(`openapi#/components/schemas/${name}`);
    if (!validate) return { pass: false, message: () => `No schema "${name}" in openapi.json`, name: 'toMatchSchema' };
    const pass = validate(received) as boolean;
    return {
      pass,
      name: 'toMatchSchema',
      message: () =>
        pass
          ? `expected body not to match schema ${name}`
          : `body does not match schema ${name}:\n${ajv.errorsText(validate.errors, { separator: '\n' })}\n\n${JSON.stringify(received, null, 2)}`,
    };
  },
});
