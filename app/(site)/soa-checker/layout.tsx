import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "SOA Consistency Checker",
  description: "Compare SOA serials and timing values across every authoritative nameserver.",
  alternates: { canonical: "/soa-checker" },
};

export default function SoaCheckerLayout({ children }: { children: ReactNode }) {
  return children;
}
