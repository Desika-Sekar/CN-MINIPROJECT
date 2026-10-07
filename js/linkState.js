/* linkState.js — the link state routing engine: step-by-step flooding plus a
   Dijkstra computation at every router.

   This file contains NO drawing and NO DOM code. A step returns plain data:

     { pk:   [[fromNode, toNode, "LS"], ...],   flooding transmissions this step
       ch:   numberOfTableChanges,
       note: "flooding" | "Dijkstra" | "idle" | "event",
       changed: [[nodeId, destId], ...] }

   How it works, in one sentence: every router describes its own links in a
   small message (an LSP), floods that message to the whole network, and then
   each router computes the best paths from the complete map with Dijkstra. */

function createLinkState() {

  /* db[node][origin] = { seq, neighbours: [{ id, cost }] }
     This is the "link state database": a router's copy of everybody's map. */
  const db = {};

  /* tables[node][dest] = { cost, next }, filled in by Dijkstra. */
  const tables = {};

  /* Messages still to be forwarded, one entry per copy of an LSP:
     { node, origin, seq, from } */
  let pending = [];

  let converged = false;

  /* The list of links a router currently has, as its own LSP payload. */
  function ownLinks(node) {
    const list = [];
    const neighbours = neighboursOf(node);
    for (let i = 0; i < neighbours.length; i++) {
      const cost = linkCost(node, neighbours[i]);
      if (cost < INF) list.push({ id: neighbours[i], cost: cost });
    }
    return list;
  }

  /* Starts a new version of a router's own LSP: higher sequence number, fresh
     link list, and a copy queued up for flooding. */
  function originate(node) {
    const previous = db[node][node];
    const seq = previous ? previous.seq + 1 : 1;

    db[node][node] = { seq: seq, neighbours: ownLinks(node) };

    /* The queued copy carries the whole LSP: origin, sequence number and the
       link list, because this is what gets handed on link by link. */
    pending.push({
      node: node,
      origin: node,
      seq: seq,
      neighbours: db[node][node].neighbours,
      from: null
    });

    /* Fresh news means the network is no longer settled. */
    converged = false;

    return seq;
  }

  /* Builds the starting state: every router holds its own LSP (version 1) and
     knows itself plus its direct neighbours, exactly like distance vector. */
  function reset() {
    pending = [];
    converged = false;

    for (let i = 0; i < NODES.length; i++) {
      const me = NODES[i].id;
      db[me] = {};
      tables[me] = {};

      for (let j = 0; j < NODES.length; j++) {
        const dest = NODES[j].id;
        tables[me][dest] = { cost: dest === me ? 0 : INF, next: dest === me ? me : null };
      }

      const neighbours = neighboursOf(me);
      for (let k = 0; k < neighbours.length; k++) {
        const cost = linkCost(me, neighbours[k]);
        if (cost < INF) tables[me][neighbours[k]] = { cost: cost, next: neighbours[k] };
      }
    }

    /* Everyone announces their own links; the flooding starts from here. */
    for (let i = 0; i < NODES.length; i++) originate(NODES[i].id);
  }

  /* ------------------------------------------------------------------
     Flooding
     ------------------------------------------------------------------ */

  /* Sends all waiting copies one hop further. A router never sends a copy back
     over the link it arrived on, and a router keeps a copy only when the
     sequence number is newer than what it already has. */
  function floodOneStep() {
    const sending = pending;
    pending = [];
    const pk = [];

    for (let i = 0; i < sending.length; i++) {
      const item = sending[i];
      const neighbours = aliveNeighboursOf(item.node);

      for (let k = 0; k < neighbours.length; k++) {
        const neighbour = neighbours[k];
        if (neighbour === item.from) continue;   // do not send it back

        /* Every transmission counts as one message, duplicates included. */
        pk.push([item.node, neighbour, "LS"]);

        const stored = db[neighbour][item.origin];
        if (stored === undefined || stored.seq < item.seq) {
          db[neighbour][item.origin] = { seq: item.seq, neighbours: item.neighbours };

          /* Keep the same LSP alive on its next hop. */
          pending.push({
            node: neighbour,
            origin: item.origin,
            seq: item.seq,
            neighbours: item.neighbours,
            from: item.node
          });
        }
        /* Otherwise it is a duplicate: the transmission is counted, the copy is
           thrown away. */
      }
    }

    return pk;
  }

  /* ------------------------------------------------------------------
     Dijkstra at every router
     ------------------------------------------------------------------ */

  /* Builds one undirected graph out of the whole database.

     Two rules make this correct even while the network is still recovering:
       1. only the newest LSP version of each router is used (the highest
          sequence number that exists anywhere in the database), and
       2. a link counts only when BOTH of its ends still advertise it.
     Rule 2 is what makes a cut-off router disappear: a router that has lost all
     its links cannot flood its own empty LSP, but the neighbours that dropped it
     do publish theirs, and one end saying "the link is gone" is enough. */
  function graph() {
    const neighbours = {};
    for (let i = 0; i < NODES.length; i++) neighbours[NODES[i].id] = [];

    /* The newest version of each router's own LSP. */
    const newest = {};
    for (let i = 0; i < NODES.length; i++) {
      const holder = NODES[i].id;
      for (let j = 0; j < NODES.length; j++) {
        const origin = NODES[j].id;
        const lsp = db[holder][origin];
        if (lsp === undefined) continue;
        if (newest[origin] === undefined || lsp.seq > newest[origin].seq) newest[origin] = lsp;
      }
    }

    /* Keeps a link only when the far end still lists it too. */
    const seen = {};
    for (const origin in newest) {
      const linksHere = newest[origin].neighbours;
      for (let k = 0; k < linksHere.length; k++) {
        const link = linksHere[k];
        const other = newest[link.id];
        if (other === undefined) continue;

        let confirmed = false;
        for (let m = 0; m < other.neighbours.length; m++) {
          if (other.neighbours[m].id === origin) { confirmed = true; break; }
        }
        if (!confirmed) continue;

        const key = origin < link.id ? origin + "|" + link.id : link.id + "|" + origin;
        if (seen[key] !== undefined && seen[key] <= link.cost) continue;
        seen[key] = link.cost;
      }
    }

    /* Now place each edge on both of its ends, in node order so ties are stable. */
    for (const key in seen) {
      const parts = key.split("|");
      neighbours[parts[0]].push({ id: parts[1], cost: seen[key] });
      neighbours[parts[1]].push({ id: parts[0], cost: seen[key] });
    }

    for (let i = 0; i < NODES.length; i++) {
      neighbours[NODES[i].id].sort(function (x, y) { return nodeOrder(x.id) - nodeOrder(y.id); });
    }
    return neighbours;
  }

  /* Plain Dijkstra (the network is tiny, so a simple scan is plenty): returns
     the cheapest distance from "start" to every location. */
  function shortestDistances(start, neighbours) {
    const dist = {};
    const done = {};

    for (let i = 0; i < NODES.length; i++) {
      dist[NODES[i].id] = INF;
      done[NODES[i].id] = false;
    }
    dist[start] = 0;

    for (let i = 0; i < NODES.length; i++) {
      /* Pick the unfinished location with the smallest known distance. */
      let best = null;
      for (let j = 0; j < NODES.length; j++) {
        const id = NODES[j].id;
        if (done[id]) continue;
        if (best === null || dist[id] < dist[best]) best = id;
      }
      if (best === null || dist[best] >= INF) break;

      done[best] = true;
      for (let k = 0; k < neighbours[best].length; k++) {
        const link = neighbours[best][k];
        const alt = dist[best] + link.cost;
        if (alt < dist[link.id]) dist[link.id] = alt;
      }
    }
    return dist;
  }

  /* Turns the distance matrix into this router's routing table. For each
     destination we ask: "going to which neighbour, plus that neighbour's own
     best distance, is cheapest?" The first neighbour in node order wins a tie,
     which is exactly the tie-break distance vector uses - so the two algorithms
     produce identical paths, not merely identical costs.
     dist[a][b] is the cheapest distance from location a to location b. */
  function buildRow(start, dist, neighbours) {
    const row = {};
    row[start] = { cost: 0, next: start };

    for (let i = 0; i < NODES.length; i++) {
      const dest = NODES[i].id;
      if (dest === start) continue;

      let best = null;
      for (let k = 0; k < neighbours[start].length; k++) {
        const link = neighbours[start][k];
        const total = link.cost + dist[link.id][dest];
        if (total >= INF) continue;
        if (best === null || total < best.cost) best = { cost: total, next: link.id };
      }
      row[dest] = best === null ? { cost: INF, next: null } : best;
    }
    return row;
  }

  /* Runs Dijkstra in every router and writes the new tables. Returns the list
     of table cells that changed. */
  function runDijkstra() {
    const neighbours = graph();
    const changed = [];

    /* Eight tiny Dijkstra runs give the complete distance matrix, which is what
       a next hop needs: the distance from the neighbour TO the destination. */
    const dist = {};
    for (let i = 0; i < NODES.length; i++) {
      dist[NODES[i].id] = shortestDistances(NODES[i].id, neighbours);
    }

    for (let i = 0; i < NODES.length; i++) {
      const me = NODES[i].id;
      const row = buildRow(me, dist, neighbours);

      for (let j = 0; j < NODES.length; j++) {
        const dest = NODES[j].id;
        const before = tables[me][dest];
        const after = row[dest];
        if (before.cost !== after.cost || before.next !== after.next) {
          tables[me][dest] = { cost: after.cost, next: after.next };
          changed.push([me, dest]);
        }
      }
    }

    return changed;
  }

  /* ------------------------------------------------------------------
     One step
     ------------------------------------------------------------------ */

  /* Does one unit of work: either one flooding hop, or one full Dijkstra pass
     when nothing is left to flood. */
  function step() {
    if (converged) return { pk: [], ch: 0, note: "idle", changed: [] };

    if (pending.length > 0) {
      return { pk: floodOneStep(), ch: 0, note: "flooding", changed: [] };
    }

    const changed = runDijkstra();
    converged = changed.length === 0;

    return { pk: [], ch: changed.length, note: "Dijkstra", changed: changed };
  }

  /* ------------------------------------------------------------------
     Link failures and restores
     ------------------------------------------------------------------ */

  /* A link changed state: both ends publish a new LSP with a higher sequence
     number, which then floods and triggers Dijkstra again. */
  function handleLinkChange(a, b) {
    const changed = [];
    const ends = [a, b];

    for (let i = 0; i < ends.length; i++) {
      originate(ends[i]);
      changed.push([ends[i], ends[i]]);   // mark the router itself as "news"
    }

    converged = false;
    return { pk: [], ch: 0, note: "event", changed: changed };
  }

  /* ------------------------------------------------------------------
     Reading the result
     ------------------------------------------------------------------ */

  /* The whole row of one router's table, for the table viewer. */
  function rowOf(node) {
    const row = [];
    for (let i = 0; i < NODES.length; i++) {
      const dest = NODES[i].id;
      row.push({ dest: dest, cost: tables[node][dest].cost, next: tables[node][dest].next });
    }
    return row;
  }

  /* Distance from one location to another as this router computed it. */
  function distance(from, dest) {
    return tables[from][dest].cost;
  }

  /* Walks the next hops to build the chosen path, or [] when unreachable. */
  function path(from, dest) {
    if (tables[from][dest].cost >= INF) return [];
    const route = [from];
    const visited = {};
    visited[from] = true;
    let at = from;

    while (at !== dest) {
      const next = tables[at][dest].next;
      if (next === null || visited[next]) return [];
      route.push(next);
      visited[next] = true;
      at = next;
      if (route.length > NODES.length) return [];
    }
    return route;
  }

  /* True once flooding has finished and Dijkstra has stopped changing tables. */
  function isConverged() {
    return converged;
  }

  /* The sequence number a router last published, handy for the viva demo. */
  function sequenceOf(node) {
    return db[node][node].seq;
  }

  reset();

  return {
    reset: reset,
    step: step,
    handleLinkChange: handleLinkChange,
    rowOf: rowOf,
    distance: distance,
    path: path,
    isConverged: isConverged,
    sequenceOf: sequenceOf,
    originate: originate
  };
}
