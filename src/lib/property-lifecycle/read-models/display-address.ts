import { formatShouty } from "@/lib/formatting";

export function displayPropertyAddress(fallback: string, street?: string | null, civic?: string | null) {
  const confirmedStreet = street?.trim();
  const confirmedCivic = civic?.trim();
  return formatShouty(confirmedStreet && confirmedCivic ? `${confirmedStreet} ${confirmedCivic}` : fallback);
}
