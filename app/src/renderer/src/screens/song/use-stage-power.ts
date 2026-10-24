import {useEffect,useState} from 'react';
import {host} from '@/host';
export function useStagePower(active:boolean){
  const [error,setError]=useState('');
  useEffect(()=>{
    setError('');if(!active)return;
    if(!host.song.stagePower){setError('Sleep prevention is available in the desktop app.');return;}
    const token=crypto.randomUUID();let live=true;
    const renew=()=>{void host.song.stagePower!(token,true).then(()=>{if(live)setError('');}).catch(()=>{if(live)setError('Could not prevent sleep. Check your system power settings.');});};
    renew();const timer=setInterval(renew,5000);
    return()=>{live=false;clearInterval(timer);void host.song.stagePower!(token,false).catch(()=>{});};
  },[active]);
  return error;
}
