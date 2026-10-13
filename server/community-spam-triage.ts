import type {CommunityReportCategory,CommunitySpamTriageClassification,CommunitySpamTriageSignal} from '../shared/types';
import {digest,encodePayload} from './jobs/schema';

export const communitySpamTriageVersion='community-spam-rules-v1';

export interface CommunitySpamTriageSnapshot {
  algorithmVersion:typeof communitySpamTriageVersion;
  inputHash:string;
  inputTruncated:boolean;
  score:number;
  classification:CommunitySpamTriageClassification;
  linkCount:number;
  contactSolicitation:boolean;
  promotionalLanguage:boolean;
  repetitiveContent:boolean;
  signals:CommunitySpamTriageSignal[];
}

export function classifyCommunitySpam(input:{
  title:string|null;body:string;category:CommunityReportCategory;contentRevision:number;
}):CommunitySpamTriageSnapshot {
  const source=`${input.title??''}\n${input.body}`,inputTruncated=source.length>20_000;
  const bounded=source.slice(0,20_000),normalized=bounded.toLowerCase();
  const linkCount=Math.min(20,[...normalized.matchAll(/(?:https?:\/\/|www\.)\S+/g)].length);
  const contactSolicitation=/(?:\b(?:contact|email|message|dm)\s+me\b|\b(?:telegram|whatsapp|wechat|signal)\b|[\w.+-]+@[\w.-]+\.[a-z]{2,})/i.test(bounded);
  const promotionalLanguage=/\b(?:buy now|limited time|promo code|discount|guaranteed income|earn money|crypto investment|investment opportunity)\b/i.test(bounded);
  const repetitiveContent=/(.)\1{7,}/u.test(bounded)||/\b(\p{L}{2,})\b(?:\s+\1\b){3,}/iu.test(bounded);
  const score=Math.min(100,Math.min(linkCount,3)*15+(contactSolicitation?20:0)+(promotionalLanguage?25:0)+
    (repetitiveContent?20:0)+(input.category==='spam'?10:0));
  const classification:CommunitySpamTriageClassification=score>=60?'likely-spam':score>=30?'uncertain':'unlikely-spam';
  const signals:CommunitySpamTriageSignal[]=[];
  if(linkCount>=2)signals.push('multiple-links');
  if(contactSolicitation)signals.push('contact-solicitation');
  if(promotionalLanguage)signals.push('promotional-language');
  if(repetitiveContent)signals.push('repetitive-content');
  if(inputTruncated)signals.push('input-truncated');
  return {
    algorithmVersion:communitySpamTriageVersion,
    inputHash:digest(encodePayload({version:communitySpamTriageVersion,category:input.category,
      contentRevision:input.contentRevision,text:bounded,inputTruncated})),
    inputTruncated,score,classification,linkCount,contactSolicitation,promotionalLanguage,repetitiveContent,signals,
  };
}
