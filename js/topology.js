/* topology.js — the banking network itself: nodes, their 3D positions,
   the links between them and the cost of each link.

   This file holds DATA and small helper functions only. There is no drawing
   code and no algorithm code here, so both the routing engines and the 3D
   view can read the very same facts. Edit the network by editing the two
   lists below. */

/* Cost used for "unreachable". It is never displayed as a number: the UI
   always shows the word "unreachable" instead (see costText). */
const INF = 24;

/* The eight bank locations, listed in the order used for tie-breaking:
   when two routes cost exactly the same, the one whose next hop comes first
   in this list wins, so results are always repeatable. */
const NODES = [
  { id: "HO",   name: "HO",   kind: "ho",     description: "Head Office",      pos: [0, 1.5, 0] },
  { id: "DC",   name: "DC",   kind: "dc",     description: "Data Center",      pos: [-3.5, 0, 1.5] },
  { id: "ATM",  name: "ATM",  kind: "atm",    description: "ATM Switch",       pos: [-6, 0, 4.5] },
  { id: "RH-N", name: "RH-N", kind: "router", description: "Regional Hub North", pos: [3.5, 1, -2] },
  { id: "RH-S", name: "RH-S", kind: "router", description: "Regional Hub South", pos: [1, 0, 4] },
  { id: "BR-A", name: "BR-A", kind: "router", description: "Branch A",         pos: [6.5, 0.5, -3.5] },
  { id: "BR-B", name: "BR-B", kind: "router", description: "Branch B",         pos: [6, 0, 2] },
  { id: "BR-C", name: "BR-C", kind: "router", description: "Branch C",         pos: [-2, 0, 7.5] }
];

/* The leased lines of the bank. Every link is undirected: data can travel
   both ways, and the same cost applies in both directions. */
const LINKS = [
  { a: "HO",   b: "DC",   cost: 2 },
  { a: "HO",   b: "RH-N", cost: 4 },
  { a: "HO",   b: "RH-S", cost: 5 },
  { a: "DC",   b: "RH-S", cost: 3 },
  { a: "DC",   b: "ATM",  cost: 2 },
  { a: "RH-N", b: "BR-A", cost: 3 },
  { a: "RH-N", b: "BR-B", cost: 6 },
  { a: "RH-S", b: "BR-B", cost: 2 },
  { a: "RH-S", b: "BR-C", cost: 4 },
  { a: "ATM",  b: "BR-C", cost: 3 },
  { a: "BR-A", b: "BR-B", cost: 2 }
];

/* ------------------------------------------------------------------
   Small helper functions. Every algorithm uses these instead of walking
   the arrays itself, so there is only one definition of the truth.
   ------------------------------------------------------------------ */

/* Returns the node object with the given id, or null when it does not exist. */
function findNode(id) {
  for (let i = 0; i < NODES.length; i++) {
    if (NODES[i].id === id) return NODES[i];
  }
  return null;
}

/* Returns the position of a node in the NODES array.
   This position is the tie-break order used by both algorithms. */
function nodeOrder(id) {
  for (let i = 0; i < NODES.length; i++) {
    if (NODES[i].id === id) return i;
  }
  return NODES.length;   // unknown id sorts last
}

/* Returns the link object joining two nodes, or null when there is no line. */
function findLink(a, b) {
  for (let i = 0; i < LINKS.length; i++) {
    const l = LINKS[i];
    if ((l.a === a && l.b === b) || (l.a === b && l.b === a)) return l;
  }
  return null;
}

/* True when the link between a and b exists and has not been failed. */
function isLinkAlive(a, b) {
  const l = findLink(a, b);
  return l !== null && l.alive !== false;
}

/* Cost of travelling over one line: its cost when the line is up,
   INF when there is no line or the line is failed. */
function linkCost(a, b) {
  return isLinkAlive(a, b) ? findLink(a, b).cost : INF;
}

/* The neighbours of a node, sorted by node order so tie-breaks are stable. */
function neighboursOf(id) {
  const result = [];
  for (let i = 0; i < LINKS.length; i++) {
    const l = LINKS[i];
    if (l.a === id) result.push(l.b);
    else if (l.b === id) result.push(l.a);
  }
  result.sort(function (x, y) { return nodeOrder(x) - nodeOrder(y); });
  return result;
}

/* The neighbours a node can really reach right now (failed links removed). */
function aliveNeighboursOf(id) {
  const all = neighboursOf(id);
  const result = [];
  for (let i = 0; i < all.length; i++) {
    if (isLinkAlive(id, all[i])) result.push(all[i]);
  }
  return result;
}

/* Natural number of links per node, used to check the message counts.
   With every link up this is 3+3+2+3+4+2+3+2 = 22. */
function totalDegrees() {
  let sum = 0;
  for (let i = 0; i < NODES.length; i++) sum += neighboursOf(NODES[i].id).length;
  return sum;
}

/* Breaks ("fails") a link. Returns true when something changed. */
function failLink(a, b) {
  const l = findLink(a, b);
  if (l === null || l.alive === false) return false;
  l.alive = false;
  return true;
}

/* Restores a failed link. Returns true when something changed. */
function restoreLink(a, b) {
  const l = findLink(a, b);
  if (l === null || l.alive !== false) return false;
  l.alive = true;
  return true;
}

/* Puts every link back up: the exact starting state of the simulation. */
function resetTopology() {
  for (let i = 0; i < LINKS.length; i++) LINKS[i].alive = true;
}

/* Text shown to the user for a cost. INF is always written in words. */
function costText(cost) {
  return cost >= INF ? "unreachable" : String(cost);
}

/* The links that are currently failed, used by the UI dropdown. */
function failedLinks() {
  const result = [];
  for (let i = 0; i < LINKS.length; i++) {
    if (LINKS[i].alive === false) result.push(LINKS[i]);
  }
  return result;
}
