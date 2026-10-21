import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from '../navigation';
import { Download, KeyRound, MailCheck, ShieldCheck, Trash2 } from 'lucide-react';
import type { IdentitySecurity, PrivacyDeletionView, PrivacyExportHistory } from '../../shared/types';
import { proCapabilities } from '../../shared/access';
import { AuthPrompt } from '../components/access';
import { Badge, PageHeading } from '../components/primitives';
import { request, useStudio } from '../store';

const providers = ['google', 'facebook'] as const;
type Provider = typeof providers[number];
const isProvider = (value: string): value is Provider => value === 'google' || value === 'facebook';
const labels: Record<Provider, string> = { google: 'Google', facebook: 'Facebook' };
const flowErrors: Record<string, string> = {
  restart: 'Sign-in expired, was declined, or could not be verified. Start again in this browser. Your saved work is unchanged.',
  provider_unavailable: 'The sign-in service is unavailable. Try again later; existing valid sessions remain unchanged.',
  invite: 'Invite required.',
  identity_conflict: 'That sign-in method belongs to another account. No accounts were merged. Use its original account or contact support.',
  security_changed: 'Your session or account security changed. Start again with your current sign-in method.',
  rate_limited: 'Too many sign-in attempts. Finish an existing attempt or wait before trying again.',
  AccessDenied: 'This sign-in was not admitted. New accounts require an invited verified Google email; Facebook must first be linked from an existing account.',
};

