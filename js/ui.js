/* ui.js — everything the user clicks and reads outside the 3D view.

   It owns the process picker, the controls, the routing-table viewer, the event
   log, the path finder and the comparison panel.

   ui.js never runs a routing algorithm itself. It calls the engines through the
   SIM object in main.js and then shows the plain data those engines return, so
   the numbers on screen and the moving objects in the 3D view cannot disagree. */

/* ------------------------------------------------------------------
   Icons for the process cards. Plain inline SVG (no icon library), drawn with
   a stroke so they follow the accent colour.
   ------------------------------------------------------------------ */

/* Wraps a few SVG shapes into a small, consistently styled icon. */
function taskIcon(shapes) {
  return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" ' +
    'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' + shapes + "</svg>";
}

const ICONS = {
  tour: taskIcon('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/>'),
  dv: taskIcon('<circle cx="6" cy="7" r="2.6"/><circle cx="18" cy="17" r="2.6"/>' +
    '<path d="M8.6 8.4 15.4 15.6"/><path d="M15.4 8.4 8.6 15.6"/>'),
  ls: taskIcon('<circle cx="12" cy="12" r="2.6"/>' +
    '<path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M6.5 6.5l2 2M15.5 15.5l2 2M17.5 6.5l-2 2M8.5 15.5l-2 2"/>'),
  path: taskIcon('<circle cx="5" cy="19" r="2.4"/><circle cx="19" cy="5" r="2.4"/>' +
    '<path d="M7.2 16.8C9.5 14.5 11 12 16.8 7.2"/>'),
  fail: taskIcon('<path d="M3 12h6M15 12h6"/><path d="M10 9l4 6"/>'),
  restore: taskIcon('<path d="M3 12h6M15 12h6"/><path d="M12 19V9"/><path d="M9 12l3-3 3 3"/>'),
  cut: taskIcon('<circle cx="12" cy="12" r="4"/><path d="M3.5 3.5l17 17"/>'),
  race: taskIcon('<path d="M4 19h16"/><path d="M7 19V11M12 19V5M17 19v-6"/>'),
  cti: taskIcon('<path d="M12 4.5a7.5 7.5 0 1 1-7.4 6.3"/>' +
    '<path d="M4.5 6.5v4.5H9"/><path d="M9.5 14.5c1.5 0 2-4.5 4-4.5s2.5 4.5 4 4.5" opacity="0.55"/>')
};

/* ------------------------------------------------------------------
   The processes. Every card starts a real flow in the 3D view.
   ------------------------------------------------------------------ */

const TASKS = [
  { id: "tour", icon: ICONS.tour, title: "Explore the network",
    text: "Move through the bank and meet each location one by one." },
  { id: "dv", icon: ICONS.dv, title: "Distance vector start-up",
    text: "Neighbours swap their whole tables until every router is sure of the way." },
  { id: "ls", icon: ICONS.ls, title: "Link state start-up",
    text: "Flood each router's own links, then run Dijkstra at every node." },
  { id: "trace", icon: ICONS.path, title: "Trace one route",
    text: "Light up the path each algorithm chose between two locations." },
  { id: "fail", icon: ICONS.fail, title: "Fail a link",
    text: "Break the Data Center line and watch both algorithms find a way round." },
  { id: "restore", icon: ICONS.restore, title: "Restore a link",
    text: "Bring that line back and watch the cheaper route return." },
  { id: "cut", icon: ICONS.cut, title: "Cut a location off",
    text: "Fail every line of Branch C and see its routes become unreachable." },
  { id: "race", icon: ICONS.race, title: "Head-to-head race",
    text: "Distance vector on the left, link state on the right, same events." },
  { id: "cti", icon: ICONS.cti, title: "Count-to-infinity demo",
    text: "See a cost climb above its true value, then see poison reverse fix it." }
];

/* ------------------------------------------------------------------
   The UI object
   ------------------------------------------------------------------ */

