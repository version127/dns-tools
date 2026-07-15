"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { dnsRecordsCsv } from "@/lib/dns/export.ts";
import { websiteFaviconUrl } from "@/lib/dns/favicon.ts";
import { formatAuthoritativeTtl, formatResolverTtl, recordFields } from "@/lib/dns/format-record.ts";
import { caaPropertyCounts, traceLinkForLookup } from "@/lib/dns/result-presentation.ts";
import { dnsResolverProfiles, resolverLabel, resolverProfile } from "@/lib/dns/resolvers.ts";
import type {
  DnsAliasEdge,
  DnsAddressDetail,
  DnsLookupResponse,
  DnsNameserverAddress,
  DnsQueryResult,
  DnsRecordType,
  DnsResolver,
  DnsSelection,
  NormalizedDnsRecord,
} from "@/lib/dns/types.ts";

const recordOptions: { accessibleLabel?: string; label: string; value: DnsSelection }[] = [
  { label: "All", value: "all" },
  ...(["A", "AAAA", "CNAME", "MX", "NS", "TXT", "CAA", "SOA", "SRV", "DS", "DNSKEY", "PTR"] as DnsRecordType[])
    .map((value) => ({ label: value, value })),
];
type DnsLookupToolProps = {
  initialName?: string;
  initialResolver?: DnsResolver;
  initialSelection?: DnsSelection;
};

