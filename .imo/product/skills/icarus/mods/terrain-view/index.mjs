import { validateScene, triangles, contourSegments, project, barycentric, colorFor } from './geometry.mjs';

const css=`.tv{font:14px/1.65 system-ui,sans-serif;color:#173e39;background:#f4f6ee;border:1px solid #cedbcf;border-radius:18px;overflow:hidden;margin:24px 0}.tv h2{font-size:25px!important;border:0!important;margin:0!important;padding:0!important;line-height:1.4}.tv .tv-top{padding:22px 24px 14px}.tv p{margin:8px 0}.tv .tv-tools{padding:14px 22px;background:#e8eee3;display:flex;gap:10px;align-items:end;flex-wrap:wrap}.tv label{font-size:12px;display:flex;gap:6px;align-items:center}.tv .tv-stack{display:grid;gap:4px}.tv select,.tv button{font:13px system-ui;color:#214b40;background:white;border:1px solid #b5cbbd;border-radius:8px;padding:8px 10px;cursor:pointer}.tv button[aria-pressed=true]{background:#225e4a;color:#fff}.tv input{accent-color:#28745d}.tv canvas{display:block;width:100%;height:540px;touch-action:none;cursor:grab;background:#edf0e6}.tv canvas:focus{outline:2px solid #39916f;outline-offset:-2px}.tv .tv-meta{padding:12px 22px;border-top:1px solid #d9e0d4;color:#526d60;font-size:12px}.tv .tv-legend{display:flex;gap:14px;flex-wrap:wrap;align-items:center;padding:12px 22px;background:#fff;font-size:12px}.tv .tv-legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:5px}.tv .tv-ramp{width:180px;height:12px;border-radius:5px;display:inline-block}.tv .tv-readout{background:#fff;padding:18px 22px;border-top:1px solid #d9e0d4;min-height:85px}.tv .tv-readout strong{display:block;font-size:17px}.tv .tv-values{display:flex;gap:16px;flex-wrap:wrap;margin:6px 0}.tv .tv-values span{font-variant-numeric:tabular-nums}.tv .tv-note{font-size:12px;color:#5e7569}.tv details{padding:8px 22px}.tv summary{cursor:pointer}.tv .tv-help{font-size:12px;color:#647d6c}@media(max-width:650px){.tv canvas{height:420px}.tv .tv-tools{padding:12px;gap:7px}.tv .tv-top{padding:18px}.tv .tv-meta{font-size:11px}}`;
function el(tag,text,cls){const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;}
function select(label,options,parent){const box=el('label',null,'tv-stack'),input=el('select');input.setAttribute('aria-label',label);box.append(el('span',label),input);for(const [value,text]of options){const op=el('option',text);op.value=value;input.append(op);}parent.append(box);return input;}
function button(text,parent,action,signal){const b=el('button',text);b.type='button';b.addEventListener('click',action,{signal});parent.append(b);return b;}
function check(text,value,parent,action,signal){const l=el('label'),i=el('input');i.type='checkbox';i.checked=value;i.addEventListener('change',()=>action(i.checked),{signal});l.append(i,el('span',text));parent.append(l);return i;}