const UI = {

  sim: null,                 // the SIM object from main.js
  timer: null,               // interval of the guided tour
  tourIndex: 0,
  lastChanged: { dv: {}, ls: {} },   // cells that changed in the latest tick

  /* Called once by main.js. Wires every control and opens the picker. */
  init: function (sim) {
    UI.sim = sim;

    document.getElementById("btn-start").addEventListener("click", UI.openPicker);
    document.getElementById("btn-close-overlay").addEventListener("click", UI.closePicker);
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") UI.closePicker();
    });

    document.getElementById("btn-play").addEventListener("click", function () { UI.sim.togglePlay(); });
    document.getElementById("btn-step").addEventListener("click", function () { UI.sim.step(); });
    document.getElementById("btn-reset").addEventListener("click", function () { UI.sim.reset(); });

    document.getElementById("speed").addEventListener("input", function (event) {
      UI.sim.setSpeed(parseFloat(event.target.value));
    });

    document.getElementById("btn-top-view").addEventListener("click", function () { UI.sim.scene.topView(); });
    document.getElementById("btn-reset-camera").addEventListener("click", function () { UI.sim.scene.resetCamera(); });

    document.getElementById("btn-split").addEventListener("click", function () {
      UI.sim.setSplit(!UI.sim.split);
    });

    document.getElementById("poison").addEventListener("change", function (event) {
      UI.sim.setPoisonReverse(event.target.checked);
    });

    document.getElementById("btn-link-event").addEventListener("click", function () {
      const parts = document.getElementById("link-select").value.split("|");
      UI.sim.linkEvent(parts[0], parts[1]);
    });

    document.getElementById("router-select").addEventListener("change", function () { UI.renderRoutingTable(); });
    document.getElementById("from-select").addEventListener("change", function () { UI.renderPaths(); });
    document.getElementById("to-select").addEventListener("change", function () { UI.renderPaths(); });
    document.getElementById("highlight-select").addEventListener("change", function () { UI.applyHighlight(); });

    UI.buildSelects();
    buildTaskCards();
    UI.resetViews();

    /* One line that proves the message rule before anything is even run:
       every link is two one-way ends, and one vector is sent over each of them
       in every round. */
    UI.log("Network ready: " + NODES.length + " locations, " + LINKS.length +
      " leased lines, " + totalDegrees() + " one-way link ends.");

    UI.openPicker();
  },

  /* ------------------------------------------------------------------
     Small helpers
     ------------------------------------------------------------------ */

  /* Fills a <select> with one option per item. */
  fillSelect: function (id, items, selected) {
    const select = document.getElementById(id);
    select.innerHTML = "";
    for (let i = 0; i < items.length; i++) {
      const option = document.createElement("option");
      option.value = items[i].value;
      option.textContent = items[i].label;
      if (items[i].value === selected) option.selected = true;
      select.appendChild(option);
    }
  },

  /* Builds every dropdown from the real topology, so they can never go stale. */
  buildSelects: function () {
    const nodes = [];
    for (let i = 0; i < NODES.length; i++) {
      nodes.push({ value: NODES[i].id, label: NODES[i].id + " (" + NODES[i].description + ")" });
    }
    UI.fillSelect("router-select", nodes, "HO");
    UI.fillSelect("from-select", nodes, "HO");
    UI.fillSelect("to-select", nodes, "ATM");

    const links = [];
    for (let i = 0; i < LINKS.length; i++) {
      links.push({ value: LINKS[i].a + "|" + LINKS[i].b, label: LINKS[i].a + " - " + LINKS[i].b + " (cost " + LINKS[i].cost + ")" });
    }
    UI.fillSelect("link-select", links, "DC|ATM");
    document.getElementById("link-select").value = "DC|ATM";
  },

  /* Shows or hides the process picker. */
  openPicker: function () { document.getElementById("task-overlay").hidden = false; },
  closePicker: function () { document.getElementById("task-overlay").hidden = true; },

  /* Writes the line that says what is happening. */
  setStatus: function (text) { document.getElementById("process-status").textContent = text; },

  /* Adds one line to the event log, newest first, capped at 60 lines. */
  log: function (text) {
    const list = document.getElementById("event-log");
    const item = document.createElement("li");
    item.textContent = text;
    list.insertBefore(item, list.firstChild);

    while (list.children.length > 60) list.removeChild(list.lastChild);
  },

  /* Keeps the buttons, sliders and checkboxes showing the real state. */
  syncControls: function () {
    const playButton = document.getElementById("btn-play");
    playButton.textContent = UI.sim.playing ? "Pause" : "Play";
    playButton.className = UI.sim.playing ? "" : "primary";

    document.getElementById("speed-value").textContent = UI.sim.speed.toFixed(2).replace(/0$/, "") + "\u00d7";
    document.getElementById("poison").checked = UI.sim.dv.hasSplitHorizon();
    document.getElementById("btn-split").textContent = UI.sim.split ? "Single view" : "Split screen";

    /* Mark the failed lines in the dropdown so it is obvious what is broken. */
    const select = document.getElementById("link-select");
    for (let i = 0; i < select.options.length; i++) {
      const parts = select.options[i].value.split("|");
      const alive = isLinkAlive(parts[0], parts[1]);
      select.options[i].textContent = parts[0] + " - " + parts[1] +
        " (cost " + findLink(parts[0], parts[1]).cost + ")" + (alive ? "" : "  [FAILED]");
    }
  },

  /* Clears the panels back to their starting look. */
  resetViews: function () {
    UI.lastChanged = { dv: {}, ls: {} };
    document.getElementById("event-log").innerHTML = "";
    document.getElementById("tick-label").textContent =
      "Distance vector and link state routing on the same banking network \u2014 tick 0";
    UI.syncControls();
    UI.refreshAll();
  },

  /* ------------------------------------------------------------------
     Rendering after a tick
     ------------------------------------------------------------------ */

  /* Reads one tick's results and updates everything that depends on them. */
  afterTick: function (info) {
    document.getElementById("tick-label").textContent =
      "Distance vector and link state routing on the same banking network \u2014 tick " + info.tick;

    /* Remember which cells changed, so the table can highlight them. */
    UI.lastChanged = { dv: {}, ls: {} };
    for (let i = 0; i < info.dv.changed.length; i++) {
      UI.lastChanged.dv[info.dv.changed[i][0] + "|" + info.dv.changed[i][1]] = true;
    }
    for (let i = 0; i < info.ls.changed.length; i++) {
      UI.lastChanged.ls[info.ls.changed[i][0] + "|" + info.ls.changed[i][1]] = true;
    }

    const dvPart = "DV: " + info.dv.pk.length + " msgs, " + info.dv.ch + " updates";
    const lsWord = info.ls.note === "flooding" ? "flooding" :
      (info.ls.note === "Dijkstra" ? "Dijkstra" : info.ls.note);
    const lsPart = "LS: " + lsWord + ", " + info.ls.pk.length + " msgs, " + info.ls.ch + " updates";
    UI.log("#" + info.tick + " " + dvPart + " | " + lsPart);

    UI.syncControls();
    UI.refreshAll();
  },

  /* Redraws every panel that shows numbers. */
  refreshAll: function () {
    UI.renderRoutingTable();
    UI.renderPaths();
    UI.renderComparison();
    UI.renderPairs();
  },

  /* ------------------------------------------------------------------
     Routing table viewer
     ------------------------------------------------------------------ */

  /* One cell of the table: "cost via next hop", or the word unreachable. */
  cellText: function (entry) {
    if (entry.cost >= INF) return "unreachable";
    if (entry.next === null || entry.next === entry.dest) return String(entry.cost);
    return entry.cost + " via " + entry.next;
  },

  /* Draws the chosen router's row from both algorithms. */
  renderRoutingTable: function () {
    const router = document.getElementById("router-select").value;
    const tables = UI.sim.tables(router);
    const body = document.getElementById("routing-table-body");
    body.innerHTML = "";

    for (let i = 0; i < tables.dv.length; i++) {
      const dest = tables.dv[i].dest;
      const row = document.createElement("tr");

      const nameCell = document.createElement("th");
      nameCell.scope = "row";
      nameCell.textContent = dest;
      row.appendChild(nameCell);

      const dvCell = document.createElement("td");
      dvCell.textContent = UI.cellText(tables.dv[i]);
      if (UI.lastChanged.dv[router + "|" + dest]) dvCell.className = "changed-dv";
      row.appendChild(dvCell);

      const lsCell = document.createElement("td");
      lsCell.textContent = UI.cellText(tables.ls[i]);
      if (UI.lastChanged.ls[router + "|" + dest]) lsCell.className = "changed-ls";
      row.appendChild(lsCell);

      body.appendChild(row);
    }
  },

  /* ------------------------------------------------------------------
     Path finder
     ------------------------------------------------------------------ */

  /* Shows the route both algorithms chose between the two chosen locations. */
  renderPaths: function () {
    const from = document.getElementById("from-select").value;
    const to = document.getElementById("to-select").value;
    if (from === to) {
      document.getElementById("dv-path-text").textContent = "Pick two different locations.";
      document.getElementById("ls-path-text").textContent = "";
      UI.sim.scene.highlightPath([]);
      return;
    }

    const paths = UI.sim.paths(from, to);

    document.getElementById("dv-path-text").textContent = paths.dv.path.length === 0
      ? "unreachable"
      : paths.dv.path.join(" \u2192 ") + "   (cost " + costText(paths.dv.cost) + ")";

    document.getElementById("ls-path-text").textContent = paths.ls.path.length === 0
      ? "unreachable"
      : paths.ls.path.join(" \u2192 ") + "   (cost " + costText(paths.ls.cost) + ")";

    UI.applyHighlight();
  },

  /* Paints the chosen route in green, in one or both of the 3D views. */
  applyHighlight: function () {
    const which = document.getElementById("highlight-select").value;
    const from = document.getElementById("from-select").value;
    const to = document.getElementById("to-select").value;
    const paths = UI.sim.paths(from, to);

    if (UI.sim.split) {
      /* In split-screen the two views show their own algorithm, which is the
         whole point of the comparison. */
      UI.sim.scene.highlightPath(paths.dv.path);
      if (UI.sim.sceneB !== null) UI.sim.sceneB.highlightPath(paths.ls.path);
      return;
    }

    if (which === "dv") UI.sim.scene.highlightPath(paths.dv.path);
    else if (which === "ls") UI.sim.scene.highlightPath(paths.ls.path);
    else UI.sim.scene.highlightPath([]);
  },

  /* ------------------------------------------------------------------
     Comparison panel
     ------------------------------------------------------------------ */

  /* The four counters, the bars and the conclusion sentence. */
  renderComparison: function () {
    const keys = ["dvStartup", "lsStartup", "dvEvent", "lsEvent"];
    const rows = [
      { label: "Messages", field: "messages" },
      { label: "Table updates", field: "updates" },
      { label: "Rounds or steps", field: "rounds" }
    ];

    /* Numbers only, no invented values. */
    const body = document.getElementById("comparison-body");
    body.innerHTML = "";

    let biggest = 1;
    for (let k = 0; k < keys.length; k++) {
      for (let r = 0; r < rows.length; r++) {
        biggest = Math.max(biggest, UI.sim.metrics.get(keys[k])[rows[r].field]);
      }
    }

    for (let r = 0; r < rows.length; r++) {
      const row = document.createElement("tr");
      const head = document.createElement("th");
      head.scope = "row";
      head.textContent = rows[r].label;
      row.appendChild(head);

      for (let k = 0; k < keys.length; k++) {
        const cell = document.createElement("td");
        cell.textContent = UI.sim.metrics.get(keys[k])[rows[r].field];
        row.appendChild(cell);
      }
      body.appendChild(row);
    }

    /* Simple CSS bars for the same numbers (no chart library). */
    const bars = document.getElementById("bars");
    bars.innerHTML = "";
    for (let r = 0; r < rows.length; r++) {
      const group = document.createElement("div");
      group.className = "bar-group";

      const title = document.createElement("span");
      title.className = "bar-title";
      title.textContent = rows[r].label;
      group.appendChild(title);

      for (let k = 0; k < keys.length; k++) {
        const value = UI.sim.metrics.get(keys[k])[rows[r].field];
        const line = document.createElement("div");
        line.className = "bar-line";

        const name = document.createElement("span");
        name.className = "bar-name";
        name.textContent = METRIC_LABELS[keys[k]];
        line.appendChild(name);

        const track = document.createElement("span");
        track.className = "bar-track";
        const fill = document.createElement("span");
        fill.className = "bar-fill bar-" + keys[k];
        fill.style.width = Math.round((value / biggest) * 100) + "%";
        track.appendChild(fill);
        line.appendChild(track);

        const number = document.createElement("span");
        number.className = "bar-value";
        number.textContent = value;
        line.appendChild(number);

        group.appendChild(line);
      }
      bars.appendChild(group);
    }

    /* The conclusion is generated from the measured counters, never typed in. */
    const pairs = UI.sim.pairs();
    let identical = true;
    for (let i = 0; i < pairs.length; i++) {
      if (pairs[i].dvCost !== pairs[i].lsCost) { identical = false; break; }
    }
    document.getElementById("conclusion").textContent = UI.sim.metrics.buildConclusion(identical);
  },

  /* The table of all 56 ordered pairs. */
  renderPairs: function () {
    const pairs = UI.sim.pairs();
    const body = document.getElementById("pairs-body");
    body.innerHTML = "";

    for (let i = 0; i < pairs.length; i++) {
      const p = pairs[i];
      const row = document.createElement("tr");

      const cells = [
        p.from + " \u2192 " + p.to,
        costText(p.dvCost),
        p.dvPath.length === 0 ? "-" : p.dvPath.join(">"),
        costText(p.lsCost),
        p.lsPath.length === 0 ? "-" : p.lsPath.join(">")
      ];

      for (let c = 0; c < cells.length; c++) {
        const cell = document.createElement(c === 0 ? "th" : "td");
        if (c === 0) cell.scope = "row";
        cell.textContent = cells[c];
        /* A quiet mark where the two algorithms picked different paths. */
        if (c === 4 && p.dvPath.join(">") !== p.lsPath.join(">")) cell.className = "tie";
        row.appendChild(cell);
      }
      body.appendChild(row);
    }
  },

  /* ------------------------------------------------------------------
     Processes
     ------------------------------------------------------------------ */

  /* Starts one process from the picker. */
  startProcess: function (task) {
    UI.closePicker();
    stopTour();

    /* Every process other than the tour starts from a clean network. */
    if (task.id !== "tour") UI.sim.reset();

    if (task.id === "tour") {
      startTour();
      return;
    }

    if (task.id === "dv") {
      UI.sim.setSplit(false);
      UI.setStatus("Distance vector start-up: every router is learning its neighbours' " +
        "tables. A blue packet is one table handed to one neighbour; 22 of them leave per round.");
      UI.sim.play();
      return;
    }

    if (task.id === "ls") {
      UI.sim.setSplit(false);
      UI.setStatus("Link state start-up: orange packets flood each router's own links to " +
        "everybody, and then every router runs Dijkstra on the map it collected.");
      UI.sim.play();
      return;
    }

    if (task.id === "trace") {
      UI.sim.settleInstantly();
      UI.refreshAll();
      document.getElementById("highlight-select").value = "dv";
      UI.applyHighlight();
      const from = document.getElementById("from-select").value;
      const to = document.getElementById("to-select").value;
      const paths = UI.sim.paths(from, to);
      UI.sim.scene.showCallout(from, from + " to " + to + ": " + costText(paths.dv.cost));
      UI.setStatus("Tracing " + from + " to " + to + ". The green line is the distance vector " +
        "route; change the dropdown to see the link state route instead.");
      return;
    }

    if (task.id === "fail") {
      /* Settle first, so the interesting part is what happens next. */
      UI.sim.settleInstantly();
      UI.refreshAll();
      UI.sim.linkEvent("DC", "ATM");
      UI.setStatus("The Data Center line is down. Both algorithms are spreading the bad news " +
        "and looking for another way round to the ATM.");
      UI.sim.play();
      return;
    }

    if (task.id === "restore") {
      UI.sim.settleInstantly();
      UI.refreshAll();
      if (isLinkAlive("DC", "ATM")) UI.sim.linkEvent("DC", "ATM");   // take it down first
      UI.sim.linkEvent("DC", "ATM");                                  // then bring it back
      UI.setStatus("The Data Center line is back up. Watch the cheaper route being reinstalled.");
      UI.sim.play();
      return;
    }

    if (task.id === "cut") {
      UI.sim.settleInstantly();
      UI.refreshAll();
      UI.sim.linkEvent("RH-S", "BR-C");
      UI.sim.linkEvent("ATM", "BR-C");
      UI.setStatus("Branch C has lost both of its lines. Its routes go unreachable in both " +
        "algorithms, without either of them looping forever.");
      UI.sim.play();
      return;
    }

    if (task.id === "race") {
      UI.sim.setSplit(true);
      UI.setStatus("Head-to-head: distance vector on the left, link state on the right, " +
        "same network and same events. Compare the packets per tick and the rounds to converge.");
      UI.sim.play();
      return;
    }

    if (task.id === "cti") {
      UI.sim.setSplit(false);
      UI.setStatus("Count-to-infinity demo running: first with poison reverse off, then with it on.");
      startCountToInfinityDemo();
      return;
    }
  },

  /* One step of the guided tour: look at the next location and label it. */
  stepTour: function () {
    const node = NODES[UI.tourIndex];

    if (node === undefined) {
      stopTour();
      UI.sim.scene.resetCamera();
      UI.sim.scene.hideCallout();
      UI.setStatus("Tour finished. Press \"Start simulation\" to choose another process.");
      return;
    }

    UI.sim.scene.focusOn(node.id);
    UI.sim.scene.pulseNode(node.id);
    /* The words appear right next to the location they describe. */
    UI.sim.scene.showCallout(node.id, node.description + " (" + node.id + ")");
    UI.setStatus("Exploring: " + node.description + " (" + node.id +
      "). Choose a process to see routing happen here.");
    UI.tourIndex++;
  }
};

