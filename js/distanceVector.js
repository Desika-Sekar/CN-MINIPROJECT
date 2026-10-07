/* distanceVector.js — the distance vector (Bellman-Ford) routing engine.

   This file contains NO drawing and NO DOM code. Every step returns plain data:

     { pk:   [[fromNode, toNode, "DV"], ...],   the messages sent this round
       ch:   numberOfTableChanges,              how many cells changed
       note: "round" | "quiet" | "idle" | "event",
       changed: [[nodeId, destId], ...] }       which cells changed

   The 3D layer and the HTML panels only read that data, so the animation, the
   log, the counters and the tables always agree.

   How it works, in one sentence: in each round every router receives the full
   distance vector of each neighbour and keeps whichever route is cheapest. */

function createDistanceVector() {

  /* tables[node][dest] = { cost, next }
     cost is the distance in routing units, next is the neighbour to hand the
     packet to (null when there is no route at all). */
  const tables = {};

  let splitHorizon = false;   // bonus feature: poison reverse (phase 7)
  let converged = false;

  /* ------------------------------------------------------------------
     Building and reading tables
     ------------------------------------------------------------------ */

  /* Writes one cell of one table. */
  function setEntry(node, dest, cost, next) {
    tables[node][dest] = { cost: cost, next: next };
  }

  /* Builds the starting tables of every router: a router knows itself (cost 0)
     and its direct neighbours, and nothing else yet. */
  function reset() {
    for (let i = 0; i < NODES.length; i++) {
      const me = NODES[i].id;
      tables[me] = {};

      for (let j = 0; j < NODES.length; j++) {
        const dest = NODES[j].id;
        setEntry(me, dest, dest === me ? 0 : INF, dest === me ? me : null);
      }

      const neighbours = neighboursOf(me);
      for (let k = 0; k < neighbours.length; k++) {
        const cost = linkCost(me, neighbours[k]);
        if (cost < INF) setEntry(me, neighbours[k], cost, neighbours[k]);
      }
    }
    converged = false;
  }

  /* A deep copy of every table, so one round is computed from a frozen picture
     of the network ("synchronous rounds"). */
  function snapshot() {
    const copy = {};
    for (let i = 0; i < NODES.length; i++) {
      const me = NODES[i].id;
      copy[me] = {};
      for (let j = 0; j < NODES.length; j++) {
        const dest = NODES[j].id;
        copy[me][dest] = { cost: tables[me][dest].cost, next: tables[me][dest].next };
      }
    }
    return copy;
  }

  /* The vector that "sender" advertises to "receiver". With split horizon and
     poison reverse switched on, a router tells that neighbour "my distance to
     this destination is unreachable" whenever the neighbour is the very next
     hop it would use - that is what stops a route being counted back up. */
  function advertisedVector(sender, receiver, frozen) {
    const vector = {};
    for (let i = 0; i < NODES.length; i++) {
      const dest = NODES[i].id;
      const entry = frozen[sender][dest];
      let cost = entry.cost;
      if (splitHorizon && dest !== sender && entry.next === receiver) cost = INF;
      vector[dest] = cost;
    }
    return vector;
  }

  /* ------------------------------------------------------------------
     One round
     ------------------------------------------------------------------ */

  /* Runs one synchronous Bellman-Ford round and reports what happened. */
  function step() {
    if (converged) return { pk: [], ch: 0, note: "idle", changed: [] };

    const frozen = snapshot();
    const pk = [];
    const changed = [];

    for (let i = 0; i < NODES.length; i++) {
      const me = NODES[i].id;
      const neighbours = aliveNeighboursOf(me);

      for (let k = 0; k < neighbours.length; k++) {
        const neighbour = neighbours[k];

        /* One vector handed to one neighbour = one message. */
        pk.push([me, neighbour, "DV"]);

        const vector = advertisedVector(neighbour, me, frozen);
        const link = linkCost(me, neighbour);

        for (let j = 0; j < NODES.length; j++) {
          const dest = NODES[j].id;
          if (dest === me) continue;

          /* Our cost to dest if we go through this neighbour. */
          const candidate = Math.min(INF, link + vector[dest]);
          const current = tables[me][dest];

          /* Two reasons to write the cell:
             1. the route already goes through this neighbour but its cost moved
                (this is the rule that lets bad news travel),
             2. the new route is strictly cheaper. */
          const throughSameNeighbour = current.next === neighbour && candidate !== current.cost;
          if (throughSameNeighbour || candidate < current.cost) {
            setEntry(me, dest, candidate, neighbour);
            changed.push([me, dest]);
          }
        }
      }
    }

    /* Nobody changed anything: that quiet round proves convergence. Its
       messages are still returned, so they are still counted. */
    if (changed.length === 0) converged = true;

    return {
      pk: pk,
      ch: changed.length,
      note: changed.length === 0 ? "quiet" : "round",
      changed: changed
    };
  }

  /* ------------------------------------------------------------------
     Link failures and restores
     ------------------------------------------------------------------ */

  /* A link went down. Both end routers immediately drop every route that used
     that neighbour, which is what a real router does when an interface drops. */
  function handleLinkFailure(a, b) {
    const changed = [];
    const ends = [a, b];

    for (let i = 0; i < ends.length; i++) {
      const me = ends[i];
      const lost = me === a ? b : a;
      for (let j = 0; j < NODES.length; j++) {
        const dest = NODES[j].id;
        if (tables[me][dest].next === lost) {
          setEntry(me, dest, INF, null);
          changed.push([me, dest]);
        }
      }
    }

    converged = false;
    return { pk: [], ch: changed.length, note: "event", changed: changed };
  }

  /* A link came back. Both ends install the direct route straight away when it
     is cheaper than what they currently believe, then the rounds continue. */
  function handleLinkRestore(a, b) {
    const changed = [];
    const ends = [a, b];
    const cost = linkCost(a, b);   // the link is alive again

    for (let i = 0; i < ends.length; i++) {
      const me = ends[i];
      const other = me === a ? b : a;
      if (cost < tables[me][other].cost) {
        setEntry(me, other, cost, other);
        changed.push([me, other]);
      }
    }

    converged = false;
    return { pk: [], ch: changed.length, note: "event", changed: changed };
  }

  /* ------------------------------------------------------------------
     Reading the result
     ------------------------------------------------------------------ */

  /* The whole row of one router's table, for the table viewer. */
  function rowOf(node) {
    const row = [];
    for (let i = 0; i < NODES.length; i++) {
      const dest = NODES[i].id;
      const entry = tables[node][dest];
      row.push({ dest: dest, cost: entry.cost, next: entry.next });
    }
    return row;
  }

  /* Distance from one location to another as the routers currently believe it. */
  function distance(from, dest) {
    return tables[from][dest].cost;
  }

  /* Walks the next hops to build the chosen path, e.g. ["HO","DC","ATM"].
     A visited list keeps a temporarily broken table from looping forever. */
  function path(from, dest) {
    if (tables[from][dest].cost >= INF) return [];
    const route = [from];
    const visited = {};
    visited[from] = true;
    let at = from;

    while (at !== dest) {
      const next = tables[at][dest].next;
      if (next === null || visited[next]) return [];   // no usable route
      route.push(next);
      visited[next] = true;
      at = next;
      if (route.length > NODES.length) return [];
    }
    return route;
  }

  /* True once the network has stopped changing. */
  function isConverged() {
    return converged;
  }

  /* Switches the split horizon with poison reverse rule on or off. */
  function setSplitHorizon(on) {
    splitHorizon = on === true;
  }

  /* Reads the current setting, used by the UI toggle. */
  function hasSplitHorizon() {
    return splitHorizon;
  }

  reset();

  return {
    reset: reset,
    step: step,
    handleLinkFailure: handleLinkFailure,
    handleLinkRestore: handleLinkRestore,
    rowOf: rowOf,
    distance: distance,
    path: path,
    isConverged: isConverged,
    setSplitHorizon: setSplitHorizon,
    hasSplitHorizon: hasSplitHorizon
  };
}
