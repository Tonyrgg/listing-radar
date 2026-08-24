import type { ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { MatchingSectionNav } from "@/components/matching/section-nav";

/**
 * Manteniamo il nome storico, ma il disegno è quello unico del prodotto.
 * La navigazione di sezione entra nell'intestazione: non è più un blocco a parte.
 */
export function MatchingSectionHeader({
  eyebrow,
  title,
  description,
  actions,
  withNav = true,
}: Readonly<{
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  withNav?: boolean;
}>) {
  return (
    <PageHeader
      eyebrow={eyebrow}
      title={title}
      description={description}
      actions={actions}
      nav={withNav ? <MatchingSectionNav /> : undefined}
    />
  );
}
