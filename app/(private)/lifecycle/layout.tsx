/**
 * Le pagine dei Segnali stanno dentro il guscio dell'applicazione: la barra
 * laterale dice in che sezione sei, l'intestazione di pagina dice in che
 * pagina. Qui in mezzo non serve una terza navigazione — ce n'era una, in
 * inglese, che ripeteva le stesse sei destinazioni con altri nomi.
 */
export default function LifecycleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="space-y-5">{children}</div>;
}
