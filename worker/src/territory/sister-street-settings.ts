import { z } from "zod";

const text = z.string().trim().max(200).refine(value => !/[\u0000-\u001f\u007f]/.test(value), "Usa un nome su una sola riga").default("");
export const sisterStreetSettingsSchema = z.object({ searchText: text, resultName: text }).strict();
export type SisterStreetSettings = z.infer<typeof sisterStreetSettingsSchema>;
