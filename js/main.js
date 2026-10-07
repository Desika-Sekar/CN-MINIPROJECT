/* main.js — the simulation clock and the wiring of everything together.

   One tick does exactly this:
     1. ask the distance vector engine for one round,
     2. ask the link state engine for one step,
     3. turn every message they reported into an animated packet,
     4. add the numbers to the right metric bucket,
     5. tell the UI to redraw the tables, the log and the callouts.

   The clock is the only thing that decides when a tick happens; the engines
   themselves never look at a clock or at the screen. */

const SIM = {

  dv: null,               // distance vector engine
  ls: null,               // link state engine
  metrics: null,          // the counters

  scene: null,            // main 3D view (distance vector side in split mode)
  packetsA: null,         // packets for the main view
  sceneB: null,           // second 3D view (link state side), created on demand
  packetsB: null,         // packets for the second view

  split: false,
  playing: false,
  speed: 1,
  timer: null,
  tick: 0,
  phase: "startup",       // "startup" or "event"
  demo: null,             // the count-to-infinity demo state, or null

  /* ------------------------------------------------------------------
     Setting up
     ------------------------------------------------------------------ */

  /* Builds the engines, the 3D view and the animation layers. */
  init: function () {
    resetTopology();

    SIM.dv = createDistanceVector();
    SIM.ls = createLinkState();
    SIM.metrics = createMetrics();

    SIM.scene = createScene3D(document.getElementById("stage"));
    SIM.packetsA = createPackets3D(SIM.scene);
    SIM.scene.onFrame(function (dt) { SIM.packetsA.update(dt); });

    UI.init(SIM);
  },

  /* ------------------------------------------------------------------
     The clock
     ------------------------------------------------------------------ */

  /* Starts ticking. */
  play: function () {
    if (SIM.playing) return;
    SIM.playing = true;
    UI.syncControls();
    scheduleTick();
  },

  /* Stops ticking, without losing the current state. */
  pause: function () {
    SIM.playing = false;
    if (SIM.timer !== null) {
      clearTimeout(SIM.timer);
      SIM.timer = null;
    }
    UI.syncControls();
  },

  /* Play and pause in one button. */
  togglePlay: function () {
    if (SIM.playing) SIM.pause(); else SIM.play();
  },

  /* Changes how fast the ticks follow each other. */
  setSpeed: function (value) {
    SIM.speed = value;
    UI.syncControls();
  },

  /* ------------------------------------------------------------------
     One tick
     ------------------------------------------------------------------ */

  /* Advances both algorithms by one step and shows the result. */
  step: function () {
    const dvResult = SIM.dv.step();
    const lsResult = SIM.ls.step();

    sendPackets(dvResult.pk, "DV");
    sendPackets(lsResult.pk, "LS");

    const dvBucket = SIM.phase === "startup" ? "dvStartup" : "dvEvent";
    const lsBucket = SIM.phase === "startup" ? "lsStartup" : "lsEvent";
    SIM.metrics.add(dvBucket, dvResult.pk.length, dvResult.ch, dvResult.ch > 0 ? 1 : 0);
    SIM.metrics.add(lsBucket, lsResult.pk.length, lsResult.ch, lsResult.note === "idle" ? 0 : 1);

    SIM.tick++;

    showAnnouncement(describeTick(dvResult, lsResult));

    UI.afterTick({
      tick: SIM.tick,
      dv: dvResult,
      ls: lsResult
    });

    /* Both algorithms quiet: nothing more can happen. The count-to-infinity
       demo runs its second half instead of stopping, so it is not paused. */
    if (isQuiet(dvResult) && isQuiet(lsResult)) {
      if (SIM.demo !== null) return true;

      SIM.pause();
      UI.setStatus(SIM.phase === "startup"
        ? "Converged: every router knows the best route. Press Play to keep ticking, or pick another process."
        : "Re-converged after the link event. Press Play to keep ticking, or pick another process.");
      return true;
    }
    return false;
  },

  /* ------------------------------------------------------------------
     Processes and events
     ------------------------------------------------------------------ */

  /* Back to the exact starting state of the simulation. */
  reset: function () {
    SIM.pause();
    resetTopology();
    SIM.dv.reset();
    SIM.ls.reset();
    SIM.metrics.resetAll();
    SIM.tick = 0;
    SIM.phase = "startup";
    SIM.demo = null;
    clearAllPackets();
    SIM.scene.refreshLinks();
    SIM.scene.highlightPath([]);
    SIM.scene.hideCallout();
    if (SIM.sceneB !== null) {
      SIM.sceneB.refreshLinks();
      SIM.sceneB.highlightPath([]);
      SIM.sceneB.hideCallout();
    }
    UI.resetViews();
    UI.log("#0 Reset: every leased line is up again and both algorithms start from scratch.");
  },

  /* Fails a healthy link, or restores a failed one, in both algorithms. */
  linkEvent: function (a, b) {
    const wasAlive = isLinkAlive(a, b);

    if (wasAlive) {
      failLink(a, b);
      SIM.dv.handleLinkFailure(a, b);
      SIM.ls.handleLinkChange(a, b);
    } else {
      restoreLink(a, b);
      SIM.dv.handleLinkRestore(a, b);
      SIM.ls.handleLinkChange(a, b);
    }

    /* The "after a link event" counters start again from zero, as the rules say. */
    SIM.metrics.resetEvent();
    SIM.phase = "event";

    SIM.scene.refreshLinks();
    if (SIM.sceneB !== null) SIM.sceneB.refreshLinks();

    SIM.scene.pulseNode(a, 0xef4444);
    SIM.scene.pulseNode(b, 0xef4444);
    SIM.scene.showCallout(a, a + " - " + b + (wasAlive ? " failed" : " restored"));

    UI.log("#" + SIM.tick + " Link " + a + "-" + b + (wasAlive ? " failed" : " restored") +
      " - both algorithms are recalculating.");
    UI.syncControls();   // so the dropdown shows [FAILED] straight away
    UI.refreshAll();
  },

  /* Switches the split-screen mode on or off (distance vector left, link state right). */
  setSplit: function (on) {
    SIM.split = on;

    const stages = document.getElementById("stages");
    const stageB = document.getElementById("stage-b");
    stages.className = on ? "stages split" : "stages";
    stageB.hidden = !on;
    document.getElementById("stage-tag-a").hidden = !on;

    if (on && SIM.sceneB === null) {
      SIM.sceneB = createScene3D(stageB);
      SIM.packetsB = createPackets3D(SIM.sceneB);
      SIM.sceneB.onFrame(function (dt) { SIM.packetsB.update(dt); });
    }

    if (SIM.sceneB !== null) {
      SIM.sceneB.refreshLinks();
      SIM.sceneB.hideCallout();
    }
    SIM.scene.refreshLinks();

    SIM.scene.resize();
    if (SIM.sceneB !== null) SIM.sceneB.resize();

    UI.syncControls();
    UI.refreshAll();
  },

  /* Turns the split horizon with poison reverse rule on or off. */
  setPoisonReverse: function (on) {
    SIM.dv.setSplitHorizon(on);
    UI.log("Split horizon with poison reverse is now " + (on ? "ON" : "OFF") + ".");
    UI.syncControls();
  },

  /* ------------------------------------------------------------------
     Reading state for the panels
     ------------------------------------------------------------------ */

  /* The chosen route of both algorithms between two locations. */
  paths: function (from, to) {
    return {
      dv: { path: SIM.dv.path(from, to), cost: SIM.dv.distance(from, to) },
      ls: { path: SIM.ls.path(from, to), cost: SIM.ls.distance(from, to) }
    };
  },

  /* Both routing tables for one router. */
  tables: function (router) {
    return { dv: SIM.dv.rowOf(router), ls: SIM.ls.rowOf(router) };
  },

  /* Every ordered pair, for the all-pairs comparison table. */
  pairs: function () {
    const rows = [];
    for (let i = 0; i < NODES.length; i++) {
      for (let j = 0; j < NODES.length; j++) {
        if (NODES[i].id === NODES[j].id) continue;
        rows.push({
          from: NODES[i].id,
          to: NODES[j].id,
          dvCost: SIM.dv.distance(NODES[i].id, NODES[j].id),
          dvPath: SIM.dv.path(NODES[i].id, NODES[j].id),
          lsCost: SIM.ls.distance(NODES[i].id, NODES[j].id),
          lsPath: SIM.ls.path(NODES[i].id, NODES[j].id)
        });
      }
    }
    return rows;
  },

  /* Runs both engines until they are quiet, without animating anything. Used
     at the start of a process so the interesting part is what you then watch.
     The work still really happened, so it is counted in the metric bucket the
     simulation is currently in - the numbers stay honest. */
  settleInstantly: function () {
    const startup = SIM.phase === "startup";

    for (let i = 0; i < 200; i++) {
      const dvResult = SIM.dv.step();
      const lsResult = SIM.ls.step();

      SIM.metrics.add(startup ? "dvStartup" : "dvEvent", dvResult.pk.length, dvResult.ch,
        dvResult.ch > 0 ? 1 : 0);
      SIM.metrics.add(startup ? "lsStartup" : "lsEvent", lsResult.pk.length, lsResult.ch,
        lsResult.note === "idle" ? 0 : 1);

      if (isQuiet(dvResult) && isQuiet(lsResult)) break;
    }
  }
};

