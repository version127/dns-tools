import { AppShell } from "../../app-shell";
import { DnsToolsSidebar } from "../_dns-tools/dns-tools-sidebar";
import { DnssecChecker } from "./dnssec-checker";
import { DNSSEC_RECORD_TYPES, type DnssecRecordType } from "@/lib/dns/dnssec-types.ts";
import styles from "../_dns-tools/dns-diagnostics.module.css";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? "" : value ?? "";
function initialType(value: string): DnssecRecordType { const upper = value.toUpperCase(); return DNSSEC_RECORD_TYPES.includes(upper as DnssecRecordType) ? upper as DnssecRecordType : "A"; }

export default async function DnssecCheckerPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  return (
    <AppShell
      mainLabel="DNSSEC Chain Checker"
      menuLabel="DNS tools"
      sidebar={<DnsToolsSidebar active="dnssec" />}
      sidebarLabel="DNS tools sidebar"
    >
      <main className={styles.main}>
        <header className="dns-page-header">
          <h1>DNSSEC Chain Checker</h1>
          <p>
            DNSSEC lets a domain sign its DNS answers so nobody can quietly change them on the way
            to you. This tool starts at the internet's root of trust and checks each signature in
            the chain, one link at a time, until it reaches the exact record you asked about. If a
            link is broken, you see which one, and the requested answer and raw evidence stay right
            beside the verdict.
          </p>
        </header>

        <DnssecChecker
          initialName={first(params.name)}
          initialRecordType={initialType(first(params.type))}
        />

        <article className="dns-reference-content">
          <section>
            <h2>How to check DNSSEC</h2>
            <p>
              Enter the exact domain or hostname and pick the record you want to validate. The type
              matters, because DNSSEC signs an answer, not a domain-wide badge. An A record can
              validate on its own, a missing TXT record can come with a valid signed proof that it
              really is absent, and a name that does not exist can come with a valid signed proof of
              that too. You are checking one answer at a time.
            </p>
          </section>

          <section>
            <h2>How the chain fits together</h2>
            <p>
              Three record types do the work, and each has one job. A DS record is the parent zone's
              fingerprint of the child's key, kept at the parent so it can vouch for the child.
              A DNSKEY record holds the child zone's own public keys. An RRSIG record is the actual
              signature over a set of records, made with one of those keys. Trust flows downward:
              the root vouches for the top-level domain, which vouches for your domain, and every
              step has to agree before an answer counts as signed.
            </p>
            <figure className="dns-answer-path">
              <div>
                <code>Root</code>
                <span aria-hidden="true">→</span>
                <code>DS</code>
                <span aria-hidden="true">→</span>
                <code>DNSKEY</code>
                <span aria-hidden="true">→</span>
                <code>RRSIG</code>
                <span aria-hidden="true">→</span>
                <code>Answer</code>
              </div>
              <figcaption>
                Each link vouches for the next: the parent's DS points at the child's DNSKEY, which
                validates the RRSIG that signs the answer.
              </figcaption>
            </figure>
            <p>
              Simply finding DS and DNSKEY records in a zone is not enough. They have to match and
              the signatures have to check out, which is why this tool shows the validator's real
              verification steps rather than a green light for the presence of records.
            </p>
          </section>

          <section>
            <h2>What this validator actually checks</h2>
            <p>
              It starts at the DNS root trust anchor and verifies each cryptographic link itself. It
              checks the parent's DS record against the child's DNSKEY set, confirms the key set is
              properly signed, and finally verifies the answer you asked for or its signed proof of
              absence. If a public resolver sets the AD flag to say it already validated the answer,
              that is kept as supporting evidence, but it does not decide the verdict here.
            </p>
          </section>

          <section>
            <h2>What the results mean</h2>
            <div className="dns-table-scroll">
              <table className="dns-status-table">
                <tbody>
                  <tr>
                    <th>Secure</th>
                    <td>
                      The answer is signed and every link checks out to the root. This covers a real
                      record, a signed proof that a record is absent, and a signed NXDOMAIN proof
                      that the name does not exist.
                    </td>
                  </tr>
                  <tr>
                    <th>Insecure</th>
                    <td>
                      DNSSEC is simply not in use here, and the chain confirms that on purpose. The
                      signed chain ends at an unsigned delegation, so the answer is not protected,
                      but nothing is broken.
                    </td>
                  </tr>
                  <tr>
                    <th>Bogus</th>
                    <td>
                      The name should validate but something in the chain failed: a DS link, a key,
                      a signature, or a denial proof. Validating resolvers can turn this into a
                      SERVFAIL, so the answer may look unreachable to real users.
                    </td>
                  </tr>
                  <tr>
                    <th>Indeterminate</th>
                    <td>
                      The check could not gather enough evidence for a safe verdict, often a timeout
                      or a partial response. Run it again before you change any DNS.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2>What to fix when DNSSEC is bogus</h2>
            <p>
              Start with the first step that failed. A DS failure usually means the registrar still
              holds an old digest or key tag, so the parent is pointing at a key that is no longer
              there. A DNSKEY failure points to key data that is missing, expired, or signed wrong.
              An answer or denial failure points to the zone signatures themselves. If you are moving
              DNS providers, finish the new signing chain before you change the delegation, or remove
              the old DS safely before the old keys disappear, so trust never dangles mid-move.
            </p>
          </section>
        </article>
      </main>
    </AppShell>
  );
}
