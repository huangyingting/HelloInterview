import { useEffect, useState } from 'react';
import { Link, useSearchParams } from '../navigation';
import { Download, ShieldCheck, Trash2 } from 'lucide-react';
import type { IdentitySecurity, PrivacyDeletionView, PrivacyExportHistory } from '../../shared/types';
import { proCapabilities } from '../../shared/access';
import { AuthPrompt } from '../components/access';
import { Badge, PageHeading } from '../components/primitives';
import { request, useStudio } from '../store';

const providers = ['email', 'google', 'github', 'facebook'] as const;
type Provider = typeof providers[number];
const labels = { email: 'Email', google: 'Google', github: 'GitHub', facebook: 'Facebook' };
const flowErrors: Record<string, string> = {
  restart: 'Sign-in expired, was declined, or could not be verified. Start again in this browser. Your saved work is unchanged.',
  provider_unavailable: 'The sign-in service is unavailable. Try again later; existing locally valid sessions are not replaced with demo access.',
  invite: 'Invite required.',
  identity_conflict: 'That sign-in method belongs to another account. No accounts were merged. Use its original account or contact support.',
  security_changed: 'Your session or account security changed. Start again with your current sign-in method.',
  rate_limited: 'Too many sign-in attempts. Finish an existing attempt or wait before trying again.',
  AccessDenied: 'This sign-in was not admitted. New accounts require an invited verified Google email; Facebook must first be linked from an existing account.',
};

export function ManagedAuthPage() {
  const { data, act, pending } = useStudio(), [params] = useSearchParams();
  const [legacy, setLegacy] = useState(false), [email, setEmail] = useState(''), [password,setPassword] = useState(''), [provider, setProvider] = useState<Provider>('google');
  const error = flowErrors[params.get('error') ?? ''];
  const fresh = ['security_changed', 'restart'].includes(params.get('error') ?? '');
  const auth = data.capabilities.auth, available = auth?.providers ?? [], authjs = auth?.system === 'authjs';
  const signIn = (value: Provider) => authjs
    ? `/api/auth/signin/${value}?callbackUrl=${encodeURIComponent('/dashboard')}`
    : `/auth/login?provider=${value}${fresh ? '&fresh=true' : ''}`;
  return <section className="auth-card">
    <ShieldCheck size={28}/><h1>{data.user ? 'Your account security.' : 'Welcome to the Studio.'}</h1>
    {error && <p role="alert">{error}</p>}
    {data.user ? <>
      <p>{data.user.identity?.status === 'active' ? `Signed in as ${data.user.name}.` : data.user.identity?.status === 'pending-verification' ? 'Add or verify a contact email before saving preparation or using member features.' : 'Account access is restricted. Open Account for support and sign-out options.'}</p>
      <Link className="button" to="/account">Open Account</Link>
    </> : <>
      <p>{authjs ? 'Sign in with Google or a Facebook identity already linked to your Studio account.' : 'Sign in or register through our hosted identity service. Passwords stay with that service, not the Studio.'}</p>
      {available.map(value => <p key={value}><a className="button secondary" href={signIn(value)}>Continue with {labels[value]}</a></p>)}
      {!authjs && available.includes('email') && <p><a className="text-link" href="/auth/login?provider=email&signup=true">Create an email account</a></p>}
      <p className="fine-print">{authjs ? 'New private-beta accounts require an invited Google address with a verified email claim. Facebook cannot create or merge an account by matching email.' : 'Email sign-in also opens hosted password recovery. Google and GitHub request identity, profile and email only, never repository access.'}</p>
      {data.capabilities.auth?.legacyLink && <>
        <button className="text-button" onClick={() => setLegacy(!legacy)}>Keep work from a previous local account</button>
        {legacy && <form onSubmit={event => {
          event.preventDefault();
          void act(async () => {
            const result = await request<{ url: string }>('/api/identity/legacy-link', { email, password, provider });
            setPassword('');
            window.location.assign(result.url);
          });
        }}>
          <p>Prove your old Studio password, then authenticate a verified new sign-in method. Work keeps its original account ID. Old demo plans do not become paid subscriptions.</p>
          <label>Previous Studio email<input required type="email" autoComplete="username" maxLength={254} value={email} onChange={event => setEmail(event.target.value)}/></label>
          <label>Previous Studio password<input required type="password" autoComplete="current-password" maxLength={128} value={password} onChange={event => setPassword(event.target.value)}/></label>
          <label>New sign-in method<select value={provider} onChange={event => {
            const value = event.target.value;
            if (providers.includes(value as Provider)) setProvider(value as Provider);
          }}>{available.map(value => <option value={value} key={value}>{labels[value]}</option>)}</select></label>
          <button className="button" disabled={pending}>Prove and connect my account</button>
        </form>}
      </>}
      <p className="fine-print">Matching email addresses never merge accounts. To preserve a local archive, use the migration flow before creating a separate managed account.</p>
    </>}
  </section>;
}

