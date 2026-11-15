import * as THREE from 'three';
import { STAGE_RADIUS_CM, type PrevisKey, type PrevisPlan } from './visualPrevis.mjs';
import { STAGE_SENSOR_WIDTH_MM } from './cameraPlanning';

const VIDEO_WIDTH = 960;
const VIDEO_HEIGHT = 540;

export function createPrevisStage(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(VIDEO_WIDTH, VIDEO_HEIGHT, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#222a30');
  scene.fog = new THREE.Fog('#222a30', 12, 33);
  const camera = new THREE.PerspectiveCamera(40, VIDEO_WIDTH / VIDEO_HEIGHT, 0.05, 70);
  camera.filmGauge = STAGE_SENSOR_WIDTH_MM;
  const aim = new THREE.Vector3();
  const lighting = new THREE.HemisphereLight('#eef2ff', '#91917b', 2.25);
  const keyLight = new THREE.DirectionalLight('#fff5db', 1.5);
  keyLight.position.set(-6, 10, 8);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(36, 36), new THREE.MeshLambertMaterial({ color: '#3a4847' }));
  floor.rotation.x = -Math.PI / 2;
  const grid = new THREE.GridHelper(24, 24, '#9aaca2', '#596863');
  grid.position.y = 0.005;

  const marker = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.29, 0.98, 6, 12), new THREE.MeshLambertMaterial({ color: '#e6af5b' }));
  body.position.y = 0.82;
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.293, 0.293, 0.16, 16), new THREE.MeshLambertMaterial({ color: '#3c3d37' }));
  stripe.position.y = 0.87;
  const base = new THREE.Mesh(new THREE.CircleGeometry(0.46, 24), new THREE.MeshBasicMaterial({ color: '#e6af5b' }));
  base.rotation.x = -Math.PI / 2;
  base.position.y = 0.009;
  marker.add(body, stripe, base);
  scene.add(floor, grid, marker, lighting, keyLight);

  const pillarMaterial = new THREE.MeshLambertMaterial({ color: '#747e78' });
  const pillarGeometry = new THREE.BoxGeometry(0.38, 2.6, 0.38);
  for (const [x, z] of [[-3.7, -1.1], [4.6, -1.4], [-5, -5], [0.8, -6.7], [5, -6]]) {
    const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    pillar.position.set(x, 1.3, z);
    scene.add(pillar);
  }

  return {
    draw(sample: PrevisKey) {
      camera.position.set(sample.cameraX / 100, sample.cameraY / 100, sample.cameraZ / 100);
      marker.position.set(sample.subjectX / 100, 0, sample.subjectZ / 100);
      aim.set(marker.position.x, sample.aimHeight / 100, marker.position.z);
      if (aim.distanceToSquared(camera.position) < 0.0001) aim.z -= 1;
      camera.lookAt(aim);
      camera.setFocalLength(sample.lensMm);
      renderer.render(scene, camera);
    },
    dispose() {
      // Each geometry or material may be shared by multiple objects.
      const resources = new Set<THREE.BufferGeometry | THREE.Material>();
      scene.traverse(object => {
        if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
        resources.add(object.geometry);
        (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => resources.add(material));
      });
      resources.forEach(resource => resource.dispose());
      renderer.dispose();
    },
  };
}

export function drawPrevisMap(canvas: HTMLCanvasElement, plan: PrevisPlan, sample: PrevisKey) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const size = canvas.width;
  const scale = size / (STAGE_RADIUS_CM * 2);
  const origin = size / 2;
  context.fillStyle = '#232b2b';
  context.fillRect(0, 0, size, size);
  context.strokeStyle = '#3d4845';
  context.lineWidth = 1;
  context.beginPath();
  for (let i = 1; i < 12; i += 1) {
    const at = i * size / 12;
    context.moveTo(at, 0);
    context.lineTo(at, size);
    context.moveTo(0, at);
    context.lineTo(size, at);
  }
  context.stroke();
  for (const [x, z, color] of [
    ['cameraX', 'cameraZ', '#a8cff0'], ['subjectX', 'subjectZ', '#e6af5b'],
  ] as const) {
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.beginPath();
    for (const [index, key] of plan.keyframes.entries()) {
      const point = [origin + key[x] * scale, origin + key[z] * scale] as const;
      if (index) context.lineTo(...point);
      else context.moveTo(...point);
    }
    context.stroke();
    context.fillStyle = color;
    context.beginPath();
    context.arc(origin + sample[x] * scale, origin + sample[z] * scale, 4.5, 0, 2 * Math.PI);
    context.fill();
  }
}
