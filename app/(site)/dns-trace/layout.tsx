import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "DNS Trace Explorer",
  description: "Follow one DNS question from the root servers to the authoritative answer.",
  alternates: { canonical: "/dns-trace" },
};

export default function DnsTraceLayout({ children }: { children: ReactNode }) {
  return children;
}
