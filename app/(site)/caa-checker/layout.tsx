import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "CAA Policy Checker",
  description: "Find the effective certificate authority policy for normal and wildcard certificates.",
  alternates: { canonical: "/caa-checker" },
};

export default function CaaCheckerLayout({ children }: { children: ReactNode }) {
  return children;
}
