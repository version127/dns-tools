"use client";

import { useMemo, useState, type FormEvent } from "react";
import { CHANGE_RECORD_TYPES, type ChangeRecordType, type DnsSourceAnswer } from "@/lib/dns/diagnostic-types.ts";
import { csvFromRows, groupDnsSources } from "@/lib/dns/diagnostic-presentation.ts";
import { DiagnosticResultHeader, DownloadResultButton } from "../_dns-tools/diagnostic-result-ui";
import styles from "../_dns-tools/dns-diagnostics.module.css";

type Result = {
  query: { name: string; recordType: ChangeRecordType; expectedAnswer: string | null };
  checkedAt: string;
  durationMs: number;
  zone: string;
  authoritative: DnsSourceAnswer[];
  resolvers: DnsSourceAnswer[];
  summary: { authoritativeServersAgree: boolean; agreeingResolvers: number; totalResolvers: number; expectedAnswerMatches: string[] | null };
};

function stateFor(group: ReturnType<typeof groupDnsSources>[number]) {
  if (group.error) return { label: "No reply", className: styles.stateBad };
  if (group.responseCode !== "NOERROR") return { label: group.responseCode ?? "No reply", className: styles.stateWarn };
  return group.records.length
    ? { label: "Records found", className: styles.stateGood }
    : { label: "No record", className: styles.stateQuiet };
}

function AnswerGroups({ sources, authoritative }: { sources: DnsSourceAnswer[]; authoritative: boolean }) {
  const groups = groupDnsSources(sources);
  return <div className={styles.sources}>{groups.map((group) => {
    const state = stateFor(group);
    return <div className={styles.source} key={group.key}>
      <header className={styles.sourceHeader}>
        <h3>{group.sources.length} source{group.sources.length === 1 ? "" : "s"} returned this answer</h3>
        <span className={state.className}>{state.label}</span>
      </header>
      {group.error ? <p className={styles.empty}>{group.error}</p> : group.records.length ? <ul className={styles.records}>{group.records.map((record, index) => <li className={styles.record} key={`${record.ownerName}-${record.value}-${index}`}><code>{record.value}</code><small>{record.ownerName} · {record.type}</small></li>)}</ul> : <p className={styles.empty}>No {sources[0]?.records[0]?.type ?? "record of this type"} was returned.</p>}
      <p className={styles.sourceList}>{group.sources.map((source) => {
        const ttls = [...new Set(source.records.map((record) => record.resolverTtlSeconds).filter((ttl): ttl is number => ttl !== null))];
        return <span key={source.id}><strong>{source.label}{source.server ? ` · ${source.server.address}` : ""}</strong>{ttls.length ? ` · ${authoritative ? "TTL" : "Resolver TTL"} ${ttls.join(" / ")}s` : ""}</span>;
      })}</p>
      <details className={styles.raw}><summary>Raw responses from these sources</summary><pre>{JSON.stringify(group.sources.map((source) => ({ source: source.label, server: source.server, response: source.rawResponse, error: source.error })), null, 2)}</pre></details>
    </div>;
  })}</div>;
}

function resultCsv(result: Result) {
  return csvFromRows([
    ["source kind", "source", "server address", "response", "owner", "type", "value", "ttl seconds", "error"],
    ...[...result.authoritative, ...result.resolvers].flatMap((source) => source.records.length
      ? source.records.map((record) => [source.kind, source.label, source.server?.address ?? "", source.responseCode, record.ownerName, record.type, record.value, record.resolverTtlSeconds, source.error])
      : [[source.kind, source.label, source.server?.address ?? "", source.responseCode, "", result.query.recordType, "", "", source.error]]),
  ]);
}

export function DnsChangeChecker({ initialName = "", initialRecordType = "A" }: { initialName?: string; initialRecordType?: ChangeRecordType }) {
  const [name, setName] = useState(initialName);
  const [recordType, setRecordType] = useState(initialRecordType);
  const [expectedAnswer, setExpectedAnswer] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const csv = useMemo(() => result ? resultCsv(result) : "", [result]);
  const hasAuthoritativeReply = result?.authoritative.some((source) => !source.error) ?? false;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError("Enter a domain or hostname.");
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/dns/change-checker", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, recordType, expectedAnswer }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? "The DNS change check failed.");
      setResult(data);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The DNS change check failed."); }
    finally { setLoading(false); }
  }

  return <section className="dns-tool" aria-label="DNS change checker">
    <form className="dns-lookup-form" onSubmit={submit}>
      <label className="dns-name-field"><span>Domain or hostname</span><input autoCapitalize="none" autoComplete="off" onChange={(event) => setName(event.target.value)} placeholder="www.google.com" spellCheck={false} value={name} /></label>
      <fieldset className="dns-record-type-picker"><legend>Record type</legend><div className="dns-record-type-options">{CHANGE_RECORD_TYPES.map((type) => <label key={type}><input checked={recordType === type} name="change-type" onChange={() => setRecordType(type)} type="radio" /><span>{type}</span></label>)}</div></fieldset>
      <label className="dns-name-field"><span>Expected answer <small>(optional)</small></span><input autoCapitalize="none" autoComplete="off" onChange={(event) => setExpectedAnswer(event.target.value)} placeholder="The new value you expect to see" spellCheck={false} value={expectedAnswer} /></label>
      <button className="dns-submit" disabled={loading}>{loading ? "Checking DNS..." : "Check DNS change"}</button>
      {error ? <p className="dns-form-error" role="alert">{error}</p> : null}
    </form>
    {result ? <section className={styles.results} aria-live="polite">
      <DiagnosticResultHeader action={<DownloadResultButton contents={csv} filename={`${result.query.name}-${result.query.recordType}-dns-change.csv`} />} checkedAt={result.checkedAt} durationMs={result.durationMs} hostname={result.query.name}>
        <p>{!hasAuthoritativeReply ? "None of the authoritative nameserver addresses returned a usable answer, so there is no source answer to compare yet." : result.summary.authoritativeServersAgree ? "The authoritative nameservers agree on the current answer." : "The authoritative nameservers are returning different answers, so the change is not consistent at the source yet."} {hasAuthoritativeReply ? `${result.summary.agreeingResolvers} of ${result.summary.totalResolvers} public resolvers match the authoritative answer we used for comparison.` : "Check the source errors below before reading the resolver caches."}</p>
        {!result.summary.authoritativeServersAgree && hasAuthoritativeReply ? <p><a className={styles.nextCheck} href={`/soa-checker?name=${encodeURIComponent(result.zone)}`}>Compare their SOA serials</a> to see whether one nameserver is still serving an older copy of the zone.</p> : null}
      </DiagnosticResultHeader>
      {result.query.expectedAnswer && result.summary.expectedAnswerMatches ? <div className={styles.finding} data-tone={result.summary.expectedAnswerMatches.length ? "good" : "warning"}><p>{result.summary.expectedAnswerMatches.length ? `The value you expected appears in ${result.summary.expectedAnswerMatches.length} source${result.summary.expectedAnswerMatches.length === 1 ? "" : "s"}.` : "The value you expected did not appear in any response we received."}</p></div> : null}
      <section className={styles.section}><h3>Published by the authoritative nameservers</h3><AnswerGroups authoritative sources={result.authoritative} /></section>
      <section className={styles.section}><h3>Seen in public resolver caches</h3><AnswerGroups authoritative={false} sources={result.resolvers} /></section>
    </section> : null}
  </section>;
}
