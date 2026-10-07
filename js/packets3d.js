/* packets3d.js — the moving objects in the 3D view.

   Every routing message that an engine reports turns into one small glowing
   sphere that travels along the leased line it was sent over:

     blue    = a distance vector exchanged between two neighbours
     orange  = a link state packet (LSP) flooded further

   A message is animated for one hop only and then disappears, so what you see
   on screen is exactly the list of messages the algorithm reported. Blue rides
   a little above the line and orange a little below it, so both are visible
   even when they use the same link in the same tick.

   This file contains drawing code only. It never decides anything: it is handed
   the packet list from an engine. */

function createPackets3D(scene3d) {

  const scene = scene3d.scene;

  /* One small sphere, shared by every packet (cheap for a laptop). */
  const geometry = new THREE.SphereGeometry(0.13, 10, 8);

  /* Two materials, one per algorithm. */
  const materials = {
    DV: new THREE.MeshBasicMaterial({ color: 0x3b82f6 }),   // blue
    LS: new THREE.MeshBasicMaterial({ color: 0xf59e0b })    // orange
  };

  /* Vertical offset so the two colours never hide each other. */
  const LIFT = { DV: 0.26, LS: -0.16 };

  const TRAVEL_SECONDS = 0.6;   // how long one hop takes on screen
  const MAX_LIVE = 200;         // safety cap so one huge tick cannot freeze the page

  const live = [];              // { mesh, from, to, t, lift }

  /* The 3D position of a bank location. */
  function positionOf(id) {
    const node = findNode(id);
    return new THREE.Vector3(node.pos[0], node.pos[1], node.pos[2]);
  }

  /* Starts one animated packet for every message in the list. */
  function spawn(packets) {
    for (let i = 0; i < packets.length; i++) {
      const message = packets[i];
      const kind = message[2] === "LS" ? "LS" : "DV";

      const mesh = new THREE.Mesh(geometry, materials[kind]);
      const from = positionOf(message[0]);
      const to = positionOf(message[1]);
      mesh.position.copy(from).add(new THREE.Vector3(0, LIFT[kind], 0));
      scene.add(mesh);

      live.push({ mesh: mesh, from: from, to: to, t: 0, lift: LIFT[kind] });

      /* If too much is in the air, the oldest packet is dropped. */
      if (live.length > MAX_LIVE) {
        scene.remove(live[0].mesh);
        live.shift();
      }
    }
  }

  /* Moves every live packet along its line. Called once per frame. */
  function update(dt) {
    for (let i = live.length - 1; i >= 0; i--) {
      const item = live[i];
      item.t += dt / TRAVEL_SECONDS;

      if (item.t >= 1) {              // arrived: the packet is gone
        scene.remove(item.mesh);
        live.splice(i, 1);
        continue;
      }

      item.mesh.position.lerpVectors(item.from, item.to, item.t);
      item.mesh.position.y += item.lift;
    }
  }

  /* Removes every packet, used by Reset and by the link-event processes. */
  function clear() {
    for (let i = 0; i < live.length; i++) scene.remove(live[i].mesh);
    live.length = 0;
  }

  /* How many packets are in the air right now (used by the tests and the UI). */
  function count() {
    return live.length;
  }

  return {
    spawn: spawn,
    update: update,
    clear: clear,
    count: count
  };
}
