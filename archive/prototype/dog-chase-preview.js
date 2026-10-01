// A preview of the chasing dog and the look back, on its own: no phone, no
// game. Approve it here, then it goes into game.js.

import * as THREE from 'three';
import { World } from './world.js';
import { Player, EYE } from './player.js';
import { DogChase } from './dog-chase.js';
import { LookBack } from './look-back.js';
import { langInit } from './localization.js';
langInit();

const $ = id => document.getElementById(id);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.insertBefore(renderer.domElement, document.body.firstChild); renderer.domElement.id = "gl";
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8db9ea);
scene.fog = new THREE.Fog(0x9fc4ec, 70, 230);
scene.add(new THREE.HemisphereLight(0xffffff, 0x6f8a5a, 1.35));
const sun = new THREE.DirectionalLight(0xfff2dc, 0.55); sun.position.set(3, 8, 2); scene.add(sun);
const camera = new THREE.PerspectiveCamera(74, 16 / 9, 0.1, 400);
{
  const g = new THREE.SphereGeometry(300, 24, 12);
  const m = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x5f97dc) }, bottom: { value: new THREE.Color(0xc8e0f6) } },
    vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying float h; void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.05, 0.5, h)), 1.0); }' });
  const sky = new THREE.Mesh(g, m); sky.name = 'sky'; scene.add(sky);
}
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

const world = new World(scene);
const player = new Player();
const dog = new DogChase(scene);
const look = new LookBack();
let speed = 11, closeRate = 1.8, gap = 16, last = 0, lookYaw = 0;
$('speed').oninput = () => { speed = +$('speed').value; $('speedV').textContent = speed; };
$('close').oninput = () => { closeRate = +$('close').value; $('closeV').textContent = closeRate.toFixed(1); };
$('reset').onclick = () => { gap = 16; };
$('look').onclick = () => { look.reset(); look.maybe(performance.now() / 1000, Math.min(gap, 8), true, true); };

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
  const t = now / 1000;
  player.update(dt, speed);
  world.updateTiles(player.distance);
  world.animate(t);
  // the dog gains; when it reaches you it resets, so the loop goes on
  gap = Math.max(0.6, gap - closeRate * dt);
  if (gap <= 0.6) gap = 16;
  if ($('auto').checked) look.maybe(t, gap, true, true);
  const L = look.update(dt);
  // while you look, the dog is drawn a little nearer than it is: at 9 m a dog is a dot, at 5 it is a dog
  dog.update(dt, gap, { lane: player.lane, distance: player.distance, speed }, L.active ? Math.min(gap, 5) : gap);
  lookYaw += (L.yaw - lookYaw) * Math.min(1, dt * 30);

  const pose = player.cameraPose();
  camera.position.set(pose.x, pose.y, -player.distance);
  // turning the head: yaw about the vertical, with a little dip and roll so it feels like a body, not a tripod
  const roll = Math.sin(L.yaw) * 0.06, pitch = Math.sin(L.yaw) * -0.08;
  camera.rotation.set(pose.pitch + pitch, L.yaw, pose.roll + roll, 'YXZ');
  camera.fov = 72 + (L.active ? 6 * Math.sin(L.yaw / 2) : 0); camera.updateProjectionMatrix();
  scene.getObjectByName('sky').position.copy(camera.position);
  world.backdrop.position.z = camera.position.z;
  renderer.render(scene, camera);

  $('run').style.opacity = L.alpha; $('run').style.setProperty('--s', String(1 + 0.08 * Math.sin(t * 9)));
  $('runAr').style.opacity = L.alpha;
  $('vignette').style.opacity = L.active ? L.alpha * 0.9 : Math.max(0, (6 - gap) / 6) * 0.7;
  $('gapV').textContent = gap.toFixed(1) + ' m';
  $('hud').textContent = `${L.active ? L.phase.toUpperCase() : 'running'} · dog ${gap.toFixed(1)} m behind · looks so far: ${look.count}`;
}

(async () => { await world.load(); await dog.load(); requestAnimationFrame(frame); })();
