import {
  decodeMessage,
  DoHResolver,
  parseRRSIG,
  RecordingResolver,
  type CapturedEntry,
  type RRSIG_RD,
  type WalkResult,
  type WalkStep,
  typeName,
  walk,
} from "@namefi/dnssec-audit";
import { queryPublicResolver } from "./doh.ts";
import { safeDnsErrorMessage } from "./errors.ts";
import { dnsResponseCode, normalizeChangeRecordType, normalizeDiagnosticName, normalizeWireRecord, type PublicDiagnosticQuery } from "./diagnostics.ts";
import type { RawDnsWireResponse } from "./dns-wire.ts";
import { canonicalDnsName } from "./normalize-name.ts";
import { recordTypeCode } from "./record-types.ts";
import type { DnssecSignature } from "./dnssec-types.ts";

export const DNSSEC_RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "CAA", "SOA", "SRV"] as const;
export type DnssecRecordType = (typeof DNSSEC_RECORD_TYPES)[number];
export type DnssecVerdict = "secure" | "insecure" | "bogus" | "indeterminate";

export function normalizeDnssecRecordType(value: unknown): DnssecRecordType {
  const type = normalizeChangeRecordType(value);
  if (DNSSEC_RECORD_TYPES.includes(type as DnssecRecordType)) return type as DnssecRecordType;
  throw new Error("Choose A, AAAA, CNAME, MX, NS, TXT, CAA, SOA, or SRV.");
}

export function parseDelvVerdict(output: string, exitCode = 0): { verdict: DnssecVerdict; explanation: string } {
  const lower = output.toLowerCase();
  const failure = output.split("\n").map((line) => line.trim()).find((line) => /validation failed|broken trust chain|bad signature|no valid signature|insecurity proof|dnssec.*failed/i.test(line));
  if (/validation failed|broken trust chain|bad signature|no valid signature|insecurity proof failed|must be secure/i.test(lower)) {
    return { verdict: "bogus", explanation: failure ?? "The validator could not build a valid chain of signatures to the root trust anchor." };
  }
  if (/fully validated|trust secure|validated successfully/i.test(lower)) {
    return { verdict: "secure", explanation: "The validator built a complete chain of trust to the DNS root." };
  }
  if (/unsigned answer|trust answer|insecure answer|proved insecure/i.test(lower) && exitCode === 0) {
    return { verdict: "insecure", explanation: "The validator found an unsigned delegation rather than a broken signed chain." };
  }
  return { verdict: "indeterminate", explanation: exitCode === 0 ? "The validator returned data but did not provide a verdict we can safely classify." : "The local DNSSEC validator could not complete the check." };
}

type ValidationOutcome = WalkResult["verdict"];
type ValidatorResult = {
  verdict: DnssecVerdict;
  validationOutcome: ValidationOutcome | null;
  explanation: string;
  rawReport: unknown;
  exitCode: number;
  zones: string[];
  steps: WalkStep[];
  signatures: DnssecSignature[];
};
type ValidatorRunner = (name: string, type: DnssecRecordType) => Promise<ValidatorResult>;

const DNSSEC_ALGORITHMS: Record<number, string> = {
  5: "RSASHA1",
  7: "RSASHA1-NSEC3-SHA1",
  8: "RSASHA256",
  10: "RSASHA512",
  13: "ECDSAP256SHA256",
  14: "ECDSAP384SHA384",
  15: "ED25519",
  16: "ED448",
};

export function dnssecSignatureFromRrsig(
  signature: RRSIG_RD,
  context: { ownerName: string; queryName: string; queryType: number },
  now = new Date(),
): DnssecSignature {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const status = signature.signatureExpiration < nowSeconds
    ? "expired"
    : signature.signatureInception > nowSeconds
      ? "not-yet-valid"
      : "valid";
  return {
    ownerName: canonicalDnsName(context.ownerName),
    queryName: canonicalDnsName(context.queryName),
    queryType: typeName(context.queryType),
    typeCovered: typeName(signature.typeCovered),
    algorithm: signature.algorithm,
    algorithmName: DNSSEC_ALGORITHMS[signature.algorithm] ?? `Algorithm ${signature.algorithm}`,
    keyTag: signature.keyTag,
    signerName: canonicalDnsName(signature.signerName),
    inception: new Date(signature.signatureInception * 1000).toISOString(),
    expiration: new Date(signature.signatureExpiration * 1000).toISOString(),
    status,
    secondsRemaining: signature.signatureExpiration - nowSeconds,
  };
}