export function ManagedAuthPage() {
  const { data, act, refresh, pending, notify } = useStudio();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const confirming = Boolean(data.user && params.get('confirm') === '1');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const error = flowErrors[params.get('error') ?? ''] || loginError;
  const available = (data.capabilities.auth?.providers ?? []).filter((provider): provider is 'google' => provider === 'google');
  const admissionMode = data.capabilities.auth?.admissionMode ?? 'invitation-only';
  const signIn = (provider: 'google') => `/api/auth/signin/${provider}?callbackUrl=${encodeURIComponent('/dashboard')}`;

  return <section className="auth-card">
    <ShieldCheck size={28}/><h1>{data.user ? 'Your account security.' : 'Welcome to the Studio.'}</h1>
    {error && <p role="alert">{error}</p>}
    {data.user && !confirming ? <>
      <p>{data.user.identity?.status === 'active' ? `Signed in as ${data.user.name}.` : data.user.identity?.status === 'pending-verification' ? 'Add or verify a contact email before saving preparation or using member features.' : 'Account access is restricted. Open Account for support and sign-out options.'}</p>
      <Link className="button" to="/account">Open Account</Link>
    </> : <>
      <form onSubmit={event => {
        event.preventDefault();
        setLoginError('');
        void act(async () => {
          try {
            await request('/api/auth/password/login', { email: confirming ? data.user?.email : email, password });
            await refresh();
            notify(confirming ? 'Password confirmed.' : 'Signed in.');
            navigate(confirming ? '/account' : '/dashboard');
          } catch (cause) {
            const message = cause instanceof Error ? cause.message : 'Unable to sign in.';
            setLoginError(message);
            throw cause;
          }
        });
      }}>
        <label>Email address
          <input required type="email" autoComplete="email" readOnly={confirming} value={confirming ? data.user?.email ?? '' : email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com"/>
        </label>
        <label>Password
          <input required type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your password"/>
        </label>
        <button className="button" disabled={pending || !(confirming ? data.user?.email : email)?.trim() || !password}>
          {pending ? 'Signing in…' : confirming ? 'Confirm password' : 'Sign in with password'}
        </button>
      </form>
      <p className="fine-print">
        <Link className="text-link" to="/forgot-password">Forgot password?</Link>
        {admissionMode === 'public' ? <> · <Link className="text-link" to="/register">Create an account</Link></> : null}
      </p>
      {available.length>0&&<p className="auth-divider">Or use your connected account</p>}
      {available.map(value => <p key={value}><a className="button secondary" href={signIn(value)}>Continue with {labels[value]}</a></p>)}
      <p className="fine-print">
        {admissionMode === 'invitation-only'
          ? 'New here? Use the invitation link shared by your administrator. Your personal workspace starts with your own work, not pre-filled activity.'
          : 'Matching email addresses never merge accounts automatically, and Facebook cannot create an account.'}
      </p>
    </>}
  </section>;
}

interface InvitationPreview {
  status: 'pending' | 'accepted' | 'revoked' | 'expired' | 'invalid';
  maskedEmail?: string | null;
  expiresAt?: string | null;
}

export function InviteClaimPage({ token }: { token: string }) {
  const { data, act, refresh, pending, notify } = useStudio();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    let active = true;
    setLoadingPreview(true);
    request<{ invitation: InvitationPreview }>('/api/auth/invitation', { token })
      .then(result => {
        if (active) {
          setPreview(result.invitation);
          setLoadingPreview(false);
        }
      })
      .catch(cause => {
        if (active) {
          setFormError(cause instanceof Error ? cause.message : 'Unable to inspect invitation.');
          setLoadingPreview(false);
        }
      });
    return () => { active = false; };
  }, [token]);

  const available = (data.capabilities.auth?.providers ?? []).filter((provider): provider is 'google' => provider === 'google');

  return <section className="auth-card">
    <MailCheck size={28}/>
    <h1>Claim your Studio invitation.</h1>
    {loadingPreview && <p role="status">Verifying invitation token…</p>}
    {formError && <p role="alert">{formError}</p>}
    {!loadingPreview && preview && preview.status !== 'pending' && <>
      <p role="alert">
        {preview.status === 'expired'
          ? 'This invitation has expired. Ask an administrator to rotate and resend your invitation link.'
          : preview.status === 'revoked'
            ? 'This invitation has been revoked by an administrator.'
            : preview.status === 'accepted'
              ? 'This invitation has already been claimed. Sign in with your account credentials.'
              : 'This invitation link is invalid or has been replaced by a newer link.'}
      </p>
      <Link className="button secondary" to="/login">Go to sign in</Link>
    </>}
    {!loadingPreview && preview?.status === 'pending' && <>
      <p>
        Invited address: <strong>{preview.maskedEmail}</strong>
        {preview.expiresAt ? ` · expires ${new Date(preview.expiresAt).toLocaleString()}` : ''}
      </p>
      <form onSubmit={event => {
        event.preventDefault();
        setFormError('');
        if (password !== confirmPassword) {
          setFormError('Passwords do not match.');
          return;
        }
        void act(async () => {
          try {
            await request('/api/auth/register', {
              token,
              email,
              name: name.trim() || undefined,
              password,
            });
            await refresh();
            notify('Invitation claimed. Welcome to Interview Studio.');
            navigate('/dashboard');
          } catch (cause) {
            setFormError(cause instanceof Error ? cause.message : 'Could not claim invitation.');
            throw cause;
          }
        });
      }}>
        <label>Invited email address
          <input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="Enter the exact invited email"/>
        </label>
        <label>Display name
          <input maxLength={60} autoComplete="name" value={name} onChange={event => setName(event.target.value)} placeholder="Your name"/>
        </label>
        <label>Create password (12–128 characters)
          <input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)}/>
        </label>
        <label>Confirm password
          <input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)}/>
        </label>
        <button className="button" disabled={pending || !email.trim() || password.length < 12}>
          {pending ? 'Activating account…' : 'Claim invitation & sign in'}
        </button>
      </form>
      {available.includes('google') && <p className="fine-print">
        Prefer Google sign-in? <a className="text-link" href={`/api/auth/signin/google?callbackUrl=${encodeURIComponent('/dashboard')}`}>Continue with Google</a> using the invited email address.
      </p>}
    </>}
  </section>;
}

