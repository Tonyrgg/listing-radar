import { formatCurrency, formatDate } from "@/lib/formatting";
type PriceEvent={occurredAt:string;oldPrice:number|null;newPrice:number|null};
export function PropertyPriceHistory({events,currentPrice,conflict=false}:{events:PriceEvent[];currentPrice:number|null;conflict?:boolean}){
 const known=events.filter(e=>e.newPrice!=null&&Number.isFinite(e.newPrice)&&Number.isFinite(Date.parse(e.occurredAt))).sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt));
 if(conflict)return <div className="lr-price-empty"><p>Le fonti riportano prezzi discordanti.</p><a href="#pubblicazioni">Confronta i prezzi per pubblicazione</a></div>;
 if(!known.length)return <div className="lr-price-empty"><strong>{formatCurrency(currentPrice)}</strong><p>Nessuna variazione di prezzo registrata.</p><span>Il prezzo attuale non ricostruisce uno storico.</span></div>;
 const points=known.flatMap((e,i)=>i===0&&e.oldPrice!=null?[{time:Date.parse(e.occurredAt),price:e.oldPrice},{time:Date.parse(e.occurredAt),price:e.newPrice!}]:[{time:Date.parse(e.occurredAt),price:e.newPrice!}]);
 const prices=points.map(p=>p.price), low=Math.min(...prices),high=Math.max(...prices);
 const pad=Math.max((high-low)*.2,high*.025,1),min=low-pad,max=high+pad;
 const first=points[0].time,last=points[points.length-1].time,span=Math.max(last-first,1);
 const x=(time:number)=>64+(time-first)/span*712;
 const y=(price:number)=>160-(price-min)/(max-min)*132;
 const path=points.map((p,i)=>(i===0?"M":"H")+x(p.time).toFixed(1)+(i===0?" "+y(p.price).toFixed(1):" V"+y(p.price).toFixed(1))).join(" ");
 return <figure className="lr-price-chart">
  <svg viewBox="0 0 800 195" role="img" aria-label={"Variazioni del prezzo richiesto: da "+formatCurrency(points[0].price)+" a "+formatCurrency(points[points.length-1].price)}>
   {[0,.5,1].map(f=>{const val=min+f*(max-min);return <g key={f}><line x1="64" x2="776" y1={y(val)} y2={y(val)} className="lr-chart-grid"/><text x="56" y={y(val)+4} textAnchor="end" className="lr-chart-label">{Math.round(val).toLocaleString("it-IT")}</text></g>})}
   <path d={path} className="lr-chart-price"/>
   {points.map((p,i)=><circle key={i} cx={x(p.time)} cy={y(p.price)} r="3" className="lr-chart-point"><title>{formatDate(new Date(p.time).toISOString())+" · "+formatCurrency(p.price)}</title></circle>)}
   <text x="64" y="188" className="lr-chart-label">{formatDate(new Date(first).toISOString())}</text>
   <text x="776" y="188" textAnchor="end" className="lr-chart-label">{formatDate(new Date(last).toISOString())}</text>
  </svg>
  <figcaption>Prezzi richiesti. Le date indicano quando abbiamo rilevato le variazioni.</figcaption>
  <details><summary>Leggi i valori dello storico</summary><table><thead><tr><th>Rilevato il</th><th>Da</th><th>A</th></tr></thead><tbody>{known.map((e,i)=><tr key={i}><td>{formatDate(e.occurredAt)}</td><td>{formatCurrency(e.oldPrice)}</td><td>{formatCurrency(e.newPrice)}</td></tr>)}</tbody></table></details>
 </figure>;
}
