import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { loadAuthSettings } from '../auth/config';
import { prismaConnection } from '../db/prisma';
import { assertDatabaseVersion } from '../db/migrations';
import { TerminalJobFailure } from '../jobs';
import { PrivacyExports } from '../privacy';

export async function runPrivacyCommand(command:string) {
  if(!['process','worker'].includes(command))throw new Error('Choose privacy process or worker.');
  if(!process.env.DATABASE_URL||!loadAuthSettings())throw new Error('Privacy operation processing requires Auth.js and controlled PostgreSQL.');
  const db=prismaConnection(),shutdown=new AbortController();
  let privacy:PrivacyExports|undefined;
  const stop=()=>shutdown.abort();
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  try{
    await assertDatabaseVersion(db);
    privacy=await PrivacyExports.open(db,true);
    let completed=0,nextSweep=0;
    while(!shutdown.signal.aborted){
      if(Date.now()>=nextSweep){await privacy.expire();while(await privacy.enqueueDueDeletion()){}nextSweep=Date.now()+60000;}
      const exportClaim=await privacy.jobs.claim('privacy.process');
      const deletionClaim=exportClaim?undefined:await privacy.jobs.claim('privacy.delete');
      const claim=exportClaim??deletionClaim;
      if(claim){
        try{
          if(claim.name==='privacy-delete')await privacy.runDeletionClaim(claim,shutdown.signal);
          else await privacy.runClaim(claim,shutdown.signal);
          completed++;
        }
        catch(error){
          await privacy.jobs.fail(claim,error instanceof TerminalJobFailure?'reconciliation-required':'handler-failed');
          if(shutdown.signal.aborted)return;
          throw error;
        }
      }else if(command==='process'){
        await privacy.expire();while(await privacy.enqueueDueDeletion()){}
        const row=await db.prepare(`SELECT count(*)::integer AS pending FROM durable_operations
          WHERE kind IN ('privacy.process','privacy.delete') AND completed_at IS NULL`).get();
        if(row?.pending!==0)throw new Error('The privacy export pass has deferred, active or failed operations. Inspect queue diagnostics; processing is incomplete.');
        console.log(JSON.stringify({event:'privacy.operations.processed',completed,delivery:'database-artifact-only',
          deletionCompletion:'blocked-without-external-approvals'}));
        return;
      }else{
        try{await delay(1000,undefined,{signal:shutdown.signal});}
        catch(error){if(!shutdown.signal.aborted)throw error;}
      }
    }
  }finally{
    process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);
    try{await privacy?.close();}finally{await db.close();}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  runPrivacyCommand(process.argv[2]??'').catch(()=>{
    console.error('Privacy operation processing failed. Inspect private queue diagnostics; no export readiness, deletion completion or delivery was claimed.');
    process.exitCode=1;
  });
}
