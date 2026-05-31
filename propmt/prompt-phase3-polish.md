# Phase 3: 视觉打磨与生产部署 — NovelForge

**角色**: 打磨与部署 Agent  
**目标**: 动效完善、性能优化、Docker 配置、阿里云部署  
**前置依赖**: Phase 0-2 全部完成（功能已实现）  
**读取优先级**: 先读 `design.md`（视觉规范），再读本 prompt  

---

## 1. 项目上下文

本阶段是项目的最后阶段，目标是：
1. **视觉打磨**: 实现 design.md 中定义的所有动效和视觉细节
2. **性能优化**: 确保 Three.js 背景、大文本渲染流畅
3. **Docker 配置**: 编写 Dockerfile 和 docker-compose.yml
4. **生产部署**: 阿里云 ECS 部署，Nginx 反向代理

---

## 2. 视觉打磨任务

### 2.1 主页 Neon Silk 背景（Three.js Shader）

替换 `src/pages/Home.tsx` 的背景部分，添加 Three.js 全屏 Shader：

```tsx
// src/sections/HeroBackground.tsx
// Three.js 霓虹丝绸质感背景

import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

// Simplex noise (GLSL)
const snoise3 = `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

const vertexShader = `
uniform float uTime;
uniform vec2 uMouse;
varying vec2 vUv;

${snoise3}

void main() {
  vUv = uv;
  float noise = snoise(vec3(uv * 2.0, uTime * 0.15));
  noise = clamp(noise, 0.0, 0.2);
  vec3 pos = position;
  pos.z = noise;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const fragmentShader = `
uniform float uTime;
uniform vec2 uMouse;
uniform vec2 uResolution;
varying vec2 vUv;

${snoise3}

void main() {
  vec2 uv = vUv;
  
  // Mouse distance
  vec2 mousePos = (uMouse * 0.5) + 0.5;
  float dist = distance(uv, mousePos);
  
  // Silk folds
  float foldX = sin(uv.x * 5.0 + uTime * 0.5) * 0.5 + 0.5;
  float foldY = sin((uv.y + snoise(vec3(uv * 2.0, uTime * 0.2))) * 8.0) * 0.3;
  float fold = foldX * foldY;
  
  // Base color
  vec3 baseColor = mix(
    vec3(0.02, 0.02, 0.02),
    vec3(0.08, 0.08, 0.1),
    uv.y + fold * 0.3
  );
  
  // Sheen (diagonal highlight)
  float sheen = pow(1.0 - abs(dot(normalize(vec2(1.0, 1.0)), uv - vec2(0.5))), 3.0) * 0.3;
  
  // Cursor glow
  float cursorGlow = smoothstep(0.5, 0.0, dist) * 0.15;
  
  gl_FragColor = vec4(baseColor + sheen + cursorGlow, 1.0);
}
`;

function SilkPlane() {
  const meshRef = useRef<THREE.Mesh>(null);
  const mouseRef = useRef(new THREE.Vector2(0, 0));
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(0, 0) },
      uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    }),
    []
  );

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
      // Smooth mouse interpolation
      const target = mouseRef.current;
      const current = materialRef.current.uniforms.uMouse.value as THREE.Vector2;
      current.x += (target.x - current.x) * 0.05;
      current.y += (target.y - current.y) * 0.05;
    }
  });

  // Track mouse
  useMemo(() => {
    const handler = (e: MouseEvent) => {
      mouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseRef.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener("mousemove", handler);
    return () => window.removeEventListener("mousemove", handler);
  }, []);

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[2, 2, 16, 16]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
      />
    </mesh>
  );
}

export default function HeroBackground() {
  return (
    <div className="fixed inset-0 -z-10" style={{ pointerEvents: "none" }}>
      <Canvas
        camera={{ position: [0, 0, 1] }}
        frameloop="always"
        gl={{ antialias: false, alpha: false }}
        style={{ width: "100%", height: "100%", background: "#000000" }}
      >
        <SilkPlane />
      </Canvas>
    </div>
  );
}
```

在 `src/pages/Home.tsx` 中导入使用：

```tsx
import HeroBackground from "../sections/HeroBackground";

// 在页面最外层添加：
// <HeroBackground />
```

### 2.2 Agent 卡片液态反光效果

创建 `src/components/LiquidGlassCard.tsx`：

