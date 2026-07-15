import {
  isPublicDnsAddress,
  queryDirectDnsServer,
  type DirectDnsTarget,
} from "./authoritative.ts";
import type { RawDnsWireRecord, RawDnsWireResponse } from "./dns-wire.ts";
import { canonicalDnsName, normalizeDnsInput } from "./normalize-name.ts";
import { recordTypeCode, recordTypeName } from "./record-types.ts";
import type { DnsRecordType, NormalizedDnsRecord } from "./types.ts";
import {
  TRACE_RECORD_TYPES,
  type DnsTraceAttempt,
  type DnsTraceRecordType,
  type DnsTraceResponse,
  type DnsTraceStep,
} from "./trace-types.ts";

export { TRACE_RECORD_TYPES } from "./trace-types.ts";
export type { DnsTraceRecordType, DnsTraceResponse, DnsTraceStep } from "./trace-types.ts";

export const IANA_ROOT_SERVERS: readonly DirectDnsTarget[] = [
  { hostname: "a.root-servers.net", address: "198.41.0.4" },
  { hostname: "b.root-servers.net", address: "170.247.170.2" },
  { hostname: "c.root-servers.net", address: "192.33.4.12" },
  { hostname: "d.root-servers.net", address: "199.7.91.13" },
  { hostname: "e.root-servers.net", address: "192.203.230.10" },
  { hostname: "f.root-servers.net", address: "192.5.5.241" },
  { hostname: "g.root-servers.net", address: "192.112.36.4" },
  { hostname: "h.root-servers.net", address: "198.97.190.53" },
  { hostname: "i.root-servers.net", address: "192.36.148.17" },
  { hostname: "j.root-servers.net", address: "192.58.128.30" },
  { hostname: "k.root-servers.net", address: "193.0.14.129" },
  { hostname: "l.root-servers.net", address: "199.7.83.42" },
  { hostname: "m.root-servers.net", address: "202.12.27.33" },
];

type DirectQuery = (
  name: string,
  type: DnsRecordType,
  target: DirectDnsTarget,
  options: { signal?: AbortSignal; timeoutMs?: number },
) => Promise<RawDnsWireResponse>;

type TraceOptions = {
  queryImpl?: DirectQuery;
  rootServers?: readonly DirectDnsTarget[];
  signal?: AbortSignal;
  timeoutMs?: number;
};

type TraceContext = {
  queryImpl: DirectQuery;
  rootServers: readonly DirectDnsTarget[];
  signal?: AbortSignal;
  timeoutMs: number;
  queryCount: number;
  steps: DnsTraceStep[];
  warnings: string[];
  resolvingNameservers: Set<string>;
};

type Resolution = {
  outcome: DnsTraceResponse["outcome"];
  finalName: string;
  records: NormalizedDnsRecord[];
  error: string | null;
};

const MAX_TOTAL_QUERIES = 64;
const MAX_REFERRALS = 16;
const MAX_ALIASES = 8;
const MAX_SERVER_ATTEMPTS = 3;
const MAX_NS_HOSTNAMES = 3;

export function normalizeTraceRecordType(value: unknown): DnsTraceRecordType {
  const upper = typeof value === "string" ? value.toUpperCase() : "";
  if (TRACE_RECORD_TYPES.includes(upper as DnsTraceRecordType)) return upper as DnsTraceRecordType;
  throw new Error("Choose one supported record type for the trace.");
}

function responseCode(status: number) {
  return ["NOERROR", "FORMERR", "SERVFAIL", "NXDOMAIN", "NOTIMP", "REFUSED"][status] ?? `RCODE${status}`;
}

function normalizeRawRecord(record: RawDnsWireRecord): NormalizedDnsRecord {
  return {
    ownerName: canonicalDnsName(record.name),
    type: recordTypeName(record.type),
    typeCode: record.type,
    value: record.data,
    resolverTtlSeconds: typeof record.TTL === "number" && Number.isFinite(record.TTL) ? record.TTL : null,
  };
}