export function RegisterPage() {
  const { data, act, pending, notify } = useStudio();
  const [params] = useSearchParams();
  const token = params.get('token')?.trim() ?? '';
  const admissionMode = data.capabilities.auth?.admissionMode ?? 'invitation-only';
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submittedMessage, setSubmittedMessage] = useState('');
  const [formError, setFormError] = useState('');

  if (token) {
    return <InviteClaimPage token={token} />;
  }

  if (admissionMode === 'invitation-only') {
    return <section className="auth-card">
      <ShieldCheck size={28}/>
      <h1>Invitation required.</h1>
      <p>Interview Studio is currently in invitation-only mode. Open the invitation link sent by an administrator to create your account.</p>
      <Link className="button secondary" to="/login">Back to sign in</Link>
    </section>;
  }

  return <section className="auth-card">
    <ShieldCheck size={28}/>
    <h1>Create your Studio account.</h1>
    {formError && <p role="alert">{formError}</p>}
    {submittedMessage ? <>
      <p role="status">{submittedMessage}</p>
      <Link className="button secondary" to="/login">Return to sign in</Link>
    </> : <form onSubmit={event => {
      event.preventDefault();
      setFormError('');
      if (password !== confirmPassword) {
        setFormError('Passwords do not match.');
        return;
      }
      void act(async () => {
        try {
          const res = await request<{ message: string }>('/api/auth/register', {
            email,
            name: name.trim() || undefined,
            password,
          });
          setSubmittedMessage(res.message);
          notify('Check your email to verify your account.');
        } catch (cause) {
          setFormError(cause instanceof Error ? cause.message : 'Registration failed.');
          throw cause;
        }
      });
    }}>
      <label>Email address
        <input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)}/>
      </label>
      <label>Display name
        <input maxLength={60} autoComplete="name" value={name} onChange={event => setName(event.target.value)}/>
      </label>
      <label>Password (12–128 characters)
        <input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)}/>
      </label>
      <label>Confirm password
        <input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)}/>
      </label>
      <button className="button" disabled={pending || !email.trim() || password.length < 12}>
        {pending ? 'Submitting…' : 'Create account'}
      </button>
    </form>}
  </section>;
}

export function VerifyEmailPage({ token }: { token: string }) {
  const { refresh, notify } = useStudio();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'verifying' | 'verified' | 'error'>('verifying');
  const [message, setMessage] = useState('Verifying your email address…');

  useEffect(() => {
    let active = true;
    request('/api/auth/verify-email', { token })
      .then(async () => {
        await refresh();
        if (active) {
          setStatus('verified');
          setMessage('Your email has been verified and your account is active.');
          notify('Email verified.');
        }
      })
      .catch(cause => {
        if (active) {
          setStatus('error');
          setMessage(cause instanceof Error ? cause.message : 'Verification link is invalid or expired.');
        }
      });
    return () => { active = false; };
  }, [token, refresh, notify]);

  return <section className="auth-card">
    <MailCheck size={28}/>
    <h1>Email verification</h1>
    <p role={status === 'error' ? 'alert' : 'status'}>{message}</p>
    {status === 'verified' ? (
      <button className="button" onClick={() => navigate('/dashboard')}>Continue to Studio</button>
    ) : (
      <Link className="button secondary" to="/login">Go to sign in</Link>
    )}
  </section>;
}

export function ForgotPasswordPage() {
  const { act, pending } = useStudio();
  const [email, setEmail] = useState('');
  const [submittedMessage, setSubmittedMessage] = useState('');
  const [formError, setFormError] = useState('');

  return <section className="auth-card">
    <KeyRound size={28}/>
    <h1>Reset your password.</h1>
    {formError && <p role="alert">{formError}</p>}
    {submittedMessage ? <>
      <p role="status">{submittedMessage}</p>
      <Link className="button secondary" to="/login">Back to sign in</Link>
    </> : <form onSubmit={event => {
      event.preventDefault();
      setFormError('');
      void act(async () => {
        try {
          const res = await request<{ message: string }>('/api/auth/password/forgot', { email });
          setSubmittedMessage(res.message);
        } catch (cause) {
          setFormError(cause instanceof Error ? cause.message : 'Could not request password reset.');
          throw cause;
        }
      });
    }}>
      <p>Enter the email address for your Studio account. If a password reset is available, we will queue a reset link.</p>
      <label>Email address
        <input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)}/>
      </label>
      <button className="button" disabled={pending || !email.trim()}>
        {pending ? 'Sending…' : 'Send reset link'}
      </button>
      <p className="fine-print"><Link className="text-link" to="/login">Back to sign in</Link></p>
    </form>}
  </section>;
}

