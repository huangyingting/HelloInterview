import { ArrowRight, BookOpen, CalendarDays, Check, ChevronRight, Code2, Plus, Target, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from '../navigation';
import { companies, courses, levels, tracks } from '../../shared/public-catalog';
import { courseCompletion, currentStreak } from '../../shared/domain';
import { nextPreparationStep } from '../../shared/preparation';
import type { UserState } from '../../shared/types';
import { IconTile, Progress } from '../components/primitives';
import { request, useStudio } from '../store';
import { trackIcons } from '../track-icons';
import { Select } from '../components/Select';

export function Dashboard() {
  const { data, setState, act, notify, pending } = useStudio();
  const [adding, setAdding] = useState(false);
  const [company, setCompany] = useState(''), [level, setLevel] = useState('Senior'), [role, setRole] = useState('Software Engineer'), [date, setDate] = useState('');
  const totalLessons = tracks.reduce((total, track) => total + track.lessons.length, 0);
  const readLessons = tracks.reduce((total, track) => total + track.lessons.filter(lesson => data.state.read.includes(`${track.id}/${lesson.id}`)).length, 0);
  const completed = data.state.attempts.filter(attempt => attempt.completed).length;
  const next = nextPreparationStep(data.state);
  const firstName = data.user?.name.trim().split(/\s+/)[0] || 'there';
  const week = Array.from({ length: 7 }, (_, index) => {
    const day = new Date();
    day.setUTCDate(day.getUTCDate() - 6 + index);
    return { key: day.toISOString().slice(0, 10), label: day.toLocaleDateString('en', { weekday: 'short', timeZone: 'UTC' }) };
  });
  return <div className="workspace-home">
    <div className="dashboard-intro"><div><span className="eyebrow">YOUR PERSONAL WORKSPACE</span><h1>Make the next<br/><span>step count, {firstName}.</span></h1></div><Link className="button secondary" to="/practice"><Plus size={17}/> New practice</Link></div>
    <section className="focus-panel" aria-label="Your next step">
      <div><span className="eyebrow">{next.label}</span><h2>{next.title}</h2><p>{next.description}</p><Link className="button" to={next.to}>{next.action} <ArrowRight size={18}/></Link></div>
      <div className="focus-glyph" aria-hidden="true"><span>→</span><small>ONE STEP FORWARD</small></div>
    </section>
    <div className="workspace-metrics" aria-label="Your actual progress">
      <div><span>LESSONS COMPLETED</span><strong>{readLessons}<small> / {totalLessons}</small></strong></div>
      <div><span>PRACTICE COMPLETED</span><strong>{completed}<small> sessions</small></strong></div>
      <div><span>LEARNING STREAK</span><strong>{currentStreak(data.state.activity)}<small> days</small></strong></div>
      <Link to={data.state.review.length ? '/quiz/review' : '/quiz'}><span>READY TO REVIEW</span><strong>{data.state.review.length}<small> questions <ArrowRight size={16}/></small></strong></Link>
    </div>
    {!data.state.activity.length && <p className="workspace-welcome"><span className="status-dot"/> A fresh workspace. Your completed lessons, saved practice, and quiz results will appear as you work.</p>}
    <div className="dashboard-grid"><div className="dashboard-main">
      <section className="panel learning-path">
        <div className="section-heading"><div><span className="eyebrow">BUILD YOUR FOUNDATION</span><h2>Your learning paths</h2></div><Link className="text-link" to="/learn">All tracks <ArrowRight size={16}/></Link></div>
        {tracks.slice(0, 4).map(track => {
          const count = track.lessons.filter(lesson => data.state.read.includes(`${track.id}/${lesson.id}`)).length;
          const lesson = track.lessons.find(item => !data.state.read.includes(`${track.id}/${item.id}`));
          const to = lesson ? `/learn/${track.id}/${lesson.id}` : `/learn/${track.id}`;
          return <div className="path-row" key={track.id}><IconTile icon={trackIcons[track.id]}/><div className="path-detail"><div><Link to={`/learn/${track.id}`}><h3>{track.title}</h3></Link><span>{count}/{track.lessons.length}</span></div><Progress value={count / track.lessons.length * 100}/><Link className="path-next" to={to}>{lesson ? `${count ? 'Continue' : 'Start'}: ${lesson.title}` : 'All lessons complete. Revisit the track.'}<ChevronRight size={14}/></Link></div><Link className="icon-button" to={to} aria-label={`Continue ${track.title}`}><ArrowRight size={19}/></Link></div>;
        })}
      </section>
      {data.state.enrollments.length > 0 && <section className="panel learning-path"><div className="section-heading"><h2>Enrolled courses</h2><Link className="text-link" to="/learn/courses">All courses <ArrowRight size={15}/></Link></div>{courses.filter(course => data.state.enrollments.includes(course.id)).map(course => {
        const progress = courseCompletion(course, data.state);
        return <div className="path-row" key={course.id}><IconTile icon={BookOpen}/><div className="path-detail"><div><Link to={`/learn/courses/${course.id}`}><h3>{course.title}</h3></Link><span>{progress.complete}/{progress.total}</span></div><Progress value={progress.complete / progress.total * 100}/></div><Link className="icon-button" to={`/learn/courses/${course.id}`} aria-label={`Open ${course.title}`}><ArrowRight size={18}/></Link></div>;
      })}</section>}
      <section className="panel target-panel">
        <div className="section-heading"><div><span className="eyebrow">PREPARE WITH INTENTION</span><h2>Your next interview</h2></div><button className="text-button" aria-expanded={adding} onClick={() => setAdding(!adding)}><Plus size={15}/>{adding ? 'Close form' : 'Add target'}</button></div>
        {adding && <form className="target-form" onSubmit={event => {
          event.preventDefault();
          void act(async () => {
            setState(await request<UserState>('/api/targets', { company, level, role, date }));
            setAdding(false); setCompany(''); setDate(''); notify('Interview target saved.');
          });
        }}>
          <label>Company<input list="companies" required minLength={2} maxLength={80} placeholder="Where are you interviewing?" value={company} onChange={event => setCompany(event.target.value)}/></label>
          <datalist id="companies">{companies.map(item => <option key={item} value={item}/>)}</datalist>
          <label>Level<Select aria-label="Level" value={level} onValueChange={selectedValue => setLevel(selectedValue)} options={levels.map(item => ({ value: item, label: item }))}/></label>
          <label>Role<input required minLength={2} maxLength={80} value={role} onChange={event => setRole(event.target.value)}/></label>
          <label>Interview date (optional)<input type="date" value={date} onChange={event => setDate(event.target.value)}/></label>
          <button className="button" disabled={pending}>Save target <ArrowRight size={16}/></button>
        </form>}
        {!data.state.targets.length ? <div className="target-empty"><Target size={27} strokeWidth={1.4}/><div><h3>Give your preparation a destination.</h3><p>Add a company, role, and interview date when you have one.</p></div><button className="text-button" onClick={() => setAdding(true)}>Set a target <ArrowRight size={15}/></button></div> : <div className="target-list">{data.state.targets.map(target => <div key={target.id}><span className="company-letter">{target.company[0]}</span><div><strong>{target.company}</strong><p>{target.level} / {target.role}</p></div><span className="target-date"><CalendarDays size={15}/>{target.date ? new Date(`${target.date}T12:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric' }) : 'No date set'}</span><Link className="text-link" to={`/guides/${encodeURIComponent(target.company.toLowerCase())}/${encodeURIComponent(target.level.toLowerCase())}`}>Guide <ArrowRight size={15}/></Link><button className="icon-button" disabled={pending} aria-label={`Remove ${target.company} target`} onClick={() => act(async () => setState(await request<UserState>(`/api/targets/${encodeURIComponent(target.id)}`, undefined, 'DELETE')))}><Trash2 size={15}/></button></div>)}</div>}
      </section>
    </div><aside className="dashboard-aside">
      <section className="panel week-panel"><span className="eyebrow">SHOWING UP IS THE WORK</span><h3>Your last seven days</h3><div className="week-days">{week.map(day => <div key={day.key}><span className={data.state.activity.includes(day.key) ? 'active' : ''} aria-label={`${day.key}: ${data.state.activity.includes(day.key) ? 'active' : 'no activity'}`}>{data.state.activity.includes(day.key) ? <Check size={15}/> : <span/>}</span><small>{day.label}</small></div>)}</div><div className="streak-note"><strong>{week.filter(day => data.state.activity.includes(day.key)).length} active days</strong><span>UTC calendar</span></div></section>
      <section className="review-note"><span className="eyebrow">CLOSE THE LOOP</span><h3>Know what<br/>stays with you.</h3><p>{data.state.review.length ? `${data.state.review.length} questions from your quizzes are ready for another look.` : 'A short quiz turns a good lesson into something you can recall.'}</p><Link className="text-link" to={data.state.review.length ? '/quiz/review' : '/quiz'}>{data.state.review.length ? 'Open your review' : 'Check your understanding'} <ArrowRight size={17}/></Link></section>
      <div className="workspace-shortcuts"><Link to="/history"><Code2 size={19}/><span>Practice archive<small>Your drafts and feedback</small></span><ArrowRight size={17}/></Link><Link to="/learn/behavioral/stories"><BookOpen size={19}/><span>Story bank<small>Your experience, in your words</small></span><ArrowRight size={17}/></Link></div>
    </aside></div>
  </div>;
}
