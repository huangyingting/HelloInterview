import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';

const scenes = [
  { id: 'system-design', title: 'Walk through one request', nodes: ['Client', 'API', 'Database', 'Worker'], steps: [
    ['Start at the boundary', 'A client sends a request. Validate input and permission before changing state.'],
    ['Make the contract explicit', 'The API defines the operation, response, and errors the caller can depend on.'],
    ['Protect the source of truth', 'Persist the change atomically. Keep invariants in the datastore.'],
    ['Separate slower work', 'Publish background work with a durable identifier. Make retries safe.'],
  ] },
  { id: 'low-level-design', title: 'A parcel reservation walkthrough', nodes: ['Request', 'Inventory', 'Reservation', 'Pickup'], steps: [
    ['Begin with behavior', 'A package needs an available locker with enough capacity.'],
    ['Give one object the invariant', 'Inventory chooses compatible capacity and reserves it atomically.'],
    ['Model a clear state', 'A reservation owns its pickup code, expiry, and legal transitions.'],
    ['Complete the use case', 'Validate pickup, release the locker, and test invalid or expired codes.'],
  ] },
  { id: 'behavioral', title: 'Situation, task, action, result', nodes: ['Situation', 'Task', 'Action', 'Result'], steps: [
    ['Give just enough context', 'Choose one concrete moment. Explain the setting and the constraint.'],
    ['Name your responsibility', 'What was your goal? What part were you personally accountable for?'],
    ['Explain what you did', 'Describe your decisions, the alternatives, and why you chose this approach.'],
    ['Share the outcome honestly', 'State what changed, what you measured, and what you learned.'],
  ] },
  { id: 'concurrency', title: 'Two requests, one resource', nodes: ['Read', 'Compete', 'Atomic update', 'Retry'], steps: [
    ['A read is only a snapshot', 'Two callers can both observe the same resource as available.'],
    ['Find the race', 'Independent checks do not prevent two writers from reserving one item.'],
    ['Protect the whole operation', 'Enforce the check and reservation as one atomic datastore operation.'],
    ['Report the losing outcome', 'One caller succeeds. The other gets a clear conflict or a bounded retry.'],
  ] },
];
await fs.mkdir('public/media', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' });
try {
for (const scene of scenes) {
  const page = await browser.newPage();
  page.on('pageerror', error => console.error(`Media rendering failed: ${error.message}`));
  await page.setContent('<canvas width="1280" height="720"></canvas>');
  const base64 = await page.evaluate(async scene => {
    const canvas = document.querySelector('canvas'), ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(12);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 550000 });
    const chunks = [];
    const finished = new Promise(resolve => { recorder.ondataavailable = e => { if(e.data.size)chunks.push(e.data); }; recorder.onstop=resolve; });
    const start = performance.now();
    function rounded(x,y,w,h,r,fill,stroke) { ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.stroke();} }
    function words(text,x,y,maxWidth,lineHeight) { let line='';const parts=text.split(' ');for(const part of parts){const test=line+part+' ';if(ctx.measureText(test).width>maxWidth&&line){ctx.fillText(line,x,y);line=part+' ';y+=lineHeight;}else line=test;}ctx.fillText(line,x,y); }
    recorder.start();
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Media rendering exceeded the 30-second limit.')), 30000);
      function draw(now) {
        const elapsed=now-start, progress=Math.max(0,Math.min(elapsed/8800,1)), phase=Math.min(3,Math.floor(progress*4));
        ctx.fillStyle='#f7faf8';ctx.fillRect(0,0,1280,720);
        ctx.fillStyle='#dbe5df';for(let x=20;x<1280;x+=24)for(let y=20;y<720;y+=24){ctx.beginPath();ctx.arc(x,y,.7,0,Math.PI*2);ctx.fill();}
        ctx.fillStyle='#147d71';ctx.font='600 18px sans-serif';ctx.fillText('INTERVIEW STUDIO',70,60);
        ctx.fillStyle='#202b32';ctx.font='600 40px sans-serif';ctx.fillText(scene.title,70,135);
        ctx.fillStyle='#74817f';ctx.font='18px sans-serif';ctx.fillText('An original animated walkthrough • pause to reflect at each step',70,175);
        const nodeY=280,nodeWidth=220;
        for(let i=0;i<4;i++) {
          const x=70+i*300, active=i===phase;
          rounded(x,nodeY,nodeWidth,115,15,active?'#147d71':'#ffffff',active?'#147d71':'#dbe5df');
          ctx.fillStyle=active?'#ffffff':'#202b32';ctx.font='600 22px sans-serif';ctx.fillText(scene.nodes[i],x+22,nodeY+62);
          ctx.font='12px monospace';ctx.fillStyle=active?'#cce7dd':'#74817f';ctx.fillText(`0${i+1}`,x+22,nodeY+29);
          if(i<3){ctx.strokeStyle=i<phase?'#147d71':'#c4d4cc';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x+nodeWidth+10,nodeY+58);ctx.lineTo(x+280,nodeY+58);ctx.stroke();ctx.beginPath();ctx.moveTo(x+271,nodeY+50);ctx.lineTo(x+280,nodeY+58);ctx.lineTo(x+271,nodeY+66);ctx.stroke();}
        }
        rounded(70,450,1140,150,15,'#eaf5f0');
        ctx.fillStyle='#147d71';ctx.font='600 25px sans-serif';ctx.fillText(scene.steps[phase][0],95,495);
        ctx.fillStyle='#445c54';ctx.font='20px sans-serif';words(scene.steps[phase][1],95,540,1070,30);
        ctx.fillStyle='#74817f';ctx.font='14px sans-serif';ctx.fillText(`STEP ${phase+1} OF 4   •   Original Studio educational media`,70,655);
        rounded(70,682,1140,5,3,'#e0e9e3');rounded(70,682,1140*progress,5,3,'#147d71');
        if(progress<1)requestAnimationFrame(draw);else { clearTimeout(timeout); resolve(); }
      }
      requestAnimationFrame(draw);
    });
    recorder.stop();await finished;stream.getTracks().forEach(t=>t.stop());
    const bytes=new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer());
    let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.slice(i,i+16384));
    return btoa(binary);
  }, scene);
  await fs.writeFile(`public/media/${scene.id}.webm`, Buffer.from(base64, 'base64'));
  const vtt='WEBVTT\n\n'+scene.steps.map(([title,body],i)=>`${i+1}\n00:0${Math.floor(i*2.2)}.${String(Math.round(i*2.2%1*1000)).padStart(3,'0')} --> 00:0${Math.floor((i+1)*2.2)}.${String(Math.round((i+1)*2.2%1*1000)).padStart(3,'0')}\n${title}. ${body}\n`).join('\n');
  await fs.writeFile(`public/media/${scene.id}.vtt`,vtt);
  console.log(`Generated original ${scene.id} video (${Math.round(Buffer.from(base64,'base64').length/1024)} KB) and captions.`);
  await page.close();
}
} finally {
  await browser.close();
}
