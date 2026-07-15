"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { WalkStep } from "@namefi/dnssec-audit";
import type { NormalizedDnsRecord } from "@/lib/dns/types.ts";
import { DNSSEC_RECORD_TYPES, type DnssecRecordType, type DnssecSignature, type DnssecVerdict } from "@/lib/dns/dnssec-types.ts";
import { DiagnosticResultHeader, diagnosticReportJson, DownloadResultButton } from "../_dns-tools/diagnostic-result-ui";
import styles from "../_dns-tools/dns-diagnostics.module.css";

type Evidence = { responseCode: string | null; authenticatedData: boolean | null; records: NormalizedDnsRecord[]; rawResponse: unknown; error: string | null };
type Outcome = "secure-positive" | "secure-nodata" | "secure-nxdomain" | "insecure" | "bogus" | null;
type Result = {
  query: { name: string; recordType: DnssecRecordType };
  checkedAt: string;
  durationMs: number;
  verdict: DnssecVerdict;
  explanation: string;
  validation: { outcome: Outcome; steps: WalkStep[] };
  signatures: DnssecSignature[];
  answer: Evidence;
  chain: Array<{ zone: string; ds: Evidence | null; dnskey: Evidence }>;
  validator: { name: string; performedLocalValidation: boolean; exitCode: number; rawReport: unknown };
};

const labels: Record<DnssecVerdict, string> = { secure: "Secure", insecure: "Insecure", bogus: "Bogus", indeterminate: "Indeterminate" };

function resultSentence(result: Result) {
  switch (result.validation.outcome) {
    case "secure-positive": return `The ${result.query.recordType} answer is signed, and its signatures validate through the chain to the DNS root.`;
    case "secure-nodata": return `The name exists, but it has no ${result.query.recordType} record. DNSSEC provided a signed proof of that absence.`;
    case "secure-nxdomain": return "The name does not exist, and DNSSEC provided a signed proof of that result.";
    case "insecure": return "The validator found a signed proof that this delegation is unsigned. That means DNSSEC is not protecting this answer, but the chain is not broken.";
    case "bogus": return "The name is expected to validate, but a key, signature, DS link, or denial proof failed. Validating resolvers may return SERVFAIL.";
    default: return "The validator could not finish with enough evidence to call this answer secure, insecure, or bogus.";
  }
}

function stepName(step: WalkStep) {
  if (step.kind === "root-trust-anchor") return "Start with the DNS root trust anchor";
  if (step.kind === "ds") return `Verify the DS link for ${step.zone ?? "this zone"}`;
  if (step.kind === "dnskey") return `Verify the DNSKEY set for ${step.zone ?? "this zone"}`;
  if (step.kind === "answer") return `Verify the ${step.qtype ?? "requested"} answer`;
  if (step.kind === "denial") return "Verify the signed proof of absence";
  if (step.kind === "insecure") return "Prove where the signed chain ends";
  return step.zone ? `Check ${step.zone}` : "Validation note";
}

function signatureTime(signature: DnssecSignature) {
  const seconds = Math.abs(signature.secondsRemaining);
  const value = seconds >= 86400
    ? `${Math.round(seconds / 86400)} day${Math.round(seconds / 86400) === 1 ? "" : "s"}`
    : seconds >= 3600
      ? `${Math.round(seconds / 3600)} hour${Math.round(seconds / 3600) === 1 ? "" : "s"}`
      : `${Math.max(1, Math.round(seconds / 60))} minute${Math.max(1, Math.round(seconds / 60)) === 1 ? "" : "s"}`;
  if (signature.status === "expired") return `Expired ${value} ago`;
  if (signature.status === "not-yet-valid") return `Not valid yet · expires in ${value}`;
  return `${value} remaining`;
}