function stageForZone(zone: string): DnsTraceStep["stage"] {
  if (zone === ".") return "root";
  return zone.split(".").length === 1 ? "tld" : "authoritative";
}

function serverDescription(zone: string) {
  if (zone === ".") return "The root nameserver";
  if (!zone.includes(".")) return `The .${zone} nameserver`;
  return "The authoritative nameserver";
}

function stableRootOrder(name: string, roots: readonly DirectDnsTarget[]) {
  if (roots.length < 2) return [...roots];
  const start = [...name].reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 0) % roots.length;
  return [...roots.slice(start), ...roots.slice(0, start)];
}

function isInsideZone(name: string, zone: string) {
  return zone === "." || name === zone || name.endsWith(`.${zone}`);
}

function referralFrom(response: RawDnsWireResponse, questionName: string, parentZone: string) {
  const byZone = new Map<string, string[]>();
  for (const record of response.Authority) {
    if (record.type !== 2) continue;
    const zone = canonicalDnsName(record.name);
    const nameserver = canonicalDnsName(record.data);
    byZone.set(zone, [...(byZone.get(zone) ?? []), nameserver]);
  }
  const candidates = [...byZone]
    .filter(([zone]) => questionName === zone || questionName.endsWith(`.${zone}`))
    .sort(([left], [right]) => right.split(".").length - left.split(".").length);
  const [delegatedZone, nameservers] = candidates[0] ?? [];
  if (!delegatedZone || !nameservers?.length) return null;
  const nameserverSet = new Set(nameservers);
  const addressRecords = response.Additional.filter((record) => (
    (record.type === 1 || record.type === 28)
    && nameserverSet.has(canonicalDnsName(record.name))
    && isPublicDnsAddress(record.data)
  ));
  const glue = addressRecords.filter((record) => {
    const ownerName = canonicalDnsName(record.name);
    return isInsideZone(ownerName, delegatedZone) || isInsideZone(ownerName, parentZone);
  });
  const glueKeys = new Set(glue.map((record) => `${record.name}:${record.type}:${record.data}`));
  const additionalAddresses = addressRecords.filter((record) => !glueKeys.has(`${record.name}:${record.type}:${record.data}`));
  return { delegatedZone, nameservers: [...new Set(nameservers)], glue, additionalAddresses };
}

async function queryCandidates(
  questionName: string,
  type: DnsTraceRecordType,
  candidates: DirectDnsTarget[],
  context: TraceContext,
) {
  const attempts: DnsTraceAttempt[] = [];
  for (const server of candidates.slice(0, MAX_SERVER_ATTEMPTS)) {
    if (context.queryCount >= MAX_TOTAL_QUERIES) break;
    context.queryCount += 1;
    const started = performance.now();
    try {
      const response = await context.queryImpl(questionName, type, server, {
        signal: context.signal,
        timeoutMs: context.timeoutMs,
      });
      const durationMs = Math.max(0, Math.round(performance.now() - started));
      if (response.Status === 2 || response.Status === 5) {
        attempts.push({
          server,
          durationMs,
          error: `${responseCode(response.Status)} response`,
        });
        continue;
      }
      return { attempts, durationMs, response, server };
    } catch (error) {
      attempts.push({
        server,
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        error: error instanceof Error ? error.message : "The nameserver query failed.",
      });
    }
  }
  return { attempts, durationMs: null, response: null, server: null };
}

async function resolveNameserverAddresses(nameservers: string[], context: TraceContext) {
  const targets: DirectDnsTarget[] = [];
  for (const hostname of nameservers.slice(0, MAX_NS_HOSTNAMES)) {
    for (const type of ["A", "AAAA"] as const) {
      const key = `${hostname}:${type}`;
      if (context.resolvingNameservers.has(key)) continue;
      context.resolvingNameservers.add(key);
      try {
        const resolution = await resolveIteratively(hostname, type, context, false, new Set(), 0);
        for (const record of resolution.records) {
          if ((record.type === "A" || record.type === "AAAA") && isPublicDnsAddress(record.value)) {
            targets.push({ hostname, address: record.value });
          }
        }
      } finally {
        context.resolvingNameservers.delete(key);
      }
      if (targets.length >= MAX_SERVER_ATTEMPTS) return targets;
    }
  }
  return targets;
}

