import * as THREE from '../engine/three/three.module.js';
import { Rig, qa } from '../engine/body/rig.js';
import { GLTFLoader } from '../engine/three/GLTFLoader.js';

export async function createBodyView(container) {
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
  renderer.setSize(container.clientWidth||350,290);
  renderer.setClearColor(0x000000,0);container.append(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(32,1,0.1,30);
  camera.position.set(0,1.1,4.7);camera.lookAt(0,1,0);
  scene.add(new THREE.HemisphereLight(0xc9ffff,0x142129,2.4));
  for (const [color,x,y,z,intensity] of [[0xbdfd99,-2,3,2,5],[0x81f6ff,2,1,1,6],[0x538ac8,0,2,-2,5]]) {const l=new THREE.DirectionalLight(color,intensity);l.position.set(x,y,z);scene.add(l);}
  const gltf=await new GLTFLoader().loadAsync(new URL('../engine/body/coach.glb', import.meta.url).href);
  const body=gltf.scene;
  body.traverse(n=>{if(n.isMesh){n.material=new THREE.MeshStandardMaterial({color:0xa6d9ce,metalness:.58,roughness:.32});n.frustumCulled=false;}});
  const rig = new Rig(body, n => n.replace(/^mixamorig:?/, '').replace(/_\d+$/, ''));
  rig.rot('LeftArm', qa([0,0,1],-68));
  rig.rot('RightArm', qa([0,0,1],68));
  body.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(body),size=box.getSize(new THREE.Vector3());
  body.scale.multiplyScalar(2/size.y);body.updateMatrixWorld(true);
  const fit=new THREE.Box3().setFromObject(body),center=fit.getCenter(new THREE.Vector3());body.position.x-=center.x;body.position.z-=center.z;body.position.y-=fit.min.y;
  const turntable=new THREE.Group();turntable.add(body);scene.add(turntable);turntable.rotation.y=-.3;
  const base=new THREE.Mesh(new THREE.CylinderGeometry(.48,.53,.07,64),new THREE.MeshStandardMaterial({color:0x11181a,metalness:.5,roughness:.4}));base.position.y=-.06;scene.add(base);
  function resize(){const w=container.clientWidth||350,h=container.clientHeight||290;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();}
  const observer=new ResizeObserver(resize);observer.observe(container);resize();
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');let active=false,id=0;
  function draw(t=0){if(!active)return;if(!reduced.matches)turntable.rotation.y=-.25+Math.sin(t*.00028)*.18;renderer.render(scene,camera);id=requestAnimationFrame(draw);}
  function start(){if(active)return;active=true;resize();draw();}
  function stop(){active=false;cancelAnimationFrame(id);}
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();else if(!container.closest('section').hidden)start();});
  return {start,stop};
}
