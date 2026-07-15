import Link from "next/link";
import { SidebarLabel } from "../../app-shell";
import {
  sidebarPanelClassName,
  sidebarPanelHeadingClassName,
} from "../../sidebar-panel";

type DnsToolsSidebarProps = {
  active: "hub" | "lookup" | "trace" | "change" | "nameserver" | "dnssec" | "soa" | "caa";
};

const availableDnsTools = [
  { href: "/dns-lookup", id: "lookup", label: "DNS lookup" },
  { href: "/dns-trace", id: "trace", label: "DNS Trace Explorer" },
  { href: "/dns-change-checker", id: "change", label: "DNS Change Checker" },
  { href: "/nameserver-checker", id: "nameserver", label: "Nameserver Delegation Checker" },
  { href: "/dnssec-checker", id: "dnssec", label: "DNSSEC Chain Checker" },
  { href: "/soa-checker", id: "soa", label: "SOA Consistency Checker" },
  { href: "/caa-checker", id: "caa", label: "CAA Policy Checker" },
] as const;

export function DnsToolsSidebar({ active }: DnsToolsSidebarProps) {
  return (
    <div className={`${sidebarPanelClassName} dns-tools-sidebar-panel`}>
      <div className={sidebarPanelHeadingClassName}>
        <SidebarLabel>DNS tools</SidebarLabel>
      </div>
      <nav className="dns-tools-nav" aria-label="DNS tools">
        <ul>
          {availableDnsTools.map((tool) => (
            <li key={tool.href}>
              <Link aria-current={active === tool.id ? "page" : undefined} href={tool.href}>
                {tool.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