```tsx
// src/components/LiquidGlassCard.tsx
// 液态反光玻璃卡片

import { useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";

interface LiquidGlassCardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export default function LiquidGlassCard({ children, className = "", onClick }: LiquidGlassCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ x: 50, y: 50, velX: 0, velY: 0 });
  const lastMouseRef = useRef({ x: 0, y: 0, time: 0 });

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    
    const now = Date.now();
    const dt = now - lastMouseRef.current.time;
    if (dt > 0) {
      const velX = (e.clientX - lastMouseRef.current.x) / dt * 10;
      const velY = (e.clientY - lastMouseRef.current.y) / dt * 10;
      setTransform({ x, y, velX, velY });
    }
    lastMouseRef.current = { x: e.clientX, y: e.clientY, time: now };
  }, []);

  const moveX = transform.x * 1.2;
  const moveY = transform.y * 0.8;
  const skewX = transform.velX * 0.1;
  const skewY = transform.velY * 0.05;
  const scale = 1 + Math.sqrt(transform.velX * transform.velX + transform.velY * transform.velY) * 0.002;
  const rotate = Math.atan2(transform.velY, transform.velX) * (180 / Math.PI);

  return (
    <motion.div
      ref={cardRef}
      className={`relative overflow-hidden rounded-2xl bg-white/[0.03] backdrop-blur-xl border border-white/10 cursor-pointer ${className}`}
      onMouseMove={handleMouseMove}
      onClick={onClick}
      whileHover={{ y: -4, borderColor: "rgba(245, 158, 11, 0.3)" }}
      transition={{ duration: 0.3 }}
    >
      {/* 液态反光层 */}
      <div
        className="absolute inset-0 pointer-events-none z-10"
        style={{
          maskImage: `radial-gradient(circle at ${transform.x}% ${transform.y}%, black 0%, transparent 60%)`,
          WebkitMaskImage: `radial-gradient(circle at ${transform.x}% ${transform.y}%, black 0%, transparent 60%)`,
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.4) 45%, rgba(255,255,255,0.8) 50%, rgba(255,255,255,0.4) 55%, transparent 60%)",
            transform: `translate(${moveX - 50}%, ${moveY - 50}%) skew(${skewX}deg, ${skewY}deg) scale(${scale}) rotate(${rotate}deg)`,
            transition: "transform 0.1s ease-out",
          }}
        />
      </div>
      
      {/* 内容 */}
      <div className="relative z-20">
        {children}
      </div>
    </motion.div>
  );
}
```

### 2.3 扫光文字效果

创建 `src/components/ShimmerText.tsx`：

```tsx
// src/components/ShimmerText.tsx
// 扫光文字显现效果

interface ShimmerTextProps {
  children: React.ReactNode;
  className?: string;
  as?: "h1" | "h2" | "h3" | "span" | "p";
}

export default function ShimmerText({ children, className = "", as: Tag = "span" }: ShimmerTextProps) {
  return (
    <Tag
      className={`inline-block bg-gradient-to-r from-transparent via-cream/80 to-transparent bg-[length:80%] bg-no-repeat text-transparent bg-clip-text animate-shimmerSweep ${className}`}
      style={{
        WebkitBackgroundClip: "text",
        backgroundColor: "rgba(253, 251, 245, 0.2)",
      }}
    >
      {children}
    </Tag>
  );
}
```

### 2.4 3D 书本旋转效果

创建 `src/components/Book3D.tsx`：

```tsx
// src/components/Book3D.tsx
// 3D 书本悬停旋转

import { useState } from "react";
import { BookOpen } from "lucide-react";

interface Book3DProps {
  coverColor?: string;
  className?: string;
}

export default function Book3D({ coverColor = "#F59E0B", className = "" }: Book3DProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className={`book-scene ${className}`}
      style={{ perspective: "600px" }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className="book-pivot relative w-16 h-20"
        style={{
          transformStyle: "preserve-3d",
          transition: "transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
          transform: isHovered ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        {/* 封面 */}
        <div
          className="absolute inset-0 rounded-lg flex items-center justify-center"
          style={{
            backfaceVisibility: "hidden",
            background: `linear-gradient(135deg, ${coverColor}22, ${coverColor}11)`,
            border: `1px solid ${coverColor}33`,
          }}
        >
          <BookOpen className="w-8 h-8" style={{ color: coverColor }} />
        </div>
        {/* 封底 */}
        <div
          className="absolute inset-0 rounded-lg flex items-center justify-center"
          style={{
            backfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
            background: `linear-gradient(135deg, ${coverColor}11, ${coverColor}05)`,
            border: `1px solid ${coverColor}22`,
          }}
        >
          <span className="font-mono text-xs" style={{ color: `${coverColor}66` }}>NF</span>
        </div>
      </div>
    </div>
  );
}
```

### 2.5 全局平滑滚动

在 `src/main.tsx` 中集成 Lenis：

```tsx
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { useEffect } from 'react'
import Lenis from 'lenis'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import App from './App.tsx'

// 平滑滚动 Hook
function SmoothScrollProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    });

    function raf(time: number) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);

    return () => lenis.destroy();
  }, []);

  return <>{children}</>;
}

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <TRPCProvider>
      <SmoothScrollProvider>
        <App />
      </SmoothScrollProvider>
    </TRPCProvider>
  </BrowserRouter>,
)
```

