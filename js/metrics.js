/* metrics.js — the counting rules of the simulator.

   Every number the page shows comes from here, so the tables, the bars and the
   conclusion sentence can never disagree with each other.

   Counters are kept apart in four buckets:
     dvStartup / lsStartup : from an empty network to the first full convergence
     dvEvent  / lsEvent    : from the latest link failure or restore to the next
                             convergence (these two are cleared on every event)

   The counting rules used everywhere in this project:
     message : one routing message handed over one link
               (one distance vector sent to one neighbour = 1;
                one flooding transmission of one LSP over one link = 1)
     update  : one routing-table cell whose value actually changed
     round   : for distance vector, a round in which at least one table changed.
               The quiet round that proves convergence still sends its messages,
               but it is not counted as a changing round.
     step    : for link state, one clock tick that did something. Start-up is
               "flooding steps + 1 Dijkstra step". */

const METRIC_KEYS = ["dvStartup", "lsStartup", "dvEvent", "lsEvent"];

/* Human names for the buckets, used by the comparison table. */
const METRIC_LABELS = {
  dvStartup: "DV start-up",
  lsStartup: "LS start-up",
  dvEvent: "DV after event",
  lsEvent: "LS after event"
};

/* Creates a fresh set of counters. */
function createMetrics() {

  const counters = {};

  /* A brand new, all-zero counter. */
  function blank() {
    return { messages: 0, updates: 0, rounds: 0 };
  }

  /* Puts every bucket back to zero. */
  function resetAll() {
    for (let i = 0; i < METRIC_KEYS.length; i++) counters[METRIC_KEYS[i]] = blank();
  }

  /* Clears only the two "after a link event" buckets, as the rules require. */
  function resetEvent() {
    counters.dvEvent = blank();
    counters.lsEvent = blank();
  }

  /* Adds one tick's worth of numbers to a bucket. */
  function add(key, messages, updates, rounds) {
    const c = counters[key];
    c.messages += messages;
    c.updates += updates;
    c.rounds += rounds;
  }

  /* The raw numbers of one bucket. */
  function get(key) {
    return counters[key];
  }

  /* Builds the conclusion sentence shown under the comparison table.
     costsIdentical says whether both algorithms finished with exactly the same
     cost for every ordered pair of locations. */
  function buildConclusion(costsIdentical) {
    const dv = counters.dvStartup;
    const ls = counters.lsStartup;
    const parts = [];

    parts.push("Start-up: distance vector took " + dv.rounds + " changing rounds and " +
      dv.messages + " messages, link state took " + ls.rounds + " steps and " +
      ls.messages + " messages.");

    if (dv.rounds === ls.rounds) {
      parts.push("Both settled after the same number of ticks.");
    } else if (ls.rounds < dv.rounds) {
      parts.push("Link state settled in fewer ticks, because every router computes the " +
        "whole map with Dijkstra instead of waiting for its neighbours' second-hand answers.");
    } else {
      parts.push("Distance vector settled in fewer ticks here, because this small network " +
        "needs very few gossip rounds.");
    }

    if (ls.messages < dv.messages) {
      parts.push("Link state also sent fewer messages (" + ls.messages + " against " + dv.messages + ").");
    } else if (ls.messages > dv.messages) {
      parts.push("But link state paid for that speed with more messages (" + ls.messages +
        " against " + dv.messages + "), since every LSP is flooded to the whole network.");
    } else {
      parts.push("Both algorithms sent the same number of messages.");
    }

    if (costsIdentical) {
      parts.push("Both algorithms ended with identical shortest-path costs for all 56 ordered pairs, " +
        "which is the expected result: they solve the same shortest-path problem in different ways.");
    } else {
      parts.push("WARNING: the two algorithms did not agree on the shortest-path costs.");
    }

    return parts.join(" ");
  }

  resetAll();

  return {
    counters: counters,
    add: add,
    get: get,
    resetAll: resetAll,
    resetEvent: resetEvent,
    buildConclusion: buildConclusion
  };
}
