"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import styles from "./app-shell.module.css";

type Props = { children: ReactNode; label: string; menuLabel: string };
const DRAWER_ID = "dns-tools-sidebar";

export function AppSidebar({ children, label, menuLabel }: Props) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKeyDown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      toggleRef.current?.focus();
    };
  }, [open]);

  const closeAfterLink = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("a")) setOpen(false);
  };

  return (
    <>
      <div className={styles.sidebarBar}>
        <button aria-controls={DRAWER_ID} aria-expanded={open} className={styles.toggle} onClick={() => setOpen((value) => !value)} ref={toggleRef} type="button">
          <span aria-hidden="true" className={styles.toggleIcon}><span /><span /><span /></span>
          {menuLabel}
        </button>
      </div>
      <div aria-hidden="true" className={`${styles.backdrop}${open ? ` ${styles.open}` : ""}`} onClick={() => setOpen(false)} />
      <aside aria-label={label} className={`${styles.sidebar}${open ? ` ${styles.open}` : ""}`} id={DRAWER_ID} onClick={closeAfterLink}>
        <button aria-label="Close menu" className={styles.close} onClick={() => setOpen(false)} ref={closeRef} type="button"><span aria-hidden="true">×</span></button>
        {children}
      </aside>
    </>
  );
}