function addStep(context: TraceContext, collectSteps: boolean, step: Omit<DnsTraceStep, "sequence">) {
  if (!collectSteps) return;
  context.steps.push({ ...step, sequence: context.steps.length + 1 });
}

async function resolveIteratively(
  initialName: string,
  type: DnsTraceRecordType,
  context: TraceContext,
  collectSteps: boolean,
  aliases: Set<string>,
  aliasDepth: number,
): Promise<Resolution> {
  let questionName = initialName;
  let candidates = stableRootOrder(questionName, context.rootServers);
  let zone = ".";

  for (let referralDepth = 0; referralDepth <= MAX_REFERRALS; referralDepth += 1) {
    if (context.signal?.aborted) throw new DOMException("The DNS trace was aborted.", "AbortError");
    if (context.queryCount >= MAX_TOTAL_QUERIES) {
      return { outcome: "error", finalName: questionName, records: [], error: "The trace reached its safe query limit." };
    }

    const queried = await queryCandidates(questionName, type, candidates, context);
    if (!queried.response || !queried.server) {
      const message = `We could not get a usable response from ${zone === "." ? "the root nameservers" : `the nameservers for ${zone}`}.`;
      addStep(context, collectSteps, {
        stage: stageForZone(zone),
        zone,
        server: null,
        questionName,
        requestedType: type,
        responseCode: null,
        authoritative: null,
        durationMs: null,
        outcome: "error",
        message,
        delegatedZone: null,
        nameservers: [],
        glueRecords: [],
        additionalAddressRecords: [],
        answerRecords: [],
        aliasTarget: null,
        attempts: queried.attempts,
        rawResponse: null,
      });
      return { outcome: "error", finalName: questionName, records: [], error: message };
    }

    const response = queried.response;
    const allAnswers = response.Answer.map(normalizeRawRecord);
    const requestedCode = recordTypeCode(type);
    const terminalRecords = allAnswers.filter((record) => record.typeCode === requestedCode);
    const cname = response.Answer.find((record) => record.type === 5);
    const aliasTarget = cname ? canonicalDnsName(cname.data) : null;
    const base = {
      stage: stageForZone(zone),
      zone,
      server: queried.server,
      questionName,
      requestedType: type,
      responseCode: responseCode(response.Status),
      authoritative: response.AA,
      durationMs: queried.durationMs,
      delegatedZone: null,
      nameservers: [],
      glueRecords: [],
      additionalAddressRecords: [],
      attempts: queried.attempts,
      rawResponse: response,
    } satisfies Partial<DnsTraceStep>;

    if (response.Status === 3) {
      const message = `${serverDescription(zone)} says ${questionName} does not exist.`;
      addStep(context, collectSteps, { ...base, outcome: "nxdomain", message, answerRecords: allAnswers, aliasTarget } as Omit<DnsTraceStep, "sequence">);
      return { outcome: "nxdomain", finalName: questionName, records: allAnswers, error: null };
    }
    if (response.Status !== 0) {
      const message = `${serverDescription(zone)} returned ${responseCode(response.Status)}, so the trace stopped here.`;
      addStep(context, collectSteps, { ...base, outcome: "error", message, answerRecords: allAnswers, aliasTarget } as Omit<DnsTraceStep, "sequence">);
      return { outcome: "error", finalName: questionName, records: allAnswers, error: message };
    }

    if (terminalRecords.length > 0) {
      const noun = terminalRecords.length === 1 ? "record" : "records";
      const message = `${serverDescription(zone)} returned the ${type} ${noun} for ${questionName}.`;
      addStep(context, collectSteps, { ...base, outcome: "answer", message, answerRecords: allAnswers, aliasTarget } as Omit<DnsTraceStep, "sequence">);
      return { outcome: "found", finalName: questionName, records: allAnswers, error: null };
    }

    if (aliasTarget && type !== "CNAME") {
      const message = `${serverDescription(zone)} says ${questionName} is an alias for ${aliasTarget}. The trace continues with that name.`;
      addStep(context, collectSteps, { ...base, outcome: "alias", message, answerRecords: allAnswers, aliasTarget } as Omit<DnsTraceStep, "sequence">);
      if (aliases.has(aliasTarget)) {
        return { outcome: "error", finalName: questionName, records: allAnswers, error: "The trace found a CNAME loop." };
      }
      if (aliasDepth >= MAX_ALIASES) {
        return { outcome: "error", finalName: questionName, records: allAnswers, error: "The trace reached its safe alias limit." };
      }
      aliases.add(aliasTarget);
      const followed = await resolveIteratively(aliasTarget, type, context, collectSteps, aliases, aliasDepth + 1);
      return { ...followed, records: [...allAnswers, ...followed.records] };
    }

    const referral = referralFrom(response, questionName, zone);
    if (referral) {
      const visibleZone = referral.delegatedZone.includes(".") ? referral.delegatedZone : `.${referral.delegatedZone}`;
      const message = `${serverDescription(zone)} pointed us to the nameservers responsible for ${visibleZone}.`;
      addStep(context, collectSteps, {
        ...base,
        outcome: "referral",
        message,
        delegatedZone: referral.delegatedZone,
        nameservers: referral.nameservers,
        glueRecords: referral.glue.map(normalizeRawRecord),
        additionalAddressRecords: referral.additionalAddresses.map(normalizeRawRecord),
        answerRecords: allAnswers,
        aliasTarget: null,
      } as Omit<DnsTraceStep, "sequence">);

      let nextTargets = [...referral.glue, ...referral.additionalAddresses].map((record) => ({
        hostname: canonicalDnsName(record.name),
        address: record.data,
      }));
      if (nextTargets.length === 0) {
        nextTargets = await resolveNameserverAddresses(referral.nameservers, context);
      }
      if (nextTargets.length === 0) {
        const error = `The referral named servers for ${referral.delegatedZone}, but their public addresses could not be found.`;
        return { outcome: "error", finalName: questionName, records: [], error };
      }
      candidates = nextTargets;
      zone = referral.delegatedZone;
      continue;
    }

    const message = `${serverDescription(zone)} answered for ${questionName}, but it did not return a ${type} record.`;
    addStep(context, collectSteps, { ...base, outcome: "no_answer", message, answerRecords: allAnswers, aliasTarget } as Omit<DnsTraceStep, "sequence">);
    return { outcome: "no_answer", finalName: questionName, records: allAnswers, error: null };
  }

  return { outcome: "error", finalName: questionName, records: [], error: "The trace reached its safe referral limit." };
}

