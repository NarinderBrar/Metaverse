import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { MaterialKind, PlayerState } from "../shared/protocol";

const sharedGeometry = new THREE.BoxGeometry(1, 1, 1, 3, 3, 3);

export class PlayerEntity {
  readonly root = new THREE.Group();
  readonly target = new THREE.Vector3();
  readonly materialName: string;
  targetRotationY = 0;
  private readonly material: THREE.Material;
  private readonly labelElement: HTMLDivElement;

  constructor(readonly id: string, readonly name: string, color: number, materialKind: MaterialKind, isLocal = false) {
    this.material = createPlayerMaterial(materialKind, color);
    this.materialName = materialKind;
    const cube = new THREE.Mesh(sharedGeometry, this.material);
    cube.castShadow = true;
    cube.receiveShadow = true;
    this.root.add(cube);

    if (isLocal) {
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(sharedGeometry),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }),
      );
      outline.scale.setScalar(1.035);
      this.root.add(outline);
    }

    this.labelElement = document.createElement("div");
    this.labelElement.className = `player-label${isLocal ? " local" : ""}`;
    const labelObject = new CSS2DObject(this.labelElement);
    labelObject.position.set(0, 1.05, 0);
    this.root.add(labelObject);
  }

  applyState(player: PlayerState): void {
    this.root.position.set(player.x, 0.5, player.z);
    this.root.rotation.y = player.rotationY;
    this.target.copy(this.root.position);
    this.targetRotationY = player.rotationY;
    this.updateStatus(player.score, player.alive, player.id === this.id && this.labelElement.classList.contains("local"));
  }

  updateStatus(score: number, alive: boolean, isLocal = this.labelElement.classList.contains("local")): void {
    this.labelElement.textContent = `${this.name}${isLocal ? " · you" : ""}  ◇ ${score}`;
    this.labelElement.classList.toggle("eliminated", !alive);
    this.root.visible = alive;
  }

  setTarget(x: number, z: number, rotationY: number): void {
    this.target.set(x, 0.5, z);
    this.targetRotationY = rotationY;
  }

  updateRemote(delta: number): void {
    const alpha = 1 - Math.exp(-12 * delta);
    this.root.position.lerp(this.target, alpha);
    const angleDelta = Math.atan2(Math.sin(this.targetRotationY - this.root.rotation.y), Math.cos(this.targetRotationY - this.root.rotation.y));
    this.root.rotation.y += angleDelta * alpha;
  }

  dispose(): void {
    if ("map" in this.material && this.material.map instanceof THREE.Texture) this.material.map.dispose();
    this.material.dispose();
    this.root.traverse((object) => {
      if (object instanceof CSS2DObject) object.element.remove();
      if (object instanceof THREE.LineSegments) {
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      }
    });
    this.root.removeFromParent();
  }
}

function createPlayerMaterial(kind: MaterialKind, color: number): THREE.Material {
  if (kind === "glass") {
    return new THREE.MeshPhysicalMaterial({ color, roughness: 0.08, metalness: 0, transmission: 0.88, thickness: 1.2, ior: 1.45, transparent: true, opacity: 0.92, clearcoat: 1, clearcoatRoughness: 0.06 });
  }
  if (kind === "rubber") {
    return new THREE.MeshPhysicalMaterial({ color, roughness: 0.94, metalness: 0, sheen: 0.8, sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35), sheenRoughness: 0.7 });
  }
  if (kind === "wood") {
    return new THREE.MeshStandardMaterial({ color: 0xffffff, map: createWoodTexture(color), roughness: 0.68, metalness: 0.02 });
  }
  if (kind === "metal") {
    return new THREE.MeshPhysicalMaterial({ color, roughness: 0.2, metalness: 0.92, clearcoat: 0.45, clearcoatRoughness: 0.15 });
  }
  if (kind === "ceramic") {
    return new THREE.MeshPhysicalMaterial({ color, roughness: 0.16, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08 });
  }
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.05, metalness: 0.08, transmission: 0.5, thickness: 1.8, ior: 1.8, iridescence: 0.75, iridescenceIOR: 1.5, clearcoat: 1 });
}

function createWoodTexture(color: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const base = new THREE.Color(color).lerp(new THREE.Color(0x8b5a2b), 0.62);
  context.fillStyle = `#${base.getHexString()}`;
  context.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 3) {
    const wave = Math.sin(y * 0.13) * 7 + Math.sin(y * 0.035) * 13;
    context.strokeStyle = `rgba(45, 22, 8, ${0.08 + (y % 11) / 90})`;
    context.lineWidth = 1 + (y % 5) * 0.25;
    context.beginPath();
    context.moveTo(0, y + wave);
    context.bezierCurveTo(70, y - wave, 170, y + wave * 1.6, 256, y - wave * 0.4);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.5, 1.5);
  return texture;
}
