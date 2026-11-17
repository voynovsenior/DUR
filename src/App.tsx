import { useEffect, useMemo, useState } from 'react';
import {
  Activity, BadgeCheck, ChevronRight, Fingerprint, Hexagon, Layers3,
  LockKeyhole, Menu, Shield, ShieldCheck, Sparkles, Wallet, X, Zap,
} from 'lucide-react';
import { useTonAddress, useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';

type Page = 'overview' | 'reputation' | 'attestations' | 'escrow' | 'settings';
type Issuer = { id: string; displayName: string; issuerType: string; trustTier: string };
type Schema = { schemaId: string; schemaVersion: number };
type Consent = {
  id: string;
  walletAddress: string;
  issuerId: string;
  schemaId: string;
  schemaVersion: number;
  purpose: string;
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
};
declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        initData?: string;
        HapticFeedback?: { impactOccurred: (s: 'light' | 'medium' | 'heavy') => void };
        initDataUnsafe?: { user?: { first_name?: string } };
      };
    };
  }
}

const nav = [
  { id: 'overview' as const, label: 'Overview', icon: Layers3 },
  { id: 'reputation' as const, label: 'Reputation', icon: ShieldCheck },
  { id: 'attestations' as const, label: 'Attestations', icon: BadgeCheck },
  { id: 'escrow' as const, label: 'Escrow', icon: LockKeyhole },
];
const short = (value: string) => value ? value.slice(0, 5) + '…' + value.slice(-5) : '';
const apiBase = import.meta.env.VITE_API_BASE_URL || '';
let telegramAuthRequest: Promise<boolean> | null = null;