/* ------------------------------------------------------------------
   Functions that need UI to exist
   ------------------------------------------------------------------ */

/* Draws one card per process. Every process is live: picking one starts a real
   flow, and the same events feed both algorithms. */
function buildTaskCards() {
  const grid = document.getElementById("task-grid");
  grid.innerHTML = "";

  for (let i = 0; i < TASKS.length; i++) {
    const task = TASKS[i];
    const card = document.createElement("button");
    card.type = "button";
    card.className = "task-card";
    card.innerHTML =
      '<span class="task-icon">' + task.icon + "</span>" +
      '<span class="task-text"><strong>' + task.title + "</strong>" +
      "<small>" + task.text + "</small></span>" +
      '<span class="task-tag">Run</span>';

    card.addEventListener("click", function () { UI.startProcess(task); });
    grid.appendChild(card);
  }
}

/* Runs the guided tour: one location every 1.5 seconds, then it stops. */
function startTour() {
  UI.tourIndex = 0;
  UI.sim.scene.resetCamera();
  UI.stepTour();
  UI.timer = setInterval(UI.stepTour, 1500);
}

/* Stops the guided tour if it is running. */
function stopTour() {
  if (UI.timer !== null) {
    clearInterval(UI.timer);
    UI.timer = null;
  }
}
