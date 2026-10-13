export const activityModes = {
  none: { label: 'Nessuna attività', hint: 'Importa i dati senza aggiungere attività nel gestionale.' },
  plain: { label: 'Telefonata da eseguire', hint: 'Crea una Telefonata con stato Da eseguire.' },
  direct_contact: { label: 'Contatto diretto automatico', hint: 'Senza recapiti: Contatto diretto, Eseguito. Con recapiti: Telefonata, Da eseguire.' },
  killer: { label: 'Killer', hint: 'Registra un contatto Eseguito. Con un numero alterna gli esiti telefonici; senza usa Contatto diretto.' },
};
export const activityOptionsHtml = () => Object.entries(activityModes).map(([value, mode]) => `<option value="${value}">${mode.label}</option>`).join('');
export const activityLabel = mode => activityModes[mode]?.label || activityModes.none.label;
