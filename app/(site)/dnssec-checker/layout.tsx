import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "DNSSEC Chain Checker",
  description: "Validate one signed DNS answer from the root trust anchor to the requested name.",
  alternates: { canonical: "/dnssec-checker" },
};

export default function DnssecCheckerLayout({ children }: { children: ReactNode }) {
  return children;
}
