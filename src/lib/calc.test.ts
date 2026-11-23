import assert from "node:assert/strict";
import test from "node:test";
import { activity, breakdown, calculate, compare, defaultScenario, savingsLevers, shopifyBreakEven, type Scenario } from "./calc.ts";
import { readScenario, writeScenario } from "./scenario.ts";

const scenario = (options: Partial<Scenario> = {}) => ({ ...defaultScenario, ...options });
const estimate = (options: Partial<Scenario> = {}) => calculate(scenario(options));
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} differs from ${expected}`);

test("1. Stripe domestic online uses fixed and percentage fees", () => {
  const result = estimate();
  close(result.monthly, 1750);
  close(result.quarterly, 5250);
  close(result.total, 21000);
  close(result.effective, .035);
});

test("2. Stripe adds the international percentage only on those payments", () => {
  close(estimate({ internationalShare: 20 }).monthly, 1900);
});

test("3. Stripe Billing adds its fee to subscription volume from paid users", () => {
  const s = scenario({ model: "subscription" });
  assert.equal(activity(s).subscribers, 500);
  close(calculate(s).monthly, 510);
});

test("4. Annual subscription billing keeps customer spend constant and saves fixed fees", () => {
  const annual = estimate({ model: "subscription", frequency: "annual", price: 240 });
  close(annual.total, 4470);
  close(annual.monthly, 372.50);
  close(savingsLevers(scenario({ model: "subscription" })).find((lever) => lever.title === "Bill once a year")!.savings, 1650);
});

test("5. Shopify in-person fees and plan charges are distinct", () => {
  const result = estimate({ provider: "shopify", channel: "pos", orders: 2000, ticket: 25 });
  close(result.processing / 12, 1500);
  close(result.monthly, 1539);
  close(result.effective, .03);
  close(result.effectiveAllIn, .03078);
});

test("6. Shopify Basic with Stripe adds gateway fees and the Shopify plan", () => {
  const result = estimate({ provider: "shopify", shopifyGateway: "stripe", orders: 100, ticket: 100 });
  close(result.processing / 12, 320);
  close(result.gatewayFee / 12, 200);
  close(result.monthly, 559);
});

test("7. PayPal Checkout uses the USD fixed fee", () => {
  close(estimate({ provider: "paypal", orders: 200, ticket: 40 }).monthly, 377.20);
});

test("8. Square Free uses $0.15 in person", () => {
  close(estimate({ provider: "square", channel: "pos", orders: 1000, ticket: 15 }).monthly, 540);
});

test("9. Shopify Basic to Grow breaks even at $33,000 a month online", () => {
  close(shopifyBreakEven(scenario({ provider: "shopify" }))!.volume, 33000);
});

test("mixed channels and annual subscriber split preserve each ticket and cadence", () => {
  const data = activity(scenario({ model: "both", channel: "both", posShare: 60, annualShare: 20 }));
  close(data.count, 16900);
  close(data.recurringVolume, 120000);
  close(data.groups.filter((group) => group.channel === "pos")[0].count, 7200);
});

test("Shopify's third-party fee applies only to online volume, and POS Pro is per location", () => {
  const result = estimate({ provider: "shopify", shopifyGateway: "stripe", channel: "both",
    orders: 100, ticket: 100, posProLocations: 2 });
  close(result.gatewayFee / 12, 100);
  close(result.platform / 12, 217);
});

test("Square API, paid plan locations and manual rate swaps stay distinct", () => {
  const result = estimate({ provider: "square", channel: "both", orders: 100, ticket: 100, squarePlan: "plus",
    squareOnline: "api", squareLocations: 2, keyedShare: 100 });
  close(result.processing / 12, 342.50);
  close(result.platform / 12, 98);
});

test("Shopify premium cards swap the base rate, and international and FX use independent shares", () => {
  const result = estimate({ provider: "shopify", orders: 100, ticket: 100, premiumShare: 20, internationalShare: 10, conversionShare: 4 });
  close(result.processing / 12, 348);
});

test("Stripe Tap to Pay adds one authorization charge per modeled POS sale", () => {
  close(estimate({ channel: "pos", orders: 100, ticket: 20, stripeTap: true }).monthly, 69);
});

test("Stripe bank payments are priced separately and excluded from card interchange", () => {
  const s = scenario({ orders: 100, ticket: 100, stripeBankShare: 100 });
  const result = calculate(s);
  close(result.monthly, 290);
  assert.equal(breakdown(s, result).issuing, 0);
});

test("refund-retained fees are included once and disputed payments have a separate fee", () => {
  const base = estimate();
  const result = estimate({ refundShare: 10, disputes: 2 });
  close(result.keptOnRefunds / 12, 175);
  close(result.monthly, base.monthly + 30);
});

test("Visa exempt debit example caps the interchange per payment without altering checkout fees", () => {
  const s = scenario({ orders: 1, ticket: 500, visaShare: 100, regulatedShare: 0,
    exemptShare: 60, consumerShare: 0, commercialShare: 0, networkPct: 0 });
  const result = calculate(s);
  close(breakdown(s, result).issuing / 12, 2);
  close(result.monthly, 14.8);
});

test("unusually expensive mix clamps residual markup and an empty mix uses default shares", () => {
  const s = scenario({ orders: 1, ticket: 10, regulatedFixed: 10, regulatedShare: 100, exemptShare: 0,
    consumerShare: 0, commercialShare: 0 });
  const split = breakdown(s, calculate(s));
  assert.equal(split.markup, 0);
  assert.ok(split.residual < 0);
  assert.deepEqual(breakdown({ ...s, regulatedShare: 0 }, calculate(s)).mix, [.35, .05, .50, .10]);
});

test("empty inputs yield finite values and comparison uses identical sales", () => {
  const s = scenario({ orders: 0 });
  assert.equal(activity(s).volume, 0);
  assert.equal(calculate(s).effective, 0);
  const results = compare(scenario());
  assert.equal(results.length, 4);
  assert.deepEqual(results.map((row) => row.total), results.map((row) => row.total).sort((a, b) => a - b));
});

test("scenarios round-trip through URLs and invalid inputs fall back or clamp", () => {
  const s = scenario({ provider: "paypal", orders: 17, ticket: 8.21, fraudAdjustment: false, keyedShare: 77 });
  assert.deepEqual(readScenario(writeScenario(s).toString()), s);
  assert.equal(readScenario("?p=visa&aov=NaN&keyedShare=99999&orders=-5").provider, "stripe");
  assert.equal(readScenario("?p=visa&aov=NaN&keyedShare=99999&orders=-5").ticket, 50);
  assert.equal(readScenario("?keyedShare=99999").keyedShare, 100);
  assert.equal(readScenario("?orders=-5").orders, 0);
});