export default function App() {
  const [page, setPage] = useState<Page>('overview');
  const [menu, setMenu] = useState(false);
  const [authStatus, setAuthStatus] = useState('Checking Telegram session…');
  const [authVerified, setAuthVerified] = useState(false);
  const [walletStatus, setWalletStatus] = useState('Wallet ownership not verified');
  const [busy, setBusy] = useState(false);
  const [issuers, setIssuers] = useState<Issuer[]>([]);
  const [schemas, setSchemas] = useState<Schema[]>([]);
  const [consents, setConsents] = useState<Consent[]>([]);
  const [selectedIssuer, setSelectedIssuer] = useState('');
  const [selectedSchema, setSelectedSchema] = useState('');
  const [purpose, setPurpose] = useState('Issue delivery completion attestations');
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentNotice, setConsentNotice] = useState('');

  const address = useTonAddress();
  const wallet = useTonWallet();
  const [tonConnectUI] = useTonConnectUI();
  const tg = window.Telegram?.WebApp;

  useEffect(() => {
    tg?.ready();
    tg?.expand();
  }, [tg]);

  useEffect(() => {
    if (!telegramAuthRequest) {
      const initData = tg?.initData || '';
      telegramAuthRequest = fetch(`${apiBase}/v1/auth/me`, { credentials: 'include' })
        .then(response => response.ok)
        .catch(() => false)
        .then(existingSession => {
          if (existingSession) return true;
          if (!initData) return false;
          return fetch(`${apiBase}/v1/auth/telegram`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ initData }),
          }).then(response => response.ok);
        });
    }
    let active = true;
    telegramAuthRequest.then(ok => {
      if (!active) return;
      setAuthVerified(ok);
      setAuthStatus(ok ? 'Telegram verified' : 'Open DUR inside Telegram to authenticate');
    }).catch(() => {
      if (active) setAuthStatus('Telegram authentication unavailable');
    });
    return () => { active = false; };
  }, [tg]);

  const refreshConsents = async () => {
    const response = await fetch(`${apiBase}/v1/auth/consents`, { credentials: 'include' });
    if (!response.ok) throw new Error('consent_list_unavailable');
    const body = await response.json() as { consents: Consent[] };
    setConsents(body.consents);
  };

  useEffect(() => {
    if (!authVerified) return;
    let active = true;
    Promise.all([
      fetch(`${apiBase}/v1/issuers`).then(response => response.ok ? response.json() : Promise.reject()),
      fetch(`${apiBase}/v1/schemas`).then(response => response.ok ? response.json() : Promise.reject()),
      fetch(`${apiBase}/v1/auth/consents`, { credentials: 'include' }).then(response => response.ok ? response.json() : Promise.reject()),
    ]).then(([issuerBody, schemaBody, consentBody]) => {
      if (!active) return;
      const nextIssuers = (issuerBody as { issuers: Issuer[] }).issuers;
      const nextSchemas = (schemaBody as { schemas: Schema[] }).schemas;
      setIssuers(nextIssuers);
      setSchemas(nextSchemas);
      setConsents((consentBody as { consents: Consent[] }).consents);
      if (nextIssuers.length) setSelectedIssuer(nextIssuers[0].id);
      if (nextSchemas.length) setSelectedSchema(`${nextSchemas[0].schemaId}|${nextSchemas[0].schemaVersion}`);
    }).catch(() => {
      if (active) setConsentNotice('Consent directory is currently unavailable.');
    });
    return () => { active = false; };
  }, [authVerified]);

  useEffect(() => tonConnectUI.onStatusChange(async connectedWallet => {
    const item = connectedWallet?.connectItems?.tonProof;
    if (!connectedWallet) return;
    if (!item) {
      setWalletStatus('Wallet connected, but no TON proof was returned');
      return;
    }
    if (!('proof' in item)) {
      setWalletStatus('This wallet did not provide TON proof support');
      return;
    }
    try {
      const response = await fetch(`${apiBase}/v1/auth/ton/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          address: connectedWallet.account.address,
          network: connectedWallet.account.chain,
          public_key: connectedWallet.account.publicKey || undefined,
          proof: { ...item.proof, state_init: connectedWallet.account.walletStateInit },
        }),
      });
      if (!response.ok) throw new Error('proof rejected');
      setWalletStatus('Wallet ownership verified');
    } catch {
      setWalletStatus('Wallet proof rejected — reconnect and try again');
    }
  }), [tonConnectUI]);

  const connectAndVerify = async () => {
    setBusy(true);
    try {
      if (wallet) await tonConnectUI.disconnect();
      const challenge = await fetch(`${apiBase}/v1/auth/ton/challenge`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!challenge.ok) throw new Error('Telegram authentication required');
      const data = await challenge.json() as { payload: string };
      tonConnectUI.setConnectRequestParameters({ state: 'ready', value: { tonProof: data.payload } });
      await tonConnectUI.openModal();
    } catch {
      setWalletStatus('Authenticate in Telegram and configure the TON proof server first');
    } finally {
      setBusy(false);
    }
  };

  const grantConsent = async () => {
    if (!authVerified || !wallet || walletStatus !== 'Wallet ownership verified') {
      setConsentNotice('Authenticate in Telegram and verify a linked Testnet wallet first.');
      return;
    }
    if (!selectedIssuer || !selectedSchema || purpose.trim().length < 5) {
      setConsentNotice('Choose an issuer, a schema and a clear purpose.');
      return;
    }
    const [schemaId, version] = selectedSchema.split('|');
    setConsentBusy(true);
    setConsentNotice('');
    try {
      const response = await fetch(`${apiBase}/v1/auth/consents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          walletAddress: wallet.account.address,
          issuerId: selectedIssuer,
          schemaId,
          schemaVersion: Number(version),
          purpose: purpose.trim(),
          expiresAt: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || 'consent_creation_failed');
      }
      await refreshConsents();
      setConsentNotice('Consent grant created. You can revoke it at any time.');
    } catch (error) {
      setConsentNotice(error instanceof Error ? error.message : 'Could not create consent grant.');
    } finally {
      setConsentBusy(false);
    }
  };

  const revokeConsent = async (id: string) => {
    setConsentBusy(true);
    setConsentNotice('');
    try {
      const response = await fetch(`${apiBase}/v1/auth/consents/${encodeURIComponent(id)}/revoke`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('consent_revocation_failed');
      await refreshConsents();
      setConsentNotice('Consent grant revoked.');
    } catch (error) {
      setConsentNotice(error instanceof Error ? error.message : 'Could not revoke consent.');
    } finally {
      setConsentBusy(false);
    }
  };

  const schemaOptions = useMemo(
    () => schemas.map(schema => ({ value: `${schema.schemaId}|${schema.schemaVersion}`, label: `${schema.schemaId} · v${schema.schemaVersion}` })),
    [schemas],
  );
  const go = (nextPage: Page) => {
    tg?.HapticFeedback?.impactOccurred('light');
    setPage(nextPage);
    setMenu(false);
  };

  return (
    <main className="shell">
      <header className="topbar">
        <button className="brand" onClick={() => go('overview')}>
          <span className="mark"><Hexagon size={19} /><b>D</b></span>
          <strong>DUR<span>.</span></strong>
        </button>
        <div className="topright">
          <span className="network"><i /> TON TESTNET</span>
          <button className="iconbtn" onClick={() => setMenu(!menu)}>{menu ? <X /> : <Menu />}</button>
        </div>
      </header>
      {menu && <div className="menu">
        {[...nav, { id: 'settings' as const, label: 'Settings', icon: Wallet }].map(item => (
          <button key={item.id} onClick={() => go(item.id)}>
            <item.icon size={17} />{item.label}<ChevronRight size={15} />
          </button>
        ))}
      </div>}

      <section className="hero">
        <div className="eyebrow">— DECENTRALIZED TRUST INFRASTRUCTURE</div>
        <h1>{page === 'overview' ? <>Trust, made<br /><em>verifiable.</em></> : ({
          reputation: 'Reputation layer',
          attestations: 'Proof, not promises.',
          escrow: 'Agreements, structured.',
          settings: 'Protocol settings',
        } as Record<string, string>)[page]}</h1>
        <p>{page === 'overview'
          ? 'A modular trust layer for the TON ecosystem. Reputation, attestations and escrow — connected by verifiable evidence.'
          : 'Explore the DUR protocol preview. Mainnet features are not active.'}</p>
      </section>

      <section className="wallet">
        <div className="wallethead">
          <span className="walleticon"><Wallet size={18} /></span>
          <div><small>WALLET CONNECTION</small><b>{wallet ? 'Wallet connected' : 'No wallet connected'}</b></div>
          <i className={wallet ? 'connected' : ''} />
        </div>
        <div className="walletbottom">
          <span>{address ? short(address) : 'Connect a TON wallet to continue'}</span>
          <button className="connect-action" onClick={connectAndVerify} disabled={busy}>
            {busy ? 'PREPARING…' : wallet ? 'RECONNECT & VERIFY' : 'CONNECT & VERIFY'}
          </button>
          <small className="authstatus">{authStatus} · {walletStatus}</small>
        </div>
      </section>

      {page === 'overview' && <>
        <div className="welcome">
          <span>{tg?.initDataUnsafe?.user?.first_name ? `WELCOME, ${tg.initDataUnsafe.user.first_name.toUpperCase()}` : 'PROTOCOL OVERVIEW'}</span>
          <span className="ready">● SYSTEM READY</span>
        </div>
        <section className="rep">
          <div className="orbit"><div /><div /><span><Shield size={25} /></span><Sparkles className="spark" /></div>
          <small>YOUR TRUST PROFILE</small>
          <div className="score">—<small>/ 100</small></div>
          <p>{address ? 'Reputation data not indexed yet' : 'Connect wallet to initialize profile'}</p>
          <footer>● VERIFIED DATA ONLY <span>DRS · PREVIEW</span></footer>
        </section>
        <Heading>PROTOCOL MODULES</Heading>
        <div className="grid">
          {[
            { title: 'Reputation', description: 'Portable trust profile', icon: ShieldCheck, target: 'reputation' as Page },
            { title: 'Attestations', description: 'Verifiable credentials', icon: BadgeCheck, target: 'attestations' as Page },
            { title: 'Escrow', description: 'Modular deal framework', icon: LockKeyhole, target: 'escrow' as Page },
            { title: 'Verification', description: 'Evidence validation', icon: Activity, target: 'attestations' as Page },
          ].map(module => (
            <button className="module" key={module.title} onClick={() => go(module.target)}>
              <module.icon /><b>{module.title}</b><small>{module.description}</small><span>EXPLORE ↗</span>
            </button>
          ))}
        </div>
        <Heading>NETWORK ACTIVITY</Heading>
        <div className="activity">
          <Activity />
          <div><b>{address ? 'No indexed activity yet' : 'Your activity starts here'}</b>
            <p>{address ? 'No verified events are associated with this wallet in this preview.' : 'Connect your TON wallet to prepare your trust profile.'}</p>
          </div>
        </div>
        <div className="notice"><Zap size={15} /><span><b>Early access.</b> Reputation scoring is not active. No score is being generated.</span></div>
      </>}

      {page === 'reputation' && <div className="panel">
        <Heading>REPUTATION BREAKDOWN</Heading>
        <div className="empty"><Fingerprint /><b>{address ? 'Profile awaiting verification' : 'Wallet not connected'}</b>
          <p>Reputation values will only appear when supported by verified evidence and documented rules.</p>
        </div>
        {['Verified on-chain events', 'Issuer reliability', 'Evidence quality', 'Dispute and duplicate checks'].map((item, index) => (
          <div className="rowline" key={item}>0{index + 1}　{item}<small>PLANNED</small></div>
        ))}
      </div>}

      {page === 'attestations' && <div className="panel">
        <BadgeCheck />
        <Heading>ATTESTATION REGISTRY</Heading>
        <p>Issuers can submit structured claims only for a linked wallet and a schema version the wallet owner has explicitly approved.</p>
        {!authVerified && <div className="notice">Open DUR inside Telegram to manage your consent grants.</div>}
        {authVerified && <>
          <div className="consent-form">
            <b>GRANT A CONSENT</b>
            <label htmlFor="issuer-select">Issuer</label>
            <select id="issuer-select" value={selectedIssuer} onChange={event => setSelectedIssuer(event.target.value)}>
              <option value="">Select issuer</option>
              {issuers.map(issuer => <option key={issuer.id} value={issuer.id}>{issuer.displayName} · {issuer.trustTier}</option>)}
            </select>
            <label htmlFor="schema-select">Claim schema</label>
            <select id="schema-select" value={selectedSchema} onChange={event => setSelectedSchema(event.target.value)}>
              <option value="">Select schema</option>
              {schemaOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <label htmlFor="consent-purpose">Purpose</label>
            <input id="consent-purpose" value={purpose} maxLength={256} onChange={event => setPurpose(event.target.value)} />
            <button className="connect-action" disabled={consentBusy || !wallet || walletStatus !== 'Wallet ownership verified'} onClick={grantConsent}>
              {consentBusy ? 'PLEASE WAIT…' : 'GRANT CONSENT'}
            </button>
            <small>Only a wallet verified by DUR can grant consent. Grants expire after 90 days by default and are limited to the selected issuer and schema.</small>
          </div>
          {consentNotice && <div className="notice">{consentNotice}</div>}
          <Heading>YOUR CONSENT GRANTS</Heading>
          {consents.length === 0 && <div className="empty"><b>No consent grants</b><p>You have not authorized any issuer to submit attestations for your linked wallet.</p></div>}
          {consents.map(consent => {
            const revoked = consent.revokedAt !== null;
            const expired = consent.expiresAt !== null && consent.expiresAt <= Math.floor(Date.now() / 1000);
            return <div className="consent-card" key={consent.id}>
              <div><b>{consent.schemaId} · v{consent.schemaVersion}</b><small>{short(consent.issuerId)} · {short(consent.walletAddress)} · expires {consent.expiresAt ? new Date(consent.expiresAt * 1000).toLocaleDateString() : 'never'}</small></div>
              <span className={revoked || expired ? 'consent-inactive' : 'consent-active'}>{revoked ? 'REVOKED' : expired ? 'EXPIRED' : 'ACTIVE'}</span>
              <p>{consent.purpose}</p>
              {!revoked && !expired && <button className="revoke-action" disabled={consentBusy} onClick={() => revokeConsent(consent.id)}>REVOKE CONSENT</button>}
            </div>;
          })}
        </>}
      </div>}

      {page === 'escrow' && <div className="panel">
        <LockKeyhole />
        <Heading>MODULAR ESCROW ENGINE</Heading>
        <h2>Agreements with <em>clear conditions.</em></h2>
        <p>A modular escrow architecture designed to integrate with DUR Reputation without coupling the two modules.</p>
        <div className="notice">Design preview only. No funds are accepted, locked, transferred or released.</div>
        {['Created', 'Accepted', 'Funded', 'Completed / Disputed', 'Resolved'].map((item, index) => (
          <div className="rowline" key={item}>0{index + 1}　{item}<small>PLANNED</small></div>
        ))}
      </div>}

      {page === 'settings' && <div className="panel">
        <Heading>ENVIRONMENT</Heading>
        <div className="rowline">Application <small>Telegram Mini App</small></div>
        <div className="rowline">Network <small>TON Testnet · preview</small></div>
        <div className="rowline">Wallet <small>{address ? short(address) : 'Disconnected'}</small></div>
        <p>DUR is an independent experimental project, not an official TON Foundation product.</p>
      </div>}

      <div className="foot"><b>◈ DUR PROTOCOL</b><span>BUILT ON TON · EARLY ACCESS</span></div>
      <nav className="bottom">{nav.map(item => (
        <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => go(item.id)}>
          <item.icon size={18} /><span>{item.label}</span>
        </button>
      ))}</nav>
    </main>
  );
}

function Heading({ children }: { children: string }) {
  return <div className="heading">{children}</div>;
}
