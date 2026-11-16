import assert from 'node:assert/strict';
const base='http://localhost:8088',latencies=[];let failures=0;
const body={latitude:11.0735,longitude:76.074};
for(let batch=0;batch<10;batch++)await Promise.all(Array.from({length:5},async()=>{const start=performance.now();try{const r=await fetch(base+'/catalog/coverage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});assert.ok(r.ok);const data=await r.json();assert.ok(Array.isArray(data.restaurants));}catch{failures++;}latencies.push(performance.now()-start);}));
latencies.sort((a,b)=>a-b);console.log(JSON.stringify({scenario:'Local catalog: 50 requests, concurrency 5; not a production capacity claim',failures,p50Ms:Math.round(latencies[24]),p95Ms:Math.round(latencies[47]),maxMs:Math.round(latencies[49])}));assert.equal(failures,0);
