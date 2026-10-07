# 3D Banking Network Routing Simulator

A college mini-project that runs **two routing algorithms side by side on the same
banking network** and shows what they do in a live 3D view:

* **Distance Vector (DV)** - neighbours swapping their whole routing tables.
* **Link State (LS)** - each router flooding a description of its own links, then
  every router computing the best paths itself with Dijkstra.

Both are driven by exactly the same network and the same events, so you can compare
the paths they choose, how their routing tables change, how fast they settle
(converge) and how many routing messages each one costs.

Everything runs **offline in a browser** from a plain `file://` link. There is no
server, no database, no framework, no npm and no build step. The only library is
**Three.js r128**, stored locally in `lib/three.min.js`.

---

## 1. How to run

1. Open the folder `banking-routing-sim`.
2. Double-click **`index.html`**.
3. A "Choose a process" window opens. Pick one, for example *Distance vector start-up*.

You can also press `F12` and open the Console: a correct run shows **no errors**.

### The processes you can run

| Process | What it shows |
|---|---|
| Explore the network | The camera glides to each of the eight locations and a caption appears next to it. |
| Distance vector start-up | Blue packets carry tables between neighbours until every router is sure of the way. |
| Link state start-up | Orange packets flood each router's own links, then every router runs Dijkstra. |
| Trace one route | Lights up the chosen path between two locations, green and thicker. |
| Fail a link | Breaks the Data Center line and shows both algorithms finding a way round. |
| Restore a link | Brings it back and shows the cheaper route return. |
| Cut a location off | Fails both lines of Branch C; its routes become *unreachable*. |
| Head-to-head race | Two 3D views: distance vector left, link state right, same events. |
| Count-to-infinity demo | Fails one link with poison reverse off, then on, and compares the recovery. |

The **Controls** panel has Play, Pause, Step, Reset and a speed slider (0.25x - 3x).
One tick advances **one DV round and one LS step together**, which is what makes the
comparison fair.

---

## 2. Folder structure

```
banking-routing-sim/
  index.html              the page: 3D stage, all the panels, the process picker
  css/style.css           neutral light/dark styling, phone-friendly layout
  lib/three.min.js        Three.js r128, stored locally so it works offline
  js/topology.js          the network: 8 nodes, 3D positions, 11 links and costs
  js/distanceVector.js    the distance vector engine   (no drawing, no DOM)
  js/linkState.js         the link state engine        (no drawing, no DOM)
  js/metrics.js           the counters and the generated conclusion sentence
  js/scene3d.js           the 3D view, camera, hand-written orbit controls, labels
  js/packets3d.js         the moving packets and the node pulses
  js/ui.js                the panels, the process picker and the event log
  js/main.js              the simulation clock and the wiring
  tests/acceptance.js     a Node script that checks the engines (see section 9)
  README.md               this file
```

**The most important rule of the design:** the three algorithm files
(`topology.js`, `distanceVector.js`, `linkState.js`, `metrics.js`) contain **no
drawing and no DOM code**. Every step returns plain data:

```js
{ pk: [[fromNode, toNode, "DV" | "LS"], ...],   // messages sent this tick
  ch: numberOfTableChanges,                     // how many table cells changed
  note: "round" | "quiet" | "idle" | "flooding" | "Dijkstra" | "event",
  changed: [[nodeId, destId], ...] }            // which cells changed
```

The 3D view and the HTML panels only *read* that data, so the animation, the log,
the counters and the tables can never disagree with each other.

---

## 3. The banking network

Eight locations, each one a router:

| Location | What it is | Shape in 3D |
|---|---|---|
| HO | Head Office | big sphere |
| DC | Data Center | cylinder |
| ATM | ATM Switch | box |
| RH-N, RH-S | the two regional hubs | spheres |
| BR-A, BR-B, BR-C | the three branches | spheres |

The eleven leased lines and their costs:

```
HO-DC 2    HO-RH-N 4    HO-RH-S 5    DC-RH-S 3    DC-ATM 2
RH-N-BR-A 3   RH-N-BR-B 6   RH-S-BR-B 2   RH-S-BR-C 4   ATM-BR-C 3   BR-A-BR-B 2
```

A **cost** is how expensive a line is to use. The number `24` is used inside the
program to mean "no route at all", and it is always displayed as the word
**unreachable**, never as a number.

When two routes cost exactly the same, the winner is the one whose **next hop comes
first in the node order** `HO, DC, ATM, RH-N, RH-S, BR-A, BR-B, BR-C`. Both
algorithms use *strictly less than* comparisons, so the result is always repeatable.

---

## 4. Distance vector in simple words

Each router keeps a small table: *"to reach destination D, hand the packet to
neighbour N; it will cost C."* At the start a router only knows itself (cost 0) and
its direct neighbours.

Then, round after round:

1. Every router sends its **whole table** to each of its neighbours (that is one
   message per link).
2. A router looks at each neighbour's table and asks: *"if I go through this
   neighbour, what would this destination cost me?"* If that is better than what it
   currently believes, it writes down the new number and the new next hop.
