import { ArrowRight, BookOpen, ChevronDown, ChevronRight, ClipboardCheck, Code2, Command, GraduationCap, Home, Layers3, LifeBuoy, LogOut, Menu, MessageSquare, Moon, Network, Search, Settings2, Sparkles, Sun, Trophy, Users, X } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { signOutAuth } from './auth-client';
import { Link, useLocation, useNavigate } from './navigation';
import { practiceLabels, practiceTracks, navigationTracks as tracks } from "../shared/public-navigation";
import { isCommunityKind, parseStudioAddress } from '../shared/community-routes';
import { AuthPrompt, NotFound } from './components/access';
import { useStudio } from './store';
import { ScreenBoundary, ScreenLoading, ScreenReady, useScreenFocus } from './ScreenBoundary';

const Landing = lazy(() => import('./screens/Landing').then(module => ({ default: module.Landing })));
const Dashboard = lazy(() => import('./screens/Home').then(module => ({ default: module.Dashboard })));
const LessonPage = lazy(() => import('./screens/Learn').then(module => ({ default: module.LessonPage })));
const LearningIndex = lazy(() => import('./screens/Learn').then(module => ({ default: module.LearningIndex })));
const TrackOverview = lazy(() => import('./screens/Learn').then(module => ({ default: module.TrackOverview })));
const PracticeHistory = lazy(() => import('./screens/Practice').then(module => ({ default: module.PracticeHistory })));
const PracticeIndex = lazy(() => import('./screens/Practice').then(module => ({ default: module.PracticeIndex })));
const PracticeList = lazy(() => import('./screens/Practice').then(module => ({ default: module.PracticeList })));
const PracticeSession = lazy(() => import('./screens/Practice').then(module => ({ default: module.PracticeSession })));
const StoryBank = lazy(() => import('./screens/Practice').then(module => ({ default: module.StoryBank })));
const QuizIndex = lazy(() => import('./screens/Quiz').then(module => ({ default: module.QuizIndex })));
const QuizRunner = lazy(() => import('./screens/Quiz').then(module => ({ default: module.QuizRunner })));
const CommunityPage = lazy(() => import('./screens/Community').then(module => ({ default: module.CommunityPage })));
const AccountPage = lazy(() => import('./screens/Identity').then(module => ({ default: module.ManagedAccountPage })));
const AuthPage = lazy(() => import('./screens/Identity').then(module => ({ default: module.ManagedAuthPage })));
const BlogPage = lazy(() => import('./screens/Explore').then(module => ({ default: module.BlogPage })));
const FAQ = lazy(() => import('./screens/Explore').then(module => ({ default: module.FAQ })));
const GuidePage = lazy(() => import('./screens/Explore').then(module => ({ default: module.GuidePage })));
const InfoPage = lazy(() => import('./screens/Explore').then(module => ({ default: module.InfoPage })));
const Pricing = lazy(() => import('./screens/Explore').then(module => ({ default: module.Pricing })));
const SearchPage = lazy(() => import('./screens/Explore').then(module => ({ default: module.SearchPage })));
const SupportPage = lazy(() => import('./screens/Explore').then(module => ({ default: module.SupportPage })));
const TutorPage = lazy(() => import('./screens/Explore').then(module => ({ default: module.TutorPage })));
const CourseIndex = lazy(() => import('./screens/Courses').then(module => ({ default: module.CourseIndex })));
const CoursePage = lazy(() => import('./screens/Courses').then(module => ({ default: module.CoursePage })));
const MockPage = lazy(() => import('./screens/Premium').then(module => ({ default: module.MockPage })));
const PremiumStudio = lazy(() => import('./screens/Premium').then(module => ({ default: module.PremiumStudio })));
const StudyPlansPage = lazy(() => import('./screens/Premium').then(module => ({ default: module.StudyPlansPage })));
const ProjectsPage = lazy(() => import('./screens/Projects').then(module => ({ default: module.ProjectsPage })));
const CustomQuizPage = lazy(() => import('./screens/CustomQuiz').then(module => ({ default: module.CustomQuizPage })));
const CaseLibrary = lazy(() => import('./screens/Cases').then(module => ({ default: module.CaseLibrary })));
const CaseReader = lazy(() => import('./screens/Cases').then(module => ({ default: module.CaseReader })));
const CodingLibrary = lazy(() => import('./screens/Coding').then(module => ({ default: module.CodingLibrary })));
const CodingReader = lazy(() => import('./screens/Coding').then(module => ({ default: module.CodingReader })));
const SandboxBillingPage = lazy(() => import('./screens/Billing').then(module => ({ default: module.SandboxBillingPage })));
const StaffPage = lazy(() => import('./screens/Staff').then(module => ({ default: module.StaffPage })));

