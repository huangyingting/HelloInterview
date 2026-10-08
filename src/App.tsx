import { ArrowRight, BookOpen, ChevronDown, ChevronRight, ClipboardCheck, Code2, Command, GraduationCap, Home, Layers3, LifeBuoy, LogOut, Menu, MessageSquare, Moon, Network, Search, Settings2, Sparkles, Sun, Trophy, Users, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { practiceLabels, practiceTracks, tracks } from '../shared/catalog';
import type { CommunityKind } from '../shared/types';
import { AuthPrompt, Footer } from './components';
import { request, useStudio } from './store';
import { Dashboard, Landing, trackIcons } from './pages/Home';
import { LessonPage, LearningIndex, NotFound, TrackOverview } from './pages/Learn';
import { PracticeHistory, PracticeIndex, PracticeList, PracticeSession, StoryBank } from './pages/Practice';
import { QuizIndex, QuizRunner } from './pages/Quiz';
import { CommunityPage } from './pages/Community';
import { AccountPage, AuthPage, BlogPage, FAQ, GiftPage, GuidePage, InfoPage, Pricing, SearchPage, SupportPage, TutorPage } from './pages/Explore';
import { CourseIndex, CoursePage } from './pages/Courses';

export function App() {
  const {data,loading,error,refresh,act,toast}=useStudio(),location=useLocation(),navigate=useNavigate();
  const [theme,setTheme]=useState(localStorage.getItem('studio-theme')||'light'),[mobileOpen,setMobileOpen]=useState(false);
  const [learnOpen,setLearnOpen]=useState(true),[practiceOpen,setPracticeOpen]=useState(false),[communityOpen,setCommunityOpen]=useState(false);
  const path=location.pathname,segments=path.split('/').filter(Boolean).map(decodeURIComponent);
  const isLanding=path==='/'&&!data.user,isAuth=segments[0]==='login';
  const publicLayout=isLanding||isAuth||!data.user&&['pricing','premium','aboutus','terms','privacy','security'].includes(segments[0]);
  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('studio-theme',theme);},[theme]);
  useEffect(()=>{setMobileOpen(false);window.scrollTo(0,0);if(segments[0]==='practice')setPracticeOpen(true);if(segments[0]==='community')setCommunityOpen(true);document.title=`${segments[0]?segments[0][0].toUpperCase()+segments[0].slice(1).replaceAll('-',' '):'Your next chapter'} · Interview Studio`;},[path]);
  useEffect(()=>{const shortcut=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();navigate('/search');}if(e.key==='Escape')setMobileOpen(false);};window.addEventListener('keydown',shortcut);return()=>window.removeEventListener('keydown',shortcut);},[navigate]);
  if(loading)return <div className="boot-screen"><div className="brand-mark">is</div><h2>Opening your Studio…</h2><span className="loading-bar"/></div>;
  if(error)return <div className="boot-screen"><h1>The Studio could not load.</h1><p role="alert">{error}</p><button className="button" onClick={()=>act(refresh)}>Try again</button></div>;
  let content:ReactNode;
  if(!segments.length)content=data.user?<Dashboard/>:<Landing/>;
  else if(segments[0]==='dashboard')content=data.user?<Dashboard/>:<AuthPrompt/>;
  else if(segments[0]==='login')content=<AuthPage/>;
  else if(segments[0]==='learn'){
    if(!segments[1])content=<LearningIndex/>;
    else if(segments[1]==='courses')content=segments[2]?<CoursePage id={segments[2]} videoId={segments[3]==='video'?segments[4]:undefined} key={path}/>:<CourseIndex/>;
    else if(segments[1]==='changelog')content=<InfoPage id="changelog"/>;
    else if(segments[1]==='behavioral'&&['stories','story-builder'].includes(segments[2]))content=<StoryBank key={path}/>;
    else if(segments.length===2)content=<TrackOverview id={segments[1]}/>;
    else content=<LessonPage trackId={segments[1]} lessonId={segments.at(-1)!} key={path}/>;
  }else if(segments[0]==='practice'){
    if(!segments[1]||segments[1]==='overview')content=<PracticeIndex/>;
    else if(!segments[2])content=<PracticeList track={segments[1]} key={path}/>;
    else content=<PracticeSession track={segments[1]} id={segments[2]} key={`${path}${location.search}`}/>;
  }else if(segments[0]==='quiz')content=segments[1]?<QuizRunner topic={segments[1]} key={`${path}${location.search}`}/>:<QuizIndex/>;
  else if(segments[0]==='community'&&['questions','stories','submissions','discussion'].includes(segments[1])){
    const kind=segments[1] as CommunityKind;
    content=<CommunityPage key={path} kind={kind} track={kind==='submissions'?segments[2]||'':''} postId={kind==='submissions'?segments[3]||'':segments[2]||''}/>;
  }else if(segments[0]==='guides')content=<GuidePage company={segments[1]} level={segments[2]}/>;
  else if(segments[0]==='blog')content=<BlogPage id={segments[1]}/>;
  else if(segments[0]==='history')content=<PracticeHistory/>;
  else if(segments[0]==='search')content=<SearchPage/>;
  else if(segments[0]==='tutor')content=<TutorPage/>;
  else if(['profile','account','settings'].includes(segments[0]))content=<AccountPage/>;
  else if(segments[0]==='pricing'||segments[0]==='premium')content=segments[1]==='gift'?<GiftPage/>:<Pricing checkout={segments[1]==='checkout'}/>;
  else if(segments[0]==='faq')content=<FAQ/>;
  else if(segments[0]==='support')content=<SupportPage/>;
  else if(['aboutus','privacy','terms','security'].includes(segments[0]))content=<InfoPage id={segments[0]}/>;
  else content=<NotFound/>;
  const active=(to:string)=>path===to||to!=='/dashboard'&&path.startsWith(`${to}/`);
  const navLink=(to:string,label:string,icon?:typeof Home)=>{const Icon=icon;return <Link className={`nav-link ${active(to)?'active':''}`} to={to} aria-current={active(to)?'page':undefined} key={to}>{Icon&&<Icon size={17} strokeWidth={1.6}/>}<span>{label}</span>{active(to)&&<span className="nav-active-dot"/>}</Link>;};
  const toggleTheme=()=>setTheme(theme==='dark'?'light':'dark');
  const brand=<Link className="brand" to={data.user?'/dashboard':'/'}><span className="brand-mark">is<span/></span><span>interview<span className="brand-light"> studio</span><b>.</b></span></Link>;
  return <div className={`app ${publicLayout?'public-layout':''}`}>
    <a className="skip-link" href="#main">Skip to content</a>
    {!publicLayout&&<><aside className={`sidebar ${mobileOpen?'mobile-open':''}`} aria-label="Primary navigation"><div className="sidebar-brand">{brand}<button className="icon-button mobile-close" aria-label="Close navigation" onClick={()=>setMobileOpen(false)}><X size={20}/></button></div><div className="sidebar-nav">{navLink('/dashboard','Your dashboard',Home)}<div className="nav-divider"/><span className="nav-section-label">MAKE YOUR NEXT STEP COUNT</span><button className={`nav-group ${segments[0]==='learn'?'current':''}`} aria-expanded={learnOpen} onClick={()=>setLearnOpen(!learnOpen)}><BookOpen size={17}/><span>Learn</span><ChevronDown size={14} style={{transform:learnOpen?'rotate(180deg)':undefined}}/></button>{learnOpen&&<div className="nav-children">{tracks.map(t=>navLink(`/learn/${t.id}`,t.title))}{navLink('/guides','Company guides')}{navLink('/blog','Studio journal')}</div>}<button className={`nav-group ${segments[0]==='practice'?'current':''}`} aria-expanded={practiceOpen} onClick={()=>setPracticeOpen(!practiceOpen)}><Code2 size={17}/><span>Practice</span><ChevronDown size={14} style={{transform:practiceOpen?'rotate(180deg)':undefined}}/></button>{practiceOpen&&<div className="nav-children">{practiceTracks.map(t=>navLink(`/practice/${t}`,practiceLabels[t]))}{navLink('/history','Practice history')}{navLink('/learn/behavioral/stories','Your story bank')}</div>}<button className={`nav-group ${segments[0]==='community'?'current':''}`} aria-expanded={communityOpen} onClick={()=>setCommunityOpen(!communityOpen)}><Users size={17}/><span>Community</span><ChevronDown size={14} style={{transform:communityOpen?'rotate(180deg)':undefined}}/></button>{communityOpen&&<div className="nav-children">{navLink('/community/questions','Interview questions')}{navLink('/community/stories','Preparation stories')}{navLink('/community/submissions/system-design','System design library')}{navLink('/community/submissions/low-level-design','Object design library')}{navLink('/community/discussion','Ask the community')}</div>}{navLink('/quiz','Quizzes',ClipboardCheck)}<div className="sidebar-nudge"><Sparkles size={18}/><strong>A little more room to grow.</strong><p>Explore the premium demo.</p><Link to="/pricing">See what’s included <ArrowRight size={14}/></Link></div></div><div className="sidebar-bottom">{data.user?<><Link className="sidebar-profile" to="/account"><span className="avatar">{data.user.name[0]}</span><div><strong>{data.user.name}</strong><span>{data.user.demo?'Local demo account':'Studio member'}</span></div><Settings2 size={16}/></Link><div className="sidebar-bottom-links"><Link to="/support"><LifeBuoy size={15}/> Help</Link><button onClick={()=>act(async()=>{await request('/api/logout',{});await refresh();navigate('/');})}><LogOut size={15}/> Sign out</button></div></>:<Link className="button" to="/login">Make this Studio yours <ArrowRight size={15}/></Link>}</div></aside>{mobileOpen&&<button className="mobile-backdrop" aria-label="Close navigation backdrop" onClick={()=>setMobileOpen(false)}/>}</>}
    <div className="app-body"><header className={`topbar ${publicLayout?'public-topbar':''}`}>{publicLayout?brand:<><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={()=>setMobileOpen(true)}><Menu size={21}/></button><Link className="header-search" to="/search"><Search size={16}/><span>Search the Studio</span><kbd>⌘ K</kbd></Link></>}<nav className="topbar-actions" aria-label="Utility navigation">{publicLayout&&<><Link to="/learn">Learn</Link><Link to="/practice">Practice</Link><Link to="/community/questions" className="public-community-link">Community</Link></>}<Link to="/pricing" className="pricing-top-link">Plans</Link>{!isAuth&&<Link className="tutor-link" to="/tutor"><GraduationCap size={17}/><span>{data.capabilities.ai?'AI Tutor':'Study helper'}</span></Link>}{isLanding?<Link className="button small" to="/login">Your Studio <ArrowRight size={14}/></Link>:!isAuth&&<Link className="button small premium-top-link" to={data.user?'/account':'/login'}>{data.user?'Your account':'Sign in'}</Link>}<button className="theme-toggle icon-button" onClick={toggleTheme} aria-label={theme==='dark'?'Switch to light theme':'Switch to dark theme'}>{theme==='dark'?<Sun size={18}/>:<Moon size={18}/>}</button></nav></header><main id="main" className={`main-content ${isLanding?'landing-content':''} ${isAuth?'auth-content':''}`}>{content}</main>{!isLanding&&!isAuth&&<div className="shell-footer"><span>Small steps. Stronger interviews.</span><div><Link to="/faq">FAQ</Link><Link to="/privacy">Privacy</Link><Link to="/support">Support</Link></div></div>}</div>
    {toast&&<div className={`toast ${toast.error?'error':''}`} role={toast.error?'alert':'status'}><span>{toast.error?<X size={17}/>:<Sparkles size={17}/>}</span>{toast.text}</div>}
  </div>;
}
