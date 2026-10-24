/** A renewable lease: renderer crashes cannot leave sleep prevention enabled indefinitely. */
export class StagePower {
  private leases=new Map<string,number>();
  private blocker:number|undefined;
  private timer:ReturnType<typeof setInterval>|undefined;
  constructor(private power:{start(type:'prevent-display-sleep'):number;stop(id:number):void},private now=()=>Date.now()){}
  update(owner:number,token:string,enabled:boolean){
    if(typeof token!=='string'||token.length>100||typeof enabled!=='boolean')throw new Error('Invalid stage power request.');
    const key=owner+':'+token;
    if(enabled)this.leases.set(key,this.now()+15000);else this.leases.delete(key);
    this.refresh();
  }
  release(owner:number){for(const key of this.leases.keys())if(key.startsWith(owner+':'))this.leases.delete(key);this.refresh();}
  close(){this.leases.clear();this.refresh();}
  private refresh(){
    for(const [key,until] of this.leases)if(until<=this.now())this.leases.delete(key);
    if(this.leases.size){
      if(this.blocker===undefined)this.blocker=this.power.start('prevent-display-sleep');
      if(!this.timer)this.timer=setInterval(()=>this.refresh(),1000);
    }else{
      if(this.blocker!==undefined)this.power.stop(this.blocker);
      this.blocker=undefined;clearInterval(this.timer);this.timer=undefined;
    }
  }
}
