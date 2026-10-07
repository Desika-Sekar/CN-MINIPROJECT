/* tests/acceptance.js — the acceptance test for the two routing engines.

   Run it from the project folder with:   node tests/acceptance.js

   The engine files (topology, metrics, distanceVector, linkState) contain no
   DOM and no drawing code, so Node can load them directly. This script reads
   those real files, appends the test body and runs everything in one scope, so
   the numbers printed here are the numbers the browser gets.

   Nothing in this file is used by the web page; it exists so the student can
   prove the algorithms are correct without opening a browser. */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ENGINE_FILES = ["js/topology.js", "js/metrics.js", "js/distanceVector.js", "js/linkState.js"];

const engineSource = ENGINE_FILES
  .map(function (file) { return fs.readFileSync(path.join(ROOT, file), "utf8"); })
  .join("\n");

/* ------------------------------------------------------------------
   The whole test lives in this one function. It is written as a normal
   function so it is syntax-checked, and its source text is appended after the
   engine files - which is why it can use NODES, createDistanceVector, ... directly.
   ------------------------------------------------------------------ */
function acceptanceTests() {

  let PASS = 0;
  let FAIL = 0;

  /* Compares one value with one expected value and prints the outcome. */
  function check(name, got, want) {
    const ok = String(got) === String(want);
    if (ok) PASS++; else FAIL++;
    console.log((ok ? "PASS  " : "FAIL  ") + name + "  ->  got " + got +
      (ok ? "" : "    WANTED " + want));
  }

  /* Prints a measured number that is not itself a pass/fail check. */
  function info(name, value) {
    console.log("      " + name + " = " + value);
  }

  function section(title) {
    console.log("\n=== " + title + " ===");
  }

  /* Runs an engine until it stops changing and collects the same numbers the
     UI collects. Distance vector counts only rounds that changed something;
     link state counts every non-idle step (flooding steps + the final
     Dijkstra step). */
  function converge(engine, kind, metrics, bucket) {
    let ticks = 0, messages = 0, updates = 0, counted = 0;

    for (let i = 0; i < 500; i++) {
      const res = engine.step();
      if (res.note === "idle") break;

      ticks++;
      messages += res.pk.length;
      updates += res.ch;

      const countedRound = kind === "ls" ? 1 : (res.ch > 0 ? 1 : 0);
      counted += countedRound;

      if (metrics) metrics.add(bucket, res.pk.length, res.ch, countedRound);

      if (res.note === "quiet") break;                          // DV: quiet round = convergence
      if (kind === "ls" && engine.isConverged()) break;         // LS: flooding done + Dijkstra done
    }

    return { ticks: ticks, messages: messages, updates: updates, counted: counted };
  }

  /* cost of every ordered pair, keyed "FROM->TO". */
  function allCosts(engine) {
    const out = {};
    for (let i = 0; i < NODES.length; i++) {
      for (let j = 0; j < NODES.length; j++) {
        if (NODES[i].id !== NODES[j].id) {
          out[NODES[i].id + "->" + NODES[j].id] = engine.distance(NODES[i].id, NODES[j].id);
        }
      }
    }
    return out;
  }

  /* chosen path of every ordered pair, kept as an array of node ids because the
     node names themselves contain dashes (RH-N, BR-A). */
  function allPaths(engine) {
    const out = {};
    for (let i = 0; i < NODES.length; i++) {
      for (let j = 0; j < NODES.length; j++) {
        if (NODES[i].id !== NODES[j].id) {
          out[NODES[i].id + "->" + NODES[j].id] = engine.path(NODES[i].id, NODES[j].id);
        }
      }
    }
    return out;
  }

  /* Adds up the real link costs of a path, so a reported path can be checked
     against the reported distance. */
  function costOfPath(route) {
    let total = 0;
    for (let i = 0; i + 1 < route.length; i++) total += linkCost(route[i], route[i + 1]);
    return total;
  }

  /* How many entries of two maps differ. */
  function countDifferences(a, b) {
    let n = 0;
    for (const key in a) if (String(a[key]) !== String(b[key])) n++;
    return n;
  }

  /* Prints the biggest cost of a map, used in the info lines. */
  function sampleCost(map, key) {
    return map[key];
  }

  /* ================================================================ */
  section("1. all links up: convergence counts (start-up phase)");
  resetTopology();
  const metrics = createMetrics();
  const dv = createDistanceVector();
  const ls = createLinkState();

  /* A separate engine is used for the first-round check, so that the start-up
     run below is a full run from a fresh state. */
  const dvProbe = createDistanceVector();
  const dvFirst = dvProbe.step();
  check("DV first round sends exactly 22 messages", dvFirst.pk.length, 22);
  info("DV first round", "note=" + dvFirst.note + ", changes=" + dvFirst.ch);

  const dvStart = converge(dv, "dv", metrics, "dvStartup");
  const lsStart = converge(ls, "ls", metrics, "lsStartup");

  info("DV start-up", "changing rounds=" + dvStart.counted +
    ", total ticks=" + dvStart.ticks +
    ", messages=" + dvStart.messages +
    ", table updates=" + dvStart.updates);
  info("LS start-up", "steps=" + lsStart.counted +
    ", messages=" + lsStart.messages +
    ", table updates=" + lsStart.updates);

  check("DV converged", dv.isConverged(), true);
  check("LS converged", ls.isConverged(), true);
  check("LS start-up = 8 LSPs x 15 = 120 transmissions", lsStart.messages, 120);

  /* One single LSP, counted on its own. */
  const lsOne = createLinkState();
  converge(lsOne, "ls", null, "");
  const seqBefore = lsOne.sequenceOf("HO");
  lsOne.originate("HO");
  let oneLspMessages = 0, oneLspSteps = 0;
  for (let i = 0; i < 50; i++) {
    const r = lsOne.step();
    if (r.note !== "flooding") break;
    oneLspMessages += r.pk.length;
    oneLspSteps++;
  }
  info("one LSP from HO", "transmissions=" + oneLspMessages +
    ", flooding steps=" + oneLspSteps +
    ", sequence " + seqBefore + " -> " + lsOne.sequenceOf("HO"));
  check("one LSP floods in exactly 15 transmissions", oneLspMessages, 15);

  /* ================================================================ */
  section("2. named shortest paths with all links up");
  const wanted = [
    ["HO", "ATM", 4], ["HO", "BR-A", 7], ["HO", "BR-B", 7], ["HO", "BR-C", 7],
    ["ATM", "BR-A", 9], ["BR-A", "BR-C", 8]
  ];
  for (let i = 0; i < wanted.length; i++) {
    const from = wanted[i][0], to = wanted[i][1], cost = wanted[i][2];
    check("DV cost " + from + "->" + to, dv.distance(from, to), cost);
    check("LS cost " + from + "->" + to, ls.distance(from, to), cost);
    info("   DV path / LS path", dv.path(from, to).join("-") + "   /   " + ls.path(from, to).join("-"));
  }

  /* ================================================================ */
  section("3. all 56 ordered pairs must agree");
  const dvCosts = allCosts(dv);
  const lsCosts = allCosts(ls);
  check("ordered pairs compared", Object.keys(dvCosts).length, 56);
  check("cost differences between DV and LS", countDifferences(dvCosts, lsCosts), 0);

  /* The acceptance rule is identical COSTS. Where two different paths cost
     exactly the same, the two algorithms may legitimately choose differently
     (distance vector keeps whichever good news reaches it first), so wherever
     the paths differ we prove instead that both are still shortest paths of
     exactly the reported cost. */
  const dvPathList = allPaths(dv);
  const lsPathList = allPaths(ls);
  const differingPairs = [];
  const wrongPaths = [];
  for (const key in dvPathList) {
    if (dvPathList[key].join(" > ") === lsPathList[key].join(" > ")) continue;
    differingPairs.push(key);
    if (costOfPath(dvPathList[key]) !== dvCosts[key]) wrongPaths.push("DV " + key);
    if (costOfPath(lsPathList[key]) !== lsCosts[key]) wrongPaths.push("LS " + key);
  }
  info("pairs with a different but equal-cost path",
    differingPairs.length === 0 ? "none" : differingPairs.length + ": " + differingPairs.join(", "));
  check("every differing path still costs exactly the reported distance", wrongPaths.length, 0);
  info("HO->BR-B tie", "DV " + dv.path("HO", "BR-B").join(">") + " / LS " +
    ls.path("HO", "BR-B").join(">") + " at cost " + sampleCost(dvCosts, "HO->BR-B"));

  /* ================================================================ */
  section("4. fail link DC-ATM, then restore it");
  failLink("DC", "ATM");
  metrics.resetEvent();

  const dvFail = dv.handleLinkFailure("DC", "ATM");
  const lsFail = ls.handleLinkChange("DC", "ATM");
  info("DV immediate updates on failure", dvFail.ch + " cells set to unreachable");
  info("LS routers publishing a new LSP", lsFail.ch);
  metrics.add("dvEvent", dvFail.pk.length, dvFail.ch, 0);
  metrics.add("lsEvent", lsFail.pk.length, lsFail.ch, 0);

  const dvEvent = converge(dv, "dv", metrics, "dvEvent");
  const lsEvent = converge(ls, "ls", metrics, "lsEvent");
  info("DV after event", "changing rounds=" + dvEvent.counted + ", messages=" + dvEvent.messages +
    ", table updates=" + dvEvent.updates);
  info("LS after event", "steps=" + lsEvent.counted + ", messages=" + lsEvent.messages +
    ", table updates=" + lsEvent.updates);

  check("DV cost HO->ATM after failure", dv.distance("HO", "ATM"), 12);
  check("LS cost HO->ATM after failure", ls.distance("HO", "ATM"), 12);
  check("DV cost ATM->BR-A after failure", dv.distance("ATM", "BR-A"), 11);
  check("LS cost ATM->BR-A after failure", ls.distance("ATM", "BR-A"), 11);
  info("HO->ATM path DV / LS", dv.path("HO", "ATM").join("-") + "   /   " + ls.path("HO", "ATM").join("-"));
  check("cost differences after the failure", countDifferences(allCosts(dv), allCosts(ls)), 0);

  restoreLink("DC", "ATM");
  metrics.resetEvent();
  const dvRestore = dv.handleLinkRestore("DC", "ATM");
  const lsRestore = ls.handleLinkChange("DC", "ATM");
  metrics.add("dvEvent", dvRestore.pk.length, dvRestore.ch, 0);
  metrics.add("lsEvent", lsRestore.pk.length, lsRestore.ch, 0);
  converge(dv, "dv", metrics, "dvEvent");
  converge(ls, "ls", metrics, "lsEvent");

  check("DV costs back to the original after restore", countDifferences(allCosts(dv), dvCosts), 0);
  check("LS costs back to the original after restore", countDifferences(allCosts(ls), lsCosts), 0);

  /* ================================================================ */
  section("5. the same link failed and restored 5 times in a row");
  let repeatOk = true;
  let repeatDetour = null;
  for (let i = 0; i < 5; i++) {
    failLink("RH-N", "BR-A");
    dv.handleLinkFailure("RH-N", "BR-A");
    ls.handleLinkChange("RH-N", "BR-A");
    converge(dv, "dv", null, "");
    converge(ls, "ls", null, "");
    repeatDetour = dv.distance("RH-N", "BR-A");
    if (countDifferences(allCosts(dv), allCosts(ls)) !== 0) repeatOk = false;
    if (costText(repeatDetour) !== "8") repeatOk = false;      // detour RH-N-BR-B-BR-A = 6 + 2

    restoreLink("RH-N", "BR-A");
    dv.handleLinkRestore("RH-N", "BR-A");
    ls.handleLinkChange("RH-N", "BR-A");
    converge(dv, "dv", null, "");
    converge(ls, "ls", null, "");
    if (countDifferences(allCosts(dv), dvCosts) !== 0) repeatOk = false;
    if (countDifferences(allCosts(ls), lsCosts) !== 0) repeatOk = false;
  }
  info("RH-N->BR-A while failed", costText(repeatDetour) + " (detour RH-N-BR-B-BR-A)");
  info("RH-N->BR-A after restore", costText(dv.distance("RH-N", "BR-A")) + " (direct)");
  check("5 x fail/restore keeps both algorithms identical and correct", repeatOk, true);

  /* ================================================================ */
  section("6. cut one location off completely (BR-C loses both links)");
  failLink("RH-S", "BR-C");
  failLink("ATM", "BR-C");
  dv.handleLinkFailure("RH-S", "BR-C");
  dv.handleLinkFailure("ATM", "BR-C");
  ls.handleLinkChange("RH-S", "BR-C");
  ls.handleLinkChange("ATM", "BR-C");

  const dvCut = converge(dv, "dv", null, "");
  const lsCut = converge(ls, "ls", null, "");
  check("DV shows HO->BR-C as unreachable", costText(dv.distance("HO", "BR-C")), "unreachable");
  check("LS shows HO->BR-C as unreachable", costText(ls.distance("HO", "BR-C")), "unreachable");
  check("DV path HO->BR-C is empty", dv.path("HO", "BR-C").length, 0);
  check("LS path HO->BR-C is empty", ls.path("HO", "BR-C").length, 0);
  check("both still agree on every other pair", countDifferences(allCosts(dv), allCosts(ls)), 0);
  info("DV ticks to settle with BR-C cut", dvCut.ticks + " (messages " + dvCut.messages + ")");
  info("LS ticks to settle with BR-C cut", lsCut.ticks + " (messages " + lsCut.messages + ")");

  /* ================================================================ */
  section("7. Reset returns to the exact starting state");
  restoreLink("RH-S", "BR-C");
  restoreLink("ATM", "BR-C");
  resetTopology();
  dv.reset();
  ls.reset();
  metrics.resetAll();

  const dvAgain = converge(dv, "dv", metrics, "dvStartup");
  const lsAgain = converge(ls, "ls", metrics, "lsStartup");
  check("a settled DV engine sends nothing when stepped again", dv.step().pk.length, 0);

  const freshDv = createDistanceVector();
  check("a brand new DV engine sends 22 messages in round 1", freshDv.step().pk.length, 22);
  check("after reset DV costs equal the original costs", countDifferences(allCosts(dv), dvCosts), 0);
  check("after reset LS costs equal the original costs", countDifferences(allCosts(ls), lsCosts), 0);
  check("after reset DV needed the same changing rounds", dvAgain.counted, dvStart.counted);
  check("after reset LS needed 120 transmissions again", lsAgain.messages, 120);
  check("after reset every link is up again", failedLinks().length, 0);

  /* ================================================================ */
  section("8. bonus: split horizon with poison reverse");
  const dvPoison = createDistanceVector();
  dvPoison.setSplitHorizon(true);
  check("the setting reads back as on", dvPoison.hasSplitHorizon(), true);
  const poisonRun = converge(dvPoison, "dv", null, "");
  check("poison reverse gives identical costs", countDifferences(allCosts(dvPoison), dvCosts), 0);
  check("poison reverse gives identical paths", countDifferences(allPaths(dvPoison), allPaths(dv)), 0);
  info("DV with poison reverse", "changing rounds=" + poisonRun.counted + ", messages=" + poisonRun.messages);

  /* ================================================================ */
  section("9. count-to-infinity sweep: every link failed, poison reverse off then on");

  /* Every ordered pair, as [from, to]. */
  const pairList = [];
  for (let i = 0; i < NODES.length; i++) {
    for (let j = 0; j < NODES.length; j++) {
      if (NODES[i].id !== NODES[j].id) pairList.push([NODES[i].id, NODES[j].id]);
    }
  }

  /* Runs one "fail this link and recover" experiment with poison reverse either
     off or on, and reports how much work the recovery took plus the biggest
     "counting up" it produced: a cost that climbed above the value it finally
     settled on. That climb is exactly what count-to-infinity means. */
  const runCase = function (a, b, poisonReverse) {
    resetTopology();
    const engine = createDistanceVector();
    engine.setSplitHorizon(poisonReverse);
    converge(engine, "dv", null, "");          // settle first
    failLink(a, b);
    engine.handleLinkFailure(a, b);

    const highest = {};
    let rounds = 0, messages = 0;

    for (let i = 0; i < 40; i++) {
      const res = engine.step();
      if (res.note === "idle") break;
      messages += res.pk.length;
      if (res.ch > 0) rounds++;

      for (let p = 0; p < pairList.length; p++) {
        const key = pairList[p][0] + "->" + pairList[p][1];
        const now = engine.distance(pairList[p][0], pairList[p][1]);
        if (now < INF && (highest[key] === undefined || now > highest[key])) highest[key] = now;
      }
      if (res.note === "quiet") break;
    }

    let overshoot = 0, example = "none", pairFrom = null, pairTo = null;
    for (let p = 0; p < pairList.length; p++) {
      const key = pairList[p][0] + "->" + pairList[p][1];
      const settled = engine.distance(pairList[p][0], pairList[p][1]);
      if (settled >= INF || highest[key] === undefined) continue;
      if (highest[key] - settled > overshoot) {
        overshoot = highest[key] - settled;
        pairFrom = pairList[p][0];
        pairTo = pairList[p][1];
        example = key + " climbed to " + highest[key] + " then settled at " + settled;
      }
    }

    return {
      rounds: rounds, messages: messages, engine: engine,
      overshoot: overshoot, example: example, pairFrom: pairFrom, pairTo: pairTo
    };
  };

  const sweep = [];
  for (let i = 0; i < LINKS.length; i++) {
    const a = LINKS[i].a, b = LINKS[i].b;
    const off = runCase(a, b, false);
    const on = runCase(a, b, true);
    sweep.push({ a: a, b: b, name: a + "-" + b, off: off, on: on });
    info("failed " + a + "-" + b,
      "OFF: " + off.rounds + " rounds, " + off.messages + " msgs, count-up " + off.overshoot +
      "   |   ON: " + on.rounds + " rounds, " + on.messages + " msgs, count-up " + on.overshoot);
  }

  let worst = sweep[0];
  for (let i = 1; i < sweep.length; i++) {
    if (sweep[i].off.rounds > worst.off.rounds) worst = sweep[i];
  }
  info("slowest recovery without poison reverse", worst.name + " in " + worst.off.rounds +
    " changing rounds (with poison reverse: " + worst.on.rounds + ")");

  /* A round-by-round trace of the slowest case, which is what the bonus demo
     button animates: you can watch the cost count up before it comes back down. */
  const traceRecovery = function (poisonReverse) {
    resetTopology();
    const engine = createDistanceVector();
    engine.setSplitHorizon(poisonReverse);
    converge(engine, "dv", null, "");
    failLink(worst.a, worst.b);
    engine.handleLinkFailure(worst.a, worst.b);

    const series = [];
    for (let i = 0; i < 30; i++) {
      const res = engine.step();
      series.push(costText(engine.distance("HO", worst.b)));
      if (res.note === "quiet" || res.note === "idle") break;
    }
    return series.join(" -> ");
  };
  info("HO->" + worst.b + " each round, poison OFF", traceRecovery(false));
  info("HO->" + worst.b + " each round, poison ON ", traceRecovery(true));

  /* The worst counting-up case, which is what the bonus demo button replays. */
  let worstCount = sweep[0];
  for (let i = 1; i < sweep.length; i++) {
    if (sweep[i].off.overshoot > worstCount.off.overshoot) worstCount = sweep[i];
  }
  info("clearest count-to-infinity, poison OFF", worstCount.name + ": " +
    worstCount.off.example + " (" + worstCount.off.rounds + " rounds, " + worstCount.off.messages + " messages)");
  info("same failure, poison ON ", worstCount.name + ": " +
    worstCount.on.example + " (" + worstCount.on.rounds + " rounds, " + worstCount.on.messages + " messages)");

  /* What the rule really buys: less work overall, never more. Poison reverse
     does not promise to remove every transient rise in a cost, so we measure
     the work instead of claiming something the rule does not guarantee. */
  let roundsOff = 0, roundsOn = 0, msgsOff = 0, msgsOn = 0;
  for (let i = 0; i < sweep.length; i++) {
    roundsOff += sweep[i].off.rounds;  roundsOn += sweep[i].on.rounds;
    msgsOff += sweep[i].off.messages;  msgsOn += sweep[i].on.messages;
  }
  info("all 11 failures with poison reverse OFF", roundsOff + " changing rounds, " + msgsOff + " messages");
  info("all 11 failures with poison reverse ON ", roundsOn + " changing rounds, " + msgsOn + " messages");

  /* Round-by-round trace of the clearest climb, which is what the demo shows. */
  const traceClimb = function (poisonReverse) {
    resetTopology();
    const engine = createDistanceVector();
    engine.setSplitHorizon(poisonReverse);
    converge(engine, "dv", null, "");
    failLink(worstCount.a, worstCount.b);
    engine.handleLinkFailure(worstCount.a, worstCount.b);

    const series = [costText(engine.distance(worstCount.off.pairFrom, worstCount.off.pairTo))];
    for (let i = 0; i < 30; i++) {
      const res = engine.step();
      series.push(costText(engine.distance(worstCount.off.pairFrom, worstCount.off.pairTo)));
      if (res.note === "quiet" || res.note === "idle") break;
    }
    return series.join(" -> ");
  };
  info("climb with poison OFF", traceClimb(false));
  info("climb with poison ON ", traceClimb(true));

  check("poison reverse never needs more rounds than plain DV",
    sweep.every(function (s) { return s.on.rounds <= s.off.rounds; }), true);
  check("poison reverse never sends more messages than plain DV",
    sweep.every(function (s) { return s.on.messages <= s.off.messages; }), true);
  check("poison reverse does strictly less work overall",
    roundsOn <= roundsOff && msgsOn <= msgsOff && (roundsOn < roundsOff || msgsOn < msgsOff), true);
  check("poison reverse reaches the same costs as plain DV",
    countDifferences(allCosts(worst.off.engine), allCosts(worst.on.engine)), 0);
  resetTopology();

  /* ================================================================ */
  section("10. the auto-generated conclusion sentence");
  console.log("      " + metrics.buildConclusion(countDifferences(dvCosts, lsCosts) === 0));

  /* ================================================================ */
  console.log("\n==========================================");
  console.log("RESULT: " + PASS + " passed, " + FAIL + " failed");
  console.log("==========================================");

  process.exitCode = FAIL === 0 ? 0 : 1;
}

/* Build one script out of the real engine files plus this test body, then run it. */
new Function(engineSource + "\n(" + acceptanceTests.toString() + ")();")();