3. It also rewrites the cost when the route it is using **through that same
   neighbour** has changed - even if the new cost is *worse*. This second rule is
   what lets bad news (a broken line) travel through the network.

A round in which nothing changes proves that the network has settled; that quiet
round still sends its messages, and the log says so. This algorithm needs very
little memory and no map of the network, but a router only ever knows second-hand
information, which is why bad news can travel slowly (the count-to-infinity problem).

## 5. Link state in simple words

1. Every router writes a small postcard - a **Link State Packet (LSP)** - that lists
   only its own links and their costs, together with its own **sequence number**.
2. That LSP is **flooded**: each router passes a copy to every neighbour except the
   one it came from. A router keeps a copy only if the sequence number is newer than
   the one it already has; older copies are thrown away. (Every transmission is still
   counted, even a duplicate, because it really did use the line.)
3. When nothing is left to flood, every router has the full map, and each one runs
   **Dijkstra's algorithm** on that map to work out the best path to every destination.

Because every router computes from the complete map, the answer is right first time
and there is no slow "bad news" problem. The price is memory: every router has to
keep the whole map, and every LSP reaches everybody.

---

## 6. The counting rules

These rules are used everywhere in the program, so the log, the tables, the bars and
the conclusion sentence always agree.

| Counter | Rule |
|---|---|
| **Message** | One routing message handed over one link. One distance vector sent to one neighbour = 1. One flooding transmission of one LSP over one link = 1 (duplicates included). |
| **Table update** | One routing-table cell whose value actually changed. |
| **Round (DV)** | A round in which at least one table changed. The quiet round that proves convergence still sends its messages, but is not counted as a changing round. |
| **Step (LS)** | One tick that did something: a flooding hop, or the Dijkstra pass. Start-up is "flooding steps + 1 Dijkstra step". |

The counters are kept in four separate buckets: `DV start-up`, `LS start-up`,
`DV after event` and `LS after event`. The two "after event" buckets are cleared
every time a link is failed or restored.

With every line up, one DV round sends exactly **22** messages (that is the sum of all
degrees: 3+3+2+3+4+2+3+2), and one LSP needs exactly **15** transmissions to reach
everybody, so the eight LSPs of a full start-up cost **120**.

## 7. How the 3D scene maps to the algorithm events

| You see | It means |
|---|---|
| Blue sphere riding a line | one distance vector handed to one neighbour |
| Orange sphere riding a line | one LSP transmission during flooding |
| Blue above the line, orange below | both algorithms used the same line in the same tick; the offset keeps them both visible |
| Router flashing green and growing | one or more cells of that router's table changed in this tick |
| Caption next to a router | which place just changed and by how much (for example "DV: 4 routes updated") |
| Green, thicker line | the highlighted route of the chosen algorithm |
| Red, semi-transparent line | a failed leased line |
| Grey line with a number at its middle | a healthy leased line and its cost |

The camera is controlled by dragging (one finger), the scroll wheel or a two-finger
pinch. Three.js r128 has no `OrbitControls`, so the controls are written by hand in
`scene3d.js`. Only `Sphere`, `Cylinder`, `Box`, `Sprite` and `Line` objects are used.

---

## 8. What the numbers show (measured, not estimated)

All of the following come from a real run and are printed by
`node tests/acceptance.js`. Start-up means: all links up, both algorithms starting
from an empty network.

| | Distance vector | Link state |
|---|---|---|
| Messages during start-up | **88** | **120** |
| Table updates during start-up | 50 | 37 |
| Rounds / steps to settle | **3 changing rounds** (plus one quiet round = 4 ticks) | **7 steps** (6 flooding steps + 1 Dijkstra) |

Shortest-path costs with everything up - **both algorithms agree on all 56 ordered
pairs**:

```
HO  -> ATM   = 4   (HO-DC-ATM)
HO  -> BR-A  = 7   (HO-RH-N-BR-A)
HO  -> BR-B  = 7   (equal-cost tie: DV picks HO-RH-S-BR-B, LS picks HO-DC-RH-S-BR-B)
HO  -> BR-C  = 7   (HO-DC-ATM-BR-C)
ATM -> BR-A  = 9   (ATM-DC-RH-S-BR-B-BR-A)
BR-A-> BR-C  = 8   (BR-A-BR-B-RH-S-BR-C)
```

Only 2 of the 56 pairs end up on *different* paths (HO→RH-S and HO→BR-B), and in both
cases the two paths cost exactly the same - the tests prove each path adds up to the
reported distance.

**Failing the Data Center line (DC-ATM):**

| | Distance vector | Link state |
|---|---|---|
| Messages after the event | 100 | 26 |
| Table updates after the event | 37 | 18 |
| Rounds / steps to settle | 4 changing rounds | 7 steps |

Both then report `HO→ATM = 12` and `ATM→BR-A = 11`, exactly as expected, and
restoring the line returns every cost to its original value.

**Cutting Branch C off** (both of its lines failed): both algorithms report
`HO→BR-C` as **unreachable**, with no crash and no endless loop. Distance vector needs
11 ticks and 198 messages; link state needs 7 ticks and 24 messages.

**Split horizon with poison reverse** (the bonus feature), measured over all eleven
possible link failures:

