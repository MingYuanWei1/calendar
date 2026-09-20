import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT} from 'jose';
import {verifySchoolIdentity} from '../../server/school-auth.mjs';
test('school identity verifies signature, tenant, nonce, audience, expiry and required claims',async()=>{
 const {publicKey,privateKey}=await generateKeyPair('RS256'),wrongKeys=await generateKeyPair('RS256');
 const config={tenantId:'school-tenant',issuer:'https://login.microsoftonline.com/school-tenant/v2.0',clientId:'app-client',nonce:'flow-nonce'};
 const sign=(claims={},overrides={})=>new SignJWT({tid:config.tenantId,oid:'student-object',nonce:config.nonce,...claims}).setProtectedHeader({alg:'RS256'}).setIssuer(config.issuer).setAudience(overrides.aud||config.clientId).setIssuedAt().setExpirationTime(overrides.exp||'5m').sign(privateKey);
 assert.equal((await verifySchoolIdentity(await sign(),publicKey,config)).oid,'student-object');
 for(const claims of [{tid:'different-tenant'},{nonce:'replayed-nonce'},{oid:undefined}])await assert.rejects(verifySchoolIdentity(await sign(claims),publicKey,config));
 await assert.rejects(verifySchoolIdentity(await sign({}, {aud:'different-app'}),publicKey,config));
 await assert.rejects(verifySchoolIdentity(await sign({}, {exp:'-1m'}),publicKey,config));
 await assert.rejects(verifySchoolIdentity(await sign(),wrongKeys.publicKey,config));
});
