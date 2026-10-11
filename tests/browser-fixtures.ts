import {createHash} from 'node:crypto';
import {test as base} from '@playwright/test';
export {expect,type Page} from '@playwright/test';

export const test=base.extend({
  extraHTTPHeaders:async({},use,testInfo)=>{
    const bytes=createHash('sha256').update(`${testInfo.file}:${testInfo.titlePath.join('/')}`).digest();
    await use({'X-Forwarded-For':`198.18.${bytes[0]}.${bytes[1]}`});
  },
});