export function DnssecChecker({ initialName = "", initialRecordType = "A" }: { initialName?: string; initialRecordType?: DnssecRecordType }) {
  const [name, setName] = useState(initialName);
  const [recordType, setRecordType] = useState(initialRecordType);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const report = useMemo(() => result ? diagnosticReportJson("DNSSEC Chain Checker", result) : "", [result]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError("Enter a domain or hostname.");
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/dns/dnssec-checker", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, recordType }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? "The DNSSEC check failed.");
      setResult(data);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The DNSSEC check failed."); }
    finally { setLoading(false); }
  }

  return <section className="dns-tool" aria-label="DNSSEC chain checker">
    <form className="dns-lookup-form" onSubmit={submit}>
      <label className="dns-name-field"><span>Domain or hostname</span><input autoCapitalize="none" autoComplete="off" onChange={(event) => setName(event.target.value)} placeholder="cloudflare.com" spellCheck={false} value={name} /></label>
      <fieldset className="dns-record-type-picker"><legend>Record type</legend><div className="dns-record-type-options">{DNSSEC_RECORD_TYPES.map((type) => <label key={type}><input checked={recordType === type} name="dnssec-type" onChange={() => setRecordType(type)} type="radio"/><span>{type}</span></label>)}</div></fieldset>
      <button className="dns-submit" disabled={loading}>{loading ? "Validating DNSSEC..." : "Validate DNSSEC"}</button>
      {error ? <p className="dns-form-error" role="alert">{error}</p> : null}
    </form>
    {result ? <section className={styles.results} aria-live="polite">
      <DiagnosticResultHeader action={<DownloadResultButton contents={report} filename={`${result.query.name}-${result.query.recordType}-dnssec-report.json`} type="application/json;charset=utf-8" />} checkedAt={result.checkedAt} durationMs={result.durationMs} hostname={result.query.name}>
        <p><strong className={result.verdict === "secure" ? styles.stateGood : result.verdict === "bogus" ? styles.stateBad : styles.stateWarn}>{labels[result.verdict]}</strong> {resultSentence(result)}</p>
      </DiagnosticResultHeader>
      <section className={styles.section}><h3>What the validator checked</h3>{result.validation.steps.length ? <ol className={styles.chain}>{result.validation.steps.map((step, index) => <li className={styles.chainStep} data-ok={String(step.ok)} key={`${step.kind}-${step.zone ?? step.qname ?? index}-${index}`}><h4>{stepName(step)}</h4><p>{step.detail}</p></li>)}</ol> : <p className={styles.empty}>No validation steps were returned. The downloadable report keeps the failure details.</p>}</section>
      <section className={styles.section}><h3>The answer that was validated</h3>{result.answer.records.length ? <div className="dns-table-scroll"><table className={`dns-status-table ${styles.compactTable}`}><thead><tr><th>Owner</th><th>Type</th><th>Value</th><th>Resolver TTL</th></tr></thead><tbody>{result.answer.records.map((record, index) => <tr key={`${record.ownerName}-${record.value}-${index}`}><th><code>{record.ownerName}</code></th><td>{record.type}</td><td><code>{record.value}</code></td><td>{record.resolverTtlSeconds === null ? "Not reported" : `${record.resolverTtlSeconds.toLocaleString("en-US")}s`}</td></tr>)}</tbody></table></div> : <p className={styles.empty}>{result.validation.outcome === "secure-nodata" ? `No ${result.query.recordType} record exists at this name, and the validator checked the signed proof.` : result.validation.outcome === "secure-nxdomain" ? "The name does not exist, and the validator checked the signed proof." : result.answer.error ?? `No ${result.query.recordType} record was returned.`}</p>}<details className={styles.raw}><summary>Raw requested answer</summary><pre>{JSON.stringify(result.answer, null, 2)}</pre></details></section>
      {result.signatures.length ? <section className={styles.section}><h3>When the signatures expire</h3><p className={styles.inlineNote}>Each signed record set has its own validity window. The first signature to expire is the one to watch; there is no single expiry time for the whole domain.</p><div className="dns-table-scroll"><table className={`dns-status-table ${styles.compactTable}`}><thead><tr><th>Record set</th><th>Signer</th><th>Algorithm</th><th>Key tag</th><th>Valid from</th><th>Valid until</th><th>Status</th></tr></thead><tbody>{result.signatures.map((signature) => <tr key={`${signature.ownerName}-${signature.typeCovered}-${signature.keyTag}-${signature.expiration}`}><th><code>{signature.typeCovered}</code> for <code>{signature.ownerName}</code></th><td><code>{signature.signerName}</code></td><td>{signature.algorithmName} ({signature.algorithm})</td><td>{signature.keyTag}</td><td>{new Date(signature.inception).toLocaleString()}</td><td>{new Date(signature.expiration).toLocaleString()}</td><td>{signatureTime(signature)}</td></tr>)}</tbody></table></div></section> : null}
      <details className={styles.raw}><summary>DS and DNSKEY evidence by zone</summary><pre>{JSON.stringify(result.chain, null, 2)}</pre></details>
      <details className={styles.raw}><summary>Complete validator report</summary><pre>{JSON.stringify(result.validator.rawReport, null, 2)}</pre></details>
    </section> : null}
  </section>;
}
