/**
 * WeatherEngine — Canvas 2D particle engine for real-time weather effects.
 * Supports rain (with splash), snow, sunny, and cloudy effects.
 */

// ── Weather skin color presets ──
const WEATHER_SKIN_COLORS = {
  disabled: {
    rain: 'rgba(140, 164, 190, 0.42)',
    rainSplash: 'rgba(140, 164, 190, 0.48)',
    snow: 'rgba(222, 229, 240, 0.8)',
    snowGlow: 'rgba(201, 213, 225, 0.35)',
    sunRay: 'rgba(248,210,120,',
    sunOverlay: 'rgba(255,221,145,0.03)',
    cloud: 'rgba(183,196,211,',
    cloudOverlay: 'rgba(148,163,184,0.04)',
  },
  sunny: {
    rain: 'rgba(91, 140, 186, 0.45)',
    rainSplash: 'rgba(91, 140, 186, 0.52)',
    snow: 'rgba(234, 242, 255, 0.86)',
    snowGlow: 'rgba(190, 219, 255, 0.38)',
    sunRay: 'rgba(255,203,92,',
    sunOverlay: 'rgba(255,208,120,0.06)',
    cloud: 'rgba(245,248,255,',
    cloudOverlay: 'rgba(255,255,255,0.05)',
  },
  cloudy: {
    rain: 'rgba(112, 148, 189, 0.48)',
    rainSplash: 'rgba(112, 148, 189, 0.55)',
    snow: 'rgba(231, 238, 248, 0.82)',
    snowGlow: 'rgba(190, 205, 224, 0.36)',
    sunRay: 'rgba(224,230,246,',
    sunOverlay: 'rgba(207,216,230,0.03)',
    cloud: 'rgba(198,208,223,',
    cloudOverlay: 'rgba(172,184,201,0.05)',
  },
  lightRain: {
    rain: 'rgba(126, 178, 236, 0.5)',
    rainSplash: 'rgba(126, 178, 236, 0.56)',
    snow: 'rgba(220, 236, 250, 0.78)',
    snowGlow: 'rgba(169, 209, 243, 0.38)',
    sunRay: 'rgba(184,208,240,',
    sunOverlay: 'rgba(163,191,227,0.03)',
    cloud: 'rgba(188,206,230,',
    cloudOverlay: 'rgba(155,180,209,0.05)',
  },
  heavyRain: {
    rain: 'rgba(181, 214, 255, 0.58)',
    rainSplash: 'rgba(181, 214, 255, 0.62)',
    snow: 'rgba(226, 238, 255, 0.84)',
    snowGlow: 'rgba(194, 219, 255, 0.42)',
    sunRay: 'rgba(147,177,222,',
    sunOverlay: 'rgba(113,144,196,0.03)',
    cloud: 'rgba(129,155,191,',
    cloudOverlay: 'rgba(94,118,150,0.05)',
  },
  snow: {
    rain: 'rgba(146, 175, 210, 0.42)',
    rainSplash: 'rgba(146, 175, 210, 0.48)',
    snow: 'rgba(255, 255, 255, 0.92)',
    snowGlow: 'rgba(233, 241, 255, 0.42)',
    sunRay: 'rgba(240,244,255,',
    sunOverlay: 'rgba(255,255,255,0.05)',
    cloud: 'rgba(239,245,255,',
    cloudOverlay: 'rgba(214,226,245,0.05)',
  },
}

// ── Particle Pool ──
class ParticlePool {
  constructor(size) {
    this._pool = []
    this._active = []
    for (let i = 0; i < size; i++) {
      this._pool.push(this._create())
    }
  }
  _create() {
    return {
      x: 0, y: 0, vx: 0, vy: 0,
      life: 0, maxLife: 0,
      size: 0, opacity: 1,
      type: '', // 'rain' | 'splash' | 'snow'
      angle: 0, freq: 0, amp: 0,
      length: 0,
      active: false,
    }
  }
  acquire() {
    let p = this._pool.pop()
    if (!p) p = this._create()
    p.active = true
    this._active.push(p)
    return p
  }
  release(p) {
    p.active = false
    const idx = this._active.indexOf(p)
    if (idx !== -1) this._active.splice(idx, 1)
    this._pool.push(p)
  }
  getActive() {
    return this._active
  }
  releaseAll() {
    while (this._active.length) {
      const p = this._active.pop()
      p.active = false
      this._pool.push(p)
    }
  }
  get activeCount() {
    return this._active.length
  }
}

