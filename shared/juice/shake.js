
// shared/juice/shake.js
export class ScreenShake {
  constructor() { this.t = 0; this.mag = 0; }
  trigger(mag=6, duration=0.25){ this.t = duration; this.mag = mag; }
  get offset(){
    if (this.t<=0) return {x:0,y:0};
    const k = this.t;
    const x = (Math.random()*2-1)*this.mag*k;
    const y = (Math.random()*2-1)*this.mag*k;
    return {x,y};
  }
  update(dt){ if(this.t>0){ this.t=Math.max(0,this.t-dt); } }
}
