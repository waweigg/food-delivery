export type OpeningPeriod={day:number;open:number;close:number};
const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
export function isOpen(hours:OpeningPeriod[],timezone:string,at:Date=new Date()):boolean {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(at);
  const part=(type:string)=>parts.find(p=>p.type===type)!.value;
  const minute=days.indexOf(part('weekday'))*1440+Number(part('hour'))*60+Number(part('minute'));
  return hours.some(p=>{
    const start=p.day*1440+p.open;
    const end=p.day*1440+p.close+(p.close<p.open?1440:0);
    return [minute,minute+10080].some(value=>value>=start && value<end);
  });
}
export function availability(row:{status:string;active:boolean;temporaryClosedUntil:Date|null;hours:unknown;timezone:string},at:Date=new Date()) {
  const reason=row.status!=='APPROVED'?'NOT_APPROVED':!row.active?'INACTIVE':row.temporaryClosedUntil && row.temporaryClosedUntil>at?'TEMPORARILY_CLOSED':!isOpen(row.hours as OpeningPeriod[],row.timezone,at)?'OUTSIDE_HOURS':'OPEN';
  return {eligible:reason==='OPEN',reason,checkedAt:at.toISOString()};
}