export function ResetPasswordPage({ token }: { token: string }) {
  const { act, pending, notify } = useStudio();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [completed, setCompleted] = useState(false);
  const [formError, setFormError] = useState('');

  return <section className="auth-card">
    <KeyRound size={28}/>
    <h1>Choose a new password.</h1>
    {formError && <p role="alert">{formError}</p>}
    {completed ? <>
      <p role="status">Your password has been updated. Sign in with your new password.</p>
      <Link className="button" to="/login">Sign in</Link>
    </> : <form onSubmit={event => {
      event.preventDefault();
      setFormError('');
      if (password !== confirmPassword) {
        setFormError('Passwords do not match.');
        return;
      }
      void act(async () => {
        try {
          await request('/api/auth/password/reset', { token, password });
          setCompleted(true);
          notify('Password updated.');
        } catch (cause) {
          setFormError(cause instanceof Error ? cause.message : 'Password reset failed.');
          throw cause;
        }
      });
    }}>
      <label>New password (12–128 characters)
        <input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)}/>
      </label>
      <label>Confirm new password
        <input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)}/>
      </label>
      <button className="button" disabled={pending || password.length < 12}>
        {pending ? 'Updating…' : 'Update password'}
      </button>
    </form>}
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
  const [authMethods, setAuthMethods] = useState<{ hasPassword: boolean; passwordUpdatedAt: string | null } | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const loadSecurity = async () => {
    const result = await request<IdentitySecurity>('/api/identity/security');
    setSecurity(result); setError('');
  };
  const loadAuthMethods = async () => {
    const result = await request<{ hasPassword: boolean; passwordUpdatedAt: string | null }>('/api/account/auth-methods');
    setAuthMethods(result);
  };
  const loadExports=async()=>setExports(await request<PrivacyExportHistory>('/api/privacy/exports'));
  useEffect(() => {
    if (status !== 'active' && status !== 'pending-verification') return;
    const controller = new AbortController();
    request<IdentitySecurity>('/api/identity/security', undefined, undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setSecurity(value); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Account security could not be loaded.'); });
    request<{ hasPassword: boolean; passwordUpdatedAt: string | null }>('/api/account/auth-methods', undefined, undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setAuthMethods(value); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Password settings could not be loaded.'); });
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
    if(status==='deletion-pending'){
      request<{hasPassword:boolean;passwordUpdatedAt:string|null}>('/api/account/auth-methods',undefined,'GET',controller.signal)
        .then(value=>{if(!controller.signal.aborted)setAuthMethods(value);})
        .catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Sign-in methods could not be loaded.');});
    }
    return()=>controller.abort();
  },[status,data.user]);
  useEffect(()=>{
    if(!exports?.exports.some(item=>['requested','processing'].includes(item.status)))return;
    const timer=window.setInterval(()=>{void loadExports().catch(cause=>setError(cause instanceof Error?cause.message:'Privacy export status could not be refreshed.'));},3000);
    return()=>window.clearInterval(timer);
  },[exports]);
  if (!data.user) return <AuthPrompt/>;
  const configuredProviders = (data.capabilities.auth?.providers ?? []).filter(isProvider);
  const connectedIdentities = (security?.identities ?? []).filter(
    (identity): identity is typeof identity & { provider: Provider } => isProvider(identity.provider),
  );
  const connectedProviders = configuredProviders.filter(provider =>
    connectedIdentities.some(identity => identity.provider === provider && identity.available),
  );
  const unconnectedProviders = configuredProviders.filter(provider =>
    !connectedIdentities.some(identity => identity.provider === provider),
  );
  const reauthenticate = (provider: Provider) => {
    window.location.assign(`/api/auth/signin/${provider}?callbackUrl=${encodeURIComponent('/account')}`);
  };
  const linkProvider = async (provider: Provider) => {
    const result = await request<{ url: string }>('/api/identity/link', { provider });
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
            {authMethods?.hasPassword&&<Link className="button secondary small" to="/login?confirm=1">Confirm with password</Link>}
            {(connectedProviders.length ? connectedProviders : configuredProviders).map(provider=><button className="button secondary small" key={provider} disabled={pending}
              onClick={()=>reauthenticate(provider)}>Confirm with {labels[provider]}</button>)}
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
    {!active && <section className="panel"><h2>A verified contact email is needed</h2><p>{data.user.email ? `${data.user.email} has not been verified for product access.` : 'Your provider did not supply a verified contact address. No substitute address was invented.'} Connect a verified Google sign-in method below, or verify your address with your existing provider and sign in again.</p></section>}
    <div className="account-grid">
      <section className="panel"><h2>Profile</h2><p>{data.user.email || 'No contact email available'}</p><Badge tone={active ? 'green' : 'amber'}>{active ? 'Verified contact' : data.user.identity?.status ?? 'Verification required'}</Badge>
        <form onSubmit={event => { event.preventDefault(); void act(async () => { await request('/api/profile', { name }, 'PATCH'); await refresh(); notify('Profile updated.'); }); }}>
          <label>Display name<input required minLength={2} maxLength={60} autoComplete="name" value={name} onChange={event => setName(event.target.value)}/></label>
          <button className="button small" disabled={pending}>Save profile</button>
        </form>
        <h3>Account recovery</h3><p>Use <Link className="text-link" to="/forgot-password">password recovery</Link> for a Studio password. Recover a connected social identity directly with its provider. Signing out here does not sign you out of that provider.</p>
      </section>
      <section className="panel"><h2>Current access</h2><p>Server-verified access: <strong>{data.capabilities.access?.features.some(feature => proCapabilities.includes(feature.key) && feature.reason === 'unavailable') ? 'refresh unavailable' : data.capabilities.access?.state ?? 'unavailable'}</strong>. Content-only grants do not include premium practice, progress, projects or tutor work.</p>
        {data.capabilities.access?.nextChangeAt && <p>Next scheduled access change: {new Date(data.capabilities.access.nextChangeAt).toLocaleString()}.</p>}
        <p>Production payments and subscriptions remain disabled. An access grant is not proof of payment.</p>
        {data.capabilities.billing && <p><Link className="text-link" to="/billing">Open private sandbox billing</Link> - sandbox sessions do not grant production access.</p>}<h3>Privacy exports</h3>
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
    <section className="panel"><h2>Password credential</h2>
      <p>
        {authMethods?.hasPassword
          ? `Password sign-in is enabled${authMethods.passwordUpdatedAt ? ` (updated ${new Date(authMethods.passwordUpdatedAt).toLocaleString()})` : ''}.`
          : 'Set a password so you can sign in directly with your verified email address.'}
      </p>
      {passwordError && <p role="alert">{passwordError}</p>}
      <form onSubmit={event => {
        event.preventDefault();
        setPasswordError('');
        if (newPassword !== confirmNewPassword) {
          setPasswordError('New passwords do not match.');
          return;
        }
        void act(async () => {
          try {
            await request('/api/account/auth-methods', {
              currentPassword: authMethods?.hasPassword ? currentPassword : null,
              newPassword,
            }, 'PUT');
            setCurrentPassword('');
            setNewPassword('');
            setConfirmNewPassword('');
            await loadAuthMethods();
            await loadSecurity();
            notify(authMethods?.hasPassword ? 'Password updated.' : 'Password added to your account.');
          } catch (cause) {
            setPasswordError(cause instanceof Error ? cause.message : 'Could not update password.');
            throw cause;
          }
        });
      }}>
        {authMethods?.hasPassword && <label>Current password
          <input required type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)}/>
        </label>}
        <label>{authMethods?.hasPassword ? 'New password (12–128 characters)' : 'Create password (12–128 characters)'}
          <input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)}/>
        </label>
        <label>Confirm password
          <input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={confirmNewPassword} onChange={event => setConfirmNewPassword(event.target.value)}/>
        </label>
        <button className="button secondary small" disabled={pending || !active || newPassword.length < 12}>
          {authMethods?.hasPassword ? 'Update password' : 'Set password'}
        </button>
      </form>
      {data.capabilities.staff?.roles.includes('administrator') && <p className="fine-print">
        Administrator shortcut: <Link className="text-link" to="/admin/invitations">Manage account invitations</Link>
      </p>}
    </section>
    <section className="panel"><h2>Connected sign-in methods</h2>
      {error && <><p role="alert">{error}</p><button className="button secondary small" disabled={pending} onClick={() => act(loadSecurity)}>Retry security settings</button></>}
      {!security && !error && <p role="status">Loading sign-in and session information...</p>}
      {security && <>
        {!security.fresh && <p>Confirm an existing sign-in method before linking, unlinking, revoking sessions or exporting.</p>}
        {authMethods?.hasPassword && <p><Link className="button secondary small" to="/login?confirm=1">Confirm with password</Link></p>}
        {connectedIdentities.map(identity => <div className="panel" key={identity.id}>
          <h3>{labels[identity.provider]} {identity.current && <Badge>Current method</Badge>}</h3><p>{identity.email || 'No contact address shared'} - {identity.verified ? 'Verified' : 'Unverified'}{!identity.available && ' - Unavailable with provider'}</p>
          <button className="button secondary small" disabled={pending || !identity.available} onClick={() => reauthenticate(identity.provider)}>Confirm with {labels[identity.provider]}</button>{' '}
          <button className="text-button" disabled={pending || !security.fresh || identity.current || !connectedIdentities.some(other => other.id !== identity.id && other.verified && other.available)} onClick={() => act(async () => { await request(`/api/identity/methods/${identity.id}`, undefined, 'DELETE'); await loadSecurity(); notify('Sign-in method removed; its Studio sessions were revoked.'); })}>Remove method</button>
        </div>)}
        {unconnectedProviders.length > 0 ? <>
          <p>Connect another verified sign-in method. Each account is proved separately; email matching does not merge accounts.</p>
          {unconnectedProviders.map(provider => <button className="button secondary small" key={provider} disabled={pending || !security.fresh} onClick={() => act(() => linkProvider(provider))}>Connect {labels[provider]}</button>)}
          <p className="fine-print">Provider linking uses a one-use action bound to this fresh Studio session. Matching email addresses never merge accounts; Facebook can be linked only from here.</p>
        </> : <p className="fine-print">{configuredProviders.length ? 'All configured social sign-in providers are connected to this account.' : 'Social sign-in is not enabled for this workspace.'}</p>}
      </>}
    </section>
    {security && <>
      <section className="panel"><h2>Authenticator MFA</h2>
        {!security.mfa?.enabled ? <>
          <p>Add a time-based authenticator for staff and other sensitive actions. Enrollment requires confirmation of your password or a connected provider within the last ten minutes.</p>
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
          {security.mfa?.sessionVerified&&<p><Badge tone="green">Verified now</Badge> Sensitive actions are unlocked for this session for ten minutes. Sign-in confirmation is still checked separately.</p>}
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
          {(!security.fresh||!security.mfa?.sessionVerified)&&<p className="fine-print">Changing MFA requires both sign-in confirmation and MFA verification from the last ten minutes.</p>}
        </>}
        {recoveryCodes.length>0&&<div className="panel" role="status">
          <h3>Save these one-time recovery codes now</h3>
          <p>Each code works once. Studio stores only keyed hashes and cannot show these values again.</p>
          <ul>{recoveryCodes.map(code=><li key={code}><code>{code}</code></li>)}</ul>
          <button className="button secondary small" onClick={()=>act(async()=>{
            await navigator.clipboard.writeText(recoveryCodes.join('\n'));notify('Recovery codes copied.');
          })}>Copy recovery codes</button>
        </div>}
      </section>
      <section className="panel"><h2>Studio sessions</h2><p>Sessions expire after 30 days or seven days without use. No provider tokens, device fingerprints or precise locations are displayed or stored here.</p>
        {security.sessions.map(session => <div className="panel" key={session.id}><strong>{session.current ? 'This session' : 'Other sign-in session'}</strong><p>Created {new Date(session.createdAt).toLocaleString()} - last used {new Date(session.lastUsed).toLocaleString()}</p>{!session.current && <button className="text-button" disabled={pending || !security.fresh} onClick={() => act(async () => { await request(`/api/identity/sessions/${session.id}`, undefined, 'DELETE'); await loadSecurity(); notify('Session revoked.'); })}>Revoke session</button>}</div>)}
        <button className="button secondary small" disabled={pending || !security.fresh} onClick={() => act(async () => { await request('/api/identity/sessions/revoke-others', {}); await loadSecurity(); notify('Other Studio sessions were revoked.'); })}>Sign out other sessions</button>
      </section>
      <section className="panel"><h2>Recent security activity</h2>{security.events.map(event => <p key={event.id}>{event.action.replaceAll('-', ' ')} - {new Date(event.createdAt).toLocaleString()}</p>)}</section>
    </>}
  </>;
}
