'use client';

// Swagger UI for the contract. The spec is read from /openapi.yaml, and its server is set to the address this
// page was opened from, so "Try it out" works the same on localhost and on the hosted site.

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import YAML from 'yaml';
import 'swagger-ui-react/swagger-ui.css';

const SwaggerUI = dynamic(() => import('swagger-ui-react'), { ssr: false, loading: () => <p className="p-10 text-muted">Loading the documentation.</p> });

export function ApiDocs() {
  const [spec, setSpec] = useState<Record<string, unknown> | null>(null);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/openapi.yaml');
        const contract = YAML.parse(await res.text()) as Record<string, unknown>;
        if (!cancelled) setSpec({ ...contract, servers: [{ url: window.location.origin, description: 'This server' }] });
      } catch {
        if (!cancelled) setProblem('The contract could not be loaded.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (problem) return <p className="p-10 font-semibold text-bad">{problem}</p>;
  if (!spec) return <p className="p-10 text-muted">Loading the documentation.</p>;
  return <SwaggerUI spec={spec} />;
}
