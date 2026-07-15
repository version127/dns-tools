import type { ReactNode } from "react";

import { AppSidebar } from "./app-sidebar";
import styles from "./app-shell.module.css";
import { sidebarPanelTitleClassName } from "./sidebar-panel";

type Props = {
  children?: ReactNode;
  mainLabel?: string;
  sidebar?: ReactNode;
  sidebarLabel?: string;
  menuLabel?: string;
};

export function SidebarLabel({ children }: { children: ReactNode }) {
  return <p className={sidebarPanelTitleClassName}>{children}</p>;
}

export function AppShell({ children, mainLabel = "Page content", sidebar, sidebarLabel = "Page sidebar", menuLabel = "Menu" }: Props) {
  return (
    <main className={styles.shell}>
      <section className={styles.page}>
        {sidebar ? <AppSidebar label={sidebarLabel} menuLabel={menuLabel}>{sidebar}</AppSidebar> : <aside className={styles.sidebar} aria-label={sidebarLabel} />}
        <section className={styles.main} aria-label={mainLabel}>
          <div className={styles.content}>{children}</div>
          <footer className={styles.footer}>
            <p>DNS Tools is open-source software built by <a href="https://version127.com/dns-tools" rel="noreferrer">Version127</a>.</p>
          </footer>
        </section>
      </section>
    </main>
  );
}
