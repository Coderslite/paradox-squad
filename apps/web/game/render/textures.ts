import * as THREE from "three";

/** Procedural textures so milestone 1 ships with zero texture downloads. */

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  return [c, ctx];
}

/** 1m x 1m dev grid tile: helps the eye read speed and distance in the greybox. */
export function createGridTexture(maxAnisotropy: number): THREE.Texture {
  const size = 512;
  const [c, g] = canvas(size);
  g.fillStyle = "#b8b8b8";
  g.fillRect(0, 0, size, size);
  // Subtle noise so large surfaces are not flat.
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    img.data[i] = (img.data[i] ?? 0) + n;
    img.data[i + 1] = (img.data[i + 1] ?? 0) + n;
    img.data[i + 2] = (img.data[i + 2] ?? 0) + n;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = "rgba(0,0,0,0.16)";
  g.lineWidth = 2;
  for (let i = 1; i < 4; i++) {
    const p = (i * size) / 4;
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, size);
    g.moveTo(0, p);
    g.lineTo(size, p);
    g.stroke();
  }
  g.strokeStyle = "rgba(0,0,0,0.38)";
  g.lineWidth = 6;
  g.strokeRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, maxAnisotropy);
  t.generateMipmaps = true;
  return t;
}

export function createBulletHoleTexture(): THREE.Texture {
  const size = 64;
  const [c, g] = canvas(size);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(10,8,6,1)");
  grad.addColorStop(0.18, "rgba(20,16,12,0.95)");
  grad.addColorStop(0.35, "rgba(60,50,40,0.55)");
  grad.addColorStop(1, "rgba(60,50,40,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  g.strokeStyle = "rgba(25,20,15,0.6)";
  g.lineWidth = 1.2;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + Math.random() * 0.5;
    const r = size * (0.25 + Math.random() * 0.2);
    g.beginPath();
    g.moveTo(size / 2, size / 2);
    g.lineTo(size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Star-shaped additive muzzle flash. */
export function createFlashTexture(): THREE.Texture {
  const size = 128;
  const [c, g] = canvas(size);
  const cx = size / 2;
  const glow = g.createRadialGradient(cx, cx, 0, cx, cx, cx);
  glow.addColorStop(0, "rgba(255,255,240,1)");
  glow.addColorStop(0.2, "rgba(255,220,140,0.9)");
  glow.addColorStop(0.5, "rgba(255,140,40,0.25)");
  glow.addColorStop(1, "rgba(255,100,20,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = "lighter";
  g.fillStyle = "rgba(255,230,170,0.7)";
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx, cx);
    g.lineTo(cx + Math.cos(a - 0.12) * cx * 0.35, cx + Math.sin(a - 0.12) * cx * 0.35);
    g.lineTo(cx + Math.cos(a) * cx * 0.98, cx + Math.sin(a) * cx * 0.98);
    g.lineTo(cx + Math.cos(a + 0.12) * cx * 0.35, cx + Math.sin(a + 0.12) * cx * 0.35);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
