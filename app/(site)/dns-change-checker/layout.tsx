import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "DNS Change Checker",
  description: "Compare authoritative DNS answers with the copies held by public resolvers.",
  alternates: { canonical: "/dns-change-checker" },
};

export default function DnsChangeCheckerLayout({ children }: { children: ReactNode }) {
  return children;
}
