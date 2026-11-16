// input.js — keyboard, mouse and pointer lock.
// One job: turn browser events into a per-frame move intent plus
// edge-triggered pressed() events. The sim reads move intent, never events.
export function createInput(canvas) {
  const input = {
    keys: new Set(), pressedSet: new Set(),
    mouseDX: 0, mouseDY: 0, mouseDown: false, mouseClicked: false,
    locked: false, fireHeld: false,
    // scripted override used by the self-test harness
    script: null,
  };
  const CODE = {
    KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right',
    ShiftLeft: 'sprint', ShiftRight: 'sprint',
    ControlLeft: 'crouch', KeyC: 'crouch', Space: 'jump',
  };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') e.preventDefault();
    if (!e.repeat) input.pressedSet.add(e.code);
    input.keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.code));
  window.addEventListener('blur', () => { input.keys.clear(); input.fireHeld = false; });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
  });
  document.addEventListener('mousemove', (e) => {
    if (input.locked) { input.mouseDX += e.movementX; input.mouseDY += e.movementY; }
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) { input.mouseDown = true; input.fireHeld = true; input.mouseClicked = true; }
    if (e.button === 2) input.pressedSet.add('MouseRight');
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) { input.mouseDown = false; input.fireHeld = false; }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  input.lock = () => { try { canvas.requestPointerLock(); } catch { /* headless */ } };
  input.unlock = () => { if (document.pointerLockElement) document.exitPointerLock(); };
  input.wasPressed = (code) => input.pressedSet.has(code);
  input.isDown = (code) => input.keys.has(code);
  // Move intent for this frame: {forward,back,left,right,sprint,crouch,jump}
  input.move = () => {
    if (input.script) return input.script;
    const k = input.keys;
    return {
      forward: k.has('KeyW') ? 1 : 0, back: k.has('KeyS') ? 1 : 0,
      left: k.has('KeyA') ? 1 : 0, right: k.has('KeyD') ? 1 : 0,
      sprint: k.has('ShiftLeft') || k.has('ShiftRight'),
      crouch: k.has('ControlLeft') || k.has('KeyC'),
      jump: k.has('Space'),
    };
  };
  input.consumeMouse = () => {
    const dx = input.mouseDX, dy = input.mouseDY;
    input.mouseDX = 0; input.mouseDY = 0;
    return { dx, dy };
  };
  input.endFrame = () => { input.pressedSet.clear(); input.mouseClicked = false; };
  return input;
}
