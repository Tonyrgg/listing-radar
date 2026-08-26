import { permanentRedirect } from "next/navigation";

/**
 * La scheda di una casa vive a `/casa/[id]`, che accetta sia quelle osservate
 * sul mercato sia quelle che teniamo noi. Questo indirizzo resta per i vecchi
 * collegamenti.
 */
export default async function SchedaCasaRedirect({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;

  permanentRedirect(`/casa/${id}`);
}
