import './styles.css';

type Point = {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

type Rgb = {
  r: number;
  g: number;
  b: number;
};

const maybeCanvas = document.querySelector<HTMLCanvasElement>('#jelly-canvas');
if (!maybeCanvas) {
  throw new Error('Missing #jelly-canvas');
}
const canvas: HTMLCanvasElement = maybeCanvas;

const maybeCtx = canvas.getContext('2d', { alpha: false });
if (!maybeCtx) {
  throw new Error('Canvas 2D is not supported');
}
const ctx: CanvasRenderingContext2D = maybeCtx;

const resetButton = document.querySelector<HTMLButtonElement>('#reset-button');
const blurToggle = document.querySelector<HTMLInputElement>('#blur-toggle');
const colorInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="jelly-color"]'));

const pointCount = 17;
const minValue = 0.04;
const maxValue = 0.96;
const neutralValue = 0.55;
const floorTilt = -0.26;

let dpr = 1;
let width = 0;
let height = 0;
let lastTime = performance.now();
let dragging = false;
let sliderValue = neutralValue;
let targetValue = neutralValue;
let blurEnabled = false;
let jellyHex = '#ff7a16';
let jellyColor = hexToRgb(jellyHex);
let impulse = 0;
let points: Point[] = [];

const pointer = {
  x: 0,
  y: 0,
  previousX: 0,
};

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function hexToRgb(hex: string): Rgb {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function rgba(color: Rgb, alpha = 1): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = Math.max(320, Math.floor(window.innerWidth));
  height = Math.max(420, Math.floor(window.innerHeight));
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  seedPoints();
}

function trackBounds() {
  const trackWidth = Math.min(width * 0.74, 760);
  const trackHeight = Math.max(92, Math.min(130, height * 0.19));
  const centerX = width * 0.5;
  const centerY = height * 0.54;
  return {
    left: centerX - trackWidth * 0.5,
    right: centerX + trackWidth * 0.5,
    top: centerY - trackHeight * 0.5,
    bottom: centerY + trackHeight * 0.5,
    width: trackWidth,
    height: trackHeight,
    centerX,
    centerY,
  };
}

function sliderX(value: number): number {
  const bounds = trackBounds();
  return mix(bounds.left + 42, bounds.right - 42, value);
}

function valueFromPointer(x: number): number {
  const bounds = trackBounds();
  return clamp((x - (bounds.left + 42)) / (bounds.width - 84), minValue, maxValue);
}

function seedPoints() {
  const bounds = trackBounds();
  const startX = bounds.left + 44;
  const endX = sliderX(sliderValue);
  points = Array.from({ length: pointCount }, (_, index) => {
    const t = index / (pointCount - 1);
    const curve = Math.sin(t * Math.PI) * 8;
    return {
      x: mix(startX, endX, t),
      y: bounds.centerY - 24 + curve * 0.08,
      vx: 0,
      vy: 0,
    };
  });
}

