const DEFAULT_DIR_LIGHT = { x: 8, y: 12, z: 6 };
const DEFAULT_FILL_LIGHT = { x: -6, y: 6, z: -8 };

function buildDirectionVector(THREE, dir) {
  const vec = new THREE.Vector3(dir.x, dir.y, dir.z);
  return vec.normalize();
}

const vertexShader = `
  #include <common>
  #include <fog_pars_vertex>

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  #ifdef USE_COLOR
  varying vec3 vColor;
  #endif

  void main() {
    mat4 modelMat = modelMatrix;
  #ifdef USE_INSTANCING
    modelMat = modelMatrix * instanceMatrix;
  #endif
    vec4 worldPosition = modelMat * vec4(position, 1.0);
    vWorldPos = worldPosition.xyz;

    mat3 normalMat = mat3(modelMat);
    vNormal = normalize(normalMat * normal);

    vec4 mvPosition = viewMatrix * worldPosition;
    gl_Position = projectionMatrix * mvPosition;

  #ifdef USE_COLOR
    vColor = color;
  #endif
    #include <fog_vertex>
  }
`;

const fragmentShader = `
  #include <common>
  #include <fog_pars_fragment>

  uniform vec3 baseColor;
  uniform float ambient;
  uniform float bandCount;
  uniform float specIntensity;
  uniform float shininess;
  uniform vec3 lightDirection;
  uniform vec3 fillDirection;
  uniform float fillIntensity;

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  #ifdef USE_COLOR
  varying vec3 vColor;
  #endif

  float applyBands(float value, float bands) {
    bands = max(bands, 1.0);
    float scaled = value * bands;
    float idx = floor(scaled);
    idx = min(idx, bands - 1.0);
    float denom = max(bands - 1.0, 1.0);
    return idx / denom;
  }

  void main() {
    vec3 N = normalize(vNormal);
    vec3 L = normalize(lightDirection);
    vec3 V = normalize(cameraPosition - vWorldPos);

    float ndl = max(dot(N, L), 0.0);
    float ramp = applyBands(ndl, bandCount);

    float fill = 0.0;
    if (fillIntensity > 0.0) {
      fill = max(dot(N, normalize(fillDirection)), 0.0) * fillIntensity;
    }

    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), shininess) * specIntensity;

    float lit = ambient + ramp * (1.0 - ambient);
    lit += fill;

    vec3 color = baseColor;
  #ifdef USE_COLOR
    color *= vColor;
  #endif

    vec3 finalColor = color * lit + spec;
    gl_FragColor = vec4(finalColor, 1.0);
    #include <fog_fragment>
  }
`;

export function createToonRampMaterial(THREE, options = {}) {
  const {
    baseColor = 0xffffff,
    ambient = 0.3,
    bandCount = 4,
    specIntensity = 0.15,
    shininess = 48.0,
    lightDirection = DEFAULT_DIR_LIGHT,
    fillDirection = DEFAULT_FILL_LIGHT,
    fillIntensity = 0.18,
    vertexColors = false,
  } = options;

  const uniforms = {
    baseColor: { value: new THREE.Color(baseColor) },
    ambient: { value: ambient },
    bandCount: { value: bandCount },
    specIntensity: { value: specIntensity },
    shininess: { value: shininess },
    lightDirection: { value: buildDirectionVector(THREE, lightDirection) },
    fillDirection: { value: buildDirectionVector(THREE, fillDirection) },
    fillIntensity: { value: fillIntensity },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    fog: true,
    lights: false,
    transparent: false,
    vertexColors,
  });

  return material;
}

export function updateToonRampMaterial(material, updates = {}) {
  if (!material || !material.uniforms) return;
  if (updates.baseColor !== undefined) {
    if (typeof updates.baseColor === 'number') {
      material.uniforms.baseColor.value.setHex(updates.baseColor);
    } else {
      material.uniforms.baseColor.value.copy(updates.baseColor);
    }
  }
  if (updates.ambient !== undefined) {
    material.uniforms.ambient.value = updates.ambient;
  }
  if (updates.bandCount !== undefined) {
    material.uniforms.bandCount.value = updates.bandCount;
  }
  if (updates.specIntensity !== undefined) {
    material.uniforms.specIntensity.value = updates.specIntensity;
  }
  if (updates.shininess !== undefined) {
    material.uniforms.shininess.value = updates.shininess;
  }
  if (updates.fillIntensity !== undefined) {
    material.uniforms.fillIntensity.value = updates.fillIntensity;
  }
  if (updates.lightDirection) {
    material.uniforms.lightDirection.value.copy(updates.lightDirection).normalize();
  }
  if (updates.fillDirection) {
    material.uniforms.fillDirection.value.copy(updates.fillDirection).normalize();
  }
  material.uniformsNeedUpdate = true;
}
