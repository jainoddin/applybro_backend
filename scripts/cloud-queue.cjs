async function claim(db,owner,connectionsOnly=false,userId=null){return db.$queryRaw`
 WITH candidate AS (
 SELECT r."id",r."userId" FROM "AgentRun" r LEFT JOIN "AgentPreference" p ON p."userId"=r."userId"
 WHERE r."state"='QUEUED' AND r."nextAttemptAt"<=NOW() AND (r."kind"='CONNECT' OR p."enabled"=TRUE)
 AND (${connectionsOnly}=FALSE OR r."kind"='CONNECT')
 AND (${userId}::TEXT IS NULL OR r."userId"=${userId})
 AND NOT EXISTS(SELECT 1 FROM "AgentUserLease" l WHERE l."userId"=r."userId" AND l."expiresAt">NOW())
 ORDER BY r."createdAt" FOR UPDATE OF r SKIP LOCKED LIMIT 1
 ), lease AS (
 INSERT INTO "AgentUserLease"("userId","runId","owner","expiresAt")
 SELECT "userId","id",${owner},NOW()+INTERVAL '45 seconds' FROM candidate
 ON CONFLICT ("userId") DO UPDATE SET "runId"=EXCLUDED."runId","owner"=EXCLUDED."owner","expiresAt"=EXCLUDED."expiresAt"
 WHERE "AgentUserLease"."expiresAt"<=NOW() RETURNING "runId"
 ) UPDATE "AgentRun" SET "state"='RUNNING',"leaseOwner"=${owner},"leaseUntil"=NOW()+INTERVAL '45 seconds',"updatedAt"=NOW()
 WHERE "id" IN (SELECT "runId" FROM lease) RETURNING *`;}
async function heartbeat(db,id,userId,owner){await db.$transaction([
 db.$executeRaw`UPDATE "AgentRun" SET "leaseUntil"=NOW()+INTERVAL '45 seconds' WHERE "id"=${id} AND "leaseOwner"=${owner}`,
 db.$executeRaw`UPDATE "AgentUserLease" SET "expiresAt"=NOW()+INTERVAL '45 seconds' WHERE "userId"=${userId} AND "runId"=${id} AND "owner"=${owner}`,
]);}
async function recover(db){
 await db.$executeRaw`UPDATE "AgentRun" SET "state"='UNKNOWN',"reason"='Worker lost during submission. Verify outcome; no automatic retry.',"updatedAt"=NOW() WHERE "state"='SUBMITTING' AND "leaseUntil"<NOW()`;
 await db.$executeRaw`UPDATE "AgentRun" SET "state"='QUEUED',"leaseOwner"=NULL WHERE "state"='RUNNING' AND "submitReservedAt" IS NULL AND "leaseUntil"<NOW()`;
}
module.exports={claim,heartbeat,recover};
