import { ArrowDown, ArrowRight, BookOpen, Code2, MoveUpRight, Network } from 'lucide-react';
import { Link } from '../navigation';
import { problems, tracks } from '../../shared/public-catalog';
import { Footer, StudioMark } from '../components/primitives';
import { trackIcons } from '../track-icons';
import { useStudio } from '../store';

export function Landing() {
  const { data } = useStudio();
  const lessonCount = tracks.reduce((total, track) => total + track.lessons.length, 0);
  return <div className="landing editorial-landing">
    <section className="editorial-hero">
      <div className="hero-copy">
        <span className="eyebrow"><span className="status-dot"/> INDEPENDENT THINKING. BETTER PREPARATION.</span>
        <h1>Think clearly.<br/>Interview <em>better.</em></h1>
        <p>Go beyond the right answer. Build the reasoning, practice the trade-offs, and learn to explain the work.</p>
        <div className="hero-actions">
          <Link className="button" to="/learn">Explore the library <ArrowRight size={18}/></Link>
          <Link className="button secondary" to="/login">Open your workspace <MoveUpRight size={17}/></Link>
        </div>
        <p className="hero-access-note">{data.capabilities.auth?.admissionMode === 'public' ? 'Create an account to save your preparation.' : 'Browse freely. An invitation unlocks your personal workspace.'}</p>
        <a className="hero-scroll" href="#disciplines"><ArrowDown size={15}/> FIND YOUR FOCUS</a>
      </div>
      <div className="preparation-map">
        <div className="map-caption"><span>THE STUDIO METHOD</span><span>01 / 03</span></div>
        <div className="signal-art" aria-hidden="true">
          <svg viewBox="0 0 400 320" fill="none">
            <path d="M200 32v256M72 160h256M109 69l182 182M109 251L291 69" stroke="currentColor" strokeWidth="1"/>
            <circle cx="200" cy="160" r="104" stroke="currentColor" strokeDasharray="3 7"/>
            <circle cx="200" cy="160" r="64" stroke="currentColor"/>
            <path d="M200 76v168M116 160h168M141 101l118 118M141 219l118-118" stroke="var(--accent)" strokeWidth="16"/>
            <circle cx="200" cy="32" r="6" fill="var(--text)"/>
            <circle cx="328" cy="160" r="6" fill="var(--accent)"/>
            <circle cx="109" cy="251" r="6" fill="var(--text)"/>
          </svg>
          <span className="signal-label label-reason">Reason</span>
          <span className="signal-label label-build">Build</span>
          <span className="signal-label label-refine">Refine</span>
        </div>
        <div className="map-steps">
          <Link to="/learn"><span>01</span><BookOpen size={17}/><strong>Understand it.</strong><ArrowRight size={16}/></Link>
          <Link to="/practice"><span>02</span><Code2 size={17}/><strong>Work through it.</strong><ArrowRight size={16}/></Link>
          <Link to="/quiz"><span>03</span><Network size={17}/><strong>Make it stick.</strong><ArrowRight size={16}/></Link>
        </div>
      </div>
    </section>
    <div className="library-index" aria-label="Library at a glance">
      <span><StudioMark/> A WORKSPACE FOR THE WAY YOU THINK</span>
      <div><strong>{tracks.length}</strong> learning tracks</div>
      <div><strong>{lessonCount}</strong> original lessons</div>
      <div><strong>{problems.length}</strong> practice exercises</div>
    </div>
    <section className="discipline-section" id="disciplines">
      <div className="section-heading"><div><span className="eyebrow">CHOOSE YOUR DISCIPLINE</span><h2>Depth, not just a checklist.</h2></div><Link className="text-link" to="/learn/courses">See structured courses <ArrowRight size={17}/></Link></div>
      <div className="discipline-grid">{tracks.map((track, index) => {
        const Icon = trackIcons[track.id];
        return <Link className="discipline-card" to={`/learn/${track.id}`} key={track.id}>
          <div className="discipline-card-top"><span>{String(index + 1).padStart(2, '0')}</span><Icon size={24} strokeWidth={1.4}/></div>
          <h3>{track.title}</h3><p>{track.short}</p>
          <div className="discipline-card-bottom"><span>{track.lessons.length} lessons</span><MoveUpRight size={19}/></div>
        </Link>;
      })}</div>
    </section>
    <section className="studio-manifesto">
      <span className="eyebrow">BUILT FOR DELIBERATE PRACTICE</span>
      <h2>Your thinking is the work.<br/><span>Give it a proper workspace.</span></h2>
      <div className="manifesto-grid">
        <div><span>01 / LEARN</span><h3>Follow the reasoning.</h3><p>Original explanations, worked examples, and public sources. Go from a concept to a decision you can defend.</p></div>
        <div><span>02 / PRACTICE</span><h3>Keep the messy middle.</h3><p>Save your drafts, diagrams, code, and stories. Come back to the work instead of starting over.</p></div>
        <div><span>03 / REFLECT</span><h3>Know your next move.</h3><p>Review your answers and track what you actually complete. Your progress belongs to you.</p></div>
      </div>
      <Link className="button" to="/learn/system-design/introduction">Start with one good lesson <ArrowRight size={18}/></Link>
    </section>
    <Footer/>
  </div>;
}