---

## 3. 性能优化

### 3.1 Three.js 背景优化

- Canvas 设置 `gl={{ antialias: false, powerPreference: "low-power" }}`
- 平面几何体使用 16x16 细分（不要更高）
- 添加 `prefers-reduced-motion` 降级：

```tsx
// 在 HeroBackground 组件中检测
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (prefersReducedMotion) {
  return <div className="fixed inset-0 -z-10 bg-[#000000]" />;
}
```

### 3.2 大文本渲染优化

- 阅读器使用虚拟滚动（对超长篇目）
- 翻译结果使用 `content-visibility: auto` 分段渲染
- 生成内容超过 100 段时，未视口段落使用 `opacity` 占位

### 3.3 字体加载优化

在 `index.html` 的 `<head>` 中添加：

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet" />
```

Geist Mono 从 `geist` 包导入：

```typescript
import "geist/font/mono.css";
```

---

## 4. Docker 配置

### 4.1 Dockerfile

```dockerfile
# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Build
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules

# Environment
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/boot.js"]
```

### 4.2 docker-compose.yml

```yaml
version: "3.8"

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}
      - DEEPSEEK_BASE_URL=${DEEPSEEK_BASE_URL}
      - NODE_ENV=production
    volumes:
      - ./uploads:/app/uploads
    restart: unless-stopped
    depends_on:
      - db

  db:
    image: ankane/pgvector:latest
    environment:
      - POSTGRES_USER=novelforge
      - POSTGRES_PASSWORD=${DB_PASSWORD}
      - POSTGRES_DB=novelforge
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certbot/conf:/etc/letsencrypt:ro
      - ./certbot/www:/var/www/certbot:ro
    depends_on:
      - app
    restart: unless-stopped

volumes:
  pgdata:
```

### 4.3 nginx.conf

```nginx
events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;

    upstream app {
        server app:3000;
    }

    server {
        listen 80;
        server_name _;  # 使用 IP 或实际域名

        location / {
            proxy_pass http://app;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
        }

        location /api/trpc {
            proxy_pass http://app;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_read_timeout 300s;  # AI 生成可能需要较长时间
        }
    }
}
```

### 4.4 .env 模板

创建 `.env.example`：

```
# Database
DATABASE_URL=postgresql://novelforge:your_password@db:5432/novelforge

# DeepSeek
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_BASE_URL=https://api.deepseek.com

# App
NODE_ENV=production

# DB Password (for docker-compose)
DB_PASSWORD=your_secure_password
```

---

## 5. 部署步骤

### 5.1 阿里云 ECS 准备

1. 创建 ECS 实例（建议 2C4G 以上）
2. 开放安全组端口：22(SSH), 80(HTTP), 443(HTTPS), 3000(App)
3. 安装 Docker 和 Docker Compose：

```bash
# 安装 Docker
curl -fsSL https://get.docker.com | sh

# 安装 Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

### 5.2 部署应用

```bash
# 1. 克隆/上传代码到服务器
# 2. 复制环境变量
cp .env.example .env
# 编辑 .env 填入实际值

# 3. 启动服务
docker-compose up -d

# 4. 初始化数据库
docker-compose exec app npx drizzle-kit push

# 5. 检查日志
docker-compose logs -f app
```

### 5.3 配置 SSL（Let's Encrypt）

```bash
# 安装 certbot
docker run -it --rm \
  -v "$(pwd)/certbot/conf:/etc/letsencrypt" \
  -v "$(pwd)/certbot/www:/var/www/certbot" \
  certbot/certbot certonly --standalone \
  -d your-domain.com

# 更新 nginx.conf 启用 HTTPS
# 重启 nginx
docker-compose restart nginx
```

---

## 6. 交付物清单

- [ ] Neon Silk Three.js 背景 Shader 实现
- [ ] Liquid Glass 卡片动效实现
- [ ] Shimmer Text 扫光效果
- [ ] 3D Book 旋转效果
- [ ] Lenis 平滑滚动集成
- [ ] prefers-reduced-motion 降级支持
- [ ] Dockerfile 构建成功
- [ ] docker-compose.yml 可启动
- [ ] nginx.conf 配置正确
- [ ] 阿里云 ECS 部署文档
- [ ] `npm run check` 零错误
- [ ] `npm run build` 构建成功

---

## 7. 技术约束

1. Three.js Canvas 必须设置 `pointer-events: none`，不能阻挡 UI 交互
2. 液态反光效果的 mask-image 必须兼容 Webkit 前缀
3. Docker 镜像必须多阶段构建，减小最终镜像体积
4. nginx 对 /api/trpc 的超时时间必须设为 300s（AI 生成可能很慢）
5. 生产环境禁止输出 console.log
6. 所有静态资源必须使用相对路径
