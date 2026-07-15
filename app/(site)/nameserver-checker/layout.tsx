import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Nameserver Delegation Checker",
  description: "Inspect the parent handoff, glue, reachability, and authoritative nameserver answers.",
  alternates: { canonical: "/nameserver-checker" },
};

export default function NameserverCheckerLayout({ children }: { children: ReactNode }) {
  return children;
}
