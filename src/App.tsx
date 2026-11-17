import {useEffect,useState} from 'react';
import {Activity,BadgeCheck,ChevronRight,Fingerprint,Hexagon,Layers3,LockKeyhole,Menu,Shield,ShieldCheck,Sparkles,Wallet,X,Zap} from 'lucide-react';
import {useTonAddress,useTonConnectUI,useTonWallet} from '@tonconnect/ui-react';
type Page='overview'|'reputation'|'attestations'|'escrow'|'settings';
declare global{interface Window{Telegram?:{WebApp?:{ready:()=>void;expand:()=>void;initData?:string;HapticFeedback?:{impactOccurred:(s:'light'|'medium'|'heavy')=>void};initDataUnsafe?:{user?:{first_name?:string}}}}}}
const nav=[{id:'overview' as const,label:'Overview',icon:Layers3},{id:'reputation' as const,label:'Reputation',icon:ShieldCheck},{id:'attestations' as const,label:'Attestations',icon:BadgeCheck},{id:'escrow' as const,label:'Escrow',icon:LockKeyhole}];
const short=(s:string)=>s?s.slice(0,5)+'…'+s.slice(-5):'';
const apiBase=import.meta.env.VITE_API_BASE_URL||'';
let telegramAuthRequest:Promise<boolean>|null=null;
export default function App(){
const[page,setPage]=useState<Page>('overview');
const[menu,setMenu]=useState(false);
const[authStatus,setAuthStatus]=useState('Checking Telegram session…');
const[walletStatus,setWalletStatus]=useState('Wallet ownership not verified');
const[busy,setBusy]=useState(false);
const address=useTonAddress();
const wallet=useTonWallet();
const[tonConnectUI]=useTonConnectUI();
const tg=window.Telegram?.WebApp;
useEffect(()=>{tg?.ready();tg?.expand()},[tg]);
useEffect(()=>{
 if(!telegramAuthRequest){
  const initData=tg?.initData||'';
  telegramAuthRequest=initData
   ? fetch(`${apiBase}/v1/auth/telegram`,{method:'POST',headers:{'content-type':'application/json'},credentials:'include',body:JSON.stringify({initData})}).then(r=>r.ok)
   : Promise.resolve(false);
 }
 let active=true;
 telegramAuthRequest.then(ok=>{if(active)setAuthStatus(ok?'Telegram verified':'Open DUR inside Telegram to authenticate')}).catch(()=>{if(active)setAuthStatus('Telegram authentication unavailable')});
 return()=>{active=false};
},[tg]);
useEffect(()=>tonConnectUI.onStatusChange(async connectedWallet=>{
 const item=connectedWallet?.connectItems?.tonProof;
 if(!connectedWallet||!item||!('proof' in item))return;
 try{
  const response=await fetch(`${apiBase}/v1/auth/ton/verify`,{method:'POST',headers:{'content-type':'application/json'},credentials:'include',body:JSON.stringify({address:connectedWallet.account.address,network:connectedWallet.account.chain,public_key:connectedWallet.account.publicKey||undefined,proof:{...item.proof,state_init:connectedWallet.account.walletStateInit}})});
  if(!response.ok)throw new Error('proof rejected');
  setWalletStatus('Wallet ownership verified');
 }catch{setWalletStatus('Wallet proof rejected — reconnect and try again')}
}),[tonConnectUI]);
const connectAndVerify=async()=>{
 setBusy(true);
 try{
  if(wallet)await tonConnectUI.disconnect();
  const challenge=await fetch(`${apiBase}/v1/auth/ton/challenge`,{method:'POST',credentials:'include'});
  if(!challenge.ok)throw new Error('Telegram authentication required');
  const data=await challenge.json() as {payload:string};
  tonConnectUI.setConnectRequestParameters({state:'ready',value:{tonProof:data.payload}});
  await tonConnectUI.openModal();
 }catch{setWalletStatus('Authenticate in Telegram and configure the TON proof server first')}
 finally{setBusy(false)}
};
const go=(p:Page)=>{tg?.HapticFeedback?.impactOccurred('light');setPage(p);setMenu(false)};return <main className="shell"><header className="topbar"><button className="brand" onClick={()=>go('overview')}><span className="mark"><Hexagon size={19}/><b>D</b></span><strong>DUR<span>.</span></strong></button><div className="topright"><span className="network"><i/> TON TESTNET</span><button className="iconbtn" onClick={()=>setMenu(!menu)}>{menu?<X/>:<Menu/>}</button></div></header>{menu&&<div className="menu">{[...nav,{id:'settings' as const,label:'Settings',icon:Wallet}].map(n=><button key={n.id} onClick={()=>go(n.id)}><n.icon size={17}/>{n.label}<ChevronRight size={15}/></button>)}</div>}<section className="hero"><div className="eyebrow">— DECENTRALIZED TRUST INFRASTRUCTURE</div><h1>{page==='overview'?<>Trust, made<br/><em>verifiable.</em></>:({reputation:'Reputation layer',attestations:'Proof, not promises.',escrow:'Agreements, structured.',settings:'Protocol settings'} as Record<string,string>)[page]}</h1><p>{page==='overview'?'A modular trust layer for the TON ecosystem. Reputation, attestations and escrow — connected by verifiable evidence.':'Explore the DUR protocol preview. On-chain features are not active until implemented and verified.'}</p></section><section className="wallet"><div className="wallethead"><span className="walleticon"><Wallet size={18}/></span><div><small>WALLET CONNECTION</small><b>{wallet?'Wallet connected':'No wallet connected'}</b></div><i className={wallet?'connected':''}/></div><div className="walletbottom"><span>{address?short(address):'Connect a TON wallet to continue'}</span><button className="connect-action" onClick={connectAndVerify} disabled={busy}>{busy?'PREPARING…':wallet?'RECONNECT & VERIFY':'CONNECT & VERIFY'}</button><small className="authstatus">{authStatus} · {walletStatus}</small></div></section>{page==='overview'&&<><div className="welcome"><span>{tg?.initDataUnsafe?.user?.first_name?'WELCOME, '+tg.initDataUnsafe.user.first_name.toUpperCase():'PROTOCOL OVERVIEW'}</span><span className="ready">● SYSTEM READY</span></div><section className="rep"><div className="orbit"><div/><div/><span><Shield size={25}/></span><Sparkles className="spark"/></div><small>YOUR TRUST PROFILE</small><div className="score">—<small>/ 100</small></div><p>{address?'Reputation data not indexed yet':'Connect wallet to initialize profile'}</p><footer>● VERIFIED DATA ONLY <span>DRS · PREVIEW</span></footer></section><Heading>PROTOCOL MODULES</Heading><div className="grid">{[{t:'Reputation',d:'Portable trust profile',i:ShieldCheck,p:'reputation' as Page},{t:'Attestations',d:'Verifiable credentials',i:BadgeCheck,p:'attestations' as Page},{t:'Escrow',d:'Modular deal framework',i:LockKeyhole,p:'escrow' as Page},{t:'Verification',d:'Evidence validation',i:Activity,p:'attestations' as Page}].map(m=><button className="module" key={m.t} onClick={()=>go(m.p)}><m.i/><b>{m.t}</b><small>{m.d}</small><span>EXPLORE ↗</span></button>)}</div><Heading>NETWORK ACTIVITY</Heading><div className="activity"><Activity/><div><b>{address?'No indexed activity yet':'Your activity starts here'}</b><p>{address?'No verified events are associated with this wallet in this preview.':'Connect your TON wallet to prepare your trust profile.'}</p></div></div><div className="notice"><Zap size={15}/><span><b>Early access.</b> Reputation scoring and on-chain verification are not active in this preview. No score is being generated.</span></div></>}{page==='reputation'&&<div className="panel"><Heading>REPUTATION BREAKDOWN</Heading><div className="empty"><Fingerprint/><b>{address?'Profile awaiting verification':'Wallet not connected'}</b><p>Reputation values will only appear when supported by verified evidence and documented rules.</p></div>{['Verified on-chain events','Issuer reliability','Evidence quality','Dispute and duplicate checks'].map((s,i)=><div className="rowline" key={s}>0{i+1}　{s}<small>PLANNED</small></div>)}</div>}{page==='attestations'&&<div className="panel"><BadgeCheck/><Heading>ATTESTATION REGISTRY</Heading><p>Structured claims with issuer identity, subject, evidence reference, verification status and revocation paths.</p><div className="empty"><b>No attestations yet</b><p>No attestations are issued in this preview.</p></div></div>}{page==='escrow'&&<div className="panel"><LockKeyhole/><Heading>MODULAR ESCROW ENGINE</Heading><h2>Agreements with <em>clear conditions.</em></h2><p>A modular escrow architecture designed to integrate with DUR Reputation without coupling the two modules.</p><div className="notice">Design preview only. No funds are accepted, locked, transferred or released.</div>{['Created','Accepted','Funded','Completed / Disputed','Resolved'].map((s,i)=><div className="rowline" key={s}>0{i+1}　{s}<small>PLANNED</small></div>)}</div>}{page==='settings'&&<div className="panel"><Heading>ENVIRONMENT</Heading><div className="rowline">Application <small>Telegram Mini App</small></div><div className="rowline">Network <small>TON Testnet · preview</small></div><div className="rowline">Wallet <small>{address?short(address):'Disconnected'}</small></div><p>DUR is an independent experimental project, not an official TON Foundation product.</p></div>}<div className="foot"><b>◈ DUR PROTOCOL</b><span>BUILT ON TON · EARLY ACCESS</span></div><nav className="bottom">{nav.map(n=><button key={n.id} className={page===n.id?'active':''} onClick={()=>go(n.id)}><n.icon size={18}/><span>{n.label}</span></button>)}</nav></main>}
function Heading({children}:{children:string}){return <div className="heading">{children}</div>}