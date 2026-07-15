"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { SoaRecord } from "@/lib/dns/diagnostic-types.ts";
import { csvFromRows, groupSoaObservations, negativeCacheTtlSeconds } from "@/lib/dns/diagnostic-presentation.ts";
import { DiagnosticResultHeader, DownloadResultButton } from "../_dns-tools/diagnostic-result-ui";
import styles from "../_dns-tools/dns-diagnostics.module.css";
import pageStyles from "./soa-checker.module.css";

type Observation = { server: { hostname: string; address: string }; soa: SoaRecord | null; authoritative: boolean; error: string | null; rawResponses: unknown };
type Result = { checkedAt: string; durationMs: number; query: { inputName: string; zone: string }; observations: Observation[]; summary: { allAnswered: boolean; serialsAgree: boolean; newestSerial: number | null; differences: string[] } };
const seconds = (value: number | null) => value === null ? "Not reported" : `${value.toLocaleString("en-US")}s`;

function resultCsv(result: Result) {
  return csvFromRows([
    ["nameserver", "address", "authoritative", "serial", "primary nameserver", "responsible mailbox", "refresh seconds", "retry seconds", "expire seconds", "minimum seconds", "soa ttl seconds", "negative cache ttl seconds", "error"],
    ...result.observations.map((observation) => [observation.server.hostname, observation.server.address, observation.authoritative, observation.soa?.serial, observation.soa?.primaryNameserver, observation.soa?.responsibleMailbox, observation.soa?.refreshSeconds, observation.soa?.retrySeconds, observation.soa?.expireSeconds, observation.soa?.minimumSeconds, observation.soa?.ttlSeconds, observation.soa ? negativeCacheTtlSeconds(observation.soa) : "", observation.error]),
  ]);
}

export function SoaChecker({ initialName = "" }: { initialName?: string }) {
  const [name, setName] = useState(initialName);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const groups = useMemo(() => result ? groupSoaObservations(result.observations) : [], [result]);
  const csv = useMemo(() => result ? resultCsv(result) : "", [result]);

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
      <DiagnosticResultHeader action={<DownloadResultButton contents={csv} filename={`${result.query.zone}-soa.csv`} />} checkedAt={result.checkedAt} durationMs={result.durationMs} hostname={result.query.inputName}>
        <p>{result.summary.serialsAgree ? "Every returned SOA record has the same serial." : `The nameservers returned different serials${result.summary.newestSerial === null ? "." : `, and ${result.summary.newestSerial.toLocaleString("en-US")} is the newest one we could identify using DNS serial arithmetic.`}`} {result.summary.allAnswered ? "Every checked address returned an authoritative SOA answer." : "At least one address did not return an authoritative SOA answer."}</p>
      </DiagnosticResultHeader>
      <section className={styles.section}><h3>SOA record from each nameserver</h3><div className="dns-table-scroll"><table className={`dns-status-table ${styles.compactTable} ${pageStyles.table}`}><thead><tr><th>Nameserver</th><th>Serial</th><th>Primary</th><th>Mailbox</th><th>Refresh</th><th>Retry</th><th>Expire</th><th>Negative cache</th></tr></thead><tbody>{groups.map((group, index) => <tr key={`${group.hostname}-${group.soa?.serial ?? "error"}-${index}`}><th><code className={pageStyles.serverName}>{group.hostname}</code><small className={pageStyles.addresses}>{group.addresses.map((address) => <span key={address}>{address}</span>)}</small></th>{group.soa ? <><td>{group.soa.serial.toLocaleString("en-US")}</td><td><code>{group.soa.primaryNameserver}</code></td><td><code>{group.soa.responsibleMailbox}</code></td><td>{seconds(group.soa.refreshSeconds)}</td><td>{seconds(group.soa.retrySeconds)}</td><td>{seconds(group.soa.expireSeconds)}</td><td>{seconds(negativeCacheTtlSeconds(group.soa))}</td></> : <td colSpan={7}>{group.error ?? "No SOA record"}</td>}</tr>)}</tbody></table></div><p className={styles.inlineNote}>Negative cache time is the lower of the SOA record TTL and the MINIMUM value. Recursive resolvers can use it when caching a signed or unsigned “name not found” answer.</p><details className={styles.raw}><summary>Raw SOA responses</summary><pre>{JSON.stringify(result.observations, null, 2)}</pre></details></section>
    </section> : null}
  </section>;
}
