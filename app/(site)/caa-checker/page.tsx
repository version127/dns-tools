import { AppShell } from "../../app-shell";
import { DnsToolsSidebar } from "../_dns-tools/dns-tools-sidebar";
import { CaaChecker } from "./caa-checker";
import styles from "../_dns-tools/dns-diagnostics.module.css";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? "" : value ?? "";

export default async function CaaCheckerPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  return (
    <AppShell
      mainLabel="CAA Policy Checker"
      menuLabel="DNS tools"
      sidebar={<DnsToolsSidebar active="caa" />}
      sidebarLabel="DNS tools sidebar"
    >
      <main className={styles.main}>
        <header className="dns-page-header">
          <h1>CAA Policy Checker</h1>
          <p>
            A CAA record is how a domain says which certificate authorities are
            allowed to hand out certificates for it. CAA stands for
            Certification Authority Authorization. This tool finds the policy
            that actually applies to one exact name, follows how that name
            inherits its policy from parent domains, and then shows which
            authorities it lets issue normal and wildcard certificates. You get
            the records it found, the path it followed to find them, and the
            policy those records add up to.
          </p>
        </header>

        <CaaChecker initialName={first(params.name)} />

        <article className="dns-reference-content">
          <section>
            <h2>How to check a CAA policy</h2>
            <p>
              Enter the exact hostname the certificate will cover.{" "}
              <code>www.example.com</code> can give a different answer from{" "}
              <code>example.com</code>, so use the real name from the
              certificate request. We ask a recursive resolver for the CAA
              record, follow an alias if one is in the way, and then keep
              walking up the original name until we hit the first policy.
            </p>
          </section>

          <section>
            <h2>Where the effective policy comes from</h2>
            <p>
              A name does not have to carry its own CAA record. If it has one,
              that wins. If it does not, the check moves to its parent, then the
              parent above that, and stops at the first policy it finds. So the
              policy that governs a certificate is often written a level or two
              up, not on the exact name.
            </p>
            <figure className="dns-answer-path">
              <div>
                <code>www.example.com</code>
                <span aria-hidden="true">→</span>
                <code>example.com</code>
                <span aria-hidden="true">→</span>
                <code>com</code>
                <span aria-hidden="true">→</span>
                <code>Policy in effect</code>
              </div>
              <figcaption>
                The check climbs from the exact name toward the root and uses
                the first CAA policy it finds.
              </figcaption>
            </figure>
            <p>
              One thing an alias does not do: a CNAME can send the lookup to an
              alias target, but the alias target&apos;s parent domains do not
              join the original name&apos;s inheritance path. The result lists
              every place we looked, so you can see which record set actually
              won instead of guessing.
            </p>
          </section>

          <section>
            <h2>Normal and wildcard certificates</h2>
            <p>
              <code>issue</code> covers normal certificates, the ones for a
              specific hostname. <code>issuewild</code> covers wildcard
              certificates, the ones that match a whole level like{" "}
              <code>*.example.com</code>. If a name has no{" "}
              <code>issuewild</code> record, wildcard requests fall back to the{" "}
              <code>issue</code> policy. If a policy has only{" "}
              <code>issuewild</code> and no <code>issue</code>, then CAA is not
              restricting normal certificates at all.
            </p>
          </section>

          <section>
            <h2>How to read CAA records</h2>
            <div className="dns-table-scroll">
              <table className="dns-status-table">
                <tbody>
                  <tr>
                    <th>
                      <code>issue</code>
                    </th>
                    <td>
                      Lets the named authority issue normal certificates for the
                      name.
                    </td>
                  </tr>
                  <tr>
                    <th>
                      <code>issuewild</code>
                    </th>
                    <td>
                      Lets the named authority issue wildcard certificates for
                      the name.
                    </td>
                  </tr>
                  <tr>
                    <th>
                      <code>iodef</code>
                    </th>
                    <td>
                      A mail or web address where an authority can report a
                      policy problem it runs into.
                    </td>
                  </tr>
                  <tr>
                    <th>Empty issuer</th>
                    <td>
                      A value like <code>CAA 0 issue &quot;;&quot;</code> allows
                      no one, which blocks that kind of issuance.
                    </td>
                  </tr>
                  <tr>
                    <th>Critical flag</th>
                    <td>
                      If a property is marked critical and an authority does not
                      understand it, that authority must refuse to issue.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              Several <code>issue</code> or <code>issuewild</code> records stack
              rather than compete. Every authority listed under that tag is
              allowed.
            </p>
          </section>

          <section>
            <h2>What this result does not promise</h2>
            <p>
              CAA is one permission gate in the process, not a list of
              certificates that already exist. This page does not read
              certificate history, contact an <code>iodef</code> address, or
              promise that an allowed authority will actually issue. That
              authority still has to confirm you control the domain and apply
              its own rules on top of the CAA answer.
            </p>
          </section>
        </article>
      </main>
    </AppShell>
  );
}
