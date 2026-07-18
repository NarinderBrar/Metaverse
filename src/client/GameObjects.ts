import * as THREE from "three";
import type { DropState, ProjectileState } from "../shared/protocol";

// Intentionally faceted: an icosahedron gives the drop a crisp low-poly look
// with a fraction of the vertices of the previous UV sphere.
const dropGeometry = new THREE.IcosahedronGeometry(0.36, 1);
const dropMaterial = new THREE.MeshPhysicalMaterial({ color: 0x38bdf8, emissive: 0x0369a1, emissiveIntensity: 0.65, roughness: 0.04, transmission: 0.72, thickness: 0.8, ior: 1.33, clearcoat: 1 });
const projectileBodyGeometry = new THREE.CylinderGeometry(0.18, 0.18, 0.72, 6, 1, false);
const projectileTipGeometry = new THREE.ConeGeometry(0.215, 0.4, 6, 1, false);
const projectileBodyMaterial = new THREE.MeshStandardMaterial({ color: 0xe11d48, emissive: 0x7f071f, emissiveIntensity: 1.5, roughness: 0.42, metalness: 0.38, flatShading: true });
const projectileTipMaterial = new THREE.MeshStandardMaterial({ color: 0x080a0d, roughness: 0.3, metalness: 0.7, flatShading: true });

export class DropEntity {
  readonly root = new THREE.Group();
  private readonly phase = Math.random() * Math.PI * 2;

  constructor(readonly id: string, state: DropState) {
    const drop = new THREE.Mesh(dropGeometry, dropMaterial);
    drop.scale.set(0.78, 1.35, 0.78);
    drop.castShadow = true;
    this.root.add(drop);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.025, 3, 10),
      new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.62 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.38;
    this.root.add(ring);
    this.root.position.set(state.x, 0.72, state.z);
  }

  update(time: number): void {
    this.root.position.y = 0.72 + Math.sin(time * 2.4 + this.phase) * 0.13;
    this.root.rotation.y = time * 0.7 + this.phase;
  }

  dispose(): void {
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh && object.material !== dropMaterial) {
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      }
    });
    this.root.removeFromParent();
  }
}

export class ProjectileEntity {
  readonly root = new THREE.Group();
  readonly velocity = new THREE.Vector3();
  private readonly serverPosition = new THREE.Vector3();
  private readonly correction = new THREE.Vector3();

  constructor(readonly id: string, state: ProjectileState) {
    const bullet = new THREE.Group();
    const body = new THREE.Mesh(projectileBodyGeometry, projectileBodyMaterial);
    body.castShadow = true;
    bullet.add(body);
    const tip = new THREE.Mesh(projectileTipGeometry, projectileTipMaterial);
    tip.position.y = 0.56;
    tip.castShadow = true;
    bullet.add(tip);
    // Cylinder and cone are authored on Y; rotate the assembly so the nose
    // points down local +X, then rotate the root across the ground plane.
    bullet.rotation.z = -Math.PI / 2;
    this.root.add(bullet);
    const light = new THREE.PointLight(0xff174f, 2.8, 3.5, 2);
    this.root.add(light);
    this.apply(state, true);
  }

  apply(state: ProjectileState, immediate = false): void {
    this.serverPosition.set(state.x, 0.55, state.z);
    this.velocity.set(state.vx, 0, state.vz);
    this.root.rotation.y = Math.atan2(-state.vz, state.vx);
    if (immediate) {
      this.root.position.copy(this.serverPosition);
      this.correction.set(0, 0, 0);
      return;
    }

    const errorSquared = this.root.position.distanceToSquared(this.serverPosition);
    if (errorSquared > 9) {
      // Large errors usually mean a suspended tab or a recovered connection.
      this.root.position.copy(this.serverPosition);
      this.correction.set(0, 0, 0);
    } else if (errorSquared > 0.64) {
      // Ordinary snapshots are slightly behind the extrapolated render
      // position, so only correct meaningful drift and do it gradually.
      this.correction.copy(this.serverPosition).sub(this.root.position);
    }
  }

  update(delta: number): void {
    // Projectiles move continuously at render rate instead of chasing a
    // target that jumps at the server's 20 Hz snapshot rate.
    this.root.position.addScaledVector(this.velocity, delta);
    if (this.correction.lengthSq() > 0.000001) {
      const correctionAlpha = 1 - Math.exp(-7 * delta);
      this.root.position.addScaledVector(this.correction, correctionAlpha);
      this.correction.multiplyScalar(1 - correctionAlpha);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}
