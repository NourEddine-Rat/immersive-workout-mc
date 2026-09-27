import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { restyle, light } from './subway/theme.js';

// Map assets: “Sub Way Surf Assets” by Giovanni Messina, CC-BY-4.0.
// Attribution and original source: subway/models/assets_messina/license.txt.
export function createSubwayEnvironment() {
    const scene = new THREE.Scene();
    light(scene, false, 'day');
    const camera = new THREE.PerspectiveCamera(55, 1, .1, 350);
    const target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
    const track = new THREE.Group();
    track.rotation.y = -Math.PI / 2;
    track.position.set(12.7, -1.3, 0);
    scene.add(track);
    let ready = false;
    let needsCapture = true;

    const loaded = (async () => {
        const path = './subway/models/assets_messina/';
        const response = await fetch(path + 'scene.gltf');
        if (!response.ok) throw new Error('Subway map could not load: ' + response.status);
        const json = await response.json();
        // This asset predates the metallic/roughness material format.
        for (const material of json.materials || []) {
            const spec = material.extensions?.KHR_materials_pbrSpecularGlossiness;
            if (spec) material.pbrMetallicRoughness = {
                baseColorTexture: spec.diffuseTexture,
                baseColorFactor: spec.diffuseFactor || [1, 1, 1, 1],
                metallicFactor: 0, roughnessFactor: 1
            };
        }
        json.extensionsUsed = (json.extensionsUsed || []).filter(e => e !== 'KHR_materials_pbrSpecularGlossiness');
        json.extensionsRequired = (json.extensionsRequired || []).filter(e => e !== 'KHR_materials_pbrSpecularGlossiness');
        const gltf = await new GLTFLoader().parseAsync(JSON.stringify(json), path);
        gltf.scene.updateMatrixWorld(true);
        function piece(name, corridor = false) {
            const source = gltf.scene.getObjectByName(name);
            if (!source) throw new Error('Missing Subway map piece: ' + name);
            const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
            geometry.computeBoundingBox();
            const box = geometry.boundingBox;
            geometry.translate(-(box.min.x + box.max.x) / 2, 0,
                corridor ? 0 : -(box.min.z + box.max.z) / 2);
            geometry.computeBoundingBox();
            if (corridor) geometry.translate(-geometry.boundingBox.max.x + 1.9, 0, 0);
            const material = new THREE.MeshLambertMaterial({
                map: restyle(source.material.map, 1024, corridor ? 'place' : 'train'),
                color: 0xffffff
            });
            if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
            return new THREE.Mesh(geometry, material);
        }
        const tile = piece('StaticMeshActor_236_Material_6_0', true);
        for (let i = -1; i < 6; i++) {
            const mesh = tile.clone();
            mesh.position.x = -i * 38.4;
            track.add(mesh);
        }
        const train = piece('StaticMeshActor_265_Material_7_0');
        for (const [distance, lane] of [[-3, 10.5], [-15, 14.9], [-65, 10.5]]) {
            const mesh = train.clone();
            mesh.position.set(distance, 0, lane);
            track.add(mesh);
        }
        const barrier = piece('StaticMeshActor_239_Material_6_0');
        barrier.position.set(-3.8, 0, 12.7);
        track.add(barrier);
        // Only the selected corridor and train templates are needed in this lobby.
        const geometries = new Set(), materials = new Set();
        gltf.scene.traverse(o => {
            if (o.isMesh) {
                geometries.add(o.geometry);
                for (const m of [].concat(o.material)) materials.add(m);
            }
        });
        geometries.forEach(g => g.dispose());
        materials.forEach(m => m.dispose());
        ready = true;
    })();
    return {
        target, loaded,
        get ready() { return ready; },
        resize(w, h) {
            // Capture a still at the current aspect ratio; animate only the image shader.
            const ratio = Math.min(devicePixelRatio, 2, 2560 / w);
            target.setSize(Math.max(1, Math.round(w * ratio)), Math.max(1, Math.round(h * ratio)));
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            needsCapture = true;
        },
        render(renderer) {
            if (!ready || !needsCapture) return;
            camera.position.set(0, 1.25, 3.5);
            camera.lookAt(0, 1.7, -38);
            renderer.setRenderTarget(target);
            renderer.clear();
            renderer.render(scene, camera);
            renderer.setRenderTarget(null);
            needsCapture = false;
        }
    };
}
