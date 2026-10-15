import { ArrowRight, BookOpen, Check, CircleCheck, Code2, GraduationCap, Network, Rocket } from 'lucide-react';
import { Link } from '../navigation';
import { navigationTracks as tracks } from '../../shared/public-navigation';
import { CardLink, Footer, IconTile } from '../components/primitives';
import { trackIcons } from '../track-icons';

export function Landing() {
  return <div className="landing">
    <section className="landing-hero"><span className="pill"><span className="status-dot" /> Your next chapter starts here</span><h1>Great interviews start<br />with <span>a little practice.</span></h1><p>Build the knowledge. Practice the conversation.<br />Walk into your next engineering interview with a plan.</p><div className="hero-actions"><Link className="button" to="/learn/system-design">Explore free lessons <ArrowRight size={18} /></Link><Link className="button secondary" to="/login">Build my prep plan</Link></div><div className="hero-note"><Check size={14} /> Original lessons <span>·</span> Interactive practice <span>·</span> Progress that stays with you</div>
      <div className="hero-float float-left"><IconTile icon={Network} /><div><strong>Think in systems</strong><span>Start simple. Scale thoughtfully.</span></div></div>
      <div className="hero-float float-right"><IconTile icon={Code2} color="#6b70b4" /><div><strong>See the pattern</strong><span>Understand every next step.</span></div></div>
      <div className="hero-schematic" aria-hidden="true"><span>Client</span><i /><span>API</span><i /><span>Cache</span><i /><span>Database</span></div>
    </section>
    <section className="landing-section"><div className="section-heading"><div><span className="eyebrow">A PATH FOR EVERY INTERVIEW</span><h2>Find your next starting point.</h2></div><Link className="text-link" to="/guides/meta/senior">Explore company guides <ArrowRight size={16} /></Link></div><div className="track-grid">{tracks.slice(0,6).map(t => <CardLink key={t.id} to={`/learn/${t.id}`} title={t.title} description={t.short} icon={trackIcons[t.id]} color={t.color} />)}</div></section>
    <section className="landing-workflow"><div><span className="eyebrow">LESS SCROLLING. MORE PROGRESS.</span><h2>One place for the<br />whole preparation journey.</h2><p>Connect what you learn to what you practice. Keep useful notes, review the gaps, and return a little stronger tomorrow.</p><Link className="button secondary" to="/login">Sign in to start <ArrowRight size={16} /></Link></div><div className="workflow-steps">{[{icon:BookOpen,title:'Learn with intention',body:'Short, practical lessons and visual explanations.'},{icon:Rocket,title:'Practice the real decisions',body:'Guided design, code review, and behavioral workspaces.'},{icon:CircleCheck,title:'Review what matters',body:'A personal quiz review deck and saved practice feedback.'}].map((s,i) => <div key={s.title}><span className="step-number">0{i+1}</span><IconTile icon={s.icon} /><div><h3>{s.title}</h3><p>{s.body}</p></div></div>)}</div></section>
    <section className="landing-cta"><GraduationCap size={36} strokeWidth={1.5} /><h2>You don’t need to know everything.<br />You need a clear next step.</h2><Link className="button" to="/learn/system-design/introduction">Take your first lesson <ArrowRight size={17} /></Link></section><Footer />
  </div>;
}
