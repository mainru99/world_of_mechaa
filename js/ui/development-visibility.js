import {ROBOT_TYPES} from '../../data/balance.js';
import {goalOk} from '../mastery.js';
import {relatedTypes} from './development-graph.js';

// There is no separate research record in the current server contract.
// Owned units are the navigable archive; only unlocked candidates on the
// inspected path are revealed. Shards alone do not reveal a locked unit.
export function developmentVisibility(owned,selected,goal){
 const have=owned instanceof Set?owned:new Set(owned||[]),path=relatedTypes(selected);
 return id=>!!ROBOT_TYPES[id]&&!ROBOT_TYPES[id].story&&
  (have.has(id)||id===goal||(path.has(id)&&goalOk(id,have)));
}
