// Additive preparation contract. Old responses can still use robot+circuit;
// incomplete server numbers must never turn into a misleading known card.
export function preparedStats(raw){
 if(!raw||typeof raw!=='object'||!['hp','atk','def','spd','crit','eva'].every(k=>Number.isFinite(raw[k])))return null;
 if(raw.hp<=0||raw.atk<=0||raw.def<0||raw.spd<=0||raw.crit<0||raw.crit>1||raw.eva<0||raw.eva>=1)return null;
 return {...raw};
}
