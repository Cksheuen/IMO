const finite = n => typeof n === 'number' && Number.isFinite(n);
export function validateScene(scene) {
  const { width:w, height:h, heights, layers }=scene;
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<2||h<2||w*h>16384) throw new Error('Invalid or oversized terrain grid');
  if(!Array.isArray(heights)||heights.length!==w*h||!heights.every(finite)) throw new Error('Invalid height samples');
  if(!finite(scene.seaLevel)) throw new Error('Missing finite water surface level');
  if(!Array.isArray(layers)||!layers.length||layers.length>8) throw new Error('Invalid terrain layers');
  const ids=new Set();
  for(const layer of layers){
    if(typeof layer.id!=='string'||ids.has(layer.id)) throw new Error('Duplicate or invalid layer id'); ids.add(layer.id);
    if(!Array.isArray(layer.values)||layer.values.length!==w*h||!layer.values.every(finite)) throw new Error('Invalid layer values');
    if(layer.categories){
      if(!Array.isArray(layer.categories)||!layer.categories.length||!layer.categories.every(c=>typeof c.label==='string'&&/^#[0-9a-f]{6}$/i.test(c.color))) throw new Error('Invalid category palette');
      if(!layer.values.every(v=>Number.isInteger(v)&&v>=0&&v<layer.categories.length)) throw new Error('Unknown category value');
    }else if(!finite(layer.min)||!finite(layer.max)||layer.min>=layer.max||!Array.isArray(layer.colors)||layer.colors.length<2||!layer.colors.every(c=>/^#[0-9a-f]{6}$/i.test(c))) throw new Error('Invalid continuous color scale');
  }
  for(const m of scene.markers??[]){
    if(!Number.isInteger(m.x)||!Number.isInteger(m.y)||m.x<0||m.y<0||m.x>=w||m.y>=h||typeof m.label!=='string') throw new Error('Invalid map marker');
  }
  return scene;
}

export function triangles(width,height){
  const result=[];
  for(let y=0;y<height-1;y++) for(let x=0;x<width-1;x++){
    const a=y*width+x,b=a+1,c=a+width+1,d=a+width;
    result.push([a,b,c],[a,c,d]);
  }
  return result;
}

export function contourSegments(scene,level){
  const result=[];
  for(const face of triangles(scene.width,scene.height)){
    const hits=[];
    for(let edge=0;edge<3;edge++){
      const a=face[edge],b=face[(edge+1)%3],ha=scene.heights[a],hb=scene.heights[b];
      if(!((ha<level&&hb>=level)||(hb<level&&ha>=level))) continue;
      const t=(level-ha)/(hb-ha);
      const p=[a%scene.width+(b%scene.width-a%scene.width)*t,Math.floor(a/scene.width)+(Math.floor(b/scene.width)-Math.floor(a/scene.width))*t,level];
      if(!hits.some(q=>Math.abs(p[0]-q[0])+Math.abs(p[1]-q[1])<1e-10)) hits.push(p);
    }
    if(hits.length===2) result.push(hits);
  }
  return result;
}

export function project(point,scene,view){
  const extent=Math.max(scene.width-1,scene.height-1);
  const x=(point[0]-(scene.width-1)/2)/extent, y=(point[1]-(scene.height-1)/2)/extent;
  const z=(Math.max(scene.seaLevel,point[2])-scene.seaLevel)*.26*view.exaggeration;
  if(view.mode==='2d') return [x,y,0];
  const a=view.azimuth*Math.PI/180,b=view.pitch*Math.PI/180;
  const u=Math.cos(a)*x-Math.sin(a)*y,v=Math.sin(a)*x+Math.cos(a)*y;
  return [u,Math.sin(b)*v-Math.cos(b)*z,Math.cos(b)*v+Math.sin(b)*z];
}

export function barycentric(point,triangle){
  const [a,b,c]=triangle;
  const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
  if(Math.abs(den)<1e-12) return null;
  const u=((b[1]-c[1])*(point[0]-c[0])+(c[0]-b[0])*(point[1]-c[1]))/den;
  const v=((c[1]-a[1])*(point[0]-c[0])+(a[0]-c[0])*(point[1]-c[1]))/den;
  const w=1-u-v;
  return Math.min(u,v,w)>=-1e-8?[u,v,w]:null;
}

const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
export function colorFor(layer,value,light=1){
  let c;
  if(layer.categories) c=rgb(layer.categories[value].color);
  else{
    const u=Math.min(1,Math.max(0,(value-layer.min)/(layer.max-layer.min)))*(layer.colors.length-1);
    const i=Math.min(layer.colors.length-2,Math.floor(u)),t=u-i,a=rgb(layer.colors[i]),b=rgb(layer.colors[i+1]);
    c=a.map((v,j)=>v+(b[j]-v)*t);
  }
  return `rgb(${c.map(v=>Math.round(Math.max(0,Math.min(255,v*light)))).join(',')})`;
}
