/* Shared conditional settlement for /state and goal writes. D1 batch is a
 * transaction. Only a successful player CAS may advance settlement markers.
 * JSON keeps the robot snapshot guard below D1's bound-parameter limit. */
import {settleMastery,goalOk} from '../js/mastery.js';
import {parseItems} from '../js/shop.js';
export const MASTERY_RETRIES=3;
export async function commitMastery(env,accountId,p,robots,target,now=Date.now()){
 const owned=robots.map(r=>r.type);
 if(target!==undefined&&!goalOk(target,owned))return {error:'bad goal',status:400,type:target};
 const earned=robots.map(r=>({id:r.id,uid:r.uid,type:r.type,level:r.level,mLv:r.m_lv}));
 const mast=settleMastery(earned,owned,parseItems(p.items),p.m_goal);
 const goal=target===undefined?mast.goal:target;
 if(!mast.changed&&goal===p.m_goal)return {p,robots,mast};
 const snapshot=JSON.stringify(robots.map(r=>[r.id,r.type,r.level,r.m_lv]));
 const markers=earned.filter(r=>r.mLvNext!==undefined).map(r=>[r.id,r.mLvNext]);
 const items=JSON.stringify(mast.items),rev=p.rev+(target===undefined?0:1);
 const results=await env.DB.batch([
  env.DB.prepare(`UPDATE player SET items=?1, m_goal=?2, rev=?3, updated_at=?4
    WHERE account_id=?5 AND items IS ?6 AND m_goal IS ?7 AND rev=?8
    AND (SELECT json_group_array(json_array(id,type,level,m_lv))
         FROM (SELECT id,type,level,m_lv FROM robot WHERE account_id=?5 ORDER BY id)) IS ?9`)
   .bind(items,goal,rev,now,accountId,p.items,p.m_goal,p.rev,snapshot),
  // Exactly one marker statement: changes() must still refer to the player CAS.
  env.DB.prepare(`UPDATE robot SET m_lv=(SELECT json_extract(value,'$[1]')
      FROM json_each(?1) WHERE json_extract(value,'$[0]')=robot.id)
    WHERE account_id=?2 AND changes()=1
      AND id IN (SELECT json_extract(value,'$[0]') FROM json_each(?1))`)
   .bind(JSON.stringify(markers),accountId),
 ]);
 if(results[0]?.meta?.changes!==1)return {conflict:true};
 const next=new Map(markers);
 return {p:{...p,items,m_goal:goal,rev},robots:robots.map(r=>next.has(r.id)?{...r,m_lv:next.get(r.id)}:r),mast};
}
