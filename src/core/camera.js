// 2.5D pinhole camera shared by the Canvas2D layers and the WebGL sky/cloud shader.
// World: x right, y DOWN, z into the screen (metres). The camera never rotates in yaw/pitch;
// "looking up/down" is done with a shifted principal point (cx, cy), like a tilt-shift lens,
// so verticals stay vertical and the horizon sits at screen y = cy.
export class Camera {
  constructor(W, H) {
    this.W = W; this.H = H;
    this.reset();
  }
  reset() {
    this.x = 0; this.y = 0; this.z = -10;
    this.fov = 40;          // vertical, degrees
    this.zoom = 1;          // extra punch-zoom multiplier on focal length
    this.roll = 0;          // radians, dutch angle
    this.cx = this.W / 2;   // principal point (horizon position)
    this.cy = this.H / 2;
    this.shakeX = 0; this.shakeY = 0; this.shakeR = 0;
    return this;
  }
  get focal() { return (this.H / 2) / Math.tan((this.fov * Math.PI) / 360) * this.zoom; }
  get rollTotal() { return this.roll + this.shakeR; }
  // world -> screen. Returns null behind the camera. s = pixels per metre at that depth.
  project(px, py, pz) {
    const dz = pz - this.z;
    if (dz <= 0.05) return null;
    const f = this.focal / dz;
    const sx = (px - this.x) * f, sy = (py - this.y) * f;
    const r = this.rollTotal, c = Math.cos(r), s = Math.sin(r);
    return { x: this.cx + sx * c - sy * s + this.shakeX, y: this.cy + sx * s + sy * c + this.shakeY, s: f, z: dz };
  }
  // Apply a transform so that drawing in "local metres" at depth pz around (px,py) lands correctly.
  // Use for sprites/characters: draw with units = metres, origin at (px,py).
  toLocal(ctx, px, py, pz) {
    const p = this.project(px, py, pz);
    if (!p) return null;
    const r = this.rollTotal;
    ctx.setTransform(p.s * Math.cos(r), p.s * Math.sin(r), -p.s * Math.sin(r), p.s * Math.cos(r), p.x, p.y);
    return p;
  }
  // Screen-space transform with roll+shake around the principal point (for screen-anchored fx)
  toScreen(ctx) {
    const r = this.rollTotal, c = Math.cos(r), s = Math.sin(r);
    // rotate around (cx,cy), then add shake
    const tx = this.cx + this.shakeX - (c * this.cx - s * this.cy);
    const ty = this.cy + this.shakeY - (s * this.cx + c * this.cy);
    ctx.setTransform(c, s, -s, c, tx, ty);
  }
  // inverse: screen pixel -> world point at depth pz
  unproject(sx, sy, pz) {
    const dz = pz - this.z, f = this.focal / dz;
    let qx = sx - this.cx - this.shakeX, qy = sy - this.cy - this.shakeY;
    const r = -this.rollTotal, c = Math.cos(r), s = Math.sin(r);
    const ux = qx * c - qy * s, uy = qx * s + qy * c;
    return { x: this.x + ux / f, y: this.y + uy / f, z: pz };
  }
  copy() { const c = new Camera(this.W, this.H); Object.assign(c, this); return c; }
}