```
poison reverse OFF : 38 changing rounds, 980 messages
poison reverse ON  : 33 changing rounds, 880 messages
```

Count-to-infinity is real and visible: with `RH-N-BR-A` failed, the cost from RH-S to
RH-N climbs before it settles -

```
7  ->  7  ->  15  ->  8  ->  8
```

That climb is caused by routers believing each other's stale good news. With poison
reverse on, the recovery does strictly less work overall (never more rounds, never
more messages), although it does not promise to remove every single transient rise -
so the project reports the measured work instead of claiming more than the rule
guarantees.

---

## 9. Running the tests

The engine files have no DOM code, so Node can load them directly:

```
cd banking-routing-sim
node tests/acceptance.js
```

It prints every check with the real value it measured and finishes with
`RESULT: 47 passed, 0 failed`. The script builds one program out of the four engine
files plus its own test body and runs it, so the numbers it prints are the numbers the
browser gets. **It is a development tool only** - the web page never loads it.

---

## 10. Twelve likely viva questions

**1. What is the difference between distance vector and link state routing?**
Distance vector is "gossip": each router learns distances from its neighbours and
passes on what it heard. Link state is "broadcast the map": each router describes its
own links, everybody collects the descriptions, and each router computes the paths
itself with Dijkstra.

**2. Why does link state converge faster?**
Every router waits until the whole map has arrived and then computes the answer once,
from complete information. Distance vector has to pass each change from neighbour to
neighbour, one round at a time, so a change near the edge of the network takes several
rounds to reach the far side.

**3. Why can distance vector count to infinity?**
A router only knows what its neighbours told it. If a line fails, a neighbour may
still believe it can reach the lost destination *through the router that just lost it*.
The two then keep telling each other a slightly larger number - each one politely
"helping" the other - until the number grows past the real cost or hits the maximum.
In this project you can watch the cost from RH-S to RH-N climb to 15 before it settles
back at 8.

**4. What does split horizon with poison reverse do?**
Normally a router tells a neighbour every route it knows, including routes it learned
*from* that neighbour. With poison reverse, it says "my distance to that destination is
unreachable" whenever the neighbour being spoken to is the very next hop. A router can
then never be talked into a route that points straight back through itself, which stops
the endless counting. Measured here: 880 messages instead of 980 over the same eleven
failures.

**5. Why does link state need more memory?**
Each router stores a complete link state database - every router's own links plus a
sequence number - and runs Dijkstra over it. Distance vector only stores one row per
destination: a cost and a next hop.

**6. What is the sequence number for in flooding?**
It marks how new a copy of an LSP is. A router keeps a copy only when its sequence
number is higher than the one it already holds and throws older copies away, so
flooding can circle the network safely without looping forever. Without it, the same
LSP would be forwarded endlessly.

**7. Why does one distance vector round send exactly 22 messages here?**
Because a vector is sent once per link, over each link, in each direction. The eleven
links have 22 one-way ends in total (3+3+2+3+4+2+3+2), and one message is sent per
one-way end.

**8. Why does one LSP need exactly 15 transmissions?**
The LSP starts at its owner, which sends it to all of its neighbours, and afterwards
every other router that receives it forwards it to all of its neighbours except the one
it came from. Adding those up gives 15 for any router in this network, whatever its
position - so eight LSPs cost 120.

**9. What is convergence, and how does the program detect it?**
Convergence is the moment no table changes any more. Distance vector detects it when a
whole round produces zero changes (that quiet round still sends its 22 messages, and
the log says so). Link state detects it when the flooding queue is empty and the
Dijkstra pass produces zero changes.

**10. Why do the two algorithms produce different paths for two of the 56 pairs, if
both are correct?**
Because those pairs have two paths of exactly the same cost. Distance vector keeps
whichever good news arrives first, while link state picks the first neighbour in node
order that reaches the destination at the best cost. Both paths cost 7, and the tests
check that each one adds up to the reported distance.

**11. What happens when a router is completely cut off?**
Its routes become unreachable in both algorithms, and nothing crashes or loops. In link
state, the cut-off router cannot flood its own empty LSP, but the neighbours that
dropped it publish theirs, and this project only believes a link when **both** of its
ends still advertise it - so the dead lines disappear from everybody's map.

**12. Why is the simulation one tick for both algorithms, instead of running them
separately?**
So the comparison is fair. Each tick gives distance vector exactly one round and link
state exactly one step, on the same network with the same events, and every message is
counted the same way. Otherwise one algorithm could look faster simply because it was
given more turns.

---

## 11. Known limitations

* Costs are static apart from fail/restore. There is no traffic load, no queueing delay
  and no bandwidth.
* A "round" for distance vector counts only rounds that changed something, while a link
  state "step" counts every flooding hop plus the Dijkstra pass. That difference is
  required by the counting rules, and it is written on the comparison panel so nobody
  compares the two numbers by accident.
* Poison reverse reduces the total work, but it does not remove every transient rise in
  a cost; the project reports the measured numbers rather than an inflated claim.
* The 3D view is a teaching picture, not a physical simulation: packets travel at a
  fixed speed and a packet is drawn for one hop only.
