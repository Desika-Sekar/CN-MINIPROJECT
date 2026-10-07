/* scene3d.js — the 3D view of the bank: renderer, camera, our own orbit
   controls, the router shapes, the leased lines and the floating labels.

   This file contains DRAWING code only. It reads the node and link data from
   topology.js and never touches the routing algorithms, so what you see on
   screen always matches the numbers printed in the tables.
   Three.js r128 core has no OrbitControls class, so the small control code
   below is written by hand: drag to rotate, wheel or pinch to zoom. */

/* ------------------------------------------------------------------
   1. Label helpers
   ------------------------------------------------------------------ */

/* The GPU anisotropy we ask for on label textures (sharper text at angles). */
let LABEL_ANISOTROPY = 8;

/* Draws a rectangle with rounded corners as a path on a 2D canvas.
   Used as the background "pill" behind every label text. */
function pathRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* Builds a Sprite label. The text is painted on a 2D canvas first, then that
   canvas becomes a texture on a flat plane that always faces the camera.
   Sprites never turn away from us, so names and costs stay readable. */
function makeLabelSprite(text, options) {
  const opts = options || {};
  const cw = opts.canvasWidth || 512;    // canvas resolution; bigger = crisper
  const ch = opts.canvasHeight || 128;
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");

  /* Background pill, so light text stays readable over any colour. */
  ctx.fillStyle = opts.background || "rgba(9,14,26,0.72)";
  pathRoundRect(ctx, 6, 6, cw - 12, ch - 12, 24);
  ctx.fill();
  ctx.strokeStyle = opts.border || "rgba(160,180,220,0.35)";
  ctx.lineWidth = 3;
  ctx.stroke();

  /* The text itself. */
  ctx.fillStyle = opts.color || "#e8eeff";
  ctx.font = "bold " + (opts.fontSize || 54) + "px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cw / 2, ch / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;   // no mipmaps, so text stays sharp
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = LABEL_ANISOTROPY;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,    // a label is never hidden behind a router
    depthWrite: false
  });

  const sprite = new THREE.Sprite(material);
  const worldWidth = opts.worldWidth || 2.4;
  sprite.scale.set(worldWidth, worldWidth * (ch / cw), 1);
  sprite.renderOrder = 10;   // draw labels on top of everything else
  return sprite;
}

/* ------------------------------------------------------------------
   2. Colours (neutral palette plus the one accent used for paths)
   ------------------------------------------------------------------ */

const COLOR_STAGE = 0x0d1220;   // 3D background
const COLOR_NODE = {            // router colours, all neutral blue-greys
  ho: 0xdfe6f4,
  dc: 0x9fb8dd,
  atm: 0xb6c0cc,
  router: 0x8fa3c2
};
const COLOR_LINK = 0x5a6b8c;      // a healthy leased line
const COLOR_LINK_FAILED = 0xef4444;  // a failed leased line (phase 5)
const COLOR_PATH = 0x22c55e;      // a highlighted path (phase 4)
const COLOR_PULSE = 0x22c55e;     // the green flash when a node's table changes

/* ------------------------------------------------------------------
   3. The scene factory. One call = one 3D view, so phase 6 can create two
      of them side by side for the split-screen (DV left, LS right).
   ------------------------------------------------------------------ */

/* Creates a 3D view inside the given container element and returns the small
   API the rest of the page uses. */