function ownerGroups(records: NormalizedDnsRecord[]) {
  const groups = new Map<string, NormalizedDnsRecord[]>();
  for (const record of records) groups.set(record.ownerName, [...(groups.get(record.ownerName) ?? []), record]);
  return [...groups.entries()];
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

function AliasChain({ authoritative, edges }: { authoritative: boolean; edges: DnsAliasEdge[] }) {
  if (edges.length === 0) return null;
  return (
    <div className="dns-alias-summary" aria-label="Alias chain">
      {edges.length === 1 ? (
        <>
          <p><code>{edges[0].from}</code> points to <code>{edges[0].to}</code>, so the records below may belong to the second name.</p>
          <p>{authoritative ? "The nameserver reports an authoritative TTL of" : "The resolver reported"} {authoritative ? formatAuthoritativeTtl(edges[0].resolverTtlSeconds) : formatResolverTtl(edges[0].resolverTtlSeconds)} for this alias.</p>
        </>
      ) : (
        <>
          <p>The name passes through this alias chain before reaching the records below.</p>
          <ol>
            {edges.map((edge) => (
              <li key={`${edge.from}-${edge.to}`}>
                <code>{edge.from}</code> → <code>{edge.to}</code>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function CopyRecordButton({ record }: { record: NormalizedDnsRecord }) {
  const [copied, setCopied] = useState(false);
  const fields = recordFields(record);
  const value = fields.map((field) => field.value).join(" ");

  return (
    <button
      aria-label={`Copy ${record.type} record`}
      className="dns-copy-icon"
      onClick={async () => {
        await copyText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
      title={copied ? "Copied" : `Copy ${record.type} record`}
      type="button"
    >
      {copied ? (
        <span aria-hidden="true">✓</span>
      ) : (
        <svg aria-hidden="true" viewBox="0 0 20 20">
          <rect height="10" rx="1.5" width="10" x="7" y="3" />
          <path d="M5 7H4.5A1.5 1.5 0 0 0 3 8.5v7A1.5 1.5 0 0 0 4.5 17h7a1.5 1.5 0 0 0 1.5-1.5V15" />
        </svg>
      )}
    </button>
  );
}

function NetworkLine({ address, detail }: { address?: string; detail?: DnsAddressDetail }) {
  if (!detail || (!detail.networkName && !detail.asn && !detail.prefix)) return null;
  return (
    <span className="dns-network-line">
      {address ? <code>{address}</code> : null}
      {detail.networkName ? <span>{detail.networkName}</span> : null}
      {detail.asn ? <strong>AS{detail.asn}</strong> : null}
      {detail.prefix ? <code>{detail.prefix}</code> : null}
    </span>
  );
}

function ttlHelp(authoritative: boolean) {
  return authoritative
    ? "This is the TTL published by the authoritative nameserver. It is not remaining resolver cache time."
    : "This is the remaining cache lifetime reported by the selected resolver. It may be lower than the TTL configured by the domain owner.";
}

function RecordRow({
  addressDetails,
  authoritative,
  nameserverAddresses,
  record,
}: {
  addressDetails: Map<string, DnsAddressDetail>;
  authoritative: boolean;
  nameserverAddresses: Map<string, string[]>;
  record: NormalizedDnsRecord;
}) {
  const fields = recordFields(record);
  const addressDetail = (record.type === "A" || record.type === "AAAA") ? addressDetails.get(record.value) : undefined;
  const nsAddresses = record.type === "NS" ? nameserverAddresses.get(record.value.replace(/\.$/, "").toLowerCase()) ?? [] : [];
  return (
    <li className="dns-record-item" data-record-type={record.type}>
      <div className="dns-record-primary">
        {fields.length === 1 ? (
          <code className="dns-record-value">{fields[0].value}</code>
        ) : (
          <dl className="dns-record-fields">
            {fields.map((field) => (
              <div key={field.label}>
                <dt>{field.label}</dt>
                <dd><code>{field.value}</code></dd>
              </div>
            ))}
          </dl>
        )}
        <NetworkLine detail={addressDetail} />
        {nsAddresses.length > 0 ? (
          <div className="dns-nameserver-addresses">
            <span>Nameserver addresses</span>
            {nsAddresses.map((address) => <NetworkLine address={address} detail={addressDetails.get(address)} key={address} />)}
          </div>
        ) : null}
      </div>
      <div className="dns-record-meta">
        <span>
          <strong>
            {authoritative ? "Authoritative TTL" : "Resolver TTL"}
            <span aria-label={`About ${authoritative ? "Authoritative TTL" : "Resolver TTL"}`} className="dns-ttl-help" tabIndex={0} title={ttlHelp(authoritative)}>i</span>
          </strong>
          {authoritative ? formatAuthoritativeTtl(record.resolverTtlSeconds) : formatResolverTtl(record.resolverTtlSeconds)}
        </span>
        <CopyRecordButton record={record} />
      </div>
    </li>
  );
}

function OwnerRecords({
  addressDetails,
  authoritative,
  expandAll,
  nameserverAddresses,
  ownerName,
  records,
  type,
}: {
  addressDetails: Map<string, DnsAddressDetail>;
  authoritative: boolean;
  expandAll: boolean;
  nameserverAddresses: Map<string, string[]>;
  ownerName: string;
  records: NormalizedDnsRecord[];
  type: string;
}) {
  const visibleRecords = type === "CAA" || expandAll ? records : records.slice(0, 5);
  const caaCounts = type === "CAA" ? caaPropertyCounts(records) : [];
  return (
    <div className="dns-owner-group">
      <p className="dns-record-owner">Records for <code>{ownerName}</code></p>
      {caaCounts.length > 0 ? (
        <p className="dns-caa-summary">{caaCounts.map(({ count, property }) => `${count} ${property}`).join(" · ")}</p>
      ) : null}
      <ul className="dns-record-list">
        {visibleRecords.map((record, index) => (
          <RecordRow
            addressDetails={addressDetails}
            authoritative={authoritative}
            key={`${record.ownerName}-${record.type}-${record.value}-${index}`}
            nameserverAddresses={nameserverAddresses}
            record={record}
          />
        ))}
      </ul>
    </div>
  );
}

function emptyResultMessage(result: DnsQueryResult) {
  if (result.outcome === "nxdomain") return `No ${result.requestedType} record returned. The resolver reported NXDOMAIN for this name.`;
  if (result.outcome === "dns_error") return `No ${result.requestedType} record returned. The resolver reported ${result.responseCode ?? "a DNS error"}.`;
  return `No ${result.requestedType} record returned.`;
}

function RecordResult({
  addressDetails,
  authoritative,
  expandAll,
  nameserverAddresses,
  result,
}: {
  addressDetails: Map<string, DnsAddressDetail>;
  authoritative: boolean;
  expandAll: boolean;
  nameserverAddresses: Map<string, string[]>;
  result: DnsQueryResult;
}) {
  const failed = result.outcome === "provider_error" || result.outcome === "timeout";
  return (
    <section
      className={`dns-record-group${failed ? " dns-record-group-failed" : result.terminalRecords.length === 0 ? " dns-record-group-empty" : ""}`}
      data-record-type={result.requestedType}
      id={`dns-result-${result.requestedType.toLowerCase()}`}
    >
      <header className="dns-record-group-heading">
        <h2>{result.requestedType}</h2>
      </header>
      {result.terminalRecords.length > 0 ? ownerGroups(result.terminalRecords).map(([ownerName, records]) => (
        <OwnerRecords
          addressDetails={addressDetails}
          authoritative={authoritative}
          expandAll={expandAll}
          key={ownerName}
          nameserverAddresses={nameserverAddresses}
          ownerName={ownerName}
          records={records}
          type={result.requestedType}
        />
      )) : (
        <p className="dns-record-state">
          {failed ? result.error?.message ?? `The ${result.requestedType} lookup could not be completed.` : emptyResultMessage(result)}
        </p>
      )}
      <RawResponse result={result} />
    </section>
  );
}

function RawResponse({ result }: { result: DnsQueryResult }) {
  return (
    <details className="dns-inline-raw">
      <summary>Raw {result.requestedType} response</summary>
      <pre>{JSON.stringify(result.rawResponse, null, 2)}</pre>
    </details>
  );
}

function WebsiteFavicon({ hostname }: { hostname: string }) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");
  const src = websiteFaviconUrl(hostname);
  if (!src || state === "failed") return null;

  return (
    <img
      alt=""
      className={`dns-site-favicon${state === "loaded" ? " dns-site-favicon-loaded" : ""}`}
      decoding="async"
      height="32"
      onError={() => setState("failed")}
      onLoad={() => setState("loaded")}
      referrerPolicy="no-referrer"
      src={src}
      width="32"
    />
  );
}

function dnssecSummary(queryResults: DnsQueryResult[], resolver: string) {
  if (resolver === "Authoritative nameserver") {
    return "Authoritative nameservers do not normally validate their own answers for you. Use a public resolver or a full DNSSEC chain check when you need to confirm DNSSEC validation.";
  }
  const reported = new Set(queryResults.map((result) => result.flags.authenticatedData));
  if (reported.size !== 1) {
    return `${resolver} gave different DNSSEC authentication results across these queries. You can open each raw response to compare them.`;
  }
  const value = queryResults[0]?.flags.authenticatedData ?? null;
  if (value === true) return `${resolver} authenticated this answer with DNSSEC. This does not replace a full check of the domain's DNSSEC setup.`;
  if (value === false) return `${resolver} did not mark this answer as authenticated. That is normal for unsigned names and does not by itself mean DNSSEC is broken.`;
  return `${resolver} did not report whether this answer was authenticated with DNSSEC.`;
}

function LookupResults({ result }: { result: DnsLookupResponse }) {
  const [expandAll, setExpandAll] = useState(false);
  const resolver = resolverLabel(result.query.resolver);
  const authoritative = result.query.resolver === "authoritative";
  const hasInconsistentAliases = result.warnings.some((warning) => warning.code === "alias_chain_inconsistent");
  const addressDetails = new Map((result.addressDetails ?? []).map((detail) => [detail.address, detail]));
  const nameserverAddresses = new Map((result.nameserverAddresses ?? []).map((entry: DnsNameserverAddress) => [entry.nameserver, entry.addresses]));
  const hasLongGroups = result.queryResults.some((query) => query.requestedType !== "CAA" && ownerGroups(query.terminalRecords).some(([, records]) => records.length > 5));
  const traceLink = traceLinkForLookup(result);
  const checkedDnssecRecords = result.queryResults.some((query) => query.requestedType === "DS" || query.requestedType === "DNSKEY");

  function downloadRecords() {
    const csv = dnsRecordsCsv({ authoritative, queryResults: result.queryResults, resolverLabel: resolver });
    const href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = href;
    link.download = `${result.query.normalizedName.replace(/[^a-z0-9.-]+/gi, "-")}-dns-records.csv`;
    link.click();
    URL.revokeObjectURL(href);
  }

  return (
    <div className="dns-results">
      <section className="dns-results-summary" aria-live="polite" tabIndex={-1}>
        <div className="dns-results-heading-row">
          <div className="dns-result-site">
            <WebsiteFavicon hostname={result.query.normalizedName} key={result.query.normalizedName} />
            <h2>{result.query.normalizedName}</h2>
          </div>
          <div className="dns-result-controls">
            {traceLink ? <a href={traceLink.href}>Trace this name</a> : null}
            {checkedDnssecRecords ? <a href={`/dnssec-checker?name=${encodeURIComponent(result.query.normalizedName)}&type=A`}>Check the full DNSSEC chain</a> : null}
            {hasLongGroups ? (
              <button onClick={() => setExpandAll((value) => !value)} type="button">
                {expandAll ? "Collapse long record lists" : "Expand all records"}
              </button>
            ) : null}
            <button onClick={downloadRecords} type="button">Download records</button>
          </div>
        </div>
        <nav aria-label="DNS record results" className="dns-result-nav">
          {result.queryResults.map((query) => {
            const hasRecords = query.terminalRecords.length > 0;
            const didFail = query.outcome === "provider_error" || query.outcome === "timeout";
            const className = `dns-result-nav-item ${hasRecords ? "dns-result-nav-found" : didFail ? "dns-result-nav-failed" : "dns-result-nav-empty"}`;
            return (
              <a
                aria-label={`${query.requestedType}: ${hasRecords ? "records returned" : didFail ? "lookup failed" : "no record returned"}`}
                className={className}
                href={`#dns-result-${query.requestedType.toLowerCase()}`}
                key={query.requestedType}
              >
                {query.requestedType}
              </a>
            );
          })}
        </nav>
        <p className="dns-results-meta">Checked with {resolver} in {result.durationMs.toLocaleString("en-US")} ms on {new Date(result.checkedAt).toLocaleString()}.</p>
      </section>

      {result.warnings.length > 0 ? (
        <section className="dns-warning-list" aria-label="Lookup warnings">
          {result.warnings.map((warning, index) => <p key={`${warning.code}-${index}`}>{warning.message}</p>)}
        </section>
      ) : null}

      {hasInconsistentAliases ? (
        <section className="dns-alias-variants">
          <h2>Alias observations differ</h2>
          {result.aliasObservations.map((observation) => (
            <div key={observation.requestedType}>
              <strong>{observation.requestedType} query</strong>
              <ol>{observation.aliasChain.map((edge) => <li key={`${edge.from}-${edge.to}`}><code>{edge.from}</code> → <code>{edge.to}</code></li>)}</ol>
            </div>
          ))}
        </section>
      ) : <AliasChain authoritative={authoritative} edges={result.aliasChain} />}

      <p className="dns-dnssec-summary">{dnssecSummary(result.queryResults, resolver)}</p>

      <div className="dns-record-stack">
        {result.queryResults.map((query) => (
          <RecordResult
            addressDetails={addressDetails}
            authoritative={authoritative}
            expandAll={expandAll}
            key={query.requestedType}
            nameserverAddresses={nameserverAddresses}
            result={query}
          />
        ))}
      </div>

    </div>
  );
}

export function DnsLookupTool({
  initialName = "",
  initialResolver = "cloudflare",
  initialSelection = "all",
}: DnsLookupToolProps) {
  const [name, setName] = useState(initialName);
  const [resolver, setResolver] = useState<DnsResolver>(initialResolver);
  const [selection, setSelection] = useState<DnsSelection>(initialSelection);
  const [result, setResult] = useState<DnsLookupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const initialRun = useRef(false);

  const requestBody = useMemo(() => ({ name, resolver, selection }), [name, resolver, selection]);
  const selectedResolver = resolverProfile(resolver);

  async function runLookup(body = requestBody) {
    if (!body.name.trim()) {
      setError("Enter a DNS name.");
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/dns/lookup", {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? "The DNS lookup failed.");
      setResult(data as DnsLookupResponse);
    } catch (lookupError) {
      if (controller.signal.aborted) return;
      setError(lookupError instanceof Error ? lookupError.message : "The DNS lookup failed.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    if (initialRun.current || !initialName) return;
    initialRun.current = true;
    void runLookup({ name: initialName, resolver: initialResolver, selection: initialSelection });
  }, [initialName, initialResolver, initialSelection]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runLookup();
  }

  return (
    <section className="dns-tool" id="lookup" aria-label="DNS lookup form">
      <form className="dns-lookup-form" onSubmit={submit}>
        <label className="dns-name-field">
          <span>{selection === "PTR" ? "IP address" : "DNS name"}</span>
          <input
            autoCapitalize="none"
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
            placeholder={selection === "PTR" ? "8.8.8.8" : "google.com"}
            spellCheck={false}
            type="text"
            value={name}
          />
        </label>
        <fieldset className="dns-record-type-picker" role="radiogroup">
          <legend>Record type</legend>
          <div className="dns-record-type-options">
            {recordOptions.map((option) => (
              <label key={option.value}>
                <input
                  aria-label={option.accessibleLabel}
                  checked={selection === option.value}
                  name="record-type"
                  onChange={() => setSelection(option.value)}
                  type="radio"
                  value={option.value}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="dns-form-options">
          <label>
            <span>Resolver</span>
            <select onChange={(event) => setResolver(event.target.value as DnsResolver)} value={resolver}>
              {dnsResolverProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.label}</option>
              ))}
            </select>
            <small>{selectedResolver.policy}</small>
          </label>
          <button className="dns-submit" disabled={loading} type="submit">{loading ? "Looking up..." : "Look up DNS"}</button>
        </div>
        {error ? <p className="dns-form-error" role="alert">{error}</p> : null}
      </form>
      {loading ? <p className="dns-loading" aria-live="polite">Querying {resolverLabel(resolver)}...</p> : null}
      {result ? <LookupResults result={result} /> : null}
    </section>
  );
}