/* ------------------------------------------------------------------
   The ticking loop and the small helpers it needs
   ------------------------------------------------------------------ */

/* Queues the next tick after a delay that depends on the speed slider. */
function scheduleTick() {
  if (!SIM.playing) return;
  SIM.timer = setTimeout(function () {
    SIM.timer = null;
    const converged = SIM.step();
    if (SIM.demo !== null && converged) advanceDemo();
    if (SIM.playing) scheduleTick();
  }, 900 / SIM.speed);
}

/* True when an engine result means "nothing left to do". */
function isQuiet(result) {
  return result.note === "quiet" || result.note === "idle";
}

/* Hands a list of messages to the right animation layer. In split-screen mode
   distance vector packets stay on the left and link state packets go right. */
function sendPackets(packets, kind) {
  if (packets.length === 0) return;
  if (SIM.split && kind === "LS" && SIM.packetsB !== null) SIM.packetsB.spawn(packets);
  else SIM.packetsA.spawn(packets);
}

/* Removes every animated packet from every view. */
function clearAllPackets() {
  SIM.packetsA.clear();
  if (SIM.packetsB !== null) SIM.packetsB.clear();
}

/* ------------------------------------------------------------------
   What to say next to a router after a tick
   ------------------------------------------------------------------ */

/* Groups changed table cells by router and returns the router with the most
   changes, so the caption points at the busiest place. */
