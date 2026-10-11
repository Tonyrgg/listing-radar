/* Every view edits the canonical unit; queue entries never contain editable copies. */
export function wireUnitEditors(root, units, context) {
  root.querySelectorAll('[data-edit]').forEach(form => {
    form.oninput = () => context.markDirty(form);
    form.onsubmit = context.safe(async event => {
      event.preventDefault();
      const key = form.dataset.edit, unit = units.find(u => u.key === key), data = new FormData(form);
      const owners = unit.source.owners.map((owner, i) => ({ ...owner, fullName: String(data.get(`name-${i}`)), taxCode: String(data.get(`cf-${i}`)), sharePercentage: String(data.get(`share-${i}`)).trim() === '' ? null : Number(data.get(`share-${i}`)) }));
      await context.api.correct({ key, note: String(data.get('note')), correction: { address: String(data.get('address')), category: String(data.get('category')), owners } });
      context.saved(form); await context.afterSave(key);
      context.feedback('Correzione salvata nella memoria dell’immobile.');
    });
    form.querySelector('[data-cancel]').onclick = () => { form.reset(); form.querySelector('.local-error')?.remove(); context.cancel(form); };
  });
}
