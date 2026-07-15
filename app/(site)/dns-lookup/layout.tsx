import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "DNS Lookup",
  description: "Look up current DNS records through public resolvers or an authoritative nameserver.",
  alternates: { canonical: "/dns-lookup" },
};

export default function DnsLookupLayout({ children }: { children: ReactNode }) {
  return children;
}