function busiestRouter(changed) {
  const counts = {};
  for (let i = 0; i < changed.length; i++) {
    const node = changed[i][0];
    counts[node] = (counts[node] === undefined ? 1 : counts[node] + 1);
  }
  let best = null;
  for (const node in counts) {
    if (best === null || counts[node] > counts[best]) best = node;
  }
  return best === null ? null : { node: best, count: counts[best] };
}

/* Builds the caption that is shown next to a place in the 3D view. */
function describeTick(dvResult, lsResult) {
  if (SIM.demo !== null) return demoAnnouncement();

  /* Flooding is the most visible event, so it gets the caption first. */
  if (lsResult.note === "flooding" && lsResult.pk.length > 0) {
    return {
      node: lsResult.pk[0][0],
      text: "flooding: " + lsResult.pk.length + " LSP copy" + (lsResult.pk.length === 1 ? "" : "s")
    };
  }

  if (dvResult.changed.length > 0) {
    const busiest = busiestRouter(dvResult.changed);
    return { node: busiest.node, text: "DV: " + busiest.count + " route" + (busiest.count === 1 ? "" : "s") + " updated" };
  }

  if (lsResult.changed.length > 0) {
    const busiest = busiestRouter(lsResult.changed);
    return { node: busiest.node, text: "Dijkstra: " + busiest.count + " route" + (busiest.count === 1 ? "" : "s") + " updated" };
  }

  if (dvResult.note === "quiet") {
    return { node: "HO", text: "DV quiet round: converged" };
  }

  return null;
}

/* Shows a caption at a place, and flashes that place. */
function showAnnouncement(announcement) {
  if (announcement === null) return;
  SIM.scene.pulseNode(announcement.node);
  SIM.scene.showCallout(announcement.node, announcement.text);
  if (SIM.sceneB !== null) SIM.sceneB.showCallout(announcement.node, announcement.text);
}