function createScene3D(container) {

  /* ---------------- renderer ---------------- */

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(COLOR_STAGE, 1);
  container.insertBefore(renderer.domElement, container.firstChild);

  /* Ask the GPU for its best texture filtering, up to our wanted 8. */
  LABEL_ANISOTROPY = Math.min(8, renderer.capabilities.getMaxAnisotropy() || 1);

  /* ---------------- scene and lights ---------------- */

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLOR_STAGE);

  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.7);
  keyLight.position.set(6, 12, 8);
  scene.add(keyLight);

  /* ---------------- camera and its orbit state ---------------- */

  /* Look at the middle of the network, so the view stays correct even if the
     node positions in topology.js are edited later. */
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, maxY: -Infinity };
  for (let i = 0; i < NODES.length; i++) {
    const p = NODES[i].pos;
    bounds.minX = Math.min(bounds.minX, p[0]);
    bounds.maxX = Math.max(bounds.maxX, p[0]);
    bounds.minZ = Math.min(bounds.minZ, p[2]);
    bounds.maxZ = Math.max(bounds.maxZ, p[2]);
    bounds.maxY = Math.max(bounds.maxY, p[1]);
  }
  const target = new THREE.Vector3(
    (bounds.minX + bounds.maxX) / 2,
    bounds.maxY * 0.6,
    (bounds.minZ + bounds.maxZ) / 2
  );
  const spread = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  const startRadius = spread * 1.55;

  /* Camera position is kept in spherical form: radius, theta (around the
     vertical axis) and phi (down from the vertical axis). */
  const defaultView = { radius: startRadius, theta: 0.62, phi: 0.95 };
  const view = { radius: defaultView.radius, theta: defaultView.theta, phi: defaultView.phi };
  const MIN_PHI = 0.10;    // stop just short of straight down, keeps labels clear
  const MAX_PHI = 1.45;    // stop just above the horizon, never goes under the floor

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);

  /* Moves the camera to the place described by view. */
  function applyCamera() {
    const sinPhi = Math.sin(view.phi);
    camera.position.set(
      target.x + view.radius * sinPhi * Math.sin(view.theta),
      target.y + view.radius * Math.cos(view.phi),
      target.z + view.radius * sinPhi * Math.cos(view.theta)
    );
    camera.lookAt(target);
  }

  /* ---------------- the bank locations ---------------- */

  /* Picks the right shape for a node. Three.js r128 has no CapsuleGeometry,
     so we only use Sphere, Cylinder and Box as agreed. */
  function makeNodeGeometry(kind) {
    if (kind === "ho") return new THREE.SphereGeometry(0.80, 32, 24);   // largest
    if (kind === "dc") return new THREE.CylinderGeometry(0.62, 0.62, 1.25, 24, 1);
    if (kind === "atm") return new THREE.BoxGeometry(1.05, 1.05, 1.05);
    return new THREE.SphereGeometry(0.55, 24, 18);
  }

  const nodeMeshes = {};   // node id -> mesh, handy for later phases

  for (let i = 0; i < NODES.length; i++) {
    const node = NODES[i];

    const mesh = new THREE.Mesh(
      makeNodeGeometry(node.kind),
      new THREE.MeshStandardMaterial({
        color: COLOR_NODE[node.kind] || COLOR_NODE.router,
        roughness: 0.42,
        metalness: 0.15
      })
    );
    mesh.position.set(node.pos[0], node.pos[1], node.pos[2]);
    scene.add(mesh);
    nodeMeshes[node.id] = mesh;

    /* Name label floating above the router. */
    const label = makeLabelSprite(node.name, {
      canvasWidth: 512,          // high-resolution canvas, as agreed
      canvasHeight: 128,
      worldWidth: 2.3,
      fontSize: 58
    });
    label.position.set(node.pos[0], node.pos[1] + labelHeightFor(node.kind), node.pos[2]);
    scene.add(label);
  }

  /* How high above a router its name label floats. */
  function labelHeightFor(kind) {
    if (kind === "ho") return 1.45;
    if (kind === "dc") return 1.25;
    if (kind === "atm") return 1.15;
    return 1.05;
  }

  /* ---------------- the leased lines ---------------- */

  /* One shared cylinder (height 1, pointing up) is reused for every link and
     simply rotated and stretched into place. Cheap enough for a laptop. */
  const linkGeometry = new THREE.CylinderGeometry(0.05, 0.05, 1, 8, 1, false);
  const upAxis = new THREE.Vector3(0, 1, 0);
  const linkMeshes = [];   // { link, mesh, material, costLabel }

  /* Points a unit-height cylinder from point a to point b. */
  function placeCylinderBetween(mesh, a, b, radiusScale) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const length = dir.length();
    mesh.position.copy(a).addScaledVector(dir, 0.5);   // sit on the midpoint
    mesh.scale.set(radiusScale, length, radiusScale);
    mesh.quaternion.setFromUnitVectors(upAxis, dir.clone().normalize());
  }

  for (let i = 0; i < LINKS.length; i++) {
    const link = LINKS[i];
    const from = new THREE.Vector3().fromArray(findNode(link.a).pos);
    const to = new THREE.Vector3().fromArray(findNode(link.b).pos);

    const material = new THREE.MeshStandardMaterial({
      color: COLOR_LINK,
      roughness: 0.65,
      metalness: 0.05,
      transparent: true,
      opacity: 1
    });

    const mesh = new THREE.Mesh(linkGeometry, material);
    placeCylinderBetween(mesh, from, to, 1);
    scene.add(mesh);

    /* The cost of the line, written at its midpoint. */
    const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
    const costLabel = makeLabelSprite(String(link.cost), {
      canvasWidth: 256,
      canvasHeight: 128,
      worldWidth: 0.85,
      fontSize: 76,
      background: "rgba(9,14,26,0.80)",
      color: "#cfe0ff"
    });
    costLabel.position.set(mid.x, mid.y + 0.30, mid.z);
    scene.add(costLabel);

    linkMeshes.push({ link: link, mesh: mesh, material: material, costLabel: costLabel });
  }

  /* The links that make up the highlighted path, keyed "a|b". */
  const highlighted = {};

  /* A stable key for one link, whichever way round it is given. */
  function linkKey(a, b) {
    return a < b ? a + "|" + b : b + "|" + a;
  }

  /* Re-reads the link state and paints every line:
       healthy  = grey, normal thickness
       failed   = red and semi-transparent
       selected = green and thicker (the chosen route of one algorithm) */
  function refreshLinks() {
    for (let i = 0; i < linkMeshes.length; i++) {
      const entry = linkMeshes[i];
      const alive = isLinkAlive(entry.link.a, entry.link.b);
      const onPath = highlighted[linkKey(entry.link.a, entry.link.b)] === true;

      if (!alive) {
        entry.material.color.setHex(COLOR_LINK_FAILED);
        entry.material.opacity = 0.45;
      } else if (onPath) {
        entry.material.color.setHex(COLOR_PATH);
        entry.material.opacity = 1;
      } else {
        entry.material.color.setHex(COLOR_LINK);
        entry.material.opacity = 1;
      }

      /* A selected route is drawn thicker so it stands out. */
      const thickness = onPath ? 2.6 : 1;
      entry.mesh.scale.x = thickness;
      entry.mesh.scale.z = thickness;
      entry.costLabel.material.opacity = alive ? 1 : 0.55;
    }
  }

  refreshLinks();   // all links start up, so every line is grey

  /* Turns one route green and thick. An empty list clears the highlight. */
  function highlightPath(route) {
    for (const key in highlighted) delete highlighted[key];
    if (route) {
      for (let i = 0; i + 1 < route.length; i++) highlighted[linkKey(route[i], route[i + 1])] = true;
    }
    refreshLinks();
  }

  /* ---------------- the text that is shown AT a place ---------------- */

  /* A floating caption plus a thin line down to its router. It is drawn with
     the same canvas-texture trick as the name labels, so the words sit right
     next to the location they describe. */
  const calloutCanvas = document.createElement("canvas");
  calloutCanvas.width = 512;
  calloutCanvas.height = 128;
  const calloutContext = calloutCanvas.getContext("2d");
  const calloutTexture = new THREE.CanvasTexture(calloutCanvas);
  calloutTexture.minFilter = THREE.LinearFilter;
  calloutTexture.magFilter = THREE.LinearFilter;
  calloutTexture.anisotropy = LABEL_ANISOTROPY;

  const calloutSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: calloutTexture,
    transparent: true,
    depthTest: false,
    depthWrite: false
  }));
  calloutSprite.visible = false;
  calloutSprite.renderOrder = 11;
  scene.add(calloutSprite);

  const calloutLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: COLOR_PULSE, transparent: true, opacity: 0.75 })
  );
  calloutLine.visible = false;
  scene.add(calloutLine);

  /* Paints the caption text, shrinking the font until the words fit the pill. */
  function drawCalloutText(text) {
    const cw = calloutCanvas.width;
    const ch = calloutCanvas.height;
    calloutContext.clearRect(0, 0, cw, ch);

    calloutContext.fillStyle = "rgba(9,14,26,0.92)";
    pathRoundRect(calloutContext, 6, 6, cw - 12, ch - 12, 22);
    calloutContext.fill();
    calloutContext.strokeStyle = "rgba(34,197,94,0.75)";
    calloutContext.lineWidth = 4;
    calloutContext.stroke();

    let fontSize = 44;
    do {
      calloutContext.font = "bold " + fontSize + "px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
      fontSize -= 2;
    } while (calloutContext.measureText(text).width > cw - 48 && fontSize > 16);

    calloutContext.fillStyle = "#eaf3ff";
    calloutContext.textAlign = "center";
    calloutContext.textBaseline = "middle";
    calloutContext.fillText(text, cw / 2, ch / 2 + 2);
  }

  /* Shows a short text right next to one bank location. */
  function showCallout(id, text) {
    const node = findNode(id);
    if (node === null) return;

    drawCalloutText(text);
    calloutTexture.needsUpdate = true;

    /* Wider text needs a wider sprite, otherwise the words look squashed. */
    const width = Math.min(7, Math.max(2.8, text.length * 0.32 + 1.4));
    calloutSprite.scale.set(width, width * (calloutCanvas.height / calloutCanvas.width), 1);

    const topOfLabel = node.pos[1] + labelHeightFor(node.kind);
    calloutSprite.position.set(node.pos[0], topOfLabel + 1.05, node.pos[2]);
    calloutLine.geometry.setFromPoints([
      new THREE.Vector3(node.pos[0], node.pos[1] + 0.55, node.pos[2]),
      new THREE.Vector3(node.pos[0], topOfLabel + 0.85, node.pos[2])
    ]);

    calloutSprite.visible = true;
    calloutLine.visible = true;
  }

  /* Removes the floating text. */
  function hideCallout() {
    calloutSprite.visible = false;
    calloutLine.visible = false;
  }

  /* ---------------- node pulses ("this router just changed") ---------------- */

  /* A pulse is a short green flash plus a small scale-up, then it fades back.
     Phase 4 uses it whenever a routing-table entry changes; the guided tour
     uses it to show which bank location is being described. */
  const pulses = [];   // running pulses: { mesh, t, color }
  const PULSE_SECONDS = 0.75;

  /* Starts a pulse on one node. Any pulse already running on that node is
     replaced, so rapid changes never fight over the same mesh. */
  function pulseNode(id, colorHex) {
    const mesh = nodeMeshes[id];
    if (!mesh) return;
    for (let i = pulses.length - 1; i >= 0; i--) {
      if (pulses[i].mesh === mesh) pulses.splice(i, 1);
    }
    pulses.push({ mesh: mesh, t: 0, color: colorHex === undefined ? COLOR_PULSE : colorHex });
  }

  /* Advances every running pulse. Called once per frame from the render loop. */
  function updatePulses(dt) {
    for (let i = pulses.length - 1; i >= 0; i--) {
      const pulse = pulses[i];
      pulse.t += dt / PULSE_SECONDS;

      if (pulse.t >= 1) {                 // finished: put the router back to normal
        pulse.mesh.scale.setScalar(1);
        pulse.mesh.material.emissive.setHex(0x000000);
        pulses.splice(i, 1);
        continue;
      }

      const k = Math.sin(pulse.t * Math.PI);   // 0 -> 1 -> 0, a smooth flash
      pulse.mesh.scale.setScalar(1 + 0.28 * k);
      pulse.mesh.material.emissive.setHex(pulse.color);
      pulse.mesh.material.emissiveIntensity = k * 0.85;
    }
  }

  /* ---------------- gentle camera moves ---------------- */

  /* Slides the point the camera looks at towards one node, so a process can
     draw attention to a location. Takes about half a second. */
  let cameraMove = null;   // { from, to, t }

  function focusOn(id) {
    const node = findNode(id);
    if (node === null) return;
    cameraMove = {
      from: target.clone(),
      to: new THREE.Vector3(node.pos[0], node.pos[1] + 0.35, node.pos[2]),
      t: 0
    };
  }

  /* Advances the camera move, if one is running. */
  function updateCameraMove(dt) {
    if (cameraMove === null) return;
    cameraMove.t += dt / 0.55;
    const k = cameraMove.t >= 1 ? 1 : 1 - Math.pow(1 - cameraMove.t, 3);   // ease out
    target.lerpVectors(cameraMove.from, cameraMove.to, k);
    applyCamera();
    if (cameraMove.t >= 1) cameraMove = null;
  }

  /* ---------------- our own orbit controls ---------------- */

  const canvas = renderer.domElement;
  const activePointers = {};   // pointerId -> last screen position
  let pinchDistance = 0;       // used for two-finger zoom

  /* Rotates the camera by the drag distance in pixels. */
  function rotateBy(dx, dy) {
    view.theta -= dx * 0.008;
    view.phi -= dy * 0.008;
    view.phi = Math.max(MIN_PHI, Math.min(MAX_PHI, view.phi));
    applyCamera();
  }

  /* Zooms in or out by a multiplier, keeping the distance inside its limits. */
  function zoomBy(factor) {
    view.radius *= factor;
    view.radius = Math.max(startRadius * 0.35, Math.min(startRadius * 3, view.radius));
    applyCamera();
  }

  /* Returns the two active pointers as a list (empty when not pinching). */
  function twoPointers() {
    const ids = Object.keys(activePointers);
    return ids.length >= 2 ? [activePointers[ids[0]], activePointers[ids[1]]] : null;
  }

  /* Distance between two screen points, used for pinch zoom. */
  function screenDistance(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
  }

  canvas.addEventListener("pointerdown", function (event) {
    activePointers[event.pointerId] = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    const pair = twoPointers();
    if (pair) pinchDistance = screenDistance(pair[0], pair[1]);
  });

  canvas.addEventListener("pointermove", function (event) {
    const previous = activePointers[event.pointerId];
    if (!previous) return;

    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    previous.x = event.clientX;
    previous.y = event.clientY;

    const pair = twoPointers();
    if (pair) {
      /* Two fingers down: pinch to zoom instead of rotating. */
      const now = screenDistance(pair[0], pair[1]);
      if (pinchDistance > 0 && now > 0) zoomBy(pinchDistance / now);
      pinchDistance = now;
    } else {
      rotateBy(dx, dy);
    }
  });

  /* Forgets a pointer when it is lifted or cancelled. */
  function releasePointer(event) {
    delete activePointers[event.pointerId];
    pinchDistance = 0;
  }

  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);

  canvas.addEventListener("wheel", function (event) {
    event.preventDefault();               // stop the page from scrolling
    zoomBy(event.deltaY > 0 ? 1.1 : 1 / 1.1);
  }, { passive: false });

  /* ---------------- sizing ---------------- */

  /* Matches the canvas and camera to the current size of the container.
     Called by the ResizeObserver whenever the box changes size. */
  function resize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  /* ResizeObserver keeps the 3D view correct when the window, the panel
     column or the phone rotation changes the container size. */
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  window.addEventListener("resize", resize);   // also catches zoom changes
  resize();

  /* ---------------- render loop ---------------- */

  /* Other files (packets3d.js) can hook into this same frame loop, so the
     packets move on exactly the same clock as the camera and the pulses. */
  const frameCallbacks = [];

  function onFrame(callback) {
    frameCallbacks.push(callback);
  }

  /* Screen refresh loop: move whatever is animating, then draw one frame.
     dt is the seconds since the previous frame, capped so that a background
     tab cannot produce one huge jump when it comes back. */
  let lastFrameTime = performance.now();

  function animate(now) {
    requestAnimationFrame(animate);
    const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
    lastFrameTime = now;

    for (let i = 0; i < frameCallbacks.length; i++) frameCallbacks[i](dt);
    updatePulses(dt);
    updateCameraMove(dt);
    renderer.render(scene, camera);
  }

  /* ---------------- public buttons ---------------- */

  /* Looks almost straight down. Labels are sprites with depth testing off,
     so they stay visible in this view. */
  function topView() {
    view.theta = 0;
    view.phi = MIN_PHI;
    applyCamera();
  }

  /* Returns to the default three-quarter view and zoom. */
  function resetCamera() {
    view.radius = defaultView.radius;
    view.theta = defaultView.theta;
    view.phi = defaultView.phi;
    applyCamera();
  }

  applyCamera();
  requestAnimationFrame(animate);

  return {
    topView: topView,
    resetCamera: resetCamera,
    refreshLinks: refreshLinks,
    highlightPath: highlightPath,
    pulseNode: pulseNode,
    focusOn: focusOn,
    showCallout: showCallout,
    hideCallout: hideCallout,
    onFrame: onFrame,
    resize: resize,
    scene: scene,          // used by packets3d.js
    camera: camera,
    nodeMeshes: nodeMeshes,
    linkMeshes: linkMeshes
  };
}