function updatePoints(dt: number) {
  const bounds = trackBounds();
  const startX = bounds.left + 44;
  const endX = sliderX(sliderValue);
  const speedImpulse = clamp((targetValue - sliderValue) * 36 + impulse * 0.006, -12, 12);
  const settling = dragging ? 0.78 : 0.42;

  for (let index = 0; index < points.length; index++) {
    const t = index / (points.length - 1);
    const p = points[index];
    const wave = Math.sin((performance.now() * 0.005) + t * 7.2);
    const anchorX = mix(startX, endX, t);
    const belly = Math.sin(t * Math.PI);
    const dragBunch = Math.max(0, 1 - sliderValue) * Math.sin(t * Math.PI * 1.35) * 30;
    const anchorY =
      bounds.centerY -
      25 +
      belly * speedImpulse * (dragging ? 4.5 : 6.2) +
      wave * belly * (reduceMotion ? 0 : 1.8) +
      dragBunch * 0.08;

    const springX = (anchorX - p.x) * (26 - t * 8);
    const springY = (anchorY - p.y) * (42 - t * 18);
    const neighborPull =
      index > 0 && index < points.length - 1
        ? (points[index - 1].y + points[index + 1].y - p.y * 2) * 18
        : 0;

    p.vx += springX * dt;
    p.vy += (springY + neighborPull + speedImpulse * belly * 36) * dt;
    p.vx *= Math.pow(settling, dt * 60);
    p.vy *= Math.pow(settling, dt * 60);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  points[0].x = startX;
  points[0].y = bounds.centerY - 25;
  points[points.length - 1].x = endX;
  points[points.length - 1].y = bounds.centerY - 25;
}

function update(dt: number) {
  const previousValue = sliderValue;
  const chase = dragging ? 20 : 9;
  sliderValue += (targetValue - sliderValue) * (1 - Math.exp(-dt * chase));
  impulse *= Math.pow(0.88, dt * 60);
  impulse += (sliderValue - previousValue) * 850;
  updatePoints(dt);
}

function drawRoundedRectPath(x: number, y: number, w: number, h: number, radius: number) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function curvePath(offsetY = 0, overshoot = 0) {
  const first = points[0];
  ctx.beginPath();
  ctx.moveTo(first.x, first.y + offsetY);

  for (let index = 0; index < points.length - 1; index++) {
    const current = points[index];
    const next = points[index + 1];
    const midX = (current.x + next.x) * 0.5;
    const midY = (current.y + next.y) * 0.5 + offsetY;
    ctx.quadraticCurveTo(current.x, current.y + offsetY, midX, midY);
  }

  const last = points[points.length - 1];
  ctx.lineTo(last.x + overshoot, last.y + offsetY);
}

function drawFloor() {
  const bounds = trackBounds();
  const slabWidth = bounds.width + 170;
  const slabHeight = bounds.height + 120;
  const slabX = bounds.centerX - slabWidth * 0.5;
  const slabY = bounds.centerY - slabHeight * 0.5 + 20;

  ctx.save();
  ctx.translate(bounds.centerX, bounds.centerY + 34);
  ctx.transform(1, floorTilt, 0, 1, -bounds.centerX, -(bounds.centerY + 34));

  const slabGradient = ctx.createLinearGradient(slabX, slabY, slabX, slabY + slabHeight);
  slabGradient.addColorStop(0, '#f9f5ed');
  slabGradient.addColorStop(0.48, '#e8e0d3');
  slabGradient.addColorStop(1, '#cfc6b7');

  drawRoundedRectPath(slabX, slabY, slabWidth, slabHeight, 72);
  ctx.fillStyle = slabGradient;
  ctx.shadowColor = 'rgba(70, 58, 42, 0.20)';
  ctx.shadowBlur = 48;
  ctx.shadowOffsetY = 22;
  ctx.fill();
  ctx.shadowColor = 'transparent';

  ctx.globalCompositeOperation = 'multiply';
  const grainGradient = ctx.createLinearGradient(0, slabY, 0, slabY + slabHeight);
  grainGradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
  grainGradient.addColorStop(1, 'rgba(88, 74, 55, 0.11)');
  ctx.fillStyle = grainGradient;
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  drawRoundedRectPath(bounds.left, bounds.centerY - 43, bounds.width, 86, 44);
  ctx.fillStyle = '#d7cfc0';
  ctx.shadowColor = 'rgba(255, 255, 255, 0.86)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = -2;
  ctx.fill();
  ctx.shadowColor = 'transparent';

  drawRoundedRectPath(bounds.left + 13, bounds.centerY - 29, bounds.width - 26, 58, 30);
  ctx.fillStyle = '#c9c0b0';
  ctx.fill();

  const insetGradient = ctx.createLinearGradient(bounds.left, bounds.centerY - 34, bounds.left, bounds.centerY + 35);
  insetGradient.addColorStop(0, 'rgba(74, 62, 45, 0.28)');
  insetGradient.addColorStop(0.42, 'rgba(255, 255, 255, 0.15)');
  insetGradient.addColorStop(1, 'rgba(255, 255, 255, 0.54)');
  ctx.fillStyle = insetGradient;
  ctx.fill();

  ctx.restore();
}

function drawPercentage() {
  const bounds = trackBounds();
  const percent = Math.round(sliderValue * 100);
  const textX = bounds.right - 130;
  const textY = bounds.centerY + 105;

  ctx.save();
  ctx.translate(bounds.centerX, bounds.centerY + 34);
  ctx.transform(1, floorTilt, 0, 1, -bounds.centerX, -(bounds.centerY + 34));
  ctx.font = `700 ${Math.max(34, Math.min(52, width * 0.048))}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(68, 58, 48, 0.32)';
  ctx.fillText(`${percent}`, textX, textY);
  ctx.font = `800 ${Math.max(17, Math.min(24, width * 0.022))}px Inter, system-ui, sans-serif`;
  ctx.fillText('%', textX + 56, textY - 7);
  ctx.restore();
}

function drawCaustics() {
  const bounds = trackBounds();
  const end = points[points.length - 1];
  const stretch = 1 - sliderValue;
  const causticWidth = bounds.width * (0.24 + stretch * 0.3);

  ctx.save();
  ctx.translate(bounds.centerX, bounds.centerY + 34);
  ctx.transform(1, floorTilt, 0, 1, -bounds.centerX, -(bounds.centerY + 34));
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.36 + stretch * 0.24;

  const gradient = ctx.createRadialGradient(end.x - 80, bounds.centerY + 34, 8, end.x - 95, bounds.centerY + 36, causticWidth);
  gradient.addColorStop(0, rgba(jellyColor, 0.82));
  gradient.addColorStop(0.38, rgba(jellyColor, 0.28));
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(end.x - 110, bounds.centerY + 38, causticWidth, 22 + stretch * 18, -0.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    const x = end.x - 200 + i * 40 + Math.sin(performance.now() * 0.002 + i) * 8;
    ctx.ellipse(x, bounds.centerY + 30 + i * 3, 50 + i * 4, 5, 0.08, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawJellyShadow() {
  const bounds = trackBounds();
  ctx.save();
  ctx.translate(bounds.centerX, bounds.centerY + 34);
  ctx.transform(1, floorTilt, 0, 1, -bounds.centerX, -(bounds.centerY + 34));
  ctx.globalAlpha = 0.18 + (1 - sliderValue) * 0.1;
  ctx.strokeStyle = rgba(jellyColor, 0.7);
  ctx.lineWidth = 54;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.filter = `blur(${blurEnabled ? 18 : 11}px)`;
  curvePath(54, 6);
  ctx.stroke();
  ctx.filter = 'none';
  ctx.globalAlpha = 0.2;
  ctx.strokeStyle = 'rgba(66, 52, 35, 0.55)';
  ctx.lineWidth = 34;
  curvePath(48, 0);
  ctx.stroke();
  ctx.restore();
}

function drawJelly() {
  const bounds = trackBounds();
  const tubeWidth = Math.max(54, Math.min(78, bounds.width * 0.085));
  const end = points[points.length - 1];

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.filter = `blur(${blurEnabled ? 5 : 1.3}px)`;
  ctx.globalAlpha = 0.46;
  ctx.strokeStyle = rgba(jellyColor, 0.36);
  ctx.lineWidth = tubeWidth + 24;
  curvePath(0, 12);
  ctx.stroke();
  ctx.filter = 'none';

  const bodyGradient = ctx.createLinearGradient(bounds.left, bounds.centerY - 90, bounds.right, bounds.centerY + 54);
  bodyGradient.addColorStop(0, rgba(jellyColor, 0.18));
  bodyGradient.addColorStop(0.2, rgba(jellyColor, 0.72));
  bodyGradient.addColorStop(0.62, rgba(jellyColor, 0.94));
  bodyGradient.addColorStop(1, rgba(jellyColor, 0.52));

  ctx.shadowColor = rgba(jellyColor, 0.42);
  ctx.shadowBlur = 20;
  ctx.strokeStyle = bodyGradient;
  ctx.lineWidth = tubeWidth;
  curvePath(0, 14);
  ctx.stroke();
  ctx.shadowColor = 'transparent';

  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.88;
  ctx.strokeStyle = 'rgba(255, 248, 226, 0.54)';
  ctx.lineWidth = tubeWidth * 0.26;
  curvePath(-tubeWidth * 0.18, 3);
  ctx.stroke();

  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
  ctx.lineWidth = 5;
  curvePath(-tubeWidth * 0.34, 0);
  ctx.stroke();

  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = rgba({ r: Math.max(0, jellyColor.r - 90), g: Math.max(0, jellyColor.g - 66), b: Math.max(0, jellyColor.b - 36) }, 0.8);
  ctx.lineWidth = tubeWidth * 0.2;
  curvePath(tubeWidth * 0.25, 0);
  ctx.stroke();

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  const capGradient = ctx.createRadialGradient(end.x - 10, end.y - 18, 4, end.x, end.y, tubeWidth * 0.63);
  capGradient.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
  capGradient.addColorStop(0.32, rgba(jellyColor, 0.86));
  capGradient.addColorStop(1, rgba(jellyColor, 0.42));
  ctx.fillStyle = capGradient;
  ctx.beginPath();
  ctx.ellipse(end.x + 6, end.y + 2, tubeWidth * 0.52, tubeWidth * 0.47, 0.05, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.48)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(end.x - 7, end.y - 13, tubeWidth * 0.23, tubeWidth * 0.08, -0.15, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

function drawBackgroundTexture() {
  ctx.fillStyle = '#f3efe6';
  ctx.fillRect(0, 0, width, height);

  const vignette = ctx.createRadialGradient(width * 0.48, height * 0.42, 80, width * 0.5, height * 0.5, Math.max(width, height) * 0.78);
  vignette.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  vignette.addColorStop(0.58, 'rgba(243, 239, 230, 0.4)');
  vignette.addColorStop(1, 'rgba(168, 155, 135, 0.35)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

function render() {
  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.04);
  lastTime = now;

  update(dt);
  drawBackgroundTexture();
  drawFloor();
  drawPercentage();
  drawJellyShadow();
  drawCaustics();
  drawJelly();

  requestAnimationFrame(render);
}

function setPointer(event: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  pointer.previousX = pointer.x;
  pointer.x = event.clientX - rect.left;
  pointer.y = event.clientY - rect.top;
}

canvas.addEventListener('pointerdown', (event) => {
  setPointer(event);
  dragging = true;
  targetValue = valueFromPointer(pointer.x);
  pointer.previousX = pointer.x;
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', (event) => {
  setPointer(event);
  if (!dragging) {
    return;
  }

  const nextValue = valueFromPointer(pointer.x);
  impulse += (pointer.x - pointer.previousX) * 0.7;
  targetValue = nextValue;
});

canvas.addEventListener('pointerup', (event) => {
  setPointer(event);
  dragging = false;
  impulse += (pointer.x - pointer.previousX) * 2.4;
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
});

canvas.addEventListener('pointercancel', () => {
  dragging = false;
});

resetButton?.addEventListener('click', () => {
  targetValue = neutralValue;
  sliderValue = neutralValue;
  impulse = 0;
  seedPoints();
});

blurToggle?.addEventListener('change', () => {
  blurEnabled = Boolean(blurToggle.checked);
});

for (const input of colorInputs) {
  input.addEventListener('change', () => {
    if (input.checked) {
      jellyHex = input.value;
      jellyColor = hexToRgb(jellyHex);
      blurToggle?.style.setProperty('accent-color', jellyHex);
    }
  });
}

window.addEventListener('resize', resize);

resize();
requestAnimationFrame(render);
