import { useRef, useMemo, useEffect, useState } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import * as THREE from "three"

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
`

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
`

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
`

function SilkPlane() {
  const meshRef = useRef<THREE.Mesh>(null)
  const mouseRef = useRef(new THREE.Vector2(0, 0))
  const materialRef = useRef<THREE.ShaderMaterial>(null)

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(0, 0) },
      uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    }),
    []
  )

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime
      const target = mouseRef.current
      const current = materialRef.current.uniforms.uMouse.value as THREE.Vector2
      current.x += (target.x - current.x) * 0.05
      current.y += (target.y - current.y) * 0.05
    }
  })

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      mouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1
      mouseRef.current.y = -(e.clientY / window.innerHeight) * 2 + 1
    }
    window.addEventListener("mousemove", handler)
    return () => window.removeEventListener("mousemove", handler)
  }, [])

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
  )
}

export default function HeroBackground() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    setPrefersReducedMotion(mq.matches)
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  if (prefersReducedMotion) {
    return <div className="fixed inset-0 -z-10 bg-[#000000]" />
  }

  return (
    <div className="fixed inset-0 -z-10" style={{ pointerEvents: "none" }}>
      <Canvas
        camera={{ position: [0, 0, 1] }}
        frameloop="always"
        gl={{ antialias: false, alpha: false, powerPreference: "low-power" }}
        style={{ width: "100%", height: "100%", background: "#000000" }}
      >
        <SilkPlane />
      </Canvas>
    </div>
  )
}