export async function traceDns(
  request: { name: string; recordType: unknown },
  options: TraceOptions = {},
): Promise<DnsTraceResponse> {
  const normalized = normalizeDnsInput(request.name);
  if (normalized.inputKind === "ip") throw new Error("Enter a domain or hostname rather than an IP address.");
  const recordType = normalizeTraceRecordType(request.recordType);
  const roots = options.rootServers ?? IANA_ROOT_SERVERS;
  if (roots.length === 0 || roots.some((root) => !isPublicDnsAddress(root.address))) {
    throw new Error("The DNS trace does not have a safe root nameserver to start from.");
  }
  const started = performance.now();
  const context: TraceContext = {
    queryImpl: options.queryImpl ?? queryDirectDnsServer,
    rootServers: roots,
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? 2200,
    queryCount: 0,
    steps: [],
    warnings: [],
    resolvingNameservers: new Set(),
  };
  const aliases = new Set<string>([normalized.normalizedName]);
  const resolution = await resolveIteratively(normalized.normalizedName, recordType, context, true, aliases, 0);
  if (resolution.error) context.warnings.push(resolution.error);

  return {
    query: {
      originalInput: normalized.originalInput,
      normalizedName: normalized.normalizedName,
      recordType,
    },
    checkedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    outcome: resolution.outcome,
    finalName: resolution.finalName,
    finalRecords: resolution.records,
    steps: context.steps,
    warnings: [...new Set(context.warnings)],
  };
}
