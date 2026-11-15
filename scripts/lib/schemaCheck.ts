// Checks a real JSON reply against an OpenAPI contract: the status code is one the contract declares,
// field names are exact, types and enums are right, dates are real date-time strings, nothing extra,
// nothing missing. Shared by `npm run verify` (our own contract) and `npm run ring:status` (Sherehe's).

import { isRealDateTime } from '../../validation';

// The replies being checked are arbitrary JSON, read by field name in many small checks. One named
// alias, with this reason, instead of a cast at each of the dozens of field reads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export interface SchemaNode {
  $ref?: string;
  type?: string;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  enum?: unknown[];
  format?: string;
  nullable?: boolean;
  anyOf?: SchemaNode[];
  oneOf?: SchemaNode[];
  allOf?: SchemaNode[];
  required?: string[];
  content?: Record<string, { schema?: SchemaNode }>;
}

export interface ContractDoc {
  openapi?: string;
  info?: { title?: string; version?: string };
  paths: Record<string, Record<string, { responses?: Record<string, SchemaNode> }>>;
  components?: { schemas?: Record<string, SchemaNode> };
}

export interface Checker {
  resolve(node: SchemaNode | undefined): SchemaNode | undefined;
  declaredResponse(pathTemplate: string, method: string, status: number): SchemaNode | null;
  schemaCheck(value: Json, node: SchemaNode | undefined, where: string, problems: string[]): void;
}

export function createChecker(contract: ContractDoc): Checker {
  function resolve(node: SchemaNode | undefined): SchemaNode | undefined {
    let current = node;
    while (current && current.$ref) {
      current = current.$ref.replace('#/', '').split('/').reduce<Json>((found, key) => (found === undefined ? undefined : found[key]), contract) as SchemaNode | undefined;
    }
    return current;
  }

  function declaredResponse(pathTemplate: string, method: string, status: number): SchemaNode | null {
    const op = contract.paths[pathTemplate] && contract.paths[pathTemplate][method.toLowerCase()];
    return op && op.responses ? resolve(op.responses[String(status)]) || null : null;
  }

  // allOf: one object schema with every branch's properties, so "an Event plus a roles array" is checked as one object.
  function flatten(schema: SchemaNode): SchemaNode {
    if (!schema.allOf) return schema;
    const merged: SchemaNode = { type: 'object', properties: {} };
    const required: string[] = [];
    let everyBranchSaysRequired = true;
    for (const part of schema.allOf) {
      const branch = flatten(resolve(part) ?? {});
      Object.assign(merged.properties!, branch.properties);
      if (Array.isArray(branch.required)) required.push(...branch.required);
      else everyBranchSaysRequired = false;
    }
    if (everyBranchSaysRequired) merged.required = required;
    return merged;
  }

  function schemaCheck(value: Json, node: SchemaNode | undefined, where: string, problems: string[]): void {
    const resolved = resolve(node);
    if (!resolved) return;
    // anyOf / oneOf: the value must satisfy at least one branch. When none does, the problems reported are those of
    // the branch it came closest to, so the message says what to fix and not only that nothing matched.
    const alternatives = resolved.anyOf ?? resolved.oneOf;
    if (alternatives) {
      const attempts = alternatives.map((branch) => { const found: string[] = []; schemaCheck(value, branch, where, found); return found; });
      if (attempts.some((found) => found.length === 0)) return;
      problems.push(...attempts.reduce((best, found) => (found.length < best.length ? found : best)));
      return;
    }
    const schema = flatten(resolved);
    if (value === null && schema.nullable) return; // for example jobId, which is null until an offer is accepted
    if (schema.type === 'array') {
      if (!Array.isArray(value)) { problems.push(`${where} should be an array`); return; }
      value.forEach((item, i) => schemaCheck(item, schema.items, `${where}[${i}]`, problems));
      return;
    }
    if (schema.type === 'object') {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        problems.push(`${where} should be an object`);
        return;
      }
      const props = schema.properties || {};
      // A property the schema lists under `required` must be there. A schema with no `required` list
      // expects every property it declares (how this checker always read it). A property declared but
      // not required may be left out, for example places, which is sent only for a job with several.
      const required = Array.isArray(schema.required) ? schema.required : null;
      for (const key of Object.keys(props)) {
        if (!(key in value)) { if (!required || required.includes(key)) problems.push(`${where}.${key} is missing`); }
        else schemaCheck(value[key], props[key], `${where}.${key}`, problems);
      }
      for (const key of Object.keys(value)) {
        if (!(key in props)) problems.push(`${where}.${key} is not in the contract`);
      }
      return;
    }
    if (schema.type === 'string' && typeof value !== 'string') { problems.push(`${where} should be a string, got ${typeof value}`); return; }
    if (schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) { problems.push(`${where} should be a number, got ${typeof value}`); return; }
    if (schema.type === 'integer' && !Number.isInteger(value)) { problems.push(`${where} should be an integer`); return; }
    if (schema.type === 'boolean' && typeof value !== 'boolean') { problems.push(`${where} should be a boolean, got ${typeof value}`); return; }
    if (schema.enum && !schema.enum.includes(value)) problems.push(`${where} is "${value}", which is not one of ${schema.enum.join(', ')}`);
    if (schema.format === 'date-time' && !isRealDateTime(value)) problems.push(`${where} "${value}" is not a date-time string`);
  }

  return { resolve, declaredResponse, schemaCheck };
}
