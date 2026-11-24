export function createPinReview({ api, onSaved }) {
  const get = name => document.getElementById(`pin-review-${name}`);
  const dialog = get("dialog"), civic = get("civic"), status = get("status");
  const results = get("candidates"), owner = get("owner"), start = get("start");
  let propertyId, previousFocus, selected, busy;

  function updateActions() {
    civic.disabled = get("search").disabled = get("save").disabled = Boolean(busy);
    get("close").disabled = Boolean(busy);
    owner.disabled = Boolean(busy);
    start.disabled = Boolean(busy || !selected || !owner.value);
  }

  function select(candidate) {
    selected = candidate;
    owner.replaceChildren(new Option("Scegli intestatario", ""));
    for (const person of candidate?.owners ?? []) owner.add(new Option(person.name, person.taxCode));
    get("owner-label").hidden = !candidate;
    updateActions();
  }

  function render({ pin, civic: value, query, candidates }) {
    get("address").textContent = pin.street || pin.title;
    get("data").textContent = [
      pin.precision === "published" ? "Pin pubblicato dalla fonte" : "Posizione in archivio",
      pin.floor ? `Piano annuncio ${pin.floor}` : null,
      pin.rooms == null ? null : `${pin.rooms} locali nell’annuncio`,
    ].filter(Boolean).join(" · ");
    civic.value = value;
    status.textContent = !value ? "Controlla il civico sulla mappa e inseriscilo qui."
      : !query ? pin.ambiguous
        ? "Più vie corrispondono all’indirizzo. Apri la via corretta dalla mappa e verifica il civico."
        : "Via assente dal catalogo del Worker. Puoi salvare il civico e cercare la via dalla mappa."
      : !candidates.length ? "Nessuna unità SISTER acquisita per questo civico."
      : `${candidates.length} unità trovate. La compatibilità ordina gli indizi. Verifica l’unità prima di collegarla.`;
    results.replaceChildren();
    for (const candidate of candidates) {
      const row = document.createElement("label");
      row.className = "pin-review-row";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "pin-review-unit";
      radio.disabled = !candidate.writable || !candidate.owners.length;
      radio.onchange = () => select(candidate);
      const info = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = candidate.address;
      const details = document.createElement("small");
      const { sheet, parcel, subaltern } = candidate.cadastral;
      details.textContent = `Foglio ${sheet} · Particella ${parcel} · Sub ${subaltern || "—"} · ${candidate.floorNote} · ${candidate.roomsNote}`;
      const score = document.createElement("span");
      score.className = "pin-review-score";
      score.textContent = radio.disabled ? "Import non disponibile" : `${candidate.score}%`;
      info.append(title, details);
      if (radio.disabled) {
        const reason = document.createElement("small");
        reason.textContent = candidate.blockedReason || (candidate.owners.length ? "Dati o autorizzazione da verificare" : "Intestatario importabile assente");
        info.append(reason);
      }
      if ("linkedUnit" in pin && pin.linkedUnit === candidate.key) {
        const linked = document.createElement("small");
        linked.textContent = "Unità già collegata";
        info.append(linked);
      }
      row.append(radio, info, score);
      results.append(row);
    }
  }

  async function perform(message, operation) {
    if (busy) return;
    busy = true;
    updateActions();
    status.textContent = message;
    try { await operation(); }
    catch (error) { status.textContent = error.message.replace(/^Error invoking remote method '[^']+': Error: /, ""); }
    finally { busy = false; updateActions(); }
  }

  get("close").onclick = () => dialog.close();
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => {
    if (previousFocus?.isConnected) previousFocus.focus();
  });
  civic.oninput = () => {
    select(null);
    results.replaceChildren();
    status.textContent = "Cerca le unità per il nuovo civico oppure salvalo sulla mappa.";
  };
  owner.onchange = updateActions;
  get("form").onsubmit = event => {
    event.preventDefault();
    select(null);
    results.replaceChildren();
    void perform("Ricerca nell’archivio SISTER…", async () => {
      render(await api.newsPinReview({ propertyId, civic: civic.value.trim() }));
    });
  };
  get("save").onclick = () => {
    if (!civic.reportValidity()) return;
    void perform("Salvataggio del civico…", async () => {
      const value = civic.value.trim();
      const { unitKey } = await api.newsPinSave({ propertyId, civic: value });
      onSaved(propertyId, value, unitKey);
      status.textContent = `Civico ${value} salvato sulla mappa.`;
    });
  };
  start.onclick = () => {
    if (!selected || !owner.value || !civic.reportValidity()) return;
    void perform("Collegamento dell’unità e avvio…", async () => {
      const value = civic.value.trim(), unitKey = selected.key, flashOwner = owner.value;
      const { query } = await api.newsPinSave({ propertyId, civic: value, unitKey });
      onSaved(propertyId, value, unitKey);
      try {
        if (!query) throw new Error("Via o civico non più disponibili.");
        const runId = await api.start({ query, operation: "apply", selected: [unitKey], flashOwner });
        if (!runId) throw new Error("Il Worker non ha confermato l’avvio.");
      } catch (error) {
        throw new Error(`Collegamento salvato. Import flash non avviato. ${error.message.replace(/^Error invoking remote method '[^']+': Error: /, "")}`);
      }
      select(null);
      status.textContent = "Import flash avviato nel Chrome di lavoro. L’esito è disponibile nella cronologia del Worker.";
    });
  };
  return {
    open(pin) {
      propertyId = pin.propertyId;
      previousFocus = document.activeElement;
      get("address").textContent = pin.street || pin.title;
      get("data").textContent = "";
      civic.value = "";
      results.replaceChildren();
      select(null);
      dialog.showModal();
      void perform("Caricamento dell’immobile…", async () => {
        render(await api.newsPinReview({ propertyId }));
      }).then(() => civic.focus());
    },
  };
}