// ── Main Engine ──
export class WeatherEngine {
  constructor(canvas, options = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.dpr = window.devicePixelRatio || 1
    this.width = 0
    this.height = 0
    this.pool = new ParticlePool(350)
    this.collisionRects = []
    this.category = ''
    this.windSpeed = 0
    this.intensity = 0.5
    this.skin = options.skin || 'sunny'
    this.running = false
    this.rafId = null
    this.lastTime = 0
    // Sunny state
    this._sunRays = []
    // Cloud state
    this._clouds = []
    // Visibility
    this._visible = true
    this._onVisChange = () => {
      this._visible = !document.hidden
      if (this._visible && this.running) {
        this.lastTime = performance.now()
        this._scheduleFrame()
      }
    }
    document.addEventListener('visibilitychange', this._onVisChange)
    this.resize(canvas.clientWidth, canvas.clientHeight)
  }

  resize(w, h) {
    this.width = w
    this.height = h
    this.canvas.width = w * this.dpr
    this.canvas.height = h * this.dpr
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
  }

  setWeather(category, windSpeed = 0, intensity = 0.5) {
    const changed = this.category !== category
    this.category = category
    this.windSpeed = windSpeed
    this.intensity = Math.max(0, Math.min(1, intensity))
    if (changed) {
      this.pool.releaseAll()
      this._sunRays = []
      this._clouds = []
      if (category === 'sunny') this._initSunRays()
      if (category === 'cloudy') this._initClouds()
    }
  }

  setCollisionRects(rects) {
    this.collisionRects = rects || []
  }

  setSkin(skinId) {
    this.skin = WEATHER_SKIN_COLORS[skinId] ? skinId : 'sunny'
  }

  setTheme(themeId) {
    this.setSkin(themeId)
  }

  start() {
    if (this.running) return
    this.running = true
    this.lastTime = performance.now()
    this._scheduleFrame()
  }

  stop() {
    this.running = false
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.pool.releaseAll()
    this._sunRays = []
    this._clouds = []
    this.ctx.clearRect(0, 0, this.width, this.height)
  }

  destroy() {
    this.stop()
    document.removeEventListener('visibilitychange', this._onVisChange)
  }

  _scheduleFrame() {
    if (!this.running || !this._visible) return
    this.rafId = requestAnimationFrame((t) => this._loop(t))
  }

  _loop(timestamp) {
    if (!this.running || !this._visible) return
    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.05) // cap at 50ms
    this.lastTime = timestamp

    this.ctx.clearRect(0, 0, this.width, this.height)

    switch (this.category) {
      case 'rain': this._updateRain(dt); this._drawRain(); break
      case 'snow': this._updateSnow(dt); this._drawSnow(); break
      case 'sunny': this._updateSunny(dt); this._drawSunny(); break
      case 'cloudy': this._updateCloudy(dt); this._drawCloudy(); break
    }