/* ------------------------------------------------------------------
   The bonus process: count to infinity, with the rule off and then on
   ------------------------------------------------------------------ */

const DEMO_LINK = { a: "RH-N", b: "BR-A" };
const DEMO_FROM = "RH-S";
const DEMO_TO = "RH-N";

/* Starts the demo: poison reverse off first, then on, on the same failure. */
function startCountToInfinityDemo() {
  SIM.demo = { stage: "off", peak: 0, rounds: 0, messages: 0, results: {} };
  document.getElementById("poison").checked = false;
  SIM.setPoisonReverse(false);
  prepareDemoRun();
  SIM.play();
}

/* Puts the network into the state the demo needs for its current stage.
   Ticking is blocked while the network is rearranged, then restored, so the
   demo can move from its first half to its second without stopping. */
function prepareDemoRun() {
  const wasPlaying = SIM.playing;
  SIM.playing = false;

  resetTopology();
  SIM.dv.reset();
  SIM.ls.reset();
  SIM.tick = 0;
  SIM.phase = "startup";                  // the settling counts as start-up work
  clearAllPackets();

  SIM.settleInstantly();                  // start from a settled network

  SIM.metrics.resetEvent();
  SIM.phase = "event";
  failLink(DEMO_LINK.a, DEMO_LINK.b);
  SIM.dv.handleLinkFailure(DEMO_LINK.a, DEMO_LINK.b);
  SIM.ls.handleLinkChange(DEMO_LINK.a, DEMO_LINK.b);

  SIM.scene.refreshLinks();
  SIM.scene.showCallout(DEMO_TO, "cost " + costText(SIM.dv.distance(DEMO_FROM, DEMO_TO)));

  SIM.demo.rounds = 0;
  SIM.demo.messages = 0;
  SIM.demo.peak = 0;

  SIM.playing = wasPlaying;
}

/* The caption while the demo runs: the cost that is counting up. */
function demoAnnouncement() {
  const cost = SIM.dv.distance(DEMO_FROM, DEMO_TO);
  return {
    node: DEMO_FROM,
    text: DEMO_FROM + " to " + DEMO_TO + ": " + costText(cost)
  };
}

/* Called after every tick of the demo: tracks the climb and moves on. */
function advanceDemo() {
  const cost = SIM.dv.distance(DEMO_FROM, DEMO_TO);
  if (cost < INF && cost > SIM.demo.peak) SIM.demo.peak = cost;
  SIM.demo.rounds = SIM.metrics.get("dvEvent").rounds;
  SIM.demo.messages = SIM.metrics.get("dvEvent").messages;

  if (SIM.demo.stage === "off") {
    SIM.demo.results.off = { rounds: SIM.demo.rounds, messages: SIM.demo.messages, peak: SIM.demo.peak };
    UI.log("Count to infinity, poison reverse OFF: " + DEMO_FROM + " to " + DEMO_TO +
      " climbed to " + SIM.demo.peak + ", " + SIM.demo.rounds + " rounds, " +
      SIM.demo.messages + " messages.");

    /* Same failure again, this time with the rule on. */
    SIM.demo.stage = "on";
    document.getElementById("poison").checked = true;
    SIM.setPoisonReverse(true);
    prepareDemoRun();
    return;
  }

  SIM.demo.results.on = { rounds: SIM.demo.rounds, messages: SIM.demo.messages, peak: SIM.demo.peak };
  UI.log("Count to infinity, poison reverse ON: peak " + SIM.demo.peak + ", " +
    SIM.demo.rounds + " rounds, " + SIM.demo.messages + " messages.");

  const off = SIM.demo.results.off;
  const on = SIM.demo.results.on;
  UI.setStatus("Count-to-infinity demo finished on the link " + DEMO_LINK.a + "-" + DEMO_LINK.b +
    ". Poison reverse off: peak cost " + off.peak + ", " + off.rounds + " changing rounds, " +
    off.messages + " messages. Poison reverse on: peak cost " + on.peak + ", " + on.rounds +
    " changing rounds, " + on.messages + " messages. Both end at the same correct costs.");
  SIM.demo = null;
}

/* ------------------------------------------------------------------
   Start the whole thing
   ------------------------------------------------------------------ */

SIM.init();
