import { defaultScenario, frequencies, type Scenario } from "./calc.ts";

const aliases: Partial<Record<keyof Scenario, string>> = {
  channel: "ch", provider: "p", ticket: "aov",
};
const choices = {
  channel: ["online", "pos", "both"],
  provider: ["stripe", "shopify", "square", "paypal"],
  model: ["once", "subscription", "both"],
  subscriberInput: ["users", "direct"],
  frequency: Object.keys(frequencies),
  shopifyPlan: ["basic", "grow", "advanced"],
  shopifyGateway: ["native", "stripe", "paypal"],
  squarePlan: ["free", "plus", "premium"],
  squareOnline: ["online", "api"],
  paypalProduct: ["checkout", "standard", "advanced"],
};

export function inputMaximum(key: keyof Scenario) {
  return /Share$|Pct$/.test(key) ? 100 : 1_000_000_000;
}

function keys<T extends object>(record: T) {
  return Object.keys(record) as (keyof T)[];
}

export function readScenario(search: string, defaults: Scenario = defaultScenario): Scenario {
  const params = new URLSearchParams(search);
  const scenario = { ...defaults };
  for (const key of keys(scenario)) {
    const value = params.get(aliases[key] ?? key);
    if (value === null || value === "") continue;
    if (key in choices) {
      if ((choices[key as keyof typeof choices] as readonly string[]).includes(value)) {
        Object.assign(scenario, { [key]: value });
      }
    } else if (typeof scenario[key] === "boolean") {
      if (value === "0" || value === "1") Object.assign(scenario, { [key]: value === "1" });
    } else {
      const number = Number(value);
      if (Number.isFinite(number)) {
        Object.assign(scenario, { [key]: Math.max(0, Math.min(inputMaximum(key), number)) });
      }
    }
  }
  return scenario;
}

export function writeScenario(scenario: Scenario, defaults: Scenario = defaultScenario) {
  const params = new URLSearchParams();
  for (const key of keys(scenario)) {
    const value = scenario[key];
    if (value !== defaults[key]) {
      params.set(aliases[key] ?? key, typeof value === "boolean" ? String(Number(value)) : String(value));
    }
  }
  return params;
}
