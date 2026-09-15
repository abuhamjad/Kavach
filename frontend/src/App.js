import { useState, useEffect, useRef, useCallback } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const WS_URL  = "ws://localhost:8000/ws";
const API_URL = "http://localhost:8000";
const THREAT_COLORS = { HIGH:"#ff0000", MEDIUM:"#cc2200", LOW:"#ff3333" };
const threatToScore = t => t==="HIGH"?3:t==="MEDIUM"?2:1;

// ── Fonts + globals ────────────────────────────────────────────────────────────
const fontLink = document.createElement('link');
fontLink.rel  = 'stylesheet';
fontLink.href = 'https://fonts.googleapis.com/css2?family=Anton&family=Barlow+Condensed:wght@300;400;600;700;800;900&family=Share+Tech+Mono&display=swap';
document.head.appendChild(fontLink);

const G = document.createElement('style');
G.textContent = `
  *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
  html { scroll-behavior:smooth; }
  body {
    background:#0d0d0d;
    color:#e8e0dc;
    font-family:'Share Tech Mono', monospace;
    overflow-x:hidden;
  }
  ::selection { background:#ff000044; color:#ff6666; }
  ::-webkit-scrollbar { width:2px; }
  ::-webkit-scrollbar-track { background:#0d0d0d; }
  ::-webkit-scrollbar-thumb { background:#3a0000; }

  /* scanlines */
  .scanlines::after {
    content:''; position:fixed; inset:0; pointer-events:none; z-index:9999;
    background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.05) 2px,rgba(0,0,0,0.05) 4px);
  }

  @keyframes fadeUp   { from{opacity:0;transform:translateY(32px)} to{opacity:1;transform:translateY(0)} }
  @keyframes fadeIn   { from{opacity:0} to{opacity:1} }
  @keyframes pulse-r  { 0%,100%{opacity:1} 50%{opacity:0.25} }
  @keyframes blink    { 0%,49%{opacity:1} 50%,100%{opacity:0} }
  @keyframes spin     { to{transform:rotate(360deg)} }
  @keyframes slide-in { from{opacity:0;transform:translateX(-8px)} to{opacity:1;transform:translateX(0)} }
  @keyframes threat-flash { 0%,100%{background:transparent} 50%{background:rgba(255,0,0,0.04)} }
  @keyframes gridDrift {
    from { background-position: 0 0; }
    to   { background-position: 60px 60px; }
  }
  @keyframes pageEnter { from{opacity:0;transform:scale(0.97)} to{opacity:1;transform:scale(1)} }
  @keyframes pageExit  { from{opacity:1;transform:scale(1)} to{opacity:0;transform:scale(1.03)} }
  @keyframes glitch {
    0%  {clip-path:inset(40% 0 61% 0);transform:translate(-3px)}
    25% {clip-path:inset(92% 0 1%  0);transform:translate(3px)}
    50% {clip-path:inset(25% 0 58% 0);transform:translate(-3px)}
    75% {clip-path:inset(54% 0 7%  0);transform:translate(3px)}
    100%{clip-path:inset(58% 0 43% 0);transform:translate(0)}
  }
  @keyframes revealLine {
    from { width:0 }
    to   { width:100% }
  }
  @keyframes mouseTrail {
    from { opacity:0.6; transform:scale(1); }
    to   { opacity:0; transform:scale(2.5); }
  }

  .hero-1 { animation: fadeUp 0.8s ease-out 0.0s both; }
  .hero-2 { animation: fadeUp 0.8s ease-out 0.1s both; }
  .hero-3 { animation: fadeUp 0.8s ease-out 0.25s both; }
  .hero-4 { animation: fadeUp 0.8s ease-out 0.4s both; }
  .hero-5 { animation: fadeUp 0.8s ease-out 0.55s both; }

  .page-enter { animation: pageEnter 0.5s ease-out both; }
  .page-exit  { animation: pageExit  0.35s ease-in  both; }
  .alert-row  { animation: slide-in 0.2s ease-out; }
  .high-threat{ animation: threat-flash 1s ease-in-out infinite; }

  /* Cursor */
  body { cursor: none; }
  .custom-cursor {
    position:fixed; width:10px; height:10px;
    border-radius:50%; background:#ff0000;
    pointer-events:none; z-index:99999;
    transform:translate(-50%,-50%);
    transition:transform 0.1s ease, width 0.2s, height 0.2s, background 0.2s;
    mix-blend-mode:difference;
  }
  .custom-cursor-ring {
    position:fixed; width:32px; height:32px;
    border-radius:50%; border:1px solid #ff000066;
    pointer-events:none; z-index:99998;
    transform:translate(-50%,-50%);
    transition:all 0.18s ease;
  }
  .cursor-hover .custom-cursor { width:16px; height:16px; background:#ff3333; }
  .cursor-hover .custom-cursor-ring { width:48px; height:48px; border-color:#ff000099; }

  .nav-link {
    font-family:'Barlow Condensed',sans-serif; font-weight:600;
    font-size:0.8rem; letter-spacing:0.2em; text-transform:uppercase;
    color:#4a3030; text-decoration:none; transition:color 0.2s;
    cursor:none;
  }
  .nav-link:hover { color:#cc4444; }

  .cta-btn {
    display:inline-flex; align-items:center; gap:10px;
    padding:14px 36px;
    font-family:'Barlow Condensed',sans-serif; font-weight:800;
    font-size:1rem; letter-spacing:0.25em; text-transform:uppercase;
    border:none; cursor:none; position:relative; overflow:hidden;
    text-decoration:none;
  }
  .cta-btn span { position:relative; z-index:1; }
  .cta-btn::after {
    content:''; position:absolute; inset:0;
    transform:scaleX(0); transform-origin:left;
    transition:transform 0.3s ease-out;
  }
  .cta-btn:hover::after { transform:scaleX(1); }
  .cta-primary { background:#cc0000; color:#fff; }
  .cta-primary::after { background:#ff0000; }
  .cta-outline  { background:transparent; color:#cc4444; border:1px solid #3a1010; }
  .cta-outline::after { background:#4a3030; }

  .feature-card {
    padding:32px; border:1px solid #4a3030;
    background:#0d0d0d; position:relative; overflow:hidden;
    transition:border-color 0.3s, background 0.3s;
    cursor:none;
  }
  .feature-card::before {
    content:''; position:absolute; top:0; left:0;
    height:2px; width:0; background:linear-gradient(90deg,#cc0000,transparent);
    transition:width 0.5s ease;
  }
  .feature-card:hover { border-color:#3a0000; background:#110808; }
  .feature-card:hover::before { width:100%; }

  .section-tag {
    font-family:'Share Tech Mono',monospace;
    font-size:0.58rem; letter-spacing:0.3em; color:#4a2020;
    text-transform:uppercase; margin-bottom:14px;
  }
`;
document.head.appendChild(G);

// ── Icons ──────────────────────────────────────────────────────────────────────
const Ic = {
  Shield:    ()=><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  Target:    ()=><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
  Zap:       ()=><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  Eye:       ()=><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  Arrow:     ()=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>,
  ArrowRight:()=><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>,
  Mail:      ()=><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2,4 12,13 22,4"/></svg>,
  Pin:       ()=><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  Menu:      ()=><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>,
  X:         ()=><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
};

// ── Panel corners ──────────────────────────────────────────────────────────────
function Corners({ c='#cc0000', s=10 }) {
  const b={position:'absolute',width:s,height:s,borderColor:c,borderStyle:'solid'};
  return <>
    <div style={{...b,top:0,left:0,   borderWidth:'1px 0 0 1px'}}/>
    <div style={{...b,top:0,right:0,  borderWidth:'1px 1px 0 0'}}/>
    <div style={{...b,bottom:0,left:0,borderWidth:'0 0 1px 1px'}}/>
    <div style={{...b,bottom:0,right:0,borderWidth:'0 1px 1px 0'}}/>
  </>;
}

