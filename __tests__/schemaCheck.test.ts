// scripts/lib/schemaCheck.ts checks a real reply against an OpenAPI contract. It is shared by npm run verify and by
// ring:status and ring:check (which check Sherehe's replies against Sherehe's contract). Found when Sherehe's contract
// gained a reply that is "either Event[] or EventWithRoles[]": the checker did not know anyOf and allOf, skipped such a
// schema without a word, and so stopped checking that reply at all. These tests keep it from doing that again.

import { createChecker } from '../scripts/lib/schemaCheck';
import type { ContractDoc, Json, SchemaNode } from '../scripts/lib/schemaCheck';

const contract: ContractDoc = {
  paths: {},
  components: {
    schemas: {
      Event: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
      Role: { type: 'object', properties: { id: { type: 'string' } } },
      EventWithRoles: { allOf: [{ $ref: '#/components/schemas/Event' }, { type: 'object', properties: { roles: { type: 'array', items: { $ref: '#/components/schemas/Role' } } } }] },
      Either: { anyOf: [{ type: 'array', items: { $ref: '#/components/schemas/Event' } }, { type: 'array', items: { $ref: '#/components/schemas/EventWithRoles' } }] },
    },
  },
};
const checker = createChecker(contract);
const check = (value: Json, schema: SchemaNode): string[] => { const problems: string[] = []; checker.schemaCheck(value, schema, 'reply', problems); return problems; };
const either: SchemaNode = { $ref: '#/components/schemas/Either' };
const withRoles: SchemaNode = { $ref: '#/components/schemas/EventWithRoles' };

describe('allOf', () => {
  it('checks the parts as one object: the properties of every part are expected, and no others', () => {
    expect(check({ id: 'e1', name: 'N', roles: [{ id: 'r1' }] }, withRoles)).toEqual([]);
    expect(check({ id: 'e1', name: 'N', roles: [], extra: 1 }, withRoles)).toEqual(['reply.extra is not in the contract']);
  });

  it('says what is missing from any part', () => {
    expect(check({ id: 'e1', roles: [] }, withRoles)).toEqual(['reply.name is missing']);
    expect(check({ id: 'e1', name: 'N' }, withRoles)).toEqual(['reply.roles is missing']);
  });

  it('still checks the types inside the parts', () => {
    expect(check({ id: 'e1', name: 'N', roles: [{ id: 5 }] }, withRoles)).toEqual(['reply.roles[0].id should be a string, got number']);
  });
});

describe('anyOf', () => {
  it('accepts a value that fits any one branch', () => {
    expect(check([{ id: 'e1', name: 'N' }], either)).toEqual([]);
    expect(check([{ id: 'e1', name: 'N', roles: [{ id: 'r1' }] }], either)).toEqual([]);
    expect(check([], either)).toEqual([]);
  });

  it('refuses a value that fits no branch, and reports the problems of the branch it came closest to', () => {
    expect(check([{ id: 'e1' }], either)).toEqual(['reply[0].name is missing']);
    expect(check({ not: 'a list' }, either)).not.toEqual([]);
  });

  it('is not skipped silently: a wrong reply is a problem, which is the point', () => {
    expect(check([{ id: 1, name: 'N' }], either)).toEqual(['reply[0].id should be a string, got number']);
  });
});
