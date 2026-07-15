import { AppShell } from "../../app-shell";
import { DnsToolsSidebar } from "../_dns-tools/dns-tools-sidebar";
import { DnsLookupTool } from "./dns-lookup-tool";
import type { DnsResolver, DnsSelection } from "@/lib/dns/types.ts";
import { isDnsResolver } from "@/lib/dns/resolvers.ts";

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function initialSelection(value: string): DnsSelection {
  const allowed = new Set(["all", "A", "AAAA", "CNAME", "MX", "NS", "TXT", "CAA", "SOA", "SRV", "DS", "DNSKEY", "PTR"]);
  const normalized = value === "all" || value === "common" ? "all" : value.toUpperCase();
  return allowed.has(normalized) ? normalized as DnsSelection : "all";
}

export default async function DnsLookupPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const resolverValue = firstValue(params.resolver);
  const resolver: DnsResolver = isDnsResolver(resolverValue) ? resolverValue : "cloudflare";

  return (
    <AppShell
      mainLabel="DNS lookup"
      menuLabel="DNS tools"
      sidebar={<DnsToolsSidebar active="lookup" />}
      sidebarLabel="DNS lookup sidebar"
    >
      <main className="dns-lookup-main">
        <header className="dns-page-header">
          <h1>DNS lookup</h1>
          <p>
            Enter a domain or hostname to see its DNS records, or choose PTR to find the hostname connected to an IP address. You can check a public resolver's cached answer or ask the domain's authoritative nameserver directly. Leave All selected if you are not sure which record you need.
          </p>
        </header>

        <DnsLookupTool
          initialName={firstValue(params.name)}
          initialResolver={resolver}
          initialSelection={initialSelection(firstValue(params.type))}
        />

        <article className="dns-reference-content">
          <section id="how-to-check">
            <h2>How to check DNS records</h2>
            <p>Enter the exact domain or hostname you want to check. <code>example.com</code>, <code>www.example.com</code>, and <code>mail.example.com</code> can each have different records, so use the name connected to the website, email service, or setup you are checking. Leave All selected to check every forward record type offered here, choose a DNS source, then select Look up DNS. To start with an IP address instead, choose PTR and enter the address.</p>
            <p>When the answer appears, compare it with the records in your DNS provider. Public resolvers may keep an older answer in cache for a while. The authoritative option skips that cache and asks a nameserver that hosts the domain.</p>
          </section>

          <section id="read-results">
            <h2>What DNS lookup results mean</h2>
            <p>Read the returned value first. If the result shows an alias path, the name you entered points to another hostname and the final record belongs there. The owner name stays visible so you can see exactly where the answer came from.</p>
            <figure className="dns-answer-path">
              <div>
                <code>www.example.com</code>
                <span aria-hidden="true">→</span>
                <code>edge.example.net</code>
                <span aria-hidden="true">→</span>
                <code>192.0.2.42</code>
              </div>
              <figcaption>Here, <code>www.example.com</code> is an alias. The A record belongs to <code>edge.example.net</code>, so that owner name stays attached to the address in the result.</figcaption>
            </figure>
            <p>Resolver TTL is how much cache time a public resolver reported at the moment you looked. TTL, or time to live, is roughly how long a resolver is allowed to reuse an answer before checking again. So 300 seconds means about five minutes were left when the lookup ran. This number is often lower than the TTL the domain owner set, because part of that time has already ticked away. When you ask a nameserver directly, you see Authoritative TTL instead.</p>
          </section>

          <section id="record-types">
            <h2>Which DNS record type should you check?</h2>
            <p>Not sure where to start? Leave All selected. It checks the domain record types offered by this tool, including website, email, service, verification, nameserver, and DNSSEC records. PTR is separate because it starts with an IP address. If you already know what you are looking for, this table will help you choose one type.</p>
            <div className="dns-table-scroll">
              <table className="dns-record-table">
                <thead><tr><th scope="col">Type</th><th scope="col">What it shows</th></tr></thead>
                <tbody>
                  <tr><th scope="row">A</th><td>The IPv4 address for a domain or hostname. Check this when a website is opening the wrong server.</td></tr>
                  <tr><th scope="row">AAAA</th><td>The IPv6 address for a domain or hostname. It is worth checking when a website works on some networks but not others.</td></tr>
                  <tr><th scope="row">CNAME</th><td>The other hostname that an alias points to. You will often see this on <code>www</code> addresses, hosted services, and CDN setups.</td></tr>
                  <tr><th scope="row">MX</th><td>The servers that should receive email for the domain. A smaller preference number is tried first.</td></tr>
                  <tr><th scope="row">NS</th><td>The nameservers responsible for the domain. Check these after moving DNS to a new provider.</td></tr>
                  <tr><th scope="row">TXT</th><td>Text added for domain verification and email policies. You can read the value here, but this lookup does not tell you whether SPF, DKIM, or DMARC is configured correctly.</td></tr>
                  <tr><th scope="row">CAA</th><td>The certificate authorities allowed to issue certificates for the domain.</td></tr>
                  <tr><th scope="row">SOA</th><td>Basic information about the DNS zone, including its primary nameserver, serial number, and timing values. This is mostly useful when troubleshooting DNS provider changes.</td></tr>
                  <tr><th scope="row">SRV</th><td>The hostname and port used by a particular service, along with the order in which servers should be tried.</td></tr>
                  <tr><th scope="row">DS</th><td>A record in the parent zone that points to the DNSSEC key it trusts for this domain.</td></tr>
                  <tr><th scope="row">DNSKEY</th><td>The public keys the domain publishes for DNSSEC. Seeing a key here does not prove that the full DNSSEC setup is correct.</td></tr>
                  <tr><th scope="row">PTR</th><td>The hostname connected to an IPv4 or IPv6 address. This is often called reverse DNS and is useful when checking mail servers, logs, or an unfamiliar address.</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="use-cases">
            <h2>When a DNS lookup helps</h2>
            <p>This tool is handy when something should be working or should have changed, and you want to see what public DNS is actually returning. If you know what value your provider gave you, compare it with the answer here.</p>
            <div className="dns-table-scroll">
              <table className="dns-guide-table dns-use-case-table">
                <thead><tr><th scope="col">What is happening</th><th scope="col">Check</th><th scope="col">What to look for</th></tr></thead>
                <tbody>
                  <tr><th scope="row">A website opens the wrong server</th><td>A, AAAA, and CNAME</td><td>Does the address or alias match the value from your host or CDN?</td></tr>
                  <tr><th scope="row">Email is not reaching the right place</th><td>MX</td><td>Do the mail servers and preference numbers match your email provider's setup?</td></tr>
                  <tr><th scope="row">A service is still waiting to verify your domain</th><td>TXT</td><td>Is the complete text value present on the exact name the service asked you to use?</td></tr>
                  <tr><th scope="row">A certificate cannot be issued</th><td>CAA</td><td>Do the CAA records allow the certificate authority you are using?</td></tr>
                  <tr><th scope="row">You moved to new nameservers</th><td>NS and SOA</td><td>Do the NS records show the new provider, and does the SOA information belong to the new zone?</td></tr>
                  <tr><th scope="row">You are checking DNSSEC</th><td>DS and DNSKEY</td><td>Are both records present? This is a useful first look, but a full DNSSEC chain check is still needed to find configuration problems.</td></tr>
                  <tr><th scope="row">You need the hostname behind an IP address</th><td>PTR</td><td>Does the returned hostname match the server or service you expected to find?</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="status-meanings">
            <h2>When the answer looks wrong</h2>
            <p>No record does not always mean the whole domain is broken. The name may exist without having the particular record type you asked for. The response below tells you what happened with this exact lookup.</p>
            <div className="dns-table-scroll">
              <table className="dns-status-table">
                <thead><tr><th scope="col">Response</th><th scope="col">What it means</th></tr></thead>
                <tbody>
                  <tr><th scope="row">NOERROR with records</th><td>The lookup worked and the resolver found the record type you asked for.</td></tr>
                  <tr><th scope="row">NOERROR without records</th><td>The name exists, but it does not have this record type. For example, a hostname can have an A record without having an MX record.</td></tr>
                  <tr><th scope="row">NXDOMAIN</th><td>The exact name does not exist according to this resolver. Check the spelling and make sure you used the right root domain or subdomain.</td></tr>
                  <tr><th scope="row">SERVFAIL</th><td>The resolver could not get a usable answer. The cause may be temporary, or it may involve the nameserver setup or DNSSEC. This response alone cannot tell you which one.</td></tr>
                  <tr><th scope="row">REFUSED</th><td>The resolver decided not to answer this query, usually because of its own rules. It does not prove that the domain itself is broken.</td></tr>
                </tbody>
              </table>
            </div>
            <p>Public resolvers can show different answers for a while after a DNS change because each one may have cached the old value at a different time. Check the returned values and Resolver TTL. You can also choose Authoritative nameserver to see what the domain's DNS host answers without waiting for a public resolver cache.</p>
            <p>Remember that this tool only shows the DNS answer. It does not open the website, send a test email, validate SPF, DKIM, or DMARC, or check every resolver around the world.</p>
          </section>

          <aside className="dns-scope-note">
            <p>The name you enter is sent to the DNS source you select. Authoritative lookups use Cloudflare only to find the domain's nameserver address, then query that nameserver directly. Returned IP addresses are checked through Team Cymru's DNS service so the result can show the network and ASN, and nameserver hostnames are resolved through Cloudflare. We do not save your lookup history or include queried names and returned values in analytics.</p>
          </aside>
        </article>
      </main>
    </AppShell>
  );
}