// ── Custom cursor ──────────────────────────────────────────────────────────────
function CustomCursor() {
  const dotRef  = useRef(null);
  const ringRef = useRef(null);
  const pos     = useRef({x:0, y:0});
  const ring    = useRef({x:0, y:0});
  const hover   = useRef(false);

  useEffect(()=>{
    const onMove = e => {
      pos.current = {x:e.clientX, y:e.clientY};
      if (dotRef.current) {
        dotRef.current.style.left  = e.clientX+'px';
        dotRef.current.style.top   = e.clientY+'px';
      }
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const isHov = el && (el.tagName==='BUTTON'||el.tagName==='A'||el.closest('button')||el.closest('a')||el.closest('.feature-card'));
      hover.current = !!isHov;
      if (dotRef.current)  dotRef.current.className  = `custom-cursor${isHov?' cursor-hover':''}`;
      if (ringRef.current) ringRef.current.className = `custom-cursor-ring${isHov?' cursor-hover':''}`;
    };
    let raf;
    const lerp = () => {
      ring.current.x += (pos.current.x - ring.current.x) * 0.12;
      ring.current.y += (pos.current.y - ring.current.y) * 0.12;
      if (ringRef.current) {
        ringRef.current.style.left = ring.current.x+'px';
        ringRef.current.style.top  = ring.current.y+'px';
      }
      raf = requestAnimationFrame(lerp);
    };
    window.addEventListener('mousemove', onMove);
    raf = requestAnimationFrame(lerp);
    return ()=>{ window.removeEventListener('mousemove',onMove); cancelAnimationFrame(raf); };
  },[]);

  return <>
    <div ref={dotRef}  className="custom-cursor"/>
    <div ref={ringRef} className="custom-cursor-ring"/>
  </>;
}

// ── Particle field (interactive) ───────────────────────────────────────────────
function ParticleField() {
  const canvasRef = useRef(null);
  const mouse     = useRef({x:-999,y:-999});

  useEffect(()=>{
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext('2d');
    let W = canvas.width  = window.innerWidth;
    let H = canvas.height = window.innerHeight;

    const onResize = ()=>{ W=canvas.width=window.innerWidth; H=canvas.height=window.innerHeight; };
    window.addEventListener('resize',onResize);

    const onMove = e=>{ mouse.current={x:e.clientX,y:e.clientY}; };
    window.addEventListener('mousemove',onMove);

    // particles
    const particles = Array.from({length:80},()=>({
      x: Math.random()*W, y: Math.random()*H,
      vx:(Math.random()-0.5)*0.3, vy:(Math.random()-0.5)*0.3,
      size: Math.random()*1.5+0.5,
      opacity: Math.random()*0.4+0.1,
    }));

    let raf;
    const draw = ()=>{
      ctx.clearRect(0,0,W,H);

      // move + draw particles
      particles.forEach(p=>{
        p.x += p.vx; p.y += p.vy;
        if (p.x<0) p.x=W; if (p.x>W) p.x=0;
        if (p.y<0) p.y=H; if (p.y>H) p.y=0;

        // mouse repulsion
        const dx = p.x - mouse.current.x;
        const dy = p.y - mouse.current.y;
        const dist = Math.sqrt(dx*dx+dy*dy);
        if (dist < 120) {
          const force = (120-dist)/120;
          p.x += dx/dist * force * 2;
          p.y += dy/dist * force * 2;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI*2);
        ctx.fillStyle = `rgba(180,20,20,${p.opacity})`;
        ctx.fill();
      });

      // connect nearby particles
      for (let i=0;i<particles.length;i++){
        for (let j=i+1;j<particles.length;j++){
          const dx=particles[i].x-particles[j].x;
          const dy=particles[i].y-particles[j].y;
          const d=Math.sqrt(dx*dx+dy*dy);
          if (d<100){
            ctx.beginPath();
            ctx.moveTo(particles[i].x,particles[i].y);
            ctx.lineTo(particles[j].x,particles[j].y);
            ctx.strokeStyle=`rgba(150,10,10,${0.15*(1-d/100)})`;
            ctx.lineWidth=0.5;
            ctx.stroke();
          }
        }
      }

      raf=requestAnimationFrame(draw);
    };
    draw();

    return ()=>{
      window.removeEventListener('resize',onResize);
      window.removeEventListener('mousemove',onMove);
      cancelAnimationFrame(raf);
    };
  },[]);

  return <canvas ref={canvasRef} style={{
    position:'absolute',inset:0,zIndex:1,pointerEvents:'none',
  }}/>;
}

// ── Magnetic button ────────────────────────────────────────────────────────────
function MagneticBtn({ children, className='cta-btn cta-primary', onClick, href }) {
  const ref = useRef(null);
  const onMove = e=>{
    const r = ref.current.getBoundingClientRect();
    const x = e.clientX-r.left-r.width/2;
    const y = e.clientY-r.top-r.height/2;
    ref.current.style.transform=`translate(${x*0.2}px,${y*0.2}px)`;
  };
  const onLeave=()=>{ ref.current.style.transform='translate(0,0)'; };
  const Tag = href ? 'a' : 'button';
  return <Tag ref={ref} className={className} onMouseMove={onMove} onMouseLeave={onLeave}
    onClick={onClick} href={href}
    style={{transition:'transform 0.3s ease,background 0.2s',display:'inline-flex',alignItems:'center',gap:'10px'}}>
    {children}
  </Tag>;
}

// ── Counter animation ──────────────────────────────────────────────────────────
function AnimatedStat({ end, suffix='', label }) {
  const [val, setVal] = useState(0);
  const ref = useRef(null);
  useEffect(()=>{
    const obs = new IntersectionObserver(([e])=>{
      if (e.isIntersecting){
        let start=0;
        const isFloat = String(end).includes('.');
        const num = parseFloat(end);
        const step = num/60;
        const t=setInterval(()=>{
          start+=step;
          if(start>=num){start=num;clearInterval(t);}
          setVal(isFloat?start.toFixed(1):Math.floor(start));
        },16);
        obs.disconnect();
      }
    },{threshold:0.5});
    if(ref.current) obs.observe(ref.current);
    return()=>obs.disconnect();
  },[end]);

  return (
    <div ref={ref} style={{textAlign:'center'}}>
      <div style={{
        fontFamily:"'Anton',sans-serif",
        fontSize:'3.2rem',lineHeight:1,
        color:'#cc0000',
        textShadow:'0 0 40px #cc000033',
        letterSpacing:'-0.02em',
      }}>{val}{suffix}</div>
      <div style={{
        fontFamily:"'Barlow Condensed',sans-serif",fontWeight:400,
        fontSize:'0.72rem',letterSpacing:'0.25em',
        color:'#3a2020',marginTop:'6px',textTransform:'uppercase',
      }}>{label}</div>
    </div>
  );
}

// ── Reveal on scroll ───────────────────────────────────────────────────────────
function Reveal({ children, delay=0 }) {
  const ref = useRef(null);
  const [vis, setVis] = useState(false);
  useEffect(()=>{
    const obs=new IntersectionObserver(([e])=>{if(e.isIntersecting){setVis(true);obs.disconnect();}},{threshold:0.15});
    if(ref.current) obs.observe(ref.current);
    return()=>obs.disconnect();
  },[]);
  return <div ref={ref} style={{
    opacity:vis?1:0, transform:vis?'translateY(0)':'translateY(28px)',
    transition:`opacity 0.7s ease ${delay}s, transform 0.7s ease ${delay}s`,
  }}>{children}</div>;
}

// ── Typewriter ─────────────────────────────────────────────────────────────────
function Typewriter({ texts, speed=80, pause=2000 }) {
  const [display, setDisplay] = useState('');
  const [idx, setIdx]         = useState(0);
  const [typing, setTyping]   = useState(true);
  useEffect(()=>{
    let t;
    if (typing) {
      if (display.length < texts[idx].length) {
        t=setTimeout(()=>setDisplay(texts[idx].slice(0,display.length+1)),speed);
      } else {
        t=setTimeout(()=>setTyping(false),pause);
      }
    } else {
      if (display.length > 0) {
        t=setTimeout(()=>setDisplay(display.slice(0,-1)),speed/2);
      } else {
        setIdx(i=>(i+1)%texts.length); setTyping(true);
      }
    }
    return()=>clearTimeout(t);
  },[display,typing,idx,texts,speed,pause]);

  return <span>
    {display}
    <span style={{animation:'blink 1s step-end infinite',color:'#cc0000'}}>|</span>
  </span>;
}