export function ManagedAccountPage() {
  const { data, act, refresh, pending, notify } = useStudio();
  const status = data.user?.identity?.status;
  const [name, setName] = useState(data.user?.name ?? ''), [security, setSecurity] = useState<IdentitySecurity | null>(null), [error, setError] = useState('');
  const [exports,setExports]=useState<PrivacyExportHistory|null>(null);
  const [deletion,setDeletion]=useState<PrivacyDeletionView|null>(null),[deleteConfirmation,setDeleteConfirmation]=useState('');
  const [mfaEnrollment,setMfaEnrollment]=useState<{secret:string;uri:string;expiresAt:number;qr:string}|null>(null);
  const [mfaCode,setMfaCode]=useState(''),[recoveryCodes,setRecoveryCodes]=useState<string[]>([]);
  const loadSecurity = async () => {
    const result = await request<IdentitySecurity>('/api/identity/security');
    setSecurity(result); setError('');
  };
  const loadExports=async()=>setExports(await request<PrivacyExportHistory>('/api/privacy/exports'));
  useEffect(() => {
    if (status !== 'active' && status !== 'pending-verification') return;
    const controller = new AbortController();
    request<IdentitySecurity>('/api/identity/security', undefined, undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setSecurity(value); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Account security could not be loaded.'); });
    request<PrivacyExportHistory>('/api/privacy/exports',undefined,undefined,controller.signal)
      .then(value=>{if(!controller.signal.aborted)setExports(value);})
      .catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Privacy exports could not be loaded.');});
    return () => controller.abort();
  }, [status]);
  useEffect(()=>{
    if(!data.user||!['active','deletion-pending'].includes(status??''))return;
    const controller=new AbortController();
    request<PrivacyDeletionView>('/api/privacy/deletion',undefined,undefined,controller.signal)
      .then(value=>{if(!controller.signal.aborted)setDeletion(value);})
      .catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Deletion status could not be loaded.');});
    return()=>controller.abort();
  },[status,data.user]);
  useEffect(()=>{
    if(!exports?.exports.some(item=>['requested','processing'].includes(item.status)))return;
    const timer=window.setInterval(()=>{void loadExports().catch(cause=>setError(cause instanceof Error?cause.message:'Privacy export status could not be refreshed.'));},3000);
    return()=>window.clearInterval(timer);
  },[exports]);
  if (!data.user) return <AuthPrompt/>;
  const availableProviders = data.capabilities.auth?.providers ?? [];
  const authjs = data.capabilities.auth?.system === 'authjs';
  const redirect = async (path: string, provider: Provider) => {
    if (authjs) {
      if (path.endsWith('/link')) {
        const result = await request<{ url: string }>('/api/identity/link', { provider });
        window.location.assign(result.url);
        return;
      }
      window.location.assign(`/api/auth/signin/${provider}?callbackUrl=${encodeURIComponent('/account')}`);
      return;
    }
    const result = await request<{ url: string }>(path, { provider });
    window.location.assign(result.url);
  };
  if(status==='deletion-pending'){
    const current=deletion?.deletion;
    return <>
      <PageHeading eyebrow="YOUR ACCOUNT" title="Account deletion is pending." description="Product access and other Studio sessions are disabled while this request is open."/>
      <section className="panel">
        <h2>{current?.status==='blocked'?'Deletion needs reviewed external work':'Seven-day cooling-off period'}</h2>
        {!current&&<p role="status">Loading deletion status...</p>}
        {current&&<>
          <p>Requested {new Date(current.requestedAt).toLocaleString()}. The cooling-off deadline is {new Date(current.cancelBefore).toLocaleString()}.</p>
          {current.status==='cooling-off'&&<p>No active data has been erased. You may cancel after confirming an existing sign-in method within ten minutes.</p>}
          {current.status==='processing'&&<p>The durable coordinator is evaluating the request. It cannot claim completion while required external authorities are unavailable.</p>}
          {current.status==='incomplete'&&<p role="alert">The deletion coordinator did not publish a reviewed blocked state. Operations must inspect and reconcile the durable request; no erasure completion is claimed.</p>}
          {current.status==='blocked'&&<>
            <p role="alert">Deletion is incomplete. Studio has not claimed processor erasure, paid billing cancellation, approved retention handling, or deletion-on-restore reconciliation.</p>
            <ul>{current.blockers.map(blocker=><li key={blocker}>{blocker.replaceAll('-',' ')}</li>)}</ul>
          </>}
          {current.status==='cooling-off'&&!current.fresh&&<>
            <p>Confirm with a sign-in method already connected to this account:</p>
            {availableProviders.map(provider=><button className="button secondary small" key={provider} disabled={pending}
              onClick={()=>act(()=>redirect('/api/identity/reauth',provider))}>Confirm with {labels[provider]}</button>)}
          </>}
          {current.status==='cooling-off'&&current.fresh&&
            <button className="button secondary small" disabled={pending} onClick={()=>act(async()=>{
              await request('/api/privacy/deletion/cancel',{requestId:current.id});
              await refresh();notify('Account deletion request cancelled. Product access is restored.');
            })}>Cancel deletion request</button>}
        </>}
        {error&&<p role="alert">{error}</p>}
        <p><Link className="text-link" to="/support">Contact support about this request</Link></p>
      </section>
    </>;
  }
  if (status !== 'active' && status !== 'pending-verification') return <>
    <PageHeading eyebrow="YOUR ACCOUNT" title="Account access is restricted." description="Product access is unavailable for this account. Email verification does not remove a suspension or deletion request."/>
    <section className="panel"><p>Contact support for account review. You can sign out of this Studio session from navigation.</p><Link className="button secondary" to="/support">Contact support</Link></section>
  </>;
  const active = data.user.identity?.status === 'active';
  return <>
    <PageHeading eyebrow="YOUR ACCOUNT" title="Sign-in and security." description="Your identity settings are separate from your preparation archive and subscriptions."/>
    {!active && <section className="panel"><h2>A verified contact email is needed</h2><p>{data.user.email ? `${data.user.email} has not been verified for product access.` : 'Your provider did not supply a verified contact address. No substitute address was invented.'} Connect a verified email or Google sign-in method below, or verify your address with your existing provider and sign in again.</p></section>}
    <div className="account-grid">
      <section className="panel"><h2>Profile</h2><p>{data.user.email || 'No contact email available'}</p><Badge tone={active ? 'green' : 'amber'}>{active ? 'Verified contact' : data.user.identity?.status ?? 'Verification required'}</Badge>
        <form onSubmit={event => { event.preventDefault(); void act(async () => { await request('/api/profile', { name }, 'PATCH'); await refresh(); notify('Profile updated.'); }); }}>
          <label>Display name<input required minLength={2} maxLength={60} autoComplete="name" value={name} onChange={event => setName(event.target.value)}/></label>
          <button className="button small" disabled={pending}>Save profile</button>
        </form>
        <h3>Passwords and recovery</h3><p>{authjs ? "Recover access directly with Google or Facebook. Studio sign-out does not sign you out of either provider. Studio sessions are database-backed and can be revoked below; provider recovery remains the provider's responsibility." : `Use hosted email sign-in for password recovery. Studio sign-out does not sign you out of Google or GitHub. ${data.capabilities.auth?.securityLifecycle ? 'Authenticated broker password events revoke Studio sessions. Missed events require the operated identity reconciler; upstream social password changes are not covered. This remains private staging.' : 'Password-reset session invalidation is not enabled yet; this integration is for private staging only.'}`}</p>
        {security?.identities.some(identity => identity.provider === 'email') ? <a className="text-link" href="/auth/login?provider=email">Open email sign-in and recovery</a> : <p>Recover a social account with its provider, or connect a verified email sign-in method below.</p>}
      </section>
      <section className="panel"><h2>Current access</h2><p>Server-verified access: <strong>{data.capabilities.access?.features.some(feature => proCapabilities.includes(feature.key) && feature.reason === 'unavailable') ? 'refresh unavailable' : data.capabilities.access?.state ?? 'unavailable'}</strong>. Content-only grants do not include premium practice, progress, projects or tutor work.</p>
        {data.capabilities.access?.nextChangeAt && <p>Next scheduled access change: {new Date(data.capabilities.access.nextChangeAt).toLocaleString()}.</p>}
        <p>Production payments and subscriptions remain disabled. Demo purchases and gifts cannot upgrade a managed account; an access grant is not proof of payment.</p>
        {data.capabilities.billing && <p><Link className="text-link" to="/billing">Open private sandbox billing</Link> - hosted test sessions do not grant premium access.</p>}<h3>Privacy exports</h3>
        <p>Request a comprehensive owner export after confirming your identity within ten minutes. A worker prepares a private database artifact for 24 hours; no email or external storage is connected.</p>
        <button className="button secondary small" disabled={pending || !active || !security?.fresh} onClick={() => act(async () => {
          await request('/api/privacy/exports',{requestId:crypto.randomUUID()});
          await loadExports();notify('Privacy export requested. This page will update when processing finishes.');
        })}><Download size={15}/> Request privacy export</button>{' '}
        <button className="text-button" disabled={pending} onClick={()=>act(loadExports)}>Refresh export status</button>
        {!exports&&<p role="status">Loading privacy export history...</p>}
        {exports?.exports.length===0&&<p className="fine-print">No privacy exports have been requested.</p>}
        {exports?.exports.map(item=><div className="panel" key={item.id}><strong>{item.status==='ready'?'Ready to download':item.status==='processing'?'Processing':item.status==='requested'?'Waiting for worker':item.status==='expired'?'Expired':'Processing failed'}</strong>
          <p>Requested {new Date(item.requestedAt).toLocaleString()}{item.expiresAt?` - expires ${new Date(item.expiresAt).toLocaleString()}`:''}.</p>
          {item.status==='ready'&&security?.fresh&&<a className="text-link" href={`/api/privacy/exports/${item.id}/download`}><Download size={14}/> Download owner export</a>}
          {item.status==='ready'&&!security?.fresh&&<p className="fine-print">Confirm a sign-in method again before downloading this private artifact.</p>}
          {item.status==='failed'&&<p className="fine-print">The worker did not publish an artifact. Request a new export after operations review.</p>}
        </div>)}
        <h3>Delete account</h3>
        <p>Deletion immediately disables product access and revokes every other Studio session. A seven-day cooling-off period permits cancellation. After that deadline, completion remains blocked until billing, processor, retention, and backup-restore authorities are genuinely connected and approved.</p>
        {deletion?.deletion?.status==='cancelled'&&<p className="fine-print">Your previous deletion request was cancelled {deletion.deletion.cancelledAt?new Date(deletion.deletion.cancelledAt).toLocaleString():''}.</p>}
        <label>Type DELETE to request account deletion
          <input value={deleteConfirmation} onChange={event=>setDeleteConfirmation(event.target.value)} autoComplete="off"/>
        </label>
        <button className="button secondary small" disabled={pending||!active||!security?.fresh||deleteConfirmation!=='DELETE'} onClick={()=>act(async()=>{
          await request('/api/privacy/deletion',{requestId:crypto.randomUUID()});
          setDeleteConfirmation('');await refresh();notify('Account deletion requested. Product access is disabled during the cooling-off period.');
        })}><Trash2 size={15}/> Request account deletion</button>
        {!security?.fresh&&<p className="fine-print">Confirm an existing sign-in method again before requesting deletion.</p>}
      </section>
    </div>
    <section className="panel"><h2>Connected sign-in methods</h2>
      {error && <><p role="alert">{error}</p><button className="button secondary small" disabled={pending} onClick={() => act(loadSecurity)}>Retry security settings</button></>}
      {!security && !error && <p role="status">Loading sign-in and session information...</p>}
      {security && <>
        {!security.fresh && <p>Confirm an existing sign-in method before linking, unlinking, revoking sessions or exporting.</p>}
        {security.identities.map(identity => <div className="panel" key={identity.id}>
          <h3>{labels[identity.provider]} {identity.current && <Badge>Current method</Badge>}</h3><p>{identity.email || 'No contact address shared'} - {identity.verified ? 'Verified' : 'Unverified'}{!identity.available && ' - Unavailable with provider'}</p>
          <button className="button secondary small" disabled={pending || !identity.available} onClick={() => act(() => redirect('/api/identity/reauth', identity.provider))}>Confirm with {labels[identity.provider]}</button>{' '}
          <button className="text-button" disabled={pending || !security.fresh || identity.current || !security.identities.some(other => other.id !== identity.id && other.verified && other.available)} onClick={() => act(async () => { await request(`/api/identity/methods/${identity.id}`, undefined, 'DELETE'); await loadSecurity(); notify('Sign-in method removed; its Studio sessions were revoked.'); })}>Remove method</button>
        </div>)}
        <p>Connect another verified sign-in method. Each account is proved separately; email matching does not merge accounts.</p>
        {availableProviders.map(provider => <button className="button secondary small" key={provider} disabled={pending || !security.fresh} onClick={() => act(() => redirect('/api/identity/link', provider))}>Connect {labels[provider]}</button>)}
        {authjs && <p className="fine-print">Provider linking uses a one-use action bound to this fresh Studio session. Matching email addresses never merge accounts; Facebook can be linked only from here.</p>}
      </>}
    </section>
    {security && <>
      {authjs&&<section className="panel"><h2>Authenticator MFA</h2>
        {!security.mfa?.enabled ? <>
          <p>Add a time-based authenticator for staff and other sensitive actions. Enrollment requires a provider confirmation from the last ten minutes.</p>
          <button className="button secondary small" disabled={pending || !security.fresh} onClick={()=>act(async()=>{
            const enrollment=await request<{secret:string;uri:string;expiresAt:number}>('/api/identity/mfa/enrollment',{});
            const {toDataURL}=await import('qrcode');
            const qr=await toDataURL(enrollment.uri,{margin:1,width:240,errorCorrectionLevel:'M'});
            setMfaEnrollment({...enrollment,qr});setRecoveryCodes([]);setMfaCode('');
          })}>{security.mfa?.enrollmentPending?'Restart authenticator enrollment':'Set up authenticator'}</button>
          {!security.fresh&&<p className="fine-print">Confirm a connected sign-in method above before starting enrollment.</p>}
          {mfaEnrollment&&<div className="panel">
            <h3>Scan and verify</h3>
            <p>Scan this code with a TOTP authenticator. If scanning is unavailable, enter the setup key manually. This enrollment expires {new Date(mfaEnrollment.expiresAt).toLocaleTimeString()}.</p>
            <img src={mfaEnrollment.qr} width={240} height={240} alt="Authenticator setup QR code"/>
            <p><strong>Setup key:</strong> <code>{mfaEnrollment.secret}</code></p>
            <form onSubmit={event=>{event.preventDefault();void act(async()=>{
              const result=await request<{recoveryCodes:string[]}>('/api/identity/mfa/enrollment/verify',{code:mfaCode});
              setRecoveryCodes(result.recoveryCodes);setMfaEnrollment(null);setMfaCode('');await loadSecurity();
              notify('Authenticator MFA enabled. Save the recovery codes now.');
            });}}>
              <label>Six-digit authenticator code<input required inputMode="numeric" autoComplete="one-time-code"
                pattern="[0-9]{6}" maxLength={6} value={mfaCode} onChange={event=>setMfaCode(event.target.value.replace(/\D/g,''))}/></label>
              <button className="button small" disabled={pending||mfaCode.length!==6}>Verify and enable MFA</button>
            </form>
          </div>}
        </> : <>
          <p><Badge tone="green">Enabled</Badge> {security.mfa?.recoveryCodesRemaining??0} unused recovery codes remain.</p>
          {!security.mfa?.sessionVerified&&<form onSubmit={event=>{event.preventDefault();void act(async()=>{
            const compact=mfaCode.trim();
            await request('/api/identity/mfa/challenge',/^\d{6}$/.test(compact)?{code:compact}:{recoveryCode:compact});
            setMfaCode('');await loadSecurity();notify('MFA verified for this Studio session.');
          });}}>
            <p>Enter a current authenticator code or one unused recovery code to unlock sensitive staff actions for ten minutes.</p>
            <label>Authenticator or recovery code<input required autoComplete="one-time-code" maxLength={23}
              value={mfaCode} onChange={event=>setMfaCode(event.target.value.toUpperCase())}/></label>
            <button className="button small" disabled={pending||mfaCode.trim().length<6}>Verify MFA</button>
          </form>}
          {security.mfa?.sessionVerified&&<p><Badge tone="green">Verified now</Badge> Sensitive actions are unlocked for this session for ten minutes. Provider confirmation is still checked separately.</p>}
          <button className="button secondary small" disabled={pending||!security.fresh||!security.mfa?.sessionVerified}
            onClick={()=>act(async()=>{
              const result=await request<{recoveryCodes:string[]}>('/api/identity/mfa/recovery-codes',{});
              setRecoveryCodes(result.recoveryCodes);await loadSecurity();notify('Previous recovery codes were replaced.');
            })}>Replace recovery codes</button>{' '}
          <button className="text-button" disabled={pending||!security.fresh||!security.mfa?.sessionVerified}
            onClick={()=>act(async()=>{
              await request('/api/identity/mfa',undefined,'DELETE');setRecoveryCodes([]);setMfaCode('');
              await loadSecurity();notify('Authenticator MFA disabled for every Studio session.');
            })}>Disable MFA</button>
          {(!security.fresh||!security.mfa?.sessionVerified)&&<p className="fine-print">Changing MFA requires both a provider confirmation and MFA verification from the last ten minutes.</p>}
        </>}
        {recoveryCodes.length>0&&<div className="panel" role="status">
          <h3>Save these one-time recovery codes now</h3>
          <p>Each code works once. Studio stores only keyed hashes and cannot show these values again.</p>
          <ul>{recoveryCodes.map(code=><li key={code}><code>{code}</code></li>)}</ul>
          <button className="button secondary small" onClick={()=>act(async()=>{
            await navigator.clipboard.writeText(recoveryCodes.join('\n'));notify('Recovery codes copied.');
          })}>Copy recovery codes</button>
        </div>}
      </section>}
      <section className="panel"><h2>Studio sessions</h2><p>Sessions expire after 30 days or seven days without use. No provider tokens, device fingerprints or precise locations are displayed or stored here.</p>
        {security.sessions.map(session => <div className="panel" key={session.id}><strong>{session.current ? 'This session' : 'Other sign-in session'}</strong><p>Created {new Date(session.createdAt).toLocaleString()} - last used {new Date(session.lastUsed).toLocaleString()}</p>{!session.current && <button className="text-button" disabled={pending || !security.fresh} onClick={() => act(async () => { await request(`/api/identity/sessions/${session.id}`, undefined, 'DELETE'); await loadSecurity(); notify('Session revoked.'); })}>Revoke session</button>}</div>)}
        <button className="button secondary small" disabled={pending || !security.fresh} onClick={() => act(async () => { await request('/api/identity/sessions/revoke-others', {}); await loadSecurity(); notify('Other Studio sessions were revoked.'); })}>Sign out other sessions</button>
      </section>
      <section className="panel"><h2>Recent security activity</h2>{security.events.map(event => <p key={event.id}>{event.action.replaceAll('-', ' ')} - {new Date(event.createdAt).toLocaleString()}</p>)}</section>
    </>}
  </>;
}