export default {
 id:'terrain-view',apiVersion:1,requires:[],
 mount({root,signal,onCleanup}){
  for(const target of root.querySelectorAll('[data-terrain-view]')){
   const data=target.querySelector('script[data-terrain-config]');if(!data)throw new Error('Missing terrain config');
   const config=JSON.parse(data.textContent);
   if(config.schema!=='icarus-terrain-view/v1'||!Array.isArray(config.scenes)||!config.scenes.length||config.scenes.length>8)throw new Error('Invalid terrain scene list');
   config.scenes.forEach(validateScene);
   const panel=el('section',null,'tv');panel.dataset.icarusMod='terrain-view';panel.setAttribute('aria-label',config.title||'地形浏览器');target.append(panel);onCleanup(()=>panel.remove());
   const fallback=target.querySelector('[data-terrain-fallback]');if(fallback){const prev=fallback.hidden;fallback.hidden=true;onCleanup(()=>{fallback.hidden=prev;});}
   panel.append(el('style',css));
   const top=el('div',null,'tv-top');top.append(el('h2',config.title||'地形浏览器'),el('p','拖动旋转三维地形；切换俯视图查看等高线。点击地块读取原始数值。','tv-help'));panel.append(top);
   const toolbar=el('div',null,'tv-tools'),camera=el('div',null,'tv-tools');panel.append(toolbar,camera);
   const sceneSelect=select('数据场景',config.scenes.map((s,i)=>[String(i),s.title]),toolbar);
   const layerSelect=select('地图配色',[],toolbar);
   const canvas=el('canvas');canvas.setAttribute('aria-label','可旋转地形图；方向键旋转，加减键缩放，点击地块查看数值');canvas.tabIndex=0;panel.append(canvas);
   const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas 2D unavailable');
   const legend=el('div',null,'tv-legend'),status=el('div',null,'tv-meta'),readout=el('div',null,'tv-readout');readout.setAttribute('aria-live','polite');readout.dataset.reviewTarget='terrain-selected-cell';panel.append(legend,status,readout);
   const sourceDetails=el('details'),sourceTitle=el('summary','数据来源与显示边界'),sourceText=el('p');sourceDetails.append(sourceTitle,sourceText);panel.append(sourceDetails);
   let scene,faces=[],contours=[],selected=null,screenFaces=[],frame=0;
   const view={mode:'3d',azimuth:-30,pitch:48,zoom:1,exaggeration:2,contours:true,step:.1,markers:true};
   const request=()=>{if(!signal.aborted&&!frame)frame=requestAnimationFrame(()=>{frame=0;draw();});};
   onCleanup(()=>{if(frame)cancelAnimationFrame(frame);});
   const mode2=button('二维俯视',toolbar,()=>{view.mode='2d';request();},signal);
   const mode3=button('三维地形',toolbar,()=>{view.mode='3d';request();},signal);
   check('等高线',true,toolbar,v=>{view.contours=v;request();},signal);
   const stepSelect=select('等高距',[['0.05','0.05'],['0.1','0.10'],['0.2','0.20']],toolbar);stepSelect.value='0.1';
   check('人物与物体',true,toolbar,v=>{view.markers=v;request();},signal);
   button('左转',camera,()=>{view.azimuth-=20;request();},signal);
   button('右转',camera,()=>{view.azimuth+=20;request();},signal);
   button('抬高视角',camera,()=>{view.pitch=Math.min(85,view.pitch+10);request();},signal);
   button('放大',camera,()=>{view.zoom=Math.min(3,view.zoom*1.2);request();},signal);
   button('缩小',camera,()=>{view.zoom=Math.max(.5,view.zoom/1.2);request();},signal);
   const exLabel=el('label'),exInput=el('input');exInput.type='range';exInput.min=1;exInput.max=5;exInput.step=.25;exInput.value=2;exInput.setAttribute('aria-label','纵向夸张');exLabel.append(el('span','纵向夸张'),exInput);camera.append(exLabel);
   button('复位',camera,()=>{Object.assign(view,{azimuth:-30,pitch:48,zoom:1,exaggeration:2});exInput.value='2';request();},signal);
   button('检查中心格',camera,()=>{selected=[Math.floor(scene.width/2),Math.floor(scene.height/2)];inspect();request();},signal);
   exInput.addEventListener('input',()=>{view.exaggeration=Number(exInput.value);request();},{signal});
   stepSelect.addEventListener('change',()=>{view.step=Number(stepSelect.value);buildContours();request();},{signal});
   layerSelect.addEventListener('change',()=>{updateLegend();request();},{signal});
   sceneSelect.addEventListener('change',loadScene,{signal});

   function buildContours(){
    contours=[];const low=Math.max(Math.min(...scene.heights),scene.seaLevel),high=Math.max(...scene.heights);
    let count=0;
    for(let n=Math.ceil(low/view.step);n*view.step<=high;n++){
     if(++count>80)break;const level=n*view.step;
     for(const ends of contourSegments(scene,level))contours.push({level,ends});
    }
   }
   function loadScene(){
    scene=config.scenes[Number(sceneSelect.value)];selected=null;view.zoom=1;
    faces=triangles(scene.width,scene.height);
    layerSelect.replaceChildren();for(const layer of scene.layers){const op=el('option',layer.label);op.value=layer.id;layerSelect.append(op);}
    sourceText.textContent=scene.source;
    buildContours();updateLegend();inspect();request();
   }
   function updateLegend(){
    const l=scene.layers.find(l=>l.id===layerSelect.value);legend.replaceChildren();
    if(l.categories)for(const c of l.categories){const s=el('span'),swatch=el('i');swatch.style.background=c.color;s.append(swatch,document.createTextNode(c.label));legend.append(s);}
    else{const ramp=el('span',null,'tv-ramp');ramp.style.background=`linear-gradient(to right,${l.colors.join(',')})`;legend.append(el('span',`${l.min}`),ramp,el('span',`${l.max} · ${l.unit||'无量纲'}`));}
    legend.append(el('span','圆点：人物 · 小方块：物体（如有）'));
   }
   function inspect(){
    readout.replaceChildren();
    if(!selected){readout.append(el('strong','选择一处地块'),el('span','点击地图，或使用“检查中心格”。下方数值来自该场景的数据，视角变化不会改变它们。','tv-note'));return;}
    const [x,y]=selected,index=y*scene.width+x;
    readout.dataset.reviewTarget=`terrain-cell-${scene.id}-${x}-${y}`;
    readout.append(el('strong',`地块 (${x}, ${y}) · ${scene.title}`));
    const values=el('div',null,'tv-values');
    for(const l of scene.layers)values.append(el('span',`${l.label}：${l.categories?l.categories[l.values[index]].label:l.values[index].toFixed(4)}`));
    readout.append(values);
    const here=(scene.markers??[]).filter(m=>m.x===x&&m.y===y);
    readout.append(el('p',here.length?here.map(m=>m.label).join('；'):'此地块没有已记录的人物或物体。','tv-note'));
   }
   function draw(){
    const width=Math.max(300,canvas.clientWidth),height=canvas.clientHeight||540,dpr=Math.min(2,window.devicePixelRatio||1);
    if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);}
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
    const extent=Math.max(scene.width-1,scene.height-1);
    const point=i=>[i%scene.width,Math.floor(i/scene.width),scene.heights[i]];
    const raw=scene.heights.map((_,i)=>project(point(i),scene,view));
    const minX=Math.min(...raw.map(p=>p[0])),maxX=Math.max(...raw.map(p=>p[0]));
    const minY=Math.min(...raw.map(p=>p[1])),maxY=Math.max(...raw.map(p=>p[1]));
    const scale=Math.min((width-70)/Math.max(.01,maxX-minX),(height-65)/Math.max(.01,maxY-minY))*.94*view.zoom;
    const screen=r=>[width/2+(r[0]-(minX+maxX)/2)*scale,height/2+(r[1]-(minY+maxY)/2)*scale,r[2]];
    const toScreen=p=>screen(project(p,scene,view));
    const layer=scene.layers.find(l=>l.id===layerSelect.value);
    const projected=raw.map(screen);
    screenFaces=faces.map(face=>({face,vertices:face.map(i=>projected[i]),depth:face.reduce((n,i)=>n+projected[i][2],0)/3})).sort((a,b)=>a.depth-b.depth);
    ctx.lineJoin='round';
    for(const f of screenFaces){
     const ps=f.vertices;
     const value=layer.categories?layer.values[f.face[0]]:f.face.reduce((n,i)=>n+layer.values[i],0)/3;
     let light=1;
     if(view.mode==='3d'){
      const [a,b,c]=f.face.map(i=>{const p=point(i);return [p[0]/extent,p[1]/extent,Math.max(p[2],scene.seaLevel)*.26*view.exaggeration];});
      const u=b.map((n,i)=>n-a[i]),v=c.map((n,i)=>n-a[i]);
      const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...n);
      light=.70+.30*Math.max(0,(-.45*n[0]-.55*n[1]+.7*n[2])/Math.max(len,1e-12));
     }
     ctx.fillStyle=colorFor(layer,value,light);ctx.beginPath();ctx.moveTo(ps[0][0],ps[0][1]);ctx.lineTo(ps[1][0],ps[1][1]);ctx.lineTo(ps[2][0],ps[2][1]);ctx.closePath();ctx.fill();
     // Same-color subpixel stroke prevents seams between adjacent Canvas triangles.
     ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=.45;ctx.stroke();
    }
    // Contours are an intentionally visible overlay, including on rear-facing slopes.
    if(view.contours){ctx.strokeStyle='rgba(27,48,38,.46)';ctx.lineWidth=.7;ctx.beginPath();for(const s of contours){const a=toScreen(s.ends[0]),b=toScreen(s.ends[1]);ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);}ctx.stroke();}
    if(view.markers)for(const m of scene.markers??[]){const p=toScreen([m.x,m.y,scene.heights[m.y*scene.width+m.x]]);ctx.fillStyle=m.group==='person'?'#b84930':'#fbefb4';ctx.strokeStyle='#294c3d';ctx.lineWidth=.9;ctx.beginPath();if(m.group==='person')ctx.arc(p[0],p[1]-3,3.4,0,Math.PI*2);else ctx.rect(p[0]-2,p[1]-2,4,4);ctx.fill();ctx.stroke();}
    if(selected){const p=toScreen([...selected,scene.heights[selected[1]*scene.width+selected[0]]]);ctx.strokeStyle='#a33826';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p[0],p[1],8,0,Math.PI*2);ctx.stroke();}
    const northA=toScreen([scene.width*.14,scene.height*.10,scene.seaLevel]),northB=toScreen([scene.width*.14,0,scene.seaLevel]);ctx.strokeStyle='#254b3a';ctx.fillStyle='#254b3a';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(...northA.slice(0,2));ctx.lineTo(...northB.slice(0,2));ctx.stroke();ctx.font='12px system-ui';ctx.fillText('N',northB[0]-4,northB[1]-7);
    mode2.setAttribute('aria-pressed',String(view.mode==='2d'));mode3.setAttribute('aria-pressed',String(view.mode==='3d'));
    status.textContent=`${scene.width} × ${scene.height} 格 · ${view.mode==='3d'?'三维正交投影':'二维俯视'} · 方位 ${Math.round(view.azimuth)}° · 俯角 ${Math.round(view.pitch)}° · 缩放 ${view.zoom.toFixed(2)} · 纵向夸张 ${view.exaggeration.toFixed(2)} · 等高距 ${view.step.toFixed(2)}（${scene.heightUnit||'归一化高程'}）。等高线和标记为叠加层；水面为固定阈值示意，不是水文模拟。`;
   }
   let drag=null;
   canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false};canvas.setPointerCapture(e.pointerId);},{signal});
   canvas.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>4)drag.moved=true;if(view.mode==='3d'&&drag.moved){view.azimuth+=dx*.4;view.pitch=Math.max(20,Math.min(85,view.pitch+dy*.25));request();}drag.x=e.clientX;drag.y=e.clientY;},{signal});
   canvas.addEventListener('pointerup',e=>{if(!drag)return;const moved=drag.moved;drag=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(moved)return;const rect=canvas.getBoundingClientRect(),p=[e.clientX-rect.left,e.clientY-rect.top];for(let n=screenFaces.length-1;n>=0;n--){const f=screenFaces[n],weights=barycentric(p,f.vertices);if(!weights)continue;let x=0,y=0;f.face.forEach((id,k)=>{x+=id%scene.width*weights[k];y+=Math.floor(id/scene.width)*weights[k];});selected=[Math.max(0,Math.min(scene.width-1,Math.round(x))),Math.max(0,Math.min(scene.height-1,Math.round(y)))];inspect();request();break;}},{signal});
   canvas.addEventListener('pointercancel',()=>{drag=null;},{signal});
   canvas.addEventListener('keydown',e=>{let handled=true;if(e.key==='ArrowLeft')view.azimuth-=10;else if(e.key==='ArrowRight')view.azimuth+=10;else if(e.key==='ArrowUp')view.pitch=Math.min(85,view.pitch+5);else if(e.key==='ArrowDown')view.pitch=Math.max(20,view.pitch-5);else if(e.key==='+'||e.key==='=')view.zoom=Math.min(3,view.zoom*1.2);else if(e.key==='-')view.zoom=Math.max(.5,view.zoom/1.2);else handled=false;if(handled){e.preventDefault();request();}},{signal});
   const observer=new ResizeObserver(request);observer.observe(canvas);onCleanup(()=>observer.disconnect());
   loadScene();
  }
 },
};
