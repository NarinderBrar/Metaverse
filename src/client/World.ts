import * as THREE from "three";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { WORLD_LIMIT } from "../shared/protocol";

export class World {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 120);
  readonly renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  readonly labels = new CSS2DRenderer();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly desiredCameraTarget = new THREE.Vector3();
  private readonly desiredCameraPosition = new THREE.Vector3();
  private cameraTargetInitialized = false;

  constructor(container: HTMLElement) {
    this.scene.background = new THREE.Color(0x07111f);
    this.scene.fog = new THREE.Fog(0x07111f, 28, 62);
    this.camera.position.set(10, 12, 14);

    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    container.append(this.renderer.domElement);

    const environmentGenerator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = environmentGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    environmentGenerator.dispose();

    this.labels.setSize(innerWidth, innerHeight);
    this.labels.domElement.className = "labels";
    container.append(this.labels.domElement);

    this.scene.add(new THREE.HemisphereLight(0xb9e6ff, 0x182231, 2.1));
    const sun = new THREE.DirectionalLight(0xffffff, 3.1);
    sun.position.set(10, 18, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -24;
    sun.shadow.camera.right = sun.shadow.camera.top = 24;
    this.scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_LIMIT * 2, WORLD_LIMIT * 2),
      new THREE.MeshStandardMaterial({ color: 0x13253b, roughness: 0.92 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(WORLD_LIMIT * 2, WORLD_LIMIT * 2, 0x3f6787, 0x25435d);
    grid.position.y = 0.012;
    this.scene.add(grid);
    this.addBoundaries();
    addEventListener("resize", this.resize);
  }

  render(focus?: THREE.Vector3, delta = 1 / 60): void {
    if (focus) {
      if (!this.cameraTargetInitialized) {
        this.cameraTarget.set(focus.x, 0, focus.z);
        this.camera.position.set(focus.x + 10, 12, focus.z + 14);
        this.cameraTargetInitialized = true;
      }
      const targetAlpha = 1 - Math.exp(-9 * delta);
      const positionAlpha = 1 - Math.exp(-6 * delta);
      this.desiredCameraTarget.set(focus.x, 0, focus.z);
      this.cameraTarget.lerp(this.desiredCameraTarget, targetAlpha);
      this.desiredCameraPosition.set(this.cameraTarget.x + 10, 12, this.cameraTarget.z + 14);
      this.camera.position.lerp(this.desiredCameraPosition, positionAlpha);
      this.camera.lookAt(this.cameraTarget);
    }
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }

  private addBoundaries(): void {
    const material = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x0e7490, emissiveIntensity: 0.28, transparent: true, opacity: 0.42 });
    const horizontal = new THREE.BoxGeometry(WORLD_LIMIT * 2 + 0.4, 0.35, 0.18);
    const vertical = new THREE.BoxGeometry(0.18, 0.35, WORLD_LIMIT * 2 + 0.4);
    for (const z of [-WORLD_LIMIT, WORLD_LIMIT]) {
      const wall = new THREE.Mesh(horizontal, material);
      wall.position.set(0, 0.17, z);
      this.scene.add(wall);
    }
    for (const x of [-WORLD_LIMIT, WORLD_LIMIT]) {
      const wall = new THREE.Mesh(vertical, material);
      wall.position.set(x, 0.17, 0);
      this.scene.add(wall);
    }
  }

  private readonly resize = (): void => {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.labels.setSize(innerWidth, innerHeight);
  };
}
