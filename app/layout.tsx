import type { Metadata } from "next";
import type { ReactNode } from "react";

import { allowIndexing, siteUrl } from "./site-config";
import { SiteHeader } from "./site-header";
import "./globals.css";

const description = "A self-hostable collection of DNS lookup, tracing, delegation, DNSSEC, SOA, CAA, and change-checking tools.";

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: "DNS Tools", template: "%s | DNS Tools" },
  description,
  applicationName: "DNS Tools",
  robots: allowIndexing() ? { index: true, follow: true } : { index: false, follow: true },
  openGraph: { title: "DNS Tools", description, type: "website", siteName: "DNS Tools" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "DNS Tools",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Any",
    description,
    url: new URL("/", siteUrl()).toString(),
    isAccessibleForFree: true,
  };

  return (
    <html data-theme="dark" lang="en">
      <body>
        <SiteHeader />
        {children}
        <script dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} type="application/ld+json" />
      </body>
    </html>
  );
}
