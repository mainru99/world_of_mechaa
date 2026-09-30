// Bound the rendered cards, while searching the entire inventory. No UID or
// equipment/rarity rules are changed here; callers supply their ordered pool.
export const PART_PAGE=24;
export function partWindow(parts,query='',page=0,pageSize=PART_PAGE){
 const size=Number.isInteger(pageSize)&&pageSize>0?pageSize:PART_PAGE;
 const words=String(query).trim().toLocaleLowerCase('ko-KR').split(/\s+/).filter(Boolean);
 const hits=words.length?parts.filter(p=>{
  const text=[p.name,p.rarity,p.slot,{WEAPON:'무장',FRAME:'프레임',BOOSTER:'부스터',CORE:'코어'}[p.slot],`+${p.enh||0}`].join(' ').toLocaleLowerCase('ko-KR');
  return words.every(w=>text.includes(w));
 }):parts;
 const pages=Math.max(1,Math.ceil(hits.length/size));
 const at=Math.min(pages-1,Math.max(0,Number.isInteger(page)?page:0));
 return {rows:hits.slice(at*size,(at+1)*size),total:hits.length,page:at,pages};
}
