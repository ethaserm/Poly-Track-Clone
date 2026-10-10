import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/**
 * Graphics presets. `decor` and `particles` scale scenery density and particle budgets;
 * `post` enables the composer (grading, vignette, speed blur), `bloom` the glow pass.
 */
export const QUALITY_PRESETS = {
  low: {
    label: 'Low',
    pixelRatio: 0.9,
    shadows: false,
    shadowMapSize: 1024,
    post: false,
    bloom: false,
    decor: 0.45,
    particles: 0.4,
    terrainSegments: 96,
  },
  medium: {
    label: 'Medium',
    pixelRatio: 1.25,
    shadows: true,
    shadowMapSize: 1024,
    post: true,
    bloom: false,
    decor: 0.75,
    particles: 0.7,
    terrainSegments: 140,
  },
  high: {
    label: 'High',
    pixelRatio: 1.75,
    shadows: true,
    shadowMapSize: 2048,
    post: true,
    bloom: true,
    decor: 1,
    particles: 1,
    terrainSegments: 180,
  },
  ultra: {
    label: 'Ultra',
    pixelRatio: 2,
    shadows: true,
    shadowMapSize: 4096,
    post: true,
    bloom: true,
    decor: 1.5,
    particles: 1.4,
    terrainSegments: 240,
  },
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.9 },
    uSaturation: { value: 1.08 },
    uContrast: { value: 1.04 },
    uSpeed: { value: 0 },
    uFlash: { value: new THREE.Vector4(1, 1, 1, 0) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uSpeed;
    uniform vec4 uFlash;
    varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5;
      vec4 c = texture2D(tDiffuse, vUv);
      // Radial speed blur, strongest towards the screen edges.
      if (uSpeed > 0.001) {
        float edge = smoothstep(0.08, 0.7, length(d));
        vec3 acc = c.rgb;
        for (int i = 1; i <= 6; i++) {
          acc += texture2D(tDiffuse, vUv - d * float(i) * 0.012 * uSpeed * edge).rgb;
        }
        c.rgb = acc / 7.0;
      }
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSaturation);
      c.rgb = (c.rgb - 0.18) * uContrast + 0.18;
      c.rgb *= 1.0 - dot(d, d) * uVignette;
      c.rgb = mix(c.rgb, uFlash.rgb, uFlash.a);
      gl_FragColor = vec4(max(c.rgb, 0.0), c.a);
    }`,
};

export class GameRenderer {
  constructor(container, qualityName = 'high') {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.width = 1;
    this.height = 1;
    this.flash = 0;
    this.flashColor = new THREE.Color(1, 1, 1);
    this.setQuality(qualityName);
  }

  get quality() {
    return QUALITY_PRESETS[this.qualityName];
  }

  setQuality(name) {
    this.qualityName = QUALITY_PRESETS[name] ? name : 'high';
    const q = this.quality;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(Math.min(dpr, q.pixelRatio));
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.needsUpdate = true;
    this.buildComposer();
    this.setSize(this.width, this.height);
  }

  buildComposer() {
    this.composer?.dispose?.();
    this.composer = null;
    const q = this.quality;
    if (!q.post) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.composer.addPass(this.renderPass);
    if (q.bloom) {
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.55, 1.05);
      this.composer.addPass(this.bloomPass);
    } else {
      this.bloomPass = null;
    }
    this.gradePass = new ShaderPass(GradeShader);
    this.composer.addPass(this.gradePass);
    this.composer.addPass(new OutputPass());
  }

  setSize(w, h) {
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  }

  /** 0..1 radial blur strength (race mode drives this from speed). */
  setSpeedEffect(v) {
    if (this.gradePass) this.gradePass.uniforms.uSpeed.value = v;
  }

  /** Brief full-screen tint, e.g. on checkpoints and respawns. */
  pulse(color, strength = 0.35) {
    this.flashColor.set(color);
    this.flash = Math.max(this.flash, strength);
  }

  render(scene, camera, dt = 1 / 60) {
    if (this.composer) {
      this.renderPass.scene = scene;
      this.renderPass.camera = camera;
      this.flash = Math.max(0, this.flash - dt * 1.6);
      const f = this.gradePass.uniforms.uFlash.value;
      f.set(this.flashColor.r, this.flashColor.g, this.flashColor.b, this.flash);
      this.composer.render(dt);
    } else {
      this.renderer.render(scene, camera);
    }
  }
}

// --- Environment maps for reflective materials (car paint, glass, chrome) -------------

const envCache = new Map();

/** Prefiltered environment map built from a tiny sky + ground scene in the theme's colours. */
export function themeEnvMap(renderer, theme, key) {
  if (envCache.has(key)) return envCache.get(key);
  const scene = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        top: { value: new THREE.Color(theme.skyTop) },
        horizon: { value: new THREE.Color(theme.skyHorizon) },
        ground: { value: new THREE.Color(theme.ground).multiplyScalar(0.7) },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; varying vec3 vDir;
        void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon * 0.8, ground, min(1.0, -h * 6.0));
        // A bright sun spot gives the paint a specular highlight.
        vec3 sunDir = normalize(vec3(0.45, 0.75, 0.3));
        c += vec3(6.0, 5.6, 5.0) * pow(max(dot(vDir, sunDir), 0.0), 220.0);
        gl_FragColor = vec4(c, 1.0); }`,
    }),
  );
  scene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.02);
  pmrem.dispose();
  sky.geometry.dispose();
  sky.material.dispose();
  envCache.set(key, rt.texture);
  return rt.texture;
}
