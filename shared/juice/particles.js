
// shared/juice/particles.js
export class ParticleSystem {
  constructor({canvas, max=512}){
    this.canvas = canvas || document.createElement('canvas');
    if (!canvas) {
      Object.assign(this.canvas.style, {position:'absolute', inset:'0', pointerEvents:'none'});
      document.body.appendChild(this.canvas);
      this.resize();
      addEventListener('resize', ()=>this.resize());
    }
    this.ctx = this.canvas.getContext('2d');
    this.max = max;
    this.pool = [];
  }
  resize(){
    const dpr = devicePixelRatio||1;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.dpr = dpr;
  }
  emit(x,y,{vx=0,vy=0,life=0.6,size=3,color='white',spread=0.6,count=12}={}){
    for(let i=0;i<count;i++){
      const a = Math.random()*Math.PI*2;
      const s = spread * (0.5+Math.random());
      this.pool.push({
        x,y,vx:vx+Math.cos(a)*80*s, vy:vy+Math.sin(a)*80*s,
        life, age:0, size: size*(0.6+Math.random()*0.8), color
      });
      if (this.pool.length>this.max) this.pool.shift();
    }
  }
  update(dt){
    const g = this.pool;
    for (let i=g.length-1;i>=0;i--){
      const p=g[i];
      p.age += dt;
      if (p.age>=p.life){ g.splice(i,1); continue; }
      p.x += p.vx*dt;
      p.y += p.vy*dt;
      p.vy += 120*dt;
    }
  }
  draw(){
    const ctx=this.ctx;
    ctx.save();
    ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
    ctx.globalCompositeOperation='lighter';
    for(const p of this.pool){
      const t = 1 - p.age/p.life;
      ctx.globalAlpha = Math.max(0, t);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x*this.dpr, p.y*this.dpr, Math.max(1,p.size*this.dpr*t), 0, Math.PI*2);
      ctx.fill();
    }
    ctx.restore();
  }
}
