/**
 * L'orologio del server, letto come qualsiasi altro dato.
 *
 * Tenerlo fuori dal corpo del componente mantiene il render puro: l'ora entra
 * nella pagina insieme ai dati, non a metà del disegno.
 */
export async function readNow(): Promise<number> {
  return Date.now();
}
