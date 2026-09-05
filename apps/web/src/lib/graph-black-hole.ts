import * as THREE from "three";

export const MAX_GRAPH_LENSES = 8;
export const BLACK_HOLE_EXTENT = 4;

// A bounded screen-space approximation, not relativistic ray tracing.
export const GRAPH_LENS_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uLenses: { value: Array.from({ length: MAX_GRAPH_LENSES }, () => new THREE.Vector4()) },
    uCount: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec4 uLenses[${MAX_GRAPH_LENSES}];
    uniform int uCount;
    uniform float uAspect;
    varying vec2 vUv;
    void main() {
      vec2 displacement = vec2(0.0);
      float strongest = 0.0;
      for (int i = 0; i < ${MAX_GRAPH_LENSES}; i++) {
        if (i >= uCount) break;
        vec4 lens = uLenses[i]; // center UV, projected core radius, strength
        vec2 delta = (vUv - lens.xy) * vec2(uAspect, 1.0);
        float radiusSq = lens.z * lens.z;
        float distanceSq = dot(delta, delta);
        // Most pixels miss every lens: reject before square root / falloff work.
        if (distanceSq < 1.1025 * radiusSq || distanceSq > 14.44 * radiusSq) continue;
        float r = sqrt(distanceSq / max(radiusSq, 0.00000001));
        // Preserve the core/photon ring; bend the surrounding scene smoothly.
        float bend = smoothstep(1.05, 1.5, r) * (1.0 - smoothstep(1.6, 3.8, r));
        float amount = lens.z * 0.38 * bend * lens.w;
        // Strongest lens wins where bounds overlap: no unbounded accumulation.
        if (amount > strongest) {
          strongest = amount;
          displacement = delta / max(r * lens.z, 0.00001) * vec2(1.0 / uAspect, 1.0) * amount;
        }
      }
      gl_FragColor = texture2D(tDiffuse, clamp(vUv - displacement, vec2(0.0), vec2(1.0)));
    }
  `,
};

export interface ProjectedGraphLens {
  id: string;
  x: number;
  y: number;
  radius: number;
  focused: boolean;
}

/** Cull before the shader, prioritizing focus and then visible size. */
export function selectGraphLenses(lenses: ProjectedGraphLens[], aspect: number): ProjectedGraphLens[] {
  return lenses.filter((lens) => (
    Number.isFinite(lens.radius) && lens.radius > 0
    && Number.isFinite(lens.x) && Number.isFinite(lens.y)
    && lens.x + 3.8 * lens.radius / aspect >= 0
    && lens.x - 3.8 * lens.radius / aspect <= 1
    && lens.y + 3.8 * lens.radius >= 0 && lens.y - 3.8 * lens.radius <= 1
  )).sort((a, b) => Number(b.focused) - Number(a.focused) || b.radius - a.radius)
    .slice(0, MAX_GRAPH_LENSES);
}

/** Camera-facing image of a fixed orbital plane plus its lensed far side. */
export function createBlackHoleMaterial(color: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uTime: { value: 0 },
      uFocus: { value: 0 },
      uOpacity: { value: 1 },
      uInclination: { value: 0.45 },
      uAngle: { value: 0 },
      uDetail: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uTime, uFocus, uOpacity, uInclination, uAngle, uDetail;
      varying vec2 vUv;
      void main() {
        // One unit is the shadow radius, independent of disk inclination.
        vec2 p = (vUv - 0.5) * ${BLACK_HOLE_EXTENT * 2}.0;
        float r = length(p);
        float c = cos(uAngle), s = sin(uAngle);
        vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
        float inclination = clamp(uInclination, 0.0, 1.0);
        vec2 disk = vec2(q.x, q.y / mix(0.12, 1.0, inclination));
        float diskR = length(disk);
        float angle = atan(disk.y, disk.x);
        float grains = 0.72;
        if (uDetail > 0.01) {
          float bands = sin(diskR * 21.0 + sin(angle * 5.0 + diskR * 3.0 - uTime * 0.35));
          grains += uDetail * (0.14 * bands + 0.10 * sin(angle * 33.0 - uTime + diskR * 12.0));
        }
        float diskLight = smoothstep(1.3, 1.55, diskR) * (1.0 - smoothstep(2.3, 3.6, diskR));
        // Approximate the far-side image wrapping above/below the shadow.
        float arcRadius = 1.25 + 0.60 * abs(q.y) / max(r, 0.001);
        float arc = exp(-pow((r - arcRadius) / 0.13, 2.0));
        arc *= pow(abs(q.y) / max(r, 0.001), 0.7) * (1.0 - inclination) * 0.72;
        float aa = max(fwidth(r), 0.008);
        float photon = exp(-pow((r - 1.075) / max(aa, 0.025), 2.0));
        float outside = smoothstep(0.98, 1.02, r);
        float light = (diskLight * grains * (0.78 + 0.22 * cos(angle)) + arc + photon) * outside;
        vec3 warm = mix(uColor, vec3(1.0, 0.80, 0.51), 0.45);
        vec3 rgb = warm * light * (1.15 + 0.25 * uFocus) + vec3(0.65, 0.82, 1.0) * photon * 0.8;
        // Opaque shadow on the billboard avoids an unlit sphere looking like a marble.
        float shadow = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
        float alpha = max(shadow, clamp(light, 0.0, 1.0)) * uOpacity;
        if (alpha < 0.005) discard;
        gl_FragColor = vec4(rgb, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

/** Spatially continuous mineral bands: no texture downloads or per-node maps. */
export function createRepositoryMaterial(color: THREE.Color, seed: number): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: color.clone(), roughness: 0.72, metalness: 0.16,
    emissive: color.clone(), emissiveIntensity: 0.025, envMapIntensity: 0.35,
    transparent: true,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSurfaceSeed = { value: seed };
    shader.vertexShader = `varying vec3 vSurfacePosition;\n${shader.vertexShader}`
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSurfacePosition = position;");
    shader.fragmentShader = `
      varying vec3 vSurfacePosition;
      uniform float uSurfaceSeed;
      float surfaceHash(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.yzx + 33.33);
        return fract((p.x + p.y) * p.z);
      }
      float surfaceNoise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(surfaceHash(i), surfaceHash(i + vec3(1,0,0)), f.x),
              mix(surfaceHash(i + vec3(0,1,0)), surfaceHash(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(surfaceHash(i + vec3(0,0,1)), surfaceHash(i + vec3(1,0,1)), f.x),
              mix(surfaceHash(i + vec3(0,1,1)), surfaceHash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      ${shader.fragmentShader}`
      .replace("#include <color_fragment>", `#include <color_fragment>
        vec3 p = normalize(vSurfacePosition);
        vec3 offset = vec3(uSurfaceSeed * 0.17);
        float veins = surfaceNoise(p * 5.0 + offset);
        float mineral = surfaceNoise(p * 16.0 + offset);
        float grain = surfaceNoise(p * 48.0 + offset);
        diffuseColor.rgb *= 0.52 + 0.38 * veins + 0.18 * mineral;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32), smoothstep(0.65, 0.88, mineral) * 0.18);
      `)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + 0.22 * (veins - 0.5) + 0.14 * (grain - 0.5), 0.35, 0.95);
      `);
  };
  material.customProgramCacheKey = () => "graph-mineral-v1";
  return material;
}