// ══════════════════════════════════════════════════════════════════════════════
//  LANDING PAGE
// ══════════════════════════════════════════════════════════════════════════════
function LandingPage({ onEnter }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [exiting,  setExiting]  = useState(false);
  const [scrollY,  setScrollY]  = useState(0);

  useEffect(()=>{
    const onScroll=()=>setScrollY(window.scrollY);
    window.addEventListener('scroll',onScroll);
    return()=>window.removeEventListener('scroll',onScroll);
  },[]);

  const handleEnter=()=>{ setExiting(true); setTimeout(onEnter,380); };

  const navBg = scrollY > 40
    ? 'rgba(13,13,13,0.95)'
    : 'transparent';
  const navBorder = scrollY > 40
    ? '1px solid #4a3030'
    : '1px solid transparent';

  return (
    <div className={`scanlines ${exiting?'page-exit':'page-enter'}`}
      style={{minHeight:'100vh',background:'#0d0d0d'}}>

      {/* ── NAVBAR ────────────────────────────────────────────────────────── */}
      <nav style={{
        position:'fixed',top:0,left:0,right:0,zIndex:100,
        background:navBg,backdropFilter:'blur(14px)',
        borderBottom:navBorder,
        padding:'0 40px',height:'68px',
        display:'flex',alignItems:'center',justifyContent:'space-between',
        transition:'background 0.4s,border-color 0.4s',
      }}>
        <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
          <div style={{
            width:36,height:36,border:'1px solid #3a0000',
            display:'flex',alignItems:'center',justifyContent:'center',color:'#cc0000',
          }}><Ic.Shield/></div>
          <div>
            <div style={{
              fontFamily:"'Anton',sans-serif",
              fontSize:'1rem',letterSpacing:'0.15em',color:'#fff',lineHeight:1.1,
            }}>SENTINEL</div>
            <div style={{
              fontFamily:"'Share Tech Mono',monospace",
              fontSize:'0.45rem',letterSpacing:'0.2em',color:'#3a2020',
            }}>BORDER SURVEILLANCE</div>
          </div>
        </div>

        <div style={{display:'flex',alignItems:'center',gap:'36px'}}>
          {[['#about','ABOUT'],['#mission','MISSION'],['#system','SYSTEM']].map(([h,l])=>(
            <a key={h} href={h} className="nav-link">{l}</a>
          ))}
          <MagneticBtn className="cta-btn cta-primary" onClick={handleEnter}
            style={{padding:'8px 20px',fontSize:'0.75rem'}}>
            <span style={{display:'flex',alignItems:'center',gap:'8px',fontFamily:"'Barlow Condensed',sans-serif",fontWeight:800,fontSize:'0.75rem',letterSpacing:'0.2em'}}>
              LAUNCH SYSTEM <Ic.Arrow/>
            </span>
          </MagneticBtn>
        </div>
      </nav>

      {/* ── HERO ──────────────────────────────────────────────────────────── */}
      <section style={{
        minHeight:'100vh',display:'flex',alignItems:'center',
        justifyContent:'center',position:'relative',overflow:'hidden',
        paddingTop:'68px',
      }}>
        {/* Particle field */}
        <ParticleField/>

        {/* Background image */}
        <div style={{position:'absolute',inset:0,zIndex:0}}>
          <img
            src="https://picsum.photos/seed/border-mil/1920/1080?grayscale"
            alt=""
            style={{
              width:'100%',height:'100%',objectFit:'cover',
              opacity:0.08,
              transform:`translateY(${scrollY*0.3}px)`,
            }}
          />
          <div style={{
            position:'absolute',inset:0,
            background:'radial-gradient(ellipse at center bottom, #1a000033 0%, #0d0d0d 70%)',
          }}/>
        </div>

        {/* Grid lines */}
        <div style={{
          position:'absolute',inset:0,zIndex:1,
          backgroundImage:'linear-gradient(to right,#cc000008 1px,transparent 1px),linear-gradient(to bottom,#cc000008 1px,transparent 1px)',
          backgroundSize:'60px 60px',
          animation:'gridDrift 20s linear infinite',
        }}/>

        {/* Content */}
        <div style={{
          position:'relative',zIndex:3,
          maxWidth:'1100px',margin:'0 auto',padding:'0 40px',
          textAlign:'center',
        }}>
          {/* Status pill */}
          <div className="hero-1" style={{
            display:'inline-flex',alignItems:'center',gap:'8px',
            padding:'5px 16px',border:'1px solid #3a0000',
            background:'#cc00000a',marginBottom:'28px',
          }}>
            <div style={{
              width:5,height:5,borderRadius:'50%',background:'#cc0000',
              animation:'pulse-r 1.5s ease-in-out infinite',
            }}/>
            <span style={{
              fontFamily:"'Share Tech Mono',monospace",
              fontSize:'0.58rem',letterSpacing:'0.25em',color:'#cc4444',
            }}>SYSTEM ACTIVE · THREAT MONITORING ONLINE</span>
          </div>

          {/* MAIN HEADLINE — Anton font, massive, tight */}
          <h1 className="hero-2" style={{
            fontFamily:"'Anton',sans-serif",
            fontSize:'clamp(5rem,14vw,11rem)',
            letterSpacing:'-0.01em',
            lineHeight:0.9,
            color:'#fff',
            marginBottom:'4px',
            textShadow:'0 4px 60px rgba(0,0,0,0.8)',
          }}>
            ON THE WATCH
          </h1>

          {/* Second line — gradient fade like the image */}
          <h1 className="hero-3" style={{
            fontFamily:"'Anton',sans-serif",
            fontSize:'clamp(5rem,14vw,11rem)',
            letterSpacing:'-0.01em',
            lineHeight:0.9,
            marginBottom:'8px',
            background:'linear-gradient(180deg, #c8c0bc 0%, #4a3838 60%, #1a0f0f 100%)',
            WebkitBackgroundClip:'text',
            WebkitTextFillColor:'transparent',
          }}>
            AT YOUR
          </h1>

          <h1 className="hero-3" style={{
            fontFamily:"'Anton',sans-serif",
            fontSize:'clamp(5rem,14vw,11rem)',
            letterSpacing:'-0.01em',
            lineHeight:0.9,
            marginBottom:'40px',
            background:'linear-gradient(180deg, #8a7070 0%, #2a1010 80%, #0d0d0d 100%)',
            WebkitBackgroundClip:'text',
            WebkitTextFillColor:'transparent',
          }}>
            BORDERS
          </h1>

          {/* Typewriter subtext */}
          <div className="hero-4" style={{
            fontFamily:"'Barlow Condensed',sans-serif",fontWeight:300,
            fontSize:'1.15rem',letterSpacing:'0.05em',
            color:'#4a3030',marginBottom:'48px',minHeight:'2rem',
          }}>
            <Typewriter texts={[
              'Technological unit deploying AI-powered border defense.',
              'Real-time threat detection across all sectors.',
              'Zero intrusion. Zero compromise. Zero failure.',
              'Protecting perimeters with machine precision.',
            ]}/>
          </div>

          {/* CTAs */}
          <div className="hero-5" style={{display:'flex',gap:'14px',justifyContent:'center',flexWrap:'wrap'}}>
            <MagneticBtn className="cta-btn cta-primary" onClick={handleEnter}>
              <span style={{display:'flex',alignItems:'center',gap:'10px',fontFamily:"'Barlow Condensed',sans-serif",fontWeight:800,fontSize:'1rem',letterSpacing:'0.2em'}}>
                LAUNCH DETECTION SYSTEM <Ic.ArrowRight/>
              </span>
            </MagneticBtn>
            <MagneticBtn className="cta-btn cta-outline" href="#about">
              <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:'1rem',letterSpacing:'0.2em'}}>
                LEARN MORE
              </span>
            </MagneticBtn>
          </div>
        </div>

        {/* Scroll line */}
        <div style={{
          position:'absolute',bottom:'32px',left:'50%',transform:'translateX(-50%)',
          zIndex:4,display:'flex',flexDirection:'column',alignItems:'center',gap:'6px',
        }}>
          <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:'0.5rem',letterSpacing:'0.2em',color:'#4a3030'}}>SCROLL</div>
          <div style={{width:1,height:48,background:'linear-gradient(#cc0000,transparent)',animation:'pulse-r 2s ease-in-out infinite'}}/>
        </div>
      </section>

      {/* ── STATS BAR ─────────────────────────────────────────────────────── */}
      <div style={{borderTop:'1px solid #4a3030',borderBottom:'1px solid #4a3030',display:'grid',gridTemplateColumns:'repeat(4,1fr)'}}>
        {[
          ['99.7','%','Detection Accuracy'],
          ['50','ms','Response Time'],
          ['24','h','Active Monitoring'],
          ['360','°','Perimeter Coverage'],
        ].map(([n,s,l],i)=>(
          <div key={i} style={{
            padding:'36px 24px',
            borderRight:i<3?'1px solid #4a3030':'none',
          }}>
            <AnimatedStat end={n} suffix={s} label={l}/>
          </div>
        ))}
      </div>

      {/* ── ABOUT ─────────────────────────────────────────────────────────── */}
      <section id="about" style={{padding:'120px 40px',maxWidth:'1200px',margin:'0 auto'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'80px',alignItems:'center'}}>
          <div>
            <Reveal>
              <div className="section-tag">// 01 — ABOUT THE SYSTEM</div>
              <h2 style={{
                fontFamily:"'Anton',sans-serif",
                fontSize:'clamp(3rem,6vw,5.5rem)',
                letterSpacing:'-0.01em',lineHeight:0.88,
                color:'#fff',marginBottom:'32px',
              }}>
                MADE BY<br/>
                <span style={{
                  background:'linear-gradient(135deg,#cc0000,#660000)',
                  WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',
                }}>TEAM BOOMER</span>
              </h2>
            </Reveal>
            <Reveal delay={0.1}>
              <div style={{
                fontFamily:"'Barlow Condensed',sans-serif",fontWeight:300,
                fontSize:'1.05rem',lineHeight:1.8,
                color:'#4a3030',display:'flex',flexDirection:'column',gap:'16px',
              }}>
                <p>We are building a new architecture for border surveillance. Utilizing cutting-edge AI, computer vision, and real-time object tracking to secure perimeters with unprecedented accuracy.</p>
                <p>YOLOv8-powered detection engines with multi-zone threat classification, loitering detection, crowd surge analysis, and suspicious movement tracking — all in real-time.</p>
              </div>
            </Reveal>
          </div>

          <Reveal delay={0.15}>
            <div style={{position:'relative'}}>
              <Corners c='#3a000044' s={14}/>
              <img
                src="https://picsum.photos/seed/radar-mil/700/600?grayscale"
                alt=""
                style={{
                  width:'100%',display:'block',
                  opacity:0.35,filter:'contrast(1.3) brightness(0.8)',
                  transition:'opacity 0.6s',
                }}
                onMouseEnter={e=>e.target.style.opacity=0.75}
                onMouseLeave={e=>e.target.style.opacity=0.35}
              />
              <div style={{
                position:'absolute',top:'20px',left:'20px',right:'20px',bottom:'20px',
                border:'1px solid #cc000015',pointerEvents:'none',
              }}/>
              <div style={{
                position:'absolute',top:'28px',left:'28px',
                width:7,height:7,borderRadius:'50%',
                background:'#cc0000',animation:'pulse-r 2s ease-in-out infinite',
              }}/>
              {/* Corner label */}
              <div style={{
                position:'absolute',bottom:'20px',right:'20px',
                fontFamily:"'Share Tech Mono',monospace",
                fontSize:'0.52rem',letterSpacing:'0.15em',color:'#3a1010',
              }}>CAM-ALPHA // ACTIVE</div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── MISSION ───────────────────────────────────────────────────────── */}
      <section id="mission" style={{
        padding:'120px 40px',
        borderTop:'1px solid #4a3030',
        background:'#0a0808',
      }}>
        <div style={{maxWidth:'1200px',margin:'0 auto'}}>
          <Reveal>
            <div style={{textAlign:'center',marginBottom:'72px'}}>
              <div className="section-tag">// 02 — CORE DIRECTIVES</div>
              <h2 style={{
                fontFamily:"'Anton',sans-serif",
                fontSize:'clamp(3rem,7vw,5.5rem)',
                letterSpacing:'-0.01em',color:'#fff',
              }}>
                OUR CORE <span style={{color:'#4a3030'}}>VALUES</span>
              </h2>
            </div>
          </Reveal>

          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'1px',background:'#4a3030'}}>
            {[
              {Icon:Ic.Target, n:'01', title:'MISSION',
               desc:'To provide impenetrable border security through advanced AI-powered detection and rapid response systems that never sleep.'},
              {Icon:Ic.Eye, n:'02', title:'VISION',
               desc:'A future where borders are secured autonomously, minimizing human risk while maximizing detection accuracy and perimeter coverage.'},
              {Icon:Ic.Zap, n:'03', title:'GOAL',
               desc:'Deploy real-time AI surveillance across critical sectors, reducing intrusion incidents through intelligent multi-layer threat classification.'},
            ].map(({Icon,n,title,desc},i)=>(
              <Reveal key={i} delay={i*0.1}>
                <div className="feature-card" style={{background:'#0d0d0d'}}>
                  <div style={{
                    fontFamily:"'Anton',sans-serif",
                    fontSize:'3rem',letterSpacing:'0.05em',
                    color:'#4a3030',lineHeight:1,marginBottom:'16px',
                  }}>{n}</div>
                  <div style={{color:'#cc0000',marginBottom:'16px'}}><Icon/></div>
                  <div style={{
                    fontFamily:"'Anton',sans-serif",
                    fontSize:'1.4rem',letterSpacing:'0.1em',
                    color:'#c8c0bc',marginBottom:'14px',
                  }}>{title}</div>
                  <div style={{
                    fontFamily:"'Barlow Condensed',sans-serif",fontWeight:300,
                    fontSize:'0.95rem',lineHeight:1.7,color:'#3a2828',
                  }}>{desc}</div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── INTERACTIVE CTA ───────────────────────────────────────────────── */}
      <section id="system" style={{
        padding:'140px 40px',
        borderTop:'1px solid #4a3030',
        position:'relative',overflow:'hidden',
      }}>
        <div style={{
          position:'absolute',inset:0,
          backgroundImage:'linear-gradient(to right,#cc000006 1px,transparent 1px),linear-gradient(to bottom,#cc000006 1px,transparent 1px)',
          backgroundSize:'28px 28px',
        }}/>
        {/* Red glow */}
        <div style={{
          position:'absolute',top:'50%',left:'50%',
          transform:'translate(-50%,-50%)',
          width:'600px',height:'300px',
          background:'radial-gradient(ellipse,#cc000015 0%,transparent 70%)',
          pointerEvents:'none',
        }}/>

        <Reveal>
          <div style={{position:'relative',zIndex:1,maxWidth:'800px',margin:'0 auto',textAlign:'center'}}>
            <div className="section-tag">// 03 — DETECTION ENGINE</div>
            <h2 style={{
              fontFamily:"'Anton',sans-serif",
              fontSize:'clamp(3.5rem,9vw,7rem)',
              letterSpacing:'-0.01em',lineHeight:0.88,
              color:'#fff',marginBottom:'24px',
            }}>
              INTELLIGENCE<br/>
              <span style={{
                background:'linear-gradient(135deg,#cc0000,#880000)',
                WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',
              }}>THAT NEVER SLEEPS</span>
            </h2>
            <p style={{
              fontFamily:"'Barlow Condensed',sans-serif",fontWeight:300,
              fontSize:'1.1rem',lineHeight:1.7,
              color:'#4a3030',marginBottom:'52px',
            }}>
              Experience our real-time AI-powered threat detection dashboard. Draw restricted zones, set tripwires, monitor sectors, and receive instant threat alerts.
            </p>
            <MagneticBtn className="cta-btn cta-primary" onClick={handleEnter}
              style={{padding:'16px 44px',fontSize:'1.1rem'}}>
              <span style={{display:'flex',alignItems:'center',gap:'12px',fontFamily:"'Barlow Condensed',sans-serif",fontWeight:800,fontSize:'1.1rem',letterSpacing:'0.2em'}}>
                <Ic.Shield/> ACCESS DASHBOARD
              </span>
            </MagneticBtn>
          </div>
        </Reveal>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────────────── */}
      <footer style={{background:'#0a0808',borderTop:'1px solid #4a3030',padding:'80px 40px 40px'}}>
        <div style={{maxWidth:'1200px',margin:'0 auto',display:'grid',gridTemplateColumns:'2fr 1fr 1fr',gap:'60px',marginBottom:'60px'}}>
          <div>
            <div style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'20px'}}>
              <div style={{width:40,height:40,border:'1px solid #3a0000',display:'flex',alignItems:'center',justifyContent:'center',color:'#cc0000'}}><Ic.Shield/></div>
              <div>
                <div style={{fontFamily:"'Anton',sans-serif",fontSize:'1rem',letterSpacing:'0.15em',color:'#fff'}}>SENTINEL</div>
                <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:'0.45rem',letterSpacing:'0.2em',color:'#4a3030'}}>BORDER SURVEILLANCE AI</div>
              </div>
            </div>
            <p style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:300,fontSize:'0.9rem',lineHeight:1.7,color:'#4a3030',maxWidth:'260px'}}>
              Advanced AI-powered border surveillance. Real-time threat detection and perimeter monitoring.
            </p>
          </div>
          <div>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:'0.85rem',letterSpacing:'0.2em',color:'#8a7070',marginBottom:'24px'}}>NAVIGATION</div>
            {[['#about','About Us'],['#mission','Mission'],['#system','Detection'],].map(([h,l])=>(
              <div key={h} style={{marginBottom:'12px'}}>
                <a href={h} style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:'0.9rem',color:'#4a3030',textDecoration:'none',transition:'color 0.2s',cursor:'none'}}
                  onMouseEnter={e=>e.target.style.color='#cc4444'}
                  onMouseLeave={e=>e.target.style.color='#4a3030'}
                >{l}</a>
              </div>
            ))}
          </div>
          <div>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:'0.85rem',letterSpacing:'0.2em',color:'#8a7070',marginBottom:'24px'}}>CONTACT</div>
            {[[<Ic.Mail/>,'contact@sentinel-ai.in'],[<Ic.Pin/>,'Command Center Alpha']].map(([icon,text],i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'12px',color:'#4a3030',fontFamily:"'Barlow Condensed',sans-serif",fontSize:'0.9rem'}}>{icon}{text}</div>
            ))}
          </div>
        </div>
        <div style={{maxWidth:'1200px',margin:'0 auto',borderTop:'1px solid #4a3030',paddingTop:'24px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:'0.5rem',letterSpacing:'0.15em',color:'#4a3030'}}>
            © {new Date().getFullYear()} SENTINEL BORDER SURVEILLANCE AI. ALL RIGHTS RESERVED.
          </div>
          <div style={{display:'flex',gap:'20px'}}>
            {['Privacy Policy','Terms of Service'].map(t=>(
              <a key={t} href="#" style={{fontFamily:"'Share Tech Mono',monospace",fontSize:'0.5rem',letterSpacing:'0.1em',color:'#4a3030',textDecoration:'none',cursor:'none'}}
                onMouseEnter={e=>e.target.style.color='#3a2020'}
                onMouseLeave={e=>e.target.style.color='#4a3030'}
              >{t}</a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════════════════════════════════════════
function PanelC({ c='#cc0000', s=10 }) {
  const b={position:'absolute',width:s,height:s,borderColor:c,borderStyle:'solid'};
  return <>
    <div style={{...b,top:0,left:0,   borderWidth:'1px 0 0 1px'}}/>
    <div style={{...b,top:0,right:0,  borderWidth:'1px 1px 0 0'}}/>
    <div style={{...b,bottom:0,left:0,borderWidth:'0 0 1px 1px'}}/>
    <div style={{...b,bottom:0,right:0,borderWidth:'0 1px 1px 0'}}/>
  </>;
}
function SLabel({ children }) {
  return (
    <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:600,fontSize:'0.62rem',letterSpacing:'0.2em',color:'#3a2020',textTransform:'uppercase',display:'flex',alignItems:'center',gap:'8px',marginBottom:'10px'}}>
      <span style={{width:5,height:5,borderRadius:'50%',background:'#cc0000',display:'inline-block',animation:'pulse-r 2s ease-in-out infinite',flexShrink:0}}/>
      {children}
    </div>
  );
}
function ThreatLvl({ level }) {
  const color = THREAT_COLORS[level]||'#cc0000';
  return (
    <div style={{display:'inline-flex',alignItems:'center',gap:'6px',padding:'3px 10px',border:`1px solid ${color}`,background:`${color}11`,fontFamily:"'Anton',sans-serif",fontSize:'0.8rem',letterSpacing:'0.15em',color,animation:level==='HIGH'?'pulse-r 0.8s ease-in-out infinite':'none'}}>
      <span style={{width:5,height:5,borderRadius:'50%',background:color}}/>
      {level}
    </div>
  );
}
function StatB({ label, value, color='#cc0000' }) {
  return (
    <div style={{background:'rgba(10,8,8,0.95)',border:'1px solid #4a3030',position:'relative',overflow:'hidden',padding:'14px 16px',borderLeft:`2px solid ${color}`}}>
      <PanelC c={color} s={6}/>
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:'2.4rem',color,lineHeight:1,textShadow:`0 0 20px ${color}44`}}>{value}</div>
      <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:600,fontSize:'0.62rem',letterSpacing:'0.2em',color:'#3a2020',marginTop:'4px'}}>{label}</div>
    </div>
  );
}
function ZRow({ zone }) {
  const color=THREAT_COLORS[zone.threat]||'#cc0000';
  return (
    <div className={zone.threat==='HIGH'?'high-threat':''} style={{padding:'8px 12px',borderBottom:'1px solid #100808',borderLeft:`2px solid ${color}`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
      <div>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:'0.85rem',color:'#c8baba',letterSpacing:'0.05em'}}>{zone.name}</div>
        <div style={{fontSize:'0.6rem',color:'#4a3030',marginTop:'2px',letterSpacing:'0.1em'}}>{zone.persons} PERSONS · {zone.vehicles} VEHICLES</div>
      </div>
      <ThreatLvl level={zone.threat}/>
    </div>
  );
}
function AEntry({ alert, index }) {
  return (
    <div className="alert-row" style={{padding:'6px 12px',borderBottom:'1px solid #0c0808',display:'flex',gap:'10px',alignItems:'flex-start',opacity:Math.max(1-index*0.08,0.25),background:index===0?'rgba(204,0,0,0.04)':'transparent'}}>
      <span style={{color:'#4a3030',fontSize:'0.58rem',whiteSpace:'nowrap',marginTop:'1px'}}>{alert.time}</span>
      <span style={{color:index===0?'#cc4444':'#5a3030',fontSize:'0.67rem',lineHeight:1.4}}>{alert.msg}</span>
    </div>
  );
}
function CTip({ active, payload, label }) {
  if (!active||!payload?.length) return null;
  return (
    <div style={{background:'#0a0808',border:'1px solid #4a3030',padding:'8px 12px',fontFamily:"'Share Tech Mono',monospace",fontSize:'0.62rem'}}>
      <div style={{color:'#4a3030',marginBottom:'4px'}}>{label}</div>
      {payload.map((p,i)=><div key={i} style={{color:p.color}}>{p.name.toUpperCase()}: {typeof p.value==='number'?p.value.toFixed(1):p.value}</div>)}
    </div>
  );
}
function DrawOverlay({ setupDone, onStart }) {
  const [dm,  setDm]  = useState('zone');
  const [cp,  setCp]  = useState([]);
  const [tp,  setTp]  = useState([]);
  const [dz,  setDz]  = useState([]);
  const [dw,  setDw]  = useState([]);
  const [zc,  setZc]  = useState(1);
  const [wc,  setWc]  = useState(1);
  const cr = useRef(null);
  useEffect(()=>{
    if(!cr.current) return;
    const cv=cr.current,ctx=cv.getContext('2d');
    ctx.clearRect(0,0,cv.width,cv.height);
    dz.forEach(z=>{
      if(z.points.length<2) return;
      ctx.beginPath(); ctx.moveTo(z.points[0][0],z.points[0][1]);
      z.points.forEach(p=>ctx.lineTo(p[0],p[1]));
      ctx.closePath();
      ctx.fillStyle='rgba(204,0,0,0.07)'; ctx.strokeStyle='#cc0000'; ctx.lineWidth=1.5;
      ctx.fill(); ctx.stroke();
      const cx=z.points.reduce((s,p)=>s+p[0],0)/z.points.length;
      const cy=z.points.reduce((s,p)=>s+p[1],0)/z.points.length;
      ctx.fillStyle='#cc0000'; ctx.font="bold 12px 'Share Tech Mono',monospace"; ctx.fillText(z.name,cx-20,cy);
    });
    dw.forEach(w=>{
      ctx.beginPath(); ctx.moveTo(w.p1[0],w.p1[1]); ctx.lineTo(w.p2[0],w.p2[1]);
      ctx.strokeStyle='#882200'; ctx.lineWidth=1.5; ctx.setLineDash([4,4]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle='#882200'; ctx.font="10px 'Share Tech Mono',monospace";
      ctx.fillText(w.name,(w.p1[0]+w.p2[0])/2+5,(w.p1[1]+w.p2[1])/2-5);
    });
    if(dm==='zone'&&cp.length>0){
      ctx.beginPath(); ctx.moveTo(cp[0][0],cp[0][1]);
      cp.forEach(p=>ctx.lineTo(p[0],p[1]));
      ctx.strokeStyle='rgba(204,0,0,0.5)'; ctx.lineWidth=1; ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]);
      cp.forEach((p,i)=>{ctx.beginPath();ctx.arc(p[0],p[1],3,0,Math.PI*2);ctx.fillStyle='#cc0000';ctx.fill();ctx.fillStyle='rgba(204,0,0,0.7)';ctx.font="9px 'Share Tech Mono'";ctx.fillText(i+1,p[0]+5,p[1]-3);});
    }
    if(dm==='tripwire'&&tp.length>0){
      tp.forEach(p=>{ctx.beginPath();ctx.arc(p[0],p[1],4,0,Math.PI*2);ctx.strokeStyle='#882200';ctx.lineWidth=1.5;ctx.stroke();});
      if(tp.length===2){ctx.beginPath();ctx.moveTo(tp[0][0],tp[0][1]);ctx.lineTo(tp[1][0],tp[1][1]);ctx.strokeStyle='#882200';ctx.lineWidth=1.5;ctx.setLineDash([4,4]);ctx.stroke();ctx.setLineDash([]);}
    }
  },[cp,tp,dz,dw,dm]);
  const onClick=useCallback(e=>{
    if(setupDone) return;
    const r=cr.current.getBoundingClientRect();
    const x=Math.round((e.clientX-r.left)*(1280/r.width));
    const y=Math.round((e.clientY-r.top)*(720/r.height));
    if(dm==='zone') setCp(p=>[...p,[x,y]]);
    else setTp(p=>p.length<2?[...p,[x,y]]:p);
  },[dm,setupDone]);
  const saveZone=async()=>{
    if(cp.length<3) return;
    const name=`SECTOR-${String.fromCharCode(64+zc)}`;
    await fetch(`${API_URL}/add_zone`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,points:cp})});
    setDz(p=>[...p,{name,points:cp}]); setCp([]); setZc(c=>c+1);
  };
  const saveWire=async()=>{
    if(tp.length<2) return;
    const name=`WIRE-${wc}`;
    await fetch(`${API_URL}/add_tripwire`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,p1:tp[0],p2:tp[1]})});
    setDw(p=>[...p,{name,p1:tp[0],p2:tp[1]}]); setTp([]); setWc(c=>c+1);
  };
  if(setupDone) return null;
  const tb={fontFamily:"'Share Tech Mono',monospace",fontSize:'0.6rem',letterSpacing:'0.15em',padding:'4px 10px',border:'1px solid',background:'transparent',cursor:'pointer'};
  return <>
    <canvas ref={cr} width={1280} height={720} onClick={onClick} style={{position:'absolute',inset:0,width:'100%',height:'100%',cursor:'crosshair',zIndex:10}}/>
    <div style={{position:'absolute',bottom:0,left:0,right:0,zIndex:20,background:'rgba(0,0,0,0.92)',borderTop:'1px solid #4a3030',padding:'8px 16px',display:'flex',gap:'8px',alignItems:'center'}}>
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:'0.75rem',letterSpacing:'0.2em',color:'#4a3030',marginRight:'4px'}}>DRAW</div>
      {[['zone','ZONE','#cc0000'],['tripwire','WIRE','#882200']].map(([mode,label,c])=>(
        <button key={mode} onClick={()=>{setDm(mode);if(mode==='zone')setTp([]);else setCp([]);}} style={{...tb,borderColor:dm===mode?c:'#4a3030',background:dm===mode?`${c}15`:'transparent',color:dm===mode?c:'#4a3030'}}>{label}</button>
      ))}
      <div style={{width:'1px',height:'16px',background:'#4a3030',margin:'0 4px'}}/>
      {dm==='zone'&&<>
        <button onClick={saveZone} style={{...tb,borderColor:'#cc000033',color:'#cc0000'}}>SAVE ZONE ({cp.length}pts)</button>
        <button onClick={()=>setCp(p=>p.slice(0,-1))} style={{...tb,borderColor:'#4a3030',color:'#4a3030'}}>UNDO</button>
        <button onClick={()=>setCp([])} style={{...tb,borderColor:'#4a3030',color:'#4a3030'}}>CLR</button>
      </>}
      {dm==='tripwire'&&<>
        <button onClick={saveWire} style={{...tb,borderColor:'#88220033',color:'#882200'}}>SAVE WIRE ({tp.length}/2)</button>
        <button onClick={()=>setTp([])} style={{...tb,borderColor:'#4a3030',color:'#4a3030'}}>CLR</button>
      </>}
      <span style={{marginLeft:'auto',fontSize:'0.58rem',color:'#4a3030',letterSpacing:'0.1em'}}>{dz.length} ZONES · {dw.length} WIRES</span>
      <button onClick={onStart} style={{fontFamily:"'Anton',sans-serif",fontSize:'0.85rem',letterSpacing:'0.2em',padding:'5px 20px',border:'1px solid #cc0000',background:'#cc0000',color:'#000',cursor:'pointer',fontWeight:'bold'}}>INITIATE</button>
    </div>
    {dz.length===0&&dw.length===0&&(
      <div style={{position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',textAlign:'center',pointerEvents:'none',zIndex:5}}>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:'1.2rem',letterSpacing:'0.3em',color:'rgba(204,0,0,0.25)',marginBottom:'8px'}}>DEFINE RESTRICTED ZONES</div>
        <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:'0.62rem',letterSpacing:'0.15em',color:'rgba(255,255,255,0.08)'}}>CLICK TO ADD BOUNDARY POINTS</div>
      </div>
    )}
  </>;
}

