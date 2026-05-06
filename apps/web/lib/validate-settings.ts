import { z } from "zod";

export const SettingsUpdateSchema = z.object({
  ai_features: z.object({
    enabled: z.boolean().optional(),
    autoBackfillLastWeek: z.boolean().optional(),
    autoBackfillYesterday: z.boolean().optional(),
  }).refine((v) => Object.keys(v).length > 0, {
    message: "ai_features must include at least one field",
  }),
});

export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>;
