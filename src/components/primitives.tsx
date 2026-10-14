import { ChevronRight, Sparkles, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from '../navigation';

export function IconTile({ icon: Icon, color = 'var(--accent)', small = false }: { icon: LucideIcon; color?: string; small?: boolean }) {
  return <span className={`icon-tile ${small ? 'small' : ''}`} style={{ color, background: `color-mix(in srgb, ${color} 11%, var(--surface))` }}><Icon size={small ? 18 : 23} strokeWidth={1.7} /></span>;
}
export function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: ReactNode; description?: string; action?: ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>;
}
export function Empty({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <div className="empty"><Sparkles size={30} strokeWidth={1.4} /><h3>{title}</h3><p>{description}</p>{children}</div>;
}
export function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone.toLowerCase()}`}>{children}</span>;
}
export function Progress({ value, label }: { value: number; label?: string }) {
  return <div className="progress-wrap">{label && <div className="progress-label"><span>{label}</span><span>{Math.round(value)}%</span></div>}<div className="progress" role="progressbar" aria-label={label || 'Progress'} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div></div>;
}
export function Footer() {
  return <footer className="footer"><div><strong>Interview Studio<span className="brand-dot">.</span></strong><p>Small steps. Stronger interviews.</p><span className="fine-print">An independent, original local application.</span></div><div><h4>Prepare</h4><Link to="/learn/system-design">System design</Link><Link to="/learn/code">Coding patterns</Link><Link to="/practice/behavioral">Behavioral practice</Link></div><div><h4>Explore</h4><Link to="/community/questions">Interview questions</Link><Link to="/guides/meta/senior">Company guides</Link><Link to="/blog">The Studio journal</Link></div><div><h4>Studio</h4><Link to="/pricing">Plans</Link><Link to="/support">Support</Link><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></div></footer>;
}
export function CardLink({ to, title, description, icon: Icon, color }: { to: string; title: string; description: string; icon: LucideIcon; color?: string }) {
  return <Link className="card-link" to={to}><IconTile icon={Icon} color={color} /><div><strong>{title}</strong><p>{description}</p></div><ChevronRight size={18} /></Link>;
}
