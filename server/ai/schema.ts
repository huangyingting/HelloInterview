import { z } from 'zod';

const text = z.string().trim().min(1).max(4000);
export const aiFeedbackSchema = z.strictObject({
  score: z.number().int().min(0).max(100),
  strengths: z.array(z.string().trim().min(1).max(1500)).max(12),
  improvements: z.array(z.string().trim().min(1).max(1500)).max(12),
  summary: text,
});
export const aiTutorSchema = z.strictObject({ text });
export const managedAiResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('tutor'), output: aiTutorSchema }),
  z.strictObject({ kind: z.literal('feedback'), output: aiFeedbackSchema }),
  z.strictObject({ kind: z.literal('mock'), output: aiFeedbackSchema }),
  z.strictObject({ kind: z.literal('project'), output: aiFeedbackSchema }),
]);
export type ManagedAiResult = z.infer<typeof managedAiResultSchema>;