function signaturesFromEntries(entries: CapturedEntry[], now = new Date()) {
  const signatures: DnssecSignature[] = [];
  for (const entry of entries) {
    try {
      const message = decodeMessage(Buffer.from(entry.wire_b64, "base64"));
      for (const record of [...message.answers, ...message.authorities, ...message.additionals]) {
        if (record.type !== 46) continue;
        signatures.push(dnssecSignatureFromRrsig(parseRRSIG(record), {
          ownerName: record.name,
          queryName: entry.qname,
          queryType: entry.qtype,
        }, now));
      }
    } catch {
      // The complete wire response remains in the raw report when one captured entry cannot be parsed.
    }
  }
  return signatures.filter((signature, index, values) => values.findIndex((candidate) =>
    candidate.ownerName === signature.ownerName &&
    candidate.typeCovered === signature.typeCovered &&
    candidate.keyTag === signature.keyTag &&
    candidate.inception === signature.inception &&
    candidate.expiration === signature.expiration
  ) === index).sort((left, right) => left.expiration.localeCompare(right.expiration));
}

async function runDnssecAudit(name: string, type: DnssecRecordType): Promise<ValidatorResult> {
  const resolver = new RecordingResolver(new DoHResolver("https://cloudflare-dns.com/dns-query"));
  const qtype = recordTypeCode(type);
  if (qtype === null) throw new Error("The selected record type cannot be validated.");
  const result: WalkResult = await walk(`${name}.`, qtype, resolver);
  const verdict: DnssecVerdict = result.verdict === "insecure" || result.verdict === "bogus"
    ? result.verdict
    : "secure";
  const explanation = verdict === "secure"
    ? "The validator built a complete cryptographic chain to the DNS root."
    : verdict === "insecure"
      ? "The validator proved that the delegation is unsigned rather than broken."
      : result.detail || "The validator found a broken DNSSEC chain.";
  return {
    verdict,
    validationOutcome: result.verdict,
    explanation,
    exitCode: verdict === "bogus" ? 1 : 0,
    zones: [...new Set(result.steps.flatMap((step) => step.zone ? [step.zone === "." ? "." : step.zone.replace(/\.$/, "")] : []))],
    steps: result.steps,
    signatures: signaturesFromEntries(resolver.entries),
    rawReport: { verdict: result.verdict, detail: result.detail, steps: result.steps, queries: resolver.entries },
  };
}

function chainZones(name: string) {
  const labels = name.split(".");
  const zones = ["."];
  for (let index = labels.length - 1; index >= 0; index -= 1) zones.push(labels.slice(index).join("."));
  return zones;
}

async function evidenceQuery(name: string, type: DnssecRecordType | "DS" | "DNSKEY", query: PublicDiagnosticQuery, signal?: AbortSignal) {
  try {
    const response = await query(name, type, "cloudflare", { signal });
    const requestedCode = recordTypeCode(type);
    return {
      responseCode: dnsResponseCode(response.Status),
      authenticatedData: response.AD,
      records: response.Answer.filter((record) => record.type === requestedCode || record.type === 5).map(normalizeWireRecord),
      rawResponse: response,
      error: null,
    };
  } catch (error) {
    return { responseCode: null, authenticatedData: null, records: [], rawResponse: null as RawDnsWireResponse | null, error: safeDnsErrorMessage(error, "The evidence lookup failed.") };
  }
}

export async function checkDnssec(
  request: { name: string; recordType: unknown },
  options: { validator?: ValidatorRunner; publicQuery?: PublicDiagnosticQuery; signal?: AbortSignal } = {},
) {
  const startedAt = Date.now();
  const name = normalizeDiagnosticName(request.name);
  const recordType = normalizeDnssecRecordType(request.recordType);
  let validation: ValidatorResult;
  try {
    validation = await (options.validator ?? runDnssecAudit)(name, recordType);
  } catch (error) {
    validation = {
      verdict: "indeterminate",
      validationOutcome: null,
      explanation: "The local DNSSEC validator could not complete the check.",
      exitCode: 1,
      zones: [],
      steps: [],
      signatures: [],
      rawReport: { error: safeDnsErrorMessage(error, "The DNSSEC validator failed.") },
    };
  }
  const query = options.publicQuery ?? queryPublicResolver;
  const zones = validation.zones.length ? validation.zones : chainZones(name);
  const [answer, chain] = await Promise.all([
    evidenceQuery(name, recordType, query, options.signal),
    Promise.all(zones.map(async (zone, index) => {
    const [ds, dnskey] = await Promise.all([
      index === 0 ? Promise.resolve(null) : evidenceQuery(zone, "DS", query, options.signal),
      evidenceQuery(zone, "DNSKEY", query, options.signal),
    ]);
    return { zone, ds, dnskey };
    })),
  ]);
  return {
    query: { name, recordType },
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    verdict: validation.verdict,
    explanation: validation.explanation,
    validation: { outcome: validation.validationOutcome, steps: validation.steps },
    signatures: validation.signatures ?? [],
    answer,
    chain,
    validator: { name: "Namefi DNSSEC Audit", performedLocalValidation: true, exitCode: validation.exitCode, rawReport: validation.rawReport },
  };
}
