export type OutreachContact = {
  do_not_contact: boolean;
  contact_review_required: boolean;
  contact_status: string;
};

const reviewSources = new Set([
  "crm_mining", "abandoned_property", "building_event", "professional_network",
  "neighborhood_intelligence", "property_intelligence", "succession",
  "condominium_works", "moving", "administrators", "technicians",
]);

export function sourceRequiresContactReview(source: string): boolean {
  return reviewSources.has(source);
}

export function outreachBlockReason(contact: OutreachContact | null): string | null {
  if (!contact) return "Collega un contatto prima di registrare un tentativo di contatto.";
  if (contact.do_not_contact || contact.contact_status === "blocked")
    return "Il contatto è contrassegnato come non contattare.";
  if (contact.contact_review_required)
    return "Rivedi la fonte del contatto prima di procedere.";
  return null;
}
