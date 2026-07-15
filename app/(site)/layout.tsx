import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./_dns-tools/dns-tools.css";

export const metadata: Metadata = {
  title: "DNS Tools",
  description: "Look up DNS records, trace referrals, compare changes, and inspect delegation, DNSSEC, SOA, and CAA configuration.",
  alternates: { canonical: "/" },
};

export default function SiteLayout({ children }: { children: ReactNode }) {
  return children;
}
