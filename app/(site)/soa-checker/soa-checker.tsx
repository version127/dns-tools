"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { SoaRecord } from "@/lib/dns/diagnostic-types.ts";
import { groupSoaObservations, negativeCacheTtlSeconds } from "@/lib/dns/diagnostic-presentation.ts";
import { DiagnosticResultHeader, diagnosticReportJson, DownloadResultButton } from "../_dns-tools/diagnostic-result-ui";
import styles from "../_dns-tools/dns-diagnostics.module.css";
import pageStyles from "./soa-checker.module.css";

type Observation = { server: { hostname: string; address: string }; skippedReason: "checker_ipv6_unavailable" | null; soa: SoaRecord | null; authoritative: boolean; error: string | null; rawResponses: unknown };
type Result = { checkedAt: string; durationMs: number; ipv6Connectivity: boolean | null; query: { inputName: string; zone: string }; observations: Observation[]; summary: { allAnswered: boolean; serialsAgree: boolean; newestSerial: number | null; differences: string[] } };
const seconds = (value: number | null) => value === null ? "Not reported" : `${value.toLocaleString("en-US")}s`;

export function SoaChecker({ initialName = "" }: { initialName?: string }) {
  const [name, setName] = useState(initialName);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const groups = useMemo(() => result ? groupSoaObservations(result.observations.filter((observation) => !observation.skippedReason)) : [], [result]);
  const report = useMemo(() => result ? diagnosticReportJson("SOA Consistency Checker", result) : "", [result]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError("Enter a domain or hostname.");
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/dns/soa-checker", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? "The SOA check failed.");
      setResult(data);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The SOA check failed."); }
    finally { setLoading(false); }
  }

  return <section className="dns-tool" aria-label="SOA consistency checker">
    <form className="dns-lookup-form" onSubmit={submit}><label className="dns-name-field"><span>Domain or hostname</span><input autoCapitalize="none" autoComplete="off" onChange={(event) => setName(event.target.value)} placeholder="cloudflare.com" spellCheck={false} value={name} /></label><button className="dns-submit" disabled={loading}>{loading ? "Comparing SOA records..." : "Compare SOA records"}</button>{error ? <p className="dns-form-error" role="alert">{error}</p> : null}</form>
    {result ? <section className={styles.results} aria-live="polite">
      <DiagnosticResultHeader action={<DownloadResultButton contents={report} filename={`${result.query.zone}-soa-report.json`} />} checkedAt={result.checkedAt} durationMs={result.durationMs} hostname={result.query.inputName}>
        <p>{result.summary.serialsAgree ? "Every returned SOA record has the same serial." : `The nameservers returned different serials${result.summary.newestSerial === null ? "." : `, and ${result.summary.newestSerial.toLocaleString("en-US")} is the newest one we could identify using DNS serial arithmetic.`}`} {result.summary.allAnswered ? "Every checked address returned an authoritative SOA answer." : "At least one address did not return an authoritative SOA answer."}</p>
        {result.ipv6Connectivity === false ? <p>IPv6 checks were skipped because this checker does not have IPv6 connectivity.</p> : null}
      </DiagnosticResultHeader>
      <section className={styles.section}><h3>SOA record from each nameserver</h3><div className={pageStyles.records}>{groups.map((group, index) => <article className={pageStyles.record} key={`${group.hostname}-${group.soa?.serial ?? "error"}-${index}`}><header><div><code className={pageStyles.serverName}>{group.hostname}</code><small className={pageStyles.addresses}>{group.addresses.map((address) => <span key={address}>{address}</span>)}</small></div>{group.soa ? <span className={group.authoritative ? styles.stateGood : styles.stateWarn}>{group.authoritative ? "Authoritative" : "Not authoritative"}</span> : <span className={styles.stateBad}>No SOA answer</span>}</header>{group.soa ? <dl className={pageStyles.values}><div><dt>Serial</dt><dd>{group.soa.serial.toLocaleString("en-US")}</dd></div><div><dt>Primary</dt><dd><code>{group.soa.primaryNameserver}</code></dd></div><div><dt>Mailbox</dt><dd><code>{group.soa.responsibleMailbox}</code></dd></div><div><dt>Refresh</dt><dd>{seconds(group.soa.refreshSeconds)}</dd></div><div><dt>Retry</dt><dd>{seconds(group.soa.retrySeconds)}</dd></div><div><dt>Expire</dt><dd>{seconds(group.soa.expireSeconds)}</dd></div><div><dt>Negative cache</dt><dd>{seconds(negativeCacheTtlSeconds(group.soa))}</dd></div></dl> : <p className={pageStyles.error}>{group.error ?? "No SOA record was returned."}</p>}</article>)}</div><p className={styles.inlineNote}>Negative cache time is the lower of the SOA record TTL and the MINIMUM value. Recursive resolvers can use it when caching a signed or unsigned “name not found” answer.</p><details className={styles.raw}><summary>Raw SOA responses</summary><pre>{JSON.stringify(result.observations, null, 2)}</pre></details></section>
    </section> : null}
  </section>;
}