export function App() {
  const {data,loading,error,refresh,act,toast}=useStudio(),location=useLocation(),navigate=useNavigate();
  const [theme,setTheme]=useState(()=>typeof window==='undefined'?'light':localStorage.getItem('studio-theme')||'light'),[mobileOpen,setMobileOpen]=useState(false);
  const navigationTrigger=useRef<HTMLButtonElement>(null),navigationClose=useRef<HTMLButtonElement>(null);
  const closeNavigation=useCallback(()=>{setMobileOpen(false);if(navigationTrigger.current?.getClientRects().length)navigationTrigger.current.focus();},[]);
  const [learnOpen,setLearnOpen]=useState(true),[practiceOpen,setPracticeOpen]=useState(false),[communityOpen,setCommunityOpen]=useState(false);
  const path=location.pathname,address=parseStudioAddress(path,location.search),{segments}=address;
  const screenPath=address.detail?JSON.stringify([path,address.detail.kind,address.detail.id,address.detail.track ?? '']):segments[0]==='community'&&segments[1]==='post'?`${path}${location.search}`:path;
  const screenFocus=useScreenFocus(screenPath,data.user?.id,!loading&&!error);
  const isLanding=path==='/'&&!data.user,isAuth=segments[0]==='login'||path==='/auth';
  const publicLayout=isLanding||isAuth||!data.user&&['pricing','premium','aboutus','terms','privacy','security'].includes(segments[0]);
  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('studio-theme',theme);},[theme]);
  useEffect(()=>{setMobileOpen(false);window.scrollTo(0,0);if(segments[0]==='practice')setPracticeOpen(true);if(segments[0]==='community')setCommunityOpen(true);document.title=`${segments[0]?segments[0][0].toUpperCase()+segments[0].slice(1).replaceAll('-',' '):'Your next chapter'} · Interview Studio`;},[screenPath]);
  useEffect(()=>{if(mobileOpen)navigationClose.current?.focus();},[mobileOpen]);
  useEffect(()=>{const shortcut=(e:KeyboardEvent)=>{if(e.defaultPrevented||e.isComposing)return;if((e.metaKey||e.ctrlKey)&&!e.altKey&&e.key.toLowerCase()==='k'){e.preventDefault();if(path==='/search')document.getElementById('studio-search')?.focus();else navigate('/search');}if(e.key==='Escape'&&mobileOpen)closeNavigation();};window.addEventListener('keydown',shortcut);return()=>window.removeEventListener('keydown',shortcut);},[navigate,path,mobileOpen,closeNavigation]);
  if(loading)return <div className="boot-screen"><div className="brand-mark">is</div><h2>Opening your Studio…</h2><span className="loading-bar"/></div>;
  if(error)return <div className="boot-screen"><h1>The Studio could not load.</h1><p role="alert">{error}</p><button className="button" onClick={()=>act(refresh)}>Try again</button></div>;
  let content:ReactNode;
  if(address.invalid)content=<section className="empty"><h1>This address could not open.</h1><p role="alert">This address contains an invalid escape or community selection. No action was retried.</p><Link className="text-link" to="/">Back to the Studio</Link></section>;
  else if(address.detail)content=<CommunityPage key={screenPath} kind={address.detail.kind} track={address.detail.track} postId={address.detail.id}/>;
  else if(!segments.length)content=data.user?<Dashboard/>:<Landing/>;
  else if(segments[0]==='dashboard')content=data.user?<Dashboard/>:<AuthPrompt/>;
  else if(segments[0]==='login'||segments[0]==='auth'&&segments.length===1)content=<AuthPage/>;
  else if(segments[0]==='learn'){
    if(!segments[1])content=<LearningIndex/>;
    else if(segments[1]==='courses')content=segments[2]?<CoursePage id={segments[2]} videoId={segments[3]==='video'?segments[4]:undefined} key={path}/>:<CourseIndex/>;
    else if(segments[1]==='changelog')content=<InfoPage id="changelog"/>;
    else if(segments[1]==='system-design'&&segments[2]==='cases')content=<CaseLibrary/>;
    else if(segments[1]==='code'&&segments[2]==='solutions')content=<CodingLibrary/>;
    else if(segments[1]==='low-level-design'&&segments[2]==='solutions')content=<CodingLibrary track="low-level-design"/>;
    else if(segments[1]==='behavioral'&&['stories','story-builder'].includes(segments[2]))content=<StoryBank key={path}/>;
    else if(segments.length===2)content=<TrackOverview id={segments[1]}/>;
    else content=<LessonPage trackId={segments[1]} lessonId={segments.at(-1)!} key={path}/>;
  }else if(segments[0]==='practice'){
    if(!segments[1]||segments[1]==='overview')content=<PracticeIndex/>;
    else if(!segments[2])content=<PracticeList track={segments[1]} key={path}/>;
    else if(segments[1]==='system-design'&&segments[3]==='writeup')content=<CaseReader problemId={segments[2]} key={path}/>;
    else if(segments[1]==='code'&&segments[3]==='writeup')content=<CodingReader problemId={segments[2]} key={path}/>;
    else if(segments[1]==='low-level-design'&&segments[3]==='writeup')content=<CodingReader track="low-level-design" problemId={segments[2]} key={path}/>;
    else content=<PracticeSession track={segments[1]} id={segments[2]} key={`${path}${location.search}`}/>;
  }else if(segments[0]==='quiz')content=segments[1]==='custom'?<CustomQuizPage id={segments[2]} key={path}/>:segments[1]?<QuizRunner topic={segments[1]} key={`${path}${location.search}`}/>:<QuizIndex/>;
  else if(segments[0]==='community'&&isCommunityKind(segments[1])){
    const kind=segments[1];
    content=<CommunityPage key={path} kind={kind} track={kind==='submissions'?segments[2]||address.track||'':''} postId={kind==='submissions'?segments[3]||'':segments[2]||''}/>;
  }else if(segments[0]==='guides')content=<GuidePage company={segments[1]} level={segments[2]}/>;
  else if(segments[0]==='blog')content=<BlogPage id={segments[1]}/>;
  else if(segments[0]==='history')content=<PracticeHistory/>;
  else if(segments[0]==='search')content=<SearchPage/>;
  else if(segments[0]==='tutor')content=<TutorPage/>;
  else if(['profile','account','settings'].includes(segments[0]))content=<AccountPage/>;
  else if(segments[0]==='billing')content=<SandboxBillingPage key={data.user?.id}/>;
  else if(segments[0]==='staff')content=data.capabilities.staff?<StaffPage key={data.user?.id}/>:<NotFound/>;
  else if(segments[0]==='pricing'||segments[0]==='premium'){
    if(segments[1]==='studio')content=<PremiumStudio/>;
    else if(segments[1]==='mock')content=<MockPage id={segments[2]} key={path}/>;
    else if(segments[1]==='plans')content=<StudyPlansPage id={segments[2]} key={path}/>;
    else if(segments[1]==='projects')content=<ProjectsPage id={segments[2]} key={path}/>;
    else content=<Pricing/>;
  }
  else if(segments[0]==='faq')content=<FAQ/>;
  else if(segments[0]==='support')content=<SupportPage/>;
  else if(['aboutus','privacy','terms','security'].includes(segments[0]))content=<InfoPage id={segments[0]}/>;
  else content=<NotFound/>;
  const navPath=address.detail?`/community/${address.detail.kind}${address.detail.kind==='submissions'&&address.detail.track?`/${encodeURIComponent(address.detail.track)}`:''}`:address.track?`/community/submissions/${encodeURIComponent(address.track)}`:path;
  const active=(to:string)=>navPath===to||to!=='/dashboard'&&navPath.startsWith(`${to}/`);
  const navLink=(to:string,label:string,icon?:typeof Home)=>{const Icon=icon;return <Link className={`nav-link ${active(to)?'active':''}`} to={to} aria-current={active(to)?'page':undefined} key={to}>{Icon&&<Icon size={17} strokeWidth={1.6}/>}<span>{label}</span>{active(to)&&<span className="nav-active-dot"/>}</Link>;};
  const toggleTheme=()=>setTheme(theme==='dark'?'light':'dark');
  const brand=<Link className="brand" to={data.user?'/dashboard':'/'}><span className="brand-mark">is<span/></span><span>interview<span className="brand-light"> studio</span><b>.</b></span></Link>;
  return <div className={`app ${publicLayout?'public-layout':''}`}>
    <a className="skip-link" href="#main">Skip to content</a>
    {!publicLayout&&<><aside id="studio-navigation" className={`sidebar ${mobileOpen?'mobile-open':''}`} aria-label="Primary navigation"><div className="sidebar-brand">{brand}<button ref={navigationClose} className="icon-button mobile-close" aria-label="Close navigation" onClick={closeNavigation}><X size={20}/></button></div><div className="sidebar-nav">{navLink('/dashboard','Your dashboard',Home)}<div className="nav-divider"/><span className="nav-section-label">MAKE YOUR NEXT STEP COUNT</span><button className={`nav-group ${segments[0]==='learn'?'current':''}`} aria-expanded={learnOpen} onClick={()=>setLearnOpen(!learnOpen)}><BookOpen size={17}/><span>Learn</span><ChevronDown size={14} style={{transform:learnOpen?'rotate(180deg)':undefined}}/></button>{learnOpen&&<div className="nav-children">{tracks.map(t=>navLink(`/learn/${t.id}`,t.title))}{navLink('/guides','Company guides')}{navLink('/blog','Studio journal')}</div>}<button className={`nav-group ${segments[0]==='practice'?'current':''}`} aria-expanded={practiceOpen} onClick={()=>setPracticeOpen(!practiceOpen)}><Code2 size={17}/><span>Practice</span><ChevronDown size={14} style={{transform:practiceOpen?'rotate(180deg)':undefined}}/></button>{practiceOpen&&<div className="nav-children">{practiceTracks.map(t=>navLink(`/practice/${t}`,practiceLabels[t]))}{navLink('/premium/mock','Mock interviews')}{navLink('/premium/projects','Project workbench')}{navLink('/history','Practice history')}{navLink('/learn/behavioral/stories','Your story bank')}</div>}<button className={`nav-group ${segments[0]==='community'?'current':''}`} aria-expanded={communityOpen} onClick={()=>setCommunityOpen(!communityOpen)}><Users size={17}/><span>Community</span><ChevronDown size={14} style={{transform:communityOpen?'rotate(180deg)':undefined}}/></button>{communityOpen&&<div className="nav-children">{navLink('/community/questions','Interview questions')}{navLink('/community/stories','Preparation stories')}{navLink('/community/submissions/system-design','System design library')}{navLink('/community/submissions/low-level-design','Object design library')}{navLink('/community/discussion','Ask the community')}</div>}{navLink('/quiz','Quizzes',ClipboardCheck)}{navLink('/premium/studio','Premium Studio',Sparkles)}{data.capabilities.staff&&navLink('/staff','Staff operations',Settings2)}<div className="sidebar-nudge"><Sparkles size={18}/><strong>A little more room to grow.</strong><p>{data.capabilities.commerce==='disabled'?'Premium subscriptions are not enabled yet.':'Review sandbox subscription options.'}</p><Link to="/pricing">See what’s included <ArrowRight size={14}/></Link></div></div><div className="sidebar-bottom">{data.user?<><Link className="sidebar-profile" to="/account"><span className="avatar">{data.user.name[0]}</span><div><strong>{data.user.name}</strong><span>Studio member</span></div><Settings2 size={16}/></Link><div className="sidebar-bottom-links">        <Link to="/support"><LifeBuoy size={15}/> Help</Link><button onClick={()=>act(async()=>{await signOutAuth();await refresh();navigate('/');})}><LogOut size={15}/> Sign out</button></div></>:<Link className="button" to="/login">Make this Studio yours <ArrowRight size={15}/></Link>}</div></aside>{mobileOpen&&<button className="mobile-backdrop" aria-label="Close navigation backdrop" onClick={closeNavigation}/>}</>}
    <div className="app-body"><header className={`topbar ${publicLayout?'public-topbar':''}`}>{publicLayout?brand:<><button ref={navigationTrigger} className="icon-button mobile-menu" aria-label="Open navigation" aria-controls="studio-navigation" aria-expanded={mobileOpen} onClick={()=>setMobileOpen(true)}><Menu size={21}/></button><Link className="header-search" to="/search"><Search size={16}/><span>Search the Studio</span><kbd>⌘ K</kbd></Link></>}<nav className="topbar-actions" aria-label="Utility navigation">{publicLayout&&<><Link to="/learn">Learn</Link><Link to="/practice">Practice</Link><Link to="/community/questions" className="public-community-link">Community</Link></>}<Link to="/pricing" className="pricing-top-link">Plans</Link>{!isAuth&&<Link className="tutor-link" to="/tutor"><GraduationCap size={17}/><span>{data.capabilities.ai?'AI Tutor':'Study helper'}</span></Link>}{isLanding?<Link className="button small" to="/login">Your Studio <ArrowRight size={14}/></Link>:!isAuth&&<Link className="button small premium-top-link" to={data.user?'/account':'/login'}>{data.user?'Your account':'Sign in'}</Link>}<button className="theme-toggle icon-button" onClick={toggleTheme} aria-label={theme==='dark'?'Switch to light theme':'Switch to dark theme'}>{theme==='dark'?<Sun size={18}/>:<Moon size={18}/>}</button></nav></header><main id="main" tabIndex={-1} className={`main-content ${isLanding?'landing-content':''} ${isAuth?'auth-content':''}`}><ScreenBoundary key={data.user?.id ?? 'signed-out'} resetKey={`${path}${location.search}`} {...screenFocus}><Suspense fallback={<ScreenLoading/>}><ScreenReady {...screenFocus}>{content}</ScreenReady></Suspense></ScreenBoundary></main>{!isLanding&&!isAuth&&<div className="shell-footer"><span>Small steps. Stronger interviews.</span><div><Link to="/faq">FAQ</Link><Link to="/privacy">Privacy</Link><Link to="/support">Support</Link></div></div>}</div>
    {toast&&<div className={`toast ${toast.error?'error':''}`} role={toast.error?'alert':'status'}><span>{toast.error?<X size={17}/>:<Sparkles size={17}/>}</span>{toast.text}</div>}
  </div>;
}
