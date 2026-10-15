import {pathToFileURL} from 'node:url';
import {loadAuthSettings} from '../auth/config';
import {prismaConnection} from '../db/prisma';
import {assertDatabaseVersion} from '../db/migrations';
import {appendStaffRole} from '../staff';

export async function runStaffCommand(args:string[]) {
  const [state,userId,role,actorRef,...rest]=args,[endsAt,...grantReason]=rest;
  const reason=(state==='granted'?grantReason:rest).join(' ');
  if(!['granted','revoked'].includes(state??''))throw new Error('Choose granted or revoked.');
  if(!process.env.DATABASE_URL||!loadAuthSettings())throw new Error('Staff role provisioning requires explicit PostgreSQL and Auth.js configuration.');
  const db=prismaConnection();
  try{
    await assertDatabaseVersion(db);
    const result=await appendStaffRole(db,{userId,role,state,actorRef,reason,...(state==='granted'?{endsAt}: {})});
    console.log(JSON.stringify({event:'staff.role.recorded',...result}));
  }finally{await db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  runStaffCommand(process.argv.slice(2)).catch(()=>{
    console.error('Staff role change failed. Verify the exact account, role, expiry, operator reference and reason; no success was reported.');
    process.exitCode=1;
  });
}