    this._scheduleFrame()
  }

  _colors() {
    return WEATHER_SKIN_COLORS[this.skin] || WEATHER_SKIN_COLORS.sunny
  }

  // ── Rain ──
  _updateRain(dt) {
    const maxDrops = Math.floor(30 + this.intensity * 90)
    const spawnRate = maxDrops * dt * 2
    const windOffset = (this.windSpeed / 100) * 60

    // Spawn new drops
    for (let i = 0; i < spawnRate && this.pool.activeCount < 200; i++) {
      const p = this.pool.acquire()
      p.type = 'rain'
      p.x = Math.random() * (this.width + 60) - 30
      p.y = -Math.random() * 40
      p.vx = windOffset + (Math.random() - 0.3) * 20
      p.vy = 400 + Math.random() * 400
      p.length = 8 + Math.random() * 12
      p.opacity = 0.4 + Math.random() * 0.35
      p.life = 0
      p.maxLife = 99
      p.size = 1.2 + Math.random() * 0.6
    }

    // Update existing
    const toRelease = []
    for (const p of this.pool.getActive()) {
      if (p.type === 'splash') {
        p.life += dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.vy += 600 * dt // gravity on splash
        p.opacity = Math.max(0, 1 - p.life / p.maxLife)
        if (p.life >= p.maxLife) toRelease.push(p)
        continue
      }
      if (p.type !== 'rain') continue

      p.x += p.vx * dt
      p.y += p.vy * dt

      // Collision with bottom
      let collided = p.y >= this.height
      // Collision with rects
      if (!collided) {
        for (const r of this.collisionRects) {
          if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + 6) {
            collided = true
            break
          }
        }
      }

      if (collided) {
        this._spawnSplash(p.x, Math.min(p.y, this.height))
        toRelease.push(p)
      } else if (p.x > this.width + 30 || p.x < -30) {
        toRelease.push(p)
      }
    }
    for (const p of toRelease) this.pool.release(p)
  }

  _spawnSplash(x, y) {
    const count = 3 + Math.floor(Math.random() * 4)
    for (let i = 0; i < count && this.pool.activeCount < 200; i++) {
      const s = this.pool.acquire()
      s.type = 'splash'
      s.x = x
      s.y = y
      const angle = -Math.PI * (0.15 + Math.random() * 0.7)
      const speed = 40 + Math.random() * 80
      s.vx = Math.cos(angle) * speed
      s.vy = Math.sin(angle) * speed
      s.size = 1 + Math.random() * 1.5
      s.opacity = 0.6
      s.life = 0
      s.maxLife = 0.15 + Math.random() * 0.15
    }
  }

  _drawRain() {
    const c = this._colors()
    const ctx = this.ctx
    for (const p of this.pool.getActive()) {
      if (p.type === 'splash') {
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fillStyle = c.rainSplash.replace(/[\d.]+\)$/, `${p.opacity * 0.6})`)
        ctx.fill()
        continue
      }
      if (p.type !== 'rain') continue
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(p.x + p.vx * 0.01, p.y + p.length)
      ctx.strokeStyle = c.rain
      ctx.lineWidth = p.size
      ctx.stroke()
    }
  }

  // ── Snow ──
  _updateSnow(dt) {
    const maxFlakes = 25 + Math.floor(this.intensity * 55)
    const windOffset = (this.windSpeed / 100) * 15

    // Spawn
    const activeSnow = this.pool.getActive().filter(p => p.type === 'snow').length
    if (activeSnow < maxFlakes && Math.random() < dt * maxFlakes * 0.5) {
      const p = this.pool.acquire()
      p.type = 'snow'
      p.x = Math.random() * this.width
      p.y = -5
      p.vx = windOffset
      p.vy = 30 + Math.random() * 50
      p.size = 2 + Math.random() * 4
      p.opacity = 0.5 + Math.random() * 0.4
      p.life = Math.random() * Math.PI * 2 // phase offset for sine
      p.freq = 1 + Math.random() * 2
      p.amp = 15 + Math.random() * 25
      p.maxLife = 99
      p.angle = 0
    }

    const toRelease = []
    for (const p of this.pool.getActive()) {
      if (p.type !== 'snow') continue
      p.life += dt
      p.y += p.vy * dt
      p.x += Math.sin(p.life * p.freq) * p.amp * dt + p.vx * dt
      p.angle += dt * 0.5

      // Fade out near bottom
      if (p.y > this.height - 30) {
        p.opacity = Math.max(0, p.opacity - dt * 3)
      }
      if (p.y > this.height || p.opacity <= 0) {
        toRelease.push(p)
      }
    }
    for (const p of toRelease) this.pool.release(p)
  }

  _drawSnow() {
    const c = this._colors()
    const ctx = this.ctx
    for (const p of this.pool.getActive()) {
      if (p.type !== 'snow') continue
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.angle)
      ctx.beginPath()
      ctx.arc(0, 0, p.size, 0, Math.PI * 2)
      ctx.fillStyle = c.snow.replace(/[\d.]+\)$/, `${p.opacity})`)
      ctx.fill()
      // Subtle glow
      ctx.shadowColor = c.snowGlow || c.snow
      ctx.shadowBlur = p.size * 2.5
      ctx.beginPath()
      ctx.arc(0, 0, p.size * 0.6, 0, Math.PI * 2)
      ctx.fillStyle = (c.snowGlow || c.snow).replace(/[\d.]+\)$/, `${p.opacity * 0.4})`)
      ctx.fill()
      ctx.restore()
    }
  }

  // ── Sunny ──
  _initSunRays() {
    const count = 3 + Math.floor(Math.random() * 3)
    this._sunRays = []
    for (let i = 0; i < count; i++) {
      this._sunRays.push({
        x: this.width * (0.5 + Math.random() * 0.5),
        angle: -Math.PI * (0.15 + Math.random() * 0.25),
        width: 40 + Math.random() * 80,
        opacity: 0.06 + Math.random() * 0.08,
        phase: Math.random() * Math.PI * 2,
        speed: 0.3 + Math.random() * 0.4,
      })
    }
  }

  _updateSunny(dt) {
    for (const ray of this._sunRays) {
      ray.phase += dt * ray.speed
    }
  }

  _drawSunny() {
    const c = this._colors()
    const ctx = this.ctx

    // Warm overlay
    ctx.fillStyle = c.sunOverlay
    ctx.fillRect(0, 0, this.width, this.height)

    // Light rays from top-right
    for (const ray of this._sunRays) {
      const pulse = 0.5 + 0.5 * Math.sin(ray.phase)
      const alpha = ray.opacity * (0.6 + 0.4 * pulse)
      ctx.save()
      ctx.translate(ray.x, 0)
      ctx.rotate(ray.angle)

      const grad = ctx.createLinearGradient(0, 0, 0, this.height * 1.2)
      grad.addColorStop(0, c.sunRay + `${alpha})`)
      grad.addColorStop(1, c.sunRay + '0)')
      ctx.fillStyle = grad

      // Trapezoid ray
      const halfTop = ray.width * 0.3
      const halfBot = ray.width
      ctx.beginPath()
      ctx.moveTo(-halfTop, 0)
      ctx.lineTo(halfTop, 0)
      ctx.lineTo(halfBot, this.height * 1.2)
      ctx.lineTo(-halfBot, this.height * 1.2)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
  }

  // ── Cloudy ──
  _initClouds() {
    const count = 3 + Math.floor(Math.random() * 3)
    this._clouds = []
    for (let i = 0; i < count; i++) {
      // Each cloud is composed of multiple overlapping blobs
      const baseX = Math.random() * this.width
      const baseY = 30 + Math.random() * this.height * 0.25
      const baseW = 220 + Math.random() * 180
      const speed = 3 + Math.random() * 7
      const opacity = 0.10 + Math.random() * 0.08
      const blobCount = 3 + Math.floor(Math.random() * 3)
      const blobs = []
      for (let b = 0; b < blobCount; b++) {
        blobs.push({
          dx: (b - blobCount / 2) * (baseW * 0.25) + (Math.random() - 0.5) * 30,
          dy: (Math.random() - 0.5) * 25,
          rx: 60 + Math.random() * 70,
          ry: 30 + Math.random() * 25,
        })
      }
      this._clouds.push({ x: baseX, y: baseY, w: baseW, speed, opacity, blobs })
    }
  }

  _updateCloudy(dt) {
    for (const cl of this._clouds) {
      cl.x += cl.speed * dt
      if (cl.x > this.width + cl.w * 1.5) {
        cl.x = -cl.w * 1.5
      }
    }
  }

  _drawCloudy() {
    const c = this._colors()
    const ctx = this.ctx
    // Dim overlay for overcast feel
    ctx.fillStyle = c.cloudOverlay || (c.cloud + '0.02)')
    ctx.fillRect(0, 0, this.width, this.height)

    for (const cl of this._clouds) {
      for (const blob of cl.blobs) {
        const bx = cl.x + blob.dx
        const by = cl.y + blob.dy
        const grad = ctx.createRadialGradient(bx, by, 0, bx, by, blob.rx)
        grad.addColorStop(0, c.cloud + `${cl.opacity})`)
        grad.addColorStop(0.6, c.cloud + `${cl.opacity * 0.6})`)
        grad.addColorStop(1, c.cloud + '0)')
        ctx.beginPath()
        ctx.ellipse(bx, by, blob.rx, blob.ry, 0, 0, Math.PI * 2)
        ctx.fillStyle = grad
        ctx.fill()
      }
    }
  }
}
