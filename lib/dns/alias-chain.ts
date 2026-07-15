import { canonicalDnsName } from "./normalize-name.ts";
import type { DnsAliasEdge, DnsAliasObservation, DnsWarning } from "./types.ts";

function minReportedTtl(a: number | null, b: number | null) {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

function deduplicateEdges(edges: DnsAliasEdge[]) {
  const values = new Map<string, DnsAliasEdge>();
  for (const edge of edges) {
    const normalized = {
      from: canonicalDnsName(edge.from),
      to: canonicalDnsName(edge.to),
      resolverTtlSeconds: edge.resolverTtlSeconds,
    };
    const key = `${normalized.from}\u0000${normalized.to}`;
    const existing = values.get(key);
    values.set(key, existing
      ? { ...existing, resolverTtlSeconds: minReportedTtl(existing.resolverTtlSeconds, normalized.resolverTtlSeconds) }
      : normalized);
  }
  return [...values.values()];
}

export function normalizeAliasEdges(startName: string, edges: DnsAliasEdge[], maxDepth = 16) {
  const deduplicated = deduplicateEdges(edges);
  const targetsByOwner = new Map<string, DnsAliasEdge[]>();
  for (const edge of deduplicated) {
    const values = targetsByOwner.get(edge.from) ?? [];
    values.push(edge);
    targetsByOwner.set(edge.from, values);
  }

  const warnings: DnsWarning[] = [];
  if ([...targetsByOwner.values()].some((values) => values.length > 1)) {
    warnings.push({
      code: "alias_chain_inconsistent",
      message: "Separate DNS answers reported different alias targets for the same owner name.",
    });
    return { aliasChain: [], consistent: false, warnings };
  }

  const aliasChain: DnsAliasEdge[] = [];
  const used = new Set<string>();
  const visited = new Set([canonicalDnsName(startName)]);
  let current = canonicalDnsName(startName);

  while (targetsByOwner.has(current)) {
    if (aliasChain.length >= maxDepth) {
      warnings.push({
        code: "alias_depth_exceeded",
        message: `Alias ordering stopped after ${maxDepth} edges.`,
      });
      break;
    }

    const edge = targetsByOwner.get(current)?.[0];
    if (!edge) break;
    aliasChain.push(edge);
    used.add(`${edge.from}\u0000${edge.to}`);
    if (visited.has(edge.to)) {
      warnings.push({
        code: "alias_loop_detected",
        message: `The alias chain loops back to ${edge.to}.`,
      });
      break;
    }
    visited.add(edge.to);
    current = edge.to;
  }

  if (used.size < deduplicated.length && warnings.length === 0) {
    warnings.push({
      code: "alias_chain_inconsistent",
      message: "The resolver responses contained alias edges that cannot be ordered into one chain.",
    });
    return { aliasChain: [], consistent: false, warnings };
  }

  return { aliasChain, consistent: warnings.length === 0, warnings };
}

export function buildUnifiedAliasChain(
  startName: string,
  observations: DnsAliasObservation[],
  maxDepth = 16,
) {
  const allEdges = observations.flatMap((observation) => observation.aliasChain);
  return normalizeAliasEdges(startName, allEdges, maxDepth);
}
