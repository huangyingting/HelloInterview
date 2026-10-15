import { ArrowRight, BookOpen, LockKeyhole, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from '../navigation';
import type { Capability } from '../../shared/access';
import { useStudio } from '../store';
import { IconTile } from './primitives';

export function AuthPrompt({ message = 'Sign in to save your progress and continue practicing.' }: { message?: string }) {
  return <div className="callout"><Sparkles size={20} /><div><strong>Make this progress yours</strong><p>{message}</p></div><Link className="button small" to="/login">Sign in <ArrowRight size={15} /></Link></div>;
}
export function PremiumGate() {
  const {data}=useStudio();
  if(data.capabilities.commerce==='disabled')return <div className="premium-gate"><IconTile icon={LockKeyhole}/><h2>Current access does not include this feature.</h2><p>Check your verified access on Account. Content-only access does not include new premium practice or progress. Subscriptions are not enabled, and your saved archive is unchanged.</p><Link className="button" to="/account">Open Account <ArrowRight size={16}/></Link></div>;
  return <div className="premium-gate"><IconTile icon={LockKeyhole}/><h2>A deeper practice opportunity.</h2><p>This original Studio exercise requires a current server-verified premium grant. Review the available subscription workflow and your current access.</p><Link className="button" to="/pricing">Review premium access <ArrowRight size={16}/></Link></div>;
}
export function PremiumAccess({ children, feature = 'mock.create' }: { children: ReactNode; feature?: Capability }) {
  const { can, data } = useStudio();
  if (!data.user) return <AuthPrompt message="Sign in to explore the original premium preparation workflows." />;
  return can(feature) ? <>{children}</> : <PremiumGate />;
}
export function NotFound() {
  return <div className="empty"><BookOpen size={36}/><h1>This page isn’t in the Studio.</h1><p>Try the learning library or return to your dashboard.</p><Link className="button" to="/learn">Explore the library <ArrowRight size={16}/></Link></div>;
}
