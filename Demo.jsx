import React, { useState, useEffect, useMemo } from 'react';
import { Search, Settings, ChevronLeft, ChevronRight, FileText, Sun, Cloud, CloudRain, Moon, Monitor, Zap, Database, Table, Columns, AlignLeft, Binary, Star, Folder, Plus, ArrowDownAZ } from 'lucide-react';

const App = () => {
  // 控制状态
  const [weather, setWeather] = useState('lightRain'); // 'sunny', 'cloudy', 'lightRain', 'heavyRain'
  const [time, setTime] = useState(14); // 0.0 - 24.0
  const [quality, setQuality] = useState('high'); // 'high', 'low'

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-8 bg-slate-200 font-sans text-slate-800">
      
      {/* 外部调试控制台 (仅用于演示，不属于软件界面) */}
      <div className="absolute top-6 flex flex-col items-center gap-4 z-50 bg-white/80 p-4 rounded-2xl shadow-lg backdrop-blur-md border border-slate-200">
        <div className="flex gap-4 items-center">
          <span className="text-sm font-bold text-slate-600">天气:</span>
          <div className="flex gap-2">
            <button onClick={() => setWeather('sunny')} className={`p-2 rounded-lg transition-all ${weather === 'sunny' ? 'bg-orange-100 text-orange-600 shadow-sm' : 'hover:bg-slate-100 text-slate-400'}`} title="晴天"><Sun size={20}/></button>
            <button onClick={() => setWeather('cloudy')} className={`p-2 rounded-lg transition-all ${weather === 'cloudy' ? 'bg-slate-200 text-slate-600 shadow-sm' : 'hover:bg-slate-100 text-slate-400'}`} title="多云"><Cloud size={20}/></button>
            <button onClick={() => setWeather('lightRain')} className={`p-2 rounded-lg transition-all ${weather === 'lightRain' ? 'bg-blue-100 text-blue-500 shadow-sm' : 'hover:bg-slate-100 text-slate-400'}`} title="小雨"><CloudRain size={20}/></button>
            <button onClick={() => setWeather('heavyRain')} className={`p-2 rounded-lg transition-all ${weather === 'heavyRain' ? 'bg-blue-200 text-blue-700 shadow-sm' : 'hover:bg-slate-100 text-slate-400'}`} title="大雨"><div className="relative"><CloudRain size={20}/><CloudRain size={20} className="absolute top-1 left-1 opacity-50"/></div></button>
          </div>
          
          <div className="w-px h-6 bg-slate-300 mx-2"></div>
          
          <span className="text-sm font-bold text-slate-600">画质:</span>
          <button onClick={() => setQuality(q => q === 'high' ? 'low' : 'high')} className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm transition-all ${quality === 'high' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
            {quality === 'high' ? <Monitor size={16}/> : <Zap size={16}/>}
            {quality === 'high' ? '高画质' : '流畅优先'}
          </button>
        </div>

        <div className="flex items-center gap-4 w-full px-2">
          <Moon size={16} className="text-slate-400" />
          <input 
            type="range" min="0" max="24" step="0.1" value={time} 
            onChange={(e) => setTime(parseFloat(e.target.value))}
            className="flex-1 accent-indigo-500 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
          />
          <Sun size={16} className="text-orange-400" />
          <span className="text-xs font-mono w-10 text-right">{Math.floor(time)}:00</span>
        </div>
      </div>

      {/* 核心应用窗口 - 开启 overflow-hidden，所有特效都在这内部 */}
      <div className="w-[880px] h-[680px] relative rounded-[2rem] shadow-[0_30px_60px_-15px_rgba(0,0,0,0.4)] overflow-hidden border border-white/60 mt-16 transition-all duration-300 ring-1 ring-white/40 bg-white/10">
        
        {/* 底层 1：时间渐变天空背景 */}
        <SkyBackground time={time} weather={weather} />

        {/* 底层 2：天气动效层（雨滴、云层、星空） */}
        <WeatherEffects type={weather} time={time} quality={quality} />

        {/* 顶层：UI 界面层 (Liquid Glass 毛玻璃效果 - 降低白色透明度，增强通透感) */}
        <div className="absolute inset-0 z-20 flex flex-col pointer-events-auto bg-gradient-to-br from-white/5 to-transparent">
          
          {/* 顶部标题栏 (苹果风：更宽敞、更通透) */}
          <div className="h-16 flex items-center justify-between px-6 border-b border-white/20 bg-white/10 backdrop-blur-xl shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
            <div className="flex gap-2">
              <div className="w-3.5 h-3.5 rounded-full bg-[#FF5F56] border border-black/10 shadow-inner"></div>
              <div className="w-3.5 h-3.5 rounded-full bg-[#FFBD2E] border border-black/10 shadow-inner"></div>
              <div className="w-3.5 h-3.5 rounded-full bg-[#27C93F] border border-black/10 shadow-inner"></div>
            </div>
            <div className="flex items-center gap-6 text-sm font-medium text-slate-800">
              <span className="font-extrabold tracking-wide text-base drop-shadow-sm text-slate-800">鹰捷 V3.2</span>
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/30 shadow-[0_2px_8px_rgba(0,0,0,0.05)] border border-white/40 backdrop-blur-md">
                {time > 6 && time < 18 ? <Sun size={16} className="text-orange-600 drop-shadow-md" /> : <Moon size={16} className="text-indigo-700 drop-shadow-md" />}
                <span className="text-xs font-bold text-slate-800">厦门 14°</span>
              </div>
              <div className="flex items-center gap-1.5 opacity-80">
                <div className="w-2 h-2 rounded-full bg-slate-500 shadow-inner"></div>
                <span className="font-semibold text-slate-700">未连接</span>
              </div>
              <Settings size={18} className="text-slate-700 cursor-pointer hover:text-black transition-colors"/>
            </div>
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* 侧边栏 (苹果风：增加视觉锚点，优化选中态) */}
            <div className="w-56 flex flex-col border-r border-white/20 bg-white/10 backdrop-blur-2xl p-3">
              <div className="text-[11px] font-bold text-slate-800/50 mb-3 px-3 mt-3 uppercase tracking-widest">Data Explorer</div>
              <nav className="flex flex-col gap-1">
                
                {/* 选中态：类似 macOS Finder 的毛玻璃浮雕效果 */}
                <div className="flex justify-between items-center px-3 py-2.5 bg-white/50 text-slate-900 rounded-xl font-bold cursor-pointer border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.05)] backdrop-blur-md transition-all relative group overflow-hidden">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500"></div>
                  <div className="flex items-center gap-2.5">
                    <Database size={16} className="text-blue-500" />
                    <span className="text-[14px]">全部</span>
                  </div>
                  <span className="text-xs bg-white/60 px-2 py-0.5 rounded-full shadow-sm border border-white/50">2</span>
                </div>

                {/* 未选中态：悬浮时才微微亮起 */}
                <div className="flex justify-between items-center px-3 py-2.5 hover:bg-white/30 rounded-xl cursor-pointer text-slate-700 font-medium transition-all hover:shadow-sm border border-transparent hover:border-white/30 group">
                  <div className="flex items-center gap-2.5">
                    <Table size={16} className="text-slate-400 group-hover:text-blue-500 transition-colors" />
                    <span className="text-[14px]">表名</span>
                  </div>
                  <span className="text-xs bg-black/5 px-2 py-0.5 rounded-full group-hover:bg-white/50 transition-colors">2</span>
                </div>

                <div className="flex justify-between items-center px-3 py-2.5 hover:bg-white/30 rounded-xl cursor-pointer text-slate-700 font-medium transition-all hover:shadow-sm border border-transparent hover:border-white/30 group">
                  <div className="flex items-center gap-2.5">
                    <Columns size={16} className="text-slate-400 group-hover:text-blue-500 transition-colors" />
                    <span className="text-[14px]">字段名</span>
                  </div>
                </div>

                <div className="flex justify-between items-center px-3 py-2.5 hover:bg-white/30 rounded-xl cursor-pointer text-slate-700 font-medium transition-all hover:shadow-sm border border-transparent hover:border-white/30 group">
                  <div className="flex items-center gap-2.5">
                    <AlignLeft size={16} className="text-slate-400 group-hover:text-blue-500 transition-colors" />
                    <span className="text-[14px]">备注</span>
                  </div>
                </div>

                <div className="flex justify-between items-center px-3 py-2.5 hover:bg-white/30 rounded-xl cursor-pointer text-slate-700 font-medium transition-all hover:shadow-sm border border-transparent hover:border-white/30 group">
                  <div className="flex items-center gap-2.5">
                    <Binary size={16} className="text-slate-400 group-hover:text-blue-500 transition-colors" />
                    <span className="text-[14px]">数据值</span>
                  </div>
                </div>
              </nav>
            </div>

            {/* 主内容区 (强化卡片悬浮感) */}
            <div className="flex-1 flex flex-col bg-white/10 backdrop-blur-xl p-8 relative">
              
              {/* 搜索栏 */}
              <div className="relative mb-8 group">
                <Search className="absolute left-4 top-3.5 text-blue-600/80 transition-transform group-focus-within:scale-110" size={20} />
                <input 
                  type="text" 
                  placeholder="搜索表名、字段名、备注..." 
                  className="w-full h-12 pl-12 pr-16 rounded-2xl border border-white/50 bg-white/40 focus:bg-white/70 focus:outline-none focus:ring-4 focus:ring-blue-400/30 shadow-[0_4px_15px_rgba(0,0,0,0.05)] transition-all placeholder-slate-500 text-slate-900 text-lg font-medium backdrop-blur-md"
                />
                <span className="absolute right-4 top-3.5 text-slate-500 font-medium cursor-pointer hover:text-blue-700 transition-colors">历史</span>
              </div>

              {/* 新增：收藏夹与星标水平导航栏 */}
              <div className="flex items-center justify-between mb-5 px-1">
                <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar">
                  <div className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-500/20 text-blue-800 rounded-full font-bold cursor-pointer border border-blue-400/30 shadow-sm backdrop-blur-md">
                    <span>全部</span>
                  </div>
                  <div className="flex items-center gap-1.5 px-4 py-1.5 bg-white/20 hover:bg-white/40 text-slate-800 rounded-full font-medium cursor-pointer border border-white/30 transition-all shadow-sm">
                    <Star size={14} className="text-amber-500 fill-amber-500" />
                    <span>星标</span>
                  </div>
                  <div className="flex items-center gap-1.5 px-4 py-1.5 bg-white/20 hover:bg-white/40 text-slate-800 rounded-full font-medium cursor-pointer border border-white/30 transition-all shadow-sm">
                    <Folder size={14} className="text-amber-500 fill-amber-500" />
                    <span>物品表s</span>
                  </div>
                  <div className="flex items-center justify-center w-8 h-8 bg-white/20 hover:bg-white/40 text-slate-600 rounded-full cursor-pointer transition-all border border-white/30 shadow-sm">
                    <Plus size={16} />
                  </div>
                </div>

                {/* 排序按钮 (参照截图右侧) */}
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white/20 hover:bg-white/40 text-slate-700 rounded-xl text-xs font-bold cursor-pointer transition-all border border-white/30 shadow-sm ml-4 whitespace-nowrap">
                  <ArrowDownAZ size={14} className="text-slate-500"/>
                  <span>表名 A→Z</span>
                </div>
              </div>

              {/* 列表内容 (变身为精致的悬浮卡片) */}
              <div className="flex flex-col gap-5 overflow-y-auto pb-4 pr-2">
                <div className="flex items-center justify-between p-5 rounded-2xl bg-white/20 hover:bg-white/40 transition-all duration-300 group cursor-pointer border border-white/40 shadow-[0_8px_30px_rgb(0,0,0,0.05)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.1)] hover:-translate-y-0.5 backdrop-blur-md">
                  <div>
                    <div className="font-extrabold text-slate-900 text-lg tracking-tight">t_hero_config</div>
                    <div className="text-sm font-medium text-slate-600 mt-1.5 flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
                      英雄配置表
                    </div>
                  </div>
                  <div className="flex gap-3 items-center">
                    {/* 卡片星标按钮 (未收藏状态) */}
                    <button className="p-2 text-slate-400 hover:text-amber-500 hover:scale-110 transition-all" title="加入星标">
                      <Star size={18} />
                    </button>
                    <span className="px-4 py-1.5 bg-white/50 text-blue-700 rounded-full text-xs font-bold border border-white/60 uppercase tracking-widest shadow-sm">Table</span>
                    <div className="p-2.5 bg-white/60 rounded-xl text-slate-600 group-hover:text-blue-600 group-hover:bg-blue-100 transition-all shadow-sm border border-white/50"><FileText size={18}/></div>
                  </div>
                </div>

                <div className="flex items-center justify-between p-5 rounded-2xl bg-white/20 hover:bg-white/40 transition-all duration-300 group cursor-pointer border border-white/40 shadow-[0_8px_30px_rgb(0,0,0,0.05)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.1)] hover:-translate-y-0.5 backdrop-blur-md">
                  <div>
                    <div className="font-extrabold text-slate-900 text-lg tracking-tight">t_hero_skill</div>
                    <div className="text-sm font-medium text-slate-600 mt-1.5 flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                      英雄技能表
                    </div>
                  </div>
                  <div className="flex gap-3 items-center">
                    {/* 卡片星标按钮 (已收藏状态) */}
                    <button className="p-2 text-amber-500 hover:scale-110 transition-all drop-shadow-sm" title="取消星标">
                      <Star size={18} className="fill-amber-500" />
                    </button>
                    <span className="px-4 py-1.5 bg-white/50 text-blue-700 rounded-full text-xs font-bold border border-white/60 uppercase tracking-widest shadow-sm">Table</span>
                    <div className="p-2.5 bg-white/60 rounded-xl text-slate-600 group-hover:text-blue-600 group-hover:bg-blue-100 transition-all shadow-sm border border-white/50"><FileText size={18}/></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 底部状态栏 */}
          <div className="h-12 flex items-center justify-between px-6 border-t border-white/20 bg-white/10 backdrop-blur-2xl">
            <div className="flex items-center gap-3">
              <button className="p-1.5 hover:bg-white/40 rounded-lg text-slate-600 transition-colors shadow-sm border border-transparent hover:border-white/50"><ChevronLeft size={18}/></button>
              <span className="px-4 py-1 bg-white/40 text-blue-800 rounded-lg text-sm font-bold border border-white/50 shadow-sm">1</span>
              <button className="p-1.5 hover:bg-white/40 rounded-lg text-slate-600 transition-colors shadow-sm border border-transparent hover:border-white/50"><ChevronRight size={18}/></button>
            </div>
            <div className="flex items-center gap-2 opacity-90">
              <div className="w-3 h-3 rounded-full bg-blue-500 ring-4 ring-blue-500/30 shadow-sm"></div>
              <div className="w-3 h-3 rounded-full bg-slate-500 shadow-inner"></div>
              <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-inner"></div>
              <div className="w-3 h-3 rounded-full bg-purple-500 shadow-inner"></div>
              <div className="w-3 h-3 rounded-full bg-amber-500 shadow-inner"></div>
            </div>
          </div>
        </div>

      </div>

      {/* 动画与样式定义 */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes rain-fall {
          0% { transform: translateY(-20px); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(650px); opacity: 0; }
        }
        @keyframes rain-fall-heavy {
          0% { transform: translateY(-20px) translateX(0); opacity: 0; }
          10% { opacity: 1; }
          100% { transform: translateY(650px) translateX(-30px); opacity: 0; }
        }
        @keyframes float-cloud {
          0% { transform: translateX(-150px); }
          100% { transform: translateX(850px); }
        }
        .rain-drop-light {
          position: absolute;
          width: 1.5px;
          height: 25px;
          background: linear-gradient(to bottom, rgba(255,255,255,0), rgba(150,200,255,0.8));
          animation: rain-fall linear infinite;
        }
        .rain-drop-heavy {
          position: absolute;
          width: 2px;
          height: 35px;
          background: linear-gradient(to bottom, rgba(255,255,255,0), rgba(200,220,255,0.9));
          animation: rain-fall-heavy linear infinite;
        }
      `}} />
    </div>
  );
};

// --- 组件：天空背景 (处理基于时间和平滑图层混合) ---
const SkyBackground = ({ time, weather }) => {
  // 计算四个时段的透明度占比 (0到1)
  const getOpacities = (t) => {
    let dawn = 0, day = 0, dusk = 0, night = 0;
    if (t >= 4 && t < 8) { dawn = 1 - Math.abs(t - 6) / 2; } // 6点黎明最亮
    if (t >= 6 && t < 18) { day = 1 - Math.abs(t - 12) / 6; } // 12点白天最亮
    if (t >= 16 && t < 20) { dusk = 1 - Math.abs(t - 18) / 2; } // 18点黄昏最亮
    if (t >= 18 || t < 6) { night = t >= 18 ? (t - 18) / 6 : 1 - t / 6; } // 深夜
    return { dawn: Math.max(0, dawn), day: Math.max(0, day), dusk: Math.max(0, dusk), night: Math.max(0, night) };
  };

  const opacities = getOpacities(time);
  
  // 天气偏暗处理 (下雨/多云时降低亮度，为了反衬雨滴，这里把下雨时的亮度调得更暗)
  const isDarkWeather = weather === 'lightRain' || weather === 'heavyRain' || weather === 'cloudy';
  const filterStyle = isDarkWeather ? 'brightness(0.5) saturate(0.8)' : 'brightness(1) saturate(1)';

  return (
    <div className="absolute inset-0 z-0 transition-all duration-1000 ease-in-out" style={{ filter: filterStyle }}>
      {/* 黎明层 */}
      <div className="absolute inset-0 bg-gradient-to-br from-sky-400 via-pink-300 to-orange-300" style={{ opacity: opacities.dawn }} />
      {/* 白天层：加深了白天的蓝色饱和度，让白色透明UI更有反差 */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500 via-sky-400 to-sky-200" style={{ opacity: opacities.day }} />
      {/* 黄昏层 */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-purple-500 to-orange-400" style={{ opacity: opacities.dusk }} />
      {/* 深夜层 */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-800" style={{ opacity: opacities.night }} />
    </div>
  );
};

// --- 组件：天气粒子系统 ---
const WeatherEffects = ({ type, time, quality }) => {
  const isNight = time < 6 || time > 18;
  const isSunny = type === 'sunny';
  const isCloudy = type === 'cloudy';
  const isLightRain = type === 'lightRain';
  const isHeavyRain = type === 'heavyRain';

  // 1. 生成雨滴
  const raindrops = useMemo(() => {
    if (!isLightRain && !isHeavyRain) return [];
    
    // 画质调节：控制 DOM 数量
    let count = 0;
    if (isLightRain) count = quality === 'high' ? 40 : 15;
    if (isHeavyRain) count = quality === 'high' ? 100 : 40;

    return Array.from({ length: count }).map((_, i) => ({
      id: i,
      left: `${Math.random() * 110}%`, // 稍宽于屏幕，防止倾斜时边缘断层
      // 加快雨滴下落速度，显得更加凌厉
      duration: isHeavyRain ? `${0.3 + Math.random() * 0.2}s` : `${0.5 + Math.random() * 0.3}s`,
      delay: `${Math.random() * 2}s`,
    }));
  }, [type, quality]);

  // 2. 生成云朵 (仅在多云或下雨时显示)
  const clouds = useMemo(() => {
    if (isSunny) return [];
    const count = quality === 'high' ? (isHeavyRain ? 6 : 4) : 2;
    return Array.from({ length: count }).map((_, i) => ({
      id: i,
      top: `${5 + Math.random() * 20}%`,
      duration: `${40 + Math.random() * 40}s`, // 云朵移动极慢
      delay: `-${Math.random() * 40}s`, // 负数延迟让云朵初始就在画面内分布好
      // 增强云朵的不透明度，使其穿透毛玻璃
      opacity: isHeavyRain ? 0.9 : 0.7,
      scale: 0.8 + Math.random() * 0.7,
    }));
  }, [type, quality]);

  return (
    <div className="absolute inset-0 z-10 pointer-events-none">
      
      {/* 晴天/多云白天的太阳 */}
      {(isSunny || isCloudy) && !isNight && (
         <div 
           className="absolute w-32 h-32 bg-yellow-300/60 rounded-full blur-2xl transition-all duration-1000 ease-in-out"
           style={{
             // 根据时间让太阳走弧线
             left: `${((time - 6) / 12) * 80 + 10}%`,
             top: `${Math.abs(time - 12) * 4 + 10}%`,
             opacity: isCloudy ? 0.3 : 1
           }}
         />
      )}

      {/* 晴天夜晚的星空 */}
      {isSunny && isNight && (
        <div className="absolute inset-0" style={{ opacity: quality === 'high' ? 1 : 0.5 }}>
          {Array.from({length: 30}).map((_, i) => (
             <div key={i} className="absolute bg-white rounded-full animate-pulse" 
                  style={{ 
                    left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%`,
                    width: `${Math.random() * 3}px`, height: `${Math.random() * 3}px`,
                    animationDuration: `${2 + Math.random() * 3}s`
                  }} />
          ))}
        </div>
      )}

      {/* 渲染云朵 */}
      {clouds.map(c => (
        <div 
          key={`cloud-${c.id}`} 
          className="absolute text-white/50"
          style={{
            top: c.top,
            transform: `scale(${c.scale})`,
            opacity: isNight ? c.opacity * 0.5 : c.opacity, // 夜晚云层变暗
            animation: `float-cloud ${c.duration} linear infinite`,
            animationDelay: c.delay,
            filter: isHeavyRain ? 'brightness(0.5)' : 'none'
          }}
        >
          {/* 用 Lucide 的云朵图标放大作为矢量云 */}
          <Cloud size={120} fill="currentColor" strokeWidth={0} />
        </div>
      ))}

      {/* 渲染雨滴 */}
      {raindrops.map(r => (
        <div
          key={`rain-${r.id}`}
          className={isHeavyRain ? 'rain-drop-heavy' : 'rain-drop-light'}
          style={{
            left: r.left,
            animationDuration: r.duration,
            animationDelay: r.delay,
          }}
        />
      ))}

      {/* 动画与样式定义 */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes rain-fall {
          0% { transform: translateY(-20px); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(650px); opacity: 0; }
        }
        @keyframes rain-fall-heavy {
          0% { transform: translateY(-20px) translateX(0); opacity: 0; }
          10% { opacity: 1; }
          100% { transform: translateY(650px) translateX(-30px); opacity: 0; }
        }
        @keyframes float-cloud {
          0% { transform: translateX(-150px); }
          100% { transform: translateX(850px); }
        }
        /* 强化小雨：加长、加粗、更白、带发光效果 */
        .rain-drop-light {
          position: absolute;
          width: 2px;
          height: 40px;
          background: linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0.9));
          box-shadow: 0 0 4px rgba(255,255,255,0.4);
          animation: rain-fall linear infinite;
        }
        /* 强化大雨：更长、更粗、纯白、带强发光效果 */
        .rain-drop-heavy {
          position: absolute;
          width: 3px;
          height: 60px;
          background: linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,1));
          box-shadow: 0 0 6px rgba(255,255,255,0.6);
          animation: rain-fall-heavy linear infinite;
        }
      `}} />
    </div>
  );
};

export default App;