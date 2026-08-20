import { RefreshCw } from "lucide-react";

import { PendingSubmitButton } from "@/components/loading-controls";

import { enqueueGlobalLifecycleRefresh } from "./actions";
import { LifecycleNav } from "./_components/lifecycle-nav";
import styles from "./lifecycle.module.css";

export default function LifecycleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={styles.workspace}>
      <div className={styles.navShell}>
        <LifecycleNav />
        <form action={enqueueGlobalLifecycleRefresh} className="shrink-0">
          <PendingSubmitButton
            type="submit"
            pendingLabel="Accodo"
            icon={<RefreshCw aria-hidden="true" className="size-3.5" />}
            className={styles.secondaryAction}
          >
            <span className="hidden sm:inline">Refresh All</span>
            <span className="sm:hidden">Refresh</span>
          </PendingSubmitButton>
        </form>
      </div>
      {children}
    </div>
  );
}
