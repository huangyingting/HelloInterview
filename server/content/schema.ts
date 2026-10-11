import { createHash } from 'node:crypto';
import { z } from 'zod';
import { contentResearchDate, contentSources } from '../../shared/content/sources';
import type { QuizQuestion, SourceReference } from '../../shared/types';

const id=z.string().min(1).max(200);
export const questionSnapshotSchema:z.ZodType<QuizQuestion[]>=z.array(z.strictObject({
  id,topic:id,prompt:z.string().min(1).max(40000),options:z.array(z.string().min(1).max(40000)).min(1).max(20),
  correct:z.number().int().nonnegative(),explanation:z.string().min(1).max(40000),
  difficulty:z.enum(['Easy','Medium','Hard']).optional(),
  sourceIds:z.array(id).optional(),
  sources:z.array(z.strictObject({
    id,title:z.string().min(1).max(1000),publisher:z.string().min(1).max(1000),
    url:z.string().url().max(2000).refine(value=>new URL(value).protocol==='https:'),
    researchDate:z.string().min(1).max(100),
  })).optional(),
})).min(1).max(1000).superRefine((questions,context)=>{
  if(new Set(questions.map(question=>question.id)).size!==questions.length)context.addIssue({code:'custom',message:'A question snapshot contains duplicate IDs.'});
  for(const [index,question] of questions.entries())if(question.correct>=question.options.length)context.addIssue({code:'custom',path:[index,'correct'],message:'A question key is outside its options.'});
  for(const [index,question] of questions.entries())if(question.sources&&JSON.stringify(question.sources.map(source=>source.id))!==JSON.stringify(question.sourceIds??[]))context.addIssue({code:'custom',path:[index,'sources'],message:'Snapshot citations do not match their source IDs.'});
});
export function publishedQuestion(question:QuizQuestion):QuizQuestion {
  const sources:SourceReference[]=(question.sourceIds??[]).map(id=>{
    const source=Object.entries(contentSources).find(([key])=>key===id)?.[1];
    if(!source)throw new Error('An authored question references an unknown source.');
    return {id,...source,researchDate:contentResearchDate};
  });
  return {...question,sources};
}
export function readQuestionSnapshot(value:string,version:string):QuizQuestion[] {
  if(Buffer.byteLength(value)>2097152||createHash('sha256').update(value).digest('hex')!==version)throw new Error('The saved quiz content version is inconsistent.');
  return questionSnapshotSchema.parse(JSON.parse(value));
}