function Dashboard({ onBack }) {
  const [frame,     setFrame]     = useState(null);
  const [alerts,    setAlerts]    = useState([]);
  const [zones,     setZones]     = useState([]);
  const [persons,   setPersons]   = useState(0);
  const [vehicles,  setVehicles]  = useState(0);
  const [night,     setNight]     = useState(false);
  const [surge,     setSurge]     = useState(false);
  const [modes,     setModes]     = useState({loitering:true,night:true,surge:true});
  const [connected, setConnected] = useState(false);
  const [setupDone, setSetupDone] = useState(false);
  const [graphTab,  setGraphTab]  = useState('RT');
  const [realtimeH, setRealtimeH] = useState([]);
  const [perSecH,   setPerSecH]   = useState([]);
  const [per10sH,   setPer10sH]   = useState([]);

  const wsRef=useRef(null), prev=useRef([]), sb=useRef([]), s10=useRef([]), lt=useRef(0), l10=useRef(0);

  useEffect(()=>{
    function connect(){
      const ws=new WebSocket(WS_URL); wsRef.current=ws;
      ws.onopen=()=>setConnected(true);
      ws.onclose=()=>{setConnected(false);setTimeout(connect,2000);};
      ws.onmessage=e=>{
        const d=JSON.parse(e.data);
        if(d.frame)  setFrame(`data:image/jpeg;base64,${d.frame}`);
        if(d.alerts) setAlerts(d.alerts);
        if(d.zones)  setZones(d.zones);
        if(d.total_persons !==undefined) setPersons(d.total_persons);
        if(d.total_vehicles!==undefined) setVehicles(d.total_vehicles);
        if(d.night  !==undefined) setNight(d.night);
        if(d.surge  !==undefined) setSurge(d.surge);
        if(d.modes)  setModes(d.modes);
        if(d.setup_done!==undefined) setSetupDone(d.setup_done);
        const now=Date.now();
        const maxT=(d.zones||[]).reduce((a,z)=>Math.max(a,threatToScore(z.threat||'LOW')),1);
        const hasAlert=(d.alerts||[]).length>prev.current.length;
        prev.current=d.alerts||[];
        const entry={t:new Date().toLocaleTimeString(),persons:d.total_persons||0,vehicles:d.total_vehicles||0,threat:maxT,spike:hasAlert?4:null,ts:now};
        setRealtimeH(p=>[...p,entry].slice(-60));
        sb.current.push(entry); s10.current.push(entry);
        if(now-lt.current>=1000){
          const b=sb.current;
          if(b.length) setPerSecH(p=>[...p,{t:new Date().toLocaleTimeString(),persons:b.reduce((s,x)=>s+x.persons,0)/b.length,vehicles:b.reduce((s,x)=>s+x.vehicles,0)/b.length,threat:Math.max(...b.map(x=>x.threat)),spike:b.some(x=>x.spike)?4:null}].slice(-60));
          sb.current=[]; lt.current=now;
        }
        if(now-l10.current>=10000){
          const b=s10.current;
          if(b.length) setPer10sH(p=>[...p,{t:new Date().toLocaleTimeString(),persons:b.reduce((s,x)=>s+x.persons,0)/b.length,vehicles:b.reduce((s,x)=>s+x.vehicles,0)/b.length,threat:Math.max(...b.map(x=>x.threat)),spike:b.some(x=>x.spike)?4:null}].slice(-30));
          s10.current=[]; l10.current=now;
        }
      };
    }
    connect();
    return()=>wsRef.current?.close();
  },[]);

  const startDetection=async()=>{await fetch(`${API_URL}/start_detection`,{method:'POST'});setSetupDone(true);};
  const stopDetection=async()=>{
    await fetch(`${API_URL}/stop_detection`,{method:'POST'});
    setSetupDone(false);setRealtimeH([]);setPerSecH([]);setPer10sH([]);
    setAlerts([]);setZones([]);setPersons(0);setVehicles(0);prev.current=[];
  };
  const toggleMode=async m=>{
    const v=!modes[m];
    await fetch(`${API_URL}/set_mode`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m,value:v})});
    setModes(p=>({...p,[m]:v}));
  };

  const ht=zones.reduce((a,z)=>{if(z.threat==='HIGH')return'HIGH';if(z.threat==='MEDIUM'&&a!=='HIGH')return'MEDIUM';return a;},'LOW');
  const tc=THREAT_COLORS[ht];
  const gd=graphTab==='RT'?realtimeH:graphTab==='1M'?perSecH:per10sH;

  return (
    <div className="scanlines page-enter" style={{minHeight:'100vh',padding:'12px',background:'#0d0d0d',display:'grid',gridTemplateRows:'auto 1fr auto',gap:'10px',fontFamily:"'Share Tech Mono',monospace"}}>
      <header style={{display:'flex',justifyContent:'space-between',alignItems:'center',borderBottom:`1px solid ${tc}22`,paddingBottom:'10px',position:'relative'}}>
        <div style={{display:'flex',alignItems:'center',gap:'20px'}}>
          <button onClick={onBack} style={{fontFamily:"'Share Tech Mono',monospace",fontSize:'0.58rem',letterSpacing:'0.15em',padding:'4px 10px',border:'1px solid #4a3030',background:'transparent',color:'#4a3030',cursor:'pointer',display:'flex',alignItems:'center',gap:'6px'}}>← BACK</button>
          <div style={{position:'relative'}}>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:'2rem',letterSpacing:'0.15em',color:'#fff',lineHeight:1}}>SENTINEL</div>
            <div style={{position:'absolute',inset:0,fontFamily:"'Anton',sans-serif",fontSize:'2rem',letterSpacing:'0.15em',color:'#cc0000',lineHeight:1,opacity:0.3,animation:'glitch 4s infinite',userSelect:'none',pointerEvents:'none'}}>SENTINEL</div>
          </div>
          <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:'0.65rem',letterSpacing:'0.3em',color:'#4a3030',fontWeight:300}}>BORDER SURVEILLANCE SYSTEM</div>
        </div>
        <div style={{position:'absolute',left:'50%',transform:'translateX(-50%)',display:'flex',flexDirection:'column',alignItems:'center',gap:'4px'}}>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:'0.65rem',letterSpacing:'0.3em',color:'#4a3030'}}>THREAT STATUS</div>
          <ThreatLvl level={ht}/>
        </div>
        <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
          {[['loitering','L'],['night','N'],['surge','S']].map(([m,l])=>(
            <button key={m} onClick={()=>toggleMode(m)} style={{fontFamily:"'Share Tech Mono',monospace",fontSize:'0.6rem',letterSpacing:'0.15em',padding:'3px 9px',border:`1px solid ${modes[m]?'#cc000044':'#4a3030'}`,background:modes[m]?'#cc000011':'transparent',color:modes[m]?'#cc4444':'#4a3030',cursor:'pointer'}}>{l}</button>
          ))}
          <div style={{width:'1px',height:'16px',background:'#4a3030'}}/>
          {setupDone&&<button onClick={stopDetection} style={{fontFamily:"'Share Tech Mono',monospace",fontSize:'0.6rem',letterSpacing:'0.15em',padding:'3px 10px',border:'1px solid #cc000066',background:'#cc000011',color:'#cc4444',cursor:'pointer'}}>HALT</button>}
          <div style={{display:'flex',alignItems:'center',gap:'5px'}}>
            <div style={{width:6,height:6,borderRadius:'50%',background:connected?'#cc3300':'#cc0000',animation:'pulse-r 1.5s ease-in-out infinite'}}/>
            <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:600,fontSize:'0.62rem',letterSpacing:'0.2em',color:connected?'#cc3300':'#cc0000'}}>{connected?'LIVE':'OFFLINE'}</span>
          </div>
        </div>
      </header>

      <main style={{display:'grid',gridTemplateColumns:'1fr 260px',gap:'10px',minHeight:0}}>
        <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
          <div style={{background:'rgba(10,8,8,0.95)',border:`1px solid ${setupDone?tc+'44':'#4a3030'}`,position:'relative',flex:'1 1 auto',overflow:'hidden'}}>
            <PanelC c={setupDone?tc:'#4a3030'} s={12}/>
            <div style={{position:'absolute',top:0,left:0,right:0,zIndex:30,background:'linear-gradient(180deg,rgba(0,0,0,0.8) 0%,transparent 100%)',padding:'8px 12px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                <div style={{width:6,height:6,borderRadius:'50%',background:'#cc0000',animation:'pulse-r 1s ease-in-out infinite'}}/>
                <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:600,fontSize:'0.62rem',letterSpacing:'0.2em',color:'#cc0000'}}>REC</span>
                <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:'0.58rem',color:'#4a3030',marginLeft:'8px'}}>CAM-01 // ACTIVE</span>
              </div>
              {setupDone&&<ThreatLvl level={ht}/>}
            </div>
            {frame
              ? <img src={frame} alt="feed" style={{width:'100%',display:'block',minHeight:'300px',objectFit:'cover'}}/>
              : <div style={{minHeight:'340px',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:'12px'}}>
                  <div style={{width:40,height:40,border:'1px solid #cc000033',borderTop:'1px solid #cc0000',borderRadius:'50%',animation:'spin 1s linear infinite'}}/>
                  <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:'0.65rem',letterSpacing:'0.2em',color:'#4a3030'}}>INITIALIZING FEED...</div>
                </div>
            }
            <DrawOverlay setupDone={setupDone} onStart={startDetection}/>
            <div style={{position:'absolute',bottom:0,left:0,right:0,height:'2px',background:`linear-gradient(90deg,transparent,${tc},transparent)`,opacity:0.4}}/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'8px'}}>
            <StatB label="PERSONS"  value={persons}       color="#cc0000"/>
            <StatB label="VEHICLES" value={vehicles}      color="#882200"/>
            <StatB label="ZONES"    value={zones.length}  color="#cc0000"/>
            <StatB label="ALERTS"   value={alerts.length} color="#882200"/>
          </div>
          <div style={{background:'rgba(10,8,8,0.95)',border:'1px solid #4a3030',position:'relative',padding:'12px'}}>
            <PanelC c='#4a3030' s={8}/>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'10px'}}>
              <SLabel>ACTIVITY MONITOR</SLabel>
              <div style={{display:'flex',gap:'4px'}}>
                {[['RT','RT'],['1M','1M'],['5M','5M']].map(([k,l])=>(
                  <button key={k} onClick={()=>setGraphTab(k)} style={{fontFamily:"'Share Tech Mono',monospace",fontSize:'0.55rem',letterSpacing:'0.15em',padding:'2px 7px',border:`1px solid ${graphTab===k?'#cc000044':'#4a3030'}`,background:graphTab===k?'#cc000011':'transparent',color:graphTab===k?'#cc4444':'#4a3030',cursor:'pointer'}}>{l}</button>
                ))}
              </div>
            </div>
            <div style={{height:'1px',background:'linear-gradient(90deg,#cc000033,transparent)',marginBottom:'10px'}}/>
            {gd.length>0
              ? <ResponsiveContainer width="100%" height={130}>
                  <AreaChart data={gd} margin={{top:4,right:4,bottom:0,left:0}}>
                    <defs>
                      <linearGradient id="gP" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#cc0000" stopOpacity={0.3}/><stop offset="100%" stopColor="#cc0000" stopOpacity={0}/></linearGradient>
                      <linearGradient id="gV" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#882200" stopOpacity={0.2}/><stop offset="100%" stopColor="#882200" stopOpacity={0}/></linearGradient>
                      <linearGradient id="gT" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ffffff" stopOpacity={0.08}/><stop offset="100%" stopColor="#ffffff" stopOpacity={0}/></linearGradient>
                    </defs>
                    <XAxis dataKey="t" hide/>
                    <YAxis width={24} tick={{fill:'#4a3030',fontSize:8,fontFamily:"'Share Tech Mono'"}} axisLine={false} tickLine={false} ticks={[0,1,2,3,4]} tickFormatter={v=>['','L','M','H','!'][v]||v}/>
                    <Tooltip content={<CTip/>}/>
                    <Area type="monotone" dataKey="persons" stroke="#cc0000" strokeWidth={1.5} fill="url(#gP)" dot={false} name="persons"/>
                    <Area type="monotone" dataKey="vehicles" stroke="#882200" strokeWidth={1.5} fill="url(#gV)" dot={false} name="vehicles"/>
                    <Area type="stepAfter" dataKey="threat" stroke="#ffffff" strokeWidth={1} strokeOpacity={0.15} fill="url(#gT)" dot={false} name="threat" strokeDasharray="2 3"/>
                    <Area type="monotone" dataKey="spike" stroke="#cc0000" strokeWidth={2} strokeOpacity={0.8} fill="none" dot={false} name="alert" connectNulls={false}/>
                  </AreaChart>
                </ResponsiveContainer>
              : <div style={{height:'130px',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Share Tech Mono',monospace",fontSize:'0.6rem',letterSpacing:'0.2em',color:'#4a3030'}}>AWAITING SIGNAL</div>
            }
          </div>
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
          <div style={{background:'rgba(10,8,8,0.95)',border:'1px solid #4a3030',position:'relative',padding:'12px'}}>
            <PanelC c='#4a3030' s={6}/>
            <SLabel>ACTIVE MODULES</SLabel>
            <div style={{height:'1px',background:'linear-gradient(90deg,#cc000033,transparent)',marginBottom:'10px'}}/>
            {[['LOITER DETECT','loitering'],['NIGHT VISION','night'],['SURGE DETECT','surge']].map(([label,mode])=>(
              <div key={mode} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 0',borderBottom:'1px solid #0c0808'}}>
                <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:600,fontSize:'0.72rem',letterSpacing:'0.1em',color:'#4a2828'}}>{label}</span>
                <div style={{width:28,height:14,borderRadius:'7px',cursor:'pointer',background:modes[mode]?'#cc000033':'#0a0808',border:`1px solid ${modes[mode]?'#cc0000':'#4a3030'}`,position:'relative',transition:'all 0.2s'}} onClick={()=>toggleMode(mode)}>
                  <div style={{position:'absolute',top:2,left:modes[mode]?'calc(100% - 11px)':2,width:8,height:8,borderRadius:'50%',background:modes[mode]?'#cc0000':'#4a3030',transition:'left 0.2s'}}/>
                </div>
              </div>
            ))}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px',marginTop:'10px'}}>
              {[['NIGHT',night],['SURGE',surge]].map(([l,a])=>(
                <div key={l} style={{padding:'6px',textAlign:'center',border:`1px solid ${a?'#cc000033':'#100808'}`,background:a?'#cc000008':'transparent'}}>
                  <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:'0.55rem',letterSpacing:'0.15em',color:a?'#cc4444':'#4a3030'}}>{l}</div>
                  <div style={{fontFamily:"'Anton',sans-serif",fontSize:'0.75rem',letterSpacing:'0.1em',color:a?'#cc0000':'#4a3030',animation:a?'pulse-r 1s ease-in-out infinite':'none'}}>{a?'ACTIVE':'CLEAR'}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{background:'rgba(10,8,8,0.95)',border:'1px solid #4a3030',position:'relative',overflow:'hidden'}}>
            <PanelC c='#4a3030' s={6}/>
            <div style={{padding:'12px 12px 8px'}}><SLabel>RESTRICTED ZONES</SLabel></div>
            <div style={{height:'1px',background:'linear-gradient(90deg,#cc000033,transparent)'}}/>
            <div style={{maxHeight:'200px',overflowY:'auto'}}>
              {zones.length===0
                ? <div style={{padding:'20px',textAlign:'center',fontFamily:"'Share Tech Mono',monospace",fontSize:'0.6rem',letterSpacing:'0.15em',color:'#4a3030'}}>{setupDone?'NO ZONES':'DEFINE ZONES ON FEED'}</div>
                : zones.map((z,i)=><ZRow key={i} zone={z}/>)
              }
            </div>
          </div>

          <div style={{background:'rgba(10,8,8,0.95)',border:'1px solid #4a3030',position:'relative',flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
            <PanelC c='#4a3030' s={6}/>
            <div style={{padding:'12px 12px 8px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <SLabel>ALERT LOG</SLabel>
              {alerts.length>0&&<span style={{fontFamily:"'Anton',sans-serif",fontSize:'0.75rem',letterSpacing:'0.1em',color:'#cc0000',animation:'pulse-r 2s ease-in-out infinite'}}>{alerts.length} EVENTS</span>}
            </div>
            <div style={{height:'1px',background:'linear-gradient(90deg,#cc000033,transparent)'}}/>
            <div style={{overflowY:'auto',flex:1,maxHeight:'300px'}}>
              {alerts.length===0
                ? <div style={{padding:'20px',textAlign:'center',fontFamily:"'Share Tech Mono',monospace",fontSize:'0.6rem',letterSpacing:'0.15em',color:'#4a3030'}}>NO EVENTS RECORDED</div>
                : [...alerts].reverse().map((a,i)=><AEntry key={i} alert={a} index={i}/>)
              }
            </div>
          </div>
        </div>
      </main>

      <footer style={{borderTop:'1px solid #4a3030',paddingTop:'8px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:'0.55rem',letterSpacing:'0.2em',color:'#4a3030'}}>SENTINEL v2.0 // RESTRICTED ACCESS // AUTHORIZED PERSONNEL ONLY</div>
        <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:'0.55rem',letterSpacing:'0.15em',color:'#4a3030',display:'flex',gap:'16px'}}>
          <span>P:{persons} V:{vehicles}</span>
          <span style={{animation:'blink 1s step-end infinite',color:'#cc000033'}}>█</span>
          <span>{new Date().toLocaleTimeString()}</span>
        </div>
      </footer>
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState('landing');
  return <>
    <CustomCursor/>
    {page==='landing'
      ? <LandingPage onEnter={()=>setPage('dashboard')}/>
      : <Dashboard   onBack={()=>setPage('landing')}/>
    }
  </>;
}
