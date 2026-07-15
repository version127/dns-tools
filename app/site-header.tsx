import Link from "next/link";

import styles from "./site-header.module.css";

export function SiteHeader() {
  return (
    <header className={styles.header}>
      <Link aria-label="DNS Tools home" className={styles.brand} href="/">
        <img alt="Version127" className={styles.logo} height={219} src="/version127-logo-white.png" width={1175} />
        <span>DNS Tools</span>
      </Link>
    </header>
  );
}
